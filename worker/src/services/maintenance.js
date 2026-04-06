import { MAINTENANCE_LIST_MAX_LIMIT } from "../config/constants.js";
import { ensureWorkspaceMembership, getWorkspaceCollectionIds } from "./workspaces.js";
import { invalidateWorkspaceStatusPageCaches } from "./statusPages.js";

export function buildMaintenanceWindow(workspaceId, userId, input = {}) {
  const nowIso = new Date().toISOString();
  return {
    id: `mnt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    userId,
    title: String(input.title || "Scheduled maintenance").trim() || "Scheduled maintenance",
    message: String(input.message || "Planned work is in progress for the selected monitors.").trim(),
    startsAt: input.startsAt || nowIso,
    endsAt: input.endsAt || nowIso,
    monitorIds: Array.isArray(input.monitorIds)
      ? [...new Set(input.monitorIds.filter(Boolean).map(String))]
      : [],
    createdAt: nowIso,
    updatedAt: nowIso,
    cancelledAt: null,
  };
}

export function normalizeMaintenanceInput(workspaceId, userId, body, existing = null) {
  const base = existing || buildMaintenanceWindow(workspaceId, userId, body);
  const startsAt = normalizeDateValue(body?.startsAt ?? base.startsAt);
  const endsAt = normalizeDateValue(body?.endsAt ?? base.endsAt);
  const nowTs = Date.now();
  const startTs = new Date(startsAt).getTime();

  if (!startsAt || !endsAt) {
    return { ok: false, error: "startsAt and endsAt must be valid dates" };
  }
  if (!Number.isFinite(startTs) || startTs <= nowTs) {
    return { ok: false, error: "Maintenance must start in the future" };
  }
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { ok: false, error: "endsAt must be later than startsAt" };
  }

  const monitorIds = Array.isArray(body?.monitorIds)
    ? [...new Set(body.monitorIds.filter(Boolean).map(String))]
    : base.monitorIds;

  if (!Array.isArray(monitorIds) || monitorIds.length === 0) {
    return { ok: false, error: "Choose at least one monitor for maintenance" };
  }

  return {
    ok: true,
    maintenance: {
      ...base,
      workspaceId,
      userId,
      title: typeof body?.title === "string" && body.title.trim() ? body.title.trim() : base.title,
      message: typeof body?.message === "string" ? body.message.trim() : base.message,
      startsAt,
      endsAt,
      monitorIds,
      updatedAt: new Date().toISOString(),
      cancelledAt: body?.cancelledAt === null ? null : base.cancelledAt,
    },
  };
}

export async function saveMaintenanceWindow(redis, maintenance, previousMonitorIds = []) {
  await redis.set(`maintenance:${maintenance.id}`, maintenance);
  await ensureWorkspaceMembership(redis, maintenance.workspaceId, "maintenances", maintenance.id);
  await updateMonitorMaintenanceLinks(redis, maintenance.id, previousMonitorIds, maintenance.monitorIds);
  await invalidateWorkspaceStatusPageCaches(redis, maintenance.workspaceId);
  return maintenance;
}

export async function getMaintenanceWindow(redis, maintenanceId) {
  return redis.get(`maintenance:${maintenanceId}`);
}

export async function listWorkspaceMaintenances(redis, userId, workspaceId, options = {}) {
  const ids = await getWorkspaceCollectionIds(
    redis,
    workspaceId,
    "maintenances",
    null,
    MAINTENANCE_LIST_MAX_LIMIT - 1
  );

  if (!Array.isArray(ids) || ids.length === 0) return [];

  const monitorFilterId = options.monitorId || null;
  const nowTs = Date.now();
  const seen = new Set();
  const items = [];

  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const maintenance = await redis.get(`maintenance:${id}`);
    if (!maintenance) continue;
    if (maintenance.workspaceId !== workspaceId) continue;
    if (monitorFilterId && !maintenance.monitorIds?.includes(monitorFilterId)) continue;
    items.push(withComputedMaintenanceState(maintenance, nowTs));
  }

  return items.sort((left, right) => {
    const stateDelta = getMaintenanceRank(left.computedStatus) - getMaintenanceRank(right.computedStatus);
    if (stateDelta !== 0) return stateDelta;
    return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
  });
}

export async function getActiveMaintenanceForMonitor(redis, monitorId, at = Date.now()) {
  const ids = await redis.lrange(`monitor:${monitorId}:maintenances`, 0, MAINTENANCE_LIST_MAX_LIMIT - 1);
  if (!Array.isArray(ids) || ids.length === 0) return null;

  for (const id of ids) {
    if (!id) continue;
    const maintenance = await redis.get(`maintenance:${id}`);
    if (!maintenance) continue;
    if (isMaintenanceActive(maintenance, at)) {
      return withComputedMaintenanceState(maintenance, at);
    }
  }

  return null;
}

export function isMaintenanceActive(maintenance, at = Date.now()) {
  const nowTs = typeof at === "number" ? at : new Date(at).getTime();
  if (!maintenance || maintenance.cancelledAt) return false;
  const startTs = new Date(maintenance.startsAt).getTime();
  const endTs = new Date(maintenance.endsAt).getTime();
  return Number.isFinite(startTs) && Number.isFinite(endTs) && nowTs >= startTs && nowTs <= endTs;
}

export function buildMaintenanceResult(maintenance, previousResult = {}) {
  return {
    status: "MAINTENANCE",
    statusCode: null,
    latency: null,
    contentType: previousResult.contentType || "",
    errorType: "MAINTENANCE_WINDOW",
    timestamp: new Date().toISOString(),
    maintenanceId: maintenance.id,
    maintenanceTitle: maintenance.title,
  };
}

export async function buildWorkspaceMaintenanceSummary(redis, workspaceId, selectedMonitorIds) {
  if (!workspaceId || !Array.isArray(selectedMonitorIds) || selectedMonitorIds.length === 0) {
    return { active: [], upcoming: [] };
  }

  const ids = await getWorkspaceCollectionIds(
    redis,
    workspaceId,
    "maintenances",
    null,
    MAINTENANCE_LIST_MAX_LIMIT - 1
  );
  if (!Array.isArray(ids) || ids.length === 0) return { active: [], upcoming: [] };

  const nowTs = Date.now();
  const active = [];
  const upcoming = [];

  for (const id of ids) {
    const maintenance = await redis.get(`maintenance:${id}`);
    if (!maintenance || maintenance.cancelledAt) continue;
    if (!maintenance.monitorIds?.some((monitorId) => selectedMonitorIds.includes(monitorId))) continue;

    const computed = withComputedMaintenanceState(maintenance, nowTs);
    const monitorIds = maintenance.monitorIds.filter((monitorId) => selectedMonitorIds.includes(monitorId));
    const payload = { ...computed, monitorIds };

    if (computed.computedStatus === "active" && active.length < 5) active.push(payload);
    if (computed.computedStatus === "scheduled" && upcoming.length < 5) upcoming.push(payload);
  }

  active.sort((left, right) => new Date(left.endsAt).getTime() - new Date(right.endsAt).getTime());
  upcoming.sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());

  return { active, upcoming };
}

async function updateMonitorMaintenanceLinks(redis, maintenanceId, previousMonitorIds, nextMonitorIds) {
  const previous = new Set(Array.isArray(previousMonitorIds) ? previousMonitorIds : []);
  const next = new Set(Array.isArray(nextMonitorIds) ? nextMonitorIds : []);

  for (const monitorId of previous) {
    if (next.has(monitorId)) continue;
    await redis.lrem(`monitor:${monitorId}:maintenances`, 0, maintenanceId);
  }

  for (const monitorId of next) {
    await redis.lrem(`monitor:${monitorId}:maintenances`, 0, maintenanceId);
    await redis.lpush(`monitor:${monitorId}:maintenances`, maintenanceId);
  }
}

function normalizeDateValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function withComputedMaintenanceState(maintenance, nowTs = Date.now()) {
  let computedStatus = "completed";
  const startTs = new Date(maintenance.startsAt).getTime();
  const endTs = new Date(maintenance.endsAt).getTime();

  if (maintenance.cancelledAt) {
    computedStatus = "cancelled";
  } else if (Number.isFinite(startTs) && Number.isFinite(endTs)) {
    if (nowTs < startTs) computedStatus = "scheduled";
    else if (nowTs <= endTs) computedStatus = "active";
  }

  return {
    ...maintenance,
    computedStatus,
  };
}

function getMaintenanceRank(status) {
  if (status === "active") return 0;
  if (status === "scheduled") return 1;
  if (status === "completed") return 2;
  return 3;
}
