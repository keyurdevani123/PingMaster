import { json } from "../lib/http.js";
import { generateMonitorAiReport, getMonitorAiReport, saveMonitorAiReport } from "../services/aiReports.js";
import { isPersonalWorkspaceId, workspaceCollectionHasItem } from "../services/workspaces.js";

export async function getAiReport(request, redis, auth, workspace, membership, monitorId, corsHeaders) {
  const monitor = await getWorkspaceMonitor(redis, auth.userId, workspace.id, monitorId);
  if (!monitor) {
    return json({ error: "Monitor not found" }, 404, corsHeaders);
  }

  const report = await getMonitorAiReport(redis, workspace.id, monitorId);
  return json({
    monitorId,
    workspaceId: workspace.id,
    report: report || null,
  }, 200, corsHeaders);
}

export async function postAiReport(request, redis, auth, workspace, membership, monitorId, env, corsHeaders) {
  const monitor = await getWorkspaceMonitor(redis, auth.userId, workspace.id, monitorId);
  if (!monitor) {
    return json({ error: "Monitor not found" }, 404, corsHeaders);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const generated = await generateMonitorAiReport(redis, env, workspace, monitor, {
      psiPayload: body?.psiPayload || null,
      psiStrategy: typeof body?.psiStrategy === "string" ? body.psiStrategy : null,
    });
    await saveMonitorAiReport(redis, workspace.id, monitorId, generated);
    return json(generated, 200, corsHeaders);
  } catch (error) {
    const message = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "Gemini took too long to generate the monitor report. Please try again."
      : (error?.message || "Could not generate monitor report.");
    return json({ error: message }, 500, corsHeaders);
  }
}

async function getWorkspaceMonitor(redis, userId, workspaceId, monitorId) {
  const monitor = await redis.get(`monitor:${monitorId}`);
  if (!monitor) return null;
  if (monitor.userId === userId) return monitor;

  const fallbackKey = isPersonalWorkspaceId(workspaceId) ? `user:${userId}:monitors` : null;
  const isLinkedToWorkspace = await workspaceCollectionHasItem(
    redis,
    workspaceId,
    "monitors",
    monitorId,
    fallbackKey,
  );
  return isLinkedToWorkspace ? monitor : null;
}
