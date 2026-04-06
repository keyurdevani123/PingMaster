import { sendViaGmail } from "../lib/smtp.js";
import {
  ALERT_CHANNEL_LIST_MAX_LIMIT,
  ALERT_EVENT_LIST_MAX_LIMIT,
} from "../config/constants.js";
import {
  ensureWorkspaceMembership,
  ensureWorkspaceScopedRecord,
  getWorkspaceCollectionIds,
  listWorkspaceMembers,
} from "./workspaces.js";

const DEFAULT_TRIGGERS = {
  down_open: true,
  degraded_open: true,
  recovery: true,
};

const DEFAULT_SEVERITY_MAP = {
  down_open: "critical",
  degraded_open: "high",
  recovery: "info",
};

const DEFAULT_PREFERENCE_TRIGGERS = {
  down_open: true,
  degraded_open: true,
  recovery: true,
  incident_created: true,
  incident_resolved: true,
};

const SEVERITY_EMOJI = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

const DISCORD_COLOR_BY_SEVERITY = {
  critical: 0xed4245,
  high: 0xf39c12,
  medium: 0x3498db,
  low: 0x95a5a6,
  info: 0x2ecc71,
};

export function createAlertRuntimeCache() {
  return {
    channelById: new Map(),
    policyById: new Map(),
    defaultPolicyIdByUser: new Map(),
    monitorPolicyIdByMonitor: new Map(),
    preferenceByWorkspaceUser: new Map(),
  };
}

