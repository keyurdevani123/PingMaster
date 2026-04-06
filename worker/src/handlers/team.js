import { json } from "../lib/http.js";
import { createTeamWorkspace } from "../services/workspaces.js";
import {
  acceptWorkspaceInvite,
  createWorkspaceInvite,
  leaveWorkspace,
  listTeamMembers,
  listWorkspaceInvites,
  loadWorkspaceInvite,
  revokeWorkspaceInvite,
  sendWorkspaceInviteEmail,
} from "../services/team.js";

export async function postTeamWorkspace(request, redis, auth, workspace, membership, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can create team workspaces." }, 403, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const result = await createTeamWorkspace(redis, auth.userId, auth.email || "", workspace, body);
  if (!result.ok) {
    return json({ error: result.error }, 400, corsHeaders);
  }

  return json(result, 201, corsHeaders);
}

export async function getTeamMembers(request, redis, auth, workspace, membership, corsHeaders) {
  if (!workspace?.id || !membership) {
    return json({ error: "Forbidden" }, 403, corsHeaders);
  }
  return json(await listTeamMembers(redis, workspace.id), 200, corsHeaders);
}

export async function getTeamInvites(request, redis, auth, workspace, membership, corsHeaders) {
  if (!workspace?.id || !membership) {
    return json({ error: "Forbidden" }, 403, corsHeaders);
  }
  return json(await listWorkspaceInvites(redis, workspace.id), 200, corsHeaders);
}

export async function postTeamInvite(request, redis, auth, workspace, membership, env, corsHeaders, ctx) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can invite members." }, 403, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const email = typeof body?.email === "string" ? body.email : "";
  const result = await createWorkspaceInvite(redis, workspace, auth.userId, email);
  if (!result.ok) {
    return json({ error: result.error }, 400, corsHeaders);
  }

  let delivery;
  const inviteUrl = sendWorkspaceInviteEmail.buildInviteUrl(result.invite, env, request);

  if (ctx?.waitUntil) {
    ctx.waitUntil(
      sendWorkspaceInviteEmail(result.invite, workspace, env, request).catch(() => null)
    );
    delivery = {
      sent: true,
      queued: true,
      inviteUrl,
      providerResponse: "Invite created. Email delivery is being processed in the background.",
    };
  } else {
    try {
      delivery = await sendWorkspaceInviteEmail(result.invite, workspace, env, request);
    } catch (err) {
      delivery = {
        sent: false,
        queued: false,
        inviteUrl,
        providerResponse: err?.message || "Invite email delivery failed.",
      };
    }
  }

  return json({
    invite: result.invite,
    delivery,
  }, 201, corsHeaders);
}

export async function acceptTeamInvite(request, redis, auth, inviteId, corsHeaders) {
  const invite = await loadWorkspaceInvite(redis, inviteId);
  if (!invite) return json({ error: "Invite not found." }, 404, corsHeaders);
  const workspace = await redis.get(`workspace:${invite.workspaceId}`);
  if (!workspace) return json({ error: "Workspace not found." }, 404, corsHeaders);

  const result = await acceptWorkspaceInvite(redis, workspace, invite, auth);
  if (!result.ok) return json({ error: result.error }, 400, corsHeaders);
  return json({
    ...result,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      type: workspace.type,
    },
  }, 200, corsHeaders);
}

export async function revokeTeamInvite(request, redis, auth, workspace, membership, inviteId, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can revoke invites." }, 403, corsHeaders);
  }

  const invite = await loadWorkspaceInvite(redis, inviteId);
  if (!invite || invite.workspaceId !== workspace.id) {
    return json({ error: "Invite not found." }, 404, corsHeaders);
  }

  return json(await revokeWorkspaceInvite(redis, invite), 200, corsHeaders);
}

export async function leaveTeamWorkspace(request, redis, auth, workspace, membership, corsHeaders) {
  const result = await leaveWorkspace(redis, workspace, auth.userId);
  if (!result.ok) return json({ error: result.error }, 400, corsHeaders);
  return json({ success: true }, 200, corsHeaders);
}
