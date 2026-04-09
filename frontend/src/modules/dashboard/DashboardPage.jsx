import { useMemo, useState, useEffect, useCallback } from "react";
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
import { useAuth } from "../../context/AuthContext";
import {
  fetchMonitors,
  fetchMonitorSummary,
  createMonitor,
  deleteMonitor,
  fetchHistory,
  triggerPingSingle,
} from "../../api";
import { EmptyState, InfraRow, KpiRow, LatencyTooltip, NavItem } from "./DashboardParts";
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
  const { user, logout, workspace } = useAuth();
  const navigate = useNavigate();
  const isTeamWorkspace = workspace?.type === "team";

  const [monitors, setMonitors] = useState([]);
  const [monitorSummary, setMonitorSummary] = useState(null);
  const [history, setHistory] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [pingingAll, setPingingAll] = useState(false);
  const [pingingMonitors, setPingingMonitors] = useState({});
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("24h");
  const [selectedMonitorIds, setSelectedMonitorIds] = useState([]);
  const [showCompareSelect, setShowCompareSelect] = useState(false);

  const loadMonitors = useCallback(async () => {
    if (!user || !workspace?.id) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchMonitors(user);
      setMonitors(data);
      setSelectedMonitorIds((prev) => {
        if (prev.length > 0) return prev;
        return data.slice(0, 3).map((monitor) => monitor.id);
      });

      if (isTeamWorkspace) {
        setHistory({});
      }
    } catch {
      setError("Could not load monitors. Is the Worker running?");
    } finally {
      setLoading(false);
    }
  }, [isTeamWorkspace, user, workspace?.id]);

  const loadMonitorSummary = useCallback(async () => {
    if (!user || !workspace?.id) return;
    setSummaryLoading(true);
    try {
      const summary = await fetchMonitorSummary(user);
      setMonitorSummary(summary);
    } catch {
      setMonitorSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [user, workspace?.id]);

  useEffect(() => {
    if (!user || !workspace?.id) return;
    loadMonitorSummary();
    loadMonitors();
  }, [user, workspace?.id, loadMonitorSummary, loadMonitors]);

  useEffect(() => {
    if (!user || !workspace?.id || isTeamWorkspace || selectedMonitorIds.length === 0) return;

    let active = true;
    const missingIds = selectedMonitorIds.filter((monitorId) => !history[monitorId]);
    if (missingIds.length === 0) return undefined;

    (async () => {
      try {
        const entries = await Promise.all(
          missingIds.map((monitorId) =>
            fetchHistory(user, monitorId, 288)
              .then((items) => [monitorId, items])
              .catch(() => [monitorId, []])
          )
        );
        if (!active) return;
        setHistory((prev) => ({
          ...prev,
          ...Object.fromEntries(entries),
        }));
      } catch {
        if (!active) return;
        setError("Could not load chart history for the selected monitors.");
      }
    })();

    return () => {
      active = false;
    };
  }, [history, isTeamWorkspace, selectedMonitorIds, user, workspace?.id]);

  async function handlePingSingle(monitorId) {
    setPingingMonitors((prev) => ({ ...prev, [monitorId]: true }));
    try {
      const { monitor: updated, history: newEntry } = await triggerPingSingle(user, monitorId);
      setMonitors((prev) => prev.map((item) => (item.id === monitorId ? { ...item, ...updated } : item)));
      setHistory((prev) => ({
        ...prev,
        [monitorId]: [newEntry, ...(prev[monitorId] || [])],
      }));
      loadMonitorSummary();
    } catch {
      setError("Could not ping monitor. Is the Worker running?");
    } finally {
      setPingingMonitors((prev) => ({ ...prev, [monitorId]: false }));
    }
  }

  async function handlePingNow() {
    if (monitors.length === 0) return;
    setPingingAll(true);
    setError("");
    try {
      for (const monitor of monitors) {
        await handlePingSingle(monitor.id);
      }
    } catch {
      setError("Ping failed. Is the Worker running?");
    } finally {
      setPingingAll(false);
    }
  }

  async function handleAddMonitor(newMonitor) {
    try {
      const saved = await createMonitor(user, newMonitor.name, newMonitor.url);
      if (!monitors.some((item) => item.id === saved.id)) {
        setMonitors((prev) => [saved, ...prev]);
      }
      loadMonitorSummary();

      try {
        const { monitor: updated, history: newEntry } = await triggerPingSingle(user, saved.id);
        setMonitors((prev) => prev.map((item) => (item.id === saved.id ? { ...item, ...updated } : item)));
        setHistory((prev) => ({ ...prev, [saved.id]: [newEntry] }));
      } catch {
        // Monitor is created; ping can fail transiently without blocking add.
      }
    } catch (err) {
      const message = err?.message || "Could not add monitor. Please try again.";
      setError(message);
      throw err;
    }
  }

  async function handleAddMany(monitorDrafts) {
    try {
      const saved = await Promise.all(
        monitorDrafts.map((item) => createMonitor(user, item.name, item.url))
      );
      setMonitors((prev) => {
        const existingIds = new Set(prev.map((item) => item.id));
        const uniqueNew = saved.filter((item) => !existingIds.has(item.id));
        return [...uniqueNew.reverse(), ...prev];
      });
    } catch {
      setError("Could not add one or more monitors. Please try again.");
    }
  }

  async function handleDelete(id) {
    const shouldDelete = window.confirm("Delete this monitor?");
    if (!shouldDelete) return;

    try {
      await deleteMonitor(user, id);
      setMonitors((prev) => prev.filter((item) => item.id !== id));
      setHistory((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      setSelectedMonitorIds((prev) => prev.filter((item) => item !== id));
      loadMonitorSummary();
    } catch {
      setError("Could not delete monitor. Please try again.");
    }
  }

  const filteredMonitors = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return monitors;
    return monitors.filter((monitor) =>
      monitor.name?.toLowerCase().includes(keyword) || monitor.url?.toLowerCase().includes(keyword)
    );
  }, [monitors, query]);

  const monitorStatsMap = useMemo(() => buildMonitorStatsMap(monitors.reduce((acc, monitor) => {
    acc[monitor.id] = monitor;
    return acc;
  }, {})), [monitors]);
  const kpis = useMemo(
    () => buildKpis(monitors, monitorStatsMap, { loading: summaryLoading && !monitorSummary, summary: monitorSummary }),
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
  const attentionItems = useMemo(() => buildAttentionItems(monitors, monitorStatsMap), [monitors, monitorStatsMap]);
  const recentSignals = useMemo(() => buildRecentSignals(monitors, range), [monitors, range]);
  const barData = useMemo(() => buildSlowMonitorBars(monitors, monitorStatsMap), [monitors, monitorStatsMap]);

  const selectedMonitorMap = useMemo(() => {
    const map = {};
    selectedMonitorIds.forEach((id, idx) => {
      const monitor = monitors.find((item) => item.id === id);
      if (monitor) {
        map[id] = { name: monitor.name, color: MONITOR_COLORS[idx % MONITOR_COLORS.length] };
      }
    });
    return map;
  }, [selectedMonitorIds, monitors]);

  return (
    <div className="h-screen bg-[#08090b] text-[#f2f2f2] flex overflow-hidden">
      <aside className="hidden md:flex w-64 h-screen sticky top-0 overflow-hidden flex-col border-r border-[#22252b] bg-[#0f1114]">
        <div className="px-5 py-6 border-b border-[#22252b]">
          <h1 className="text-xl font-semibold tracking-tight">PingMaster</h1>
          <p className="text-[11px] uppercase tracking-[0.09em] text-[#8d94a0] mt-1">Web Monitor</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItem Icon={LayoutGrid} label="Dashboard" active />
          <NavItem Icon={AlertTriangle} label="Incidents" onClick={() => navigate("/incidents")} />
          <NavItem Icon={Siren} label="Alerts" onClick={() => navigate("/alerts")} />
          <NavItem Icon={Globe} label="Status Page" onClick={() => navigate("/status-pages")} />
          <NavItem Icon={Users} label="Team" onClick={() => navigate("/team")} />
        </nav>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
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
            <button type="button" className="h-10 w-10 rounded-lg border border-[#252a33] bg-[#14181e] grid place-items-center text-[#a7afbd]">
              <Bell className="w-4 h-4" />
            </button>
            <div className="h-10 w-10 rounded-full bg-[#f0b38e] text-[#302317] text-sm font-semibold grid place-items-center">
              {getInitial(user?.email)}
            </div>
            <button
              type="button"
              className="h-10 px-3 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm inline-flex items-center gap-2"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
            <button
              type="button"
              onClick={logout}
              className="h-10 px-3 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm"
              title="Logout"
            >
              Logout
            </button>
          </div>
        </header>

        <div className="px-5 md:px-8 py-6 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/25 text-red-300 rounded-lg p-3 text-sm">
              {error}
            </div>
          )}

          {!isTeamWorkspace ? (
            <>
              <KpiRow kpis={kpis} />

              <section className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                <div className="xl:col-span-2 bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs uppercase tracking-[0.12em] text-[#8d94a0]">Response Time Trends ({range})</h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setRange("24h")}
                        className={`h-9 px-3 rounded-lg text-sm border ${range === "24h" ? "bg-[#d3d6dc] text-[#121417] border-[#d3d6dc]" : "bg-[#14181e] border-[#2a2f39] text-[#d4dae4]"}`}
                      >
                        24h
                      </button>
                      <button
                        type="button"
                        onClick={() => setRange("7d")}
                        className={`h-9 px-3 rounded-lg text-sm border ${range === "7d" ? "bg-[#d3d6dc] text-[#121417] border-[#d3d6dc]" : "bg-[#14181e] border-[#2a2f39] text-[#d4dae4]"}`}
                      >
                        7d
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowCompareSelect((prev) => !prev)}
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
                                  <label key={monitor.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#171c25] text-sm cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedMonitorIds((prev) => [...prev, monitor.id]);
                                        } else {
                                          setSelectedMonitorIds((prev) => prev.filter((id) => id !== monitor.id));
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
                        No data in selected range.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={comparisonData} margin={{ top: 8, right: 8, left: -12, bottom: 8 }}>
                          <CartesianGrid stroke="#22252b" strokeDasharray="3 3" />
                          <XAxis
                            dataKey="ts"
                            type="number"
                            domain={["dataMin", "dataMax"]}
                            tickFormatter={(value) => formatRangeTick(value, range)}
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
                            labelFormatter={(value) => formatTooltipTime(value, range)}
                            contentStyle={{
                              backgroundColor: "#151922",
                              border: "1px solid #2a2f39",
                              borderRadius: 8,
                              color: "#dde3ee",
                              fontSize: 12,
                            }}
                            formatter={(value, name) => {
                              const monitorLabel = selectedMonitorMap[name]?.name || name;
                              return [value != null ? `${value} ms` : "--", monitorLabel];
                            }}
                          />
                          <Legend formatter={(value) => selectedMonitorMap[value]?.name || value} />
                          {selectedMonitorIds.map((id, idx) => (
                            <Line
                              key={id}
                              type="monotone"
                              dataKey={id}
                              stroke={selectedMonitorMap[id]?.color || MONITOR_COLORS[idx % MONITOR_COLORS.length]}
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
                                <span className={`text-[11px] px-2 py-1 rounded-full ${item.badgeClass}`}>{item.label}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                <div className="xl:col-span-2 bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs uppercase tracking-[0.12em] text-[#8d94a0]">Slowest Services</h3>
                      <p className="text-sm text-[#7f8793] mt-1">Highest average response time over the last 24 hours</p>
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
                        <BarChart data={barData} layout="vertical" margin={{ top: 8, right: 24, left: 24, bottom: 8 }}>
                          <CartesianGrid stroke="#22252b" strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" tick={{ fill: "#7f8793", fontSize: 11 }} tickLine={false} axisLine={false} />
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
                      <h3 className="text-xs uppercase tracking-[0.12em] text-[#8d94a0]">Recent Status Changes</h3>
                      <p className="text-sm text-[#7f8793] mt-1">Latest state transitions across the selected time range</p>
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
                            <span className={`text-[11px] px-2 py-1 rounded-full shrink-0 ${signal.badgeClass}`}>{signal.label}</span>
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
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-[#edf2fb]">Shared Monitors</h3>
                  <p className="text-sm text-[#7f8793] mt-1">
                    This team workspace stays focused on the shared monitor list and their current health details.
                  </p>
                </div>
                <span className="text-xs text-[#8d94a0]">{filteredMonitors.length} monitors</span>
              </div>
            </section>
          )}

          <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs uppercase tracking-[0.12em] text-[#8d94a0]">Active Monitors</h3>
              <div className="flex items-center gap-2">
                <p className="hidden lg:block text-xs text-[#7d8594]">Click a monitor to open details page</p>
                <button
                  onClick={handlePingNow}
                  disabled={pingingAll || loading}
                  className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d4dae4] inline-flex items-center gap-2 disabled:opacity-40"
                >
                  <RefreshCw className={`w-4 h-4 ${pingingAll ? "animate-spin" : ""}`} />
                  {pingingAll ? "Pinging..." : "Ping All"}
                </button>
                <button
                  onClick={() => setShowModal(true)}
                  className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#121417] text-sm font-semibold inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Monitor
                </button>
              </div>
            </div>

            {loading ? (
              <div className="py-16 text-center text-[#6f7785] text-sm">Loading monitors...</div>
            ) : filteredMonitors.length === 0 ? (
              <EmptyState onAdd={() => setShowModal(true)} />
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
      </main>

      {showModal && (
        <AddMonitorModal
          onClose={() => setShowModal(false)}
          onAdd={handleAddMonitor}
          onAddMany={handleAddMany}
        />
      )}
    </div>
  );
}