export function buildPolicyDefaults(userId, workspaceId, scope = "global", monitorId = null) {
  const nowIso = new Date().toISOString();
  return {
    id: `${scope === "global" ? "apd" : "apm"}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    workspaceId,
    scope,
    monitorId,
    enabled: true,
    channelIds: [],
    applyMode: scope === "global" ? "all" : "monitor",
    targetMonitorIds: [],
    triggers: { ...DEFAULT_TRIGGERS },
    severityMap: { ...DEFAULT_SEVERITY_MAP },
    cooldownMinutes: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function normalizePolicyInput(userId, workspaceId, body, scope = "global", monitorId = null, existing = null) {
  const base = existing || buildPolicyDefaults(userId, workspaceId, scope, monitorId);
  const channelIds = Array.isArray(body?.channelIds)
    ? [...new Set(body.channelIds.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))]
    : base.channelIds;

  const cooldownRaw = Number.parseInt(String(body?.cooldownMinutes ?? base.cooldownMinutes ?? 0), 10);
  const cooldownMinutes = Number.isFinite(cooldownRaw) ? Math.max(0, Math.min(cooldownRaw, 1440)) : 0;
  const applyMode = scope === "global"
    ? (body?.applyMode === "selected" ? "selected" : "all")
    : "monitor";
  const targetMonitorIds = scope === "global" && applyMode === "selected"
    ? (Array.isArray(body?.targetMonitorIds)
      ? [...new Set(body.targetMonitorIds.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))]
      : Array.isArray(base.targetMonitorIds)
        ? base.targetMonitorIds
        : [])
    : [];

  return {
    ...base,
    userId,
    workspaceId,
    scope,
    monitorId,
    enabled: body?.enabled != null ? Boolean(body.enabled) : base.enabled,
    channelIds,
    applyMode,
    targetMonitorIds,
    triggers: normalizeTriggers(body?.triggers, base.triggers),
    severityMap: normalizeSeverityMap(body?.severityMap, base.severityMap),
    cooldownMinutes,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeChannelPayload(userId, workspaceId, body, existing = null) {
  const type = existing?.type || normalizeChannelType(body?.type);
  if (!type) {
    return { ok: false, error: "type must be discord, slack, or email" };
  }

  const name = typeof body?.name === "string" ? body.name.trim() : existing?.name || "";
  if (!name) {
    return { ok: false, error: "name is required" };
  }

  const enabled = body?.enabled != null ? Boolean(body.enabled) : existing?.enabled ?? true;
  const configResult = normalizeChannelConfig(type, body?.config, existing?.config);
  if (!configResult.ok) return configResult;

  return {
    ok: true,
    channel: {
      id: existing?.id || `ach_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      workspaceId,
      type,
      name,
      enabled,
      config: configResult.config,
      lastTestAt: existing?.lastTestAt || null,
      lastDeliveryAt: existing?.lastDeliveryAt || null,
      lastFailureAt: existing?.lastFailureAt || null,
      lastFailureReason: existing?.lastFailureReason || "",
      consecutiveFailures: Number.isFinite(existing?.consecutiveFailures) ? existing.consecutiveFailures : 0,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function buildUserAlertPreference(userId, workspaceId, existing = null) {
  const nowIso = new Date().toISOString();
  return {
    id: existing?.id || `aup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    workspaceId,
    enabled: existing?.enabled ?? true,
    channelIds: Array.isArray(existing?.channelIds) ? existing.channelIds : [],
    triggers: { ...DEFAULT_PREFERENCE_TRIGGERS, ...(existing?.triggers || {}) },
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

export function normalizeUserAlertPreferenceInput(userId, workspaceId, body, existing = null) {
  const base = buildUserAlertPreference(userId, workspaceId, existing);
  const channelIds = Array.isArray(body?.channelIds)
    ? [...new Set(body.channelIds.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))]
    : base.channelIds;

  const triggers = { ...DEFAULT_PREFERENCE_TRIGGERS, ...(base.triggers || {}) };
  for (const key of Object.keys(DEFAULT_PREFERENCE_TRIGGERS)) {
    if (body?.triggers?.[key] != null) {
      triggers[key] = Boolean(body.triggers[key]);
    }
  }

  return {
    ...base,
    enabled: body?.enabled != null ? Boolean(body.enabled) : base.enabled,
    channelIds,
    triggers,
    updatedAt: new Date().toISOString(),
  };
}

export async function listAlertChannels(redis, workspaceId, ownerUserId = null) {
  if (!workspaceId) {
    const ids = await redis.lrange(`user:${ownerUserId}:alert_channels`, 0, ALERT_CHANNEL_LIST_MAX_LIMIT - 1);
    if (!Array.isArray(ids) || ids.length === 0) return [];

    const seen = new Set();
    const channels = [];
    for (const id of ids) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const channel = await redis.get(`alert_channel:${id}`);
      if (channel?.userId === ownerUserId) channels.push(channel);
    }
    return channels;
  }

  const ids = await getWorkspaceCollectionIds(
    redis,
    workspaceId,
    "alert_channels",
    ownerUserId ? `user:${ownerUserId}:alert_channels` : null,
    ALERT_CHANNEL_LIST_MAX_LIMIT - 1
  );
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const seen = new Set();
  const channels = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const channel = await redis.get(`alert_channel:${id}`);
    if (!channel?.userId) continue;
    if (ownerUserId && channel.userId !== ownerUserId) continue;
    if (channel.workspaceId && channel.workspaceId !== workspaceId) continue;
    await ensureWorkspaceScopedRecord(redis, `alert_channel:${id}`, channel, workspaceId, "alert_channels");
    channels.push(channel);
  }
  return channels;
}

export async function listAlertEvents(redis, userId, workspaceId, limit = ALERT_EVENT_LIST_MAX_LIMIT) {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, ALERT_EVENT_LIST_MAX_LIMIT)) : ALERT_EVENT_LIST_MAX_LIMIT;
  if (!workspaceId) {
    const events = await redis.lrange(`user:${userId}:alert_events`, 0, safeLimit - 1);
    return Array.isArray(events) ? events : [];
  }

  let events = await redis.lrange(`workspace:${workspaceId}:alert_events`, 0, safeLimit - 1);
  if (Array.isArray(events) && events.length > 0) return events;

  events = await redis.lrange(`user:${userId}:alert_events`, 0, safeLimit - 1);
  if (!Array.isArray(events) || events.length === 0) return [];

  for (const entry of [...events].reverse()) {
    await redis.lpush(`workspace:${workspaceId}:alert_events`, entry);
  }
  await redis.ltrim(`workspace:${workspaceId}:alert_events`, 0, ALERT_EVENT_LIST_MAX_LIMIT - 1);
  return events;
}

export async function recordAlertEvent(redis, event) {
  const entry = {
    id: `aev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: event.userId,
    workspaceId: event.workspaceId || null,
    sourceType: event.sourceType || "monitor",
    monitorId: event.monitorId || null,
    incidentId: event.incidentId || null,
    channelId: event.channelId || null,
    eventType: event.eventType,
    severity: event.severity,
    status: event.status,
    title: event.title,
    message: event.message,
    providerResponse: event.providerResponse || "",
    failureReason: event.failureReason || "",
    suppressionReason: event.suppressionReason || "",
    createdAt: event.createdAt || new Date().toISOString(),
  };

  await redis.lpush(`user:${event.userId}:alert_events`, entry);
  await redis.ltrim(`user:${event.userId}:alert_events`, 0, ALERT_EVENT_LIST_MAX_LIMIT - 1);
  if (entry.workspaceId) {
    await redis.lpush(`workspace:${entry.workspaceId}:alert_events`, entry);
    await redis.ltrim(`workspace:${entry.workspaceId}:alert_events`, 0, ALERT_EVENT_LIST_MAX_LIMIT - 1);
  }
  return entry;
}

export async function saveAlertChannel(redis, channel, runtimeCache = null) {
  await redis.set(`alert_channel:${channel.id}`, channel);
  await redis.lrem(`user:${channel.userId}:alert_channels`, 0, channel.id);
  await redis.lpush(`user:${channel.userId}:alert_channels`, channel.id);
  if (channel.workspaceId) {
    await ensureWorkspaceMembership(redis, channel.workspaceId, "alert_channels", channel.id);
  }
  if (runtimeCache?.channelById) runtimeCache.channelById.set(channel.id, channel);
  return channel;
}

export async function loadUserAlertPreference(redis, workspaceId, userId, runtimeCache = null) {
  const cacheKey = `${workspaceId}:${userId}`;
  if (runtimeCache?.preferenceByWorkspaceUser?.has(cacheKey)) {
    return runtimeCache.preferenceByWorkspaceUser.get(cacheKey);
  }

  const preference = await redis.get(`alert_preference:${workspaceId}:${userId}`);
  if (runtimeCache?.preferenceByWorkspaceUser) {
    runtimeCache.preferenceByWorkspaceUser.set(cacheKey, preference || null);
  }
  return preference || null;
}

export async function saveUserAlertPreference(redis, preference, runtimeCache = null) {
  await redis.set(`alert_preference:${preference.workspaceId}:${preference.userId}`, preference);
  await ensureWorkspaceMembership(redis, preference.workspaceId, "alert_preferences", preference.userId);
  if (runtimeCache?.preferenceByWorkspaceUser) {
    runtimeCache.preferenceByWorkspaceUser.set(`${preference.workspaceId}:${preference.userId}`, preference);
  }
  return preference;
}

export async function loadAlertChannel(redis, channelId, runtimeCache = null) {
  if (runtimeCache?.channelById?.has(channelId)) {
    return runtimeCache.channelById.get(channelId);
  }

  const channel = await redis.get(`alert_channel:${channelId}`);
  if (runtimeCache?.channelById) runtimeCache.channelById.set(channelId, channel || null);
  return channel;
}

export async function getPoliciesSnapshot(redis, userId, workspaceId) {
  const defaultPolicyId = workspaceId
    ? await redis.get(`workspace:${workspaceId}:alert_policy:default`)
      || await redis.get(`user:${userId}:alert_policy:default`)
    : await redis.get(`user:${userId}:alert_policy:default`);
  const defaultPolicy = defaultPolicyId ? await redis.get(`alert_policy:${defaultPolicyId}`) : null;

  const monitorPolicyIds = workspaceId
    ? await getWorkspaceCollectionIds(
      redis,
      workspaceId,
      "alert_policies",
      `user:${userId}:alert_policies:monitors`,
      ALERT_CHANNEL_LIST_MAX_LIMIT - 1
    )
    : await redis.lrange(`user:${userId}:alert_policies:monitors`, 0, ALERT_CHANNEL_LIST_MAX_LIMIT - 1);
  const seen = new Set();
  const monitorPolicies = [];
  if (Array.isArray(monitorPolicyIds)) {
    for (const id of monitorPolicyIds) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const policy = await redis.get(`alert_policy:${id}`);
      if (policy?.scope === "monitor" && (!workspaceId || policy.workspaceId === workspaceId)) {
        await ensureWorkspaceScopedRecord(redis, `alert_policy:${id}`, policy, workspaceId, "alert_policies");
        monitorPolicies.push(policy);
      }
    }
  }

  return {
    defaultPolicy: defaultPolicy || buildPolicyDefaults(userId, workspaceId || `ws_${userId}`, "global"),
    monitorPolicies,
  };
}

export async function getUserAlertPreferenceSnapshot(redis, userId, workspaceId) {
  const preference = await loadUserAlertPreference(redis, workspaceId, userId);
  if (preference) return { ...preference, isSaved: true };
  return { ...buildUserAlertPreference(userId, workspaceId), isSaved: false };
}

export async function saveDefaultPolicy(redis, policy) {
  await redis.set(`alert_policy:${policy.id}`, policy);
  await redis.set(`user:${policy.userId}:alert_policy:default`, policy.id);
  await redis.set(`workspace:${policy.workspaceId}:alert_policy:default`, policy.id);
  await ensureWorkspaceMembership(redis, policy.workspaceId, "alert_policies", policy.id);
  return policy;
}

export async function saveMonitorPolicy(redis, policy) {
  await redis.set(`alert_policy:${policy.id}`, policy);
  await redis.set(`monitor:${policy.monitorId}:alert_policy`, policy.id);
  await redis.lrem(`user:${policy.userId}:alert_policies:monitors`, 0, policy.id);
  await redis.lpush(`user:${policy.userId}:alert_policies:monitors`, policy.id);
  await ensureWorkspaceMembership(redis, policy.workspaceId, "alert_policies", policy.id);
  return policy;
}

export async function loadMonitorPolicy(redis, monitorId, runtimeCache = null) {
  if (runtimeCache?.monitorPolicyIdByMonitor?.has(monitorId)) {
    const policyId = runtimeCache.monitorPolicyIdByMonitor.get(monitorId);
    return policyId ? loadAlertPolicyById(redis, policyId, runtimeCache) : null;
  }

  const policyId = await redis.get(`monitor:${monitorId}:alert_policy`);
  if (runtimeCache?.monitorPolicyIdByMonitor) {
    runtimeCache.monitorPolicyIdByMonitor.set(monitorId, policyId || null);
  }
  if (!policyId) return null;
  return loadAlertPolicyById(redis, policyId, runtimeCache);
}

export async function loadDefaultPolicy(redis, userId, workspaceId, runtimeCache = null) {
  let policyId = null;
  const policyCacheKey = `${workspaceId || "legacy"}:${userId}`;
  if (runtimeCache?.defaultPolicyIdByUser?.has(policyCacheKey)) {
    policyId = runtimeCache.defaultPolicyIdByUser.get(policyCacheKey);
  } else {
    policyId = workspaceId
      ? await redis.get(`workspace:${workspaceId}:alert_policy:default`)
        || await redis.get(`user:${userId}:alert_policy:default`)
      : await redis.get(`user:${userId}:alert_policy:default`);
    if (runtimeCache?.defaultPolicyIdByUser) {
      runtimeCache.defaultPolicyIdByUser.set(policyCacheKey, policyId || null);
    }
  }

  if (!policyId) return null;
  return loadAlertPolicyById(redis, policyId, runtimeCache);
}

export async function resolveApplicablePolicy(redis, userId, workspaceId, monitorId, runtimeCache = null) {
  const monitorPolicy = await loadMonitorPolicy(redis, monitorId, runtimeCache);
  if (monitorPolicy) return monitorPolicy;
  const defaultPolicy = await loadDefaultPolicy(redis, userId, workspaceId, runtimeCache);
  if (!defaultPolicy) return null;
  if (defaultPolicy.scope === "global" && defaultPolicy.applyMode === "selected") {
    const targetIds = Array.isArray(defaultPolicy.targetMonitorIds) ? defaultPolicy.targetMonitorIds : [];
    if (!targetIds.includes(monitorId)) {
      return null;
    }
  }
  return defaultPolicy;
}

export async function processMonitorAlert(redis, monitor, result, previousStatus, env, runtimeCache = null) {
  const currentState = await redis.get(`alert_state:${monitor.id}`);
  const previousAlertStatus = currentState?.lastStatus || previousStatus || "PENDING";
  const previousFailing = isFailureStatus(previousAlertStatus);
  const currentFailing = isFailureStatus(result.status);

  let eventType = null;
  if (!previousFailing && currentFailing) {
    eventType = result.status === "DOWN" ? "down_open" : "degraded_open";
  } else if (previousFailing && !currentFailing) {
    eventType = "recovery";
  }

  if (!eventType) {
    await writeAlertState(redis, monitor, result, currentState, null);
    return;
  }

  const policy = await resolveApplicablePolicy(
    redis,
    monitor.userId,
    monitor.workspaceId || null,
    monitor.id,
    runtimeCache
  );
  const severity = getSeverityForEvent(policy?.severityMap, eventType);
  const envelope = buildMonitorAlertEnvelope(monitor, result, eventType, severity, env);

  if (!policy || !policy.enabled || !policy.triggers?.[eventType]) {
    await recordAlertEvent(redis, buildAlertEvent({
      userId: monitor.userId,
      workspaceId: monitor.workspaceId || null,
      sourceType: "monitor",
      monitorId: monitor.id,
      channelId: null,
      eventType,
      severity,
      status: "suppressed",
      title: envelope.title,
      message: envelope.text,
      suppressionReason: policy ? "Policy disabled or trigger off" : "No applicable policy",
      providerResponse: policy ? "Policy disabled or trigger off" : "No applicable policy",
    }));

    await writeAlertState(redis, monitor, result, currentState, null);
    return;
  }

  const cooldownMinutes = Number.isFinite(policy.cooldownMinutes) ? policy.cooldownMinutes : 0;
  const lastEventAt = currentState?.lastEventAt ? new Date(currentState.lastEventAt).getTime() : null;
  if (
    cooldownMinutes > 0
    && currentState?.lastEventType === eventType
    && Number.isFinite(lastEventAt)
    && Date.now() - lastEventAt < cooldownMinutes * 60 * 1000
  ) {
    await recordAlertEvent(redis, buildAlertEvent({
      userId: monitor.userId,
      workspaceId: monitor.workspaceId || null,
      sourceType: "monitor",
      monitorId: monitor.id,
      channelId: null,
      eventType,
      severity,
      status: "suppressed",
      title: envelope.title,
      message: envelope.text,
      suppressionReason: "Suppressed by cooldown",
      providerResponse: "Suppressed by cooldown",
    }));

    await writeAlertState(redis, monitor, result, currentState, null);
    return;
  }

  const recipients = await resolveAlertRecipients(redis, {
    workspaceId: monitor.workspaceId || null,
    ownerUserId: policy.userId || monitor.userId,
    fallbackChannelIds: policy.channelIds || [],
    eventType,
  }, runtimeCache);

  if (recipients.length === 0) {
    await recordAlertEvent(redis, buildAlertEvent({
      userId: monitor.userId,
      workspaceId: monitor.workspaceId || null,
      sourceType: "monitor",
      monitorId: monitor.id,
      channelId: null,
      eventType,
      severity,
      status: "suppressed",
      title: envelope.title,
      message: envelope.text,
      suppressionReason: "No active channels configured",
      providerResponse: "No active channels configured",
    }));

    await writeAlertState(redis, monitor, result, currentState, null);
    return;
  }

  await deliverAlertEnvelopeToRecipients(redis, recipients, envelope, {
    workspaceId: monitor.workspaceId || null,
    sourceType: "monitor",
    monitorId: monitor.id,
    incidentId: null,
    eventType,
    severity,
  }, env, runtimeCache);

  await writeAlertState(redis, monitor, result, currentState, eventType);
}

export async function notifyIncidentLifecycle(redis, incident, lifecycleType, env, runtimeCache = null) {
  const workspace = incident.workspaceId
    ? await redis.get(`workspace:${incident.workspaceId}`)
    : null;
  const severity = lifecycleType === "incident_created"
    ? normalizeIncidentSeverityForAlert(incident.severity)
    : "info";
  const envelope = buildIncidentAlertEnvelope(incident, lifecycleType, severity, env);
  const recipients = await resolveAlertRecipients(redis, {
    workspaceId: incident.workspaceId || null,
    ownerUserId: workspace?.ownerUserId || incident.userId,
    fallbackChannelIds: await resolveOwnerFallbackChannelIds(redis, workspace?.ownerUserId || incident.userId, incident.workspaceId || null),
    eventType: lifecycleType,
  }, runtimeCache);

  if (recipients.length === 0) {
    await recordAlertEvent(redis, buildAlertEvent({
      userId: incident.userId,
      workspaceId: incident.workspaceId || null,
      sourceType: "incident",
      monitorId: incident.monitorId || null,
      incidentId: incident.id,
      channelId: null,
      eventType: lifecycleType,
      severity,
      status: "suppressed",
      title: envelope.title,
      message: envelope.text,
      suppressionReason: "No active channels configured",
      providerResponse: "No active channels configured",
    }));
    return;
  }

  await deliverAlertEnvelopeToRecipients(redis, recipients, envelope, {
    workspaceId: incident.workspaceId || null,
    sourceType: "incident",
    monitorId: incident.monitorId || null,
    incidentId: incident.id,
    eventType: lifecycleType,
    severity,
  }, env, runtimeCache);
}

export async function sendTestAlert(redis, channel, userId, env) {
  const envelope = buildTestAlertEnvelope(channel, env);
  try {
    const providerResponse = await deliverChannelMessage(channel, envelope, env);
    await updateChannelHealth(redis, channel, {
      test: true,
      success: true,
      detail: providerResponse,
    });
    return recordAlertEvent(redis, buildAlertEvent({
      userId,
      workspaceId: channel.workspaceId || null,
      sourceType: "test",
      monitorId: null,
      incidentId: null,
      channelId: channel.id,
      eventType: "test",
      severity: "info",
      status: "sent",
      title: envelope.title,
      message: envelope.text,
      providerResponse,
    }));
  } catch (err) {
    const failureReason = err?.message || "Delivery failed";
    await updateChannelHealth(redis, channel, {
      test: true,
      success: false,
      detail: failureReason,
    });
    return recordAlertEvent(redis, buildAlertEvent({
      userId,
      workspaceId: channel.workspaceId || null,
      sourceType: "test",
      monitorId: null,
      incidentId: null,
      channelId: channel.id,
      eventType: "test",
      severity: "info",
      status: "failed",
      title: envelope.title,
      message: envelope.text,
      providerResponse: failureReason,
      failureReason,
    }));
  }
}

async function loadAlertPolicyById(redis, policyId, runtimeCache = null) {
  if (runtimeCache?.policyById?.has(policyId)) {
    return runtimeCache.policyById.get(policyId);
  }
  const policy = await redis.get(`alert_policy:${policyId}`);
  if (runtimeCache?.policyById) runtimeCache.policyById.set(policyId, policy || null);
  return policy;
}

async function writeAlertState(redis, monitor, result, currentState, eventType) {
  await redis.set(`alert_state:${monitor.id}`, {
    monitorId: monitor.id,
    userId: monitor.userId,
    lastStatus: result.status,
    lastChecked: result.timestamp,
    lastEventType: (eventType ?? currentState?.lastEventType) || null,
    lastEventAt: eventType ? new Date().toISOString() : currentState?.lastEventAt || null,
  });
}

async function resolveAlertRecipients(redis, input, runtimeCache = null) {
  const workspaceId = input.workspaceId || null;
  const ownerUserId = input.ownerUserId || null;
  const eventType = input.eventType;
  const fallbackChannelIds = Array.isArray(input.fallbackChannelIds) ? input.fallbackChannelIds : [];

  if (!workspaceId) {
    const channels = [];
    for (const channelId of fallbackChannelIds) {
      const channel = await loadAlertChannel(redis, channelId, runtimeCache);
      if (channel?.enabled) channels.push(channel);
    }
    return channels.length > 0 && ownerUserId ? [{ userId: ownerUserId, channels }] : [];
  }

  const members = await listWorkspaceMembers(redis, workspaceId);
  const recipients = [];
  for (const member of members) {
    let channelIds = [];
    const preference = await loadUserAlertPreference(redis, workspaceId, member.userId, runtimeCache);

    if (preference) {
      if (!preference.enabled || !preference.triggers?.[eventType]) continue;
      channelIds = Array.isArray(preference.channelIds) ? preference.channelIds : [];
    } else if (member.userId === ownerUserId) {
      channelIds = fallbackChannelIds;
    } else {
      continue;
    }

    const channels = [];
    for (const channelId of channelIds) {
      const channel = await loadAlertChannel(redis, channelId, runtimeCache);
      if (!channel?.enabled) continue;
      if (channel.userId !== member.userId) continue;
      if (channel.workspaceId && channel.workspaceId !== workspaceId) continue;
      channels.push(channel);
    }

    if (channels.length > 0) {
      recipients.push({ userId: member.userId, channels });
    }
  }

  return recipients;
}

async function resolveOwnerFallbackChannelIds(redis, ownerUserId, workspaceId) {
  const defaultPolicy = await loadDefaultPolicy(redis, ownerUserId, workspaceId);
  return Array.isArray(defaultPolicy?.channelIds) ? defaultPolicy.channelIds : [];
}

async function deliverAlertEnvelope(redis, channels, envelope, eventMeta, env, runtimeCache = null) {
  for (const channel of channels) {
    try {
      const providerResponse = await deliverChannelMessage(channel, envelope, env);
      await updateChannelHealth(redis, channel, {
        test: eventMeta.sourceType === "test",
        success: true,
        detail: providerResponse,
      }, runtimeCache);
      await recordAlertEvent(redis, buildAlertEvent({
        ...eventMeta,
        channelId: channel.id,
        status: "sent",
        title: envelope.title,
        message: envelope.text,
        providerResponse,
      }));
    } catch (err) {
      const failureReason = err?.message || "Delivery failed";
      await updateChannelHealth(redis, channel, {
        test: eventMeta.sourceType === "test",
        success: false,
        detail: failureReason,
      }, runtimeCache);
      await recordAlertEvent(redis, buildAlertEvent({
        ...eventMeta,
        channelId: channel.id,
        status: "failed",
        title: envelope.title,
        message: envelope.text,
        providerResponse: failureReason,
        failureReason,
      }));
    }
  }
}

async function deliverAlertEnvelopeToRecipients(redis, recipients, envelope, eventMeta, env, runtimeCache = null) {
  for (const recipient of recipients) {
    await deliverAlertEnvelope(redis, recipient.channels, envelope, {
      ...eventMeta,
      userId: recipient.userId,
    }, env, runtimeCache);
  }
}

async function updateChannelHealth(redis, channel, result, runtimeCache = null) {
  const nowIso = new Date().toISOString();
  const next = {
    ...channel,
    lastTestAt: result.test ? nowIso : channel.lastTestAt || null,
    lastDeliveryAt: result.success ? nowIso : channel.lastDeliveryAt || null,
    lastFailureAt: result.success ? channel.lastFailureAt || null : nowIso,
    lastFailureReason: result.success ? "" : String(result.detail || "Delivery failed"),
    consecutiveFailures: result.success
      ? 0
      : Math.max(0, Number.isFinite(channel.consecutiveFailures) ? channel.consecutiveFailures : 0) + 1,
    updatedAt: nowIso,
  };
  await saveAlertChannel(redis, next, runtimeCache);
  return next;
}

function normalizeTriggers(input, fallback = DEFAULT_TRIGGERS) {
  const next = { ...DEFAULT_TRIGGERS, ...(fallback || {}) };
  for (const key of Object.keys(DEFAULT_TRIGGERS)) {
    if (input?.[key] != null) next[key] = Boolean(input[key]);
  }
  return next;
}

function normalizeSeverityMap(input, fallback = DEFAULT_SEVERITY_MAP) {
  const next = { ...DEFAULT_SEVERITY_MAP, ...(fallback || {}) };
  for (const key of Object.keys(DEFAULT_SEVERITY_MAP)) {
    const value = typeof input?.[key] === "string" ? input[key].trim().toLowerCase() : null;
    if (["critical", "high", "medium", "low", "info"].includes(value)) {
      next[key] = value;
    }
  }
  return next;
}

function normalizeChannelType(value) {
  const type = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["discord", "slack", "email"].includes(type) ? type : "";
}

function normalizeChannelConfig(type, input, fallback = {}) {
  if (type === "discord" || type === "slack") {
    const webhookUrl = typeof input?.webhookUrl === "string" ? input.webhookUrl.trim() : (fallback?.webhookUrl || "");
    if (!isValidHttpUrl(webhookUrl)) {
      return { ok: false, error: `${type} webhookUrl is required` };
    }
    return { ok: true, config: { webhookUrl } };
  }

  const provider = "resend";
  const fromEmail = typeof input?.fromEmail === "string" ? input.fromEmail.trim() : (fallback?.fromEmail || "");
  const recipientEmails = Array.isArray(input?.recipientEmails)
    ? [...new Set(input.recipientEmails.map((value) => String(value).trim()).filter(Boolean))]
    : Array.isArray(fallback?.recipientEmails) ? fallback.recipientEmails : [];

  if (!isValidEmail(fromEmail)) {
    return { ok: false, error: "email fromEmail must be valid" };
  }
  if (recipientEmails.length === 0 || recipientEmails.some((value) => !isValidEmail(value))) {
    return { ok: false, error: "email recipientEmails must contain valid email addresses" };
  }

  return {
    ok: true,
    config: { provider, fromEmail, recipientEmails },
  };
}

function isFailureStatus(status) {
  return status === "DOWN" || status === "UP_RESTRICTED";
}

function getSeverityForEvent(severityMap, eventType) {
  return severityMap?.[eventType] || DEFAULT_SEVERITY_MAP[eventType] || "info";
}

function normalizeIncidentSeverityForAlert(severity) {
  return ["critical", "high", "medium", "low", "info"].includes(severity) ? severity : "high";
}

function buildMonitorAlertEnvelope(monitor, result, eventType, severity, env) {
  const prettyEvent = formatMonitorEvent(eventType);
  const prettyStatus = formatMonitorStatus(result.status);
  const monitorLink = buildAppLink(env, `/monitors/${monitor.id}`);
  const facts = [
    { label: "Event", value: prettyEvent },
    { label: "Severity", value: formatSeverity(severity) },
    { label: "Monitor", value: monitor.name || monitor.id },
    { label: "URL", value: monitor.url || "--" },
    { label: "Status", value: prettyStatus },
    { label: "Monitor Type", value: monitor.type === "child" ? "Child monitor" : "Primary monitor" },
    { label: "Checked At", value: formatTimestamp(result.timestamp) },
    { label: "Latency", value: formatLatency(result.latency) },
    { label: "Status Code", value: result.statusCode != null ? String(result.statusCode) : "--" },
    { label: "Error Type", value: result.errorType && result.errorType !== "NONE" ? humanizeCode(result.errorType) : "None" },
  ];

  const sections = [
    {
      title: "What happened",
      body: eventType === "recovery"
        ? "PingMaster finished the retry sequence and the monitor is healthy again."
        : "PingMaster finished all retry attempts and confirmed this state change.",
    },
  ];

  return finalizeEnvelope({
    sourceType: "monitor",
    eventType,
    severity,
    title: buildMonitorAlertTitle(monitor, eventType),
    subject: `[PingMaster] ${buildMonitorAlertTitle(monitor, eventType)}`,
    summary: `${monitor.name} is currently ${prettyStatus.toLowerCase()}.`,
    facts,
    sections,
    links: monitorLink ? [{ label: "Open monitor", url: monitorLink }] : [],
    footer: "PingMaster monitor alert",
  });
}

function buildIncidentAlertEnvelope(incident, lifecycleType, severity, env) {
  const incidentLink = buildAppLink(env, `/incidents/${incident.id}`);
  const monitorLink = incident.monitorId ? buildAppLink(env, `/monitors/${incident.monitorId}`) : null;
  const title = lifecycleType === "incident_created"
    ? `${incident.code}: ${incident.title}`
    : `${incident.code} resolved: ${incident.title}`;
  const subjectPrefix = lifecycleType === "incident_created" ? "Incident opened" : "Incident resolved";
  const facts = [
    { label: "Incident", value: incident.code || incident.id },
    { label: "Title", value: incident.title || "--" },
    { label: "Status", value: humanizeCode(incident.status || (lifecycleType === "incident_created" ? "open" : "resolved")) },
    { label: "Severity", value: formatSeverity(normalizeIncidentSeverityForAlert(incident.severity)) },
    { label: "Monitor", value: incident.monitorName || incident.monitorId || "--" },
    { label: "URL", value: incident.monitorUrl || "--" },
    { label: lifecycleType === "incident_created" ? "Opened At" : "Resolved At", value: formatTimestamp(lifecycleType === "incident_created" ? incident.startedAt : incident.resolvedAt || incident.updatedAt) },
  ];

  const sections = [];
  if (incident.description) sections.push({ title: "Description", body: incident.description });
  if (incident.impactSummary) sections.push({ title: "Impact", body: incident.impactSummary });
  if (incident.rootCause) sections.push({ title: "Root Cause", body: incident.rootCause });
  if (incident.nextSteps && lifecycleType === "incident_created") sections.push({ title: "Next Steps", body: incident.nextSteps });
  if (incident.fixSummary && lifecycleType === "incident_resolved") sections.push({ title: "Fix Summary", body: incident.fixSummary });
  if (incident.resolutionNotes && lifecycleType === "incident_resolved") sections.push({ title: "Resolution Notes", body: incident.resolutionNotes });

  const summary = lifecycleType === "incident_created"
    ? `${incident.title} was opened for ${incident.monitorName || "the affected monitor"}.`
    : `${incident.title} has been marked resolved.`;

  const links = [];
  if (incidentLink) links.push({ label: "Open incident", url: incidentLink });
  if (monitorLink) links.push({ label: "Open monitor", url: monitorLink });

  return finalizeEnvelope({
    sourceType: "incident",
    eventType: lifecycleType,
    severity,
    title,
    subject: `[PingMaster] ${subjectPrefix}: ${incident.code || incident.id}`,
    summary,
    facts,
    sections,
    links,
    footer: "PingMaster incident alert",
  });
}

function buildTestAlertEnvelope(channel, env) {
  const alertsLink = buildAppLink(env, "/alerts");
  const facts = [
    { label: "Channel", value: channel.name || channel.id },
    { label: "Type", value: humanizeCode(channel.type) },
    { label: "Sent At", value: formatTimestamp(new Date().toISOString()) },
    { label: "Status", value: "Connectivity check" },
  ];

  return finalizeEnvelope({
    sourceType: "test",
    eventType: "test",
    severity: "info",
    title: "PingMaster test notification",
    subject: `[PingMaster] Test notification for ${channel.name}`,
    summary: `This confirms that PingMaster can reach the ${channel.name} channel.`,
    facts,
    sections: [
      {
        title: "Why you received this",
        body: "A manual delivery test was triggered from the Alerts page.",
      },
    ],
    links: alertsLink ? [{ label: "Open alerts", url: alertsLink }] : [],
    footer: "PingMaster channel test",
  });
}

function finalizeEnvelope(envelope) {
  const text = renderPlainMessage(envelope);
  return {
    ...envelope,
    text,
    html: renderEmailHtml(envelope),
  };
}

function renderPlainMessage(envelope) {
  const lines = [envelope.summary];

  if (Array.isArray(envelope.facts) && envelope.facts.length > 0) {
    lines.push("");
    lines.push("Details");
    for (const fact of envelope.facts) {
      lines.push(`- ${fact.label}: ${fact.value}`);
    }
  }

  if (Array.isArray(envelope.sections) && envelope.sections.length > 0) {
    for (const section of envelope.sections) {
      lines.push("");
      lines.push(section.title);
      lines.push(section.body);
    }
  }

  if (Array.isArray(envelope.links) && envelope.links.length > 0) {
    lines.push("");
    lines.push("Links");
    for (const link of envelope.links) {
      lines.push(`- ${link.label}: ${link.url}`);
    }
  }

  return lines.join("\n");
}

function renderEmailHtml(envelope) {
  const factRows = (envelope.facts || [])
    .map((fact) => `<tr><td style="padding:8px 12px;border:1px solid #d9dde5;font-weight:600;">${escapeHtml(fact.label)}</td><td style="padding:8px 12px;border:1px solid #d9dde5;">${escapeHtml(fact.value)}</td></tr>`)
    .join("");
  const sectionRows = (envelope.sections || [])
    .map((section) => `<div style="margin-top:18px;"><div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:6px;">${escapeHtml(section.title)}</div><div style="font-size:14px;line-height:1.6;color:#374151;white-space:pre-line;">${escapeHtml(section.body)}</div></div>`)
    .join("");
  const links = (envelope.links || [])
    .map((link) => `<a href="${escapeHtml(link.url)}" style="display:inline-block;margin-right:10px;margin-top:12px;padding:10px 14px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;">${escapeHtml(link.label)}</a>`)
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
      <div style="padding:24px 28px;border-bottom:1px solid #e5e7eb;background:#0f172a;color:#ffffff;">
        <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.75;">PingMaster</div>
        <div style="font-size:24px;font-weight:700;margin-top:8px;">${escapeHtml(envelope.title)}</div>
        <div style="font-size:14px;line-height:1.6;color:#dbe4f0;margin-top:12px;">${escapeHtml(envelope.summary)}</div>
      </div>
      <div style="padding:24px 28px;">
        <table style="width:100%;border-collapse:collapse;border:1px solid #d9dde5;border-radius:12px;overflow:hidden;">
          <tbody>${factRows}</tbody>
        </table>
        ${sectionRows}
        <div style="margin-top:16px;">${links}</div>
      </div>
    </div>
  </body>
</html>`;
}

function buildDiscordPayload(envelope) {
  const fields = [];
  for (const fact of envelope.facts || []) {
    fields.push({
      name: fact.label,
      value: truncateForDiscord(fact.value || "--", 1024),
      inline: false,
    });
  }
  for (const section of envelope.sections || []) {
    fields.push({
      name: section.title,
      value: truncateForDiscord(section.body || "--", 1024),
      inline: false,
    });
  }
  if (Array.isArray(envelope.links) && envelope.links.length > 0) {
    fields.push({
      name: "Links",
      value: truncateForDiscord(envelope.links.map((link) => `[${link.label}](${link.url})`).join("\n"), 1024),
      inline: false,
    });
  }

  return {
    embeds: [
      {
        title: envelope.title,
        description: truncateForDiscord(envelope.summary || "", 4096),
        color: DISCORD_COLOR_BY_SEVERITY[envelope.severity] || DISCORD_COLOR_BY_SEVERITY.info,
        fields: fields.slice(0, 25),
        footer: { text: envelope.footer || "PingMaster alert" },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function buildSlackPayload(envelope) {
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: envelope.title.slice(0, 150),
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: envelope.summary,
      },
    },
    { type: "divider" },
  ];

  const factFields = (envelope.facts || [])
    .slice(0, 10)
    .map((fact) => ({
      type: "mrkdwn",
      text: `*${fact.label}*\n${fact.value}`,
    }));
  if (factFields.length > 0) {
    blocks.push({
      type: "section",
      fields: factFields,
    });
  }

  for (const section of envelope.sections || []) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${section.title}*\n${section.body}`,
      },
    });
  }

  if (Array.isArray(envelope.links) && envelope.links.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: envelope.links.map((link) => `<${link.url}|${link.label}>`).join("  |  "),
      },
    });
  }

  return {
    text: envelope.title,
    blocks,
  };
}

