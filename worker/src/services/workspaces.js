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

export function getFeatureFlags() {
  return {
    homepage: true,
    statusPages: true,
    teamFoundation: true,
    geminiInsights: false,
    visibilityMonitoring: false,
  };
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
  const membership = workspace.ownerUserId === userId
    ? await ensureWorkspaceMemberRecord(redis, workspace, userId, "owner")
    : await getWorkspaceMembership(redis, workspace.id, userId);
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
      await ensureWorkspaceMemberRecord(redis, existing, userId, "owner", { email: userEmail });
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

  if (!sourceWorkspace?.id || sourceWorkspace.ownerUserId !== userId || sourceWorkspace.type !== "personal") {
    return { ok: false, error: "Team workspaces can be created only from your personal workspace." };
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

  const moveResult = await moveWorkspaceResources(redis, {
    ownerUserId: userId,
    sourceWorkspaceId: sourceWorkspace.id,
    targetWorkspaceId: workspace.id,
    selectedMonitorIds,
  });
  if (!moveResult.ok) {
    return moveResult;
  }

  await redis.set(`workspace:${workspaceId}`, workspace);
  await redis.lrem(`user:${userId}:workspaces`, 0, workspaceId);
  await redis.lpush(`user:${userId}:workspaces`, workspaceId);
  await ensureWorkspaceMemberRecord(redis, workspace, userId, "owner", { email: userEmail });

  return {
    ok: true,
    workspace: await buildWorkspaceSummary(redis, workspace, userId),
    movedMonitorIds: moveResult.movedMonitorIds,
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

  const membership = workspace.ownerUserId === userId
    ? await ensureWorkspaceMemberRecord(redis, workspace, userId, "owner", { email: userEmail })
    : await getWorkspaceMembership(redis, workspace.id, userId);

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

export async function buildBootstrapPayload(redis, auth, requestedWorkspaceId = "") {
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
  return {
    userId,
    email: userEmail,
    defaultWorkspace: workspaces.find((workspace) => workspace.id === defaultWorkspace.id) || defaultWorkspace,
    currentWorkspace: workspaces.find((workspace) => workspace.id === currentWorkspace.id) || currentWorkspace,
    currentMembershipRole: currentMembership?.role || "owner",
    workspaces,
    featureFlags: getFeatureFlags(),
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

async function moveWorkspaceResources(redis, input) {
  const {
    ownerUserId,
    sourceWorkspaceId,
    targetWorkspaceId,
    selectedMonitorIds,
  } = input;

  const movedMonitorIds = new Set();

  for (const monitorId of selectedMonitorIds) {
    const monitor = await redis.get(`monitor:${monitorId}`);
    if (!monitor) {
      return { ok: false, error: "One or more selected monitors could not be found." };
    }
    if (monitor.userId !== ownerUserId) {
      return { ok: false, error: "Only monitors owned by the workspace owner can be shared." };
    }
    if (monitor.type === "child") {
      return { ok: false, error: "Choose parent monitors only when creating a team workspace." };
    }
    if (monitor.workspaceId !== sourceWorkspaceId) {
      return { ok: false, error: "One or more selected monitors are not available in the current workspace." };
    }

    await moveMonitorBundle(redis, monitor, sourceWorkspaceId, targetWorkspaceId);
    movedMonitorIds.add(monitor.id);

    const childIds = await redis.lrange(`monitor:${monitor.id}:children`, 0, -1);
    for (const childId of Array.isArray(childIds) ? childIds : []) {
      if (!childId) continue;
      movedMonitorIds.add(childId);
    }
  }

  await moveIncidentsForMonitors(redis, sourceWorkspaceId, targetWorkspaceId, [...movedMonitorIds]);
  await moveMaintenancesForMonitors(redis, sourceWorkspaceId, targetWorkspaceId, [...movedMonitorIds]);

  return { ok: true, movedMonitorIds: [...movedMonitorIds] };
}

async function moveMonitorBundle(redis, monitor, sourceWorkspaceId, targetWorkspaceId) {
  const bundleIds = [monitor.id];
  const childIds = await redis.lrange(`monitor:${monitor.id}:children`, 0, -1);
  for (const childId of Array.isArray(childIds) ? childIds : []) {
    if (childId) bundleIds.push(childId);
  }

  for (const monitorId of bundleIds) {
    const next = await redis.get(`monitor:${monitorId}`);
    if (!next) continue;
    const previousWorkspaceId = next.workspaceId || sourceWorkspaceId;
    next.workspaceId = targetWorkspaceId;
    next.updatedAt = new Date().toISOString();
    await redis.set(`monitor:${monitorId}`, next);
    await redis.lrem(`user:${next.userId}:monitors`, 0, monitorId);
    await removeWorkspaceMembership(redis, previousWorkspaceId, "monitors", monitorId);
    await ensureWorkspaceMembership(redis, targetWorkspaceId, "monitors", monitorId);
    if (next.url) {
      await redis.del(`workspace:${previousWorkspaceId}:monitor_url:${next.url}`);
      await redis.set(`workspace:${targetWorkspaceId}:monitor_url:${next.url}`, monitorId);
    }
  }
}

async function moveIncidentsForMonitors(redis, sourceWorkspaceId, targetWorkspaceId, movedMonitorIds) {
  if (!Array.isArray(movedMonitorIds) || movedMonitorIds.length === 0) return;
  const movedSet = new Set(movedMonitorIds);
  const incidentIds = await getWorkspaceCollectionIds(redis, sourceWorkspaceId, "incidents", null, -1);

  for (const incidentId of Array.isArray(incidentIds) ? incidentIds : []) {
    if (!incidentId) continue;
    const incident = await redis.get(`incident:${incidentId}`);
    if (!incident || !movedSet.has(incident.monitorId)) continue;
    incident.workspaceId = targetWorkspaceId;
    incident.updatedAt = new Date().toISOString();
    await redis.set(`incident:${incidentId}`, incident);
    await redis.lrem(`user:${incident.userId}:incidents`, 0, incidentId);
    await removeWorkspaceMembership(redis, sourceWorkspaceId, "incidents", incidentId);
    await ensureWorkspaceMembership(redis, targetWorkspaceId, "incidents", incidentId);
  }
}

async function moveMaintenancesForMonitors(redis, sourceWorkspaceId, targetWorkspaceId, movedMonitorIds) {
  if (!Array.isArray(movedMonitorIds) || movedMonitorIds.length === 0) return;
  const movedSet = new Set(movedMonitorIds);
  const maintenanceIds = await getWorkspaceCollectionIds(redis, sourceWorkspaceId, "maintenances", null, -1);

  for (const maintenanceId of Array.isArray(maintenanceIds) ? maintenanceIds : []) {
    if (!maintenanceId) continue;
    const maintenance = await redis.get(`maintenance:${maintenanceId}`);
    if (!maintenance || maintenance.workspaceId !== sourceWorkspaceId) continue;
    const maintenanceMonitorIds = Array.isArray(maintenance.monitorIds) ? maintenance.monitorIds : [];
    if (maintenanceMonitorIds.length === 0) continue;

    const allMoved = maintenanceMonitorIds.every((monitorId) => movedSet.has(monitorId));
    if (!allMoved) continue;

    maintenance.workspaceId = targetWorkspaceId;
    maintenance.updatedAt = new Date().toISOString();
    await redis.set(`maintenance:${maintenanceId}`, maintenance);
    await removeWorkspaceMembership(redis, sourceWorkspaceId, "maintenances", maintenanceId);
    await ensureWorkspaceMembership(redis, targetWorkspaceId, "maintenances", maintenanceId);
  }
}
