import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw,
  Search,
  Bell,
  Settings,
  LayoutGrid,
  AlertTriangle,
  Siren,
  Globe,
  Users,
  ChevronDown,
  Activity,
  TimerReset,
  Plus,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import AddMonitorModal from "../../components/AddMonitorModal";
import PageLoader from "../../components/PageLoader";
import { useAuth } from "../../context/AuthContext";
import {
  fetchMonitorSummary,
  fetchMonitorsStream,
  createMonitor,
  deleteMonitor,
  fetchHistory,
  triggerPingSingle,
  invalidateMonitorSummaryCache,
} from "../../api";
import {
  EmptyState,
  InfraRow,
  InfraRowSkeleton,
  KpiRow,
  LatencyTooltip,
  NavItem,
} from "./DashboardParts";
import {
  MONITOR_COLORS,
  buildAttentionItems,
  buildComparisonDomain,
  buildComparisonSeries,
  buildKpis,
  buildMonitorStatsMap,
  buildRecentSignals,
  buildSlowMonitorBars,
  formatLatencyTick,
  formatRangeTick,
  formatTooltipTime,
  getInitial,
} from "./dashboardUtils";

export default function DashboardPage() {
  const { user, workspace, currentMembershipRole, entitlements } = useAuth();
  const navigate = useNavigate();
  const isTeamWorkspace = workspace?.type === "team";
  const canManageMonitors = currentMembershipRole !== "member";
  // Members (in another owner's workspace) see only the monitor list.
  // Charts, comparisons, slowest-services are owner-only analytics.
  const isMemberView = currentMembershipRole === "member" || isTeamWorkspace;

  // ── Data state ────────────────────────────────────────────────────────────
  const [monitors, setMonitors] = useState([]);
  const [monitorSummary, setMonitorSummary] = useState(null);
  const [history, setHistory] = useState({});

  // ── Loading state — each section independent ──────────────────────────────
  const [summaryLoading, setSummaryLoading] = useState(true);
  // monitorsLoading: true = haven't received first page yet
  const [monitorsLoading, setMonitorsLoading] = useState(true);
  // monitorsStreaming: true = still fetching more pages (after first batch shown)
  const [monitorsStreaming, setMonitorsStreaming] = useState(false);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [pingingAll, setPingingAll] = useState(false);
  const [pingingMonitors, setPingingMonitors] = useState({});
  const [error, setError] = useState("");
  const [upgradeMessage, setUpgradeMessage] = useState("");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("24h");
  const [selectedMonitorIds, setSelectedMonitorIds] = useState([]);
  const [showCompareSelect, setShowCompareSelect] = useState(false);

  // Ref to track if the component is still mounted between async operations
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  // ── Load monitor summary (KPI bar) — fires first, independently ───────────
  const loadMonitorSummary = useCallback(async () => {
    if (!user || !workspace?.id) return;
    setSummaryLoading(true);
    try {
      const summary = await fetchMonitorSummary(user);
      if (!activeRef.current) return;
      setMonitorSummary(summary);
    } catch {
      if (!activeRef.current) return;
      setMonitorSummary(null);
    } finally {
      if (activeRef.current) setSummaryLoading(false);
    }
  }, [user, workspace?.id]);

  // ── Load monitors list — streams page-by-page, showing each batch ─────────
  const loadMonitors = useCallback(async () => {
    if (!user || !workspace?.id) return;
    setMonitorsLoading(true);
    setMonitorsStreaming(false);
    setError("");
    let firstBatch = true;

    try {
      await fetchMonitorsStream(
        user,
        (batch) => {
          if (!activeRef.current) return;
          if (firstBatch) {
            // First batch: replace skeleton with real data
            firstBatch = false;
            setMonitorsLoading(false);
            setMonitorsStreaming(true);
            setMonitors(batch);
          } else {
            // Subsequent batches: append
            setMonitors((prev) => {
              const existingIds = new Set(prev.map((m) => m.id));
              const newItems = batch.filter((m) => !existingIds.has(m.id));
              return newItems.length > 0 ? [...prev, ...newItems] : prev;
            });
          }
          // Clear history for member/team views
          if (isMemberView) setHistory({});
        }
      );
    } catch {
      if (!activeRef.current) return;
      setError("Could not load monitors. Is the Worker running?");
    } finally {
      if (activeRef.current) {
        setMonitorsLoading(false);
        setMonitorsStreaming(false);
      }
    }
  }, [isMemberView, user, workspace?.id]);

  // ── Fire both in parallel — summary paints before monitor list finishes ───
  useEffect(() => {
    if (!user || !workspace?.id) return;
    // Run in parallel — KPI bar is fast (~200ms), monitor list can be slow
    Promise.all([loadMonitorSummary(), loadMonitors()]).catch(() => {});
  }, [user, workspace?.id, loadMonitorSummary, loadMonitors]);

  // ── Lazy history fetch for comparison chart (skip for members) ───────────
  useEffect(() => {
    if (!user || !workspace?.id || isMemberView || selectedMonitorIds.length === 0) return;

    let active = true;
    const missingIds = selectedMonitorIds.filter((id) => !history[id]);
    if (missingIds.length === 0) return undefined;

    (async () => {
      try {
        const entries = await Promise.all(
          missingIds.map((id) =>
            fetchHistory(user, id, 288)
              .then((items) => [id, items])
              .catch(() => [id, []])
          )
        );
        if (!active) return;
        setHistory((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      } catch {
        if (!active) return;
        setError("Could not load chart history for selected monitors.");
      }
    })();

    return () => { active = false; };
  }, [history, isTeamWorkspace, selectedMonitorIds, user, workspace?.id]);

  // ── Ping single monitor ───────────────────────────────────────────────────
  async function handlePingSingle(monitorId) {
    setPingingMonitors((prev) => ({ ...prev, [monitorId]: true }));
    try {
      const { monitor: updated, history: newEntry } = await triggerPingSingle(user, monitorId);
      setMonitors((prev) => prev.map((m) => (m.id === monitorId ? { ...m, ...updated } : m)));
      setHistory((prev) => ({ ...prev, [monitorId]: [newEntry, ...(prev[monitorId] || [])] }));
      // Invalidate summary cache so KPIs refresh on next load
      invalidateMonitorSummaryCache(user.uid);
      loadMonitorSummary();
    } catch {
      setError("Could not ping monitor. Is the Worker running?");
    } finally {
      setPingingMonitors((prev) => ({ ...prev, [monitorId]: false }));
    }
  }

  // ── Ping all monitors ─────────────────────────────────────────────────────
  async function handlePingNow() {
    if (monitors.length === 0) return;
    setPingingAll(true);
    setError("");
    try {
      // Ping concurrently in small batches of 5
      const batchSize = 5;
      for (let i = 0; i < monitors.length; i += batchSize) {
        const chunk = monitors.slice(i, i + batchSize);
        await Promise.all(chunk.map((m) => handlePingSingle(m.id)));
      }
    } catch {
      setError("Ping failed. Is the Worker running?");
    } finally {
      setPingingAll(false);
    }
  }

  // ── Add monitor ───────────────────────────────────────────────────────────
  async function handleAddMonitor(newMonitor) {
    try {
      const saved = await createMonitor(user, newMonitor.name, newMonitor.url);
      setUpgradeMessage("");
      if (!monitors.some((m) => m.id === saved.id)) {
        setMonitors((prev) => [saved, ...prev]);
      }
      invalidateMonitorSummaryCache(user.uid);
      loadMonitorSummary();

      try {
        const { monitor: updated, history: newEntry } = await triggerPingSingle(user, saved.id);
        setMonitors((prev) => prev.map((m) => (m.id === saved.id ? { ...m, ...updated } : m)));
        setHistory((prev) => ({ ...prev, [saved.id]: [newEntry] }));
      } catch {
        // Monitor is created; ping can fail transiently.
      }
    } catch (err) {
      const message = err?.message || "Could not add monitor. Please try again.";
      setError(message);
      if (/upgrade|plan|monitor/i.test(message)) {
        setUpgradeMessage(message);
      }
      throw err;
    }
  }

  // ── Delete monitor ────────────────────────────────────────────────────────
  // NOTE: Confirmation is now handled inside InfraRow's DeleteConfirmCard —
  // no window.confirm here.
  async function handleDelete(id) {
    try {
      await deleteMonitor(user, id);
      setMonitors((prev) => prev.filter((m) => m.id !== id));
      setHistory((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      setSelectedMonitorIds((prev) => prev.filter((item) => item !== id));
      invalidateMonitorSummaryCache(user.uid);
      loadMonitorSummary();
    } catch {
      setError("Could not delete monitor. Please try again.");
    }
  }

  // ── Derived / memo values ─────────────────────────────────────────────────
  const filteredMonitors = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return monitors;
    return monitors.filter(
      (m) => m.name?.toLowerCase().includes(keyword) || m.url?.toLowerCase().includes(keyword)
    );
  }, [monitors, query]);

  const monitorStatsMap = useMemo(() =>
    buildMonitorStatsMap(
      monitors.reduce((acc, m) => { acc[m.id] = m; return acc; }, {})
    ),
    [monitors]
  );

  const kpis = useMemo(
    () => buildKpis(monitors, monitorStatsMap, {
      // Pass summaryLoading so 24h Uptime/AvgResponse shimmer while summary is in-flight.
      // When summary arrives, it's used as the authoritative source.
      // When summary permanently fails, loading=false lets buildKpis fall back to computed values.
      loading: summaryLoading,
      summary: monitorSummary,
    }),
    [summaryLoading, monitorSummary, monitors, monitorStatsMap]
  );

  const comparisonData = useMemo(
    () => buildComparisonSeries(history, selectedMonitorIds, range),
    [history, selectedMonitorIds, range]
  );

  const comparisonDomain = useMemo(
    () => buildComparisonDomain(comparisonData, selectedMonitorIds),
    [comparisonData, selectedMonitorIds]
  );

  const attentionItems = useMemo(
    () => buildAttentionItems(monitors, monitorStatsMap),
    [monitors, monitorStatsMap]
  );

  const recentSignals = useMemo(
    () => buildRecentSignals(monitors, range),
    [monitors, range]
  );

  const barData = useMemo(
    () => buildSlowMonitorBars(monitors, monitorStatsMap),
    [monitors, monitorStatsMap]
  );

  const selectedMonitorMap = useMemo(() => {
    const map = {};
    selectedMonitorIds.forEach((id, idx) => {
      const monitor = monitors.find((m) => m.id === id);
      if (monitor) {
        map[id] = { name: monitor.name, color: MONITOR_COLORS[idx % MONITOR_COLORS.length] };
      }
    });
    return map;
  }, [selectedMonitorIds, monitors]);
  const monitorLimit = Number.isFinite(entitlements?.maxMonitors) ? entitlements.maxMonitors : null;
  const monitorCount = monitorSummary?.totalMonitors ?? monitors.filter((item) => item.type !== "child").length;
  const monitorLimitReached = monitorLimit != null && monitorCount >= monitorLimit;

  // ── Render ─────────────────────────────────────────────────────────────────
  // Show skeleton on cold load (both summary and first monitor batch pending)
  if (summaryLoading && monitorsLoading) return <PageLoader rows={5} />;
  return (
    <div className="min-h-screen text-[#f2f2f2]">
        {/* Header */}
        <header className="h-20 sticky top-0 z-20 border-b border-[#22252b] bg-[#0d0f13] px-5 md:px-8 flex items-center justify-between gap-4 overflow-hidden">
          <div className="min-w-0">
            <h2 className="text-xl md:text-2xl font-semibold tracking-tight">Monitoring Overview</h2>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden lg:flex items-center bg-[#14181e] border border-[#252a33] rounded-lg px-3 h-10 w-72">
              <Search className="w-4 h-4 text-[#6f7785]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search monitors..."
                className="w-full bg-transparent text-sm text-[#dbe1eb] placeholder:text-[#6f7785] px-2 focus:outline-none"
              />
            </div>
          </div>
        </header>

        <div className="px-5 md:px-8 py-6 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/25 text-red-300 rounded-lg p-3 text-sm">
              {error}
            </div>
          )}

          {(upgradeMessage || monitorLimitReached) && (
            <section className="rounded-xl border border-[#2a3341] bg-[#10141b] px-4 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">Monitor limit reached</p>
                <p className="mt-1 text-sm text-[#9fb0c7]">{upgradeMessage || `Your current plan includes up to ${monitorLimit} monitors.`}</p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/plans")}
                className="h-10 px-4 rounded-lg bg-white text-black text-sm font-semibold"
              >
                View Plans
              </button>
            </section>
          )}

          {/* ── KPI Row — loads independently, as fast as the summary endpoint ── */}
          <KpiRow kpis={kpis} loading={summaryLoading && !monitorSummary} />

          {/* ── Charts & attention section (owner view only) ─────────────────── */}
          {!isMemberView ? (
            <>
              <section className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                {/* Response time chart */}
                <div className="xl:col-span-2 bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs uppercase tracking-[0.12em] text-[#8d94a0]">
                      Response Time Trends ({range})
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setRange("24h")}
                        className={`h-9 px-3 rounded-lg text-sm border ${
                          range === "24h"
                            ? "bg-[#d3d6dc] text-[#121417] border-[#d3d6dc]"
                            : "bg-[#14181e] border-[#2a2f39] text-[#d4dae4]"
                        }`}
                      >
                        24h
                      </button>
                      <button
                        type="button"
                        onClick={() => setRange("7d")}
                        className={`h-9 px-3 rounded-lg text-sm border ${
                          range === "7d"
                            ? "bg-[#d3d6dc] text-[#121417] border-[#d3d6dc]"
                            : "bg-[#14181e] border-[#2a2f39] text-[#d4dae4]"
                        }`}
                      >
                        7d
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowCompareSelect((p) => !p)}
                          className="h-9 px-3 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d4dae4] inline-flex items-center gap-2"
                        >
                          Compare
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        {showCompareSelect && (
                          <div className="absolute right-0 mt-2 z-20 w-72 max-h-72 overflow-auto rounded-lg border border-[#2a2f39] bg-[#12161d] p-2 shadow-xl">
                            {monitors.length === 0 ? (
                              <p className="text-sm text-[#8d94a0] p-2">No monitors available</p>
                            ) : (
                              monitors.map((monitor) => {
                                const checked = selectedMonitorIds.includes(monitor.id);
                                return (
                                  <label
                                    key={monitor.id}
                                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#171c25] text-sm cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedMonitorIds((p) => [...p, monitor.id]);
                                        } else {
                                          setSelectedMonitorIds((p) =>
                                            p.filter((id) => id !== monitor.id)
                                          );
                                        }
                                      }}
                                    />
                                    <span className="truncate">{monitor.name}</span>
                                  </label>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="h-64">
                    {selectedMonitorIds.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-[#6f7785] text-sm">
                        Select monitors from Compare to start comparison.
                      </div>
                    ) : comparisonData.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-[#6f7785] text-sm">
                        {selectedMonitorIds.length === 0 
                          ? "Select monitors from the dropdown above to view response time history."
                          : "No data in selected range."}
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={comparisonData}
                          margin={{ top: 8, right: 8, left: -12, bottom: 8 }}
                        >
                          <CartesianGrid stroke="#22252b" strokeDasharray="3 3" />
                          <XAxis
                            dataKey="ts"
                            type="number"
                            domain={["dataMin", "dataMax"]}
                            tickFormatter={(v) => formatRangeTick(v, range)}
                            tick={{ fill: "#7f8793", fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            domain={comparisonDomain}
                            tickFormatter={formatLatencyTick}
                            tick={{ fill: "#7f8793", fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            width={56}
                            tickCount={6}
                            allowDecimals={false}
                          />
                          <Tooltip
                            labelFormatter={(v) => formatTooltipTime(v, range)}
                            contentStyle={{
                              backgroundColor: "#151922",
                              border: "1px solid #2a2f39",
                              borderRadius: 8,
                              color: "#dde3ee",
                              fontSize: 12,
                            }}
                            formatter={(value, name) => {
                              const label = selectedMonitorMap[name]?.name || name;
                              return [value != null ? `${value} ms` : "--", label];
                            }}
                          />
                          <Legend formatter={(v) => selectedMonitorMap[v]?.name || v} />
                          {selectedMonitorIds.map((id, idx) => (
                            <Line
                              key={id}
                              type="monotone"
                              dataKey={id}
                              stroke={
                                selectedMonitorMap[id]?.color ||
                                MONITOR_COLORS[idx % MONITOR_COLORS.length]
                              }
                              strokeWidth={2}
                              dot={false}
                              connectNulls
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Attention required panel */}
                <div className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
                  <div className="space-y-5">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-medium text-[#edf2fb]">Attention Required</h4>
                        <span className="text-xs text-[#7f8793]">{attentionItems.length} monitors</span>
                      </div>
                      {attentionItems.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-[#2b313c] bg-[#11151c] px-4 py-6 text-center text-sm text-[#7f8793]">
                          All monitors look healthy right now.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {attentionItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => navigate(`/monitors/${item.id}`)}
                              className="w-full rounded-lg border border-[#252a33] bg-[#12161d] px-3 py-3 text-left hover:bg-[#171c25] transition"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-[#edf2fb] truncate">{item.name}</p>
                                  <p className="text-xs text-[#7f8793] mt-1">{item.caption}</p>
                                </div>
                                <span className={`text-[11px] px-2 py-1 rounded-full ${item.badgeClass}`}>
                                  {item.label}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* Slowest services + recent signals */}
              <section className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                <div className="xl:col-span-2 bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs uppercase tracking-[0.12em] text-[#8d94a0]">
                        Slowest Services
                      </h3>
                      <p className="text-sm text-[#7f8793] mt-1">
                        Highest average response time over the last 24 hours
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-2 text-xs text-[#7f8793]">
                      <TimerReset className="w-3.5 h-3.5" />
                      Auto-ranked
                    </div>
                  </div>
                  <div className="h-72">
                    {barData.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-[#6f7785] text-sm">
                        No latency data available yet.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={barData}
                          layout="vertical"
                          margin={{ top: 8, right: 24, left: 24, bottom: 8 }}
                        >
                          <CartesianGrid stroke="#22252b" strokeDasharray="3 3" horizontal={false} />
                          <XAxis
                            type="number"
                            tick={{ fill: "#7f8793", fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            tick={{ fill: "#cdd5e0", fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            width={110}
                          />
                          <Tooltip
                            cursor={{ fill: "rgba(255,255,255,0.02)" }}
                            content={<LatencyTooltip />}
                            contentStyle={{
                              backgroundColor: "#151922",
                              border: "1px solid #2a2f39",
                              borderRadius: 8,
                              color: "#dde3ee",
                              fontSize: 12,
                            }}
                          />
                          <Bar dataKey="avgLatency" radius={[0, 6, 6, 0]} fill="#58c7f3" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                <div className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs uppercase tracking-[0.12em] text-[#8d94a0]">
                        Recent Status Changes
                      </h3>
                      <p className="text-sm text-[#7f8793] mt-1">
                        Latest state transitions across the selected time range
                      </p>
                    </div>
                    <Activity className="w-4 h-4 text-[#7f8793]" />
                  </div>
                  {recentSignals.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[#2b313c] bg-[#11151c] px-4 py-8 text-center text-sm text-[#7f8793]">
                      No recent state shifts in this range.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {recentSignals.map((signal) => (
                        <button
                          key={`${signal.monitorId}-${signal.timestamp}`}
                          type="button"
                          onClick={() => navigate(`/monitors/${signal.monitorId}`)}
                          className="w-full rounded-lg border border-[#252a33] bg-[#12161d] p-3 text-left hover:bg-[#171c25] transition"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-[#edf2fb]">{signal.title}</p>
                              <p className="text-xs text-[#7f8793] mt-1">{signal.monitorName}</p>
                              <p className="text-xs text-[#6f7785] mt-2">{signal.timestampLabel}</p>
                            </div>
                            <span
                              className={`text-[11px] px-2 py-1 rounded-full shrink-0 ${signal.badgeClass}`}
                            >
                              {signal.label}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </>
          ) : (
            <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[#36cf9b]" />
                <div>
                  <h3 className="text-sm font-medium text-[#edf2fb]">Shared Workspace View</h3>
                  <p className="text-sm text-[#7f8793] mt-1">
                    You are viewing monitors shared with you in{" "}
                    <span className="text-[#c9d1dd]">{workspace?.name || "this workspace"}</span>.
                    Analytics and comparison charts are available to the workspace owner.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* ── Active Monitors — progressive render ──────────────────────── */}
          <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-xs uppercase tracking-[0.12em] text-[#8d94a0]">Active Monitors</h3>
                {monitorsStreaming && (
                  <span className="text-[11px] text-[#7f8793] animate-pulse">Loading more…</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <p className="hidden lg:block text-xs text-[#7d8594]">
                  Click a monitor to open details page
                </p>
                <button
                  onClick={handlePingNow}
                  disabled={pingingAll || monitorsLoading}
                  className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d4dae4] inline-flex items-center gap-2 disabled:opacity-40"
                >
                  <RefreshCw className={`w-4 h-4 ${pingingAll ? "animate-spin" : ""}`} />
                  {pingingAll ? "Pinging…" : "Ping All"}
                </button>
                <button
                  onClick={() => setShowModal(true)}
                  hidden={!canManageMonitors}
                  disabled={monitorLimitReached}
                  className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#121417] text-sm font-semibold inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {monitorLimitReached ? "Limit Reached" : "Add Monitor"}
                </button>
              </div>
            </div>

            {/* Skeleton placeholders shown until first page arrives */}
            {monitorsLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <InfraRowSkeleton key={i} />
                ))}
              </div>
            ) : filteredMonitors.length === 0 ? (
              <EmptyState onAdd={canManageMonitors ? () => setShowModal(true) : undefined} />
            ) : (
              <div className="space-y-2">
                {filteredMonitors.map((monitor) => (
                  <InfraRow
                    key={monitor.id}
                    monitor={monitor}
                    stats={monitorStatsMap[monitor.id]}
                    onOpen={() => navigate(`/monitors/${monitor.id}`)}
                    onPing={handlePingSingle}
                    onDelete={handleDelete}
                    isBusy={Boolean(pingingMonitors[monitor.id])}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      {showModal && (
        <AddMonitorModal onClose={() => setShowModal(false)} onAdd={handleAddMonitor} />
      )}
    </div>
  );
}
