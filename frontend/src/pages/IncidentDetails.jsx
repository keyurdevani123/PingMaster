import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  Globe,
  LayoutGrid,
  RefreshCw,
  Settings,
  Siren,
  Users,
  X,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  addIncidentUpdate,
  fetchIncident,
  updateIncident,
  updateIncidentStatus,
} from "../api";
import {
  formatDuration,
  formatTimestamp,
  getIncidentCauseMeta,
  getIncidentSeverityMeta,
} from "../utils/incidents";

const INCIDENT_FORM_DEFAULTS = {
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

const UPDATE_FORM_DEFAULTS = {
  title: "",
  message: "",
};

const SEVERITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export default function IncidentDetails() {
  const { user, logout, currentMembershipRole, workspace } = useAuth();
  const navigate = useNavigate();
  const { incidentId } = useParams();

  const [incident, setIncident] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [error, setError] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [incidentForm, setIncidentForm] = useState(INCIDENT_FORM_DEFAULTS);
  const [resolutionForm, setResolutionForm] = useState(RESOLUTION_FORM_DEFAULTS);
  const [updateForm, setUpdateForm] = useState(UPDATE_FORM_DEFAULTS);
  const isOwner = currentMembershipRole === "owner";

  const loadIncident = useCallback(async ({ silent = false } = {}) => {
    if (!user || !workspace?.id || !incidentId) return;

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const item = await fetchIncident(user, incidentId);
      setIncident(item);
    } catch (err) {
      setError(err?.message || "Could not load incident.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [incidentId, user, workspace?.id]);

  useEffect(() => {
    loadIncident();
  }, [loadIncident]);

  const normalizedIncident = useMemo(() => {
    if (!incident) return null;
    return {
      ...incident,
      durationLabel: formatDuration(incident.startedAt, incident.resolvedAt),
      causeCode: inferCauseCode(incident),
      updates: [...(incident.updates || [])].reverse(),
    };
  }, [incident]);

  function openEditModal() {
    if (!normalizedIncident) return;
    setIncidentForm({
      severity: normalizedIncident.severity || "high",
      title: normalizedIncident.title || "",
      description: normalizedIncident.description || "",
      impactSummary: normalizedIncident.impactSummary || "",
      rootCause: normalizedIncident.rootCause || "",
      nextSteps: normalizedIncident.nextSteps || "",
    });
    setShowEditModal(true);
  }

  function openResolveModal() {
    if (!isOwner) return;
    if (!normalizedIncident) return;
    setResolutionForm({
      fixSummary: normalizedIncident.fixSummary || "",
      resolutionNotes: normalizedIncident.resolutionNotes || "",
    });
    setShowResolveModal(true);
  }

  function openUpdateModal() {
    setUpdateForm(UPDATE_FORM_DEFAULTS);
    setShowUpdateModal(true);
  }

  async function handleIncidentAction(action) {
    if (!normalizedIncident) return;
    setActioning(true);
    setError("");

    try {
      await updateIncidentStatus(user, normalizedIncident.id, action);
      await loadIncident({ silent: true });
    } catch (err) {
      setError(err?.message || "Could not update incident.");
    } finally {
      setActioning(false);
    }
  }

  async function handleEditIncident(event) {
    event.preventDefault();
    if (!normalizedIncident) return;

    setSubmitting(true);
    setError("");

    try {
      await updateIncident(user, normalizedIncident.id, {
        fields: {
          severity: incidentForm.severity,
          title: incidentForm.title.trim(),
          description: incidentForm.description.trim(),
          impactSummary: incidentForm.impactSummary.trim(),
          rootCause: incidentForm.rootCause.trim(),
          nextSteps: incidentForm.nextSteps.trim(),
        },
      });
      setShowEditModal(false);
      await loadIncident({ silent: true });
    } catch (err) {
      setError(err?.message || "Could not update incident.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolveIncident(event) {
    event.preventDefault();
    if (!normalizedIncident) return;

    setSubmitting(true);
    setError("");

    try {
      await updateIncident(user, normalizedIncident.id, {
        action: "resolve",
        fields: {
          fixSummary: resolutionForm.fixSummary.trim(),
          resolutionNotes: resolutionForm.resolutionNotes.trim(),
        },
      });
      setShowResolveModal(false);
      await loadIncident({ silent: true });
    } catch (err) {
      setError(err?.message || "Could not resolve incident.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddIncidentUpdate(event) {
    event.preventDefault();
    if (!normalizedIncident) return;

    setSubmitting(true);
    setError("");

    try {
      await addIncidentUpdate(user, normalizedIncident.id, {
        title: updateForm.title.trim(),
        message: updateForm.message.trim(),
      });
      setUpdateForm(UPDATE_FORM_DEFAULTS);
      await loadIncident({ silent: true });
      return true;
    } catch (err) {
      setError(err?.message || "Could not save timeline update.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08090b] text-[#f2f2f2] grid place-items-center">
        <p className="text-[#8d94a0]">Loading incident...</p>
      </div>
    );
  }

  if (!normalizedIncident) {
    return (
      <div className="min-h-screen bg-[#08090b] text-[#f2f2f2] grid place-items-center px-6">
        <div className="text-center">
          <p className="text-lg font-semibold text-[#edf2fb]">Incident not found</p>
          <button
            type="button"
            onClick={() => navigate("/incidents")}
            className="mt-4 h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold"
          >
            Open Incidents
          </button>
        </div>
      </div>
    );
  }

  const severity = getIncidentSeverityMeta(normalizedIncident.severity);
  const cause = getIncidentCauseMeta(normalizedIncident.causeCode);
  const statusMeta = getStatusMeta(normalizedIncident.status);
  const canEdit = normalizedIncident.status === "open" || normalizedIncident.status === "acknowledged";

  return (
    <div className="h-screen bg-[#08090b] text-[#f2f2f2] flex overflow-hidden">
      <aside className="hidden md:flex w-64 h-screen sticky top-0 overflow-hidden flex-col border-r border-[#22252b] bg-[#0f1114]">
        <div className="px-5 py-6 border-b border-[#22252b]">
          <h1 className="text-xl font-semibold tracking-tight">PingMaster</h1>
          <p className="text-[11px] uppercase tracking-[0.09em] text-[#8d94a0] mt-1">Operational Response</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItem Icon={LayoutGrid} label="Dashboard" onClick={() => navigate("/dashboard")} />
          <NavItem Icon={AlertTriangle} label="Incidents" active onClick={() => navigate("/incidents")} />
          <NavItem Icon={Siren} label="Alerts" onClick={() => navigate("/alerts")} />
          <NavItem Icon={Globe} label="Status Page" onClick={() => navigate("/status-pages")} />
          <NavItem Icon={Users} label="Team" onClick={() => navigate("/team")} />
        </nav>
      </aside>

      <main className="flex-1 min-w-0 overflow-hidden">
        <header className="sticky top-0 z-20 border-b border-[#22252b] bg-[#0d0f13] px-5 md:px-8 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Incident Workspace</p>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">{normalizedIncident.title}</h2>
              {refreshing && (
                <span className="inline-flex items-center gap-2 rounded-full border border-[#2b3340] bg-[#14181e] px-3 py-1 text-xs text-[#b8c3d4]">
                  <span className="h-2 w-2 rounded-full bg-[#7ea2ff] animate-pulse" />
                  Syncing
                </span>
              )}
            </div>
            <p className="text-sm text-[#8d94a0] mt-1">{normalizedIncident.incidentCode}</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => loadIncident({ silent: true })}
              disabled={refreshing}
              className="h-10 px-3 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing..." : "Refresh"}
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

        <main className="px-4 md:px-5 py-4 h-[calc(100vh-73px)] flex flex-col gap-4">
          {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-3 text-sm shrink-0">{error}</div>}

          <div className={`grid grid-cols-1 xl:grid-cols-2 gap-4 min-h-0 flex-1 transition-opacity duration-200 ${refreshing ? "opacity-90" : "opacity-100"}`}>
            <article className="incident-pane-scroll rounded-2xl border border-[#262b34] bg-[radial-gradient(circle_at_top_left,_rgba(77,98,255,0.14),_transparent_32%),linear-gradient(180deg,_#151922_0%,_#12161d_35%,_#12161d_100%)] shadow-[0_18px_60px_rgba(0,0,0,0.24)] min-h-0 overflow-y-auto">
              {refreshing && <div className="incident-refresh-bar" />}
              <div className="sticky top-0 z-10 bg-[linear-gradient(180deg,rgba(18,22,29,0.98)_0%,rgba(18,22,29,0.94)_85%,rgba(18,22,29,0.88)_100%)] backdrop-blur-sm px-5 md:px-6 pt-5 md:pt-6 pb-5 border-b border-[#232833]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded bg-[#1a1f28] text-[#7f8793]">
                    {normalizedIncident.incidentCode}
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
                </div>

                <div className="mt-5 space-y-1">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Affected Monitor</p>
                  <p className="text-xl font-semibold text-[#edf2fb] leading-tight">{normalizedIncident.monitorName}</p>
                  <p className="text-sm text-[#b8c0ce] mt-1 break-all">{normalizedIncident.monitorUrl || "--"}</p>
                </div>

                <div className="flex flex-wrap gap-2 mt-5">
                  {normalizedIncident.status === "open" && (
                    <button
                      type="button"
                      onClick={() => handleIncidentAction("acknowledge")}
                      disabled={actioning}
                      className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-[#d4dae4] text-sm disabled:opacity-50"
                    >
                      Acknowledge
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={openEditModal}
                      className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-[#d4dae4] text-sm"
                    >
                      Edit
                    </button>
                  )}
                  {normalizedIncident.status !== "resolved" && isOwner ? (
                    <button
                      type="button"
                      onClick={openResolveModal}
                      disabled={actioning}
                      className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold disabled:opacity-50"
                    >
                      Resolve
                    </button>
                  ) : null}
                  {normalizedIncident.status === "resolved" && isOwner ? (
                    <button
                      type="button"
                      onClick={() => handleIncidentAction("reopen")}
                      disabled={actioning}
                      className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-[#d4dae4] text-sm disabled:opacity-50"
                    >
                      Reopen
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => navigate(`/monitors/${normalizedIncident.monitorId}`)}
                    className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-[#d4dae4] text-sm inline-flex items-center gap-2"
                  >
                    Open Monitor
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="px-5 md:px-6 py-5 space-y-6">
                <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                  <InfoPanel label="Opened" value={formatTimestamp(normalizedIncident.startedAt)} />
                  <InfoPanel label="Acknowledged" value={formatTimestamp(normalizedIncident.acknowledgedAt)} />
                  <InfoPanel label="Resolved" value={formatTimestamp(normalizedIncident.resolvedAt)} />
                  <InfoPanel label="Duration" value={normalizedIncident.durationLabel} />
                </div>

                <DetailBlock title="Customer Impact" value={normalizedIncident.impactSummary} emptyText="No impact summary added yet." />
                <DetailBlock title="Details" value={normalizedIncident.description} emptyText="No extra incident details added yet." />
                <DetailBlock title="Probable Cause" value={normalizedIncident.rootCause} emptyText="No probable cause recorded yet." />
                <DetailBlock title="Next Steps" value={normalizedIncident.nextSteps} emptyText="No next steps recorded yet." />
                <DetailBlock title="How It Was Fixed" value={normalizedIncident.fixSummary} emptyText="This incident is not resolved yet, or the fix summary has not been added." />
                <DetailBlock title="Resolution Notes" value={normalizedIncident.resolutionNotes} emptyText="No resolution notes recorded yet." />
              </div>
            </article>

            <article className="incident-pane-scroll rounded-2xl border border-[#262b34] bg-[radial-gradient(circle_at_top_right,_rgba(42,171,121,0.12),_transparent_28%),linear-gradient(180deg,_#151922_0%,_#12161d_38%,_#12161d_100%)] shadow-[0_18px_60px_rgba(0,0,0,0.24)] min-h-0 overflow-y-auto">
              {refreshing && <div className="incident-refresh-bar" />}
              <div className="sticky top-0 z-10 bg-[linear-gradient(180deg,rgba(18,22,29,0.98)_0%,rgba(18,22,29,0.94)_85%,rgba(18,22,29,0.88)_100%)] backdrop-blur-sm px-5 md:px-6 pt-5 md:pt-6 pb-5 border-b border-[#232833] flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Response Activity</p>
                  <p className="text-sm text-[#8d94a0] mt-1">Review the sequence of system updates and team actions for this incident.</p>
                  <p className="text-xs text-[#687080] mt-2">{normalizedIncident.updates.length} entries logged</p>
                </div>
                <button
                  type="button"
                  onClick={openUpdateModal}
                  className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold shrink-0"
                >
                  Add Response
                </button>
              </div>

              <div className="px-5 md:px-6 py-5 space-y-4">
                {normalizedIncident.updates.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#303543] bg-[#0d1118] p-6 text-sm text-[#8d94a0]">
                    No response activity yet. Add the first repair step from the button above.
                  </div>
                ) : (
                  normalizedIncident.updates.map((entry, index) => (
                    <TimelineEntry
                      key={entry.id || `${entry.createdAt}-${index}`}
                      entry={entry}
                      isLast={index === normalizedIncident.updates.length - 1}
                    />
                  ))
                )}
              </div>
            </article>
          </div>
        </main>
      </main>

      {showEditModal && (
        <IncidentFormModal
          title={`Edit ${normalizedIncident.incidentCode}`}
          description="Update the incident context while it is still being handled."
          form={incidentForm}
          submitting={submitting}
          submitLabel="Save Changes"
          onChange={setIncidentForm}
          onClose={() => setShowEditModal(false)}
          onSubmit={handleEditIncident}
        />
      )}

      {showResolveModal && (
        <ResolveIncidentModal
          incident={normalizedIncident}
          form={resolutionForm}
          submitting={submitting}
          onChange={setResolutionForm}
          onClose={() => setShowResolveModal(false)}
          onSubmit={handleResolveIncident}
        />
      )}

      {showUpdateModal && (
        <UpdateResponseModal
          form={updateForm}
          submitting={submitting}
          onChange={setUpdateForm}
          onClose={() => setShowUpdateModal(false)}
          onSubmit={async (event) => {
            const ok = await handleAddIncidentUpdate(event);
            if (ok) setShowUpdateModal(false);
          }}
        />
      )}
    </div>
  );
}

function IncidentFormModal({ title, description, form, submitting, submitLabel, onChange, onClose, onSubmit }) {
  return (
    <ModalShell title={title} description={description} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField label="Severity">
          <select
            value={form.severity}
            onChange={(event) => onChange((prev) => ({ ...prev, severity: event.target.value }))}
            className="w-full h-11 bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 focus:outline-none"
          >
            {SEVERITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Incident Title">
          <input
            type="text"
            value={form.title}
            onChange={(event) => onChange((prev) => ({ ...prev, title: event.target.value }))}
            className="w-full h-11 bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 focus:outline-none"
            required
          />
        </FormField>
        <FormField label="Customer Impact">
          <textarea
            value={form.impactSummary}
            onChange={(event) => onChange((prev) => ({ ...prev, impactSummary: event.target.value }))}
            rows={3}
            className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-y"
          />
        </FormField>
        <FormField label="Details">
          <textarea
            value={form.description}
            onChange={(event) => onChange((prev) => ({ ...prev, description: event.target.value }))}
            rows={4}
            className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-y"
          />
        </FormField>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Probable Cause">
            <textarea
              value={form.rootCause}
              onChange={(event) => onChange((prev) => ({ ...prev, rootCause: event.target.value }))}
              rows={3}
              className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-y"
            />
          </FormField>
          <FormField label="Next Steps">
            <textarea
              value={form.nextSteps}
              onChange={(event) => onChange((prev) => ({ ...prev, nextSteps: event.target.value }))}
              rows={3}
              className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-y"
            />
          </FormField>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm">Cancel</button>
          <button type="submit" disabled={submitting} className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold disabled:opacity-50">
            {submitting ? "Saving..." : submitLabel}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ResolveIncidentModal({ incident, form, submitting, onChange, onClose, onSubmit }) {
  return (
    <ModalShell title={`Resolve ${incident.incidentCode}`} description="Add the final fix summary before closing the incident." onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField label="How Was It Fixed?">
          <textarea
            value={form.fixSummary}
            onChange={(event) => onChange((prev) => ({ ...prev, fixSummary: event.target.value }))}
            rows={4}
            className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-y"
            required
          />
        </FormField>
        <FormField label="Resolution Notes">
          <textarea
            value={form.resolutionNotes}
            onChange={(event) => onChange((prev) => ({ ...prev, resolutionNotes: event.target.value }))}
            rows={3}
            className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-y"
          />
        </FormField>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm">Cancel</button>
          <button type="submit" disabled={submitting} className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold disabled:opacity-50">
            {submitting ? "Resolving..." : "Resolve Incident"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function UpdateResponseModal({ form, submitting, onChange, onClose, onSubmit }) {
  return (
    <ModalShell
      title="Add Response"
      description="Record one troubleshooting step, status update, or fix so the incident history stays clean."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField label="Response Title">
          <input
            type="text"
            value={form.title}
            onChange={(event) => onChange((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Example: Restarted origin service"
            className="w-full h-11 bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 focus:outline-none"
          />
        </FormField>
        <FormField label="Response Details">
          <textarea
            value={form.message}
            onChange={(event) => onChange((prev) => ({ ...prev, message: event.target.value }))}
            placeholder="Explain the action taken, what changed, and what result you observed."
            rows={5}
            className="w-full bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 py-3 focus:outline-none resize-none"
          />
        </FormField>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm">Cancel</button>
          <button type="submit" disabled={submitting} className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold disabled:opacity-50">
            {submitting ? "Saving..." : "Save Response"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, description, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-[#050608]/80 backdrop-blur-sm px-4 py-6 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-[#232833] bg-[#0f1217] shadow-[0_24px_90px_rgba(0,0,0,0.45)]">
        <div className="flex items-start justify-between gap-4 px-5 md:px-6 py-5 border-b border-[#232833]">
          <div>
            <h3 className="text-xl font-semibold text-[#edf2fb]">{title}</h3>
            <p className="text-sm text-[#8d94a0] mt-1">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="h-10 w-10 rounded-lg border border-[#252a33] bg-[#14181e] text-[#a7afbd] grid place-items-center">
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

function DetailBlock({ title, value, emptyText }) {
  return (
    <section className="border-t border-[#232833] pt-5 first:border-t-0 first:pt-0">
      <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">{title}</p>
      <p className="text-sm leading-6 text-[#dbe2ee] mt-2 whitespace-pre-wrap">{value || emptyText}</p>
    </section>
  );
}

function InfoPanel({ label, value }) {
  return (
    <article className="rounded-xl border border-[#232833] bg-[#10141b]/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">{label}</p>
      <p className="text-sm font-medium text-[#dbe2ee] mt-2 break-words">{value || "--"}</p>
    </article>
  );
}

function TimelineEntry({ entry, isLast }) {
  const isSystem = entry.type === "system";
  return (
    <div className="relative pl-8">
      {!isLast && <div className="absolute left-[11px] top-7 h-[calc(100%-1rem)] w-px bg-[#2d3340]" />}
      <div className={`absolute left-0 top-1.5 h-6 w-6 rounded-full border ${isSystem ? "border-[#6e86ff] bg-[#1d2847]" : "border-[#2aab79] bg-[#123528]"}`} />
      <div className="rounded-xl border border-[#252a33] bg-[#10141b] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[#edf2fb]">{entry.title || "Response entry"}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded ${isSystem ? "bg-[#1d2847] text-[#bbccff]" : "bg-[#123528] text-[#98f0c7]"}`}>
                {isSystem ? "System update" : "Team response"}
              </span>
            </div>
          </div>
          <div className="text-xs text-[#8d94a0] rounded-full border border-[#2a313d] bg-[#0d1118] px-2.5 py-1">
            {formatTimestamp(entry.createdAt)}
          </div>
        </div>
        {entry.body && <p className="text-sm leading-6 text-[#d7dee9] mt-3 whitespace-pre-wrap">{entry.body}</p>}
      </div>
    </div>
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
        active ? "bg-[#181c24] text-[#eff3fa]" : "text-[#9aa2b1] hover:bg-[#161a21] hover:text-[#e1e7f2]"
      }`}
    >
      <IconComponent className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}

function getStatusMeta(status) {
  if (status === "open") return { label: "Open", className: "bg-[#402025] text-[#f6b5a8]" };
  if (status === "acknowledged") return { label: "Acknowledged", className: "bg-[#44351a] text-[#f3d088]" };
  return { label: "Resolved", className: "bg-[#123828] text-[#69e7ba]" };
}

function inferCauseCode(incident) {
  const text = `${incident.rootCause || ""} ${incident.title || ""}`.toLowerCase();
  if (text.includes("timeout")) return "TIMEOUT";
  if (text.includes("network") || text.includes("dns")) return "NETWORK";
  if (text.includes("rate limit") || text.includes("blocked") || text.includes("access")) return "ACCESS_RESTRICTED";
  if (text.includes("server") || text.includes("upstream") || text.includes("deploy")) return "UPSTREAM";
  if (incident.severity === "critical" || incident.severity === "high") return "UPSTREAM";
  return "ACCESS_RESTRICTED";
}
