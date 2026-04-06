// All communication between the React frontend and the Cloudflare Worker goes here.
// The Worker is running at localhost:8787 in development.
// In production, this will be your deployed Worker URL.

import { normalizeMonitorPsiCapability } from "./utils/psiCapability";

const WORKER_URL = import.meta.env.VITE_WORKER_URL || "http://127.0.0.1:8787";
const PSI_CACHE_TTL_MS = 5 * 60 * 1000;
const API_CACHE_TTL_MS = 5 * 60 * 1000;
const PUBLIC_STATUS_CACHE_TTL_MS = 60 * 1000;
const MAINTENANCE_CACHE_TTL_MS = 60 * 1000;
const MONITOR_WORKSPACE_CACHE_TTL_MS = 5 * 60 * 1000;
const ENDPOINT_SUGGESTIONS_CACHE_TTL_MS = 10 * 60 * 1000;
const psiCache = new Map();
const apiCache = new Map();
let currentWorkspaceId = "";

function getWorkspaceCacheScope(workspaceId = currentWorkspaceId) {
  return workspaceId || "default";
}

export function setApiWorkspaceId(workspaceId, options = {}) {
  currentWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
  if (options.clear === true) {
    clearApiCache();
  }
}

/**
 * Gets a fresh Firebase ID Token from the current user.
 * Firebase SDK caches the token and refreshes automatically before expiry.
 *
 * @param {import("firebase/auth").User} user
 * @returns {Promise<string>} JWT ID token
 */
export async function getToken(user) {
  if (!user) throw new Error("Not authenticated");
  return user.getIdToken();
}

/**
 * Builds Authorization header with a valid Firebase ID Token.
 * @param {import("firebase/auth").User} user
 */
async function authHeaders(user, workspaceId = currentWorkspaceId) {
  const token = await getToken(user);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (workspaceId) {
    headers["X-Workspace-Id"] = workspaceId;
  }
  return headers;
}

export async function fetchSessionBootstrap(user, workspaceId = currentWorkspaceId) {
  const scope = workspaceId || "default";
  const cacheKey = `session:bootstrap:${user.uid}:${scope}`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/session/bootstrap`, {
    headers: await authHeaders(user, workspaceId),
  });
  if (!res.ok) throw new Error("Failed to load workspace session");
  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

// ── GET /monitors ──────────────────────────────
// Fetch all monitors belonging to the logged-in user
export async function fetchMonitors(user, options = {}) {
  const userId = user.uid;
  const includeChildren = options.includeChildren === true;
  const scope = getWorkspaceCacheScope();
  const cacheKey = includeChildren ? `monitors:${userId}:${scope}:all` : `monitors:${userId}:${scope}:parents`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (Array.isArray(cached)) return cached;
  if (cached && !Array.isArray(cached)) {
    apiCache.delete(cacheKey);
    try {
      localStorage.removeItem(`api-cache:${cacheKey}`);
    } catch {
      // Ignore storage remove errors.
    }
  }

  const allItems = [];
  let cursor = 0;
  const limit = 100;

  while (true) {
    const page = await fetchMonitorsPage(user, { includeChildren, limit, cursor });
    const items = Array.isArray(page?.items) ? page.items : [];
    allItems.push(...items);

    if (page?.nextCursor == null) break;
    const next = Number.parseInt(page.nextCursor, 10);
    if (!Number.isFinite(next) || next <= cursor) break;
    cursor = next;
  }

  const uniqueItems = [];
  const seen = new Set();
  for (const item of allItems) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    uniqueItems.push(normalizeMonitorPsiCapability(item));
  }

  writeApiCache(cacheKey, uniqueItems);
  return uniqueItems;
}

// ── GET /monitors (paginated) ─────────────────
export async function fetchMonitorsPage(user, options = {}) {
  const includeChildren = options.includeChildren === true;
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(options.limit, 200)) : 50;
  const cursor = Number.isFinite(options.cursor) ? Math.max(0, options.cursor) : 0;

  const monitorUrl = new URL(`${WORKER_URL}/monitors`);
  monitorUrl.searchParams.set("limit", String(limit));
  monitorUrl.searchParams.set("cursor", String(cursor));
  if (includeChildren) {
    monitorUrl.searchParams.set("includeChildren", "true");
  }

  const res = await fetch(monitorUrl.toString(), { headers: await authHeaders(user) });
  if (!res.ok) throw new Error("Failed to fetch monitor page");
  return res.json();
}

export async function fetchChildMonitors(user, monitorId) {
  const cacheKey = `children:${user.uid}:${getWorkspaceCacheScope()}:${monitorId}`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/monitors/${monitorId}/children`, {
    headers: await authHeaders(user),
  });
  if (!res.ok) throw new Error("Failed to fetch child monitors");
  const payload = await res.json();
  const normalized = Array.isArray(payload) ? payload.map((item) => normalizeMonitorPsiCapability(item)) : [];
  writeApiCache(cacheKey, normalized);
  return normalized;
}

