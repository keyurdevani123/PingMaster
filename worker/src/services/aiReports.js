import { listWorkspaceMaintenances } from "./maintenance.js";
import { getStoredPsiSummary, normalizePsiSummary } from "./psiSummary.js";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const HISTORY_SAMPLE_LIMIT = 288;
const INCIDENT_SAMPLE_LIMIT = 8;
const MAX_HTML_BYTES = 160 * 1024;
const EXTERNAL_FETCH_TIMEOUT_MS = 10_000;

export async function getMonitorAiReport(redis, workspaceId, monitorId) {
  return redis.get(getMonitorAiReportKey(workspaceId, monitorId));
}

export async function saveMonitorAiReport(redis, workspaceId, monitorId, payload) {
  await redis.set(getMonitorAiReportKey(workspaceId, monitorId), payload);
  return payload;
}

export async function generateMonitorAiReport(redis, env, workspace, monitor, options = {}) {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const startedAt = Date.now();
  const internalContext = await buildInternalMonitorContext(redis, workspace, monitor);
  const external = await fetchExternalSnapshot(monitor.url).catch((error) => ({
    available: false,
    error: error?.message || "Live page snapshot was unavailable.",
  }));
  const psiSummary = options.psiPayload
    ? normalizePsiSummary(options.psiPayload, options.psiStrategy || "desktop")
    : await getStoredPsiSummary(redis, workspace.id, monitor.id, options.psiStrategy || "desktop");
  const promptInput = buildPromptInput(monitor, internalContext, external, psiSummary);
  const generated = await requestGeminiReport(env, promptInput);
  const report = normalizeGeneratedReport(generated, promptInput);

  return {
    monitorId: monitor.id,
    workspaceId: workspace.id,
    reportVersion: "v2",
    generatedAt: new Date().toISOString(),
    diagnosticMeta: {
      generationDurationMs: Date.now() - startedAt,
      externalFetchDurationMs: external?.timingMs ?? null,
    },
    sourceMeta: {
      hasHistory: promptInput.historySummary.totalChecks > 0,
      hasIncidents: promptInput.incidentSummary.total > 0,
      hasMaintenance: promptInput.maintenanceSummary.total > 0,
      hasPsi: Boolean(promptInput.psiSummary),
      hasExternalSnapshot: Boolean(external?.available),
      strategy: psiSummary?.strategy || null,
    },
    report,
  };
}

function getMonitorAiReportKey(workspaceId, monitorId) {
  return `gemini_report:${workspaceId}:${monitorId}`;
}

async function buildInternalMonitorContext(redis, workspace, monitor) {
  const [history, childSummary, incidentSummary, maintenanceSummary] = await Promise.all([
    listMonitorHistory(redis, monitor.id),
    buildChildMonitorSummary(redis, monitor.id),
    buildIncidentSummary(redis, monitor.id),
    buildMaintenanceSummary(redis, workspace.id, monitor.id),
  ]);

  return {
    historySummary: summarizeHistory(history),
    childSummary,
    incidentSummary,
    maintenanceSummary,
  };
}

async function listMonitorHistory(redis, monitorId) {
  const items = await redis.lrange(`history:${monitorId}`, 0, HISTORY_SAMPLE_LIMIT - 1);
  return Array.isArray(items) ? items : [];
}

async function buildChildMonitorSummary(redis, monitorId) {
  const childIds = await redis.lrange(`monitor:${monitorId}:children`, 0, 49);
  if (!Array.isArray(childIds) || childIds.length === 0) {
    return {
      total: 0,
      unhealthy: 0,
      items: [],
    };
  }

  const seen = new Set();
  const children = [];
  for (const childId of childIds) {
    if (!childId || seen.has(childId)) continue;
    seen.add(childId);
    const child = await redis.get(`monitor:${childId}`);
    if (!child) continue;
    children.push({
      id: child.id,
      name: child.name,
      url: child.url,
      status: child.status,
      lastLatency: child.lastLatency ?? null,
      lastStatusCode: child.lastStatusCode ?? null,
      lastErrorType: child.lastErrorType || "",
    });
  }

  return {
    total: children.length,
    unhealthy: children.filter((item) => item.status && item.status !== "UP").length,
    items: children.slice(0, 6),
  };
}

async function buildIncidentSummary(redis, monitorId) {
  const incidentIds = await redis.lrange(`monitor:${monitorId}:incidents`, 0, INCIDENT_SAMPLE_LIMIT - 1);
  if (!Array.isArray(incidentIds) || incidentIds.length === 0) {
    return {
      total: 0,
      open: 0,
      latest: [],
    };
  }

  const seen = new Set();
  const incidents = [];
  for (const incidentId of incidentIds) {
    if (!incidentId || seen.has(incidentId)) continue;
    seen.add(incidentId);
    const incident = await redis.get(`incident:${incidentId}`);
    if (!incident) continue;
    incidents.push({
      id: incident.id,
      code: incident.code,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt,
      assignedToUserId: incident.assignedToUserId || null,
    });
  }

  return {
    total: incidents.length,
    open: incidents.filter((item) => item.status !== "resolved").length,
    latest: incidents.slice(0, 4),
  };
}

