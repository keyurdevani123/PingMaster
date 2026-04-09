export const MONITOR_COLORS = ["#36cf9b", "#7aa2ff", "#f9b532", "#f19a89", "#b794f4", "#56d0ea"];

export function getInitial(email) {
  return email?.trim()?.charAt(0)?.toUpperCase() || "U";
}

export function buildKpis(monitors, monitorStatsMap, options = {}) {
  // Phase 1: summary data available — fast, authoritative
  if (options.summary) {
    const summary = options.summary;
    return [
      { label: "Total Monitors", value: summary.totalMonitors ?? "--", caption: "Configured services", valueColor: "text-[#eff3fa]" },
      { label: "Available Now", value: summary.availableNow ?? "--", caption: "Healthy right now", valueColor: "text-[#36cf9b]" },
      { label: "Down Now", value: summary.downNow ?? "--", caption: "Needs attention", valueColor: Number(summary.downNow) > 0 ? "text-[#f19a89]" : "text-[#a2abb9]" },
      { label: "Degraded", value: summary.degradedNow ?? "--", caption: Number(summary.degradedNow) > 0 ? "Partial responses" : "No partial responses", valueColor: "text-[#f2c55f]" },
      { label: "24h Uptime", value: Number.isFinite(summary.uptime24h) ? `${summary.uptime24h}%` : "--", caption: "Across last 24 hours", valueColor: "text-[#9fb0c7]" },
      { label: "Avg Response", value: Number.isFinite(summary.avgResponse24h) ? `${summary.avgResponse24h} ms` : "--", caption: "Last 24 hours", valueColor: "text-[#7aa2ff]" },
    ];
  }

  // Phase 2: summary still loading — show all as shimmer or derive basic counts from
  // the monitor list (Total, Available, Down, Degraded resolve fast from first page).
  // 24h Uptime and Avg Response MUST wait for summary (they need server-side aggregation).
  const total = monitors.length;
  const up = monitors.filter((m) => m.status === "UP").length;
  const restricted = monitors.filter((m) => m.status === "UP_RESTRICTED").length;
  const down = monitors.filter((m) => m.status === "DOWN").length;

  // If summary is still loading, shimmer the aggregated metrics.
  // If summary permanently failed (loading=false, summary=null), fall back to computed values.
  const summaryLoading = options.loading !== false; // default to true (shimmer) if unknown

  const uptimeValues = Object.values(monitorStatsMap || {})
    .map((item) => item.uptime24h)
    .filter((value) => Number.isFinite(value));
  const avgLatencyValues = Object.values(monitorStatsMap || {})
    .map((item) => item.avgLatency24h)
    .filter((value) => Number.isFinite(value));
  const uptime24h = uptimeValues.length > 0
    ? Math.round(uptimeValues.reduce((sum, value) => sum + value, 0) / uptimeValues.length)
    : null;
  const avgLatency24h = avgLatencyValues.length > 0
    ? Math.round(avgLatencyValues.reduce((sum, value) => sum + value, 0) / avgLatencyValues.length)
    : null;

  return [
    // These 4 resolve from first monitor page — no need to wait for summary.
    { label: "Total Monitors", value: options.loading && total === 0 ? "--" : total, caption: "Configured services", valueColor: "text-[#eff3fa]" },
    { label: "Available Now", value: options.loading && total === 0 ? "--" : up, caption: "Healthy right now", valueColor: "text-[#36cf9b]" },
    { label: "Down Now", value: options.loading && total === 0 ? "--" : down, caption: "Needs attention", valueColor: down > 0 ? "text-[#f19a89]" : "text-[#a2abb9]" },
    { label: "Degraded", value: options.loading && total === 0 ? "--" : restricted, caption: restricted > 0 ? "Partial responses" : "No partial responses", valueColor: "text-[#f2c55f]" },
    // These 2 need server aggregation — stay as "--" while summary is pending.
    { label: "24h Uptime", value: summaryLoading ? "--" : (uptime24h != null ? `${uptime24h}%` : "0%"), caption: "Across recent checks", valueColor: "text-[#9fb0c7]" },
    { label: "Avg Response", value: summaryLoading ? "--" : (avgLatency24h != null ? `${avgLatency24h} ms` : "--"), caption: "Last 24 hours", valueColor: "text-[#7aa2ff]" },
  ];
}

export function getStatusMeta(status) {
  switch (status) {
    case "UP":
      return {
        label: "AVAILABLE",
        dotClass: "bg-[#2fd79f]",
        badgeClass: "bg-[#123828] text-[#69e7ba]",
      };
    case "DOWN":
      return {
        label: "DOWN",
        dotClass: "bg-[#f19a89]",
        badgeClass: "bg-[#402025] text-[#f6b5a8]",
      };
    case "UP_RESTRICTED":
      return {
        label: "DEGRADED",
        dotClass: "bg-[#f2c55f]",
        badgeClass: "bg-[#44351a] text-[#f3d088]",
      };
    case "MAINTENANCE":
      return {
        label: "MAINTENANCE",
        dotClass: "bg-[#f2c55f]",
        badgeClass: "bg-[#3f3217] text-[#f2cf80]",
      };
    default:
      return {
        label: "PENDING",
        dotClass: "bg-[#8a94a3]",
        badgeClass: "bg-[#2b323f] text-[#bcc5d2]",
      };
  }
}