export async function createChildMonitors(user, monitorId, endpoints) {
  const res = await fetch(`${WORKER_URL}/monitors/${monitorId}/children`, {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify({ endpoints }),
  });
  if (!res.ok) throw new Error("Failed to create child monitors");
  const payload = await res.json();
  invalidateUserApiCache(user.uid);
  return normalizeMonitorPsiCapability(payload);
}

// ── POST /monitors ─────────────────────────────
export async function createMonitor(user, name, url) {
  const res = await fetch(`${WORKER_URL}/monitors`, {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify({ name, url }),
  });
  if (!res.ok) {
    let message = "Failed to create monitor";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback message.
    }
    throw new Error(message);
  }
  const payload = await res.json();
  invalidateUserApiCache(user.uid);
  return payload;
}

// ── DELETE /monitors/:id ───────────────────────
export async function deleteMonitor(user, monitorId) {
  const res = await fetch(`${WORKER_URL}/monitors/${monitorId}`, {
    method: "DELETE",
    headers: await authHeaders(user),
  });
  if (!res.ok) throw new Error("Failed to delete monitor");
  const payload = await res.json();
  invalidateUserApiCache(user.uid, monitorId);
  return payload;
}

// ── GET /monitors/:id/history ──────────────────
export async function fetchHistory(user, monitorId, limit = 288) {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 2016)) : 288;
  const cacheKey = `history:${user.uid}:${getWorkspaceCacheScope()}:${monitorId}:${safeLimit}`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/monitors/${monitorId}/history?limit=${safeLimit}`, {
    headers: await authHeaders(user),
  });
  if (!res.ok) throw new Error("Failed to fetch history");
  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

// ── POST /ping-now ─────────────────────────────
export async function triggerPing(user) {
  const res = await fetch(`${WORKER_URL}/ping-now`, {
    method: "POST",
    headers: await authHeaders(user),
  });
  if (!res.ok) throw new Error("Failed to trigger ping");
  const payload = await res.json();
  invalidateUserApiCache(user.uid);
  return payload;
}

// ── POST /crawl ────────────────────────────────
export async function crawlUrl(user, url) {
  const res = await fetch(`${WORKER_URL}/crawl`, {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error("Failed to crawl URL");
  return res.json();
}

// ── POST /monitors/:id/ping ────────────────────
export async function triggerPingSingle(user, monitorId) {
  const res = await fetch(`${WORKER_URL}/monitors/${monitorId}/ping`, {
    method: "POST",
    headers: await authHeaders(user),
  });
  if (!res.ok) throw new Error("Failed to ping monitor");
  const payload = await res.json();
  invalidateUserApiCache(user.uid, monitorId);
  return payload;
}

// ── PATCH /monitors/:id/endpoints ─────────────
export async function updateMonitorEndpoints(user, monitorId, endpoints) {
  const res = await fetch(`${WORKER_URL}/monitors/${monitorId}/endpoints`, {
    method: "PATCH",
    headers: await authHeaders(user),
    body: JSON.stringify({ endpoints }),
  });
  if (!res.ok) throw new Error("Failed to update monitor endpoints");
  const payload = await res.json();
  invalidateUserApiCache(user.uid, monitorId);
  return payload;
}

export async function fetchIncidents(user) {
  const cacheKey = `incidents:${user.uid}:${getWorkspaceCacheScope()}`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/incidents`, { headers: await authHeaders(user) });
  if (!res.ok) throw new Error("Failed to fetch incidents");
  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

