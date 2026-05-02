import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageLoader from "../../components/PageLoader";
import {
  AlertTriangle,
  Bell,
  Eye,
  Globe,
  LayoutGrid,
  Mail,
  Plus,
  RefreshCw,
  Siren,
  Slack,
  Users,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  createAlertChannel,
  fetchAlertChannels,
  fetchAlertEvents,
  fetchAlertPolicies,
  fetchAlertPreferences,
  fetchMonitors,
  saveAlertPreferences,
  saveDefaultAlertPolicy,
  saveMonitorAlertPolicy,
  testAlertChannel,
  updateAlertChannel,
} from "../../api";

const CHANNEL_FORM_DEFAULTS = {
  type: "discord",
  name: "",
  enabled: true,
  webhookUrl: "",
  recipientEmails: "",
};

const POLICY_FORM_DEFAULTS = {
  enabled: true,
  channelIds: [],
  applyMode: "all",
  targetMonitorIds: [],
  triggers: {
    down_open: true,
    degraded_open: true,
    recovery: true,
  },
  severityMap: {
    down_open: "critical",
    degraded_open: "high",
    recovery: "info",
  },
  cooldownMinutes: 0,
};

const CHANNEL_TYPES = [
  { value: "discord", label: "Discord" },
  { value: "slack", label: "Slack" },
  { value: "email", label: "Email" },
];

const CHANNEL_PRESETS = [
  { type: "email",   label: "Email",   Icon: Mail,  hint: "Send via Resend" },
  { type: "slack",   label: "Slack",   Icon: Slack, hint: "Webhook delivery" },
  { type: "discord", label: "Discord", Icon: Bell,  hint: "Webhook delivery" },
];
const ALERT_EVENTS_PAGE_SIZE = 10;
const DEFERRED_MONITOR_LOAD_MS = 450;
// Events are now loaded in parallel with channels/policies, not deferred,
// so the 'Failed Deliveries' KPI resolves as soon as the page loads.

