import { INCIDENT_UPDATE_MAX_LIMIT } from "../config/constants.js";
import { getWorkspaceMembership } from "./workspaces.js";
import { MAINTENANCE_LIST_MAX_LIMIT } from "../config/constants.js";

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
  const [updates, withAssignee, monitorSnapshot, maintenanceContext] = await Promise.all([
    redis.lrange(`incident:${incident.id}:updates`, 0, INCIDENT_UPDATE_MAX_LIMIT - 1),
    enrichIncidentAssignee(redis, incident),
    buildIncidentMonitorSnapshot(redis, incident),
    buildIncidentMaintenanceContext(redis, incident),
  ]);
  return {
    ...withAssignee,
    updates: Array.isArray(updates) ? updates : [],
    monitorSnapshot,
    maintenanceContext,
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

async function buildIncidentMonitorSnapshot(redis, incident) {
  const monitorId = typeof incident?.monitorId === "string" ? incident.monitorId.trim() : "";
  if (!monitorId) return null;

  const [monitor, summary] = await Promise.all([
    redis.get(`monitor:${monitorId}`),
    redis.get(`monitor_summary:${monitorId}`),
  ]);

  if (!monitor) {
    return {
      id: monitorId,
      name: incident?.monitorName || monitorId,
      url: incident?.monitorUrl || "",
      unavailable: true,
    };
  }

  return {
    id: monitor.id,
    name: monitor.name || incident?.monitorName || monitor.id,
    url: monitor.url || incident?.monitorUrl || "",
    status: monitor.status || "PENDING",
    lastChecked: monitor.lastChecked || null,
    lastLatency: Number.isFinite(monitor.lastLatency) ? monitor.lastLatency : null,
    lastStatusCode: Number.isFinite(monitor.lastStatusCode) ? monitor.lastStatusCode : null,
    lastErrorType: monitor.lastErrorType || "",
    lastTransition: monitor.lastTransition || null,
    metrics24h: summary
      ? {
          windowSize: summary.windowSize ?? null,
          uptime24h: summary.uptime24h ?? null,
          avgLatency24h: summary.avgLatency24h ?? null,
          degradedChecks24h: summary.degradedChecks24h ?? 0,
          downChecks24h: summary.downChecks24h ?? 0,
        }
      : (monitor.metrics24h || null),
  };
}

async function buildIncidentMaintenanceContext(redis, incident) {
  const monitorId = typeof incident?.monitorId === "string" ? incident.monitorId.trim() : "";
  if (!monitorId) {
    return {
      active: null,
      nextScheduled: null,
      recentCompleted: null,
    };
  }

  const ids = await redis.lrange(`monitor:${monitorId}:maintenances`, 0, MAINTENANCE_LIST_MAX_LIMIT - 1);
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return {
      active: null,
      nextScheduled: null,
      recentCompleted: null,
    };
  }

  const items = await redis.mget(...uniqueIds.map((id) => `maintenance:${id}`));
  const nowTs = Date.now();
  const normalized = (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map((item) => withComputedMaintenanceState(item, nowTs))
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());

  const active = normalized.find((item) => item.computedStatus === "active") || null;
  const nextScheduled = normalized.find((item) => item.computedStatus === "scheduled") || null;
  const recentCompleted = [...normalized]
    .filter((item) => item.computedStatus === "completed")
    .sort((left, right) => new Date(right.endsAt).getTime() - new Date(left.endsAt).getTime())[0] || null;

  return {
    active: minifyMaintenance(active),
    nextScheduled: minifyMaintenance(nextScheduled),
    recentCompleted: minifyMaintenance(recentCompleted),
  };
}

function withComputedMaintenanceState(maintenance, nowTs = Date.now()) {
  let computedStatus = "completed";
  const startTs = new Date(maintenance?.startsAt).getTime();
  const endTs = new Date(maintenance?.endsAt).getTime();

  if (maintenance?.cancelledAt) {
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

function minifyMaintenance(maintenance) {
  if (!maintenance) return null;
  return {
    id: maintenance.id,
    title: maintenance.title || "Scheduled maintenance",
    startsAt: maintenance.startsAt || null,
    endsAt: maintenance.endsAt || null,
    computedStatus: maintenance.computedStatus || "completed",
  };
}
