import { MONITOR_INDEX_KEY, MONITOR_PAGE_MAX_LIMIT } from "../config/constants.js";
import { json } from "../lib/http.js";
import { attachPsiCapability } from "../lib/psi.js";
import { buildChildMonitorName, getBaseEndpoint, isStaticPath, normalizeEndpointList } from "../lib/urls.js";
import { checkEndpoint, pingMonitor, validateMonitorCandidate } from "../services/monitoring.js";
import { invalidateWorkspaceStatusPageCaches } from "../services/statusPages.js";
import {
  ensureWorkspaceMembership,
  ensureWorkspaceScopedRecord,
  getWorkspaceCollectionIds,
  isPersonalWorkspaceId,
  removeWorkspaceMembership,
} from "../services/workspaces.js";

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
  }, validation.contentType);

  await redis.set(`monitor:${id}`, monitor);
  if (isPersonalWorkspaceId(workspaceId)) {
    await redis.lpush(`user:${userId}:monitors`, id);
  }
  await ensureWorkspaceMembership(redis, workspaceId, "monitors", id);
  await redis.sadd(MONITOR_INDEX_KEY, id);
  await redis.set(urlIndexKey, id);
  await invalidateWorkspaceStatusPageCaches(redis, workspaceId);

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
  const pageIds = await getWorkspaceCollectionIds(redis, workspaceId, "monitors", fallbackKey, safeCursor + safeLimit - 1);
  const pagedIds = pageIds.slice(safeCursor, safeCursor + safeLimit);
  if (!pagedIds || pagedIds.length === 0) {
    return json({ items: [], nextCursor: null, limit: safeLimit }, 200, corsHeaders);
  }

  const pageMonitors = await Promise.all(pagedIds.map((id) => redis.get(`monitor:${id}`)));
  for (const monitor of pageMonitors) {
    if (monitor) {
      await ensureWorkspaceScopedRecord(redis, `monitor:${monitor.id}`, monitor, workspaceId, "monitors");
    }
  }
  const items = pageMonitors
    .filter(Boolean)
    .map((monitor) => attachPsiCapability(monitor))
    .filter((monitor) => includeChildren || monitor.type !== "child");

  const nextCursor = pagedIds.length === safeLimit ? String(safeCursor + pagedIds.length) : null;
  return json({ items, nextCursor, limit: safeLimit }, 200, corsHeaders);
}

export async function deleteMonitor(request, redis, userId, workspaceId, id, corsHeaders) {
  const monitor = await redis.get(`monitor:${id}`);
  if (!monitor) return json({ success: true }, 200, corsHeaders);
  if (monitor.workspaceId && monitor.workspaceId !== workspaceId) return json({ error: "Forbidden" }, 403, corsHeaders);
  if (!monitor.workspaceId && monitor.userId !== userId) return json({ error: "Forbidden" }, 403, corsHeaders);

  if (monitor.type !== "child") {
    const childIds = await redis.lrange(`monitor:${id}:children`, 0, -1);
    if (Array.isArray(childIds) && childIds.length > 0) {
      for (const childId of childIds) {
        const child = await redis.get(`monitor:${childId}`);
        if (child?.url) {
          const childCanonicalUrl = getBaseEndpoint(child.url);
          if (childCanonicalUrl) {
            await redis.del(`user:${userId}:monitor_url:${childCanonicalUrl}`);
            if (monitor.workspaceId) {
              await redis.del(`workspace:${monitor.workspaceId}:monitor_url:${childCanonicalUrl}`);
            }
          }
        }
        await redis.del(`monitor:${childId}`);
        await redis.lrem(`user:${userId}:monitors`, 0, childId);
        await removeWorkspaceMembership(redis, monitor.workspaceId || `ws_${userId}`, "monitors", childId);
        await redis.srem(MONITOR_INDEX_KEY, childId);
        await redis.del(`history:${childId}`);
      }
      await redis.del(`monitor:${id}:children`);
    }
  } else if (monitor.parentId) {
    await redis.lrem(`monitor:${monitor.parentId}:children`, 0, id);
  }

  if (monitor.url) {
    const canonicalUrl = getBaseEndpoint(monitor.url);
    if (canonicalUrl) {
      await redis.del(`user:${userId}:monitor_url:${canonicalUrl}`);
      if (monitor.workspaceId) {
        await redis.del(`workspace:${monitor.workspaceId}:monitor_url:${canonicalUrl}`);
      }
    }
  }

  await redis.del(`monitor:${id}`);
  await redis.lrem(`user:${userId}:monitors`, 0, id);
  await removeWorkspaceMembership(redis, monitor.workspaceId || `ws_${userId}`, "monitors", id);
  await redis.srem(MONITOR_INDEX_KEY, id);
  await redis.del(`history:${id}`);
  await invalidateWorkspaceStatusPageCaches(redis, monitor.workspaceId || `ws_${userId}`);

  return json({ success: true }, 200, corsHeaders);
}

