import { listWorkspaceMaintenances } from "./maintenance.js";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const HISTORY_SAMPLE_LIMIT = 96;
const UPDATE_SAMPLE_LIMIT = 8;

export async function getIncidentActionPack(redis, workspaceId, incidentId) {
  return redis.get(getIncidentActionPackKey(workspaceId, incidentId));
}

export async function saveIncidentActionPack(redis, workspaceId, incidentId, payload) {
  await redis.set(getIncidentActionPackKey(workspaceId, incidentId), payload);
  return payload;
}

export async function generateIncidentActionPack(redis, env, workspace, incident) {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const startedAt = Date.now();
  const promptInput = await buildIncidentActionPackInput(redis, workspace, incident);
  const generated = await requestGeminiActionPack(env, promptInput);
  const actionPack = normalizeActionPack(generated);

  return {
    incidentId: incident.id,
    workspaceId: workspace.id,
    generatedAt: new Date().toISOString(),
    actionPackVersion: "v1",
    diagnosticMeta: {
      generationDurationMs: Date.now() - startedAt,
    },
    sourceMeta: {
      hasMonitorHistory: promptInput.monitorSummary.history.totalChecks > 0,
      hasIncidentUpdates: promptInput.incidentUpdates.length > 0,
      hasMaintenance: promptInput.monitorSummary.maintenance.active.length > 0,
      incidentStatus: promptInput.incident.status,
    },
    actionPack,
  };
}

function getIncidentActionPackKey(workspaceId, incidentId) {
  return `incident_action_pack:${workspaceId}:${incidentId}`;
}

async function buildIncidentActionPackInput(redis, workspace, incident) {
  const [monitor, incidentUpdates, history, maintenance] = await Promise.all([
    incident.monitorId ? redis.get(`monitor:${incident.monitorId}`) : Promise.resolve(null),
    redis.lrange(`incident:${incident.id}:updates`, 0, UPDATE_SAMPLE_LIMIT - 1).then((items) => Array.isArray(items) ? items : []),
    incident.monitorId ? redis.lrange(`history:${incident.monitorId}`, 0, HISTORY_SAMPLE_LIMIT - 1).then((items) => Array.isArray(items) ? items : []) : Promise.resolve([]),
    incident.monitorId ? listWorkspaceMaintenances(redis, "", workspace.id, { monitorId: incident.monitorId }) : Promise.resolve([]),
  ]);

  return {
    incident: {
      id: incident.id,
      code: incident.code,
      title: incident.title,
      status: incident.status,
      severity: incident.severity,
      description: incident.description || "",
      impactSummary: incident.impactSummary || "",
      rootCause: incident.rootCause || "",
      nextSteps: incident.nextSteps || "",
      fixSummary: incident.fixSummary || "",
      resolutionNotes: incident.resolutionNotes || "",
      startedAt: incident.startedAt || null,
      acknowledgedAt: incident.acknowledgedAt || null,
      resolvedAt: incident.resolvedAt || null,
      monitorName: incident.monitorName || monitor?.name || "",
      monitorUrl: incident.monitorUrl || monitor?.url || "",
    },
    incidentUpdates: [...incidentUpdates]
      .reverse()
      .slice(-UPDATE_SAMPLE_LIMIT)
      .map((item) => ({
        type: item.type || "note",
        title: item.title || "",
        body: item.body || "",
        createdAt: item.createdAt || null,
      })),
    monitorSummary: buildMonitorSummary(monitor, history, maintenance),
  };
}