async function deliverChannelMessage(channel, envelope, env) {
  if (channel.type === "discord") {
    const response = await fetch(channel.config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildDiscordPayload(envelope)),
    });
    if (!response.ok) {
      throw new Error(`Discord delivery failed (${response.status})`);
    }
    return `Discord ${response.status}`;
  }

  if (channel.type === "slack") {
    const response = await fetch(channel.config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSlackPayload(envelope)),
    });
    if (!response.ok) {
      throw new Error(`Slack delivery failed (${response.status})`);
    }
    return `Slack ${response.status}`;
  }

  // Email via Gmail SMTP
  const emailUser = env.EMAIL_USER;
  const emailPass = env.EMAIL_PASS;
  if (!emailUser || !emailPass) {
    throw new Error("EMAIL_USER / EMAIL_PASS environment variables are not configured");
  }

  await sendViaGmail({
    user: emailUser,
    pass: emailPass,
    to: channel.config.recipientEmails,
    subject: envelope.subject || envelope.title,
    html: envelope.html,
    text: envelope.text,
  });

  return `Gmail → ${channel.config.recipientEmails.join(", ")}`;
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildMonitorAlertTitle(monitor, eventType) {
  if (eventType === "down_open") return `${monitor.name} is down`;
  if (eventType === "degraded_open") return `${monitor.name} is degraded`;
  if (eventType === "recovery") return `${monitor.name} recovered`;
  return `${monitor.name} alert`;
}

