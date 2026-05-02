import { INCIDENT_UPDATE_MAX_LIMIT } from "../config/constants.js";
import { getWorkspaceMembership } from "./workspaces.js";

export function normalizeIncidentSeverity(value) {
  const severity = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["critical", "high", "medium", "low"].includes(severity)) {
    return severity;
  }
  return null;
}

export async function enrichIncidentAssignee(redis, incident) {
  if (!incident) return incident;
  const assignedToUserId = typeof incident.assignedToUserId === "string" ? incident.assignedToUserId.trim() : "";
  if (!assignedToUserId || !incident.workspaceId) {
    return {
      ...incident,
      assignedToMember: null,
      assignedToLabel: "Unassigned",
    };
  }

  const membership = await getWorkspaceMembership(redis, incident.workspaceId, assignedToUserId);
  const assignedToLabel = membership?.displayName || membership?.email || assignedToUserId;

  return {
    ...incident,
    assignedToMember: membership || null,
    assignedToLabel,
  };
}

export async function hydrateIncident(redis, incident) {
  const updates = await redis.lrange(`incident:${incident.id}:updates`, 0, INCIDENT_UPDATE_MAX_LIMIT - 1);
  const withAssignee = await enrichIncidentAssignee(redis, incident);
  return {
    ...withAssignee,
    updates: Array.isArray(updates) ? updates : [],
  };
}

export async function appendIncidentUpdate(redis, incidentId, update) {
  const entry = {
    id: `iup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: typeof update?.type === "string" ? update.type : "note",
    title: typeof update?.title === "string" ? update.title.trim() : "Response update",
    body: typeof update?.body === "string" ? update.body.trim() : "",
    actorUserId: typeof update?.actorUserId === "string" ? update.actorUserId : null,
    actorName: typeof update?.actorName === "string" ? update.actorName.trim() : "",
    actorEmail: typeof update?.actorEmail === "string" ? update.actorEmail.trim().toLowerCase() : "",
    createdAt: new Date().toISOString(),
  };

  await redis.lpush(`incident:${incidentId}:updates`, entry);
  await redis.ltrim(`incident:${incidentId}:updates`, 0, INCIDENT_UPDATE_MAX_LIMIT - 1);

  return entry;
}
