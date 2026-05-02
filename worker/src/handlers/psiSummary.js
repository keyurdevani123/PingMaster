import { json } from "../lib/http.js";
import { saveStoredPsiSummary } from "../services/psiSummary.js";
import { isPersonalWorkspaceId, workspaceCollectionHasItem } from "../services/workspaces.js";

export async function postPsiSummary(request, redis, auth, workspace, membership, monitorId, corsHeaders) {
  const monitor = await redis.get(`monitor:${monitorId}`);
  if (!monitor) {
    return json({ error: "Monitor not found" }, 404, corsHeaders);
  }

  const fallbackKey = isPersonalWorkspaceId(workspace.id) ? `user:${auth.userId}:monitors` : null;
  const canAccess = monitor.userId === auth.userId
    || await workspaceCollectionHasItem(redis, workspace.id, "monitors", monitorId, fallbackKey);
  if (!canAccess) {
    return json({ error: "Forbidden" }, 403, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const strategy = typeof body?.strategy === "string" && body.strategy.trim() ? body.strategy.trim() : "desktop";
  const summary = await saveStoredPsiSummary(redis, workspace.id, monitorId, strategy, body?.psiPayload || null);
  if (!summary) {
    return json({ error: "Valid PSI payload is required" }, 400, corsHeaders);
  }

  return json(summary, 200, corsHeaders);
}