async function buildMaintenanceSummary(redis, workspaceId, monitorId) {
  const items = await listWorkspaceMaintenances(redis, "", workspaceId, { monitorId });
  const active = items.filter((item) => item.computedStatus === "active");
  const scheduled = items.filter((item) => item.computedStatus === "scheduled");
  const completed = items.filter((item) => item.computedStatus === "completed");

  return {
    total: items.length,
    active: active.slice(0, 2).map(formatMaintenanceItem),
    upcoming: scheduled.slice(0, 2).map(formatMaintenanceItem),
    latestCompleted: completed.slice(0, 2).map(formatMaintenanceItem),
  };
}

function formatMaintenanceItem(item) {
  return {
    id: item.id,
    title: item.title,
    message: item.message,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    status: item.computedStatus,
  };
}

function summarizeHistory(history) {
  const entries = Array.isArray(history) ? history : [];
  const latest = entries[0] || null;
  const counts = {
    UP: 0,
    UP_RESTRICTED: 0,
    DOWN: 0,
    MAINTENANCE: 0,
  };
  const latencyValues = [];

  for (const item of entries) {
    if (counts[item?.status] != null) counts[item.status] += 1;
    if (Number.isFinite(item?.latency)) latencyValues.push(item.latency);
  }

  latencyValues.sort((left, right) => left - right);
  const successfulChecks = counts.UP + counts.UP_RESTRICTED;
  const totalChecks = entries.length;
  const uptime = totalChecks > 0 ? roundPercent((successfulChecks / totalChecks) * 100) : null;
  const avgLatency = latencyValues.length > 0
    ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
    : null;
  const p95 = latencyValues.length > 0 ? latencyValues[Math.min(latencyValues.length - 1, Math.floor(latencyValues.length * 0.95))] : null;

  return {
    totalChecks,
    latestStatus: latest?.status || null,
    latestStatusCode: latest?.statusCode ?? null,
    latestErrorType: latest?.errorType || "",
    latestTimestamp: latest?.timestamp || null,
    uptime,
    avgLatency,
    p95Latency: Number.isFinite(p95) ? Math.round(p95) : null,
    counts,
    recentTransitions: buildRecentTransitions(entries),
  };
}

function buildRecentTransitions(history) {
  const entries = [...history].reverse();
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

  return transitions.slice(-6).reverse();
}

function buildPromptInput(monitor, internalContext, externalSnapshot, psiSummary) {
  return {
    monitor: {
      id: monitor.id,
      name: monitor.name,
      url: monitor.url,
      type: monitor.type,
      status: monitor.status,
      lastChecked: monitor.lastChecked || null,
      lastLatency: monitor.lastLatency ?? null,
      lastStatusCode: monitor.lastStatusCode ?? null,
      lastErrorType: monitor.lastErrorType || "",
      psiEligible: monitor.psiEligible !== false,
      psiReason: monitor.psiReason || "",
      endpoints: Array.isArray(monitor.endpoints) ? monitor.endpoints.length : 0,
    },
    historySummary: internalContext.historySummary,
    childSummary: internalContext.childSummary,
    incidentSummary: internalContext.incidentSummary,
    maintenanceSummary: internalContext.maintenanceSummary,
    psiSummary: psiSummary || null,
    externalSnapshot,
  };
}

async function fetchExternalSnapshot(url) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PingMaster/1.0; AI Report)",
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    },
  });

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
  const html = isHtml ? await readLimitedText(response, MAX_HTML_BYTES) : "";
  const meta = isHtml ? extractHtmlMetadata(html) : null;

  return {
    available: true,
    timingMs: Date.now() - startedAt,
    finalUrl: response.url || url,
    statusCode: response.status,
    contentType,
    redirectCount: normalizeRedirectCount(response, url),
    headers: summarizeHeaders(response.headers),
    pageMeta: meta,
  };
}

async function readLimitedText(response, maxBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";

  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    output += decoder.decode(value, { stream: true });
    if (total >= maxBytes) break;
  }

  output += decoder.decode();
  return output;
}

function normalizeRedirectCount(response, originalUrl) {
  try {
    const finalUrl = new URL(response.url || originalUrl);
    const initialUrl = new URL(originalUrl);
    return finalUrl.href === initialUrl.href ? 0 : 1;
  } catch {
    return 0;
  }
}

function summarizeHeaders(headers) {
  return {
    cacheControl: truncateHeader(headers.get("cache-control")),
    contentEncoding: truncateHeader(headers.get("content-encoding")),
    server: truncateHeader(headers.get("server")),
    strictTransportSecurity: truncateHeader(headers.get("strict-transport-security")),
    xRobotsTag: truncateHeader(headers.get("x-robots-tag")),
    location: truncateHeader(headers.get("location")),
  };
}

function truncateHeader(value) {
  if (!value) return "";
  return String(value).slice(0, 240);
}

