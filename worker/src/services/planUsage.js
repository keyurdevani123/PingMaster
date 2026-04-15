import { getWorkspaceCollectionIds } from "./workspaces.js";

async function listOwnedWorkspaceIds(redis, userId) {
  const rawIds = await redis.lrange(`user:${userId}:workspaces`, 0, 99);
  return [...new Set((Array.isArray(rawIds) ? rawIds : []).filter(Boolean))];
}

async function listOwnedWorkspaceRecords(redis, userId) {
  const ids = await listOwnedWorkspaceIds(redis, userId);
  if (ids.length === 0) return [];

  const records = await Promise.all(ids.map((workspaceId) => redis.get(`workspace:${workspaceId}`)));
  return records.filter((workspace) => workspace?.ownerUserId === userId);
}

async function collectOwnedCollectionIds(redis, userId, collection) {
  const workspaces = await listOwnedWorkspaceRecords(redis, userId);
  if (workspaces.length === 0) return [];

  const seen = new Set();
  const ids = [];

  for (const workspace of workspaces) {
    const collectionIds = await getWorkspaceCollectionIds(redis, workspace.id, collection, null, -1);
    for (const itemId of Array.isArray(collectionIds) ? collectionIds : []) {
      if (!itemId || seen.has(itemId)) continue;
      seen.add(itemId);
      ids.push(itemId);
    }
  }

  return ids;
}

export async function countOwnedTeamWorkspaces(redis, userId) {
  const workspaces = await listOwnedWorkspaceRecords(redis, userId);
  return workspaces.filter((workspace) => workspace?.type === "team").length;
}

export async function countOwnedMonitors(redis, userId) {
  const ids = await collectOwnedCollectionIds(redis, userId, "monitors");
  if (ids.length === 0) return 0;

  const monitors = await redis.mget(...ids.map((id) => `monitor:${id}`));
  return monitors.filter((monitor) => monitor?.userId === userId && monitor?.type !== "child").length;
}

export async function countOwnedStatusPages(redis, userId) {
  const ids = await collectOwnedCollectionIds(redis, userId, "status_pages");
  if (ids.length === 0) return 0;

  const pages = await redis.mget(...ids.map((id) => `status_page:${id}`));
  return pages.filter((page) => page?.userId === userId).length;
}

export async function getPlanUsageSnapshot(redis, userId) {
  const [teamWorkspaces, monitors, statusPages] = await Promise.all([
    countOwnedTeamWorkspaces(redis, userId),
    countOwnedMonitors(redis, userId),
    countOwnedStatusPages(redis, userId),
  ]);

  return {
    teamWorkspaces,
    monitors,
    statusPages,
  };
}
