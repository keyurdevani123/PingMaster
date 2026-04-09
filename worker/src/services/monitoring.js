import { MONITOR_INDEX_KEY } from "../config/constants.js";
import { attachPsiCapability, buildPsiCapability } from "../lib/psi.js";
import { createAlertRuntimeCache, processMonitorAlert } from "./alerts.js";
import { buildMaintenanceResult, getActiveMaintenanceForMonitor } from "./maintenance.js";
import { invalidateWorkspaceStatusPageCaches } from "./statusPages.js";

const SUMMARY_HISTORY_LIMIT = 288;
const SUMMARY_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function validateMonitorCandidate(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PingMaster/1.0)" },
    });

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    return {
      ok: true,
      contentType,
      ...buildPsiCapability(url, contentType),
    };
  } catch (error) {
    return {
      ok: false,
      message: error?.name === "AbortError"
        ? "Could not validate this URL in time. Please check that the target is reachable."
        : "Could not validate this URL. Please check that the website or endpoint is reachable.",
    };
  }
}

export async function pingMonitor(redis, monitor, env = {}, options = {}) {
  const previousStatus = monitor.status;
  const activeMaintenance = await getActiveMaintenanceForMonitor(redis, monitor.id);
  const result = activeMaintenance
    ? buildMaintenanceResult(activeMaintenance)
    : await checkEndpoint(monitor.url);

  monitor.status = result.status;
  monitor.lastChecked = result.timestamp;
  monitor.lastLatency = result.latency;
  monitor.lastStatusCode = result.statusCode;
  monitor.lastErrorType = result.errorType;
  if (result.contentType) {
    monitor.lastContentType = result.contentType;
  }
  Object.assign(monitor, attachPsiCapability(monitor, result.contentType));

  const historyEntry = {
    timestamp: result.timestamp,
    latency: result.latency,
    status: result.status,
    statusCode: result.statusCode,
    errorType: result.errorType,
  };
  await redis.lpush(`history:${monitor.id}`, historyEntry);
  await redis.ltrim(`history:${monitor.id}`, 0, 2015);
  const existingSummary = await loadMonitorRollingSummary(redis, monitor.id);
  const nextWindow = [
    compactSummaryEntry(historyEntry),
    ...((existingSummary?.window || []).filter(Boolean)),
  ].slice(0, SUMMARY_HISTORY_LIMIT);
  const nextSummary = buildMonitorMetricsSummaryFromWindow(nextWindow);
  await saveMonitorRollingSummary(redis, monitor.id, {
    window: nextWindow,
    ...nextSummary,
  });
  monitor.metrics24h = nextSummary;
  if (previousStatus && previousStatus !== result.status) {
    monitor.lastTransition = {
      from: previousStatus,
      to: result.status,
      timestamp: result.timestamp,
      statusCode: result.statusCode ?? null,
      errorType: result.errorType || "",
    };
  }
  await redis.set(`monitor:${monitor.id}`, monitor);
  await invalidateWorkspaceStatusPageCaches(redis, monitor.workspaceId || null);
  if (monitor.workspaceId) {
    await redis.del(`workspace_monitor_summary:${monitor.workspaceId}`);
  }

  if (activeMaintenance) {
    return { monitor, result, historyEntry };
  }

  const alertTask = processMonitorAlert(
    redis,
    monitor,
    result,
    previousStatus,
    env,
    options.alertRuntimeCache || null
  );
  if (typeof options.waitUntil === "function") {
    options.waitUntil(alertTask);
  } else {
    await alertTask;
  }

  return { monitor, result, historyEntry };
}

export function buildMonitorMetricsSummary(historyEntries) {
  const now = Date.now();
  const entries = Array.isArray(historyEntries)
    ? historyEntries.filter((entry) => {
      const ts = new Date(entry?.timestamp).getTime();
      return !Number.isFinite(ts) || now - ts <= SUMMARY_WINDOW_MS;
    })
    : [];
  const operationalEntries = entries.filter((entry) => entry?.status !== "MAINTENANCE");
  const totalChecks = operationalEntries.length;
  const upChecks = operationalEntries.filter((entry) => entry?.status === "UP" || entry?.status === "UP_RESTRICTED").length;
  const latencyValues = operationalEntries
    .map((entry) => entry?.latency)
    .filter((value) => Number.isFinite(value));

  return {
    windowSize: totalChecks,
    uptime24h: totalChecks > 0 ? Math.round((upChecks / totalChecks) * 100) : null,
    avgLatency24h: latencyValues.length > 0
      ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
      : null,
    degradedChecks24h: operationalEntries.filter((entry) => entry?.status === "UP_RESTRICTED").length,
    downChecks24h: operationalEntries.filter((entry) => entry?.status === "DOWN").length,
  };
}

