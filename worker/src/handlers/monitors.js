import { MONITOR_INDEX_KEY, MONITOR_PAGE_MAX_LIMIT } from "../config/constants.js";
import { getBillingPlanConfig, getEntitlementsForBilling, getWorkspaceBilling } from "../services/billing.js";
import { json } from "../lib/http.js";
import { attachPsiCapability } from "../lib/psi.js";
import { buildChildMonitorName, getBaseEndpoint, isStaticPath, normalizeEndpointList } from "../lib/urls.js";
import { buildMonitorMetricsSummary, checkEndpoint, pingMonitor, validateMonitorCandidate } from "../services/monitoring.js";
import { invalidateWorkspaceStatusPageCaches } from "../services/statusPages.js";
import { countOwnedMonitors } from "../services/planUsage.js";
import {
  ensureWorkspaceMembership,
  ensureWorkspaceScopedRecord,
  getWorkspaceCollectionIds,
  isPersonalWorkspaceId,
  removeWorkspaceMembership,
  workspaceCollectionHasItem,
} from "../services/workspaces.js";

const WORKSPACE_SUMMARY_CACHE_MS = 10 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Batch-fetch monitor objects in a single Redis MGET instead of N serial GETs.
 * Returns { monitors, staleIds } — stale IDs are those with no record in Redis.
 */
async function batchGetMonitors(redis, ids) {
  if (!ids || ids.length === 0) return { monitors: [], staleIds: [] };
  const keys = ids.map((id) => `monitor:${id}`);
  const results = await redis.mget(...keys);
  const monitors = [];
  const staleIds = [];
  for (let i = 0; i < ids.length; i++) {
    const record = results[i];
    if (!record) {
      staleIds.push(ids[i]);
    } else {
      monitors.push(record);
    }
  }
  return { monitors, staleIds };
}

/**
 * Batch-fetch monitor_summary objects in a single Redis MGET.
 * Returns a map of monitorId → summaryObject (or null).
 */
async function batchGetSummaries(redis, monitorIds) {
  if (!monitorIds || monitorIds.length === 0) return {};
  const keys = monitorIds.map((id) => `monitor_summary:${id}`);
  const results = await redis.mget(...keys);
  const map = {};
  for (let i = 0; i < monitorIds.length; i++) {
    map[monitorIds[i]] = results[i] || null;
  }
  return map;
}

/**
 * Prune stale IDs from workspace membership and user list simultaneously.
 * Avoids repeated individual lrem/srem calls by batching where possible.
 */
