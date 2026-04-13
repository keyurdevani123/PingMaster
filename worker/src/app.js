import { Redis } from "@upstash/redis/cloudflare";
import { AuthError, authenticate } from "./lib/auth.js";
import { createCorsHeaders, json } from "./lib/http.js";
import {
  addMonitor,
  addChildMonitors,
  deleteMonitor,
  getChildMonitors,
  getHistory,
  getMonitors,
  getMonitorSummary,
  pingSingle,
  updateMonitorEndpoints,
} from "./handlers/monitors.js";
import { getAiReport, postAiReport } from "./handlers/aiReports.js";
import { postPsiSummary } from "./handlers/psiSummary.js";
import {
  addIncidentUpdate,
  createIncident,
  getIncident,
  getIncidents,
  updateIncident,
} from "./handlers/incidents.js";
import { getIncidentActionPackHandler, postIncidentActionPackHandler } from "./handlers/incidentActionPack.js";
import { postIncidentCreationSuggestionsHandler, postIncidentResolveSuggestionsHandler } from "./handlers/incidentSuggestions.js";
import {
  createAlertChannel,
  getAlertChannels,
  getAlertEvents,
  getAlertPolicies,
  getAlertPreferences,
  putDefaultAlertPolicy,
  putAlertPreferences,
  putMonitorAlertPolicy,
  testAlertChannel,
  updateAlertChannel,
} from "./handlers/alerts.js";
import {
  createStatusPage,
  getPublicStatusPage,
  getStatusPages,
  updateStatusPage,
} from "./handlers/statusPages.js";
import {
  createMaintenance,
  getMaintenances,
  updateMaintenance,
} from "./handlers/maintenance.js";
import {
  acceptTeamInvite,
  deleteTeamWorkspace,
  getTeamInvites,
  getTeamMembers,
  leaveTeamWorkspace,
  patchMemberRole,
  postTeamWorkspace,
  postTeamInvite,
  removeMember,
  revokeTeamInvite,
} from "./handlers/team.js";
import {
  getBillingHandler,
  postBillingSubscribe,
  postBillingVerify,
  postRazorpayWebhook,
} from "./handlers/billing.js";
import { crawlSite, pingDiagnostics, pingNow } from "./handlers/system.js";
import { runPinger } from "./services/monitoring.js";
import { buildBootstrapPayload, resolveWorkspaceForUser } from "./services/workspaces.js";

function createRedis(env) {
  return new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
}

