import { json } from "../lib/http.js";
import { generateIncidentActionPack, getIncidentActionPack, saveIncidentActionPack } from "../services/incidentActionPack.js";
import { hydrateIncident } from "../services/incidents.js";

export async function getIncidentActionPackHandler(request, redis, auth, workspace, membership, incidentId, corsHeaders) {
  const incident = await getWorkspaceIncident(redis, auth.userId, workspace.id, incidentId);
  if (!incident) {
    return json({ error: "Incident not found" }, 404, corsHeaders);
  }

  const actionPack = await getIncidentActionPack(redis, workspace.id, incidentId);
  return json({
    incidentId,
    workspaceId: workspace.id,
    actionPack: actionPack || null,
  }, 200, corsHeaders);
}

export async function postIncidentActionPackHandler(request, redis, auth, workspace, membership, incidentId, env, corsHeaders) {
  const incident = await getWorkspaceIncident(redis, auth.userId, workspace.id, incidentId);
  if (!incident) {
    return json({ error: "Incident not found" }, 404, corsHeaders);
  }

  try {
    const hydrated = await hydrateIncident(redis, incident);
    const generated = await generateIncidentActionPack(redis, env, workspace, hydrated);
    await saveIncidentActionPack(redis, workspace.id, incidentId, generated);
    return json(generated, 200, corsHeaders);
  } catch (error) {
    return json({ error: error?.message || "Could not generate incident action pack." }, 500, corsHeaders);
  }
}

async function getWorkspaceIncident(redis, userId, workspaceId, incidentId) {
  const incident = await redis.get(`incident:${incidentId}`);
  if (!incident) return null;
  if (incident.workspaceId && incident.workspaceId !== workspaceId) return null;
  if (!incident.workspaceId && incident.userId !== userId) return null;
  return incident;
}
