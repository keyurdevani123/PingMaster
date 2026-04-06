import { ALERT_EVENT_LIST_MAX_LIMIT } from "../config/constants.js";
import { json } from "../lib/http.js";
import {
  buildPolicyDefaults,
  buildUserAlertPreference,
  getPoliciesSnapshot,
  getUserAlertPreferenceSnapshot,
  listAlertChannels,
  listAlertEvents,
  loadAlertChannel,
  loadDefaultPolicy,
  loadMonitorPolicy,
  normalizeChannelPayload,
  normalizePolicyInput,
  normalizeUserAlertPreferenceInput,
  saveAlertChannel,
  saveDefaultPolicy,
  saveMonitorPolicy,
  saveUserAlertPreference,
  sendTestAlert,
} from "../services/alerts.js";

export async function getAlertChannels(request, redis, auth, workspace, membership, corsHeaders) {
  return json(await listAlertChannels(redis, workspace.id, workspace.ownerUserId), 200, corsHeaders);
}

export async function createAlertChannel(request, redis, auth, workspace, membership, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can manage alert channels." }, 403, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const result = normalizeChannelPayload(workspace.ownerUserId, workspace.id, body);
  if (!result.ok) return json({ error: result.error }, 400, corsHeaders);

  await saveAlertChannel(redis, result.channel);
  return json(result.channel, 201, corsHeaders);
}

export async function updateAlertChannel(request, redis, auth, workspace, membership, channelId, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can manage alert channels." }, 403, corsHeaders);
  }
  const existing = await loadAlertChannel(redis, channelId);
  if (!existing) return json({ error: "Channel not found" }, 404, corsHeaders);
  if (existing.userId !== workspace.ownerUserId) return json({ error: "Forbidden" }, 403, corsHeaders);
  if (existing.workspaceId && existing.workspaceId !== workspace.id) return json({ error: "Forbidden" }, 403, corsHeaders);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const result = normalizeChannelPayload(workspace.ownerUserId, workspace.id, body, existing);
  if (!result.ok) return json({ error: result.error }, 400, corsHeaders);

  await saveAlertChannel(redis, result.channel);
  return json(result.channel, 200, corsHeaders);
}

export async function testAlertChannel(request, redis, auth, workspace, membership, channelId, env, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can test alert channels." }, 403, corsHeaders);
  }
  const channel = await loadAlertChannel(redis, channelId);
  if (!channel) return json({ error: "Channel not found" }, 404, corsHeaders);
  if (channel.userId !== workspace.ownerUserId) return json({ error: "Forbidden" }, 403, corsHeaders);
  if (channel.workspaceId && channel.workspaceId !== workspace.id) return json({ error: "Forbidden" }, 403, corsHeaders);

  const event = await sendTestAlert(redis, channel, workspace.ownerUserId, env);
  return json(event, event.status === "sent" ? 200 : 500, corsHeaders);
}

export async function getAlertPolicies(request, redis, auth, workspace, membership, corsHeaders) {
  return json(await getPoliciesSnapshot(redis, workspace.ownerUserId, workspace.id), 200, corsHeaders);
}

export async function putDefaultAlertPolicy(request, redis, auth, workspace, membership, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can update alert rules." }, 403, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const existing = await loadDefaultPolicy(redis, workspace.ownerUserId, workspace.id);
  const policy = normalizePolicyInput(
    workspace.ownerUserId,
    workspace.id,
    body,
    "global",
    null,
    existing || buildPolicyDefaults(workspace.ownerUserId, workspace.id, "global")
  );
  await saveDefaultPolicy(redis, policy);
  return json(policy, 200, corsHeaders);
}

export async function putMonitorAlertPolicy(request, redis, auth, workspace, membership, monitorId, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can update alert rules." }, 403, corsHeaders);
  }

  const monitor = await redis.get(`monitor:${monitorId}`);
  if (!monitor) return json({ error: "Monitor not found" }, 404, corsHeaders);
  if (monitor.workspaceId && monitor.workspaceId !== workspace.id) return json({ error: "Forbidden" }, 403, corsHeaders);
  if (!monitor.workspaceId && monitor.userId !== auth.userId) return json({ error: "Forbidden" }, 403, corsHeaders);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const existing = await loadMonitorPolicy(redis, monitorId);
  const policy = normalizePolicyInput(
    workspace.ownerUserId,
    workspace.id,
    body,
    "monitor",
    monitorId,
    existing || buildPolicyDefaults(workspace.ownerUserId, workspace.id, "monitor", monitorId)
  );
  await saveMonitorPolicy(redis, policy);
  return json(policy, 200, corsHeaders);
}

export async function getAlertEvents(request, redis, auth, workspace, membership, corsHeaders) {
  const url = new URL(request.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || String(ALERT_EVENT_LIST_MAX_LIMIT), 10);
  const events = await listAlertEvents(redis, auth.userId, workspace.id, rawLimit);
  return json(events, 200, corsHeaders);
}

export async function getAlertPreferences(request, redis, auth, workspace, membership, corsHeaders) {
  return json(await getUserAlertPreferenceSnapshot(redis, auth.userId, workspace.id), 200, corsHeaders);
}

export async function putAlertPreferences(request, redis, auth, workspace, membership, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const existing = await getUserAlertPreferenceSnapshot(redis, auth.userId, workspace.id);
  const preference = normalizeUserAlertPreferenceInput(
    auth.userId,
    workspace.id,
    body,
    existing || buildUserAlertPreference(auth.userId, workspace.id)
  );
  await saveUserAlertPreference(redis, preference);
  return json(preference, 200, corsHeaders);
}
