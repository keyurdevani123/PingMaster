export const RANGE_OPTIONS = ["24h", "7d"];
export const NETWORK_METRICS_CACHE_TTL_MS = 10 * 60 * 1000;

export function getStatusMeta(status) {
  switch (status) {
    case "UP":
      return { label: "AVAILABLE", badgeClass: "bg-[#123828] text-[#69e7ba]" };
    case "DOWN":
      return { label: "DOWN", badgeClass: "bg-[#402025] text-[#f6b5a8]" };
    case "UP_RESTRICTED":
      return { label: "DEGRADED", badgeClass: "bg-[#44351a] text-[#f3d088]" };
    case "MAINTENANCE":
      return { label: "MAINTENANCE", badgeClass: "bg-[#3f3217] text-[#f2cf80]" };
    default:
      return { label: "PENDING", badgeClass: "bg-[#2b323f] text-[#bcc5d2]" };
  }
}

export function normalizeEndpointCandidate(value) {
  const input = (value || "").trim();
  if (!input) return "";
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function buildStats(history) {
  const operationalHistory = history.filter((entry) => entry.status !== "MAINTENANCE");
  const latencies = operationalHistory.map((entry) => entry.latency).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const upCount = operationalHistory.filter((entry) => entry.status === "UP" || entry.status === "UP_RESTRICTED").length;
  const downChecks = history.filter((entry) => entry.status === "DOWN").length;
  const degradedChecks = history.filter((entry) => entry.status === "UP_RESTRICTED").length;
  const maintenanceChecks = history.filter((entry) => entry.status === "MAINTENANCE").length;
  const latest = history[0] || null;
  const totalLatency = latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) : null;
  const avgLatency = latencies.length > 0 ? Math.round(totalLatency / latencies.length) : null;

  return {
    uptime: operationalHistory.length > 0 ? Math.round((upCount / operationalHistory.length) * 100) : 0,
    checks: operationalHistory.length,
    downChecks,
    degradedChecks,
    maintenanceChecks,
    totalLatency,
    avgLatency,
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    latestStatusCode: latest?.statusCode ?? null,
  };
}

export function percentile(sortedValues, p) {
  if (!sortedValues || sortedValues.length === 0) return null;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

export function buildChangeEvents(history) {
  const ordered = [...(history || [])].reverse();
  const events = [];

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (!previous || !current) continue;

    if (current.status === "MAINTENANCE" && previous.status !== "MAINTENANCE") {
      events.push({
        timestamp: current.timestamp,
        title: "Maintenance started",
        detail: "A planned maintenance window paused checks for this monitor.",
        severity: "minor",
        causeCode: "MAINTENANCE",
      });
      continue;
    }

    if (current.status !== "MAINTENANCE" && previous.status === "MAINTENANCE") {
      events.push({
        timestamp: current.timestamp,
        title: "Maintenance ended",
        detail: "Planned maintenance finished and regular checks resumed.",
        severity: "minor",
        causeCode: "MAINTENANCE",
      });
      continue;
    }

    if (current.status !== previous.status) {
      events.push({
        timestamp: current.timestamp,
        title: `Status changed: ${previous.status || "--"} -> ${current.status || "--"}`,
        detail: `Monitor state changed between checks.${formatStatusCodeContext(previous, current)}`,
        severity: current.status === "DOWN" ? "critical" : "major",
        causeCode: inferProbableCause("status", previous, current),
      });
    }

    if ((current.statusCode ?? null) !== (previous.statusCode ?? null)) {
      const prevCode = previous.statusCode ?? "--";
      const nextCode = current.statusCode ?? "--";
      events.push({
        timestamp: current.timestamp,
        title: `Status code changed: ${prevCode} -> ${nextCode}`,
        detail: "HTTP response code changed for this endpoint.",
        severity: inferStatusCodeSeverity(previous.statusCode, current.statusCode),
        causeCode: inferProbableCause("statusCode", previous, current),
      });
    }

    if ((current.errorType || "NONE") !== (previous.errorType || "NONE")) {
      events.push({
        timestamp: current.timestamp,
        title: `Error type changed: ${previous.errorType || "NONE"} -> ${current.errorType || "NONE"}`,
        detail: "Failure mode changed between checks.",
        severity: current.status === "DOWN" ? "critical" : "major",
        causeCode: inferProbableCause("errorType", previous, current),
      });
    }

    if (Number.isFinite(previous.latency) && Number.isFinite(current.latency) && previous.latency > 0) {
      const delta = current.latency - previous.latency;
      const ratio = delta / previous.latency;
      if (delta >= 150 && ratio >= 0.4) {
        events.push({
          timestamp: current.timestamp,
          title: `Latency spike: +${Math.round(delta)} ms`,
          detail: `Latency moved from ${Math.round(previous.latency)} ms to ${Math.round(current.latency)} ms.`,
          severity: delta >= 400 ? "major" : "minor",
          causeCode: inferProbableCause("latency", previous, current),
        });
      }
    }
  }

  return events.reverse().slice(0, 10);
}

export function inferStatusCodeSeverity(previousCode, currentCode) {
  const prev = Number.isFinite(previousCode) ? previousCode : null;
  const next = Number.isFinite(currentCode) ? currentCode : null;
  if (next == null) return "major";
  if (next >= 500) return "critical";
  if (next >= 400) return "major";
  if (prev != null && prev >= 400 && next < 400) return "minor";
  return "minor";
}

export function formatStatusCodeContext(previous, current) {
  const prevCode = previous?.statusCode ?? "--";
  const nextCode = current?.statusCode ?? "--";
  return ` Previous code ${prevCode}, now ${nextCode}.`;
}

