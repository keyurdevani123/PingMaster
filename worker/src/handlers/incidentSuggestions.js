import { json } from "../lib/http.js";
import { hydrateIncident } from "../services/incidents.js";
import { generateIncidentCreationSuggestions, generateIncidentResolveSuggestions } from "../services/incidentSuggestions.js";

export async function postIncidentCreationSuggestionsHandler(request, redis, auth, workspace, membership, corsHeaders, env) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400, corsHeaders);
  }

  const monitorId = String(body?.monitorId || "").trim();
  if (!monitorId) {
    return json({ error: "monitorId is required." }, 400, corsHeaders);
  }

  const monitor = await getWorkspaceMonitor(redis, auth.userId, workspace.id, monitorId);
  if (!monitor) {
    return json({ error: "Monitor not found." }, 404, corsHeaders);
  }

  try {
    const suggestions = await generateIncidentCreationSuggestions(redis, env, workspace, monitorId);
    return json(suggestions, 200, corsHeaders);
  } catch (error) {
    return json({ error: error?.message || "Could not generate creation suggestions." }, 500, corsHeaders);
  }
}

export async function postIncidentResolveSuggestionsHandler(request, redis, auth, workspace, membership, incidentId, corsHeaders, env) {
  const incident = await getWorkspaceIncident(redis, auth.userId, workspace.id, incidentId);
  if (!incident) {
    return json({ error: "Incident not found." }, 404, corsHeaders);
  }

  try {
    const hydrated = await hydrateIncident(redis, incident);
    const suggestions = await generateIncidentResolveSuggestions(redis, env, workspace, hydrated);
    return json(suggestions, 200, corsHeaders);
  } catch (error) {
    return json({ error: error?.message || "Could not generate resolve suggestions." }, 500, corsHeaders);
  }
}

async function getWorkspaceIncident(redis, userId, workspaceId, incidentId) {
  const incident = await redis.get(`incident:${incidentId}`);
  if (!incident) return null;
  if (incident.workspaceId && incident.workspaceId !== workspaceId) return null;
  if (!incident.workspaceId && incident.userId !== userId) return null;
  return incident;
}

async function getWorkspaceMonitor(redis, userId, workspaceId, monitorId) {
  const monitor = await redis.get(`monitor:${monitorId}`);
  if (!monitor) return null;
  if (monitor.workspaceId && monitor.workspaceId !== workspaceId) return null;
  if (!monitor.workspaceId && monitor.userId !== userId) return null;
  return monitor;
}
