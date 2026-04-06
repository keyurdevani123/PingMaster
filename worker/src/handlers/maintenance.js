import { json } from "../lib/http.js";
import {
  buildMaintenanceWindow,
  getMaintenanceWindow,
  listWorkspaceMaintenances,
  normalizeMaintenanceInput,
  saveMaintenanceWindow,
} from "../services/maintenance.js";

export async function getMaintenances(request, redis, userId, workspaceId, corsHeaders) {
  const url = new URL(request.url);
  const monitorId = url.searchParams.get("monitorId") || null;
  const items = await listWorkspaceMaintenances(redis, userId, workspaceId, { monitorId });
  return json(items, 200, corsHeaders);
}

export async function createMaintenance(request, redis, userId, workspaceId, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const normalized = normalizeMaintenanceInput(
    workspaceId,
    userId,
    body,
    buildMaintenanceWindow(workspaceId, userId, body)
  );
  if (!normalized.ok) {
    return json({ error: normalized.error }, 400, corsHeaders);
  }

  const validation = await validateMaintenanceMonitors(redis, workspaceId, normalized.maintenance.monitorIds);
  if (!validation.ok) {
    return json({ error: validation.error }, 400, corsHeaders);
  }

  await saveMaintenanceWindow(redis, normalized.maintenance, []);
  return json(normalized.maintenance, 201, corsHeaders);
}

export async function updateMaintenance(request, redis, userId, workspaceId, maintenanceId, corsHeaders) {
  const existing = await getMaintenanceWindow(redis, maintenanceId);
  if (!existing) return json({ error: "Maintenance not found" }, 404, corsHeaders);
  if (existing.workspaceId !== workspaceId) {
    return json({ error: "Forbidden" }, 403, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  if (typeof body?.action === "string" && body.action.trim().toLowerCase() === "cancel") {
    const cancelled = {
      ...existing,
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveMaintenanceWindow(redis, cancelled, existing.monitorIds || []);
    return json(cancelled, 200, corsHeaders);
  }

  const normalized = normalizeMaintenanceInput(workspaceId, userId, body, existing);
  if (!normalized.ok) {
    return json({ error: normalized.error }, 400, corsHeaders);
  }

  const validation = await validateMaintenanceMonitors(redis, workspaceId, normalized.maintenance.monitorIds);
  if (!validation.ok) {
    return json({ error: validation.error }, 400, corsHeaders);
  }

  await saveMaintenanceWindow(redis, normalized.maintenance, existing.monitorIds || []);
  return json(normalized.maintenance, 200, corsHeaders);
}

async function validateMaintenanceMonitors(redis, workspaceId, monitorIds) {
  for (const monitorId of monitorIds) {
    const monitor = await redis.get(`monitor:${monitorId}`);
    if (!monitor) return { ok: false, error: "One or more selected monitors were not found" };
    if (monitor.workspaceId && monitor.workspaceId !== workspaceId) {
      return { ok: false, error: "One or more selected monitors are not available in this workspace" };
    }
  }
  return { ok: true };
}
