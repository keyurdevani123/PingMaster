export function filterHistoryByRange(history, range) {
  const now = Date.now();
  let cutoff = now - 7 * 24 * 60 * 60 * 1000;

  if (range === "24h") {
    cutoff = now - 24 * 60 * 60 * 1000;
  } else if (range === "72h") {
    cutoff = now - 72 * 60 * 60 * 1000;
  }

  return (history || []).filter((entry) => {
    const ts = new Date(entry.timestamp).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

export function buildIncidentTimeline(history, options = {}) {
  const { limit = Infinity } = options;
  const ordered = [...(history || [])].reverse();
  const incidents = [];
  let active = null;

  for (const entry of ordered) {
    const status = (entry?.status || "").toUpperCase();
    const isIncident = status === "DOWN" || status === "UP_RESTRICTED";
    const ts = new Date(entry?.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;

    if (isIncident && !active) {
      active = createIncidentSeed(entry);
      continue;
    }

    if (isIncident && active) {
      enrichIncident(active, entry);
      continue;
    }

    if (!isIncident && active) {
      active.end = entry.timestamp;
      active.state = "resolved";
      incidents.push(finalizeIncident(active));
      active = null;
    }
  }

  if (active) {
    incidents.push(finalizeIncident(active));
  }

  const sorted = incidents
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());

  if (!Number.isFinite(limit)) return sorted;
  return sorted.slice(0, limit);
}

export function getIncidentSeverityMeta(severity) {
  if (severity === "critical") {
    return {
      label: "Critical",
      barClass: "bg-[#f19a89]",
      badgeClass: "bg-[#402025] text-[#f6b5a8]",
    };
  }

  if (severity === "high") {
    return {
      label: "High",
      barClass: "bg-[#f1b889]",
      badgeClass: "bg-[#3f291b] text-[#f7c89b]",
    };
  }

  if (severity === "medium" || severity === "warning") {
    return {
      label: severity === "warning" ? "Warning" : "Medium",
      barClass: "bg-[#f2c55f]",
      badgeClass: "bg-[#44351a] text-[#f3d088]",
    };
  }

  if (severity === "low") {
    return {
      label: "Low",
      barClass: "bg-[#9fb0c7]",
      badgeClass: "bg-[#263240] text-[#c9d7e8]",
    };
  }

  return {
    label: "Info",
    barClass: "bg-[#7aa2ff]",
    badgeClass: "bg-[#25324f] text-[#bbceff]",
  };
}

export function getIncidentCauseMeta(causeCode) {
  switch (causeCode) {
    case "TIMEOUT":
      return { label: "Timeout", className: "bg-[#44351a] text-[#f3d088]" };
    case "NETWORK":
      return { label: "Network", className: "bg-[#402025] text-[#f6b5a8]" };
    case "ACCESS_RESTRICTED":
      return { label: "Restricted", className: "bg-[#3b2f45] text-[#d4b5f6]" };
    case "UPSTREAM":
      return { label: "Upstream", className: "bg-[#5a2323] text-[#ffb4a8]" };
    default:
      return { label: "Unknown", className: "bg-[#2b323f] text-[#bcc5d2]" };
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

export function formatRelativeTime(value) {
  const date = new Date(value).getTime();
  if (!Number.isFinite(date)) return "--";

  const diffMs = Date.now() - date;
  const diffMin = Math.max(0, Math.round(diffMs / 60000));

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatDuration(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return "--";
  }

  const minutes = Math.round((end - start) / 60000);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return `${hours}h ${rem}m`;

  const days = Math.floor(hours / 24);
  const hoursRem = hours % 24;
  return `${days}d ${hoursRem}h`;
}

function createIncidentSeed(entry) {
  const severity = entry.status === "DOWN" ? "critical" : "warning";

  return {
    start: entry.timestamp,
    end: null,
    state: "open",
    severity,
    statuses: new Set([entry.status]),
    affectedChecks: 1,
    latestStatus: entry.status,
    latestStatusCode: entry.statusCode ?? null,
    latestErrorType: entry.errorType || "NONE",
    peakLatency: Number.isFinite(entry.latency) ? entry.latency : null,
  };
}

function enrichIncident(incident, entry) {
  incident.statuses.add(entry.status);
  incident.affectedChecks += 1;
  incident.latestStatus = entry.status;
  incident.latestStatusCode = entry.statusCode ?? incident.latestStatusCode;
  incident.latestErrorType = entry.errorType || incident.latestErrorType;

  if (entry.status === "DOWN") {
    incident.severity = "critical";
  }

  if (Number.isFinite(entry.latency)) {
    incident.peakLatency = incident.peakLatency == null
      ? entry.latency
      : Math.max(incident.peakLatency, entry.latency);
  }
}

function finalizeIncident(incident) {
  const primaryStatus = incident.severity === "critical" ? "DOWN" : "UP_RESTRICTED";
  const causeCode = inferIncidentCause(primaryStatus, incident.latestStatusCode, incident.latestErrorType);

  return {
    start: incident.start,
    end: incident.end,
    state: incident.state,
    severity: incident.severity,
    primaryStatus,
    status: primaryStatus,
    latestStatusCode: incident.latestStatusCode,
    latestErrorType: incident.latestErrorType,
    peakLatency: incident.peakLatency,
    affectedChecks: incident.affectedChecks,
    durationLabel: formatDuration(incident.start, incident.end),
    startedAgoLabel: formatRelativeTime(incident.start),
    causeCode,
  };
}

function inferIncidentCause(status, statusCode, errorType) {
  const upperError = (errorType || "").toUpperCase();
  const code = Number.isFinite(statusCode) ? statusCode : null;

  if (upperError.includes("TIMEOUT")) return "TIMEOUT";
  if (upperError.includes("NETWORK")) return "NETWORK";
  if (upperError.includes("CDN") || upperError.includes("RATE_LIMIT")) return "ACCESS_RESTRICTED";
  if (upperError.includes("UPSTREAM") || upperError.includes("SERVER")) return "UPSTREAM";

  if (code != null) {
    if (code >= 500) return "UPSTREAM";
    if (code >= 400) return "ACCESS_RESTRICTED";
  }

  if (status === "UP_RESTRICTED") return "ACCESS_RESTRICTED";
  return "UNKNOWN";
}
