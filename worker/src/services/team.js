import { sendViaGmail } from "../lib/smtp.js";
import { TEAM_INVITE_LIST_MAX_LIMIT } from "../config/constants.js";
import {
  ensureWorkspaceMemberRecord,
  getWorkspaceInvitesKey,
  getWorkspaceMembership,
  listWorkspaceMembers,
  removeWorkspaceMemberRecord,
} from "./workspaces.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeInviteEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeInviteEmail(value));
}

function buildInviteId() {
  return `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildInviteRecord(workspace, email, invitedByUserId) {
  const nowIso = new Date().toISOString();
  return {
    id: buildInviteId(),
    workspaceId: workspace.id,
    email: normalizeInviteEmail(email),
    role: "member",
    status: "pending",
    invitedByUserId,
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    acceptedAt: null,
    revokedAt: null,
  };
}

export async function listTeamMembers(redis, workspaceId) {
  return listWorkspaceMembers(redis, workspaceId);
}

export async function listWorkspaceInvites(redis, workspaceId) {
  const inviteIds = await redis.lrange(getWorkspaceInvitesKey(workspaceId), 0, TEAM_INVITE_LIST_MAX_LIMIT - 1);
  const dedupedIds = [...new Set((Array.isArray(inviteIds) ? inviteIds : []).filter(Boolean))];
  const inviteItems = await Promise.all(dedupedIds.map((inviteId) => loadWorkspaceInvite(redis, inviteId)));
  const invites = inviteItems.filter(Boolean);
  invites.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  return invites;
}

export async function loadWorkspaceInvite(redis, inviteId) {
  if (!inviteId) return null;
  return (await redis.get(`workspace_invite:${inviteId}`)) || null;
}

export async function createWorkspaceInvite(redis, workspace, invitedByUserId, email) {
  const normalizedEmail = normalizeInviteEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    return { ok: false, error: "A valid email address is required." };
  }

  const existingMembership = workspace?.id
    ? await findWorkspaceMemberByEmail(redis, workspace.id, normalizedEmail)
    : null;
  if (existingMembership) {
    return { ok: false, error: "That email is already a member of this workspace." };
  }

  const existingInvites = await listWorkspaceInvites(redis, workspace.id);
  const pendingInvite = existingInvites.find((invite) => invite.email === normalizedEmail && invite.status === "pending");
  if (pendingInvite) {
    return { ok: false, error: "An active invite already exists for this email." };
  }

  const invite = buildInviteRecord(workspace, normalizedEmail, invitedByUserId);
  await redis.set(`workspace_invite:${invite.id}`, invite);
  await redis.lrem(getWorkspaceInvitesKey(workspace.id), 0, invite.id);
  await redis.lpush(getWorkspaceInvitesKey(workspace.id), invite.id);
  return { ok: true, invite };
}

export async function revokeWorkspaceInvite(redis, invite) {
  const next = {
    ...invite,
    status: "revoked",
    revokedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await redis.set(`workspace_invite:${invite.id}`, next);
  return next;
}

export async function acceptWorkspaceInvite(redis, workspace, invite, auth) {
  const email = normalizeInviteEmail(auth?.email);
  if (!email) {
    return { ok: false, error: "Your account must have an email address to accept an invite." };
  }

  if (invite.status !== "pending") {
    return { ok: false, error: "This invite is no longer active." };
  }

  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    const expired = { ...invite, status: "expired", updatedAt: new Date().toISOString() };
    await redis.set(`workspace_invite:${invite.id}`, expired);
    return { ok: false, error: "This invite has expired." };
  }

  if (invite.email !== email) {
    return { ok: false, error: "This invite was sent to a different email address." };
  }

  const membership = await ensureWorkspaceMemberRecord(redis, workspace, auth.userId, "member", {
    email,
    invitedByUserId: invite.invitedByUserId || null,
  });

  const acceptedInvite = {
    ...invite,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await redis.set(`workspace_invite:${invite.id}`, acceptedInvite);

  return { ok: true, invite: acceptedInvite, membership };
}

export async function leaveWorkspace(redis, workspace, userId) {
  if (workspace.ownerUserId === userId) {
    return { ok: false, error: "Workspace owners cannot leave their own workspace." };
  }

  const membership = await getWorkspaceMembership(redis, workspace.id, userId);
  if (!membership) {
    return { ok: false, error: "Membership not found." };
  }

  await removeWorkspaceMemberRecord(redis, workspace.id, userId);
  return { ok: true };
}

export async function sendWorkspaceInviteEmail(invite, workspace, env, request = null) {
  const inviteUrl = buildInviteUrl(invite, env, request);
  const emailUser = env.EMAIL_USER;
  const emailPass = env.EMAIL_PASS;
  if (!emailUser || !emailPass) {
    return {
      sent: false,
      queued: false,
      inviteUrl,
      providerResponse: "Invite created without email delivery because EMAIL_USER / EMAIL_PASS are not configured.",
    };
  }

  const subject = `Invitation to join ${workspace.name}`;
  const text = [
    `PingMaster workspace invitation`,
    ``,
    `You were invited to join "${workspace.name}".`,
    "",
    `Sign in with ${invite.email} and open the link below to accept your invitation:`,
    inviteUrl,
    "",
    `This invitation will expire on ${formatInviteTime(invite.expiresAt)}.`,
    "",
    "If the button does not appear in your email app, copy and paste the link into your browser.",
    "",
    "If you were not expecting this invite, you can safely ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
      <div style="padding:24px 28px;border-bottom:1px solid #e5e7eb;background:#0f172a;color:#ffffff;">
        <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.78;">PingMaster</div>
        <div style="font-size:24px;font-weight:700;margin-top:8px;">Join workspace</div>
        <div style="font-size:14px;line-height:1.6;color:#dbe4f0;margin-top:12px;">You were invited to collaborate in <strong>${escapeHtml(workspace.name)}</strong>.</div>
      </div>
      <div style="padding:24px 28px;">
        <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#374151;">Sign in with <strong>${escapeHtml(invite.email)}</strong> and accept the invitation to access shared monitors, incidents, alerts, and status pages for this workspace.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 18px;">
          <tr>
            <td bgcolor="#111827" style="border-radius:10px;">
              <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;padding:12px 18px;font-size:14px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">Accept invitation</a>
            </td>
          </tr>
        </table>
        <div style="margin:0 0 14px;padding:14px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#6b7280;">Invite details</div>
          <div style="margin-top:10px;font-size:14px;line-height:1.7;color:#111827;">
            <div><strong>Workspace:</strong> ${escapeHtml(workspace.name)}</div>
            <div><strong>Email:</strong> ${escapeHtml(invite.email)}</div>
            <div><strong>Role:</strong> Member</div>
            <div><strong>Expires:</strong> ${escapeHtml(formatInviteTime(invite.expiresAt))}</div>
          </div>
        </div>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.7;color:#4b5563;">If the button does not work in your email app, copy and paste this link into your browser:</p>
        <p style="margin:0 0 16px;font-size:13px;line-height:1.7;word-break:break-all;color:#2563eb;">${escapeHtml(inviteUrl)}</p>
        <p style="margin:0;font-size:13px;line-height:1.7;color:#6b7280;">If you were not expecting this invitation, you can safely ignore this email.</p>
      </div>
    </div>
  </body>
</html>`;

  await sendViaGmail({
    user: emailUser,
    pass: emailPass,
    to: [invite.email],
    subject,
    html,
    text,
  });

  return {
    sent: true,
    queued: false,
    inviteUrl,
    providerResponse: `Gmail -> ${invite.email}`,
  };
}

export function buildInviteUrl(invite, env, request = null) {
  const base = resolveAppBaseUrl(env, request);
  // console.log(base);
  const path = `/team?invite=${encodeURIComponent(invite.id)}`;
  if (!base) return path;
  return `${base}${path}`;
}

sendWorkspaceInviteEmail.buildInviteUrl = buildInviteUrl;

async function findWorkspaceMemberByEmail(redis, workspaceId, email) {
  const members = await listWorkspaceMembers(redis, workspaceId);
  return members.find((member) => normalizeInviteEmail(member.email) === email) || null;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInviteTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "soon";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function resolveAppBaseUrl(env, request = null) {
  const configuredBase = typeof env?.FRONTEND_APP_URL === "string"
    ? env.FRONTEND_APP_URL.trim().replace(/\/+$/, "")
    : "";
  if (configuredBase) return configuredBase;

  const origin = typeof request?.headers?.get === "function" ? request.headers.get("Origin") : "";
  if (origin && /^https?:\/\//i.test(origin)) {
    return origin.replace(/\/+$/, "");
  }

  const referer = typeof request?.headers?.get === "function" ? request.headers.get("Referer") : "";
  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin.replace(/\/+$/, "");
    } catch {
      return "";
    }
  }

  return "";
}
