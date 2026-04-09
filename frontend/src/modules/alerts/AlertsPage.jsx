import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  fetchMonitors,
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
  fromEmail: "",
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
const ALERT_EVENTS_PAGE_SIZE = 10;
const DEFERRED_MONITOR_LOAD_MS = 450;
// Events are now loaded in parallel with channels/policies, not deferred,
// so the 'Failed Deliveries' KPI resolves as soon as the page loads.

export default function AlertsPage() {
  const { user, logout, currentMembershipRole, workspace } = useAuth();
  const navigate = useNavigate();
  const isOwner = currentMembershipRole === "owner";

  const [monitors, setMonitors] = useState([]);
  const [channels, setChannels] = useState([]);
  const [defaultPolicy, setDefaultPolicy] = useState(POLICY_FORM_DEFAULTS);
  const [monitorPolicies, setMonitorPolicies] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testingChannelId, setTestingChannelId] = useState("");
  const [error, setError] = useState("");

  const [showChannelModal, setShowChannelModal] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState("");
  const [channelForm, setChannelForm] = useState(CHANNEL_FORM_DEFAULTS);

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
      const [channelItems, policySnapshot, eventItems] = await Promise.all([
        fetchAlertChannels(user),
        fetchAlertPolicies(user),
        fetchAlertEvents(user, 30),
      ]);

      const normalizedDefault = normalizePolicyForForm(policySnapshot?.defaultPolicy || POLICY_FORM_DEFAULTS);
      setChannels(Array.isArray(channelItems) ? channelItems : []);
      setDefaultPolicy(normalizedDefault);
      setDraftDefaultPolicy(normalizedDefault);
      setMonitorPolicies(Array.isArray(policySnapshot?.monitorPolicies) ? policySnapshot.monitorPolicies : []);
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

  const summary = useMemo(() => ({
    activeChannels: channels.filter((channel) => channel.enabled).length,
    defaultCoverage: defaultPolicy.applyMode === "selected"
      ? defaultPolicy.targetMonitorIds.length
      : (monitorsLoading && monitors.length === 0 ? "--" : monitors.length),
    overrides: monitorPolicies.length,
    failedEvents: eventsLoaded ? events.filter((event) => event.status === "failed").length : "--",
  }), [channels, defaultPolicy.applyMode, defaultPolicy.targetMonitorIds.length, events, eventsLoaded, monitorPolicies.length, monitors.length, monitorsLoading]);

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
  }

  function openCreateChannel() {
    resetChannelForm();
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
        name: channelForm.name.trim(),
        enabled: channelForm.enabled,
        config: channelForm.type === "email"
          ? {
            fromEmail: channelForm.fromEmail.trim(),
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
      setError(err?.message || "Could not save alert channel.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveDefaultPolicy(event) {
    event.preventDefault();
    if (!isOwner) return;
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
    if (!isOwner) return;
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08090b] text-[#f2f2f2] grid place-items-center">
        <p className="text-[#8d94a0]">Loading alerts...</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#08090b] text-[#f2f2f2] flex overflow-hidden">
      <aside className="hidden md:flex w-64 h-screen sticky top-0 overflow-hidden flex-col border-r border-[#22252b] bg-[#0f1114]">
        <div className="px-5 py-6 border-b border-[#22252b]">
          <h1 className="text-xl font-semibold tracking-tight">PingMaster</h1>
          <p className="text-[11px] uppercase tracking-[0.09em] text-[#8d94a0] mt-1">Web Monitor</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItem Icon={LayoutGrid} label="Dashboard" onClick={() => navigate("/dashboard")} />
          <NavItem Icon={AlertTriangle} label="Incidents" onClick={() => navigate("/incidents")} />
          <NavItem Icon={Siren} label="Alerts" active />
          <NavItem Icon={Globe} label="Status Page" onClick={() => navigate("/status-pages")} />
          <NavItem Icon={Users} label="Team" onClick={() => navigate("/team")} />
        </nav>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
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
            {isOwner ? (
              <button
                type="button"
                onClick={openCreateChannel}
                className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#121417] text-sm font-semibold inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Channel
              </button>
            ) : null}
            <button
              type="button"
              onClick={logout}
              className="h-10 px-3 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm"
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

          <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <SummaryCard label="Active Channels" value={summary.activeChannels} caption="Enabled delivery destinations" />
            <SummaryCard label="Default Coverage" value={summary.defaultCoverage} caption={defaultPolicy.applyMode === "selected" ? "Selected monitors use the main rule" : "All monitors use the main rule"} />
            <SummaryCard label="Custom Rules" value={summary.overrides} caption="Monitors with their own rule" />
            <SummaryCard label="Failed Deliveries" value={summary.failedEvents} caption="Recent channel failures" />
          </section>

          <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-medium text-[#edf2fb]">Delivery Channels</h2>
                <p className="text-sm text-[#8d94a0] mt-1">
                  {isOwner
                    ? "These shared workspace channels are managed by the owner and used by the alert rules below."
                    : "These shared workspace channels are managed by the owner. Members can review them here, but only the owner can change delivery routing."}
                </p>
              </div>
              {isOwner ? (
                <button
                  type="button"
                  onClick={openCreateChannel}
                  className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]"
                >
                  New Channel
                </button>
              ) : null}
            </div>

            {channels.length === 0 ? (
              <EmptyCard message="No channels configured yet." />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {channels.map((channel) => {
                  const meta = getChannelMeta(channel.type);
                  const health = getChannelHealthMeta(channel);
                  return (
                    <article key={channel.id} className="rounded-xl border border-[#252a33] bg-[#12161d] p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <meta.Icon className="w-4 h-4 text-[#9cb7ff]" />
                            <p className="text-sm font-medium text-[#edf2fb] truncate">{channel.name}</p>
                          </div>
                          <p className="text-xs text-[#8d94a0] mt-1">{meta.label}</p>
                        </div>
                        <span className={`text-[11px] px-2 py-1 rounded-full ${channel.enabled ? "bg-[#123828] text-[#69e7ba]" : "bg-[#2b323f] text-[#bcc5d2]"}`}>
                          {channel.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <p className="text-xs text-[#c9d1dd] break-words leading-relaxed">{describeChannelConfig(channel)}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#8d94a0]">
                        <span className={`px-2 py-1 rounded-full ${health.className}`}>{health.label}</span>
                        <span>Last success: {formatTimestamp(channel.lastDeliveryAt)}</span>
                        {channel.lastFailureAt ? <span>Last failure: {formatTimestamp(channel.lastFailureAt)}</span> : null}
                      </div>
                      {isOwner ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleSendTest(channel.id)}
                            disabled={testingChannelId === channel.id}
                            className="h-9 px-3 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea] disabled:opacity-50"
                          >
                            {testingChannelId === channel.id ? "Testing..." : "Send Test"}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditChannel(channel)}
                            className="h-9 px-3 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d7deea]"
                          >
                            Edit
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-[#252a33] bg-[#14181e] px-3 py-2 text-xs text-[#8d94a0]">
                          Owner managed
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-5">
            <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium">Default Alert Rule</h2>
                  <p className="text-sm text-[#8d94a0] mt-1">This is the shared workspace alert rule. Apply it to every monitor or only the ones you choose.</p>
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
                  {isOwner ? (
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

              <div className="rounded-lg border border-[#252a33] bg-[#12161d] px-4 py-3 text-sm text-[#9aa2af]">
                Incident opened and incident resolved notifications continue to go to all enabled channels so important operator updates are never hidden behind monitor policy settings.
              </div>
            </section>

            <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium">Custom Monitor Rules</h2>
                  <p className="text-sm text-[#8d94a0] mt-1">Use a custom rule only when one monitor should notify differently from the main rule.</p>
                </div>
                {isOwner ? (
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
                          if (isOwner) openEditOverride(policy);
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

          <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
            <div className="mb-4">
              <h2 className="text-sm font-medium">Recent Alert Activity</h2>
              <p className="text-sm text-[#8d94a0] mt-1">This feed loads after the page settles. Only the latest 10 items are shown per page, and you can open any item for full details.</p>
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
                            <p className="text-sm font-medium text-[#edf2fb]">{truncateText(event.title, 82)}</p>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusMeta.className}`}>{statusMeta.label}</span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full ${severityMeta.className}`}>{severityMeta.label}</span>
                          </div>
                          <p className="text-xs text-[#8d94a0] mt-1">
                            {formatSourceType(event.sourceType)} | {channel?.name || "System"} | {formatEventType(event.eventType)} | {formatTimestamp(event.createdAt)}
                          </p>
                          <p className="text-sm text-[#cfd6e3] mt-2">{truncateText(event.message, 160)}</p>
                          {(event.failureReason || event.suppressionReason || event.providerResponse) ? (
                            <p className="text-xs text-[#7f8793] mt-2">
                              {truncateText(event.failureReason || event.suppressionReason || event.providerResponse, 120)}
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
        </div>
      </main>

      {showChannelModal && (
        <Modal title={editingChannelId ? "Edit Channel" : "Add Channel"} onClose={() => { setShowChannelModal(false); resetChannelForm(); }}>
          <form onSubmit={handleSaveChannel} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Channel Type">
                <select
                  value={channelForm.type}
                  onChange={(event) => setChannelForm((prev) => ({
                    ...prev,
                    type: event.target.value,
                    webhookUrl: "",
                    fromEmail: "",
                    recipientEmails: "",
                  }))}
                  disabled={Boolean(editingChannelId)}
                  className="w-full h-11 rounded-lg border border-[#252a33] bg-[#14181e] px-3 text-sm"
                >
                  {CHANNEL_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Name">
                <input
                  value={channelForm.name}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full h-11 rounded-lg border border-[#252a33] bg-[#14181e] px-3 text-sm"
                  placeholder="Primary Discord"
                />
              </Field>
            </div>

            {channelForm.type === "email" ? (
              <div className="grid grid-cols-1 gap-3">
                <Field label="From Email">
                  <input
                    value={channelForm.fromEmail}
                    onChange={(event) => setChannelForm((prev) => ({ ...prev, fromEmail: event.target.value }))}
                    className="w-full h-11 rounded-lg border border-[#252a33] bg-[#14181e] px-3 text-sm"
                    placeholder="alerts@yourdomain.com"
                  />
                </Field>
                <Field label="Recipient Emails">
                  <textarea
                    value={channelForm.recipientEmails}
                    onChange={(event) => setChannelForm((prev) => ({ ...prev, recipientEmails: event.target.value }))}
                    className="w-full min-h-28 rounded-lg border border-[#252a33] bg-[#14181e] px-3 py-3 text-sm"
                    placeholder="ops@example.com, founder@example.com"
                  />
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
  const detailRows = [
    ["Title", event.title],
    ["Status", statusMeta.label],
    ["Severity", severityMeta.label],
    ["Source", formatSourceType(event.sourceType)],
    ["Event", formatEventType(event.eventType)],
    ["Channel", channel?.name || "System"],
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
        <p className="text-sm text-[#cfd6e3] mt-3 whitespace-pre-line break-words">{event.message || "--"}</p>
      </div>

      {(event.failureReason || event.suppressionReason || event.providerResponse) && (
        <div className="rounded-lg border border-[#252a33] bg-[#12161d] p-4">
          <p className="text-sm font-medium text-[#edf2fb]">Delivery Result</p>
          <p className="text-sm text-[#cfd6e3] mt-3 whitespace-pre-line break-words">
            {event.failureReason || event.suppressionReason || event.providerResponse}
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

function SummaryCard({ label, value, caption }) {
  return (
    <article className="bg-[#0f1217] border border-[#22252b] rounded-xl p-3">
      <p className="text-sm uppercase tracking-[0.09em] text-[#8d94a0]">{label}</p>
      <div className="mt-1.5 min-h-[32px] flex items-center">
        {value === "--" ? (
          <span
            className="loading-metric-block h-[18px] w-[68px] rounded-md"
            aria-label={`${label} loading`}
          />
        ) : (
          <p className="text-2xl font-semibold text-[#edf3fb]">{value}</p>
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
      <div className="w-full max-w-4xl rounded-2xl border border-[#252a33] bg-[#0f1217] shadow-2xl max-h-[90vh] overflow-hidden">
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