export async function getChildMonitors(request, redis, userId, workspaceId, parentId, corsHeaders) {
  const parent = await redis.get(`monitor:${parentId}`);
  if (!parent) return json({ error: "Monitor not found" }, 404, corsHeaders);
  if (parent.workspaceId && parent.workspaceId !== workspaceId) return json({ error: "Forbidden" }, 403, corsHeaders);
  if (!parent.workspaceId && parent.userId !== userId) return json({ error: "Forbidden" }, 403, corsHeaders);

  const childIds = await redis.lrange(`monitor:${parentId}:children`, 0, -1);
  if (!Array.isArray(childIds) || childIds.length === 0) return json([], 200, corsHeaders);

  const seen = new Set();
  const children = [];
  for (const childId of childIds) {
    if (seen.has(childId)) continue;
    seen.add(childId);
    const child = await redis.get(`monitor:${childId}`);
    if (child) children.push(attachPsiCapability(child));
  }

  return json(children, 200, corsHeaders);
}

export async function addChildMonitors(request, redis, userId, workspaceId, parentId, corsHeaders) {
  const parent = await redis.get(`monitor:${parentId}`);
  if (!parent) return json({ error: "Monitor not found" }, 404, corsHeaders);
  if (parent.workspaceId && parent.workspaceId !== workspaceId) return json({ error: "Forbidden" }, 403, corsHeaders);
  if (!parent.workspaceId && parent.userId !== userId) return json({ error: "Forbidden" }, 403, corsHeaders);

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
    for (const childId of existingChildIds) {
      const child = await redis.get(`monitor:${childId}`);
      if (!child?.url) continue;
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

    existingChildUrls.add(canonicalUrl);
    created.push(childMonitor);
  }

  return json({ monitors: created }, 201, corsHeaders);
}

export async function getHistory(request, redis, userId, workspaceId, id, corsHeaders) {
  const monitor = await redis.get(`monitor:${id}`);
  if (!monitor) return json({ error: "Monitor not found" }, 404, corsHeaders);
  if (monitor.workspaceId && monitor.workspaceId !== workspaceId) return json({ error: "Forbidden" }, 403, corsHeaders);
  if (!monitor.workspaceId && monitor.userId !== userId) return json({ error: "Forbidden" }, 403, corsHeaders);

  const url = new URL(request.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "288", 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 2016)) : 288;
  const history = await redis.lrange(`history:${id}`, 0, limit - 1);
  return json(history, 200, corsHeaders);
}

export async function updateMonitorEndpoints(request, redis, userId, workspaceId, id, corsHeaders) {
  const monitor = await redis.get(`monitor:${id}`);
  if (!monitor) return json({ error: "Monitor not found" }, 404, corsHeaders);
  if (monitor.workspaceId && monitor.workspaceId !== workspaceId) return json({ error: "Forbidden" }, 403, corsHeaders);
  if (!monitor.workspaceId && monitor.userId !== userId) return json({ error: "Forbidden" }, 403, corsHeaders);

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

  return json({ endpoints: monitor.endpoints, monitor }, 200, corsHeaders);
}

export async function pingSingle(request, redis, userId, workspaceId, id, env, corsHeaders, ctx = null) {
  const monitor = await redis.get(`monitor:${id}`);
  if (!monitor) return json({ error: "Monitor not found" }, 404, corsHeaders);
  if (monitor.workspaceId && monitor.workspaceId !== workspaceId) return json({ error: "Forbidden" }, 403, corsHeaders);
  if (!monitor.workspaceId && monitor.userId !== userId) return json({ error: "Forbidden" }, 403, corsHeaders);

  const { historyEntry } = await pingMonitor(redis, monitor, env, {
    waitUntil: ctx?.waitUntil?.bind(ctx),
  });
  return json({ monitor, history: historyEntry }, 200, corsHeaders);
}