export function getChangeSeverityMeta(severity) {
  switch (severity) {
    case "critical":
      return { label: "Critical", className: "bg-[#402025] text-[#f6b5a8]" };
    case "major":
      return { label: "Major", className: "bg-[#44351a] text-[#f3d088]" };
    default:
      return { label: "Minor", className: "bg-[#2b323f] text-[#bcc5d2]" };
  }
}

export function inferProbableCause(kind, previous, current) {
  const errorType = (current?.errorType || "").toUpperCase();
  const statusCode = Number.isFinite(current?.statusCode) ? current.statusCode : null;
  const previousStatus = (previous?.status || "").toUpperCase();
  const currentStatus = (current?.status || "").toUpperCase();

  if (previousStatus === "DOWN" && currentStatus === "UP") return "RECOVERY";
  if (errorType.includes("TIMEOUT")) return "TIMEOUT";
  if (errorType.includes("NETWORK")) return "NETWORK";
  if (errorType.includes("CDN") || errorType.includes("RATE_LIMIT") || statusCode === 429 || statusCode === 403) {
    return "ACCESS_RESTRICTED";
  }
  if (errorType.includes("UPSTREAM") || (Number.isFinite(statusCode) && statusCode >= 500)) {
    return "UPSTREAM";
  }

  if (kind === "latency") return "PERFORMANCE";
  if (kind === "statusCode" && Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 500) {
    return "CLIENT_SIDE";
  }

  return "UNKNOWN";
}

export function getChangeCauseMeta(causeCode) {
  switch (causeCode) {
    case "RECOVERY":
      return { label: "Recovery", className: "bg-[#123828] text-[#69e7ba]" };
    case "TIMEOUT":
      return { label: "Timeout", className: "bg-[#44351a] text-[#f3d088]" };
    case "NETWORK":
      return { label: "Network", className: "bg-[#402025] text-[#f6b5a8]" };
    case "ACCESS_RESTRICTED":
      return { label: "Restricted", className: "bg-[#3b2f45] text-[#d4b5f6]" };
    case "UPSTREAM":
      return { label: "Upstream", className: "bg-[#5a2323] text-[#ffb4a8]" };
    case "PERFORMANCE":
      return { label: "Performance", className: "bg-[#1c3748] text-[#9fdcff]" };
    case "CLIENT_SIDE":
      return { label: "Client 4xx", className: "bg-[#3f2f1f] text-[#f5cf9a]" };
    case "MAINTENANCE":
      return { label: "Maintenance", className: "bg-[#3f3217] text-[#f2cf80]" };
    default:
      return { label: "Unknown", className: "bg-[#2b323f] text-[#bcc5d2]" };
  }
}

export function buildMaintenanceWindows(history) {
  const ordered = [...(history || [])]
    .map((entry) => ({
      ...entry,
      ts: new Date(entry.timestamp).getTime(),
    }))
    .filter((entry) => Number.isFinite(entry.ts))
    .reverse();

  const windows = [];
  let activeWindow = null;

  for (const entry of ordered) {
    if (entry.status === "MAINTENANCE") {
      if (!activeWindow) {
        activeWindow = { start: entry.ts, end: entry.ts };
      } else {
        activeWindow.end = entry.ts;
      }
      continue;
    }

    if (activeWindow) {
      windows.push({ ...activeWindow });
      activeWindow = null;
    }
  }

  if (activeWindow) {
    windows.push(activeWindow);
  }

  return windows;
}

export function getPsiStorageKey(monitorId, strategy) {
  return `psi:${monitorId}:${strategy}`;
}

export async function estimateTlsHandshake(url) {
  try {
    const origin = new URL(url).origin;
    const coldStart = performance.now();
    await fetch(origin, { method: "HEAD", mode: "no-cors", cache: "no-store" });
    const cold = performance.now() - coldStart;

    const warmStart = performance.now();
    await fetch(origin, { method: "HEAD", mode: "no-cors", cache: "no-store" });
    const warm = performance.now() - warmStart;

    const estimate = Math.max(0, Math.round(cold - warm));
    return Number.isFinite(estimate) ? estimate : null;
  } catch {
    return null;
  }
}

export function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function safeProtocol(url) {
  try {
    return new URL(url).protocol.replace(":", "").toUpperCase();
  } catch {
    return "--";
  }
}

export function safePort(url) {
  try {
    const parsed = new URL(url);
    if (parsed.port) return parsed.port;
    return parsed.protocol === "https:" ? "443" : "80";
  } catch {
    return "--";
  }
}

export function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRangeTick(value, range) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  if (range === "7d") return date.toLocaleDateString([], { month: "short", day: "numeric" });
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatTooltipTime(value, range) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  if (range === "7d") {
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function getNetworkMetricsCacheKey(url) {
  return `monitor-network:${url}`;
}

export function readExpiringCache(key, ttlMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > ttlMs) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.payload;
  } catch {
    return null;
  }
}

export function writeExpiringCache(key, payload) {
  try {
    localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), payload }));
  } catch {
    // Ignore storage write errors.
  }
}

export function readUiPreference(monitorId, field, fallback) {
  if (!monitorId) return fallback;
  try {
    const raw = sessionStorage.getItem(`monitor-ui:${monitorId}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed?.[field] ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeUiPreference(monitorId, field, value) {
  if (!monitorId) return;
  try {
    const key = `monitor-ui:${monitorId}`;
    const raw = sessionStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[field] = value;
    sessionStorage.setItem(key, JSON.stringify(parsed));
  } catch {
    // Ignore storage write errors.
  }
}