export default {
  async fetch(request, env, ctx) {
    const redis = createRedis(env);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const corsHeaders = createCorsHeaders();

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (path.startsWith("/status/") && method === "GET") {
      return getPublicStatusPage(request, redis, path.split("/")[2], corsHeaders);
    }

    if (path === "/billing/webhooks/razorpay" && method === "POST") {
      return postRazorpayWebhook(request, redis, env, corsHeaders);
    }

    let auth;
    try {
      auth = await authenticate(request, env);
    } catch (err) {
      const status = err instanceof AuthError ? err.status : 401;
      return json({ error: err.message || "Unauthorized" }, status, corsHeaders);
    }
    const userId = auth.userId;
    const requestedWorkspaceId = request.headers.get("X-Workspace-Id") || "";

    if (path === "/session/bootstrap" && method === "GET") {
      return json(await buildBootstrapPayload(redis, auth, requestedWorkspaceId), 200, corsHeaders);
    }

    if (path.startsWith("/team/invites/") && path.endsWith("/accept") && method === "POST") {
      return acceptTeamInvite(request, redis, auth, path.split("/")[3], corsHeaders);
    }

    const workspaceContext = await resolveWorkspaceForUser(redis, userId, requestedWorkspaceId, auth.email);
    if (!workspaceContext) {
      return json({ error: "Forbidden" }, 403, corsHeaders);
    }
    const { workspace, membership } = workspaceContext;
    const workspaceId = workspace.id;

    if (path === "/team/members" && method === "GET") {
      return getTeamMembers(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/billing" && method === "GET") {
      return getBillingHandler(request, redis, auth, workspace, membership, env, corsHeaders);
    }

    if (path === "/billing/subscribe" && method === "POST") {
      return postBillingSubscribe(request, redis, auth, workspace, membership, env, corsHeaders);
    }

    if (path === "/billing/verify" && method === "POST") {
      return postBillingVerify(request, redis, auth, workspace, membership, env, corsHeaders);
    }

    if (path === "/team/workspaces" && method === "POST") {
      return postTeamWorkspace(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/team/invites" && method === "GET") {
      return getTeamInvites(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/team/invites" && method === "POST") {
      return postTeamInvite(request, redis, auth, workspace, membership, env, corsHeaders, ctx);
    }

    if (path.startsWith("/team/invites/") && path.endsWith("/revoke") && method === "POST") {
      return revokeTeamInvite(request, redis, auth, workspace, membership, path.split("/")[3], corsHeaders);
    }

    if (path === "/team/leave" && method === "POST") {
      return leaveTeamWorkspace(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/team/workspaces" && method === "DELETE") {
      return deleteTeamWorkspace(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/team/members/remove" && method === "POST") {
      return removeMember(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path.startsWith("/team/members/") && path.endsWith("/role") && method === "PATCH") {
      return patchMemberRole(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/monitors" && method === "POST") {
      return addMonitor(request, redis, userId, workspaceId, corsHeaders);
    }

    if (path === "/monitors" && method === "GET") {
      return getMonitors(request, redis, userId, workspaceId, corsHeaders);
    }

    if (path === "/monitors/summary" && method === "GET") {
      return getMonitorSummary(request, redis, userId, workspaceId, corsHeaders);
    }

    if (path === "/incidents" && method === "GET") {
      return getIncidents(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/incidents" && method === "POST") {
      return createIncident(request, redis, auth, workspace, membership, env, corsHeaders, ctx);
    }

    if (path === "/incidents/suggestions/create" && method === "POST") {
      return postIncidentCreationSuggestionsHandler(request, redis, auth, workspace, membership, corsHeaders, env);
    }

    if (path === "/alerts/channels" && method === "GET") {
      return getAlertChannels(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/alerts/channels" && method === "POST") {
      return createAlertChannel(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path.startsWith("/alerts/channels/") && path.endsWith("/test") && method === "POST") {
      return testAlertChannel(request, redis, auth, workspace, membership, path.split("/")[3], env, corsHeaders);
    }

    if (path.startsWith("/alerts/channels/") && method === "PATCH") {
      return updateAlertChannel(request, redis, auth, workspace, membership, path.split("/")[3], corsHeaders);
    }

    if (path === "/alerts/policies" && method === "GET") {
      return getAlertPolicies(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/alerts/policies/default" && method === "PUT") {
      return putDefaultAlertPolicy(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path.startsWith("/alerts/policies/monitors/") && method === "PUT") {
      return putMonitorAlertPolicy(request, redis, auth, workspace, membership, path.split("/")[4], corsHeaders);
    }

    if (path === "/alerts/events" && method === "GET") {
      return getAlertEvents(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/alerts/preferences" && method === "GET") {
      return getAlertPreferences(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/alerts/preferences" && method === "PUT") {
      return putAlertPreferences(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/status-pages" && method === "GET") {
      return getStatusPages(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path === "/status-pages" && method === "POST") {
      return createStatusPage(request, redis, auth, workspace, membership, corsHeaders);
    }

    if (path.startsWith("/status-pages/") && method === "PATCH") {
      return updateStatusPage(request, redis, auth, workspace, membership, path.split("/")[2], corsHeaders);
    }

    if (path === "/maintenance" && method === "GET") {
      return getMaintenances(request, redis, userId, workspaceId, corsHeaders);
    }

    if (path === "/maintenance" && method === "POST") {
      return createMaintenance(request, redis, userId, workspaceId, corsHeaders);
    }

    if (path.startsWith("/maintenance/") && method === "PATCH") {
      return updateMaintenance(request, redis, userId, workspaceId, path.split("/")[2], corsHeaders);
    }

    if (path.startsWith("/incidents/") && path.endsWith("/updates") && method === "POST") {
      return addIncidentUpdate(request, redis, auth, workspace, membership, path.split("/")[2], corsHeaders);
    }

    if (path.startsWith("/incidents/") && path.endsWith("/action-pack") && method === "GET") {
      return getIncidentActionPackHandler(request, redis, auth, workspace, membership, path.split("/")[2], corsHeaders);
    }

    if (path.startsWith("/incidents/") && path.endsWith("/action-pack") && method === "POST") {
      return postIncidentActionPackHandler(request, redis, auth, workspace, membership, path.split("/")[2], env, corsHeaders);
    }

    if (path.startsWith("/incidents/") && path.endsWith("/suggestions/resolve") && method === "POST") {
      return postIncidentResolveSuggestionsHandler(request, redis, auth, workspace, membership, path.split("/")[2], corsHeaders, env);
    }

    if (path.startsWith("/incidents/") && method === "GET") {
      return getIncident(request, redis, auth, workspace, membership, path.split("/")[2], corsHeaders);
    }

    if (path.startsWith("/incidents/") && method === "PATCH") {
      return updateIncident(request, redis, auth, workspace, membership, path.split("/")[2], env, corsHeaders, ctx);
    }

    if (path.startsWith("/monitors/") && method === "DELETE") {
      return deleteMonitor(request, redis, userId, workspaceId, path.split("/")[2], corsHeaders);
    }

    if (path.startsWith("/monitors/") && path.endsWith("/history") && method === "GET") {
      return getHistory(request, redis, userId, workspaceId, path.split("/")[2], corsHeaders);
    }

    if (path.startsWith("/monitors/") && path.endsWith("/children") && method === "GET") {
      return getChildMonitors(request, redis, userId, workspaceId, path.split("/")[2], corsHeaders);
    }

    if (path.startsWith("/monitors/") && path.endsWith("/children") && method === "POST") {
      return addChildMonitors(request, redis, userId, workspaceId, path.split("/")[2], corsHeaders);
    }

    if (path.startsWith("/monitors/") && path.endsWith("/ai-report") && method === "GET") {
      return getAiReport(request, redis, auth, workspace, membership, path.split("/")[2], corsHeaders);
    }

    if (path.startsWith("/monitors/") && path.endsWith("/ai-report") && method === "POST") {
      return postAiReport(request, redis, auth, workspace, membership, path.split("/")[2], env, corsHeaders);
    }

    if (path.startsWith("/monitors/") && path.endsWith("/psi-summary") && method === "POST") {
      return postPsiSummary(request, redis, auth, workspace, membership, path.split("/")[2], corsHeaders);
    }

    if (path.startsWith("/monitors/") && path.endsWith("/endpoints") && method === "PATCH") {
      return updateMonitorEndpoints(request, redis, userId, workspaceId, path.split("/")[2], corsHeaders);
    }

    if (path === "/ping-now" && method === "POST") {
      return pingNow(redis, env, corsHeaders);
    }

    if (path.startsWith("/monitors/") && path.endsWith("/ping") && method === "POST") {
      return pingSingle(request, redis, userId, workspaceId, path.split("/")[2], env, corsHeaders, ctx);
    }

    if (path === "/crawl" && method === "POST") {
      return crawlSite(request, userId, corsHeaders);
    }

    if (path === "/diagnostics/ping" && method === "POST") {
      return pingDiagnostics(request, userId, corsHeaders);
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },

  async scheduled(_event, env) {
    const redis = createRedis(env);
    await runPinger(redis, env);
  },
};
