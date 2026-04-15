import { json } from "../lib/http.js";
import { getBillingPlanConfig, getWorkspaceBilling, getEntitlementsForBilling } from "../services/billing.js";
import { countOwnedTeamWorkspaces } from "../services/planUsage.js";
import {
  createTeamWorkspace,
  deleteWorkspace,
  getWorkspaceMembership,
  removeWorkspaceMemberRecord,
} from "../services/workspaces.js";
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
  try {
    const billing = await getWorkspaceBilling(redis, workspace);
    const entitlements = getEntitlementsForBilling(billing);
    if (!entitlements.canCreateTeamWorkspaces) {
      return json({ error: "Upgrade to Plus or Pro to create shared workspaces." }, 403, corsHeaders);
    }

    const currentCount = await countOwnedTeamWorkspaces(redis, auth.userId);
    if (Number.isFinite(entitlements.maxTeamWorkspaces) && currentCount >= entitlements.maxTeamWorkspaces) {
      const currentPlan = getBillingPlanConfig(billing?.plan);
      return json({
        error: `Your ${currentPlan.label} plan includes up to ${entitlements.maxTeamWorkspaces} shared workspace${entitlements.maxTeamWorkspaces === 1 ? "" : "s"}. Upgrade to create another one.`,
      }, 403, corsHeaders);
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
  } catch (err) {
    return json({ error: err?.message || "Could not create workspace." }, 500, corsHeaders);
  }
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

export async function deleteTeamWorkspace(request, redis, auth, workspace, membership, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only the workspace owner can delete it." }, 403, corsHeaders);
  }
  const result = await deleteWorkspace(redis, workspace, auth.userId);
  if (!result.ok) return json({ error: result.error }, 400, corsHeaders);
  return json({ success: true, restoredToWorkspaceId: result.restoredToWorkspaceId }, 200, corsHeaders);
}

export async function removeMember(request, redis, auth, workspace, membership, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only the workspace owner can remove members." }, 403, corsHeaders);
  }
  let body;
  try { body = await request.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }
  const targetUserId = typeof body?.userId === "string" ? body.userId.trim() : "";
  if (!targetUserId || targetUserId === auth.userId) {
    return json({ error: "Provide a valid member user ID to remove (cannot remove yourself)." }, 400, corsHeaders);
  }
  const targetMembership = await getWorkspaceMembership(redis, workspace.id, targetUserId);
  if (!targetMembership || targetMembership.status !== "active") {
    return json({ error: "Member not found in this workspace." }, 404, corsHeaders);
  }
  await removeWorkspaceMemberRecord(redis, workspace.id, targetUserId);
  return json({ success: true }, 200, corsHeaders);
}
export async function patchMemberRole(request, redis, auth, workspace, membership, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only the workspace owner can change member roles." }, 403, corsHeaders);
  }
  let body;
  try { body = await request.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }
  const targetUserId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const newRole = typeof body?.role === "string" ? body.role.trim() : "";
  if (!targetUserId || targetUserId === auth.userId) {
    return json({ error: "Provide a valid member user ID (cannot change your own role)." }, 400, corsHeaders);
  }
  if (![ "admin", "member"].includes(newRole)) {
    return json({ error: "Role must be 'admin' or 'member'." }, 400, corsHeaders);
  }
  const targetMembership = await getWorkspaceMembership(redis, workspace.id, targetUserId);
  if (!targetMembership || targetMembership.status !== "active") {
    return json({ error: "Member not found in this workspace." }, 404, corsHeaders);
  }
  if (targetMembership.role === "owner") {
    return json({ error: "Cannot change the role of another owner." }, 400, corsHeaders );
  }
  const memberKey = `workspace:${workspace.id}:member:${targetUserId}`;
  await redis.set(memberKey, { ...targetMembership, role: newRole });
  return json({ success: true, userId: targetUserId, role: newRole }, 200, corsHeaders);
}