async function pruneStaleIds(redis, workspaceId, fallbackKey, staleIds) {
  if (!staleIds || staleIds.length === 0) return;
  await Promise.all(
    staleIds.map((id) =>
      Promise.all([
        removeWorkspaceMembership(redis, workspaceId, "monitors", id),
        fallbackKey ? redis.lrem(fallbackKey, 0, id) : Promise.resolve(),
      ])
    )
  );
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

// ── Handlers ───────────────────────────────────────────────────────────────────

export async function addMonitor(request, redis, userId, workspaceId, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const { name, url } = body;
  if (!name || !url) {
    return json({ error: "name and url are required" }, 400, corsHeaders);
  }

  const workspace = workspaceId ? await redis.get(`workspace:${workspaceId}`) : null;
  const billing = await getWorkspaceBilling(redis, workspace || workspaceId);
  const entitlements = getEntitlementsForBilling(billing);
  const ownedMonitorCount = await countOwnedMonitors(redis, userId);
  if (Number.isFinite(entitlements.maxMonitors) && ownedMonitorCount >= entitlements.maxMonitors) {
    const currentPlan = getBillingPlanConfig(billing?.plan);
    return json({
      error: `Your ${currentPlan.label} plan includes up to ${entitlements.maxMonitors} monitor${entitlements.maxMonitors === 1 ? "" : "s"}. Upgrade to add more.`,
    }, 403, corsHeaders);
  }

  const canonicalUrl = getBaseEndpoint(url);
  if (!canonicalUrl) {
    return json({ error: "Invalid URL" }, 400, corsHeaders);
  }

  const validation = await validateMonitorCandidate(canonicalUrl);
  if (!validation.ok) {
    return json({ error: validation.message }, 400, corsHeaders);
  }

  const urlIndexKey = workspaceId
    ? `workspace:${workspaceId}:monitor_url:${canonicalUrl}`
    : `user:${userId}:monitor_url:${canonicalUrl}`;
  const existingId = await redis.get(urlIndexKey);
  if (existingId) {
    const existingMonitor = await redis.get(`monitor:${existingId}`);
    if (existingMonitor) return json(attachPsiCapability(existingMonitor), 200, corsHeaders);
    await redis.del(urlIndexKey);
  }

  const id = `${userId}_${Date.now()}`;
  const monitor = attachPsiCapability({
    id,
    userId,
    workspaceId,
    name,
    url: canonicalUrl,
    endpoints: [canonicalUrl],
    type: "parent",
    status: "PENDING",
    createdAt: new Date().toISOString(),
    lastContentType: validation.contentType || "",
    metrics24h: {
      windowSize: 0,
      uptime24h: null,
      avgLatency24h: null,
      degradedChecks24h: 0,
      downChecks24h: 0,
    },
  }, validation.contentType);

  await redis.set(`monitor:${id}`, monitor);
  await redis.set(`monitor_summary:${id}`, {
    window: [],
    ...monitor.metrics24h,
  });
  if (isPersonalWorkspaceId(workspaceId)) {
    await redis.lpush(`user:${userId}:monitors`, id);
  }
  await ensureWorkspaceMembership(redis, workspaceId, "monitors", id);
  await redis.sadd(MONITOR_INDEX_KEY, id);
  await redis.set(urlIndexKey, id);
  await invalidateWorkspaceStatusPageCaches(redis, workspaceId);
  await invalidateWorkspaceMonitorSummary(redis, workspaceId);

  return json(monitor, 201, corsHeaders);
}

export async function getMonitors(request, redis, userId, workspaceId, corsHeaders) {
  const urlObj = new URL(request.url);
  const includeChildren = urlObj.searchParams.get("includeChildren") === "true";
  const rawLimit = Number.parseInt(urlObj.searchParams.get("limit") || "50", 10);
  const safeLimit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(rawLimit, MONITOR_PAGE_MAX_LIMIT))
    : 50;
  const rawCursor = Number.parseInt(urlObj.searchParams.get("cursor") || "0", 10);
  const safeCursor = Number.isFinite(rawCursor) ? Math.max(0, rawCursor) : 0;

  const fallbackKey = isPersonalWorkspaceId(workspaceId) ? `user:${userId}:monitors` : null;
  const allIds = await getWorkspaceCollectionIds(redis, workspaceId, "monitors", fallbackKey, -1);

  // Batch fetch all monitors in ONE Redis MGET (eliminates N serial GETs)
  const { monitors: allValidMonitors, staleIds } = await batchGetMonitors(redis, allIds);

  // Prune stale IDs asynchronously (no need to wait serially)
  if (staleIds.length > 0) {
    await pruneStaleIds(redis, workspaceId, fallbackKey, staleIds);
  }

  const pageMonitors = allValidMonitors.slice(safeCursor, safeCursor + safeLimit);
  if (pageMonitors.length === 0) {
    return json({ items: [], nextCursor: null, limit: safeLimit }, 200, corsHeaders);
  }

  // Batch fetch all summaries in ONE Redis MGET
  const pageMonitorIds = pageMonitors.map((m) => m.id).filter(Boolean);
  const summaryMap = await batchGetSummaries(redis, pageMonitorIds);

  // Apply summaries to monitor objects — READ ONLY (no write-back on read path).
  // Metrics are already updated during ping events; writing here would cause
  // unnecessary write amplification at scale (N writes per GET /monitors call).
  const items = pageMonitors
    .filter(Boolean)
    .map((monitor) => {
      const summary = summaryMap[monitor.id];
      const enriched = summary
        ? {
            ...monitor,
            metrics24h: {
              windowSize: summary.windowSize ?? null,
              uptime24h: summary.uptime24h ?? null,
              avgLatency24h: summary.avgLatency24h ?? null,
              degradedChecks24h: summary.degradedChecks24h ?? 0,
              downChecks24h: summary.downChecks24h ?? 0,
            },
          }
        : monitor;
      return attachPsiCapability(enriched);
    })
    .filter((m) => includeChildren || m.type !== "child");

  // Ensure workspace scoping ONLY for personal workspace reads, where the monitor
  // might pre-date workspace collections. For team workspaces, monitors are LINKED
  // (not moved) — we must NOT overwrite their original workspaceId.
  if (isPersonalWorkspaceId(workspaceId)) {
    Promise.all(
      pageMonitors.map((m) => ensureWorkspaceScopedRecord(redis, `monitor:${m.id}`, m, workspaceId, "monitors"))
    ).catch(() => { /* best-effort */ });
  }

  const nextCursor =
    safeCursor + pageMonitors.length < allValidMonitors.length
      ? String(safeCursor + pageMonitors.length)
      : null;

  return json({ items, nextCursor, limit: safeLimit }, 200, corsHeaders);
}

