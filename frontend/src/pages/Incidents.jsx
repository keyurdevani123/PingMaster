import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  Globe,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Siren,
  Users,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  createIncident,
  fetchIncidents,
  fetchMonitors,
  updateIncident,
  updateIncidentStatus,
} from "../api";
import {
  formatDuration,
  formatRelativeTime,
  formatTimestamp,
  getIncidentCauseMeta,
  getIncidentSeverityMeta,
} from "../utils/incidents";

const INCIDENT_FORM_DEFAULTS = {
  monitorId: "",
  severity: "high",
  title: "",
  description: "",
  impactSummary: "",
  rootCause: "",
  nextSteps: "",
};

const RESOLUTION_FORM_DEFAULTS = {
  fixSummary: "",
  resolutionNotes: "",
};

const SEVERITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
const DEFERRED_INCIDENT_MONITOR_LOAD_MS = 900;

export default function Incidents() {
  const { user, logout, currentMembershipRole, workspace } = useAuth();
  const navigate = useNavigate();

  const [monitors, setMonitors] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actioningId, setActioningId] = useState("");
  const [error, setError] = useState("");
  const [monitorsLoading, setMonitorsLoading] = useState(false);
  const deferredLoadRef = useRef(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [monitorFilter, setMonitorFilter] = useState("all");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingIncidentId, setEditingIncidentId] = useState("");
  const [resolvingIncidentId, setResolvingIncidentId] = useState("");

  const [incidentForm, setIncidentForm] = useState(INCIDENT_FORM_DEFAULTS);
  const [resolutionForm, setResolutionForm] = useState(RESOLUTION_FORM_DEFAULTS);
  const isOwner = currentMembershipRole === "owner";

  const clearDeferredMonitorLoad = useCallback(() => {
    if (deferredLoadRef.current) {
      clearTimeout(deferredLoadRef.current);
      deferredLoadRef.current = null;
    }
  }, []);

  const loadMonitorsSection = useCallback(async () => {
    if (!user || !workspace?.id) return;
    setMonitorsLoading(true);
    try {
      const monitorItems = await fetchMonitors(user, { includeChildren: true });
      setMonitors(Array.isArray(monitorItems) ? monitorItems : []);
    } catch {
      // Keep incident list usable even if monitor metadata arrives later.
    } finally {
      setMonitorsLoading(false);
    }
  }, [user, workspace?.id]);

  const scheduleMonitorLoad = useCallback(() => {
    clearDeferredMonitorLoad();
    deferredLoadRef.current = setTimeout(() => {
      loadMonitorsSection();
    }, DEFERRED_INCIDENT_MONITOR_LOAD_MS);
  }, [clearDeferredMonitorLoad, loadMonitorsSection]);

  const loadPage = useCallback(async ({ silent = false } = {}) => {
    if (!user || !workspace?.id) return;
    clearDeferredMonitorLoad();

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const incidentItems = await fetchIncidents(user);
      setIncidents(Array.isArray(incidentItems) ? incidentItems : []);
      scheduleMonitorLoad();
    } catch {
      setError("Could not load incidents.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clearDeferredMonitorLoad, scheduleMonitorLoad, user, workspace?.id]);

  useEffect(() => {
    if (!user || !workspace?.id) return;
    loadPage();
    return () => {
      clearDeferredMonitorLoad();
    };
  }, [user, workspace?.id, loadPage, clearDeferredMonitorLoad]);

  async function ensureMonitorsLoaded() {
    if (monitors.length > 0 || monitorsLoading) return;
    await loadMonitorsSection();
  }

  const monitorMap = useMemo(() => {
    return Object.fromEntries(monitors.map((monitor) => [monitor.id, monitor]));
  }, [monitors]);

  const normalizedIncidents = useMemo(() => {
    const statusRank = { open: 0, acknowledged: 1, resolved: 2 };

    return incidents
      .map((incident, index) => {
        const monitor = incident.monitorId ? monitorMap[incident.monitorId] : null;
        return {
          ...incident,
          incidentCode: incident.code || `INC-${String(index + 1).padStart(4, "0")}`,
          monitorName: monitor?.name || incident.monitorName || "Unknown monitor",
          monitorUrl: monitor?.url || incident.monitorUrl || "",
          durationLabel: formatDuration(incident.startedAt, incident.resolvedAt),
          startedAgoLabel: formatRelativeTime(incident.startedAt),
          causeCode: inferCauseCode(incident),
          sortRank: statusRank[incident.status] ?? 99,
        };
      })
      .sort((a, b) => {
        if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
        return new Date(b.updatedAt || b.startedAt).getTime() - new Date(a.updatedAt || a.startedAt).getTime();
      });
  }, [incidents, monitorMap]);

  const editingIncident = useMemo(() => {
    return normalizedIncidents.find((incident) => incident.id === editingIncidentId) || null;
  }, [normalizedIncidents, editingIncidentId]);

  const resolvingIncident = useMemo(() => {
    return normalizedIncidents.find((incident) => incident.id === resolvingIncidentId) || null;
  }, [normalizedIncidents, resolvingIncidentId]);

  const summary = useMemo(() => {
    return {
      open: normalizedIncidents.filter((incident) => incident.status === "open").length,
      acknowledged: normalizedIncidents.filter((incident) => incident.status === "acknowledged").length,
      resolved: normalizedIncidents.filter((incident) => incident.status === "resolved").length,
      critical: normalizedIncidents.filter((incident) => incident.severity === "critical").length,
    };
  }, [normalizedIncidents]);

  const filteredIncidents = useMemo(() => {
    const loweredQuery = query.trim().toLowerCase();

    return normalizedIncidents.filter((incident) => {
      if (statusFilter !== "all" && incident.status !== statusFilter) return false;
      if (severityFilter !== "all" && incident.severity !== severityFilter) return false;
      if (monitorFilter !== "all" && incident.monitorId !== monitorFilter) return false;

      if (!loweredQuery) return true;

      return [
        incident.incidentCode,
        incident.title,
        incident.description,
        incident.impactSummary,
        incident.rootCause,
        incident.nextSteps,
        incident.fixSummary,
        incident.resolutionNotes,
        incident.monitorName,
        incident.monitorUrl,
        incident.severity,
      ].some((value) => String(value || "").toLowerCase().includes(loweredQuery));
    });
  }, [monitorFilter, normalizedIncidents, query, severityFilter, statusFilter]);

  function resetIncidentForm() {
    setIncidentForm(INCIDENT_FORM_DEFAULTS);
  }

  async function openCreateModal() {
    if (!isOwner) return;
    await ensureMonitorsLoaded();
    resetIncidentForm();
    setEditingIncidentId("");
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    resetIncidentForm();
  }

  async function openEditModal(incident) {
    await ensureMonitorsLoaded();
    setEditingIncidentId(incident.id);
    setIncidentForm({
      monitorId: incident.monitorId || "",
      severity: incident.severity || "high",
      title: incident.title || "",
      description: incident.description || "",
      impactSummary: incident.impactSummary || "",
      rootCause: incident.rootCause || "",
      nextSteps: incident.nextSteps || "",
    });
  }

  function closeEditModal() {
    setEditingIncidentId("");
    resetIncidentForm();
  }

  function openResolveModal(incident) {
    setResolvingIncidentId(incident.id);
    setResolutionForm({
      fixSummary: incident.fixSummary || "",
      resolutionNotes: incident.resolutionNotes || "",
    });
  }

  function closeResolveModal() {
    setResolvingIncidentId("");
    setResolutionForm(RESOLUTION_FORM_DEFAULTS);
  }

  async function handleCreateIncident(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const createdIncident = await createIncident(user, {
        monitorId: incidentForm.monitorId,
        severity: incidentForm.severity,
        title: incidentForm.title.trim(),
        description: incidentForm.description.trim(),
        impactSummary: incidentForm.impactSummary.trim(),
        rootCause: incidentForm.rootCause.trim(),
        nextSteps: incidentForm.nextSteps.trim(),
      });

      setIncidents((prev) => [createdIncident, ...prev]);
      closeCreateModal();
    } catch (err) {
      setError(err?.message || "Could not create incident.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEditIncident(event) {
    event.preventDefault();
    if (!editingIncident) return;

    setSubmitting(true);
    setError("");

    try {
      const updatedIncident = await updateIncident(user, editingIncident.id, {
        fields: {
          severity: incidentForm.severity,
          title: incidentForm.title.trim(),
          description: incidentForm.description.trim(),
          impactSummary: incidentForm.impactSummary.trim(),
          rootCause: incidentForm.rootCause.trim(),
          nextSteps: incidentForm.nextSteps.trim(),
        },
      });

      setIncidents((prev) => prev.map((incident) => (incident.id === editingIncident.id ? updatedIncident : incident)));
      closeEditModal();
    } catch (err) {
      setError(err?.message || "Could not update incident.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolveIncident(event) {
    event.preventDefault();
    if (!resolvingIncident) return;

    setSubmitting(true);
    setError("");

    try {
      const updatedIncident = await updateIncident(user, resolvingIncident.id, {
        action: "resolve",
        fields: {
          fixSummary: resolutionForm.fixSummary.trim(),
          resolutionNotes: resolutionForm.resolutionNotes.trim(),
        },
      });

      setIncidents((prev) => prev.map((incident) => (incident.id === resolvingIncident.id ? updatedIncident : incident)));
      closeResolveModal();
    } catch (err) {
      setError(err?.message || "Could not resolve incident.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleIncidentAction(incidentId, action) {
    setActioningId(incidentId);
    setError("");

    try {
      const updatedIncident = await updateIncidentStatus(user, incidentId, action);
      setIncidents((prev) => prev.map((incident) => (incident.id === incidentId ? updatedIncident : incident)));
    } catch (err) {
      setError(err?.message || "Could not update incident.");
    } finally {
      setActioningId("");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08090b] text-[#f2f2f2] grid place-items-center">
        <p className="text-[#8d94a0]">Loading incidents...</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#08090b] text-[#f2f2f2] flex overflow-hidden">
      <aside className="hidden md:flex w-64 h-screen sticky top-0 overflow-hidden flex-col border-r border-[#22252b] bg-[#0f1114]">
        <div className="px-5 py-6 border-b border-[#22252b]">
          <h1 className="text-xl font-semibold tracking-tight">PingMaster</h1>
          <p className="text-[11px] uppercase tracking-[0.09em] text-[#8d94a0] mt-1">Operational Response</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItem Icon={LayoutGrid} label="Dashboard" onClick={() => navigate("/dashboard")} />
          <NavItem Icon={AlertTriangle} label="Incidents" active />
          <NavItem Icon={Siren} label="Alerts" onClick={() => navigate("/alerts")} />
          <NavItem Icon={Globe} label="Status Page" onClick={() => navigate("/status-pages")} />
          <NavItem Icon={Users} label="Team" onClick={() => navigate("/team")} />
        </nav>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <header className="sticky top-0 z-20 border-b border-[#22252b] bg-[#0d0f13] px-5 md:px-8 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Operational Response</p>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mt-1">Incidents Management</h2>
          </div>
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => loadPage({ silent: true })}
              disabled={refreshing}
              className="h-10 px-3 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              disabled={!isOwner}
              className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {isOwner ? "Create Incident" : "Owner Only"}
            </button>
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
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Manual Incidents</p>
              <p className="text-sm text-[#8d94a0] mt-2 max-w-3xl">
                Create incidents for real customer-facing problems, track the impact, and keep the fix summary in one place for the team.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 bg-[#12161d] border border-[#252a33] rounded-xl p-1 self-start">
              <FilterTab active={statusFilter === "open"} onClick={() => setStatusFilter("open")}>
                Open ({summary.open})
              </FilterTab>
              <FilterTab active={statusFilter === "acknowledged"} onClick={() => setStatusFilter("acknowledged")}>
                Acknowledged ({summary.acknowledged})
              </FilterTab>
              <FilterTab active={statusFilter === "resolved"} onClick={() => setStatusFilter("resolved")}>
                Resolved ({summary.resolved})
              </FilterTab>
              <FilterTab active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
                All ({normalizedIncidents.length})
              </FilterTab>
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-3 text-sm">
              {error}
            </div>
          )}

          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard label="Open" value={summary.open} accent="text-[#f19a89]" />
            <MetricCard label="Acknowledged" value={summary.acknowledged} accent="text-[#f2c55f]" />
            <MetricCard label="Resolved" value={summary.resolved} accent="text-[#69e7ba]" />
            <MetricCard label="Critical" value={summary.critical} accent="text-[#f19a89]" />
          </section>

          <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
            <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_220px_220px] gap-4">
              <div className="flex items-center bg-[#14181e] border border-[#252a33] rounded-lg px-3 h-11">
                <Search className="w-4 h-4 text-[#6f7785]" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search title, incident id, impact, root cause, fix, or monitor"
                  className="w-full bg-transparent text-sm text-[#dbe1eb] placeholder:text-[#6f7785] px-2 focus:outline-none"
                />
              </div>

              <select
                value={severityFilter}
                onChange={(event) => setSeverityFilter(event.target.value)}
                className="h-11 bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 focus:outline-none"
              >
                {SEVERITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                <option value="all">All Severities</option>
              </select>

              <select
                value={monitorFilter}
                onChange={(event) => setMonitorFilter(event.target.value)}
                disabled={monitorsLoading && monitors.length === 0}
                className="h-11 bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 focus:outline-none"
              >
                {monitorsLoading && monitors.length === 0 ? (
                  <option value="all">Loading monitors...</option>
                ) : null}
                {monitors.map((monitor) => (
                  <option key={monitor.id} value={monitor.id}>
                    {monitor.name}
                  </option>
                ))}
                <option value="all">All Monitors</option>
              </select>
            </div>
          </section>

          <section className="space-y-4">
            {filteredIncidents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#313642] bg-[#11151c] py-16 text-center">
                <AlertTriangle className="w-8 h-8 text-[#6f7785] mx-auto mb-3" />
                <h3 className="text-[#e8edf5] font-semibold text-base mb-1">No incidents in this view</h3>
                <p className="text-[#8d94a0] text-sm">
                  Try another severity or monitor filter, or create a new incident for the affected monitor.
                </p>
              </div>
            ) : (
              filteredIncidents.map((incident) => (
                <IncidentCard
                  key={incident.id}
                  incident={incident}
                  isOwner={isOwner}
                  busy={actioningId === incident.id}
                  onAction={handleIncidentAction}
                  onOpenDetails={() => navigate(`/incidents/${incident.id}`)}
                  onOpenEdit={() => openEditModal(incident)}
                  onOpenResolve={() => openResolveModal(incident)}
                  onOpenMonitor={() => navigate(`/monitors/${incident.monitorId}`)}
                />
              ))
            )}
          </section>
        </main>
      </main>

      {showCreateModal && (
        <IncidentFormModal
          title="Create Incident"
          description="Capture the monitor, impact, probable cause, and next operator steps in one clean record."
          form={incidentForm}
          monitors={monitors}
          disableMonitor={false}
          submitting={submitting}
          submitLabel="Create Incident"
          onChange={setIncidentForm}
          onClose={closeCreateModal}
          onSubmit={handleCreateIncident}
        />
      )}

      {editingIncident && (
        <IncidentFormModal
          title={`Edit ${editingIncident.incidentCode}`}
          description="Keep the record current while the issue is open or acknowledged."
          form={incidentForm}
          monitors={monitors}
          disableMonitor
          submitting={submitting}
          submitLabel="Save Changes"
          onChange={setIncidentForm}
          onClose={closeEditModal}
          onSubmit={handleEditIncident}
        />
      )}

      {resolvingIncident && (
        <ResolveIncidentModal
          incident={resolvingIncident}
          form={resolutionForm}
          submitting={submitting}
          onChange={setResolutionForm}
          onClose={closeResolveModal}
          onSubmit={handleResolveIncident}
        />
      )}
    </div>
  );
}

function IncidentCard({
  incident,
  isOwner,
  busy,
  onAction,
  onOpenDetails,
  onOpenEdit,
  onOpenResolve,
  onOpenMonitor,
}) {
  const severity = getIncidentSeverityMeta(incident.severity);
  const cause = getIncidentCauseMeta(incident.causeCode);
  const statusMeta = getStatusMeta(incident.status);
  const canEdit = incident.status === "open" || incident.status === "acknowledged";

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpenDetails}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetails();
        }
      }}
      className="relative overflow-hidden rounded-xl border border-[#262b34] bg-[#12161d] p-5 md:p-6 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#5d7cff]/50"
    >
      <div className={`absolute left-0 top-0 h-full w-1 ${severity.barClass}`} />

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded bg-[#1a1f28] text-[#7f8793]">
              {incident.incidentCode}
            </span>
            <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded ${severity.badgeClass}`}>
              {severity.label}
            </span>
            <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded ${statusMeta.className}`}>
              {statusMeta.label}
            </span>
            <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded ${cause.className}`}>
              {cause.label}
            </span>
            <span className="text-xs text-[#8d94a0]">Started {incident.startedAgoLabel}</span>
          </div>

          <div>
            <h3 className="text-xl font-semibold text-[#edf2fb] break-words">{incident.title}</h3>
            <p className="text-sm text-[#8d94a0] mt-1">
              {incident.monitorName}
              {incident.monitorUrl ? ` • ${incident.monitorUrl}` : ""}
            </p>
          </div>

          {incident.impactSummary && (
            <p className="text-sm text-[#d7dee9]">
              <span className="text-[#8d94a0]">Impact:</span> {incident.impactSummary}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 text-sm text-[#9ca3af]">
            <div className="rounded-lg border border-[#252a33] bg-[#10141b] px-3 py-2">
              Opened: {formatTimestamp(incident.startedAt)}
            </div>
            <div className="rounded-lg border border-[#252a33] bg-[#10141b] px-3 py-2">
              Ack: {incident.acknowledgedAt ? formatTimestamp(incident.acknowledgedAt) : "Pending"}
            </div>
            {incident.resolvedAt && (
              <div className="rounded-lg border border-[#252a33] bg-[#10141b] px-3 py-2">
                Resolved: {formatTimestamp(incident.resolvedAt)}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap lg:flex-col gap-2 shrink-0" onClick={(event) => event.stopPropagation()}>
          {incident.status === "open" && (
            <button
              type="button"
              onClick={() => onAction(incident.id, "acknowledge")}
              disabled={busy}
              className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-[#d4dae4] text-sm disabled:opacity-50"
            >
              Acknowledge
            </button>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={onOpenEdit}
              className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-[#d4dae4] text-sm"
            >
              Edit
            </button>
          )}

          {incident.status !== "resolved" && isOwner && (
            <button
              type="button"
              onClick={onOpenResolve}
              disabled={busy}
              className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "Saving..." : "Resolve"}
            </button>
          )}

          {incident.status === "resolved" && isOwner && (
            <button
              type="button"
              onClick={() => onAction(incident.id, "reopen")}
              disabled={busy}
              className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-[#d4dae4] text-sm disabled:opacity-50"
            >
              Reopen
            </button>
          )}

          <button
            type="button"
            onClick={onOpenMonitor}
            className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-[#d4dae4] text-sm inline-flex items-center gap-2"
          >
            Open Monitor
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

function IncidentFormModal({
  title,
  description,
  form,
  monitors,
  disableMonitor = false,
  submitting,
  submitLabel,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <ModalShell title={title} description={description} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Monitor">
            <select
              value={form.monitorId}
              onChange={(event) => onChange((prev) => ({ ...prev, monitorId: event.target.value }))}
              className="w-full h-11 bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 focus:outline-none"
              disabled={disableMonitor}
              required
            >
              <option value="" disabled>Select a monitor</option>
              {monitors.map((monitor) => (
                <option key={monitor.id} value={monitor.id}>
                  {monitor.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Severity">
            <select
              value={form.severity}
              onChange={(event) => onChange((prev) => ({ ...prev, severity: event.target.value }))}
              className="w-full h-11 bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 focus:outline-none"
            >
              {SEVERITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label="Incident Title">
          <input
            type="text"
            value={form.title}
            onChange={(event) => onChange((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Example: Checkout API failing for production users"
            className="w-full h-11 bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 focus:outline-none"
            required
          />
        </FormField>

        <FormField label="Customer Impact">
          <textarea
            value={form.impactSummary}
            onChange={(event) => onChange((prev) => ({ ...prev, impactSummary: event.target.value }))}
            placeholder="What users are unable to do right now?"
            rows={3}
            className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-y"
          />
        </FormField>

        <FormField label="Details">
          <textarea
            value={form.description}
            onChange={(event) => onChange((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="Add context, affected flows, scope, or observations for the team."
            rows={4}
            className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-y"
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Probable Cause">
            <textarea
              value={form.rootCause}
              onChange={(event) => onChange((prev) => ({ ...prev, rootCause: event.target.value }))}
              placeholder="Bad deploy, upstream issue, DNS problem..."
              rows={3}
              className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-y"
            />
          </FormField>

          <FormField label="Next Steps">
            <textarea
              value={form.nextSteps}
              onChange={(event) => onChange((prev) => ({ ...prev, nextSteps: event.target.value }))}
              placeholder="Rollback build, contact vendor, verify edge config..."
              rows={3}
              className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-y"
            />
          </FormField>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Saving..." : submitLabel}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ResolveIncidentModal({ incident, form, submitting, onChange, onClose, onSubmit }) {
  return (
    <ModalShell
      title={`Resolve ${incident.incidentCode}`}
      description="Before resolving, leave a short fix summary so the team knows exactly what changed."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-xl border border-[#232833] bg-[#10141b] p-4">
          <p className="text-sm text-[#edf2fb] font-medium">{incident.title}</p>
          <p className="text-sm text-[#8d94a0] mt-1">{incident.monitorName}</p>
        </div>

        <FormField label="How Was It Fixed?">
          <textarea
            value={form.fixSummary}
            onChange={(event) => onChange((prev) => ({ ...prev, fixSummary: event.target.value }))}
            placeholder="Example: Rolled back release 2026.03.26 and restarted worker pool."
            rows={4}
            className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-y"
            required
          />
        </FormField>

        <FormField label="Resolution Notes">
          <textarea
            value={form.resolutionNotes}
            onChange={(event) => onChange((prev) => ({ ...prev, resolutionNotes: event.target.value }))}
            placeholder="Optional notes for follow-up checks, learnings, or customer communication."
            rows={3}
            className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-y"
          />
        </FormField>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Resolving..." : "Resolve Incident"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, description, children, onClose, sizeClassName = "max-w-3xl" }) {
  return (
    <div className="fixed inset-0 z-50 bg-[#050608]/80 backdrop-blur-sm px-4 py-6 overflow-y-auto">
      <div className={`mx-auto w-full ${sizeClassName} rounded-2xl border border-[#232833] bg-[#0f1217] shadow-[0_24px_90px_rgba(0,0,0,0.45)]`}>
        <div className="flex items-start justify-between gap-4 px-5 md:px-6 py-5 border-b border-[#232833]">
          <div>
            <h3 className="text-xl font-semibold text-[#edf2fb]">{title}</h3>
            <p className="text-sm text-[#8d94a0] mt-1">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-10 rounded-lg border border-[#252a33] bg-[#14181e] text-[#a7afbd] grid place-items-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 md:px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">{label}</span>
      {children}
    </label>
  );
}

function NavItem(props) {
  const IconComponent = props.Icon;
  const { label, active = false, onClick } = props;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-base transition ${
        active
          ? "bg-[#181c24] text-[#eff3fa]"
          : "text-[#9aa2b1] hover:bg-[#161a21] hover:text-[#e1e7f2]"
      }`}
    >
      <IconComponent className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}

function FilterTab({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm transition ${
        active
          ? "bg-[#1b2028] text-[#edf2fb]"
          : "text-[#8d94a0] hover:text-[#d3dbe7]"
      }`}
    >
      {children}
    </button>
  );
}