function buildMonitorSummary(monitor, history, maintenanceItems) {
  const counts = {
    UP: 0,
    UP_RESTRICTED: 0,
    DOWN: 0,
    MAINTENANCE: 0,
  };
  const latencyValues = [];
  const items = Array.isArray(history) ? history : [];
  const latest = items[0] || null;

  for (const item of items) {
    if (counts[item?.status] != null) counts[item.status] += 1;
    if (Number.isFinite(item?.latency)) latencyValues.push(item.latency);
  }

  latencyValues.sort((left, right) => left - right);
  const avgLatency = latencyValues.length > 0
    ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
    : null;

  const activeMaintenance = (maintenanceItems || [])
    .filter((item) => item.computedStatus === "active")
    .slice(0, 2)
    .map((item) => ({
      title: item.title,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    }));

  const upcomingMaintenance = (maintenanceItems || [])
    .filter((item) => item.computedStatus === "scheduled")
    .slice(0, 2)
    .map((item) => ({
      title: item.title,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    }));

  return {
    monitor: monitor ? {
      name: monitor.name,
      url: monitor.url,
      status: monitor.status,
      lastChecked: monitor.lastChecked || null,
      lastLatency: monitor.lastLatency ?? null,
      lastStatusCode: monitor.lastStatusCode ?? null,
      lastErrorType: monitor.lastErrorType || "",
    } : null,
    history: {
      totalChecks: items.length,
      latestStatus: latest?.status || null,
      latestStatusCode: latest?.statusCode ?? null,
      latestErrorType: latest?.errorType || "",
      latestTimestamp: latest?.timestamp || null,
      avgLatency,
      counts,
      recentTransitions: buildRecentTransitions(items),
    },
    maintenance: {
      active: activeMaintenance,
      upcoming: upcomingMaintenance,
    },
  };
}

function buildRecentTransitions(history) {
  const entries = [...(history || [])].reverse();
  const transitions = [];
  let previousStatus = null;

  for (const item of entries) {
    if (!item?.status || !item?.timestamp) continue;
    if (previousStatus == null) {
      previousStatus = item.status;
      continue;
    }
    if (item.status !== previousStatus) {
      transitions.push({
        from: previousStatus,
        to: item.status,
        timestamp: item.timestamp,
        statusCode: item.statusCode ?? null,
        errorType: item.errorType || "",
      });
      previousStatus = item.status;
    }
  }

  return transitions.slice(-5).reverse();
}

async function requestGeminiActionPack(env, promptInput) {
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.25,
      },
      contents: [
        {
          role: "user",
          parts: [{ text: buildPrompt(promptInput) }],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Gemini could not generate the incident action pack.");
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("\n").trim();
  if (!text) {
    throw new Error("Gemini returned an empty incident action pack.");
  }

  return safeJsonParse(text);
}

function buildPrompt(promptInput) {
  return [
    "You are a senior incident commander generating a concise action pack for PingMaster.",
    "Use only the provided data.",
    "Do not invent causes, timelines, user impact, fixes, or recovery details.",
    "Be practical and operationally useful.",
    "Prefer short communication-ready text.",
    "The public update must be customer-safe and non-technical.",
    "The internal update can mention technical context but must stay concise.",
    "If the incident is not yet resolved, the recovery draft should be framed as a ready-to-send draft for when resolution is confirmed.",
    "Return strict JSON with this shape:",
    JSON.stringify({
      internalUpdate: "string",
      publicStatusUpdate: "string",
      nextChecks: ["string"],
      recoveryDraft: "string",
    }),
    "Formatting rules:",
    "- internalUpdate: one short paragraph for engineers",
    "- publicStatusUpdate: one short paragraph suitable for a status page",
    "- nextChecks: 3 to 5 short actions",
    "- recoveryDraft: one short paragraph",
    "",
    "Input:",
    JSON.stringify(promptInput, null, 2),
  ].join("\n");
}

function normalizeActionPack(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  return {
    internalUpdate: normalizeParagraph(data.internalUpdate),
    publicStatusUpdate: normalizeParagraph(data.publicStatusUpdate),
    nextChecks: normalizeStringList(data.nextChecks).slice(0, 5),
    recoveryDraft: normalizeParagraph(data.recoveryDraft),
  };
}

function normalizeParagraph(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || "--";
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return JSON.parse(cleaned);
  }
}
