import { useCallback, useEffect, useMemo, useState } from "react";
import PageLoader from "../../components/PageLoader";
import {
  RefreshCw,
  LayoutGrid,
  AlertTriangle,
  Siren,
  CalendarClock,
  Globe,
  Users,
  Settings,
  Bell,
  Shield,
  Activity,
  Search,
  Save,
  CheckSquare,
  Square,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
} from "recharts";
import MonitorPsiTab from "../../components/MonitorPsiTab";
import MonitorAiReportTab from "../../components/MonitorAiReportTab";
import { useAuth } from "../../context/AuthContext";
import {
  fetchMonitorWorkspace,
  fetchEndpointSuggestions,
  fetchMonitorAiReport,
  generateMonitorAiReport,
  saveMonitorPsiSummary,
  primeEndpointSuggestions,
  primeMonitorWorkspace,
  triggerPingSingle,
  runPageSpeedAudit,
  createChildMonitors,
  updateMonitorEndpoints,
  fetchMaintenances,
  createMaintenance,
  updateMaintenance,
} from "../../api";
import { buildIncidentTimeline, filterHistoryByRange } from "../../utils/incidents";
import { ActionButton, MetricCard, NavItem, Row, SurfaceStat, TabButton } from "./MonitorDetailsParts";
import {
  RANGE_OPTIONS,
  NETWORK_METRICS_CACHE_TTL_MS,
  buildChangeEvents,
  buildMaintenanceWindows,
  buildStats,
  formatTimestamp,
  formatRangeTick,
  formatTooltipTime,
  getChangeCauseMeta,
  getChangeSeverityMeta,
  getHostname,
  getNetworkMetricsCacheKey,
  getPsiStorageKey,
  getStatusMeta,
  normalizeEndpointCandidate,
  readExpiringCache,
  readUiPreference,
  safePort,
  safeProtocol,
  writeExpiringCache,
  writeUiPreference,
  estimateTlsHandshake,
} from "./monitorDetailsUtils";