function buildMonitorMetricsSummaryFromWindow(windowEntries) {
  const entries = Array.isArray(windowEntries)
    ? windowEntries.map((entry) => ({
      status: entry?.s,
      latency: entry?.l,
      timestamp: entry?.t || null,
    }))
    : [];
  return buildMonitorMetricsSummary(entries);
}

function compactSummaryEntry(historyEntry) {
  return {
    s: historyEntry?.status || "",
    l: Number.isFinite(historyEntry?.latency) ? historyEntry.latency : null,
    t: historyEntry?.timestamp || new Date().toISOString(),
  };
}

async function loadMonitorRollingSummary(redis, monitorId) {
  const key = getMonitorSummaryKey(monitorId);
  const summary = await redis.get(key);
  if (summary?.window) {
    const requiresReseed = summary.window.some((entry) => !entry?.t && !entry?.timestamp);
    if (requiresReseed) {
      const seededHistory = await redis.lrange(`history:${monitorId}`, 0, SUMMARY_HISTORY_LIMIT - 1);
      const seededWindow = Array.isArray(seededHistory)
        ? seededHistory
          .filter(Boolean)
          .map((entry) => compactSummaryEntry(entry))
          .filter((entry) => {
            const ts = new Date(entry.t).getTime();
            return !Number.isFinite(ts) || Date.now() - ts <= SUMMARY_WINDOW_MS;
          })
          .slice(0, SUMMARY_HISTORY_LIMIT)
        : [];
      const seededSummary = {
        window: seededWindow,
        ...buildMonitorMetricsSummaryFromWindow(seededWindow),
      };
      await saveMonitorRollingSummary(redis, monitorId, seededSummary);
      return seededSummary;
    }

    const normalizedWindow = Array.isArray(summary.window)
      ? summary.window
        .filter(Boolean)
        .map((entry) => ({
          s: entry?.s || entry?.status || "",
          l: Number.isFinite(entry?.l) ? entry.l : (Number.isFinite(entry?.latency) ? entry.latency : null),
          t: entry?.t || entry?.timestamp || null,
        }))
        .filter((entry) => {
          const ts = new Date(entry.t).getTime();
          return !Number.isFinite(ts) || Date.now() - ts <= SUMMARY_WINDOW_MS;
        })
        .slice(0, SUMMARY_HISTORY_LIMIT)
      : [];
    const normalizedSummary = {
      window: normalizedWindow,
      ...buildMonitorMetricsSummaryFromWindow(normalizedWindow),
    };
    if (JSON.stringify(normalizedSummary) !== JSON.stringify(summary)) {
      await saveMonitorRollingSummary(redis, monitorId, normalizedSummary);
    }
    return normalizedSummary;
  }

  const seededHistory = await redis.lrange(`history:${monitorId}`, 0, SUMMARY_HISTORY_LIMIT - 1);
  const seededWindow = Array.isArray(seededHistory)
    ? seededHistory
      .filter(Boolean)
      .map((entry) => compactSummaryEntry(entry))
      .filter((entry) => {
        const ts = new Date(entry.t).getTime();
        return !Number.isFinite(ts) || Date.now() - ts <= SUMMARY_WINDOW_MS;
      })
      .slice(0, SUMMARY_HISTORY_LIMIT)
    : [];
  const seededSummary = {
    window: seededWindow,
    ...buildMonitorMetricsSummaryFromWindow(seededWindow),
  };
  await saveMonitorRollingSummary(redis, monitorId, seededSummary);
  return seededSummary;
}

async function saveMonitorRollingSummary(redis, monitorId, summary) {
  await redis.set(getMonitorSummaryKey(monitorId), summary);
}

function getMonitorSummaryKey(monitorId) {
  return `monitor_summary:${monitorId}`;
}

export async function runPinger(redis, env) {
  const ids = await getIndexedMonitorIds(redis);
  if (!ids || ids.length === 0) return;
  const alertRuntimeCache = createAlertRuntimeCache();

  await Promise.all(
    ids.map(async (id) => {
      const monitor = await redis.get(`monitor:${id}`);
      if (!monitor) return;
      await pingMonitor(redis, monitor, env, { alertRuntimeCache });
    })
  );
}

