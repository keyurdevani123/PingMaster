import { INCIDENT_LIST_MAX_LIMIT } from "../config/constants.js";
import { json } from "../lib/http.js";
import { notifyIncidentLifecycle } from "../services/alerts.js";
import { appendIncidentUpdate, enrichIncidentAssignee, hydrateIncident, normalizeIncidentSeverity } from "../services/incidents.js";
import { invalidateWorkspaceStatusPageCaches } from "../services/statusPages.js";
import {
  ensureWorkspaceMembership,
  ensureWorkspaceScopedRecord,
  getWorkspaceCollectionIds,
  getWorkspaceMembership,
  isPersonalWorkspaceId,
  workspaceCollectionHasItem,
} from "../services/workspaces.js";

async function canAccessWorkspaceIncident(redis, incident, userId, workspaceId) {
  if (!incident?.id) return false;
  if (incident.userId === userId) return true;
  return workspaceCollectionHasItem(
    redis,
    workspaceId,
    "incidents",
    incident.id,
    isPersonalWorkspaceId(workspaceId) ? `user:${userId}:incidents` : null
  );
}

function formatMemberLabel(membership, fallbackUserId = "") {
  return membership?.displayName || membership?.email || fallbackUserId || "a workspace member";
}

async function canAccessWorkspaceMonitor(redis, monitor, userId, workspaceId) {
  if (!monitor?.id) return false;
  if (monitor.userId === userId) return true;
  return workspaceCollectionHasItem(
    redis,
    workspaceId,
    "monitors",
    monitor.id,
    isPersonalWorkspaceId(workspaceId) ? `user:${userId}:monitors` : null
  );
}

export async function getIncidents(request, redis, auth, workspace, membership, corsHeaders) {
  const userId = auth.userId;
  const workspaceId = workspace.id;
  const rawIds = await getWorkspaceCollectionIds(
    redis,
    workspaceId,
    "incidents",
    isPersonalWorkspaceId(workspaceId) ? `user:${userId}:incidents` : null,
    INCIDENT_LIST_MAX_LIMIT - 1
  );
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return json([], 200, corsHeaders);
  }

  const seen = new Set();
  const incidents = [];

  for (const incidentId of rawIds) {
    if (!incidentId || seen.has(incidentId)) continue;
    seen.add(incidentId);

    const incident = await redis.get(`incident:${incidentId}`);
    if (!incident) continue;
    if (!(await canAccessWorkspaceIncident(redis, incident, userId, workspaceId))) continue;
    await ensureWorkspaceScopedRecord(redis, `incident:${incidentId}`, incident, workspaceId, "incidents");
    incidents.push(await enrichIncidentAssignee(redis, incident));
  }

  return json(incidents, 200, corsHeaders);
}

export async function getIncident(request, redis, auth, workspace, membership, incidentId, corsHeaders) {
  const userId = auth.userId;
  const workspaceId = workspace.id;
  const incident = await redis.get(`incident:${incidentId}`);
  if (!incident) return json({ error: "Incident not found" }, 404, corsHeaders);
  if (!(await canAccessWorkspaceIncident(redis, incident, userId, workspaceId))) return json({ error: "Forbidden" }, 403, corsHeaders);
  await ensureWorkspaceScopedRecord(redis, `incident:${incidentId}`, incident, workspaceId, "incidents");

  return json(await hydrateIncident(redis, incident), 200, corsHeaders);
}