export function buildComparisonSeries(historyByMonitor, selectedMonitorIds, range) {
  if (!selectedMonitorIds || selectedMonitorIds.length === 0) return [];

  const now = Date.now();
  const cutoff = range === "7d" ? now - 7 * 24 * 60 * 60 * 1000 : now - 24 * 60 * 60 * 1000;
  const bucketSizeMs = getComparisonBucketSize(range);

  const bucketMap = new Map();
  for (const monitorId of selectedMonitorIds) {
    const entries = historyByMonitor[monitorId] || [];
    for (const entry of entries) {
      const ts = new Date(entry.timestamp).getTime();
      if (!Number.isFinite(ts) || ts < cutoff) continue;

      const roundedTs = bucketSizeMs > 0 ? Math.floor(ts / bucketSizeMs) * bucketSizeMs : ts;
      const row = bucketMap.get(roundedTs) || { ts: roundedTs };
      row[monitorId] = Number.isFinite(entry.latency) ? entry.latency : null;
      bucketMap.set(roundedTs, row);
    }
  }

  return [...bucketMap.values()].sort((a, b) => a.ts - b.ts);
}

export function getComparisonBucketSize(range) {
  if (range === "7d") return 10 * 60 * 1000;
  return 0;
}

export function buildComparisonDomain(series, selectedMonitorIds) {
  if (!Array.isArray(series) || series.length === 0 || !Array.isArray(selectedMonitorIds) || selectedMonitorIds.length === 0) {
    return [0, 100];
  }

  const values = [];
  for (const row of series) {
    for (const monitorId of selectedMonitorIds) {
      const value = row?.[monitorId];
      if (Number.isFinite(value)) values.push(value);
    }
  }

  if (values.length === 0) return [0, 100];

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) {
    const padding = Math.max(10, Math.round(min * 0.2));
    return [Math.max(0, min - padding), max + padding];
  }

  const spread = max - min;
  const padding = Math.max(10, Math.round(spread * 0.12));
  const lowerBound = Math.max(0, min - padding);
  const upperBound = max + padding;

  return [lowerBound, upperBound];
}

export function formatRangeTick(value, range) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  if (range === "7d") {
    return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}`;
  }
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

export function formatLatencyTick(value) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

export function buildMonitorStatsMap(historyByMonitor) {
  const map = {};

  Object.entries(historyByMonitor || {}).forEach(([monitorId, monitor]) => {
    if (!monitor) return;
    map[monitorId] = {
      uptime24h: Number.isFinite(monitor?.metrics24h?.uptime24h) ? monitor.metrics24h.uptime24h : null,
      avgLatency24h: Number.isFinite(monitor?.metrics24h?.avgLatency24h) ? monitor.metrics24h.avgLatency24h : null,
    };
  });

  return map;
}

export function buildAttentionItems(monitors, monitorStatsMap) {
  return [...monitors]
    .filter((monitor) => monitor.status === "DOWN" || monitor.status === "UP_RESTRICTED")
    .sort((a, b) => severityRank(a.status) - severityRank(b.status))
    .slice(0, 4)
    .map((monitor) => {
      const status = getStatusMeta(monitor.status);
      const stats = monitorStatsMap[monitor.id];
      return {
        id: monitor.id,
        name: monitor.name,
        label: status.label,
        badgeClass: status.badgeClass,
        caption: `${monitor.lastLatency != null ? `${monitor.lastLatency} ms` : "No latency"} | 24h uptime ${stats?.uptime24h ?? "--"}%`,
      };
    });
}

export function buildSlowMonitorBars(monitors, monitorStatsMap) {
  return monitors
    .map((monitor) => ({
      id: monitor.id,
      name: monitor.name,
      avgLatency: monitorStatsMap[monitor.id]?.avgLatency24h ?? null,
    }))
    .filter((item) => Number.isFinite(item.avgLatency))
    .sort((a, b) => b.avgLatency - a.avgLatency)
    .slice(0, 5);
}

export function buildRecentSignals(monitors, range) {
  const cutoff = range === "7d"
    ? Date.now() - 7 * 24 * 60 * 60 * 1000
    : Date.now() - 24 * 60 * 60 * 1000;

  return monitors
    .map((monitor) => {
      const transition = monitor?.lastTransition;
      const ts = new Date(transition?.timestamp).getTime();
      if (!transition || !Number.isFinite(ts) || ts < cutoff) return null;
      const status = getStatusMeta(transition.to);
      return {
        monitorId: monitor.id,
        monitorName: monitor.name,
        timestamp: transition.timestamp,
        timestampLabel: formatTooltipTime(ts, range),
        title: `${transition.to || "UNKNOWN"} from ${transition.from || "UNKNOWN"}`,
        label: status.label,
        badgeClass: status.badgeClass,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);
}

export function severityRank(status) {
  if (status === "DOWN") return 0;
  if (status === "UP_RESTRICTED") return 1;
  return 2;
}

export function formatRelativeTime(value) {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "--";
  const diffMin = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