async function getIndexedMonitorIds(redis) {
  const indexed = await redis.smembers(MONITOR_INDEX_KEY);
  if (Array.isArray(indexed) && indexed.length > 0) {
    return indexed;
  }

  const keys = await redis.keys("monitor:*");
  const discoveredIds = (keys || [])
    .map((key) => (key.startsWith("monitor:") ? key.slice("monitor:".length) : null))
    .filter(Boolean);

  if (discoveredIds.length > 0) {
    await redis.sadd(MONITOR_INDEX_KEY, ...discoveredIds);
  }

  return discoveredIds;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkEndpoint(url, retries = 3) {
  let lastResult = null;
  const isStreamlitApp = isStreamlitUrl(url);
  const streamlitHealthUrl = isStreamlitApp ? buildStreamlitHealthUrl(url) : null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PingMaster/1.0)" },
      });

      clearTimeout(timeoutId);
      const body = await res.text();
      const latency = Date.now() - start;

      const classified = classifyHttpResult(res.status);
      let status = classified.status;
      let errorType = classified.errorType;

      if (body.includes("ERR_NGROK_3200")) {
        status = "DOWN";
        errorType = "TUNNEL_OFFLINE";
      }

      if (res.headers.get("server")?.includes("cloudflare") && body.includes("Attention Required")) {
        status = "UP_RESTRICTED";
        errorType = "CDN_BLOCK";
      }

      const serverHeader = (res.headers.get("server") || "").toLowerCase();
      if (
        [502, 503, 504].includes(res.status) &&
        (serverHeader.includes("nginx") || body.toLowerCase().includes("streamlit"))
      ) {
        status = "UP_RESTRICTED";
        errorType = "UPSTREAM_WARMING";
      }

      lastResult = {
        status,
        statusCode: res.status,
        latency,
        contentType: (res.headers.get("content-type") || "").toLowerCase(),
        errorType,
        timestamp: new Date().toISOString(),
      };

      if (status !== "DOWN") return lastResult;
    } catch (err) {
      const errorType = err.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
      lastResult = {
        status: "DOWN",
        statusCode: null,
        latency: Date.now() - start,
        errorType,
        errorMessage: err.message,
        timestamp: new Date().toISOString(),
      };

      try {
        const probeStart = Date.now();
        const probe = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(5000),
        });
        const probeLatency = Date.now() - probeStart;

        if (probe && Number.isFinite(probe.status) && probe.status >= 100) {
          const classifiedProbe = classifyHttpResult(probe.status);
          lastResult = {
            status: classifiedProbe.status,
            statusCode: probe.status,
            latency: probeLatency,
            errorType: classifiedProbe.errorType === "NONE"
              ? (errorType === "TIMEOUT" ? "INTERMITTENT_TIMEOUT" : "INTERMITTENT_NETWORK")
              : classifiedProbe.errorType,
            timestamp: new Date().toISOString(),
          };
          return lastResult;
        }
      } catch {
        // Ignore probe failure.
      }

      if (streamlitHealthUrl) {
        try {
          const healthStart = Date.now();
          const healthProbe = await fetch(streamlitHealthUrl, {
            method: "GET",
            redirect: "follow",
            signal: AbortSignal.timeout(7000),
          });
          const healthLatency = Date.now() - healthStart;

          if (healthProbe && Number.isFinite(healthProbe.status) && healthProbe.status >= 100) {
            const classifiedHealth = classifyHttpResult(healthProbe.status);
            lastResult = {
              status: classifiedHealth.status,
              statusCode: healthProbe.status,
              latency: healthLatency,
              errorType: classifiedHealth.errorType === "NONE" ? "STREAMLIT_HEALTH_OK" : classifiedHealth.errorType,
              timestamp: new Date().toISOString(),
            };
            return lastResult;
          }
        } catch {
          // Ignore health probe failure.
        }
      }
    }

    if (attempt < retries) await sleep(4000);
  }

  if (lastResult?.status === "DOWN" && lastResult?.statusCode == null) {
    if (lastResult.errorType === "TIMEOUT") {
      return {
        ...lastResult,
        status: "UP_RESTRICTED",
        statusCode: 408,
        errorType: "INTERMITTENT_TIMEOUT",
      };
    }

    if (lastResult.errorType === "NETWORK_ERROR") {
      return {
        ...lastResult,
        status: "UP_RESTRICTED",
        statusCode: 523,
        errorType: "INTERMITTENT_NETWORK",
      };
    }
  }

  return lastResult;
}

function classifyHttpResult(statusCode) {
  if (statusCode >= 100 && statusCode < 400) {
    return { status: "UP", errorType: "NONE" };
  }

  if (statusCode >= 400 && statusCode < 500) {
    if (statusCode === 429) {
      return { status: "UP_RESTRICTED", errorType: "RATE_LIMITED" };
    }
    return { status: "UP_RESTRICTED", errorType: "CLIENT_ERROR" };
  }

  if (statusCode >= 500 && statusCode < 600) {
    if ([502, 503, 504, 522, 523, 524, 525, 526, 529, 530].includes(statusCode)) {
      return { status: "UP_RESTRICTED", errorType: "UPSTREAM_TEMPORARY" };
    }
    return { status: "DOWN", errorType: "SERVER_ERROR" };
  }

  return { status: "DOWN", errorType: "UNKNOWN_STATUS" };
}

function isStreamlitUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith(".streamlit.app") || host.includes("streamlit");
  } catch {
    return false;
  }
}

function buildStreamlitHealthUrl(url) {
  try {
    const origin = new URL(url).origin;
    return `${origin}/_stcore/health`;
  } catch {
    return null;
  }
}