export async function createIncident(request, redis, auth, workspace, membership, env, corsHeaders, ctx = null) {
  const userId = auth.userId;
  const workspaceId = workspace.id;
  if (![ "owner", "admin"].includes(membership?.role)) {
    return json({ error: "Only workspace owners and admins can create incidents." }, 403, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const rootCause = typeof body?.rootCause === "string" ? body.rootCause.trim() : "";
  const impactSummary = typeof body?.impactSummary === "string" ? body.impactSummary.trim() : "";
  const nextSteps = typeof body?.nextSteps === "string" ? body.nextSteps.trim() : "";
  const severity = normalizeIncidentSeverity(body?.severity);
  const monitorId = typeof body?.monitorId === "string" && body.monitorId.trim() ? body.monitorId.trim() : null;
  const assignedToUserId = typeof body?.assignedToUserId === "string" && body.assignedToUserId.trim()
    ? body.assignedToUserId.trim()
    : null;

  if (!title) return json({ error: "title is required" }, 400, corsHeaders);
  if (!monitorId) return json({ error: "monitorId is required" }, 400, corsHeaders);
  if (!severity) return json({ error: "severity must be critical, high, medium, or low" }, 400, corsHeaders);

  const monitor = await redis.get(`monitor:${monitorId}`);
  if (!monitor) return json({ error: "Monitor not found" }, 404, corsHeaders);
  if (!(await canAccessWorkspaceMonitor(redis, monitor, userId, workspaceId))) return json({ error: "Monitor not found" }, 404, corsHeaders);
  const assignedMembership = assignedToUserId
    ? await getWorkspaceMembership(redis, workspaceId, assignedToUserId)
    : null;
  if (assignedToUserId) {
    if (!assignedMembership) {
      return json({ error: "Assigned member was not found in this workspace." }, 400, corsHeaders);
    }
  }

  const nowIso = new Date().toISOString();
  const incidentId = `inc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const incident = {
    id: incidentId,
    code: `INC-${String(Date.now()).slice(-6)}`,
    userId,
    workspaceId,
    createdByUserId: userId,
    monitorId,
    monitorName: monitor?.name || null,
    monitorUrl: monitor?.url || null,
    title,
    description,
    rootCause,
    impactSummary,
    nextSteps,
    fixSummary: "",
    resolutionNotes: "",
    severity,
    status: "open",
    source: "manual",
    startedAt: nowIso,
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    resolvedAt: null,
    resolvedByUserId: null,
    assignedToUserId,
    assignedAt: assignedToUserId ? nowIso : null,
    assignedByUserId: assignedToUserId ? userId : null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await redis.set(`incident:${incidentId}`, incident);
  if (isPersonalWorkspaceId(workspaceId)) {
    await redis.lpush(`user:${userId}:incidents`, incidentId);
  }
  await ensureWorkspaceMembership(redis, workspaceId, "incidents", incidentId);
  await redis.lpush(`monitor:${monitorId}:incidents`, incidentId);
  await appendIncidentUpdate(redis, incidentId, {
    type: "system",
    title: "Incident opened",
    body: `Opened for ${monitor?.name || "the selected monitor"} with ${severity} severity.`,
    actorUserId: userId,
    actorName: auth.name || "",
    actorEmail: auth.email || "",
  });
  if (assignedToUserId) {
    await appendIncidentUpdate(redis, incidentId, {
      type: "system",
      title: "Ownership assigned",
      body: `Assigned to ${formatMemberLabel(assignedMembership, assignedToUserId)}.`,
      actorUserId: userId,
      actorName: auth.name || "",
      actorEmail: auth.email || "",
    });
  }
  await invalidateWorkspaceStatusPageCaches(redis, workspaceId);

  const notificationTask = notifyIncidentLifecycle(redis, incident, "incident_created", env)
    .catch(() => {});
  if (typeof ctx?.waitUntil === "function") ctx.waitUntil(notificationTask);
  else await notificationTask;

  return json(await hydrateIncident(redis, incident), 201, corsHeaders);
}

export async function updateIncident(request, redis, auth, workspace, membership, incidentId, env, corsHeaders, ctx = null) {
  const userId = auth.userId;
  const workspaceId = workspace.id;
  const incident = await redis.get(`incident:${incidentId}`);
  if (!incident) return json({ error: "Incident not found" }, 404, corsHeaders);
  if (!(await canAccessWorkspaceIncident(redis, incident, userId, workspaceId))) return json({ error: "Forbidden" }, 403, corsHeaders);
  await ensureWorkspaceScopedRecord(redis, `incident:${incidentId}`, incident, workspaceId, "incidents");

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  const fields = typeof body?.fields === "object" && body.fields ? body.fields : null;
  if (!action && !fields) return json({ error: "action or fields are required" }, 400, corsHeaders);
  if (action && !["acknowledge", "resolve", "reopen"].includes(action)) {
    return json({ error: "action must be acknowledge, resolve, or reopen" }, 400, corsHeaders);
  }
  if ((action === "resolve" || action === "reopen") && ![ "owner", "admin"].includes(membership?.role)) {
    return json({ error: "Only workspace owners and admins can resolve or reopen incidents." }, 403, corsHeaders);
  }

  const nowIso = new Date().toISOString();
  const updateEvents = [];

  if (fields) {
    const nextTitle = typeof fields.title === "string" ? fields.title.trim() : incident.title;
    const nextDescription = typeof fields.description === "string" ? fields.description.trim() : incident.description;
    const nextRootCause = typeof fields.rootCause === "string" ? fields.rootCause.trim() : incident.rootCause;
    const nextImpactSummary = typeof fields.impactSummary === "string" ? fields.impactSummary.trim() : incident.impactSummary;
    const nextNextSteps = typeof fields.nextSteps === "string" ? fields.nextSteps.trim() : incident.nextSteps;
    const nextFixSummary = typeof fields.fixSummary === "string" ? fields.fixSummary.trim() : incident.fixSummary;
    const nextResolutionNotes = typeof fields.resolutionNotes === "string" ? fields.resolutionNotes.trim() : incident.resolutionNotes;
    const nextSeverity = fields.severity != null ? normalizeIncidentSeverity(fields.severity) : incident.severity;
    const nextAssignedToUserId = fields.assignedToUserId == null
      ? incident.assignedToUserId || null
      : (typeof fields.assignedToUserId === "string" && fields.assignedToUserId.trim()
        ? fields.assignedToUserId.trim()
        : null);

    if (!nextTitle) return json({ error: "title is required" }, 400, corsHeaders);
    if (!nextSeverity) return json({ error: "severity must be critical, high, medium, or low" }, 400, corsHeaders);
    const nextAssignedMembership = nextAssignedToUserId
      ? await getWorkspaceMembership(redis, workspaceId, nextAssignedToUserId)
      : null;
    if (nextAssignedToUserId) {
      if (!nextAssignedMembership) {
        return json({ error: "Assigned member was not found in this workspace." }, 400, corsHeaders);
      }
    }

    const previousAssignedToUserId = incident.assignedToUserId || null;
    incident.title = nextTitle;
    incident.description = nextDescription;
    incident.rootCause = nextRootCause;
    incident.impactSummary = nextImpactSummary;
    incident.nextSteps = nextNextSteps;
    incident.fixSummary = nextFixSummary;
    incident.resolutionNotes = nextResolutionNotes;
    incident.severity = nextSeverity;
    incident.assignedToUserId = nextAssignedToUserId;
    incident.assignedAt = nextAssignedToUserId ? nowIso : null;
    incident.assignedByUserId = nextAssignedToUserId ? userId : null;
    updateEvents.push({
      type: "system",
      title: "Incident details updated",
      body: "Severity, impact, or investigation details were updated.",
      actorUserId: userId,
      actorName: auth.name || "",
      actorEmail: auth.email || "",
    });
    if (nextAssignedToUserId !== previousAssignedToUserId) {
      updateEvents.push({
        type: "system",
        title: nextAssignedToUserId ? "Ownership updated" : "Ownership removed",
        body: nextAssignedToUserId
          ? `Assigned to ${formatMemberLabel(nextAssignedMembership, nextAssignedToUserId)}.`
          : "This incident is no longer assigned to a workspace member.",
        actorUserId: userId,
        actorName: auth.name || "",
        actorEmail: auth.email || "",
      });
    }
  }

  if (action === "acknowledge") {
    if (incident.status === "resolved") {
      return json({ error: "Resolved incidents cannot be acknowledged" }, 400, corsHeaders);
    }
    incident.status = "acknowledged";
    incident.acknowledgedAt = incident.acknowledgedAt || nowIso;
    incident.acknowledgedByUserId = incident.acknowledgedByUserId || userId;
    updateEvents.push({
      type: "system",
      title: "Incident acknowledged",
      body: "The team has started working on this issue.",
      actorUserId: userId,
      actorName: auth.name || "",
      actorEmail: auth.email || "",
    });
  }

  if (action === "resolve") {
    if (!incident.fixSummary || incident.fixSummary.trim().length === 0) {
      return json({ error: "fixSummary is required before resolving an incident" }, 400, corsHeaders);
    }
    incident.status = "resolved";
    incident.resolvedAt = nowIso;
    incident.resolvedByUserId = userId;
    updateEvents.push({
      type: "system",
      title: "Incident resolved",
      body: "The incident was marked resolved after the fix was confirmed.",
      actorUserId: userId,
      actorName: auth.name || "",
      actorEmail: auth.email || "",
    });
  }

  if (action === "reopen") {
    incident.status = "open";
    incident.resolvedAt = null;
    incident.resolvedByUserId = null;
    updateEvents.push({
      type: "system",
      title: "Incident reopened",
      body: "The incident was reopened for more investigation or follow-up work.",
      actorUserId: userId,
      actorName: auth.name || "",
      actorEmail: auth.email || "",
    });
  }

  incident.updatedAt = nowIso;
  await redis.set(`incident:${incidentId}`, incident);
  await invalidateWorkspaceStatusPageCaches(redis, workspaceId);

  for (const entry of updateEvents) {
    await appendIncidentUpdate(redis, incidentId, entry);
  }

  if (action === "resolve") {
    const notificationTask = notifyIncidentLifecycle(redis, incident, "incident_resolved", env)
      .catch(() => {});
    if (typeof ctx?.waitUntil === "function") ctx.waitUntil(notificationTask);
    else await notificationTask;
  }

  return json(await hydrateIncident(redis, incident), 200, corsHeaders);
}

export async function addIncidentUpdate(request, redis, auth, workspace, membership, incidentId, corsHeaders) {
  const userId = auth.userId;
  const workspaceId = workspace.id;
  const incident = await redis.get(`incident:${incidentId}`);
  if (!incident) return json({ error: "Incident not found" }, 404, corsHeaders);
  if (!(await canAccessWorkspaceIncident(redis, incident, userId, workspaceId))) return json({ error: "Forbidden" }, 403, corsHeaders);
  await ensureWorkspaceScopedRecord(redis, `incident:${incidentId}`, incident, workspaceId, "incidents");

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!title && !message) {
    return json({ error: "title or message is required" }, 400, corsHeaders);
  }

  const entry = await appendIncidentUpdate(redis, incidentId, {
    type: "note",
    title: title || "Response update",
    body: message,
    actorUserId: userId,
    actorName: auth.name || "",
    actorEmail: auth.email || "",
  });

  incident.updatedAt = new Date().toISOString();
  await redis.set(`incident:${incidentId}`, incident);

  return json(entry, 201, corsHeaders);
}