export async function fetchTeamMembers(user) {
  const cacheKey = `team:members:${user.uid}:${getWorkspaceCacheScope()}`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/team/members`, { headers: await authHeaders(user) });
  if (!res.ok) throw new Error("Failed to fetch workspace members");
  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

export async function fetchTeamInvites(user) {
  const cacheKey = `team:invites:${user.uid}:${getWorkspaceCacheScope()}`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/team/invites`, { headers: await authHeaders(user) });
  if (!res.ok) throw new Error("Failed to fetch workspace invites");
  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

export async function createTeamInvite(user, email) {
  const res = await fetch(`${WORKER_URL}/team/invites`, {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify({ email }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || "Failed to send invite");
  }
  invalidateTeamApiCache(user.uid);
  return payload;
}

export async function createTeamWorkspace(user, payload) {
  const res = await fetch(`${WORKER_URL}/team/workspaces`, {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(result?.error || "Failed to create workspace");
  }
  clearApiCache();
  return result;
}

export async function acceptTeamInvite(user, inviteId) {
  const res = await fetch(`${WORKER_URL}/team/invites/${inviteId}/accept`, {
    method: "POST",
    headers: await authHeaders(user, ""),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || "Failed to accept invite");
  }
  clearApiCache();
  return payload;
}

export async function revokeTeamInvite(user, inviteId) {
  const res = await fetch(`${WORKER_URL}/team/invites/${inviteId}/revoke`, {
    method: "POST",
    headers: await authHeaders(user),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || "Failed to revoke invite");
  }
  invalidateTeamApiCache(user.uid);
  return payload;
}

export async function leaveTeamWorkspace(user) {
  const res = await fetch(`${WORKER_URL}/team/leave`, {
    method: "POST",
    headers: await authHeaders(user),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || "Failed to leave workspace");
  }
  clearApiCache();
  return payload;
}

export async function fetchMonitorWorkspace(user, monitorId, options = {}) {
  const historyLimit = Number.isFinite(options.historyLimit)
    ? Math.max(1, Math.min(options.historyLimit, 2016))
    : 2016;
  const includeChildren = options.includeChildren !== false;
  const cacheKey = `monitor-workspace:${user.uid}:${getWorkspaceCacheScope()}:${monitorId}:${historyLimit}:${includeChildren ? "full" : "base"}`;
  const cached = readApiCache(cacheKey, MONITOR_WORKSPACE_CACHE_TTL_MS);
  if (cached?.monitor && Array.isArray(cached?.history)) {
    const normalizedCached = {
      ...cached,
      monitor: normalizeMonitorPsiCapability(cached.monitor),
      childMonitors: Array.isArray(cached.childMonitors)
        ? cached.childMonitors.map((item) => normalizeMonitorPsiCapability(item))
        : [],
    };
    writeApiCache(cacheKey, normalizedCached);
    return normalizedCached;
  }

  const monitors = await fetchMonitors(user, { includeChildren: true });
  const monitor = monitors.find((item) => item.id === monitorId);
  if (!monitor) throw new Error("Monitor not found");

  const [history, childMonitors] = await Promise.all([
    fetchHistory(user, monitor.id, historyLimit).catch(() => []),
    includeChildren && monitor.type !== "child"
      ? fetchChildMonitors(user, monitor.id).catch(() => [])
      : Promise.resolve([]),
  ]);

  const payload = {
    monitor: normalizeMonitorPsiCapability(monitor),
    history: Array.isArray(history) ? history : [],
    childMonitors: Array.isArray(childMonitors) ? childMonitors.map((item) => normalizeMonitorPsiCapability(item)) : [],
  };
  writeApiCache(cacheKey, payload);
  return payload;
}

export function primeMonitorWorkspace(user, monitorId, payload, options = {}) {
  if (!user || !monitorId || !payload?.monitor) return;
  const historyLimit = Number.isFinite(options.historyLimit)
    ? Math.max(1, Math.min(options.historyLimit, 2016))
    : 2016;
  const includeChildren = options.includeChildren !== false;
  const cacheKey = `monitor-workspace:${user.uid}:${getWorkspaceCacheScope()}:${monitorId}:${historyLimit}:${includeChildren ? "full" : "base"}`;
  writeApiCache(cacheKey, {
    ...payload,
    monitor: normalizeMonitorPsiCapability(payload.monitor),
    childMonitors: Array.isArray(payload.childMonitors)
      ? payload.childMonitors.map((item) => normalizeMonitorPsiCapability(item))
      : [],
  });
}

export async function fetchEndpointSuggestions(user, monitor, options = {}) {
  const monitorId = monitor?.id ?? options.monitorId;
  const monitorUrl = monitor?.url ?? options.url;
  if (!monitorId || !monitorUrl) throw new Error("Monitor is required");

  const cacheKey = `endpoint-suggestions:${user.uid}:${getWorkspaceCacheScope()}:${monitorId}`;
  if (!options.force) {
    const cached = readApiCache(cacheKey, ENDPOINT_SUGGESTIONS_CACHE_TTL_MS);
    if (Array.isArray(cached)) return cached;
  }

  const crawled = await crawlUrl(user, monitorUrl).catch(() => ({ urls: [] }));
  const suggestions = Array.isArray(crawled?.urls) ? crawled.urls : [];
  const seedUrls = Array.isArray(options.seedUrls) ? options.seedUrls : [];
  const persisted = Array.isArray(monitor?.endpoints) ? monitor.endpoints : [];
  const merged = Array.from(new Set([monitorUrl, ...persisted, ...seedUrls, ...suggestions].filter(Boolean)));
  writeApiCache(cacheKey, merged);
  return merged;
}

export function primeEndpointSuggestions(user, monitorId, endpoints) {
  if (!user || !monitorId || !Array.isArray(endpoints)) return;
  writeApiCache(`endpoint-suggestions:${user.uid}:${getWorkspaceCacheScope()}:${monitorId}`, endpoints);
}

export async function fetchIncident(user, incidentId) {
  const cacheKey = `incident:${user.uid}:${getWorkspaceCacheScope()}:${incidentId}`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/incidents/${incidentId}`, { headers: await authHeaders(user) });
  if (!res.ok) {
    let message = "Failed to fetch incident";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }

  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

export async function createIncident(user, payload) {
  const res = await fetch(`${WORKER_URL}/incidents`, {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = "Failed to create incident";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }

  const result = await res.json();
  invalidateUserApiCache(user.uid);
  return result;
}

export async function updateIncident(user, incidentId, payload) {
  const res = await fetch(`${WORKER_URL}/incidents/${incidentId}`, {
    method: "PATCH",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = "Failed to update incident";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }

  const result = await res.json();
  invalidateUserApiCache(user.uid);
  return result;
}

export async function updateIncidentStatus(user, incidentId, action) {
  return updateIncident(user, incidentId, { action });
}

export async function addIncidentUpdate(user, incidentId, payload) {
  const res = await fetch(`${WORKER_URL}/incidents/${incidentId}/updates`, {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = "Failed to add incident update";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }

  const result = await res.json();
  invalidateUserApiCache(user.uid);
  return result;
}

export async function fetchAlertChannels(user) {
  const cacheKey = `alerts:channels:${user.uid}:${getWorkspaceCacheScope()}`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/alerts/channels`, { headers: await authHeaders(user) });
  if (!res.ok) throw new Error("Failed to fetch alert channels");
  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

export async function createAlertChannel(user, payload) {
  const res = await fetch(`${WORKER_URL}/alerts/channels`, {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = "Failed to create alert channel";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }
  const result = await res.json();
  invalidateAlertApiCache(user.uid);
  return result;
}

export async function updateAlertChannel(user, channelId, payload) {
  const res = await fetch(`${WORKER_URL}/alerts/channels/${channelId}`, {
    method: "PATCH",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = "Failed to update alert channel";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }
  const result = await res.json();
  invalidateAlertApiCache(user.uid);
  return result;
}

export async function testAlertChannel(user, channelId) {
  const res = await fetch(`${WORKER_URL}/alerts/channels/${channelId}/test`, {
    method: "POST",
    headers: await authHeaders(user),
  });
  const result = await res.json().catch(() => ({}));
  invalidateAlertApiCache(user.uid);
  if (!res.ok) {
    throw new Error(result?.providerResponse || result?.error || "Failed to send test alert");
  }
  return result;
}

export async function fetchAlertPolicies(user) {
  const cacheKey = `alerts:policies:${user.uid}:${getWorkspaceCacheScope()}`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/alerts/policies`, { headers: await authHeaders(user) });
  if (!res.ok) throw new Error("Failed to fetch alert policies");
  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

export async function fetchAlertPreferences(user) {
  const cacheKey = `alerts:preferences:${user.uid}:${getWorkspaceCacheScope()}`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/alerts/preferences`, { headers: await authHeaders(user) });
  if (!res.ok) throw new Error("Failed to fetch alert preferences");
  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

export async function saveAlertPreferences(user, payload) {
  const res = await fetch(`${WORKER_URL}/alerts/preferences`, {
    method: "PUT",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(result?.error || "Failed to save alert preferences");
  }
  invalidateAlertApiCache(user.uid);
  return result;
}

export async function saveDefaultAlertPolicy(user, payload) {
  const res = await fetch(`${WORKER_URL}/alerts/policies/default`, {
    method: "PUT",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = "Failed to save default alert policy";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }
  const result = await res.json();
  invalidateAlertApiCache(user.uid);
  return result;
}

export async function saveMonitorAlertPolicy(user, monitorId, payload) {
  const res = await fetch(`${WORKER_URL}/alerts/policies/monitors/${monitorId}`, {
    method: "PUT",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = "Failed to save monitor alert policy";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }
  const result = await res.json();
  invalidateAlertApiCache(user.uid);
  return result;
}

export async function fetchAlertEvents(user, limit = 30) {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : 30;
  const cacheKey = `alerts:events:${user.uid}:${getWorkspaceCacheScope()}:${safeLimit}`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/alerts/events?limit=${safeLimit}`, {
    headers: await authHeaders(user),
  });
  if (!res.ok) throw new Error("Failed to fetch alert events");
  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

export async function fetchStatusPages(user, workspaceId) {
  const cacheKey = `status-pages:${user.uid}:${workspaceId || "default"}`;
  const cached = readApiCache(cacheKey, API_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/status-pages`, {
    headers: await authHeaders(user),
  });
  if (!res.ok) throw new Error("Failed to fetch status pages");
  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

export async function fetchMaintenances(user, workspaceId, options = {}) {
  const monitorId = typeof options.monitorId === "string" && options.monitorId.trim() ? options.monitorId.trim() : "";
  const cacheKey = `maintenance:${user.uid}:${workspaceId || "default"}:${monitorId || "all"}`;
  const cached = readApiCache(cacheKey, MAINTENANCE_CACHE_TTL_MS);
  if (cached) return cached;

  const endpoint = new URL(`${WORKER_URL}/maintenance`);
  if (monitorId) endpoint.searchParams.set("monitorId", monitorId);

  const res = await fetch(endpoint.toString(), {
    headers: await authHeaders(user),
  });
  if (!res.ok) throw new Error("Failed to fetch maintenance windows");
  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

export async function createMaintenance(user, workspaceId, payload) {
  const res = await fetch(`${WORKER_URL}/maintenance`, {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = "Failed to create maintenance window";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }
  const result = await res.json();
  invalidateMaintenanceCache(user.uid, workspaceId);
  invalidateStatusPageCache(user.uid, workspaceId);
  invalidateUserApiCache(user.uid);
  return result;
}

export async function updateMaintenance(user, workspaceId, maintenanceId, payload) {
  const res = await fetch(`${WORKER_URL}/maintenance/${maintenanceId}`, {
    method: "PATCH",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = "Failed to update maintenance window";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }
  const result = await res.json();
  invalidateMaintenanceCache(user.uid, workspaceId);
  invalidateStatusPageCache(user.uid, workspaceId);
  invalidateUserApiCache(user.uid);
  return result;
}

export async function createStatusPage(user, workspaceId, payload) {
  const res = await fetch(`${WORKER_URL}/status-pages`, {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = "Failed to create status page";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }
  const result = await res.json();
  invalidateStatusPageCache(user.uid, workspaceId);
  return result;
}

export async function updateStatusPage(user, workspaceId, statusPageId, payload) {
  const res = await fetch(`${WORKER_URL}/status-pages/${statusPageId}`, {
    method: "PATCH",
    headers: await authHeaders(user),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = "Failed to update status page";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }
  const result = await res.json();
  invalidateStatusPageCache(user.uid, workspaceId);
  return result;
}

export async function fetchPublicStatusPage(slug) {
  const cacheKey = `public-status:${slug}`;
  const cached = readApiCache(cacheKey, PUBLIC_STATUS_CACHE_TTL_MS);
  if (cached) return cached;

  const res = await fetch(`${WORKER_URL}/status/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    let message = "Failed to fetch status page";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep fallback.
    }
    throw new Error(message);
  }
  const payload = await res.json();
  writeApiCache(cacheKey, payload);
  return payload;
}

// ── GET Google PageSpeed Insights ─────────────
export async function runPageSpeedAudit(url, strategy = "mobile") {
  const normalizedUrl = (url || "").trim();
  const cacheKey = `${strategy}|${normalizedUrl}`;
  const cached = psiCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PSI_CACHE_TTL_MS) {
    return cached.payload;
  }

  const apiKey = import.meta.env.VITE_PAGESPEED_API_KEY;
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", normalizedUrl);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.append("category", "performance");
  endpoint.searchParams.append("category", "accessibility");
  endpoint.searchParams.append("category", "best-practices");
  endpoint.searchParams.append("category", "seo");

  if (apiKey) {
    endpoint.searchParams.set("key", apiKey);
  }

  const res = await fetch(endpoint.toString());
  if (!res.ok) {
    let message = "Could not run the PageSpeed audit for this target.";
    try {
      const body = await res.json();
      if (body?.error?.message) {
        message = formatPageSpeedErrorMessage(body.error.message, normalizedUrl);
      }
    } catch {
      // Ignore JSON parse failure.
    }
    throw new Error(message);
  }
  const payload = await res.json();
  psiCache.set(cacheKey, { timestamp: Date.now(), payload });
  return payload;
}

function formatPageSpeedErrorMessage(message, url) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();

  if (!text) {
    return "Could not run the PageSpeed audit for this target.";
  }

  if (lower.includes("is not a valid url")) {
    return "Google PageSpeed Insights could not read this URL. Check that it is a public http/https webpage.";
  }

  if (lower.includes("unsupported") || lower.includes("not available for the requested url")) {
    return "Google PageSpeed Insights does not support this target. Use PSI for public webpage-style URLs that return HTML.";
  }

  if (lower.includes("quota") || lower.includes("rate limit")) {
    return "PageSpeed Insights is temporarily rate-limited. Please wait a moment and try again.";
  }

  if (lower.includes("access denied") || lower.includes("forbidden") || lower.includes("permission")) {
    return "Google PageSpeed Insights could not access this page. Make sure the URL is public and not blocked.";
  }

  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "The PageSpeed audit timed out while loading this page. Try again, or confirm the page is publicly reachable.";
  }

  if (lower.includes("not found") || lower.includes("404")) {
    return "Google PageSpeed Insights could not find this page. Verify the URL and try again.";
  }

  if (url) {
    return `${text} Check that ${url} is a public HTML page if you want to run PSI on it.`;
  }

  return text;
}

// ── POST /diagnostics/ping ───────────────────
export async function pingDiagnosticUrl(user, url) {
  const res = await fetch(`${WORKER_URL}/diagnostics/ping`, {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error("Failed to ping endpoint diagnostics");
  return res.json();
}

function readApiCache(key, ttlMs) {
  const memory = apiCache.get(key);
  if (memory && Date.now() - memory.timestamp < ttlMs) return memory.payload;
  if (memory && Date.now() - memory.timestamp >= ttlMs) apiCache.delete(key);

  try {
    const raw = localStorage.getItem(`api-cache:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.timestamp || Date.now() - parsed.timestamp >= ttlMs) {
      localStorage.removeItem(`api-cache:${key}`);
      return null;
    }
    apiCache.set(key, parsed);
    return parsed.payload;
  } catch {
    return null;
  }
}

function writeApiCache(key, payload) {
  const value = { timestamp: Date.now(), payload };
  apiCache.set(key, value);
  try {
    localStorage.setItem(`api-cache:${key}`, JSON.stringify(value));
  } catch {
    // Ignore storage write errors.
  }
}

function invalidateUserApiCache(userId, monitorId) {
  const allKeys = new Set([...apiCache.keys(), ...getPersistedApiCacheKeys()]);
  for (const key of allKeys) {
    if (!key.includes(`:${userId}`)) continue;
    if (monitorId && !key.includes(`:${monitorId}`) && !key.startsWith(`monitors:${userId}`)) continue;
    apiCache.delete(key);
    try {
      localStorage.removeItem(`api-cache:${key}`);
    } catch {
      // Ignore storage remove errors.
    }
  }
}

function invalidateAlertApiCache(userId) {
  const allKeys = new Set([...apiCache.keys(), ...getPersistedApiCacheKeys()]);
  for (const key of allKeys) {
    if (!key.includes(`:${userId}`)) continue;
    if (!key.startsWith("alerts:")) continue;
    apiCache.delete(key);
    try {
      localStorage.removeItem(`api-cache:${key}`);
    } catch {
      // Ignore storage remove errors.
    }
  }
}

function invalidateTeamApiCache(userId) {
  const allKeys = new Set([...apiCache.keys(), ...getPersistedApiCacheKeys()]);
  for (const key of allKeys) {
    if (!key.includes(`:${userId}`)) continue;
    if (!key.startsWith("team:")) continue;
    apiCache.delete(key);
    try {
      localStorage.removeItem(`api-cache:${key}`);
    } catch {
      // Ignore storage remove errors.
    }
  }
}

function invalidateStatusPageCache(userId, workspaceId) {
  const allKeys = new Set([...apiCache.keys(), ...getPersistedApiCacheKeys()]);
  for (const key of allKeys) {
    if (!key.startsWith("status-pages:")) continue;
    if (!key.includes(`:${userId}:`)) continue;
    if (workspaceId && !key.endsWith(`:${workspaceId}`)) continue;
    apiCache.delete(key);
    try {
      localStorage.removeItem(`api-cache:${key}`);
    } catch {
      // Ignore storage remove errors.
    }
  }
}

function invalidateMaintenanceCache(userId, workspaceId) {
  const allKeys = new Set([...apiCache.keys(), ...getPersistedApiCacheKeys()]);
  for (const key of allKeys) {
    if (!key.startsWith("maintenance:")) continue;
    if (!key.includes(`:${userId}:`)) continue;
    if (workspaceId && !key.includes(`:${workspaceId}:`)) continue;
    apiCache.delete(key);
    try {
      localStorage.removeItem(`api-cache:${key}`);
    } catch {
      // Ignore storage remove errors.
    }
  }
}

function getPersistedApiCacheKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const rawKey = localStorage.key(i);
      if (!rawKey || !rawKey.startsWith("api-cache:")) continue;
      keys.push(rawKey.replace("api-cache:", ""));
    }
  } catch {
    return keys;
  }
  return keys;
}

function clearApiCache() {
  apiCache.clear();
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("api-cache:")) continue;
      keys.push(key);
    }
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage clear errors.
  }
}