function MetricCard({ label, value, accent = "text-[#edf3fb]" }) {
  return (
    <article className="bg-[#0f1217] border border-[#22252b] rounded-xl p-3">
      <p className="text-sm uppercase tracking-[0.09em] text-[#8d94a0]">{label}</p>
      <p className={`text-2xl font-semibold mt-1.5 ${accent}`}>{value}</p>
    </article>
  );
}

function getStatusMeta(status) {
  if (status === "open") {
    return { label: "Open", className: "bg-[#402025] text-[#f6b5a8]" };
  }

  if (status === "acknowledged") {
    return { label: "Acknowledged", className: "bg-[#44351a] text-[#f3d088]" };
  }

  return { label: "Resolved", className: "bg-[#123828] text-[#69e7ba]" };
}

function inferCauseCode(incident) {
  const text = `${incident.rootCause || ""} ${incident.title || ""}`.toLowerCase();

  if (text.includes("timeout")) return "TIMEOUT";
  if (text.includes("network") || text.includes("dns")) return "NETWORK";
  if (text.includes("rate limit") || text.includes("blocked") || text.includes("access")) return "ACCESS_RESTRICTED";
  if (text.includes("server") || text.includes("upstream") || text.includes("deploy")) return "UPSTREAM";

  if (incident.severity === "critical" || incident.severity === "high") {
    return "UPSTREAM";
  }

  return "ACCESS_RESTRICTED";
}