function extractHtmlMetadata(html) {
  return {
    title: extractTagText(html, "title"),
    description: extractMetaContent(html, "description"),
    canonical: extractLinkHref(html, "canonical"),
    robots: extractMetaContent(html, "robots"),
    ogTitle: extractMetaProperty(html, "og:title"),
    ogDescription: extractMetaProperty(html, "og:description"),
    ogImage: extractMetaProperty(html, "og:image"),
  };
}

function extractTagText(html, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = html.match(regex);
  return normalizeText(match?.[1] || "");
}

function extractMetaContent(html, name) {
  const regex = new RegExp(`<meta[^>]+name=["']${escapeRegex(name)}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
  const altRegex = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escapeRegex(name)}["'][^>]*>`, "i");
  return normalizeText((html.match(regex) || html.match(altRegex) || [])[1] || "");
}

function extractMetaProperty(html, property) {
  const regex = new RegExp(`<meta[^>]+property=["']${escapeRegex(property)}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
  const altRegex = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escapeRegex(property)}["'][^>]*>`, "i");
  return normalizeText((html.match(regex) || html.match(altRegex) || [])[1] || "");
}

function extractLinkHref(html, rel) {
  const regex = new RegExp(`<link[^>]+rel=["'][^"']*${escapeRegex(rel)}[^"']*["'][^>]+href=["']([^"']*)["'][^>]*>`, "i");
  const altRegex = new RegExp(`<link[^>]+href=["']([^"']*)["'][^>]+rel=["'][^"']*${escapeRegex(rel)}[^"']*["'][^>]*>`, "i");
  return normalizeText((html.match(regex) || html.match(altRegex) || [])[1] || "");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 320);
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function requestGeminiReport(env, promptInput) {
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const prompt = buildGeminiPrompt(promptInput);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3,
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
    const message = payload?.error?.message || "Gemini could not generate the monitor report.";
    throw new Error(message);
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("\n").trim();
  if (!text) {
    throw new Error("Gemini returned an empty monitor report.");
  }

  return safeJsonParse(text);
}

function buildGeminiPrompt(promptInput) {
  return [
    "You are a senior reliability and performance engineer generating an operations report for PingMaster.",
    "Your job is to produce a concise, grounded, decision-useful monitor report.",
    "Use only the provided data.",
    "Do not invent root causes, incidents, metrics, headers, PSI findings, or external facts.",
    "If evidence is weak, say that clearly inside limitations instead of guessing.",
    "Prioritize what matters most to the operator first: current impact, immediate risk, first action, then supporting detail.",
    "Prefer short, concrete recommendations over general advice.",
    "Treat maintenance windows as planned operational context, not as failures.",
    "If PSI is missing, say performance analysis is limited.",
    "If external page snapshot is missing, say configuration signals are limited.",
    "Keep all output operator-friendly and non-chatty.",
    "Return strict JSON with this shape:",
    JSON.stringify({
      executiveSummary: "string",
      currentHealth: "string",
      recentChanges: ["string"],
      reliabilityAnalysis: "string",
      performanceAnalysis: "string",
      pageConfigurationSignals: ["string"],
      topRisks: ["string"],
      priorityActions: ["string"],
      nextChecks: ["string"],
      limitations: ["string"],
      evidenceChips: ["string"],
    }),
    "Formatting rules:",
    "- executiveSummary and currentHealth must each be 1 short paragraph",
    "- list fields should be short bullet-style strings, not long paragraphs",
    "- priorityActions should be ordered from most important to least important",
    "- topRisks should focus on user-visible or operationally significant issues",
    "- evidenceChips should be short factual fragments only",
    "",
    "Input:",
    JSON.stringify(promptInput, null, 2),
  ].join("\n");
}

function normalizeGeneratedReport(payload, promptInput) {
  const report = payload && typeof payload === "object" ? payload : {};
  return {
    executiveSummary: normalizeParagraph(report.executiveSummary),
    currentHealth: normalizeParagraph(report.currentHealth),
    recentChanges: normalizeStringList(report.recentChanges),
    reliabilityAnalysis: normalizeParagraph(report.reliabilityAnalysis),
    performanceAnalysis: normalizeParagraph(report.performanceAnalysis || defaultPerformanceAnalysis(promptInput)),
    pageConfigurationSignals: normalizeStringList(report.pageConfigurationSignals),
    topRisks: normalizeStringList(report.topRisks),
    priorityActions: normalizeStringList(report.priorityActions),
    nextChecks: normalizeStringList(report.nextChecks),
    limitations: normalizeStringList(report.limitations),
    evidenceChips: normalizeStringList(report.evidenceChips).slice(0, 8),
  };
}

function defaultPerformanceAnalysis(promptInput) {
  if (!promptInput.psiSummary) {
    return "PageSpeed Insights data was not available for this report, so performance analysis is limited to monitor latency and external response signals.";
  }
  return "Performance analysis was based on the latest available PSI audit plus current monitor signals.";
}

function normalizeParagraph(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || "--";
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);
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

function roundPercent(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}
