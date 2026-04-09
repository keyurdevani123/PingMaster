import { listWorkspaceMaintenances } from "./maintenance.js";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const HISTORY_SAMPLE_LIMIT = 48;
const UPDATE_SAMPLE_LIMIT = 10;

export async function generateIncidentCreationSuggestions(redis, env, workspace, monitorId) {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const startedAt = Date.now();
  const promptInput = await buildCreationPromptInput(redis, workspace, monitorId);
  const generated = await requestGemini(env, buildCreationPrompt(promptInput));
  const suggestions = normalizeCreationSuggestions(generated);

  return {
    generatedAt: new Date().toISOString(),
    diagnosticMeta: {
      generationDurationMs: Date.now() - startedAt,
    },
    sourceMeta: {
      monitorId,
      hasMonitorHistory: promptInput.monitorSummary.history.totalChecks > 0,
      hasMaintenance: promptInput.monitorSummary.maintenance.active.length > 0 || promptInput.monitorSummary.maintenance.upcoming.length > 0,
    },
    suggestions,
  };
}

export async function generateIncidentResolveSuggestions(redis, env, workspace, incident) {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const startedAt = Date.now();
  const promptInput = await buildResolvePromptInput(redis, workspace, incident);
  const generated = await requestGemini(env, buildResolvePrompt(promptInput));
  const suggestions = normalizeResolveSuggestions(generated);

  return {
    incidentId: incident.id,
    generatedAt: new Date().toISOString(),
    diagnosticMeta: {
      generationDurationMs: Date.now() - startedAt,
    },
    sourceMeta: {
      hasTimeline: promptInput.timeline.length > 0,
      hasMonitorHistory: promptInput.monitorSummary.history.totalChecks > 0,
      incidentStatus: promptInput.incident.status,
    },
    suggestions,
  };
}

async function buildCreationPromptInput(redis, workspace, monitorId) {
  const [monitor, history, maintenance] = await Promise.all([
    redis.get(`monitor:${monitorId}`),
    redis.lrange(`history:${monitorId}`, 0, HISTORY_SAMPLE_LIMIT - 1).then((items) => Array.isArray(items) ? items : []),
    listWorkspaceMaintenances(redis, "", workspace.id, { monitorId }),
  ]);

  if (!monitor) {
    throw new Error("Monitor not found.");
  }

  return {
    monitor: {
      id: monitor.id,
      name: monitor.name,
      url: monitor.url,
      status: monitor.status || "",
      lastChecked: monitor.lastChecked || null,
      lastLatency: monitor.lastLatency ?? null,
      lastStatusCode: monitor.lastStatusCode ?? null,
      lastErrorType: monitor.lastErrorType || "",
    },
    monitorSummary: buildMonitorSummary(monitor, history, maintenance),
  };
}

async function buildResolvePromptInput(redis, workspace, incident) {
  const [monitor, history, maintenance, incidentUpdates] = await Promise.all([
    incident.monitorId ? redis.get(`monitor:${incident.monitorId}`) : Promise.resolve(null),
    incident.monitorId ? redis.lrange(`history:${incident.monitorId}`, 0, HISTORY_SAMPLE_LIMIT - 1).then((items) => Array.isArray(items) ? items : []) : Promise.resolve([]),
    incident.monitorId ? listWorkspaceMaintenances(redis, "", workspace.id, { monitorId: incident.monitorId }) : Promise.resolve([]),
    redis.lrange(`incident:${incident.id}:updates`, 0, UPDATE_SAMPLE_LIMIT - 1).then((items) => Array.isArray(items) ? items : []),
  ]);

  return {
    incident: {
      id: incident.id,
      code: incident.code,
      title: incident.title || "",
      status: incident.status || "",
      severity: incident.severity || "",
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
    timeline: [...incidentUpdates]
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
      active: (maintenanceItems || []).filter((item) => item.computedStatus === "active").slice(0, 2).map(minifyMaintenance),
      upcoming: (maintenanceItems || []).filter((item) => item.computedStatus === "scheduled").slice(0, 2).map(minifyMaintenance),
    },
  };
}

function minifyMaintenance(item) {
  return {
    title: item.title || "",
    startsAt: item.startsAt || null,
    endsAt: item.endsAt || null,
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

async function requestGemini(env, prompt) {
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Gemini could not generate incident suggestions.");
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("\n").trim();
  if (!text) {
    throw new Error("Gemini returned empty incident suggestions.");
  }

  return safeJsonParse(text);
}

function buildCreationPrompt(promptInput) {
  return [
    "You are assisting a senior reliability engineer creating an incident in PingMaster.",
    "Use only the provided monitor state and history.",
    "Do not invent impact, causes, or user harm beyond what the data reasonably supports.",
    "Return concise, practical drafting suggestions for the incident creation form.",
    "Return strict JSON with this shape:",
    JSON.stringify({
      severity: "critical|high|medium|low",
      title: "string",
      impactSummary: "string",
      description: "string",
      rootCause: "string",
      nextSteps: "string",
    }),
    "Formatting rules:",
    "- title: short and operator-friendly",
    "- impactSummary: one short paragraph focused on likely user-visible effect",
    "- description: 1 to 2 short sentences describing the current operational state",
    "- rootCause: brief probable cause wording, or say that the exact cause is still under investigation",
    "- nextSteps: 2 to 4 short checklist bullets separated by newline characters",
    "- severity must reflect the current monitor state and recent instability",
    "",
    "Input:",
    JSON.stringify(promptInput, null, 2),
  ].join("\n");
}

function buildResolvePrompt(promptInput) {
  return [
    "You are assisting a senior reliability engineer resolving an incident in PingMaster.",
    "Use the incident record, recent timeline entries, and latest monitor status only.",
    "Do not invent remediation steps that are not supported by the timeline or current state.",
    "If the exact remediation is unclear, say it was addressed and verified without making up technical details.",
    "Return concise, ready-to-edit suggestions for the resolve form.",
    "Return strict JSON with this shape:",
    JSON.stringify({
      fixSummary: "string",
      resolutionNotes: "string",
    }),
    "Formatting rules:",
    "- fixSummary: one short paragraph focused on what changed and what restored stability",
    "- resolutionNotes: one short paragraph for follow-up or customer-facing closure context",
    "- keep both concise and grounded in the timeline and current monitor state",
    "",
    "Input:",
    JSON.stringify(promptInput, null, 2),
  ].join("\n");
}

function normalizeCreationSuggestions(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  return {
    severity: normalizeSeverity(data.severity),
    title: normalizeParagraph(data.title),
    impactSummary: normalizeParagraph(data.impactSummary),
    description: normalizeParagraph(data.description),
    rootCause: normalizeParagraph(data.rootCause),
    nextSteps: normalizeMultiline(data.nextSteps),
  };
}

function normalizeResolveSuggestions(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  return {
    fixSummary: normalizeParagraph(data.fixSummary),
    resolutionNotes: normalizeParagraph(data.resolutionNotes),
  };
}

function normalizeSeverity(value) {
  const severity = String(value || "").trim().toLowerCase();
  return ["critical", "high", "medium", "low"].includes(severity) ? severity : "high";
}

function normalizeParagraph(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || "--";
}

function normalizeMultiline(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n") || "--";
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