function formatMonitorEvent(eventType) {
  if (eventType === "down_open") return "Down detected";
  if (eventType === "degraded_open") return "Degraded detected";
  if (eventType === "recovery") return "Recovery confirmed";
  return humanizeCode(eventType);
}

function formatMonitorStatus(status) {
  if (status === "UP") return "Available";
  if (status === "UP_RESTRICTED") return "Degraded";
  if (status === "DOWN") return "Down";
  return humanizeCode(status);
}

function formatSeverity(severity) {
  return SEVERITY_EMOJI[severity] || humanizeCode(severity);
}

function formatLatency(latency) {
  return Number.isFinite(latency) ? `${latency} ms` : "--";
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function humanizeCode(value) {
  return String(value || "--")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildAppLink(env, path) {
  const base = typeof env?.FRONTEND_APP_URL === "string" ? env.FRONTEND_APP_URL.trim().replace(/\/+$/, "") : "";
  if (!base) return null;
  return `${base}${path}`;
}

function truncateForDiscord(value, limit) {
  if (typeof value !== "string") return "--";
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || "");
}

function buildAlertEvent(input) {
  return {
    userId: input.userId,
    workspaceId: input.workspaceId || null,
    sourceType: input.sourceType || "monitor",
    monitorId: input.monitorId ?? null,
    incidentId: input.incidentId ?? null,
    channelId: input.channelId ?? null,
    eventType: input.eventType,
    severity: input.severity,
    status: input.status,
    title: input.title,
    message: input.message,
    providerResponse: input.providerResponse || "",
    failureReason: input.failureReason || "",
    suppressionReason: input.suppressionReason || "",
    createdAt: new Date().toISOString(),
  };
}
