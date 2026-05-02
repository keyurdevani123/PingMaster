import {
  buildBillingSummary,
  getFeatureFlags,
  getWorkspaceBilling,
  getWorkspaceOpenBillingSession,
} from "./billing.js";

const PERSONAL_WORKSPACE_PREFIX = "ws_";
const TEAM_WORKSPACE_PREFIX = "wst_";
const ACTIVE_MEMBER_STATUS = "active";

function sanitizeWorkspaceSuffix(userId) {
  return String(userId || "default")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24) || "default";
}

function buildWorkspaceId(userId) {
  return `${PERSONAL_WORKSPACE_PREFIX}${sanitizeWorkspaceSuffix(userId)}`;
}

export function isPersonalWorkspaceId(workspaceId) {
  return String(workspaceId || "").startsWith(PERSONAL_WORKSPACE_PREFIX);
}

function buildWorkspaceSlug(userId) {
  return `workspace-${sanitizeWorkspaceSuffix(userId).slice(0, 12)}`;
}

function buildTeamWorkspaceId() {
  return `${TEAM_WORKSPACE_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function slugifyWorkspaceName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function getWorkspaceCollectionKey(workspaceId, collection) {
  return `workspace:${workspaceId}:${collection}`;
}

export function getWorkspaceMemberKey(workspaceId, userId) {
  return `workspace_member:${workspaceId}:${userId}`;
}

export function getWorkspaceMembersKey(workspaceId) {
  return getWorkspaceCollectionKey(workspaceId, "members");
}

export function getWorkspaceInvitesKey(workspaceId) {
  return getWorkspaceCollectionKey(workspaceId, "invites");
}

function getUserWorkspaceMembershipsKey(userId) {
  return `user:${userId}:workspace_memberships`;
}

export async function ensureWorkspaceMembership(redis, workspaceId, collection, itemId) {
  const key = getWorkspaceCollectionKey(workspaceId, collection);
  await redis.lrem(key, 0, itemId);
  await redis.lpush(key, itemId);
}

export async function removeWorkspaceMembership(redis, workspaceId, collection, itemId) {
  await redis.lrem(getWorkspaceCollectionKey(workspaceId, collection), 0, itemId);
}

export async function ensureWorkspaceScopedRecord(redis, recordKey, record, workspaceId, collection) {
  if (!record) return null;
  let changed = false;
  if (!record.workspaceId) {
    record.workspaceId = workspaceId;
    changed = true;
  }
  if (changed) {
    await redis.set(recordKey, record);
  }
  await ensureWorkspaceMembership(redis, workspaceId, collection, record.id);
  return record;
}

export async function getWorkspaceMembership(redis, workspaceId, userId) {
  if (!workspaceId || !userId) return null;
  const membership = await redis.get(getWorkspaceMemberKey(workspaceId, userId));
  return membership || null;
}

async function updateWorkspaceMemberCount(redis, workspaceId, updater) {
  if (!workspaceId) return null;
  const workspace = await redis.get(`workspace:${workspaceId}`);
  if (!workspace) return null;

  const currentCount = Number.isFinite(workspace.memberCount) ? workspace.memberCount : 0;
  const nextCount = Math.max(0, updater(currentCount));
  if (nextCount === currentCount) return workspace;

  const updated = {
    ...workspace,
    memberCount: nextCount,
    updatedAt: new Date().toISOString(),
  };
  await redis.set(`workspace:${workspaceId}`, updated);
  return updated;
}

export async function ensureWorkspaceMemberRecord(redis, workspace, userId, role = "member", options = {}) {
  if (!workspace?.id || !userId) return null;

  const existing = await getWorkspaceMembership(redis, workspace.id, userId);
  const nowIso = new Date().toISOString();
  const membership = {
    workspaceId: workspace.id,
    userId,
    role,
    status: ACTIVE_MEMBER_STATUS,
    email: typeof options.email === "string" ? options.email.trim().toLowerCase() : (existing?.email || ""),
    invitedByUserId: options.invitedByUserId || existing?.invitedByUserId || null,
    joinedAt: existing?.joinedAt || nowIso,
    updatedAt: nowIso,
  };

  await redis.set(getWorkspaceMemberKey(workspace.id, userId), membership);
  await redis.lrem(getWorkspaceMembersKey(workspace.id), 0, userId);
  await redis.lpush(getWorkspaceMembersKey(workspace.id), userId);
  await redis.lrem(getUserWorkspaceMembershipsKey(userId), 0, workspace.id);
  await redis.lpush(getUserWorkspaceMembershipsKey(userId), workspace.id);
  if (!existing || existing.status !== ACTIVE_MEMBER_STATUS) {
    await updateWorkspaceMemberCount(redis, workspace.id, (count) => count + 1);
  }

  if (workspace.ownerUserId === userId) {
    await redis.lrem(`user:${userId}:workspaces`, 0, workspace.id);
    await redis.lpush(`user:${userId}:workspaces`, workspace.id);
  }

  return membership;
}

export async function removeWorkspaceMemberRecord(redis, workspaceId, userId) {
  if (!workspaceId || !userId) return;
  const existing = await getWorkspaceMembership(redis, workspaceId, userId);
  await redis.del(getWorkspaceMemberKey(workspaceId, userId));
  await redis.lrem(getWorkspaceMembersKey(workspaceId), 0, userId);
  await redis.lrem(getUserWorkspaceMembershipsKey(userId), 0, workspaceId);
  if (existing?.status === ACTIVE_MEMBER_STATUS) {
    await updateWorkspaceMemberCount(redis, workspaceId, (count) => count - 1);
  }
}

async function countWorkspaceMembers(redis, workspaceId) {
  const memberIds = [...new Set((await redis.lrange(getWorkspaceMembersKey(workspaceId), 0, -1) || []).filter(Boolean))];
  const membershipItems = await Promise.all(
    memberIds.map((memberId) => getWorkspaceMembership(redis, workspaceId, memberId))
  );
  return membershipItems.filter((membership) => membership?.status === ACTIVE_MEMBER_STATUS).length;
}

async function buildWorkspaceSummary(redis, workspace, userId) {
  if (!workspace?.id) return null;
  let membership = await getWorkspaceMembership(redis, workspace.id, userId);
  if (workspace.ownerUserId === userId && (!membership || membership.status !== ACTIVE_MEMBER_STATUS)) {
    membership = await ensureWorkspaceMemberRecord(redis, workspace, userId, "owner");
  }
  if (!membership || membership.status !== ACTIVE_MEMBER_STATUS) return null;
  const latestWorkspace = await redis.get(`workspace:${workspace.id}`) || workspace;

  return {
    ...latestWorkspace,
    currentRole: membership.role,
    memberCount: Number.isFinite(latestWorkspace.memberCount)
      ? latestWorkspace.memberCount
      : await countWorkspaceMembers(redis, workspace.id),
  };
}

export async function ensureDefaultWorkspace(redis, userId, userEmail = "") {
  const defaultKey = `user:${userId}:default_workspace`;
  const existingId = await redis.get(defaultKey);
  if (existingId) {
    const existing = await redis.get(`workspace:${existingId}`);
    if (existing) {
      if (existing.slug) {
        await redis.set(`workspace:slug:${existing.slug}`, true);
      }
      await redis.lrem(`user:${userId}:workspaces`, 0, existing.id);
      await redis.lpush(`user:${userId}:workspaces`, existing.id);
      const existingMembership = await getWorkspaceMembership(redis, existing.id, userId);
      if (!existingMembership || existingMembership.status !== ACTIVE_MEMBER_STATUS) {
        await ensureWorkspaceMemberRecord(redis, existing, userId, "owner", { email: userEmail });
      }
      return existing;
    }
  }

  const workspaceId = buildWorkspaceId(userId);
  const nowIso = new Date().toISOString();
  const workspace = {
    id: workspaceId,
    slug: buildWorkspaceSlug(userId),
    name: "My Workspace",
    type: "personal",
    ownerUserId: userId,
    memberCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await redis.set(`workspace:${workspaceId}`, workspace);
  await redis.set(`workspace:slug:${workspace.slug}`, true);
  await redis.set(defaultKey, workspaceId);
  await redis.lrem(`user:${userId}:workspaces`, 0, workspaceId);
  await redis.lpush(`user:${userId}:workspaces`, workspaceId);
  await ensureWorkspaceMemberRecord(redis, workspace, userId, "owner", { email: userEmail });
  return workspace;
}

export async function listUserWorkspaces(redis, userId) {
  const fallback = await ensureDefaultWorkspace(redis, userId);
  const ownerIds = await redis.lrange(`user:${userId}:workspaces`, 0, 24);
  const membershipIds = await redis.lrange(getUserWorkspaceMembershipsKey(userId), 0, 24);
  const ids = [...(Array.isArray(ownerIds) ? ownerIds : []), ...(Array.isArray(membershipIds) ? membershipIds : [])];
  if (ids.length === 0) return [await buildWorkspaceSummary(redis, fallback, userId)].filter(Boolean);

  const seen = new Set();
  const workspaces = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const workspace = await redis.get(`workspace:${id}`);
    if (!workspace) continue;
    const summary = await buildWorkspaceSummary(redis, workspace, userId);
    if (summary) workspaces.push(summary);
  }

  if (workspaces.length > 0) return workspaces;
  const fallbackSummary = await buildWorkspaceSummary(redis, fallback, userId);
  return fallbackSummary ? [fallbackSummary] : [fallback];
}

export async function createTeamWorkspace(redis, userId, userEmail, sourceWorkspace, input = {}) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const selectedMonitorIds = Array.isArray(input?.monitorIds)
    ? [...new Set(input.monitorIds.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))]
    : [];

  if (!sourceWorkspace?.id || sourceWorkspace.ownerUserId !== userId) {
    return { ok: false, error: "Team workspaces can be created only by the personal workspace owner." };
  }
  if (!name) {
    return { ok: false, error: "Workspace name is required." };
  }
  if (selectedMonitorIds.length === 0) {
    return { ok: false, error: "Choose at least one monitor to share with the team workspace." };
  }

  const nowIso = new Date().toISOString();
  const workspaceId = buildTeamWorkspaceId();
  const baseSlug = slugifyWorkspaceName(name) || `team-${workspaceId.slice(-6)}`;
  const workspace = {
    id: workspaceId,
    slug: await ensureUniqueWorkspaceSlug(redis, baseSlug),
    name,
    type: "team",
    ownerUserId: userId,
    sourceWorkspaceId: sourceWorkspace.id,
    memberCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // LINK (share) monitors into the team workspace — do NOT move them.
  // Monitors stay in the personal workspace; the team workspace collection
  // just holds references. This allows the same monitor to be shared into
  // multiple team workspaces simultaneously without data duplication.
  const linkResult = await linkWorkspaceResources(redis, {
    ownerUserId: userId,
    targetWorkspaceId: workspace.id,
    selectedMonitorIds,
  });
  if (!linkResult.ok) {
    return linkResult;
  }

  await redis.set(`workspace:${workspaceId}`, workspace);
  await redis.lrem(`user:${userId}:workspaces`, 0, workspaceId);
  await redis.lpush(`user:${userId}:workspaces`, workspaceId);
  await ensureWorkspaceMemberRecord(redis, workspace, userId, "owner", { email: userEmail });

  return {
    ok: true,
    workspace: await buildWorkspaceSummary(redis, workspace, userId),
    linkedMonitorIds: linkResult.linkedMonitorIds,
  };
}

export async function getWorkspaceCollectionIds(redis, workspaceId, collection, fallbackKey = null, limit = -1) {
  const key = getWorkspaceCollectionKey(workspaceId, collection);
  const workspaceIds = await redis.lrange(key, 0, limit >= 0 ? limit : -1);
  const normalizedWorkspaceIds = [];
  const workspaceSeen = new Set();
  for (const id of Array.isArray(workspaceIds) ? workspaceIds : []) {
    if (!id || workspaceSeen.has(id)) continue;
    workspaceSeen.add(id);
    normalizedWorkspaceIds.push(id);
  }

  if (Array.isArray(workspaceIds) && normalizedWorkspaceIds.length !== workspaceIds.filter(Boolean).length) {
    await redis.del(key);
    if (normalizedWorkspaceIds.length > 0) {
      await redis.rpush(key, ...normalizedWorkspaceIds);
    }
  }

  if (!fallbackKey) return normalizedWorkspaceIds;

  const fallbackIds = await redis.lrange(fallbackKey, 0, limit >= 0 ? limit : -1);
  const normalizedFallbackIds = [];
  const fallbackSeen = new Set();
  for (const id of Array.isArray(fallbackIds) ? fallbackIds : []) {
    if (!id || fallbackSeen.has(id)) continue;
    fallbackSeen.add(id);
    normalizedFallbackIds.push(id);
  }
  if (normalizedFallbackIds.length === 0) return normalizedWorkspaceIds;

  const seen = new Set(normalizedWorkspaceIds);
  const missingFallbackIds = normalizedFallbackIds.filter((id) => !seen.has(id));
  if (missingFallbackIds.length === 0) return normalizedWorkspaceIds;

  for (const id of missingFallbackIds) {
    await redis.rpush(key, id);
  }

  return [...normalizedWorkspaceIds, ...missingFallbackIds];
}

export async function workspaceCollectionHasItem(redis, workspaceId, collection, itemId, fallbackKey = null) {
  if (!workspaceId || !collection || !itemId) return false;
  const ids = await getWorkspaceCollectionIds(redis, workspaceId, collection, fallbackKey, -1);
  return Array.isArray(ids) ? ids.includes(itemId) : false;
}

export async function resolveWorkspaceForUser(redis, userId, requestedWorkspaceId = "", userEmail = "") {
  const defaultWorkspace = await ensureDefaultWorkspace(redis, userId, userEmail);
  const targetId = typeof requestedWorkspaceId === "string" && requestedWorkspaceId.trim()
    ? requestedWorkspaceId.trim()
    : defaultWorkspace.id;

  const workspace = targetId === defaultWorkspace.id
    ? defaultWorkspace
    : await redis.get(`workspace:${targetId}`);
  if (!workspace) {
    const membership = await ensureWorkspaceMemberRecord(redis, defaultWorkspace, userId, "owner", { email: userEmail });
    return { workspace: defaultWorkspace, membership };
  }

  let membership = await getWorkspaceMembership(redis, workspace.id, userId);
  if (workspace.ownerUserId === userId && (!membership || membership.status !== ACTIVE_MEMBER_STATUS)) {
    membership = await ensureWorkspaceMemberRecord(redis, workspace, userId, "owner", { email: userEmail });
  }

  if (!membership || membership.status !== ACTIVE_MEMBER_STATUS) {
    return null;
  }

  return { workspace, membership };
}

export async function listWorkspaceMembers(redis, workspaceId) {
  const memberIds = await redis.lrange(getWorkspaceMembersKey(workspaceId), 0, 99);
  const dedupedIds = [...new Set((Array.isArray(memberIds) ? memberIds : []).filter(Boolean))];
  const membershipItems = await Promise.all(
    dedupedIds.map((memberId) => getWorkspaceMembership(redis, workspaceId, memberId))
  );
  const members = membershipItems.filter((membership) => membership?.status === ACTIVE_MEMBER_STATUS);
  members.sort((left, right) => {
    if (left.role !== right.role) return left.role === "owner" ? -1 : 1;
    return String(left.email || left.userId).localeCompare(String(right.email || right.userId));
  });
  return members;
}

export async function buildBootstrapPayload(redis, auth, requestedWorkspaceId = "", env = null) {
  const userId = auth?.userId || auth;
  const userEmail = typeof auth?.email === "string" ? auth.email : "";
  const defaultWorkspace = await ensureDefaultWorkspace(redis, userId, userEmail);
  const resolved = await resolveWorkspaceForUser(redis, userId, requestedWorkspaceId, userEmail);
  const currentWorkspace = resolved?.workspace || defaultWorkspace;
  const currentMembership = resolved?.membership
    || await ensureWorkspaceMemberRecord(redis, currentWorkspace, userId, currentWorkspace.ownerUserId === userId ? "owner" : "member", {
      email: userEmail,
    });
  const workspaces = await listUserWorkspaces(redis, userId);
  const billing = await getWorkspaceBilling(redis, currentWorkspace);
  const checkoutSession = currentWorkspace?.type === "team"
    ? null
    : await getWorkspaceOpenBillingSession(redis, currentWorkspace.id);
  const billingSummary = buildBillingSummary(billing, { checkoutSession });
  return {
    userId,
    email: userEmail,
    defaultWorkspace: workspaces.find((workspace) => workspace.id === defaultWorkspace.id) || defaultWorkspace,
    currentWorkspace: workspaces.find((workspace) => workspace.id === currentWorkspace.id) || currentWorkspace,
    currentMembershipRole: currentMembership?.role || "owner",
    workspaces,
    featureFlags: getFeatureFlags(),
    billing: billingSummary,
    entitlements: billingSummary.entitlements,
  };
}

async function ensureUniqueWorkspaceSlug(redis, baseSlug) {
  let candidate = baseSlug || `team-${Date.now().toString(36)}`;
  let counter = 1;
  while (true) {
    const existing = await redis.get(`workspace:slug:${candidate}`);
    if (!existing) {
      await redis.set(`workspace:slug:${candidate}`, true);
      return candidate;
    }
    candidate = `${baseSlug}-${counter}`;
    counter += 1;
  }
}

/**
 * Link (share) selected monitors into a team workspace.
 * Monitors are NOT moved — they stay in their current workspace (personal).
 * The team workspace collection just gets references to these monitor IDs.
 * This allows the same monitor to be shared into multiple team workspaces.
 */
async function linkWorkspaceResources(redis, input) {
  const { ownerUserId, targetWorkspaceId, selectedMonitorIds } = input;
  const linkedMonitorIds = new Set();
  const selectedKeys = selectedMonitorIds.map((monitorId) => `monitor:${monitorId}`);
  const selectedMonitors = selectedKeys.length > 0 ? await redis.mget(...selectedKeys) : [];
  const workspaceMonitorIds = [];

  for (let index = 0; index < selectedMonitorIds.length; index += 1) {
    const monitorId = selectedMonitorIds[index];
    const monitor = selectedMonitors[index];
    if (!monitor) {
      return { ok: false, error: "One or more selected monitors could not be found." };
    }
    if (monitor.userId && monitor.userId !== ownerUserId) {
      return { ok: false, error: "Only monitors owned by you can be shared into a team workspace." };
    }
    if (monitor.type === "child") {
      return { ok: false, error: "Choose parent monitors only when creating a team workspace." };
    }

    workspaceMonitorIds.push(monitor.id);
    linkedMonitorIds.add(monitor.id);
    const childIds = await redis.lrange(`monitor:${monitor.id}:children`, 0, -1);
    for (const childId of Array.isArray(childIds) ? childIds : []) {
      if (!childId) continue;
      workspaceMonitorIds.push(childId);
      linkedMonitorIds.add(childId);
    }
  }

  if (workspaceMonitorIds.length > 0) {
    await redis.rpush(getWorkspaceCollectionKey(targetWorkspaceId, "monitors"), ...new Set(workspaceMonitorIds));
  }

  return { ok: true, linkedMonitorIds: [...linkedMonitorIds] };
}

/**
 * Delete a team workspace.
 * Rules:
 *  - Only the owner can delete.
 *  - Only allowed when the owner is the sole active member (no accepted invitees).
 * Effect (link-based model):
 *  - Removes the team workspace's monitor/incident/maintenance collection references.
 *  - Does NOT move monitors back — they were never moved, so personal workspace still has them.
 *  - Removes all member records, invite records, and workspace keys.
 */
export async function deleteWorkspace(redis, workspace, userId) {
  if (!workspace?.id) return { ok: false, error: "Workspace not found." };
  if (workspace.ownerUserId !== userId) return { ok: false, error: "Only the workspace owner can delete it." };
  if (workspace.type === "personal") return { ok: false, error: "Personal workspaces cannot be deleted." };

  // Confirm sole membership
  const memberIds = await redis.lrange(getWorkspaceMembersKey(workspace.id), 0, 99);
  const dedupedIds = [...new Set((Array.isArray(memberIds) ? memberIds : []).filter(Boolean))];
  const activeMemberships = await Promise.all(
    dedupedIds.map((mid) => getWorkspaceMembership(redis, workspace.id, mid))
  );
  const activeOthers = activeMemberships.filter(
    (m) => m?.status === "active" && m.userId !== userId
  );
  if (activeOthers.length > 0) {
    return {
      ok: false,
      error: `Cannot delete while ${activeOthers.length} other member${activeOthers.length > 1 ? "s are" : " is"} still active. Remove them first.`,
    };
  }

  // Clean up team workspace URL indexes (monitors themselves stay untouched)
  const monitorIds = await getWorkspaceCollectionIds(redis, workspace.id, "monitors", null, -1);
  for (const monitorId of monitorIds) {
    const monitor = await redis.get(`monitor:${monitorId}`);
    if (monitor?.url) {
      await redis.del(`workspace:${workspace.id}:monitor_url:${monitor.url}`);
    }
  }

  // Remove all member records
  for (const memberId of dedupedIds) {
    await redis.del(getWorkspaceMemberKey(workspace.id, memberId));
    await redis.lrem(getUserWorkspaceMembershipsKey(memberId), 0, workspace.id);
  }

  // Remove workspace-level collections and the workspace record itself
  await redis.del(getWorkspaceMembersKey(workspace.id));
  await redis.del(getWorkspaceCollectionKey(workspace.id, "monitors"));
  await redis.del(getWorkspaceCollectionKey(workspace.id, "incidents"));
  await redis.del(getWorkspaceCollectionKey(workspace.id, "maintenances"));
  await redis.del(getWorkspaceInvitesKey(workspace.id));
  await redis.del(`workspace_monitor_summary:${workspace.id}`);
  if (workspace.slug) await redis.del(`workspace:slug:${workspace.slug}`);
  await redis.lrem(`user:${userId}:workspaces`, 0, workspace.id);
  await redis.del(`workspace:${workspace.id}`);

  return { ok: true };
}