export default function AlertsPage() {
  const { user, logout, currentMembershipRole, workspace } = useAuth();
  const navigate = useNavigate();
  const canManageWorkspaceAlerts = ["owner", "admin"].includes(currentMembershipRole);

  const [monitors, setMonitors] = useState([]);
  const [channels, setChannels] = useState([]);
  const [defaultPolicy, setDefaultPolicy] = useState(POLICY_FORM_DEFAULTS);
  const [monitorPolicies, setMonitorPolicies] = useState([]);
  const [preferences, setPreferences] = useState(() => normalizePreferencesForForm(null));
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [testingChannelId, setTestingChannelId] = useState("");
  const [error, setError] = useState("");

  const [showChannelModal, setShowChannelModal] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState("");
  const [channelForm, setChannelForm] = useState(CHANNEL_FORM_DEFAULTS);
  const [modalError, setModalError] = useState("");

  const [showDefaultPolicyModal, setShowDefaultPolicyModal] = useState(false);
  const [defaultPolicyViewMode, setDefaultPolicyViewMode] = useState("view");
  const [draftDefaultPolicy, setDraftDefaultPolicy] = useState(POLICY_FORM_DEFAULTS);

  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [editingOverrideMonitorId, setEditingOverrideMonitorId] = useState("");
  const [overrideMonitorId, setOverrideMonitorId] = useState("");
  const [overrideForm, setOverrideForm] = useState(POLICY_FORM_DEFAULTS);

  const [selectedEvent, setSelectedEvent] = useState(null);
  const [monitorsLoading, setMonitorsLoading] = useState(false);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [eventsPage, setEventsPage] = useState(1);
  const deferredLoadRef = useRef([]);

  const clearDeferredLoads = useCallback(() => {
    for (const timerId of deferredLoadRef.current) {
      clearTimeout(timerId);
    }
    deferredLoadRef.current = [];
  }, []);

  const loadMonitorsSection = useCallback(async () => {
    if (!user || !workspace?.id) return;
    setMonitorsLoading(true);
    try {
      const monitorItems = await fetchMonitors(user, { includeChildren: true });
      setMonitors(Array.isArray(monitorItems) ? monitorItems : []);
    } catch {
      // Keep page interactive even if monitor metadata is delayed.
    } finally {
      setMonitorsLoading(false);
    }
  }, [user, workspace?.id]);

  const loadEventsSection = useCallback(async () => {
    if (!user || !workspace?.id) return;
    try {
      const eventItems = await fetchAlertEvents(user, 30);
      setEvents(Array.isArray(eventItems) ? eventItems : []);
      setEventsLoaded(true);
      setEventsPage(1);
    } catch {
      // Activity is secondary and should not block the page.
    }
  }, [user, workspace?.id]);

  const scheduleDeferredLoads = useCallback(() => {
    clearDeferredLoads();
    // Only monitors are deferred — they're only needed when editing policies.
    deferredLoadRef.current = [
      setTimeout(() => {
        loadMonitorsSection();
      }, DEFERRED_MONITOR_LOAD_MS),
    ];
  }, [clearDeferredLoads, loadMonitorsSection]);

  const loadPage = useCallback(async ({ silent = false } = {}) => {
    if (!user || !workspace?.id) return;
    clearDeferredLoads();
    setEventsLoaded(false);
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      // Load channels, policies AND events in parallel.
      // Events need to land fast so 'Failed Deliveries' KPI resolves immediately.
      // Monitors are deferred — they're only needed when the user edits a policy.
      const [channelItems, policySnapshot, preferenceSnapshot, eventItems] = await Promise.all([
        fetchAlertChannels(user),
        fetchAlertPolicies(user),
        fetchAlertPreferences(user),
        fetchAlertEvents(user, 30),
      ]);

      const normalizedDefault = normalizePolicyForForm(policySnapshot?.defaultPolicy || POLICY_FORM_DEFAULTS);
      setChannels(Array.isArray(channelItems) ? channelItems : []);
      setDefaultPolicy(normalizedDefault);
      setDraftDefaultPolicy(normalizedDefault);
      setMonitorPolicies(Array.isArray(policySnapshot?.monitorPolicies) ? policySnapshot.monitorPolicies : []);
      setPreferences(normalizePreferencesForForm(preferenceSnapshot));
      setEvents(Array.isArray(eventItems) ? eventItems : []);
      setEventsLoaded(true);
      setEventsPage(1);
      scheduleDeferredLoads();
    } catch (err) {
      setError(err?.message || "Could not load alerts.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clearDeferredLoads, scheduleDeferredLoads, user, workspace?.id]);

  useEffect(() => {
    if (!user || !workspace?.id) return;
    loadPage();
    return () => {
      clearDeferredLoads();
    };
  }, [user, workspace?.id, loadPage, clearDeferredLoads]);

  async function ensureMonitorsLoaded() {
    if (monitors.length > 0 || monitorsLoading) return;
    await loadMonitorsSection();
  }

  const monitorMap = useMemo(
    () => Object.fromEntries(monitors.map((monitor) => [monitor.id, monitor])),
    [monitors]
  );

  const channelMap = useMemo(
    () => Object.fromEntries(channels.map((channel) => [channel.id, channel])),
    [channels]
  );

  const channelActivityMap = useMemo(() => {
    const next = {};
    for (const event of events) {
      const key = event.channelId || "system";
      if (!next[key]) {
        next[key] = { sent: 0, failed: 0, lastEvent: null };
      }
      if (event.status === "sent") next[key].sent += 1;
      if (event.status === "failed") next[key].failed += 1;
      if (!next[key].lastEvent || new Date(event.createdAt).getTime() > new Date(next[key].lastEvent.createdAt).getTime()) {
        next[key].lastEvent = event;
      }
    }
    return next;
  }, [events]);

  const summary = useMemo(() => ({
    activeChannels: channels.filter((channel) => channel.enabled).length,
    defaultCoverage: defaultPolicy.applyMode === "selected"
      ? defaultPolicy.targetMonitorIds.length
      : (monitorsLoading && monitors.length === 0 ? "--" : monitors.length),
    overrides: monitorPolicies.length,
    failedEvents: eventsLoaded ? events.filter((event) => event.status === "failed").length : "--",
    sentEvents:   eventsLoaded ? events.filter((event) => event.status === "sent").length   : "--",
    personalChannels: preferences.channelIds.length,
    personalTriggers: Object.values(preferences.triggers || {}).filter(Boolean).length,
  }), [channels, defaultPolicy.applyMode, defaultPolicy.targetMonitorIds.length, events, eventsLoaded, monitorPolicies.length, monitors.length, monitorsLoading, preferences.channelIds.length, preferences.triggers]);

  const paginatedEvents = useMemo(() => {
    const start = (eventsPage - 1) * ALERT_EVENTS_PAGE_SIZE;
    return events.slice(start, start + ALERT_EVENTS_PAGE_SIZE);
  }, [events, eventsPage]);

  const totalEventPages = useMemo(() => {
    return Math.max(1, Math.ceil(events.length / ALERT_EVENTS_PAGE_SIZE));
  }, [events.length]);

  function resetChannelForm() {
    setChannelForm(CHANNEL_FORM_DEFAULTS);
    setEditingChannelId("");
    setModalError("");
  }

  function openCreateChannel() {
    resetChannelForm();
    setShowChannelModal(true);
  }

  function openCreateChannelOfType(type) {
    resetChannelForm();
    setChannelForm((prev) => ({ ...prev, type }));
    setShowChannelModal(true);
  }

  function openEditChannel(channel) {
    setEditingChannelId(channel.id);
    setChannelForm({
      type: channel.type,
      name: channel.name,
      enabled: channel.enabled,
      webhookUrl: channel.config?.webhookUrl || "",
      fromEmail: channel.config?.fromEmail || "",
      recipientEmails: Array.isArray(channel.config?.recipientEmails) ? channel.config.recipientEmails.join(", ") : "",
    });
    setShowChannelModal(true);
  }

  async function openDefaultPolicy(mode) {
    if (mode !== "view") {
      await ensureMonitorsLoaded();
    } else if (defaultPolicy.applyMode === "selected") {
      await ensureMonitorsLoaded();
    }
    setDefaultPolicyViewMode(mode);
    setDraftDefaultPolicy(normalizePolicyForForm(defaultPolicy));
    setShowDefaultPolicyModal(true);
  }

  function resetOverrideForm() {
    setEditingOverrideMonitorId("");
    setOverrideMonitorId("");
    setOverrideForm(POLICY_FORM_DEFAULTS);
  }

  async function openCreateOverride() {
    await ensureMonitorsLoaded();
    resetOverrideForm();
    setShowOverrideModal(true);
  }

  async function openEditOverride(policy) {
    await ensureMonitorsLoaded();
    setEditingOverrideMonitorId(policy.monitorId);
    setOverrideMonitorId(policy.monitorId);
    setOverrideForm(normalizePolicyForForm(policy));
    setShowOverrideModal(true);
  }

  async function handleSaveChannel(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const payload = {
        type: channelForm.type,
        name: channelForm.name.trim() || channelForm.type,
        enabled: channelForm.enabled,
        config: channelForm.type === "email"
          ? {
            recipientEmails: channelForm.recipientEmails
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          }
          : {
            webhookUrl: channelForm.webhookUrl.trim(),
          },
      };

      let savedChannel;
      if (editingChannelId) {
        savedChannel = await updateAlertChannel(user, editingChannelId, payload);
        setChannels((prev) => prev.map((channel) => (channel.id === editingChannelId ? savedChannel : channel)));
      } else {
        savedChannel = await createAlertChannel(user, payload);
        setChannels((prev) => [savedChannel, ...prev]);
      }

      setShowChannelModal(false);
      resetChannelForm();
    } catch (err) {
      setModalError(err?.message || "Could not save alert channel.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveDefaultPolicy(event) {
    event.preventDefault();
    if (!canManageWorkspaceAlerts) return;
    if (draftDefaultPolicy.applyMode === "selected" && draftDefaultPolicy.targetMonitorIds.length === 0) {
      setError("Choose at least one monitor or switch the rule to all monitors.");
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      const payload = sanitizePolicyForRequest(draftDefaultPolicy, { allowScope: true });
      const savedPolicy = await saveDefaultAlertPolicy(user, payload);
      const normalized = normalizePolicyForForm(savedPolicy || payload);
      setDefaultPolicy(normalized);
      setDraftDefaultPolicy(normalized);
      setShowDefaultPolicyModal(false);
    } catch (err) {
      setError(err?.message || "Could not save default alert rule.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveOverride(event) {
    event.preventDefault();
    if (!canManageWorkspaceAlerts) return;
    if (!overrideMonitorId) {
      setError("Select a monitor for the custom rule.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const savedPolicy = await saveMonitorAlertPolicy(user, overrideMonitorId, sanitizePolicyForRequest(overrideForm, { allowScope: false }));
      setMonitorPolicies((prev) => {
        const next = prev.filter((policy) => policy.monitorId !== overrideMonitorId);
        return [savedPolicy, ...next];
      });
      setShowOverrideModal(false);
      resetOverrideForm();
    } catch (err) {
      setError(err?.message || "Could not save custom monitor rule.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendTest(channelId) {
    setTestingChannelId(channelId);
    setError("");
    try {
      const result = await testAlertChannel(user, channelId);
      setChannels((prev) => prev.map((channel) => (
        channel.id === channelId
          ? {
            ...channel,
            lastTestAt: result?.createdAt || new Date().toISOString(),
            lastDeliveryAt: result?.status === "sent" ? (result?.createdAt || new Date().toISOString()) : channel.lastDeliveryAt,
            lastFailureAt: result?.status === "failed" ? (result?.createdAt || new Date().toISOString()) : channel.lastFailureAt,
            lastFailureReason: result?.failureReason || result?.providerResponse || channel.lastFailureReason,
          }
          : channel
      )));
      await loadEventsSection();
    } catch (err) {
      setError(err?.message || "Could not send test alert.");
      await loadEventsSection();
    } finally {
      setTestingChannelId("");
    }
  }

  async function handleSavePreferences(event) {
    event.preventDefault();
    setSavingPreferences(true);
    setError("");

    try {
      const saved = await saveAlertPreferences(user, {
        enabled: Boolean(preferences.enabled),
        channelIds: Array.isArray(preferences.channelIds) ? preferences.channelIds : [],
        triggers: preferences.triggers,
      });
      setPreferences(normalizePreferencesForForm(saved));
    } catch (err) {
      setError(err?.message || "Could not save your alert preferences.");
    } finally {
      setSavingPreferences(false);
    }
  }

  return (
    <div className="min-h-screen text-[#f2f2f2]">
        <header className="sticky top-0 z-20 border-b border-[#22252b] bg-[#0d0f13] px-5 md:px-8 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Alert Routing</h1>
            <p className="text-sm text-[#8d94a0] mt-1">Choose where alerts go, what should notify you, and which monitors use each rule.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadPage({ silent: true })}
              className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm inline-flex items-center gap-2 disabled:opacity-50"
              disabled={refreshing}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </header>

        <div className="px-5 md:px-8 py-6 space-y-6">
          {loading ? (
            <PageLoader rows={5} />
          ) : (
            <>
          {error && (
            <div className="bg-red-500/10 border border-red-500/25 text-red-300 rounded-lg p-3 text-sm">
              {error}
            </div>
          )}

          <section className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <SummaryCard label="Active Channels"    value={summary.activeChannels}  caption="Enabled destinations" />
            <SummaryCard label="Successful Sends"   value={summary.sentEvents}       caption="Delivered this session"  />
            <SummaryCard label="Failed Deliveries"  value={summary.failedEvents}      caption="Recent failures" />
            {canManageWorkspaceAlerts ? (
              <>
                <SummaryCard label="Workspace Coverage" value={summary.defaultCoverage} caption={defaultPolicy.applyMode === "selected" ? "Selected monitors" : "All monitors"} />
                <SummaryCard label="Custom Rules" value={summary.overrides} caption="Monitor overrides" />
              </>
            ) : (
              <>
                <SummaryCard label="My Channels" value={summary.personalChannels} caption="Personal delivery channels" />
                <SummaryCard label="My Triggers" value={summary.personalTriggers} caption="Enabled personal triggers" />
              </>
            )}
          </section>

          <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5 md:p-7">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-medium text-[#edf2fb]">Delivery Channels</h2>
                <p className="text-sm text-[#8d94a0] mt-2">
                  {canManageWorkspaceAlerts
                    ? "Each channel card shows its own delivery settings and recent activity."
                    : "These shared workspace channels are available for routing, but only owners and admins can edit them."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {CHANNEL_PRESETS.map((preset) => {
                const existing = channels.find((c) => c.type === preset.type);
                const health = existing ? getChannelHealthMeta(existing) : null;
                const hasSuccess = existing?.lastDeliveryAt;
                return (
                  <button
                    key={preset.type}
                    type="button"
                    onClick={() => canManageWorkspaceAlerts && (existing ? openEditChannel(existing) : openCreateChannelOfType(preset.type))}
                    disabled={!canManageWorkspaceAlerts}
                    className={`relative w-full rounded-xl border p-5 text-left transition ${
                      existing ? "border-[#252a33] bg-[#12161d] hover:bg-[#171c25]" : "border-dashed border-[#2a2f39] bg-[#0c0e12] hover:bg-[#0f1218]"
                    } ${!canManageWorkspaceAlerts ? "cursor-default" : "cursor-pointer"}`}
                  >
                    {/* Status badge */}
                    {existing && (
                      <span className={`absolute top-4 right-4 text-[11px] px-2.5 py-0.5 rounded-full font-medium ${
                        existing.enabled ? "bg-[#123828] text-[#69e7ba]" : "bg-[#2b323f] text-[#bcc5d2]"
                      }`}>
                        {existing.enabled ? "Enabled" : "Disabled"}
                      </span>
                    )}

                    {/* Icon + type */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 ${
                        existing ? "bg-[#1a1f2e] border border-[#252a33]" : "bg-[#13161e] border border-[#222830]"
                      }`}>
                        <preset.Icon className="w-5 h-5 text-[#8b93a5]" />
                      </div>
                      <div>
                        <p className="text-[15px] font-semibold text-[#edf2fb]">{preset.label}</p>
                        <p className="text-[12px] text-[#6b7280] mt-0.5">{preset.hint}</p>
                      </div>
                    </div>

                    {existing ? (
                      <div className="space-y-2">
                        <p className="text-[12px] text-[#8d94a0] break-all leading-relaxed">{describeChannelConfig(existing)}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {health && <span className={`text-[11px] px-2 py-0.5 rounded-full ${health.className}`}>{health.label}</span>}
                          {hasSuccess && <span className="text-[11px] text-[#69e7ba] font-medium">✓ Last sent: {formatTimestamp(existing.lastDeliveryAt)}</span>}
                        </div>
                        <div className="rounded-lg border border-[#252a33] bg-[#0f1217] px-3 py-2 text-xs text-[#8d94a0]">
                          <div className="flex items-center justify-between gap-3">
                            <span>Recent sent: {channelActivityMap[existing.id]?.sent || 0}</span>
                            <span>Recent failed: {channelActivityMap[existing.id]?.failed || 0}</span>
                          </div>
                          <p className="mt-1 text-[#aeb6c3]">
                            {channelActivityMap[existing.id]?.lastEvent
                              ? `${formatEventType(channelActivityMap[existing.id].lastEvent.eventType)} at ${formatTimestamp(channelActivityMap[existing.id].lastEvent.createdAt)}`
                              : "No recent delivery activity for this channel."}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 mt-4.5">
                          {canManageWorkspaceAlerts && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); handleSendTest(existing.id); }}
                              onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), handleSendTest(existing.id))}
                              className={`text-[15px] px-3 py-1.5 rounded-lg border border-[#2a2f39] bg-[#14181e] text-[#d7deea] hover:bg-[#1e2330] transition ${
                                testingChannelId === existing.id ? "opacity-50 pointer-events-none" : ""
                              }`}
                            >
                              {testingChannelId === existing.id ? "Testing…" : "Send Test"}
                            </span>
                          )}
                          {canManageWorkspaceAlerts && (
                            <span className="text-[15px] px-3 py-1.5 rounded-lg border border-[#2a2f39] bg-[#14181e] text-[#d7deea] hover:bg-[#1e2330] transition">
                              Edit
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-2">
                        <Plus className="w-4 h-4 text-[#6b7280]" />
                        <span className="text-[13px] text-[#6b7280]">
                          {canManageWorkspaceAlerts ? `Connect ${preset.label}` : "Not configured"}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5 space-y-4">
            <div>
              <h2 className="text-sm font-medium text-[#edf2fb]">My Alert Preferences</h2>
              <p className="text-sm text-[#8d94a0] mt-1">
                These settings affect only what this signed-in member receives in the current workspace. Shared routing stays separate.
              </p>
            </div>

            <form onSubmit={handleSavePreferences} className="space-y-4">
              <label className="flex items-center gap-2 text-sm text-[#d7deea]">
                <input
                  type="checkbox"
                  checked={preferences.enabled}
                  onChange={(event) => setPreferences((prev) => ({ ...prev, enabled: event.target.checked }))}
                />
                Personal delivery enabled
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                <TriggerToggle
                  label="Monitor Down"
                  hint="Notify me when a monitor becomes unavailable."
                  checked={preferences.triggers.down_open}
                  onChange={(checked) => setPreferences((prev) => ({ ...prev, triggers: { ...prev.triggers, down_open: checked } }))}
                />
                <TriggerToggle
                  label="Monitor Degraded"
                  hint="Notify me about degraded checks and partial outages."
                  checked={preferences.triggers.degraded_open}
                  onChange={(checked) => setPreferences((prev) => ({ ...prev, triggers: { ...prev.triggers, degraded_open: checked } }))}
                />
                <TriggerToggle
                  label="Monitor Recovered"
                  hint="Notify me when a failing monitor recovers."
                  checked={preferences.triggers.recovery}
                  onChange={(checked) => setPreferences((prev) => ({ ...prev, triggers: { ...prev.triggers, recovery: checked } }))}
                />
                <TriggerToggle
                  label="Incident Created"
                  hint="Notify me when a new manual incident is opened."
                  checked={preferences.triggers.incident_created}
                  onChange={(checked) => setPreferences((prev) => ({ ...prev, triggers: { ...prev.triggers, incident_created: checked } }))}
                />
                <TriggerToggle
                  label="Incident Resolved"
                  hint="Notify me when an incident is resolved."
                  checked={preferences.triggers.incident_resolved}
                  onChange={(checked) => setPreferences((prev) => ({ ...prev, triggers: { ...prev.triggers, incident_resolved: checked } }))}
                />
              </div>

              <Field label="My Delivery Channels">
                <div className="rounded-lg border border-[#252a33] bg-[#14181e] p-3 space-y-2">
                  {channels.filter((channel) => channel.enabled).length === 0 ? (
                    <p className="text-sm text-[#8d94a0]">No enabled channels are available yet.</p>
                  ) : (
                    channels.filter((channel) => channel.enabled).map((channel) => (
                      <label key={channel.id} className="flex items-start gap-3 text-sm text-[#d7deea]">
                        <input
                          type="checkbox"
                          checked={preferences.channelIds.includes(channel.id)}
                          onChange={(event) => setPreferences((prev) => ({
                            ...prev,
                            channelIds: event.target.checked
                              ? [...new Set([...prev.channelIds, channel.id])]
                              : prev.channelIds.filter((value) => value !== channel.id),
                          }))}
                        />
                        <span className="min-w-0">
                          <span className="block text-[#edf2fb]">{channel.name}</span>
                          <span className="block text-xs text-[#8d94a0] mt-1">{describeChannelConfig(channel)}</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </Field>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingPreferences}
                  className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#121417] text-sm font-semibold disabled:opacity-50"
                >
                  {savingPreferences ? "Saving..." : "Save My Preferences"}
                </button>
              </div>
            </form>
          </section>

          {canManageWorkspaceAlerts ? (
          <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-5">
            <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium">Workspace Routing</h2>
                  <p className="text-sm text-[#8d94a0] mt-1">This shared rule decides how workspace monitor alerts are routed before each member's personal preferences are applied.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openDefaultPolicy("view")}
                    className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea] inline-flex items-center gap-2"
                  >
                    <Eye className="w-4 h-4" />
                    View Rule
                  </button>
                  {canManageWorkspaceAlerts ? (
                    <button
                      type="button"
                      onClick={() => openDefaultPolicy("edit")}
                      className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#121417] text-sm font-semibold"
                    >
                      Edit Rule
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <InfoPanel
                  label="Rule Status"
                  value={defaultPolicy.enabled ? "Enabled" : "Paused"}
                  caption={defaultPolicy.enabled ? "PingMaster can send monitor alerts from this rule." : "The main rule is paused and will not send monitor alerts."}
                />
                <InfoPanel
                  label="Applies To"
                  value={describePolicyCoverage(defaultPolicy, monitors)}
                  caption={defaultPolicy.applyMode === "selected" ? "Only the selected monitors will use this rule." : "Every monitor uses this rule unless a custom rule replaces it."}
                />
                <InfoPanel
                  label="Notify Me For"
                  value={describeTriggerSelection(defaultPolicy.triggers)}
                  caption="These are the monitor events that can notify you."
                />
                <InfoPanel
                  label="Delivery Channels"
                  value={describePolicyChannels(defaultPolicy.channelIds, channelMap)}
                  caption="Only enabled channels can deliver alerts."
                />
              </div>

            </section>

            <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium">Custom Monitor Rules</h2>
                  <p className="text-sm text-[#8d94a0] mt-1">Use a custom rule only when one monitor should notify differently from the main rule.</p>
                </div>
                {canManageWorkspaceAlerts ? (
                  <button
                    type="button"
                    onClick={openCreateOverride}
                    className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]"
                  >
                    Add Rule
                  </button>
                ) : null}
              </div>

              {monitorPolicies.length === 0 ? (
                <EmptyCard message="No custom monitor rules yet." compact />
              ) : (
                <div className="space-y-2">
                  {monitorPolicies.map((policy) => {
                    const monitor = monitorMap[policy.monitorId];
                    return (
                      <button
                        key={policy.id}
                        type="button"
                        onClick={() => {
                          if (canManageWorkspaceAlerts) openEditOverride(policy);
                        }}
                        className="w-full rounded-lg border border-[#252a33] bg-[#12161d] px-3 py-3 text-left hover:bg-[#171c25] transition"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#edf2fb] truncate">{monitor?.name || policy.monitorId}</p>
                            <p className="text-xs text-[#8d94a0] mt-1">{describeTriggerSelection(policy.triggers)} | {describePolicyChannels(policy.channelIds, channelMap)}</p>
                          </div>
                          <span className={`text-[11px] px-2 py-1 rounded-full ${policy.enabled ? "bg-[#123828] text-[#69e7ba]" : "bg-[#2b323f] text-[#bcc5d2]"}`}>
                            {policy.enabled ? "Custom rule" : "Paused"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </section>
          ) : null}

          <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
            <div className="mb-4">
              <h2 className="text-sm font-medium">Recent Alert Activity</h2>
              <p className="text-sm text-[#8d94a0] mt-1">Each row shows one delivery attempt with its own status, source, channel, and provider result for this workspace.</p>
            </div>
            {!eventsLoaded ? (
              <EmptyCard message="Recent activity will load shortly..." />
            ) : events.length === 0 ? (
              <EmptyCard message="No alert events yet." />
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                {paginatedEvents.map((event) => {
                  const statusMeta = getEventStatusMeta(event.status);
                  const severityMeta = getSeverityMeta(event.severity);
                  const channel = event.channelId ? channelMap[event.channelId] : null;
                  const outcomeText = getEventOutcomeText(event);
                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => setSelectedEvent(event)}
                      className="w-full rounded-lg border border-[#252a33] bg-[#12161d] px-4 py-3 text-left hover:bg-[#171c25] transition"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-[#edf2fb]">{truncateText(getEventHeadline(event), 82)}</p>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusMeta.className}`}>{statusMeta.label}</span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full ${severityMeta.className}`}>{severityMeta.label}</span>
                          </div>
                          <p className="text-xs text-[#8d94a0] mt-1">
                            {formatEventContextLine(event, channel)}
                          </p>
                          <p className="text-sm text-[#cfd6e3] mt-2">{truncateText(getEventPreview(event), 160)}</p>
                          {outcomeText ? (
                            <p className="text-xs text-[#7f8793] mt-2">
                              {truncateText(outcomeText, 120)}
                            </p>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-xs text-[#9aa2af]">Open</span>
                      </div>
                    </button>
                  );
                })}
                </div>

                {events.length > ALERT_EVENTS_PAGE_SIZE && (
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <p className="text-xs text-[#8d94a0]">
                      Showing {(eventsPage - 1) * ALERT_EVENTS_PAGE_SIZE + 1}-
                      {Math.min(eventsPage * ALERT_EVENTS_PAGE_SIZE, events.length)} of {events.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEventsPage((prev) => Math.max(1, prev - 1))}
                        disabled={eventsPage === 1}
                        className="h-9 px-3 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea] disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => setEventsPage((prev) => Math.min(totalEventPages, prev + 1))}
                        disabled={eventsPage === totalEventPages}
                        className="h-9 px-3 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea] disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
            </>
          )}
        </div>

      {showChannelModal && (
        <Modal title={editingChannelId ? "Edit Channel" : "Add Channel"} onClose={() => { setShowChannelModal(false); resetChannelForm(); }}>
        <form onSubmit={handleSaveChannel} className="space-y-4">
          {modalError && (
            <div className="bg-red-500/10 border border-red-500/25 text-red-300 rounded-lg px-4 py-3 text-sm">
              {modalError}
            </div>
          )}

          {/* Show channel type as a read-only badge, not a dropdown */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-[#0c0e12] border border-[#1e2330]">
            {(() => { const preset = CHANNEL_PRESETS.find(p => p.type === channelForm.type); return preset ? <><preset.Icon className="w-4 h-4 text-[#8b93a5]" /><span className="text-sm font-medium text-[#edf2fb]">{preset.label}</span><span className="text-[11px] text-[#6b7280] ml-1">channel</span></> : null; })()}
          </div>

          <Field label="Name (optional)">
            <input
              value={channelForm.name}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, name: event.target.value }))}
              className="w-full h-11 rounded-lg border border-[#252a33] bg-[#14181e] px-3 text-sm"
              placeholder={`My ${channelForm.type} channel`}
            />
          </Field>

            {channelForm.type === "email" ? (
              <div className="grid grid-cols-1 gap-3">
                <Field label="Recipient Emails">
                  <textarea
                    value={channelForm.recipientEmails}
                    onChange={(event) => setChannelForm((prev) => ({ ...prev, recipientEmails: event.target.value }))}
                    className="w-full min-h-28 rounded-lg border border-[#252a33] bg-[#14181e] px-3 py-3 text-sm"
                    placeholder="ops@example.com, founder@example.com"
                  />
                  <p className="text-[11px] text-[#6b7280] mt-1">Enter one or more emails separated by commas. Alerts will be sent from your verified domain via Resend.</p>
                </Field>
              </div>
            ) : (
              <Field label="Webhook URL">
                <input
                  value={channelForm.webhookUrl}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, webhookUrl: event.target.value }))}
                  className="w-full h-11 rounded-lg border border-[#252a33] bg-[#14181e] px-3 text-sm"
                  placeholder="https://hooks..."
                />
              </Field>
            )}

            <label className="flex items-center gap-2 text-sm text-[#d7deea]">
              <input
                type="checkbox"
                checked={channelForm.enabled}
                onChange={(event) => setChannelForm((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              Channel enabled
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setShowChannelModal(false); resetChannelForm(); }} className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]">Cancel</button>
              <button type="submit" disabled={submitting} className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#121417] text-sm font-semibold disabled:opacity-50">
                {editingChannelId ? "Save Channel" : "Create Channel"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showDefaultPolicyModal && (
        <Modal
          title={defaultPolicyViewMode === "edit" ? "Edit Default Alert Rule" : "Default Alert Rule"}
          onClose={() => setShowDefaultPolicyModal(false)}
        >
          {defaultPolicyViewMode === "view" ? (
            <PolicyReadView policy={defaultPolicy} channelMap={channelMap} monitors={monitors} />
          ) : (
            <form onSubmit={handleSaveDefaultPolicy} className="space-y-4">
              <PolicyEditor
                policy={draftDefaultPolicy}
                channels={channels}
                monitors={monitors}
                onChange={setDraftDefaultPolicy}
                allowScope
              />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowDefaultPolicyModal(false)} className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]">Cancel</button>
                <button type="submit" disabled={submitting} className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#121417] text-sm font-semibold disabled:opacity-50">
                  Save Rule
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {showOverrideModal && (
        <Modal title={editingOverrideMonitorId ? "Edit Custom Monitor Rule" : "Add Custom Monitor Rule"} onClose={() => { setShowOverrideModal(false); resetOverrideForm(); }}>
          <form onSubmit={handleSaveOverride} className="space-y-4">
            <Field label="Monitor">
              <select
                value={overrideMonitorId}
                onChange={(event) => setOverrideMonitorId(event.target.value)}
                disabled={Boolean(editingOverrideMonitorId)}
                className="w-full h-11 rounded-lg border border-[#252a33] bg-[#14181e] px-3 text-sm"
              >
                <option value="">Select monitor</option>
                {monitors.map((monitor) => (
                  <option key={monitor.id} value={monitor.id}>{monitor.name}</option>
                ))}
              </select>
            </Field>
            <PolicyEditor
              policy={overrideForm}
              channels={channels}
              monitors={monitors}
              onChange={setOverrideForm}
            />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setShowOverrideModal(false); resetOverrideForm(); }} className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]">Cancel</button>
              <button type="submit" disabled={submitting} className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#121417] text-sm font-semibold disabled:opacity-50">
                Save Rule
              </button>
            </div>
          </form>
        </Modal>
      )}

      {selectedEvent && (
        <Modal title="Alert Activity Details" onClose={() => setSelectedEvent(null)}>
          <AlertEventDetails event={selectedEvent} channel={selectedEvent.channelId ? channelMap[selectedEvent.channelId] : null} />
        </Modal>
      )}
    </div>
  );
}

function PolicyEditor({ policy, channels, monitors, onChange, allowScope = false }) {
  const [showAdvanced, setShowAdvanced] = useState(policy.cooldownMinutes > 0);

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-[#d7deea]">
        <input
          type="checkbox"
          checked={policy.enabled}
          onChange={(event) => onChange((prev) => ({ ...prev, enabled: event.target.checked }))}
        />
        Rule enabled
      </label>

      {allowScope && (
        <Field label="Apply This Rule To">
          <div className="space-y-3 rounded-lg border border-[#252a33] bg-[#14181e] p-3">
            <label className="flex items-start gap-3 text-sm text-[#d7deea]">
              <input
                type="radio"
                name="default-apply-mode"
                checked={policy.applyMode !== "selected"}
                onChange={() => onChange((prev) => ({ ...prev, applyMode: "all", targetMonitorIds: [] }))}
              />
              <span>
                <span className="block text-[#edf2fb]">All monitors</span>
                <span className="block text-xs text-[#8d94a0] mt-1">Use this as the main alert rule across the whole workspace unless a custom rule replaces it.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-[#d7deea]">
              <input
                type="radio"
                name="default-apply-mode"
                checked={policy.applyMode === "selected"}
                onChange={() => onChange((prev) => ({ ...prev, applyMode: "selected", targetMonitorIds: prev.targetMonitorIds || [] }))}
              />
              <span>
                <span className="block text-[#edf2fb]">Selected monitors only</span>
                <span className="block text-xs text-[#8d94a0] mt-1">Choose exactly which monitors should use this rule.</span>
              </span>
            </label>

            {policy.applyMode === "selected" && (
              <div className="rounded-lg border border-[#252a33] bg-[#10141b] p-3 max-h-60 overflow-auto space-y-2">
                {monitors.length === 0 ? (
                  <p className="text-sm text-[#8d94a0]">No monitors available.</p>
                ) : (
                  monitors.map((monitor) => (
                    <label key={monitor.id} className="flex items-start gap-2 text-sm text-[#d7deea]">
                      <input
                        type="checkbox"
                        checked={policy.targetMonitorIds.includes(monitor.id)}
                        onChange={(event) => onChange((prev) => ({
                          ...prev,
                          targetMonitorIds: event.target.checked
                            ? [...new Set([...prev.targetMonitorIds, monitor.id])]
                            : prev.targetMonitorIds.filter((value) => value !== monitor.id),
                        }))}
                      />
                      <span className="min-w-0">
                        <span className="block text-[#edf2fb] truncate">{monitor.name}</span>
                        <span className="block text-xs text-[#8d94a0] truncate mt-1">{monitor.url}</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>
        </Field>
      )}

      <Field label="Send Alerts To">
        <div className="rounded-lg border border-[#252a33] bg-[#14181e] p-3 space-y-2">
          {channels.length === 0 ? (
            <p className="text-sm text-[#8d94a0]">Add channels first.</p>
          ) : channels.map((channel) => (
            <label key={channel.id} className="flex items-center gap-2 text-sm text-[#d7deea]">
              <input
                type="checkbox"
                checked={policy.channelIds.includes(channel.id)}
                onChange={(event) => onChange((prev) => ({
                  ...prev,
                  channelIds: event.target.checked
                    ? [...new Set([...prev.channelIds, channel.id])]
                    : prev.channelIds.filter((value) => value !== channel.id),
                }))}
              />
              {channel.name} <span className="text-[#8d94a0]">({getChannelMeta(channel.type).label})</span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Notify Me When">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <TriggerToggle
            label="A monitor goes down"
            hint="Confirmed outage after the retry checks finish."
            checked={policy.triggers.down_open}
            onChange={(checked) => onChange((prev) => ({ ...prev, triggers: { ...prev.triggers, down_open: checked } }))}
          />
          <TriggerToggle
            label="A monitor becomes degraded"
            hint="The target is reachable but restricted or partially unhealthy."
            checked={policy.triggers.degraded_open}
            onChange={(checked) => onChange((prev) => ({ ...prev, triggers: { ...prev.triggers, degraded_open: checked } }))}
          />
          <TriggerToggle
            label="A monitor recovers"
            hint="The service becomes healthy again after a problem."
            checked={policy.triggers.recovery}
            onChange={(checked) => onChange((prev) => ({ ...prev, triggers: { ...prev.triggers, recovery: checked } }))}
          />
        </div>
      </Field>

      <div className="rounded-lg border border-[#252a33] bg-[#14181e]">
        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          className="w-full px-4 py-3 flex items-center justify-between text-left"
        >
          <div>
            <p className="text-sm text-[#edf2fb]">Advanced</p>
            <p className="text-xs text-[#8d94a0] mt-1">Cooldown is optional. Most users can leave this as-is.</p>
          </div>
          <span className="text-xs text-[#9aa2af]">{showAdvanced ? "Hide" : "Show"}</span>
        </button>
        {showAdvanced && (
          <div className="px-4 pb-4">
            <Field label="Cooldown Minutes">
              <input
                type="number"
                min="0"
                max="1440"
                value={policy.cooldownMinutes}
                onChange={(event) => onChange((prev) => ({ ...prev, cooldownMinutes: Number(event.target.value || 0) }))}
                className="w-full h-11 rounded-lg border border-[#252a33] bg-[#10141b] px-3 text-sm"
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function PolicyReadView({ policy, channelMap, monitors }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <InfoPanel label="Rule Status" value={policy.enabled ? "Enabled" : "Paused"} />
        <InfoPanel label="Applies To" value={describePolicyCoverage(policy, monitors)} />
        <InfoPanel label="Notify Me For" value={describeTriggerSelection(policy.triggers)} />
        <InfoPanel label="Delivery Channels" value={describePolicyChannels(policy.channelIds, channelMap)} />
      </div>

      {policy.applyMode === "selected" && (
        <div className="rounded-lg border border-[#252a33] bg-[#12161d] p-4">
          <p className="text-sm font-medium text-[#edf2fb]">Selected monitors</p>
          <div className="mt-3 space-y-2">
            {policy.targetMonitorIds.length === 0 ? (
              <p className="text-sm text-[#8d94a0]">No monitors selected yet.</p>
            ) : policy.targetMonitorIds.map((monitorId) => {
              const monitor = monitors.find((item) => item.id === monitorId);
              return (
                <div key={monitorId} className="rounded-lg border border-[#252a33] bg-[#10141b] px-3 py-2.5 text-sm">
                  <p className="text-[#edf2fb]">{monitor?.name || monitorId}</p>
                  <p className="text-xs text-[#8d94a0] mt-1 break-all">{monitor?.url || "Monitor details unavailable"}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-[#252a33] bg-[#12161d] px-4 py-3 text-sm text-[#9aa2af]">
        Delivery severity is managed automatically: down alerts are critical, degraded alerts are high priority, and recovery alerts are informational.
      </div>
    </div>
  );
}

function AlertEventDetails({ event, channel }) {
  const statusMeta = getEventStatusMeta(event.status);
  const severityMeta = getSeverityMeta(event.severity);
  const incidentCode = extractIncidentCode(event.title);
  const detailRows = [
    ["Title", getEventHeadline(event)],
    ["Incident", incidentCode || "--"],
    ["Status", statusMeta.label],
    ["Severity", severityMeta.label],
    ["Source", formatSourceType(event.sourceType)],
    ["Event", formatEventType(event.eventType)],
    ["Channel", channel?.name || (event.status === "suppressed" ? "Delivery skipped" : "System")],
    ["Time", formatTimestamp(event.createdAt)],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[11px] px-2 py-1 rounded-full ${statusMeta.className}`}>{statusMeta.label}</span>
        <span className={`text-[11px] px-2 py-1 rounded-full ${severityMeta.className}`}>{severityMeta.label}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {detailRows.map(([label, value]) => (
          <InfoPanel key={label} label={label} value={value || "--"} />
        ))}
      </div>

      <div className="rounded-lg border border-[#252a33] bg-[#12161d] p-4">
        <p className="text-sm font-medium text-[#edf2fb]">Message</p>
        <p className="text-sm text-[#cfd6e3] mt-3 whitespace-pre-line break-words">{getEventPreview(event) || "--"}</p>
      </div>

      {getEventOutcomeText(event) && (
        <div className="rounded-lg border border-[#252a33] bg-[#12161d] p-4">
          <p className="text-sm font-medium text-[#edf2fb]">Delivery Result</p>
          <p className="text-sm text-[#cfd6e3] mt-3 whitespace-pre-line break-words">
            {getEventOutcomeText(event)}
          </p>
        </div>
      )}
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
      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-base transition ${active
        ? "bg-[#181c24] text-[#eff3fa]"
        : "text-[#9aa2b1] hover:bg-[#161a21] hover:text-[#e1e7f2]"
        }`}
    >
      <IconComponent className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}

function SummaryCard({ label, value, caption, highlight = false }) {
  return (
    <article className={`border rounded-xl p-3 ${highlight ? "bg-[#0b1610] border-[#1a3d28]" : "bg-[#0f1217] border-[#22252b]"}`}>
      <p className="text-sm uppercase tracking-[0.09em] text-[#8d94a0]">{label}</p>
      <div className="mt-1.5 min-h-[32px] flex items-center">
        {value === "--" ? (
          <span
            className="loading-metric-block h-[18px] w-[68px] rounded-md"
            aria-label={`${label} loading`}
          />
        ) : (
          <p className={`text-2xl font-semibold ${highlight ? "text-[#69e7ba]" : "text-[#edf3fb]"}`}>{value}</p>
        )}
      </div>
      <p className="text-sm text-[#7a828f] mt-0.5">{caption}</p>
    </article>
  );
}

function InfoPanel({ label, value, caption = "" }) {
  return (
    <div className="rounded-lg border border-[#252a33] bg-[#12161d] px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">{label}</p>
      <p className="text-sm text-[#edf2fb] mt-1 break-words">{value}</p>
      {caption ? <p className="text-xs text-[#7f8793] mt-2">{caption}</p> : null}
    </div>
  );
}

function EmptyCard({ message, compact = false }) {
  return (
    <div className={`rounded-lg border border-dashed border-[#2b313c] bg-[#11151c] text-center text-sm text-[#7f8793] ${compact ? "px-4 py-5" : "px-4 py-8"}`}>
      {message}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#252a33] bg-[#0f1217] shadow-2xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#22252b]">
          <h3 className="text-lg font-semibold text-[#edf2fb]">{title}</h3>
          <button type="button" onClick={onClose} className="h-9 w-9 rounded-lg border border-[#252a33] grid place-items-center text-[#a7afbd]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5 overflow-y-auto max-h-[calc(90vh-73px)]">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">{label}</span>
      {children}
    </label>
  );
}

function TriggerToggle({ label, hint, checked, onChange }) {
  return (
    <label className="rounded-lg border border-[#252a33] bg-[#14181e] px-3 py-3 flex items-start justify-between gap-3 text-sm text-[#d7deea]">
      <span className="min-w-0">
        <span className="block text-[#edf2fb]">{label}</span>
        <span className="block text-xs text-[#8d94a0] mt-1">{hint}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1" />
    </label>
  );
}

function describeChannelConfig(channel) {
  if (channel.type === "email") {
    const recipients = Array.isArray(channel.config?.recipientEmails) ? channel.config.recipientEmails.length : 0;
    return `${channel.config?.fromEmail || "--"} -> ${recipients} recipient${recipients === 1 ? "" : "s"}`;
  }
  return channel.config?.webhookUrl || "--";
}

function getChannelMeta(type) {
  if (type === "discord") return { label: "Discord Webhook", Icon: Bell };
  if (type === "slack") return { label: "Slack Webhook", Icon: Slack };
  return { label: "Email Channel", Icon: Mail };
}

function getEventStatusMeta(status) {
  if (status === "sent") return { label: "Sent", className: "bg-[#123828] text-[#69e7ba]" };
  if (status === "failed") return { label: "Failed", className: "bg-[#402025] text-[#f6b5a8]" };
  return { label: "Suppressed", className: "bg-[#2b323f] text-[#bcc5d2]" };
}

function getSeverityMeta(severity) {
  if (severity === "critical") return { label: "Critical", className: "bg-[#5a2323] text-[#ffb4a8]" };
  if (severity === "high") return { label: "High", className: "bg-[#44351a] text-[#f3d088]" };
  if (severity === "medium") return { label: "Medium", className: "bg-[#1c3748] text-[#9fdcff]" };
  if (severity === "low") return { label: "Low", className: "bg-[#2b323f] text-[#bcc5d2]" };
  return { label: "Info", className: "bg-[#123149] text-[#9fdcff]" };
}

function formatEventType(eventType) {
  if (eventType === "down_open") return "Monitor down";
  if (eventType === "degraded_open") return "Monitor degraded";
  if (eventType === "recovery") return "Monitor recovered";
  if (eventType === "incident_created") return "Incident created";
  if (eventType === "incident_resolved") return "Incident resolved";
  return "Test delivery";
}

function extractIncidentCode(value) {
  const match = String(value || "").match(/INC-\d+/i);
  return match ? match[0].toUpperCase() : "";
}

function getEventHeadline(event) {
  if (event?.sourceType === "incident" && event?.eventType === "incident_created") {
    return "Incident opened";
  }
  if (event?.sourceType === "incident" && event?.eventType === "incident_resolved") {
    return "Incident resolved";
  }
  return event?.title || "Alert activity";
}

function getEventPreview(event) {
  if (event?.sourceType === "incident") {
    const incidentCode = extractIncidentCode(event?.title);
    if (event?.eventType === "incident_created") {
      return incidentCode
        ? `${incidentCode} was opened for the affected monitor.`
        : "An incident was opened for the affected monitor.";
    }
    if (event?.eventType === "incident_resolved") {
      return incidentCode
        ? `${incidentCode} has been marked resolved.`
        : "An incident was marked resolved.";
    }
  }

  const firstLine = String(event?.message || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || "Alert activity recorded.";
}

function getEventOutcomeText(event) {
  const detail = event?.failureReason || event?.suppressionReason || event?.providerResponse || "";
  if (!detail) return "";
  if (/no active channels configured/i.test(detail)) {
    return "Delivery skipped because this workspace does not have any enabled channels for this event yet.";
  }
  if (/suppressed by cooldown/i.test(detail)) {
    return "Delivery skipped because the alert is inside its cooldown window.";
  }
  return detail;
}

function formatEventContextLine(event, channel) {
  const channelLabel = channel?.name || (event?.status === "suppressed" ? "Delivery skipped" : "System");
  return `${formatSourceType(event?.sourceType)} | ${channelLabel} | ${formatEventType(event?.eventType)} | ${formatTimestamp(event?.createdAt)}`;
}

function formatSourceType(sourceType) {
  if (sourceType === "incident") return "Incident";
  if (sourceType === "monitor") return "Monitor";
  return "Test";
}

function getChannelHealthMeta(channel) {
  if (!channel?.lastTestAt && !channel?.lastDeliveryAt && !channel?.lastFailureAt) {
    return { label: "Never tested", className: "bg-[#2b323f] text-[#bcc5d2]" };
  }
  if (channel?.lastFailureAt && (!channel?.lastDeliveryAt || new Date(channel.lastFailureAt).getTime() > new Date(channel.lastDeliveryAt).getTime())) {
    return { label: "Needs attention", className: "bg-[#402025] text-[#f6b5a8]" };
  }
  return { label: "Healthy", className: "bg-[#123828] text-[#69e7ba]" };
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizePreferencesForForm(preference) {
  return {
    enabled: preference?.enabled ?? true,
    channelIds: Array.isArray(preference?.channelIds) ? preference.channelIds : [],
    triggers: {
      down_open: preference?.triggers?.down_open ?? true,
      degraded_open: preference?.triggers?.degraded_open ?? true,
      recovery: preference?.triggers?.recovery ?? true,
      incident_created: preference?.triggers?.incident_created ?? true,
      incident_resolved: preference?.triggers?.incident_resolved ?? true,
    },
  };
}

function normalizePolicyForForm(policy) {
  return {
    enabled: Boolean(policy?.enabled),
    channelIds: Array.isArray(policy?.channelIds) ? policy.channelIds : [],
    applyMode: policy?.applyMode === "selected" ? "selected" : "all",
    targetMonitorIds: Array.isArray(policy?.targetMonitorIds) ? policy.targetMonitorIds : [],
    triggers: {
      down_open: Boolean(policy?.triggers?.down_open),
      degraded_open: Boolean(policy?.triggers?.degraded_open),
      recovery: Boolean(policy?.triggers?.recovery),
    },
    severityMap: {
      down_open: "critical",
      degraded_open: "high",
      recovery: "info",
    },
    cooldownMinutes: Number.isFinite(policy?.cooldownMinutes) ? policy.cooldownMinutes : 0,
  };
}

function sanitizePolicyForRequest(policy, options = {}) {
  const allowScope = options.allowScope === true;
  return {
    enabled: Boolean(policy.enabled),
    channelIds: Array.isArray(policy.channelIds) ? policy.channelIds : [],
    applyMode: allowScope ? (policy.applyMode === "selected" ? "selected" : "all") : undefined,
    targetMonitorIds: allowScope && policy.applyMode === "selected" && Array.isArray(policy.targetMonitorIds)
      ? policy.targetMonitorIds
      : [],
    triggers: {
      down_open: Boolean(policy.triggers?.down_open),
      degraded_open: Boolean(policy.triggers?.degraded_open),
      recovery: Boolean(policy.triggers?.recovery),
    },
    severityMap: {
      down_open: "critical",
      degraded_open: "high",
      recovery: "info",
    },
    cooldownMinutes: Number.isFinite(policy.cooldownMinutes) ? policy.cooldownMinutes : 0,
  };
}

function describePolicyCoverage(policy, monitors) {
  if (policy.applyMode === "selected") {
    const count = Array.isArray(policy.targetMonitorIds) ? policy.targetMonitorIds.length : 0;
    return `${count} selected monitor${count === 1 ? "" : "s"}`;
  }
  return `${monitors.length} monitor${monitors.length === 1 ? "" : "s"} by default`;
}

function describeTriggerSelection(triggers) {
  const items = [];
  if (triggers?.down_open) items.push("Down");
  if (triggers?.degraded_open) items.push("Degraded");
  if (triggers?.recovery) items.push("Recovered");
  return items.length > 0 ? items.join(", ") : "No monitor alerts selected";
}

function describePolicyChannels(channelIds, channelMap) {
  if (!Array.isArray(channelIds) || channelIds.length === 0) return "No channels selected";
  const names = channelIds.map((channelId) => channelMap[channelId]?.name).filter(Boolean);
  if (names.length === 0) return "No channels selected";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
}

function truncateText(value, limit) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}