export default function MonitorDetailsPage() {
  const { monitorId } = useParams();
  const { user, logout, workspace } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [monitor, setMonitor] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tab, setTab] = useState(() => readUiPreference(monitorId, "tab", "overview"));
  const [range, setRange] = useState(() => readUiPreference(monitorId, "range", "24h"));
  const [pinging, setPinging] = useState(false);

  const [psiStrategy, setPsiStrategy] = useState(() => readUiPreference(monitorId, "psiStrategy", "desktop"));
  const [psiData, setPsiData] = useState(null);
  const [psiLoading, setPsiLoading] = useState(false);
  const [psiError, setPsiError] = useState("");
  const [aiReport, setAiReport] = useState(null);
  const [aiReportLoading, setAiReportLoading] = useState(false);
  const [aiReportError, setAiReportError] = useState("");
  const [aiReportLoaded, setAiReportLoaded] = useState(false);

  const [networkMetrics, setNetworkMetrics] = useState({
    dnsResolutionMs: null,
    tlsHandshakeMs: null,
  });
  const [endpointQuery, setEndpointQuery] = useState("");
  const [allEndpoints, setAllEndpoints] = useState([]);
  const [selectedEndpoints, setSelectedEndpoints] = useState(new Set());
  const [childMonitors, setChildMonitors] = useState([]);
  const [endpointBusy, setEndpointBusy] = useState(false);
  const [endpointSuggestionsLoaded, setEndpointSuggestionsLoaded] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceSubmitting, setMaintenanceSubmitting] = useState(false);
  const [maintenanceItems, setMaintenanceItems] = useState([]);
  const [maintenanceForm, setMaintenanceForm] = useState(() => createMaintenanceDefaults());
  const [editingMaintenanceId, setEditingMaintenanceId] = useState("");
  const [maintenanceError, setMaintenanceError] = useState("");
  const [maintenanceLoaded, setMaintenanceLoaded] = useState(false);

  const isChildMonitor = monitor?.type === "child";
  const fallbackParentId = location.state?.parentId;

  useEffect(() => {
    if (isChildMonitor && (tab === "insights" || tab === "endpoints" || tab === "ai-report")) {
      setTab("overview");
    }
  }, [isChildMonitor, tab]);

  useEffect(() => {
    setMaintenanceLoaded(false);
    setMaintenanceItems([]);
    setAiReport(null);
    setAiReportLoaded(false);
    setAiReportError("");
  }, [monitorId]);

  const loadDetails = useCallback(async ({ silent = false } = {}) => {
    if (!user || !monitorId) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const payload = await fetchMonitorWorkspace(user, monitorId, { historyLimit: 2016, includeChildren: true });
      const found = payload?.monitor;
      if (!found) {
        setError("Monitor not found.");
        setMonitor(null);
        setHistory([]);
        setChildMonitors([]);
        return;
      }

      setMonitor(found);
      setHistory(Array.isArray(payload.history) ? payload.history : []);
      setChildMonitors(Array.isArray(payload.childMonitors) ? payload.childMonitors : []);
      setEndpointSuggestionsLoaded(false);
      setShowSuggestions(false);

      const initialEndpoints = Array.from(
        new Set([found.url, ...(found.endpoints || []), ...((payload.childMonitors || []).map((child) => child.url))].filter(Boolean))
      );
      setSelectedEndpoints(new Set(found.endpoints?.length ? found.endpoints : [found.url]));
      setAllEndpoints(initialEndpoints);
    } catch (err) {
      setError(err?.message || "Could not load monitor details.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [monitorId, user]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    writeUiPreference(monitorId, "tab", tab);
  }, [monitorId, tab]);

  useEffect(() => {
    writeUiPreference(monitorId, "range", range);
  }, [monitorId, range]);

  useEffect(() => {
    writeUiPreference(monitorId, "psiStrategy", psiStrategy);
  }, [monitorId, psiStrategy]);

  const loadNetworkMetrics = useCallback(async (url) => {
    const cacheKey = getNetworkMetricsCacheKey(url);
    const cached = readExpiringCache(cacheKey, NETWORK_METRICS_CACHE_TTL_MS);
    if (cached) {
      setNetworkMetrics(cached);
      return;
    }

    const dnsStart = performance.now();
    const host = getHostname(url);
    if (!host) return;

    let dnsResolutionMs = null;
    try {
      await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`);
      dnsResolutionMs = Math.round(performance.now() - dnsStart);
    } catch {
      dnsResolutionMs = null;
    }

    const tlsHandshakeMs = await estimateTlsHandshake(url);
    const payload = { dnsResolutionMs, tlsHandshakeMs };
    setNetworkMetrics(payload);
    writeExpiringCache(cacheKey, payload);
  }, []);

  useEffect(() => {
    if (!monitor?.url || tab !== "overview") return;
    loadNetworkMetrics(monitor.url);
  }, [loadNetworkMetrics, monitor?.url, tab]);

  useEffect(() => {
    const key = getPsiStorageKey(monitorId, psiStrategy);
    const cached = localStorage.getItem(key);
    if (!cached) {
      setPsiData(null);
      return;
    }

    try {
      const payload = JSON.parse(cached);
      setPsiData(payload);
    } catch {
      setPsiData(null);
    }
  }, [monitorId, psiStrategy]);

  async function handlePing() {
    if (!monitor) return;
    setPinging(true);
    try {
      const { monitor: updated, history: newEntry } = await triggerPingSingle(user, monitor.id);
      const nextMonitor = { ...monitor, ...updated };
      const nextHistory = [newEntry, ...history];
      setMonitor(nextMonitor);
      setHistory(nextHistory);
      primeMonitorWorkspace(user, monitor.id, {
        monitor: nextMonitor,
        history: nextHistory,
        childMonitors,
      });
    } catch {
      setError("Could not ping this monitor.");
    } finally {
      setPinging(false);
    }
  }

  async function handleRunPsi() {
    if (!monitor?.url) return;
    setPsiLoading(true);
    setPsiError("");
    try {
      const payload = await runPageSpeedAudit(monitor.url, psiStrategy);
      setPsiData(payload);
      localStorage.setItem(getPsiStorageKey(monitor.id, psiStrategy), JSON.stringify(payload));
      try {
        await saveMonitorPsiSummary(user, monitor.id, payload, psiStrategy);
      } catch {
        // Keep PSI usable even if summary persistence fails.
      }
    } catch (err) {
      setPsiError(err?.message || "Could not fetch PageSpeed data.");
    } finally {
      setPsiLoading(false);
    }
  }

  const loadAiReport = useCallback(async () => {
    if (!user || !monitor?.id) return;
    setAiReportLoading(true);
    setAiReportError("");
    try {
      const payload = await fetchMonitorAiReport(user, monitor.id);
      setAiReport(payload?.report || null);
      setAiReportLoaded(true);
    } catch (err) {
      setAiReportError(err?.message || "Could not load AI report.");
      setAiReportLoaded(true);
    } finally {
      setAiReportLoading(false);
    }
  }, [monitor?.id, user]);

  async function handleGenerateAiReport() {
    if (!user || !monitor?.id) return;
    setAiReportLoading(true);
    setAiReportError("");
    try {
      const payload = await generateMonitorAiReport(user, monitor.id, {
        psiPayload: psiData || null,
        psiStrategy,
      });
      setAiReport(payload);
      setAiReportLoaded(true);
    } catch (err) {
      setAiReportError(err?.message || "Could not generate AI report.");
    } finally {
      setAiReportLoading(false);
    }
  }

  const loadMonitorMaintenances = useCallback(async () => {
    if (!user || !workspace?.id || !monitor?.id) return;
    setMaintenanceLoading(true);
    setMaintenanceError("");
    try {
      const payload = await fetchMaintenances(user, workspace.id, { monitorId: monitor.id });
      setMaintenanceItems(Array.isArray(payload) ? payload : []);
      setMaintenanceLoaded(true);
    } catch (err) {
      setMaintenanceError(err?.message || "Could not load maintenance windows.");
    } finally {
      setMaintenanceLoading(false);
    }
  }, [monitor?.id, user, workspace?.id]);

  async function openMaintenancePlanner() {
    setMaintenanceOpen(true);
    if (maintenanceItems.length === 0 && !maintenanceLoading) {
      await loadMonitorMaintenances();
    }
  }

  function resetMaintenanceEditor() {
    setMaintenanceForm(createMaintenanceDefaults());
    setEditingMaintenanceId("");
    setMaintenanceError("");
  }

  function startEditingMaintenance(item) {
    setEditingMaintenanceId(item.id);
    setMaintenanceForm({
      title: item.title || "",
      message: item.message || "",
      startsAt: toLocalInputValue(item.startsAt),
      endsAt: toLocalInputValue(item.endsAt),
    });
    setMaintenanceError("");
  }

  async function handleMaintenanceSubmit(event) {
    event.preventDefault();
    if (!user || !workspace?.id || !monitor?.id) return;

    const startsAtTs = new Date(maintenanceForm.startsAt).getTime();
    if (!Number.isFinite(startsAtTs) || startsAtTs <= Date.now()) {
      setMaintenanceError("Maintenance must start in the future.");
      return;
    }

    setMaintenanceSubmitting(true);
    setMaintenanceError("");
    try {
      const payload = {
        title: maintenanceForm.title.trim(),
        message: maintenanceForm.message.trim(),
        startsAt: fromLocalInputValue(maintenanceForm.startsAt),
        endsAt: fromLocalInputValue(maintenanceForm.endsAt),
        monitorIds: [monitor.id],
      };

      if (editingMaintenanceId) {
        await updateMaintenance(user, workspace.id, editingMaintenanceId, payload);
      } else {
        await createMaintenance(user, workspace.id, payload);
      }

      resetMaintenanceEditor();
      await loadMonitorMaintenances();
      await loadDetails({ silent: true });
    } catch (err) {
      setMaintenanceError(err?.message || "Could not save maintenance window.");
    } finally {
      setMaintenanceSubmitting(false);
    }
  }

  async function handleCancelMaintenance(maintenanceId) {
    if (!user || !workspace?.id) return;
    setMaintenanceSubmitting(true);
    setMaintenanceError("");
    try {
      await updateMaintenance(user, workspace.id, maintenanceId, { action: "cancel" });
      if (editingMaintenanceId === maintenanceId) {
        resetMaintenanceEditor();
      }
      await loadMonitorMaintenances();
      await loadDetails({ silent: true });
    } catch (err) {
      setMaintenanceError(err?.message || "Could not cancel maintenance window.");
    } finally {
      setMaintenanceSubmitting(false);
    }
  }

  const refreshEndpointSuggestions = useCallback(async (force = false) => {
    if (!monitor || isChildMonitor) return;
    setEndpointBusy(true);
    setError("");
    try {
      const childUrls = childMonitors.map((child) => child.url).filter(Boolean);
      const merged = await fetchEndpointSuggestions(user, monitor, {
        force,
        seedUrls: childUrls,
      });
      setAllEndpoints(Array.from(new Set(merged)));
      setEndpointSuggestionsLoaded(true);
    } catch {
      setError("Could not refresh endpoint suggestions.");
    } finally {
      setEndpointBusy(false);
    }
  }, [childMonitors, isChildMonitor, monitor, user]);

  async function addSelectedEndpointsAsChildren() {
    if (!monitor || isChildMonitor) return;
    setEndpointBusy(true);
    setError("");
    try {
      const endpoints = Array.from(selectedEndpoints).filter((endpoint) => endpoint !== monitor.url);
      if (endpoints.length === 0) {
        setError("Select at least one endpoint to add as monitor.");
        setEndpointBusy(false);
        return;
      }

      const result = await createChildMonitors(user, monitor.id, endpoints);
      const created = Array.isArray(result?.monitors) ? result.monitors : [];
      const nextChildren = created;
      setChildMonitors(nextChildren);

      const mergedEndpoints = Array.from(new Set([monitor.url, ...(monitor.endpoints || []), ...endpoints]));
      const persisted = await updateMonitorEndpoints(user, monitor.id, mergedEndpoints);
      const updatedMonitor = persisted?.monitor ? { ...monitor, ...persisted.monitor } : { ...monitor, endpoints: mergedEndpoints };
      setMonitor(updatedMonitor);

      const childUrls = nextChildren.map((child) => child.url).filter(Boolean);
      setAllEndpoints((prev) => Array.from(new Set([monitor.url, ...prev, ...mergedEndpoints, ...childUrls])));
      setSelectedEndpoints(new Set(updatedMonitor.endpoints?.length ? updatedMonitor.endpoints : [monitor.url]));
      setShowSuggestions(false);
      primeMonitorWorkspace(user, monitor.id, {
        monitor: updatedMonitor,
        history,
        childMonitors: nextChildren,
      });
      primeEndpointSuggestions(user, monitor.id, Array.from(new Set([monitor.url, ...allEndpoints, ...mergedEndpoints, ...childUrls])));
    } catch {
      setError("Could not add endpoint monitors.");
    } finally {
      setEndpointBusy(false);
    }
  }

  function addEndpointFromInput() {
    const value = normalizeEndpointCandidate(endpointQuery);
    if (!value) {
      if (endpointQuery.trim().length > 0) {
        setError("Enter a valid endpoint URL (http or https).");
      }
      return;
    }

    setError("");
    setAllEndpoints((prev) => Array.from(new Set([...prev, value])));
    setSelectedEndpoints((prev) => {
      const next = new Set(prev);
      next.add(value);
      return next;
    });
    setEndpointQuery("");
  }

  function toggleEndpoint(endpoint) {
    setSelectedEndpoints((prev) => {
      const next = new Set(prev);
      if (next.has(endpoint)) next.delete(endpoint);
      else next.add(endpoint);
      return next;
    });
  }

  const statusMeta = getStatusMeta(monitor?.status);
  const filteredHistory = useMemo(() => filterHistoryByRange(history, range), [history, range]);

  const chartData = useMemo(() => {
    return [...filteredHistory]
      .reverse()
      .map((entry) => ({
        ts: new Date(entry.timestamp).getTime(),
        latency: Number.isFinite(entry.latency) ? entry.latency : null,
      }))
      .filter((item) => Number.isFinite(item.ts));
  }, [filteredHistory]);

  const stats = useMemo(() => buildStats(filteredHistory), [filteredHistory]);
  const maintenanceWindows = useMemo(() => buildMaintenanceWindows(filteredHistory), [filteredHistory]);
  const changeEvents = useMemo(() => buildChangeEvents(filteredHistory), [filteredHistory]);
  const incidentTimeline = useMemo(
    () => buildIncidentTimeline(filteredHistory, { limit: 8 }),
    [filteredHistory]
  );
  const filteredEndpoints = useMemo(() => {
    const q = endpointQuery.trim().toLowerCase();
    if (!q) return allEndpoints;
    return allEndpoints.filter((endpoint) => endpoint.toLowerCase().includes(q));
  }, [allEndpoints, endpointQuery]);
  const endpointCoverage = useMemo(() => ({
    configured: monitor?.endpoints?.length || 1,
    discovered: allEndpoints.length,
    selected: selectedEndpoints.size,
    children: childMonitors.length,
  }), [allEndpoints.length, childMonitors.length, monitor?.endpoints, selectedEndpoints.size]);
  const highlightMetrics = useMemo(() => ([
    { label: "24h Uptime", value: `${stats.uptime}%`, accent: "text-[#36cf9b]" },
    { label: "Avg Response", value: stats.avgLatency != null ? `${stats.avgLatency} ms` : "--", accent: "text-[#edf3fb]" },
    { label: "p95 Response", value: stats.p95 != null ? `${stats.p95} ms` : "--", accent: "text-[#edf3fb]" },
    { label: "Checks", value: `${stats.checks}`, accent: "text-[#edf3fb]" },
  ]), [stats.avgLatency, stats.checks, stats.p95, stats.uptime]);
  const maintenanceSummary = useMemo(() => {
    const active = maintenanceItems.filter((item) => item.computedStatus === "active");
    const scheduled = [...maintenanceItems]
      .filter((item) => item.computedStatus === "scheduled")
      .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
    const completed = [...maintenanceItems]
      .filter((item) => item.computedStatus === "completed")
      .sort((left, right) => new Date(right.endsAt).getTime() - new Date(left.endsAt).getTime());

    return {
      active,
      nextScheduled: scheduled[0] || null,
      lastCompleted: completed[0] || null,
    };
  }, [maintenanceItems]);

  useEffect(() => {
    if (tab !== "endpoints" || !showSuggestions || endpointSuggestionsLoaded || isChildMonitor) return;
    refreshEndpointSuggestions(false);
  }, [endpointSuggestionsLoaded, isChildMonitor, refreshEndpointSuggestions, showSuggestions, tab]);

  useEffect(() => {
    if (tab !== "overview" || isChildMonitor || maintenanceLoaded || maintenanceLoading || !monitor?.id) return undefined;
    const timerId = setTimeout(() => {
      loadMonitorMaintenances();
    }, 900);
    return () => clearTimeout(timerId);
  }, [isChildMonitor, loadMonitorMaintenances, maintenanceLoaded, maintenanceLoading, monitor?.id, tab]);

  // AI Report: NOT auto-loaded. User must click "Generate" manually.
  // loadAiReport() is called from the Generate button inside MonitorAiReportTab.

  if (loading) {
    return (
      <PageLoader />
    );
  }

  if (!monitor) {
    return (
      <PageLoader />
    );
  }

  return (
    <div className="min-h-screen text-[#f2f2f2]">
        <header className="sticky top-0 z-20 border-b border-[#22252b] bg-[#0d0f13] px-5 md:px-8 py-2.5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-semibold leading-tight break-words">{monitor.name}</h1>
              <p className="text-sm text-[#8d94a0] break-all mt-0.5">{monitor.url}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3 pt-1 shrink-0">
            <button type="button" className="h-10 w-10 rounded-lg border border-[#252a33] bg-[#14181e] grid place-items-center text-[#a7afbd]">
              <Bell className="w-4 h-4" />
            </button>
            <button type="button" className="h-10 px-3 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm inline-flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Settings
            </button>
            <button type="button" onClick={logout} className="h-10 px-3 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm">
              Logout
            </button>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-5 md:px-8 py-6 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-3 text-sm">
              {error}
            </div>
          )}

          <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)] gap-5">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm px-2.5 py-1 rounded-full ${statusMeta.badgeClass}`}>{statusMeta.label}</span>
                  <span className="text-sm px-2.5 py-1 rounded-full bg-[#161b23] text-[#c6cfdb] border border-[#252a33]">
                    {isChildMonitor ? "Child Monitor" : "Primary Monitor"}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {highlightMetrics.map((item) => (
                    <MetricCard key={item.label} label={item.label} value={item.value} accent={item.accent} compact />
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <ActionButton onClick={handlePing} disabled={pinging} tone="primary" icon={RefreshCw}>
                    {pinging ? "Pinging..." : "Ping Now"}
                  </ActionButton>
                  {!isChildMonitor ? (
                    <ActionButton onClick={openMaintenancePlanner} icon={CalendarClock}>
                      Plan Maintenance
                    </ActionButton>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <SurfaceStat label="Last Checked" value={monitor.lastChecked ? formatTimestamp(monitor.lastChecked) : "--"} />
                  <SurfaceStat label="Last Response" value={monitor.lastLatency != null ? `${monitor.lastLatency} ms` : "--"} />
                  <SurfaceStat label="Status Code" value={monitor.lastStatusCode ?? "--"} />
                  <SurfaceStat label="Tracked Endpoints" value={`${endpointCoverage.configured}`} />
                </div>
              </div>

              <div className="rounded-xl border border-[#252a33] bg-[#12161d] p-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-[#7f8793]">Monitor Summary</p>
                  {monitor.status === "MAINTENANCE" ? (
                    <span className="text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded-full bg-[#47371a] text-[#f2d28c]">
                      Maintenance Active
                    </span>
                  ) : null}
                </div>

                <div className="space-y-2 text-sm">
                  <Row label="Host" value={getHostname(monitor.url) || "--"} />
                  <Row label="Protocol" value={safeProtocol(monitor.url)} />
                  <Row label="Port" value={safePort(monitor.url)} />
                  <Row label="Child Monitors" value={`${endpointCoverage.children}`} />
                  <Row label="Discovered Endpoints" value={`${endpointCoverage.discovered}`} />
                </div>
              </div>
            </div>
          </section>

          <div className="border-b border-[#232832] flex items-center gap-2">
            <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabButton>
            {!isChildMonitor && <TabButton active={tab === "insights"} onClick={() => setTab("insights")}>PSI</TabButton>}
            {!isChildMonitor && <TabButton active={tab === "ai-report"} onClick={() => setTab("ai-report")}>AI Report</TabButton>}
            {!isChildMonitor && <TabButton active={tab === "endpoints"} onClick={() => setTab("endpoints")}>Endpoints Monitor</TabButton>}
          </div>

          {isChildMonitor || tab === "overview" ? (
            <section className="space-y-5">
              <section className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                <section className="xl:col-span-2 bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-xs uppercase tracking-[0.12em] text-[#8d94a0]">Latency Trend ({range})</h3>
                      <p className="text-sm text-[#7f8793] mt-1">Recent response-time movement for this monitor.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {RANGE_OPTIONS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setRange(value)}
                          className={`h-9 px-3 rounded-lg text-sm border ${
                            range === value
                              ? "bg-[#d3d6dc] text-[#121417] border-[#d3d6dc]"
                              : "bg-[#14181e] border-[#2a2f39] text-[#d4dae4]"
                          }`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="h-72">
                    {chartData.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-[#6f7785] text-sm">No history available for selected range.</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 8, right: 10, left: -8, bottom: 8 }}>
                          <defs>
                            <linearGradient id="detailLatencyFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#25c98f" stopOpacity={0.45} />
                              <stop offset="95%" stopColor="#25c98f" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#22252b" strokeDasharray="3 3" />
                          {maintenanceWindows.map((window, index) => (
                            <ReferenceArea
                              key={`${window.start}-${window.end}-${index}`}
                              x1={window.start}
                              x2={window.end}
                              fill="#f2c55f"
                              fillOpacity={0.12}
                              strokeOpacity={0}
                            />
                          ))}
                          <XAxis
                            dataKey="ts"
                            type="number"
                            domain={["dataMin", "dataMax"]}
                            tickFormatter={(value) => formatRangeTick(value, range)}
                            tick={{ fill: "#7f8793", fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis tick={{ fill: "#7f8793", fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                          <Tooltip
                            labelFormatter={(value) => formatTooltipTime(value, range)}
                            contentStyle={{
                              backgroundColor: "#151922",
                              border: "1px solid #2a2f39",
                              borderRadius: 8,
                              color: "#dde3ee",
                              fontSize: 12,
                            }}
                            formatter={(value) => [`${value} ms`, "Latency"]}
                          />
                          <Area type="monotone" dataKey="latency" stroke="#25c98f" fill="url(#detailLatencyFill)" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  {maintenanceWindows.length > 0 ? (
                    <div className="mt-3 flex items-center gap-2 text-xs text-[#cdbd8b]">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#f2c55f]/70" />
                      Shaded ranges indicate planned maintenance windows.
                    </div>
                  ) : null}
                </section>

                <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Shield className="w-4 h-4 text-[#9ca3af]" />
                    <h3 className="text-sm font-medium">Request Diagnostics</h3>
                  </div>
                  <div className="space-y-2 text-sm">
                    <Row label="Latest Status Code" value={stats.latestStatusCode ?? "--"} />
                    <Row label="Checks in Range" value={`${stats.checks}`} />
                    <Row label="Failures" value={`${stats.downChecks}`} />
                    <Row label="Degraded Checks" value={`${stats.degradedChecks}`} />
                    <Row label="Maintenance Checks" value={`${stats.maintenanceChecks}`} />
                    <Row label="DNS Lookup" value={networkMetrics.dnsResolutionMs != null ? `${networkMetrics.dnsResolutionMs} ms` : "--"} />
                    <Row label="TLS Handshake" value={networkMetrics.tlsHandshakeMs != null ? `${networkMetrics.tlsHandshakeMs} ms` : "--"} />
                    <Row label="Last Check" value={monitor.lastChecked ? formatTimestamp(monitor.lastChecked) : "--"} />
                  </div>
                </section>
              </section>

              <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {!isChildMonitor ? (
                  <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-sm font-medium text-[#edf2fb]">Planned Maintenance</h3>
                        <p className="text-sm text-[#8d94a0] mt-1">Scheduled windows pause pings, suppress alerts, and appear on the latency chart.</p>
                      </div>
                      <ActionButton onClick={openMaintenancePlanner} icon={CalendarClock}>
                        Manage
                      </ActionButton>
                    </div>

                    {maintenanceLoading && !maintenanceLoaded ? (
                      <div className="rounded-lg border border-dashed border-[#2a2f39] bg-[#10141b] px-4 py-8 text-center text-sm text-[#8d94a0]">
                        Loading maintenance schedule...
                      </div>
                    ) : maintenanceSummary.active.length === 0 && !maintenanceSummary.nextScheduled && !maintenanceSummary.lastCompleted ? (
                      <div className="rounded-lg border border-dashed border-[#2a2f39] bg-[#10141b] px-4 py-8 text-center text-sm text-[#8d94a0]">
                        No maintenance window scheduled for this monitor.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3">
                        <SurfaceStat
                          label="Active Window"
                          value={maintenanceSummary.active[0] ? `${maintenanceSummary.active[0].title} until ${formatTimestamp(maintenanceSummary.active[0].endsAt)}` : "--"}
                        />
                        <SurfaceStat
                          label="Next Scheduled"
                          value={maintenanceSummary.nextScheduled ? `${maintenanceSummary.nextScheduled.title} on ${formatTimestamp(maintenanceSummary.nextScheduled.startsAt)}` : "--"}
                        />
                        <SurfaceStat
                          label="Last Completed"
                          value={maintenanceSummary.lastCompleted ? `${maintenanceSummary.lastCompleted.title} ended ${formatTimestamp(maintenanceSummary.lastCompleted.endsAt)}` : "--"}
                        />
                      </div>
                    )}
                  </section>
                ) : null}

                <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-4 h-4 text-[#9ca3af]" />
                    <h3 className="text-sm font-medium">What Changed Detection</h3>
                  </div>

                  {changeEvents.length === 0 ? (
                    <p className="text-sm text-[#8d94a0]">No meaningful changes detected in selected range.</p>
                  ) : (
                    <div className="space-y-2">
                      {changeEvents.map((event, index) => {
                        const severity = getChangeSeverityMeta(event.severity);
                        const cause = getChangeCauseMeta(event.causeCode);
                        return (
                          <div
                            key={`${event.timestamp}-${index}`}
                            className="rounded-lg border border-[#2a2f39] bg-[#12161d] p-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm text-[#e6ecf8]">{event.title}</p>
                              <div className="flex items-center gap-2">
                                <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full ${cause.className}`}>
                                  {cause.label}
                                </span>
                                <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full ${severity.className}`}>
                                  {severity.label}
                                </span>
                              </div>
                            </div>
                            <p className="text-xs text-[#9ca3af] mt-1">{event.detail}</p>
                            <p className="text-[11px] text-[#7f8793] mt-1">{formatTimestamp(event.timestamp)}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-4 h-4 text-[#9ca3af]" />
                    <h3 className="text-sm font-medium">Incident Timeline</h3>
                  </div>
                  {incidentTimeline.length === 0 ? (
                    <p className="text-sm text-[#8d94a0]">No incidents found in selected range.</p>
                  ) : (
                    <div className="space-y-2">
                      {incidentTimeline.map((incident, index) => (
                        <div key={`${incident.start}-${index}`} className="rounded-lg border border-[#2a2f39] bg-[#12161d] p-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className={incident.status === "DOWN" ? "text-[#f19a89]" : "text-[#f2c55f]"}>{incident.status}</span>
                            <span className="text-[#8d94a0]">{incident.durationLabel}</span>
                          </div>
                          <p className="text-[#9ca3af] text-xs mt-1">
                            {formatTimestamp(incident.start)} - {incident.end ? formatTimestamp(incident.end) : "ongoing"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </section>

              {/* {!isChildMonitor && (
                <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-sm font-medium">Endpoint Coverage</h3>
                      <p className="text-sm text-[#8d94a0] mt-1">Track discovered routes here, then open the endpoints tab for full management.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab("endpoints")}
                      className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]"
                    >
                      Open Endpoints Tab
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard label="Tracked" value={`${endpointCoverage.configured}`} compact />
                    <MetricCard label="Discovered" value={`${endpointCoverage.discovered}`} compact />
                    <MetricCard label="Selected" value={`${endpointCoverage.selected}`} compact />
                    <MetricCard label="Child Monitors" value={`${endpointCoverage.children}`} compact />
                  </div>
                </section>
              )} */}
            </section>
          ) : tab === "insights" ? (
            <MonitorPsiTab
              monitorName={monitor.name}
              monitorUrl={monitor.url}
              psiEligible={monitor.psiEligible}
              psiReason={monitor.psiReason}
              psiData={psiData}
              psiStrategy={psiStrategy}
              psiLoading={psiLoading}
              psiError={psiError}
              onStrategyChange={setPsiStrategy}
              onRunAudit={handleRunPsi}
            />
          ) : tab === "ai-report" ? (
            <MonitorAiReportTab
              monitor={monitor}
              reportPayload={aiReport}
              loading={aiReportLoading}
              error={aiReportError}
              onGenerate={handleGenerateAiReport}
            />
          ) : (
            <section className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Tracked Endpoints" value={`${endpointCoverage.configured}`} compact />
                <MetricCard label="Discovered" value={`${endpointCoverage.discovered}`} compact />
                <MetricCard label="Selected" value={`${endpointCoverage.selected}`} compact />
                <MetricCard label="Child Monitors" value={`${endpointCoverage.children}`} compact />
              </div>

              <div className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium">Endpoint Coverage</h3>
                    <p className="text-sm text-[#8d94a0] mt-1">Discover URLs, keep important routes selected, and promote the ones that deserve their own monitor.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowSuggestions((prev) => !prev)}
                      className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]"
                    >
                      {showSuggestions ? "Hide Suggestions" : "Suggestions"}
                    </button>
                    <button
                      type="button"
                      onClick={() => refreshEndpointSuggestions(true)}
                      disabled={endpointBusy}
                      className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea] disabled:opacity-50"
                    >
                      Refresh Discovery
                    </button>
                    <button
                      type="button"
                      onClick={addSelectedEndpointsAsChildren}
                      disabled={endpointBusy}
                      className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      Add as Monitors
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-[#14181e] border border-[#252a33] rounded-lg px-3 h-10 flex-1">
                    <Search className="w-4 h-4 text-[#6f7785]" />
                    <input
                      type="text"
                      value={endpointQuery}
                      onChange={(e) => setEndpointQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addEndpointFromInput();
                        }
                      }}
                      placeholder="Search suggestions or add endpoint URL"
                      className="w-full bg-transparent text-sm text-[#dbe1eb] placeholder:text-[#6f7785] px-2 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addEndpointFromInput}
                    className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]"
                  >
                    Add
                  </button>
                </div>

                <p className="hidden">
                  Selected: {selectedEndpoints.size} â€¢ Suggestions: {allEndpoints.length}
                </p>

                <div className="rounded-lg border border-[#252a33] bg-[#12161d] px-3 py-2.5 text-sm text-[#8d94a0] flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>Selected: {selectedEndpoints.size}</span>
                  <span>Discovered: {allEndpoints.length}</span>
                  <span>Tracked on monitor: {monitor.endpoints?.length || 1}</span>
                </div>

                {showSuggestions && (
                  <div className="space-y-2 max-h-[55vh] overflow-auto pr-1">
                    {filteredEndpoints.map((endpoint) => {
                      const checked = selectedEndpoints.has(endpoint);
                      return (
                        <button
                          key={endpoint}
                          type="button"
                          onClick={() => toggleEndpoint(endpoint)}
                          className="w-full text-left rounded-lg border border-[#2a2f39] bg-[#12161d] p-3 flex items-center gap-3 hover:bg-[#171c25] transition"
                        >
                          {checked ? <CheckSquare className="w-4 h-4 text-[#35cf99]" /> : <Square className="w-4 h-4 text-[#8892a0]" />}
                          <span className="text-sm text-[#dbe2ee] break-all">{endpoint}</span>
                        </button>
                      );
                    })}
                    {filteredEndpoints.length === 0 && (
                      <p className="text-sm text-[#8d94a0]">No endpoints found for current filter.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5 space-y-3">
                <div>
                  <h3 className="text-sm font-medium">Child Monitors</h3>
                  <p className="text-sm text-[#8d94a0] mt-1">These endpoints already have independent status, latency, and incident history.</p>
                </div>
                {childMonitors.length === 0 ? (
                  <p className="text-sm text-[#8d94a0]">No child monitors yet. Add endpoints as monitors to track them independently.</p>
                ) : (
                  <div className="space-y-2">
                    {childMonitors.map((child) => {
                      const childStatus = getStatusMeta(child.status);
                      return (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => navigate(`/monitors/${child.id}`, { state: { parentId: monitor.id } })}
                          className="w-full text-left rounded-lg border border-[#2a2f39] bg-[#12161d] p-3 hover:bg-[#171c25] transition"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-base text-[#e8edf7] font-medium truncate">{child.name}</p>
                              <p className="text-xs text-[#8d94a0] truncate">{child.url}</p>
                              <p className="text-xs text-[#708090] mt-1">
                                Status Code: {child.lastStatusCode ?? "--"} â€¢ Last Check: {child.lastChecked ? formatTimestamp(child.lastChecked) : "--"}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${childStatus.badgeClass}`}>{childStatus.label}</span>
                              <p className="text-sm text-[#dbe2ee] mt-1">{child.lastLatency != null ? `${child.lastLatency} ms` : "--"}</p>
                              <p className="text-xs text-[#9ca3af] mt-1">Endpoints: {child.endpoints?.length || 1}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

      {maintenanceOpen ? (
        <MaintenancePlannerModal
          monitor={monitor}
          maintenances={maintenanceItems}
          loading={maintenanceLoading}
          submitting={maintenanceSubmitting}
          error={maintenanceError}
          form={maintenanceForm}
          editingMaintenanceId={editingMaintenanceId}
          onClose={() => {
            setMaintenanceOpen(false);
            resetMaintenanceEditor();
          }}
          onRefresh={loadMonitorMaintenances}
          onFormChange={(field, value) => setMaintenanceForm((prev) => ({ ...prev, [field]: value }))}
          onSubmit={handleMaintenanceSubmit}
          onEdit={startEditingMaintenance}
          onCancelMaintenance={handleCancelMaintenance}
          onReset={resetMaintenanceEditor}
        />
      ) : null}
      </main>
    </div>
  );
}

function MaintenancePlannerModal(props) {
  const {
    monitor,
    maintenances,
    loading,
    submitting,
    error,
    form,
    editingMaintenanceId,
    onClose,
    onRefresh,
    onFormChange,
    onSubmit,
    onEdit,
    onCancelMaintenance,
    onReset,
  } = props;

  return (
    <div className="fixed inset-0 z-40 bg-[#050608]/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl rounded-2xl border border-[#252a33] bg-[#0f1217] shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-[#22252b] px-5 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Maintenance Planner</p>
            <h3 className="text-lg font-semibold text-[#edf2fb] mt-1">{monitor?.name || "Monitor"}</h3>
            <p className="text-sm text-[#8d94a0] mt-1 break-all">{monitor?.url || "--"}</p>
          </div>
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-lg border border-[#2a2f39] text-sm text-[#d4dae4]">
            Close
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-5 p-5">
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Scheduled Windows</p>
                <p className="text-sm text-[#8d94a0] mt-1">During maintenance, PingMaster pauses pings and suppresses alerts for this monitor.</p>
              </div>
              <ActionButton onClick={onRefresh} disabled={loading} icon={RefreshCw}>
                {loading ? "Refreshing..." : "Refresh"}
              </ActionButton>
            </div>

            {loading ? (
              <div className="rounded-xl border border-[#252a33] bg-[#12161d] px-4 py-10 text-center text-sm text-[#8d94a0]">
                Loading maintenance windows...
              </div>
            ) : maintenances.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#2a2f39] bg-[#10141b] px-4 py-10 text-center text-sm text-[#8d94a0]">
                No maintenance window is scheduled for this monitor yet.
              </div>
            ) : (
              <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
                {maintenances.map((item) => {
                  const meta = getMaintenanceMeta(item.computedStatus);
                  return (
                    <article key={item.id} className="rounded-xl border border-[#252a33] bg-[#12161d] p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-[#edf2fb]">{item.title || "Maintenance Window"}</p>
                            <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full ${meta.className}`}>
                              {meta.label}
                            </span>
                          </div>
                          {item.message ? <p className="text-sm text-[#9ca3af] mt-2">{item.message}</p> : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {item.computedStatus !== "cancelled" ? (
                            <button
                              type="button"
                              onClick={() => onEdit(item)}
                              className="text-xs text-[#d4dae4] px-2.5 py-1.5 rounded-lg border border-[#2a2f39]"
                            >
                              Edit
                            </button>
                          ) : null}
                          {item.computedStatus === "scheduled" || item.computedStatus === "active" ? (
                            <button
                              type="button"
                              onClick={() => onCancelMaintenance(item.id)}
                              className="text-xs text-[#f2b7ac] px-2.5 py-1.5 rounded-lg border border-[#4a2a2f]"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <SurfaceStat label="Starts" value={formatTimestamp(item.startsAt)} />
                        <SurfaceStat label="Ends" value={formatTimestamp(item.endsAt)} />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <form onSubmit={onSubmit} className="rounded-xl border border-[#252a33] bg-[#12161d] p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Window Editor</p>
                <h4 className="text-base font-medium text-[#edf2fb] mt-1">
                  {editingMaintenanceId ? "Edit maintenance window" : "Schedule maintenance"}
                </h4>
              </div>
              {editingMaintenanceId ? (
                <button
                  type="button"
                  onClick={onReset}
                  className="h-8 px-3 rounded-lg border border-[#2a2f39] text-xs text-[#d4dae4]"
                >
                  New Window
                </button>
              ) : null}
            </div>

            <ModalField label="Title">
              <input
                required
                value={form.title}
                onChange={(event) => onFormChange("title", event.target.value)}
                placeholder="API maintenance"
                className="w-full rounded-lg border border-[#2a2f39] bg-[#10141b] px-3 py-2.5 text-sm outline-none"
              />
            </ModalField>

            <ModalField label="Message">
              <textarea
                rows={3}
                value={form.message}
                onChange={(event) => onFormChange("message", event.target.value)}
                placeholder="Expected impact during this window"
                className="w-full rounded-lg border border-[#2a2f39] bg-[#10141b] px-3 py-2.5 text-sm outline-none resize-none"
              />
            </ModalField>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ModalField label="Starts At">
                <input
                  required
                  type="datetime-local"
                  min={getFutureDateTimeInputMin()}
                  value={form.startsAt}
                  onChange={(event) => onFormChange("startsAt", event.target.value)}
                  className="w-full rounded-lg border border-[#2a2f39] bg-[#10141b] px-3 py-2.5 text-sm outline-none"
                />
              </ModalField>
              <ModalField label="Ends At">
                <input
                  required
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(event) => onFormChange("endsAt", event.target.value)}
                  className="w-full rounded-lg border border-[#2a2f39] bg-[#10141b] px-3 py-2.5 text-sm outline-none"
                />
              </ModalField>
            </div>

            {error ? <p className="text-sm text-[#f0a496]">{error}</p> : null}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-3 rounded-lg border border-[#2a2f39] text-sm text-[#d4dae4]"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="h-9 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold disabled:opacity-50"
              >
                {submitting ? "Saving..." : editingMaintenanceId ? "Save Maintenance" : "Schedule Maintenance"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ModalField({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function getMaintenanceMeta(status) {
  if (status === "active") return { label: "Active", className: "bg-[#47371a] text-[#f2d28c]" };
  if (status === "scheduled") return { label: "Scheduled", className: "bg-[#1b2330] text-[#b8c8de]" };
  if (status === "completed") return { label: "Completed", className: "bg-[#123828] text-[#69e7ba]" };
  return { label: "Cancelled", className: "bg-[#402025] text-[#f6b5a8]" };
}

function createMaintenanceDefaults() {
  return {
    title: "",
    message: "",
    startsAt: "",
    endsAt: "",
  };
}

function toLocalInputValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function getFutureDateTimeInputMin() {
  const date = new Date(Date.now() + 60 * 1000);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

