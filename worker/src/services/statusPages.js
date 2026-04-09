import { INCIDENT_LIST_MAX_LIMIT, STATUS_PAGE_LIST_MAX_LIMIT } from "../config/constants.js";
import {
  ensureWorkspaceMembership,
  ensureWorkspaceScopedRecord,
  getWorkspaceCollectionIds,
} from "./workspaces.js";
import { buildWorkspaceMaintenanceSummary } from "./maintenance.js";

const PUBLIC_STATUS_CACHE_TTL_MS = 2 * 60 * 1000;

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function buildStatusPage(workspaceId, userId, input = {}) {
  const nowIso = new Date().toISOString();
  const slugBase = slugify(input.slug || input.name || `status-${workspaceId}`);
  return {
    id: `spg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    userId,
    name: String(input.name || "Public Status").trim() || "Public Status",
    slug: slugBase || `status-${workspaceId.slice(-6)}`,
    heroTitle: String(input.heroTitle || "Service status").trim() || "Service status",
    heroDescription: String(input.heroDescription || "Live availability and incident updates for selected monitors.").trim(),
    isPublic: input.isPublic !== false,
    selectedMonitorIds: Array.isArray(input.selectedMonitorIds)
      ? [...new Set(input.selectedMonitorIds.filter(Boolean).map(String))]
      : [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function normalizeStatusPageInput(workspaceId, userId, body, existing = null) {
  const base = existing || buildStatusPage(workspaceId, userId, body);
  const slug = slugify(body?.slug || base.slug || base.name);
  return {
    ...base,
    workspaceId,
    userId,
    name: typeof body?.name === "string" && body.name.trim() ? body.name.trim() : base.name,
    slug: slug || base.slug,
    heroTitle: typeof body?.heroTitle === "string" && body.heroTitle.trim() ? body.heroTitle.trim() : base.heroTitle,
    heroDescription: typeof body?.heroDescription === "string"
      ? body.heroDescription.trim()
      : base.heroDescription,
    isPublic: body?.isPublic != null ? Boolean(body.isPublic) : base.isPublic,
    selectedMonitorIds: Array.isArray(body?.selectedMonitorIds)
      ? [...new Set(body.selectedMonitorIds.filter(Boolean).map(String))]
      : base.selectedMonitorIds,
    updatedAt: new Date().toISOString(),
  };
}

export async function saveStatusPage(redis, statusPage) {
  await redis.set(`status_page:${statusPage.id}`, statusPage);
  await redis.set(`status_page:slug:${statusPage.slug}`, statusPage.id);
  await ensureWorkspaceMembership(redis, statusPage.workspaceId, "status_pages", statusPage.id);
  await invalidatePublicStatusCache(redis, statusPage.id);
  return statusPage;
}

export async function listStatusPages(redis, userId, workspaceId) {
  const ids = await getWorkspaceCollectionIds(
    redis,
    workspaceId,
    "status_pages",
    null,
    STATUS_PAGE_LIST_MAX_LIMIT - 1
  );
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const seen = new Set();
  const pages = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const page = await redis.get(`status_page:${id}`);
    if (!page) continue;
    if (page.workspaceId !== workspaceId) continue;
    pages.push({
      ...page,
      selectedMonitorCount: Array.isArray(page.selectedMonitorIds) ? page.selectedMonitorIds.length : 0,
    });
  }
  return pages;
}

export async function loadStatusPage(redis, statusPageId, workspaceId = null) {
  const page = await redis.get(`status_page:${statusPageId}`);
  if (!page) return null;
  if (workspaceId) {
    await ensureWorkspaceScopedRecord(redis, `status_page:${statusPageId}`, page, workspaceId, "status_pages");
  }
  return page;
}

export async function loadStatusPageBySlug(redis, slug) {
  const statusPageId = await redis.get(`status_page:slug:${slug}`);
  if (!statusPageId) return null;
  return redis.get(`status_page:${statusPageId}`);
}

export async function buildPublicStatusPayload(redis, statusPage) {
  const selectedIds = Array.isArray(statusPage.selectedMonitorIds) ? statusPage.selectedMonitorIds : [];
  const monitors = [];

  for (const monitorId of selectedIds) {
    const monitor = await redis.get(`monitor:${monitorId}`);
    if (!monitor) continue;
    const metrics = monitor.metrics24h || null;
    monitors.push({
      id: monitor.id,
      name: monitor.name,
      url: monitor.url,
      status: monitor.status,
      lastChecked: monitor.lastChecked || null,
      lastLatency: monitor.lastLatency ?? null,
      lastStatusCode: monitor.lastStatusCode ?? null,
      uptime24h: Number.isFinite(metrics?.uptime24h) ? metrics.uptime24h : null,
    });
  }

  monitors.sort((left, right) => {
    const severityDelta = getStatusRank(left.status) - getStatusRank(right.status);
    if (severityDelta !== 0) return severityDelta;
    return String(left.name || "").localeCompare(String(right.name || ""));
  });

  const incidentIds = await getWorkspaceCollectionIds(
    redis,
    statusPage.workspaceId,
    "incidents",
    `user:${statusPage.userId}:incidents`,
    INCIDENT_LIST_MAX_LIMIT - 1
  );
  const activeIncidents = [];
  const recentResolvedIncidents = [];

  for (const incidentId of incidentIds) {
    const incident = await redis.get(`incident:${incidentId}`);
    if (!incident) continue;
    if (!selectedIds.includes(incident.monitorId)) continue;

    const payload = {
      id: incident.id,
      code: incident.code,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt,
      monitorName: incident.monitorName,
      impactSummary: incident.impactSummary,
      fixSummary: incident.fixSummary,
    };

    if (incident.status === "resolved") {
      if (recentResolvedIncidents.length < 5) recentResolvedIncidents.push(payload);
    } else if (activeIncidents.length < 5) {
      activeIncidents.push(payload);
    }
  }

  activeIncidents.sort((left, right) => toTs(right.startedAt) - toTs(left.startedAt));
  recentResolvedIncidents.sort((left, right) => toTs(right.resolvedAt) - toTs(left.resolvedAt));

  const summary = {
    totalMonitors: monitors.length,
    available: monitors.filter((monitor) => monitor.status === "UP").length,
    degraded: monitors.filter((monitor) => monitor.status === "UP_RESTRICTED").length,
    down: monitors.filter((monitor) => monitor.status === "DOWN").length,
    maintenance: monitors.filter((monitor) => monitor.status === "MAINTENANCE").length,
    activeIncidents: activeIncidents.length,
  };

  const overallStatus = buildOverallStatus(summary);
  const maintenance = await buildWorkspaceMaintenanceSummary(redis, statusPage.workspaceId, selectedIds);

  return {
    id: statusPage.id,
    slug: statusPage.slug,
    name: statusPage.name,
    heroTitle: statusPage.heroTitle,
    heroDescription: statusPage.heroDescription,
    monitors,
    summary,
    overallStatus,
    maintenance,
    activeIncidents,
    recentResolvedIncidents,
    updatedAt: new Date().toISOString(),
  };
}

export async function getPublicStatusPayloadCached(redis, statusPage) {
  const cacheKey = getPublicStatusCacheKey(statusPage.id);
  const cached = await redis.get(cacheKey);
  if (cached?.generatedAt && Date.now() - toTs(cached.generatedAt) < PUBLIC_STATUS_CACHE_TTL_MS && cached?.payload) {
    return cached.payload;
  }

  const payload = await buildPublicStatusPayload(redis, statusPage);
  await redis.set(cacheKey, {
    generatedAt: new Date().toISOString(),
    payload,
  });
  return payload;
}

export async function invalidatePublicStatusCache(redis, statusPageId) {
  await redis.del(getPublicStatusCacheKey(statusPageId));
}

export async function invalidateWorkspaceStatusPageCaches(redis, workspaceId) {
  if (!workspaceId) return;

  const ids = await getWorkspaceCollectionIds(
    redis,
    workspaceId,
    "status_pages",
    null,
    STATUS_PAGE_LIST_MAX_LIMIT - 1
  );

  if (!Array.isArray(ids) || ids.length === 0) return;

  const cacheKeys = ids
    .filter(Boolean)
    .map((id) => getPublicStatusCacheKey(id));

  if (cacheKeys.length === 0) return;
  await redis.del(...cacheKeys);
}

function getPublicStatusCacheKey(statusPageId) {
  return `status_page:${statusPageId}:public_summary`;
}

function buildOverallStatus(summary) {
  if (summary.down > 0) {
    return {
      code: "major_outage",
      label: "Major outage",
      tone: "down",
      message: "Some public components are currently unavailable.",
    };
  }

  if (summary.degraded > 0) {
    return {
      code: "partial_disruption",
      label: "Partial disruption",
      tone: "degraded",
      message: "Some components are experiencing degraded performance.",
    };
  }

  if (summary.maintenance > 0) {
    return {
      code: "maintenance",
      label: "Scheduled maintenance",
      tone: "maintenance",
      message: "Some public components are currently in a planned maintenance window.",
    };
  }

  return {
    code: "operational",
    label: "All systems operational",
    tone: "up",
    message: "All published components are operating normally.",
  };
}

function getStatusRank(status) {
  if (status === "DOWN") return 0;
  if (status === "UP_RESTRICTED") return 1;
  return 2;
}

function toTs(value) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}