export async function getMonitorSummary(request, redis, userId, workspaceId, corsHeaders) {
  const fallbackKey = isPersonalWorkspaceId(workspaceId) ? `user:${userId}:monitors` : null;
  const summary = await getWorkspaceMonitorSummary(redis, workspaceId, fallbackKey);
  return json(summary, 200, corsHeaders);
}

export async function deleteMonitor(request, redis, userId, workspaceId, id, corsHeaders) {
  const monitor = await redis.get(`monitor:${id}`);
  if (!monitor) return json({ success: true }, 200, corsHeaders);
  // Allow delete if the monitor belongs to this workspace OR if the requesting user owns the monitor
  // (covers the case where a monitor's workspaceId is the personal workspace but is shared/linked
  // into a team workspace, so the owner can still delete it from any of their workspaces).
  const inThisWorkspace = monitor.workspaceId === workspaceId;
  const isOwner = monitor.userId === userId;
  if (!inThisWorkspace && !isOwner)
    return json({ error: "Forbidden" }, 403, corsHeaders);
  if (!isOwner)
    return json({ error: "Forbidden" }, 403, corsHeaders);

  if (monitor.type !== "child") {
    const childIds = await redis.lrange(`monitor:${id}:children`, 0, -1);
    if (Array.isArray(childIds) && childIds.length > 0) {
      // Batch-fetch child monitors to get their URLs for index cleanup
      const { monitors: children } = await batchGetMonitors(redis, childIds);
      // Delete all children in parallel
      await Promise.all(
        children.map(async (child) => {
          if (child?.url) {
            const childCanonicalUrl = getBaseEndpoint(child.url);
            if (childCanonicalUrl) {
              await Promise.all([
                redis.del(`user:${userId}:monitor_url:${childCanonicalUrl}`),
                monitor.workspaceId
                  ? redis.del(`workspace:${monitor.workspaceId}:monitor_url:${childCanonicalUrl}`)
                  : Promise.resolve(),
              ]);
            }
          }
          await Promise.all([
            redis.del(`monitor:${child.id}`),
            redis.lrem(`user:${userId}:monitors`, 0, child.id),
            removeWorkspaceMembership(redis, monitor.workspaceId || `ws_${userId}`, "monitors", child.id),
            redis.srem(MONITOR_INDEX_KEY, child.id),
            redis.del(`history:${child.id}`),
            redis.del(`monitor_summary:${child.id}`),
          ]);
        })
      );
      await redis.del(`monitor:${id}:children`);
    }
  } else if (monitor.parentId) {
    await redis.lrem(`monitor:${monitor.parentId}:children`, 0, id);
  }

  if (monitor.url) {
    const canonicalUrl = getBaseEndpoint(monitor.url);
    if (canonicalUrl) {
      await Promise.all([
        redis.del(`user:${userId}:monitor_url:${canonicalUrl}`),
        monitor.workspaceId
          ? redis.del(`workspace:${monitor.workspaceId}:monitor_url:${canonicalUrl}`)
          : Promise.resolve(),
      ]);
    }
  }

  const ownerWorkspaceId = monitor.workspaceId || `ws_${userId}`;
  await Promise.all([
    redis.del(`monitor:${id}`),
    redis.lrem(`user:${userId}:monitors`, 0, id),
    removeWorkspaceMembership(redis, ownerWorkspaceId, "monitors", id),
    redis.srem(MONITOR_INDEX_KEY, id),
    redis.del(`history:${id}`),
    redis.del(`monitor_summary:${id}`),
  ]);
  await invalidateWorkspaceStatusPageCaches(redis, ownerWorkspaceId);
  await invalidateWorkspaceMonitorSummary(redis, ownerWorkspaceId);

  return json({ success: true }, 200, corsHeaders);
}

