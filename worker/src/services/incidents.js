import { INCIDENT_UPDATE_MAX_LIMIT } from "../config/constants.js";

export function normalizeIncidentSeverity(value) {
  const severity = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["critical", "high", "medium", "low"].includes(severity)) {
    return severity;
  }
  return null;
}

export async function hydrateIncident(redis, incident) {
  const updates = await redis.lrange(`incident:${incident.id}:updates`, 0, INCIDENT_UPDATE_MAX_LIMIT - 1);
  return {
    ...incident,
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