export async function getChildMonitors(request, redis, userId, workspaceId, parentId, corsHeaders) {
  const parent = await redis.get(`monitor:${parentId}`);
  if (!parent) return json({ error: "Monitor not found" }, 404, corsHeaders);
  if (!(await canAccessWorkspaceMonitor(redis, parent, userId, workspaceId)))
    return json({ error: "Forbidden" }, 403, corsHeaders);

  const childIds = await redis.lrange(`monitor:${parentId}:children`, 0, -1);
  if (!Array.isArray(childIds) || childIds.length === 0) return json([], 200, corsHeaders);

  // Deduplicate IDs then batch fetch
  const uniqueIds = [...new Set(childIds)];
  const { monitors: children } = await batchGetMonitors(redis, uniqueIds);

  return json(children.map((child) => attachPsiCapability(child)), 200, corsHeaders);
}

export async function addChildMonitors(request, redis, userId, workspaceId, parentId, corsHeaders) {
  const parent = await redis.get(`monitor:${parentId}`);
  if (!parent) return json({ error: "Monitor not found" }, 404, corsHeaders);
  if (!(await canAccessWorkspaceMonitor(redis, parent, userId, workspaceId)))
    return json({ error: "Forbidden" }, 403, corsHeaders);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const endpoints = Array.isArray(body?.endpoints) ? body.endpoints : null;
  if (!endpoints || endpoints.length === 0) {
    return json({ error: "endpoints array is required" }, 400, corsHeaders);
  }

  const existingChildIds = await redis.lrange(`monitor:${parentId}:children`, 0, -1);
  const existingChildUrls = new Set();
  if (Array.isArray(existingChildIds) && existingChildIds.length > 0) {
    const { monitors: existingChildren } = await batchGetMonitors(redis, existingChildIds);
    for (const child of existingChildren) {
      const canonicalChildUrl = getBaseEndpoint(child.url);
      if (canonicalChildUrl) existingChildUrls.add(canonicalChildUrl);
    }
  }

  const created = [];
  const seenCandidateUrls = new Set();

  for (const rawEndpoint of endpoints) {
    if (typeof rawEndpoint !== "string") continue;
    const canonicalUrl = getBaseEndpoint(rawEndpoint.trim());
    if (!canonicalUrl || canonicalUrl === parent.url || isStaticPath(canonicalUrl)) continue;
    if (seenCandidateUrls.has(canonicalUrl) || existingChildUrls.has(canonicalUrl)) continue;

    seenCandidateUrls.add(canonicalUrl);

    const urlIndexKey = workspaceId
      ? `workspace:${workspaceId}:monitor_url:${canonicalUrl}`
      : `user:${userId}:monitor_url:${canonicalUrl}`;
    const existingId = await redis.get(urlIndexKey);
    if (existingId) {
      const existing = await redis.get(`monitor:${existingId}`);
      if (existing && existing.parentId === parentId) {
        created.push(existing);
        existingChildUrls.add(canonicalUrl);
      }
      continue;
    }

    const childId = `${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const childMonitor = {
      id: childId,
      userId,
      workspaceId,
      parentId,
      type: "child",
      name: buildChildMonitorName(parent.name, canonicalUrl),
      url: canonicalUrl,
      endpoints: [canonicalUrl],
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };

    const firstResult = await checkEndpoint(canonicalUrl, 1);
    childMonitor.status = firstResult.status;
    childMonitor.lastChecked = firstResult.timestamp;
    childMonitor.lastLatency = firstResult.latency;
    childMonitor.lastStatusCode = firstResult.statusCode;
    childMonitor.lastErrorType = firstResult.errorType;
    childMonitor.lastContentType = firstResult.contentType || "";
    Object.assign(childMonitor, attachPsiCapability(childMonitor, firstResult.contentType));

    await redis.set(`monitor:${childId}`, childMonitor);
    if (isPersonalWorkspaceId(workspaceId)) {
      await redis.lpush(`user:${userId}:monitors`, childId);
    }
    await ensureWorkspaceMembership(redis, workspaceId, "monitors", childId);
    await redis.lpush(`monitor:${parentId}:children`, childId);
    await redis.sadd(MONITOR_INDEX_KEY, childId);
    await redis.set(urlIndexKey, childId);

    const historyEntry = {
      timestamp: firstResult.timestamp,
      latency: firstResult.latency,
      status: firstResult.status,
      statusCode: firstResult.statusCode,
      errorType: firstResult.errorType,
    };
    await redis.lpush(`history:${childId}`, historyEntry);
    await redis.ltrim(`history:${childId}`, 0, 2015);
    childMonitor.metrics24h = buildMonitorMetricsSummary([historyEntry]);
    await redis.set(`monitor:${childId}`, childMonitor);
    await redis.set(`monitor_summary:${childId}`, {
      window: [{
        s: historyEntry.status,
        l: Number.isFinite(historyEntry.latency) ? historyEntry.latency : null,
        t: historyEntry.timestamp,
      }],
      ...childMonitor.metrics24h,
    });

    existingChildUrls.add(canonicalUrl);
    created.push(childMonitor);
  }

  return json({ monitors: created }, 201, corsHeaders);
}

export async function getHistory(request, redis, userId, workspaceId, id, corsHeaders) {
  const monitor = await redis.get(`monitor:${id}`);
  if (!monitor) return json({ error: "Monitor not found" }, 404, corsHeaders);
  if (!(await canAccessWorkspaceMonitor(redis, monitor, userId, workspaceId)))
    return json({ error: "Forbidden" }, 403, corsHeaders);

  const url = new URL(request.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "288", 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 2016)) : 288;
  const history = await redis.lrange(`history:${id}`, 0, limit - 1);
  return json(history, 200, corsHeaders);
}

export async function updateMonitorEndpoints(request, redis, userId, workspaceId, id, corsHeaders) {
  const monitor = await redis.get(`monitor:${id}`);
  if (!monitor) return json({ error: "Monitor not found" }, 404, corsHeaders);
  if (!(await canAccessWorkspaceMonitor(redis, monitor, userId, workspaceId)))
    return json({ error: "Forbidden" }, 403, corsHeaders);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const inputEndpoints = Array.isArray(body?.endpoints) ? body.endpoints : null;
  if (!inputEndpoints) {
    return json({ error: "endpoints array is required" }, 400, corsHeaders);
  }

  monitor.endpoints = normalizeEndpointList(inputEndpoints, monitor.url);
  monitor.updatedAt = new Date().toISOString();
  await redis.set(`monitor:${id}`, monitor);
  await invalidateWorkspaceMonitorSummary(redis, workspaceId);

  return json({ endpoints: monitor.endpoints, monitor }, 200, corsHeaders);
}

export async function pingSingle(request, redis, userId, workspaceId, id, env, corsHeaders, ctx = null) {
  const monitor = await redis.get(`monitor:${id}`);
  if (!monitor) return json({ error: "Monitor not found" }, 404, corsHeaders);
  if (!(await canAccessWorkspaceMonitor(redis, monitor, userId, workspaceId)))
    return json({ error: "Forbidden" }, 403, corsHeaders);

  const { historyEntry } = await pingMonitor(redis, monitor, env, {
    waitUntil: ctx?.waitUntil?.bind(ctx),
  });
  return json({ monitor, history: historyEntry }, 200, corsHeaders);
}

// ── Workspace monitor summary (with cache) ─────────────────────────────────────

async function getWorkspaceMonitorSummary(redis, workspaceId, fallbackKey = null) {
  const cacheKey = `workspace_monitor_summary:${workspaceId}`;
  const cached = await redis.get(cacheKey);
  const cacheCreatedAt = new Date(cached?.generatedAt || "").getTime();
  if (cached && Number.isFinite(cacheCreatedAt) && Date.now() - cacheCreatedAt <= WORKSPACE_SUMMARY_CACHE_MS) {
    return cached;
  }

  const ids = await getWorkspaceCollectionIds(redis, workspaceId, "monitors", fallbackKey, -1);

  // Batch fetch all monitors in ONE Redis MGET
  const { monitors: allMonitors, staleIds } = await batchGetMonitors(redis, ids);

  if (staleIds.length > 0) {
    await pruneStaleIds(redis, workspaceId, fallbackKey, staleIds);
  }

  // Filter to parent monitors only, then batch fetch their summaries
  const parentMonitors = allMonitors.filter((m) => m.type !== "child");
  const parentIds = parentMonitors.map((m) => m.id);
  const summaryMap = await batchGetSummaries(redis, parentIds);

  // Enrich monitors with their summaries (read-only)
  const enrichedMonitors = parentMonitors.map((m) => {
    const summary = summaryMap[m.id];
    if (!summary) return m;
    return {
      ...m,
      metrics24h: {
        windowSize: summary.windowSize ?? null,
        uptime24h: summary.uptime24h ?? null,
        avgLatency24h: summary.avgLatency24h ?? null,
        degradedChecks24h: summary.degradedChecks24h ?? 0,
        downChecks24h: summary.downChecks24h ?? 0,
      },
    };
  });

  const uptimeValues = enrichedMonitors
    .map((m) => m?.metrics24h?.uptime24h)
    .filter((v) => Number.isFinite(v));
  const latencyValues = enrichedMonitors
    .map((m) => m?.metrics24h?.avgLatency24h)
    .filter((v) => Number.isFinite(v));

  const payload = {
    totalMonitors: enrichedMonitors.length,
    availableNow: enrichedMonitors.filter((m) => m.status === "UP").length,
    downNow: enrichedMonitors.filter((m) => m.status === "DOWN").length,
    degradedNow: enrichedMonitors.filter((m) => m.status === "UP_RESTRICTED").length,
    uptime24h:
      uptimeValues.length > 0
        ? Math.round(uptimeValues.reduce((sum, v) => sum + v, 0) / uptimeValues.length)
        : null,
    avgResponse24h:
      latencyValues.length > 0
        ? Math.round(latencyValues.reduce((sum, v) => sum + v, 0) / latencyValues.length)
        : null,
    generatedAt: new Date().toISOString(),
  };
  await redis.set(cacheKey, payload);
  return payload;
}

async function invalidateWorkspaceMonitorSummary(redis, workspaceId) {
  if (!workspaceId) return;
  await redis.del(`workspace_monitor_summary:${workspaceId}`);
}
