import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Crown, Info, Mail, Plus, Shield, Trash2, Users, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageLoader from "../../components/PageLoader";
import { useAuth } from "../../context/AuthContext";
import {
  acceptTeamInvite,
  createTeamInvite,
  createTeamWorkspace,
  deleteTeamWorkspace,
  fetchMonitors,
  fetchTeamInvites,
  fetchTeamMembers,
  leaveTeamWorkspace,
  removeTeamMember,
  revokeTeamInvite,
  updateMemberRole,
} from "../../api";

const ROLE_CONFIG = {
  owner: { label: "Owner", icon: Crown, badge: "border-sky-400/20 bg-sky-400/10 text-sky-200" },
  admin: { label: "Admin", icon: Shield, badge: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" },
  member: { label: "Member", icon: Users, badge: "border-amber-300/20 bg-amber-300/10 text-amber-100" },
};

const ROLE_GUIDE = [
  { role: "owner", summary: "Responsible for the shared workspace.", details: ["Can create and delete team workspaces", "Can invite people, remove members, and change roles", "Keeps full control of workspace settings"] },
  { role: "admin", summary: "Trusted teammate who helps manage operations.", details: ["Works with monitors, incidents, and alerts", "Cannot change membership or delete the workspace", "Good for day-to-day operational ownership"] },
  { role: "member", summary: "Teammate who needs access to shared monitors.", details: ["Can work inside the shared workspace", "Cannot manage roles or workspace membership", "Best for contributors who need visibility and participation"] },
];

export default function WorkspacesPage() {
  const { user, workspace, workspaces, currentMembershipRole, selectWorkspace, workspaceSwitching, billing } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteId = searchParams.get("invite") || "";
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceMonitorIds, setWorkspaceMonitorIds] = useState([]);
  const [workspaceMonitors, setWorkspaceMonitors] = useState([]);
  const [workspaceMonitorsLoading, setWorkspaceMonitorsLoading] = useState(false);
  const [showWorkspaceCreator, setShowWorkspaceCreator] = useState(false);
  const [showRoleGuide, setShowRoleGuide] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingRemoveMemberId, setPendingRemoveMemberId] = useState(null);
  const [roleChanging, setRoleChanging] = useState({});
  const [workspaceBilling, setWorkspaceBilling] = useState(billing || null);

  const isOwner = currentMembershipRole === "owner";
  const isTeamWorkspace = workspace?.type === "team";
  const effectiveBilling = workspaceBilling || billing || null;
  const hasTeamWorkspaceAccess = Boolean(effectiveBilling?.entitlements?.canCreateTeamWorkspaces);
  const workspaceLimit = Number.isFinite(effectiveBilling?.entitlements?.maxTeamWorkspaces)
    ? effectiveBilling.entitlements.maxTeamWorkspaces
    : 0;
  const ownedTeamWorkspaceCount = useMemo(
    () => workspaces.filter((item) => item.type === "team" && item.ownerUserId === user?.uid).length,
    [user?.uid, workspaces],
  );
  const teamWorkspaceLimitReached = workspaceLimit > 0 && ownedTeamWorkspaceCount >= workspaceLimit;
  const canCreateTeamWorkspace = isOwner && !isTeamWorkspace && hasTeamWorkspaceAccess && !teamWorkspaceLimitReached;
  const canInvite = isOwner && isTeamWorkspace;
  const canDelete = isOwner && isTeamWorkspace && (workspace?.memberCount ?? 2) <= 1;
  const activeInvites = useMemo(() => invites.filter((invite) => invite.status === "pending"), [invites]);

  const loadTeamData = useCallback(async ({ silent = false } = {}) => {
    if (!user || !workspace?.id) return;
    if (!isTeamWorkspace) {
      setMembers([]);
      setInvites([]);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError("");
    try {
      const [memberItems, inviteItems] = await Promise.all([fetchTeamMembers(user), fetchTeamInvites(user)]);
      setMembers(Array.isArray(memberItems) ? memberItems : []);
      setInvites(Array.isArray(inviteItems) ? inviteItems : []);
    } catch (err) {
      setError(err?.message || "Could not load workspace collaboration details.");
    } finally {
      setLoading(false);
    }
  }, [isTeamWorkspace, user, workspace?.id]);

  const loadWorkspaceMonitors = useCallback(async () => {
    if (!user) return;
    setWorkspaceMonitorsLoading(true);
    setError("");
    try {
      const personalWorkspace = workspaces.find((item) => item.type === "personal");
      const monitorItems = await fetchMonitors(user, { workspaceId: personalWorkspace?.id || "" });
      setWorkspaceMonitors(Array.isArray(monitorItems) ? monitorItems.filter((item) => item.type !== "child") : []);
    } catch (err) {
      setError(err?.message || "Could not load monitors for workspace creation.");
    } finally {
      setWorkspaceMonitorsLoading(false);
    }
  }, [user, workspaces]);

  useEffect(() => {
    loadTeamData();
  }, [loadTeamData]);

  useEffect(() => {
    setWorkspaceBilling(billing || null);
  }, [billing]);

  async function handleAcceptInvite() {
    if (!inviteId) return;
    setAccepting(true);
    setError("");
    setSuccess("");
    try {
      const result = await acceptTeamInvite(user, inviteId);
      if (result?.workspace?.id) await selectWorkspace(result.workspace.id);
      setSuccess("Invite accepted. The shared workspace is now available in your workspace list.");
      setSearchParams({});
      await loadTeamData({ silent: true });
    } catch (err) {
      setError(err?.message || "Could not accept invite.");
    } finally {
      setAccepting(false);
    }
  }

  async function handleSendInvite(event) {
    event.preventDefault();
    if (!inviteEmail.trim()) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const result = await createTeamInvite(user, inviteEmail.trim());
      setInviteEmail("");
      setSuccess(result?.delivery?.providerResponse || "Invite sent.");
      if (result?.invite?.id) setInvites((current) => [result.invite, ...current.filter((item) => item.id !== result.invite.id)]);
    } catch (err) {
      setError(err?.message || "Could not send invite.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevokeInvite(inviteIdToRevoke) {
    setSubmitting(true);
    setError("");
    try {
      const revokedInvite = await revokeTeamInvite(user, inviteIdToRevoke);
      setInvites((current) => current.map((item) => (item.id === inviteIdToRevoke ? { ...item, ...revokedInvite } : item)));
    } catch (err) {
      setError(err?.message || "Could not revoke invite.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLeaveWorkspace() {
    setSubmitting(true);
    setError("");
    try {
      await leaveTeamWorkspace(user);
      const fallbackWorkspace = workspaces.find((item) => item.id !== workspace?.id);
      if (fallbackWorkspace?.id) await selectWorkspace(fallbackWorkspace.id);
      setSuccess("You left the shared workspace.");
    } catch (err) {
      setError(err?.message || "Could not leave this workspace.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteWorkspace() {
    setSubmitting(true);
    setError("");
    setShowDeleteConfirm(false);
    try {
      const result = await deleteTeamWorkspace(user);
      const personalWorkspace = workspaces.find((item) => item.type === "personal" || item.id === result?.restoredToWorkspaceId);
      if (personalWorkspace?.id) await selectWorkspace(personalWorkspace.id);
      setSuccess("Workspace deleted. Linked monitors remain in your personal workspace.");
    } catch (err) {
      setError(err?.message || "Could not delete workspace.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveMember(targetUserId) {
    setSubmitting(true);
    setError("");
    setPendingRemoveMemberId(null);
    try {
      await removeTeamMember(user, targetUserId);
      setMembers((current) => current.filter((item) => item.userId !== targetUserId));
      setSuccess("Member removed from workspace.");
    } catch (err) {
      setError(err?.message || "Could not remove member.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(targetUserId, newRole) {
    setRoleChanging((prev) => ({ ...prev, [targetUserId]: true }));
    setError("");
    setSuccess("");
    try {
      await updateMemberRole(user, targetUserId, newRole);
      setMembers((current) => current.map((item) => (item.userId === targetUserId ? { ...item, role: newRole } : item)));
      setSuccess(`Role updated to ${ROLE_CONFIG[newRole]?.label || newRole}.`);
    } catch (err) {
      setError(err?.message || "Could not update role.");
    } finally {
      setRoleChanging((prev) => ({ ...prev, [targetUserId]: false }));
    }
  }

  async function handleCreateWorkspace(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const result = await createTeamWorkspace(user, { name: workspaceName.trim(), monitorIds: workspaceMonitorIds });
      setWorkspaceName("");
      setWorkspaceMonitorIds([]);
      setShowWorkspaceCreator(false);
      setSuccess(`Created "${result?.workspace?.name || "team workspace"}".`);
      if (result?.workspace?.id) await selectWorkspace(result.workspace.id);
    } catch (err) {
      setError(err?.message || "Could not create workspace.");
    } finally {
      setSubmitting(false);
    }
  }

  async function openWorkspaceCreator() {
    setShowWorkspaceCreator(true);
    if (workspaceMonitors.length === 0 && !workspaceMonitorsLoading) await loadWorkspaceMonitors();
  }

  return (
    <div className="min-h-screen bg-[#08090b] text-[#f2f2f2]">
      <header className="border-b border-[#1a1d24] bg-[#0d0f13]">
        <div className="max-w-7xl px-2 md:px-5 py-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            {/* <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Workspace Management</p> */}
            <h1 className="mt-1 text-2xl font-semibold text-white">Workspaces</h1>
            <p className="mt-2 text-sm text-[#8d94a0]">Keep your main workspace private. Create a shared workspace only when monitors need team access.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canCreateTeamWorkspace && (
              <button type="button" onClick={openWorkspaceCreator} className="h-10 px-4 rounded-lg bg-white text-black text-sm font-semibold inline-flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Create Workspace
              </button>
            )}
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2">
              {/* <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Role Guide</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Choose the right role before you invite anyone</h2>
                <p className="mt-2 text-sm text-[#8d94a0]">Use owners for workspace control, admins for daily operations, and members for shared visibility and response work.</p>
              </div> */}
              <button type="button" onClick={() => setShowRoleGuide(true)} className="h-10 px-4 rounded-lg border border-[#252a33] bg-[#14181e] text-sm inline-flex items-center gap-2 shrink-0">
                <Info className="w-4 h-4" />
                Open Detailed Guide
              </button>
            </div>
          </div>
          
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 md:px-8 py-8 xl:flex xl:items-start xl:gap-6">
        <div className="flex-1 space-y-6">
          {loading ? (
            <PageLoader rows={5} />
          ) : (
            <>
          {inviteId && (
            <section className="bg-sky-500/10 border border-sky-500/25 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">Shared workspace invitation</p>
                <p className="mt-1 text-sm text-[#b8c9ea]">Accept to join the workspace and see its shared monitors, alerts, incidents, and status pages.</p>
              </div>
              <button type="button" onClick={handleAcceptInvite} disabled={accepting} className="h-10 px-4 rounded-lg bg-white text-black text-sm font-semibold disabled:opacity-50">
                {accepting ? "Accepting..." : "Accept Invitation"}
              </button>
            </section>
          )}

          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
          {success && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

          {!isTeamWorkspace && isOwner && !canCreateTeamWorkspace && (
            <section className="rounded-xl border border-[#2a3341] bg-[#10141b] px-4 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">Shared workspaces are not included in this plan</p>
                <p className="mt-1 text-sm text-[#9fb0c7]">
                  {workspaceLimit > 0
                    ? `Your current plan supports up to ${workspaceLimit} shared workspaces. You are currently using ${ownedTeamWorkspaceCount}.`
                    : "Upgrade to Plus or Pro to create team workspaces for shared monitoring."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/plans")}
                className="h-10 px-4 rounded-lg bg-white text-black text-sm font-semibold"
              >
                View Plans
              </button>
            </section>
          )}

          <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5 space-y-5">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Current Workspace</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">{workspace?.name || "Workspace"}</h2>
                <p className="mt-2 text-sm text-[#8d94a0]">{isTeamWorkspace ? "This is a shared workspace used for team collaboration." : "This is your private workspace. It does not need a members section."}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <WorkspaceTypePill type={workspace?.type} />
                <RoleBadge role={currentMembershipRole} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <InfoCard label="Access" value={ROLE_CONFIG[currentMembershipRole]?.label || currentMembershipRole} helper="Your current role in this workspace" />
              <InfoCard label="People" value={isTeamWorkspace ? String(workspace?.memberCount ?? members.length) : "Private"} helper={isTeamWorkspace ? "Members in this shared workspace" : "Personal workspace only"} />
              <InfoCard label="Created" value={formatDate(workspace?.createdAt)} helper={workspace?.slug ? `/${workspace.slug}` : "Workspace record"} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-end">
              <div className="space-y-2">
                <label className="block text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Switch Workspace</label>
                <div className="relative">
                  <select value={workspace?.id || ""} onChange={(event) => selectWorkspace(event.target.value)} disabled={workspaceSwitching} className="w-full h-11 rounded-lg border border-[#252a33] bg-[#14181e] px-3 pr-9 text-sm text-[#dbe1eb] appearance-none focus:outline-none disabled:opacity-60">
                    {workspaces.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} - {item.type === "team" ? "Team" : "Personal"} - {ROLE_CONFIG[item.currentRole]?.label || item.currentRole}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-[#6f7785] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {!isOwner && isTeamWorkspace && <button type="button" onClick={handleLeaveWorkspace} disabled={submitting} className="h-10 px-4 rounded-lg border border-red-500/20 bg-red-500/5 text-red-300 text-sm disabled:opacity-50">{submitting ? "Leaving..." : "Leave Workspace"}</button>}
                {canDelete && <button type="button" onClick={() => setShowDeleteConfirm(true)} className="h-10 px-4 rounded-lg border border-red-500/20 bg-red-500/5 text-red-300 text-sm inline-flex items-center gap-2"><Trash2 className="w-4 h-4" />Delete Workspace</button>}
              </div>
            </div>
          </section>

          {/* <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Role Guide</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Choose the right role before you invite anyone</h2>
                <p className="mt-2 text-sm text-[#8d94a0]">Use owners for workspace control, admins for daily operations, and members for shared visibility and response work.</p>
              </div>
              <button type="button" onClick={() => setShowRoleGuide(true)} className="h-10 px-4 rounded-lg border border-[#252a33] bg-[#14181e] text-sm inline-flex items-center gap-2 shrink-0">
                <Info className="w-4 h-4" />
                Open Detailed Guide
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
              {ROLE_GUIDE.map((item) => (
                <article key={item.role} className="rounded-lg border border-[#252a33] bg-[#14181e] p-4">
                  <RoleBadge role={item.role} />
                  <p className="mt-3 text-sm text-[#dbe1eb]">{item.summary}</p>
                  <div className="mt-4 space-y-2.5">
                    {item.details.map((detail) => <GuidePoint key={detail} text={detail} />)}
                  </div>
                </article>
              ))}
            </div>
          </section> */}

          <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Workspace List</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Available workspaces</h2>
              </div>
              <span className="text-sm text-[#8d94a0]">{workspaces.length} total</span>
            </div>
            <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {workspaces.map((item) => {
                const active = item.id === workspace?.id;
                return (
                  <article key={item.id} className={`rounded-lg border p-4 ${active ? "border-white/10 bg-[#151922]" : "border-[#252a33] bg-[#12161d]"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <WorkspaceTypePill type={item.type} />
                          {active && <span className="text-[11px] text-[#cbd5e1]">Active</span>}
                        </div>
                        <h3 className="mt-3 text-lg font-medium text-white">{item.name}</h3>
                        <p className="mt-1 text-sm text-[#8d94a0]">{item.type === "team" ? "Shared workspace for collaboration." : "Private workspace for your own monitors."}</p>
                      </div>
                      <RoleBadge role={item.currentRole} small />
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                      <span className="text-[#8d94a0]">{item.type === "team" ? `${item.memberCount ?? 0} members` : "Private"}</span>
                      {active ? (
                        <span className="text-[#cbd5e1]">Currently selected</span>
                      ) : (
                        <button type="button" onClick={() => selectWorkspace(item.id)} disabled={workspaceSwitching} className="h-9 px-4 rounded-lg border border-[#252a33] bg-[#14181e] text-sm disabled:opacity-60">
                          Open
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {isTeamWorkspace ? (
            <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
              <section className="bg-[#0f1217] border border-[#22252b] rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-[#22252b]">
                  <h2 className="text-lg font-semibold text-white">Workspace Members</h2>
                  <p className="mt-1 text-sm text-[#8d94a0]">Members are shown only in shared workspaces.</p>
                </div>
                <div className="divide-y divide-[#22252b]">
                  {loading ? (
                    <div className="px-5 py-8 text-sm text-[#8d94a0]">Loading workspace members...</div>
                  ) : members.map((member) => (
                    <div key={`${member.workspaceId}:${member.userId}`} className="px-5 py-4 flex items-center gap-4">
                      <div className="h-9 w-9 rounded-full bg-[#14181e] border border-[#252a33] grid place-items-center text-sm font-semibold text-[#c9d1dd] shrink-0">
                        {(member.email || member.userId || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#edf2fb] break-all">{member.email || member.userId}</p>
                        <p className="mt-1 text-xs text-[#8d94a0]">Joined {member.joinedAt ? formatDate(member.joinedAt) : "--"}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <RoleBadge role={member.role} />
                        {isOwner && member.role !== "owner" && (
                          <div className="relative">
                            <select value={member.role} disabled={roleChanging[member.userId]} onChange={(event) => handleRoleChange(member.userId, event.target.value)} className="h-8 pl-3 pr-7 rounded-lg border border-[#252a33] bg-[#14181e] text-xs text-[#d4dae4] appearance-none focus:outline-none disabled:opacity-50">
                              <option value="admin">Admin</option>
                              <option value="member">Member</option>
                            </select>
                            <ChevronDown className="w-3 h-3 text-[#6f7785] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                          </div>
                        )}
                        {isOwner && member.role !== "owner" && (pendingRemoveMemberId === member.userId ? (
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => handleRemoveMember(member.userId)} disabled={submitting} className="h-8 px-3 rounded-lg border border-red-500/25 bg-red-500/10 text-xs text-red-200 disabled:opacity-50">Confirm</button>
                            <button type="button" onClick={() => setPendingRemoveMemberId(null)} className="h-8 w-8 rounded-lg border border-[#252a33] bg-[#14181e] grid place-items-center"><X className="w-3.5 h-3.5 text-[#8d94a0]" /></button>
                          </div>
                        ) : <button type="button" onClick={() => setPendingRemoveMemberId(member.userId)} className="h-8 w-8 rounded-lg border border-[#252a33] bg-[#14181e] grid place-items-center"><Trash2 className="w-3.5 h-3.5 text-[#8d94a0]" /></button>)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <div className="space-y-6">
                {canInvite && (
                  <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5">
                    <h2 className="text-lg font-semibold text-white">Invite Members</h2>
                    <p className="mt-2 text-sm text-[#8d94a0]">Invite teammates to this shared workspace. They join as members first.</p>
                    <form onSubmit={handleSendInvite} className="mt-4 flex flex-col sm:flex-row gap-3">
                      <div className="flex-1 flex items-center gap-2 rounded-lg border border-[#252a33] bg-[#14181e] px-3">
                        <Mail className="w-4 h-4 text-[#7e8796] shrink-0" />
                        <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" className="flex-1 h-11 bg-transparent text-sm text-[#dbe1eb] placeholder:text-[#6f7785] focus:outline-none" required />
                      </div>
                      <button type="submit" disabled={submitting} className="h-11 px-5 rounded-lg bg-white text-black text-sm font-semibold disabled:opacity-50">
                        {submitting ? "Sending..." : "Send Invite"}
                      </button>
                    </form>
                  </section>
                )}

                <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5">
                  <h2 className="text-lg font-semibold text-white">Pending Invites</h2>
                  <div className="mt-4 space-y-3">
                  {loading ? (
                    <div className="rounded-lg border border-[#252a33] bg-[#14181e] px-4 py-4 text-sm text-[#8d94a0]">Loading invites...</div>
                  ) : activeInvites.length > 0 ? activeInvites.map((invite) => (
                      <div key={invite.id} className="rounded-lg border border-[#252a33] bg-[#14181e] px-4 py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#edf2fb] break-all">{invite.email}</p>
                          <p className="mt-1 text-xs text-[#8d94a0]">Expires {invite.expiresAt ? new Date(invite.expiresAt).toLocaleString() : "--"}</p>
                        </div>
                        <button type="button" onClick={() => handleRevokeInvite(invite.id)} disabled={submitting} className="h-8 px-3 rounded-lg border border-[#303846] bg-[#161a21] text-xs disabled:opacity-50">
                          Revoke
                        </button>
                      </div>
                    )) : <div className="rounded-lg border border-[#252a33] bg-[#14181e] px-4 py-4 text-sm text-[#8d94a0]">No pending invites right now.</div>}
                  </div>
                </section>
              </div>
            </div>
            ) : null}
            </>
          )}
        </div>

      </div>

      {showRoleGuide && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex justify-end p-3 sm:p-5"
          onClick={() => setShowRoleGuide(false)}
        >
          <aside
            className="h-full w-full max-w-md overflow-y-auto rounded-2xl border border-[#252a33] bg-[#0f1217] shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 border-b border-[#22252b] bg-[#0f1217] px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {/* <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Role Guide</p> */}
                  <h2 className="mt-2 text-lg font-semibold text-white">Role Guide</h2>
                  <p className="mt-2 text-sm text-[#8d94a0]">Choose the right level of access before you invite anyone into a shared workspace.</p>
                  {/* <p className="mt-2 text-sm text-[#8d94a0]">This panel stays above the page without blurring the background.</p> */}
                </div>
                <button type="button" onClick={() => setShowRoleGuide(false)} className="h-8 w-8 rounded-lg border border-[#252a33] bg-[#14181e] grid place-items-center shrink-0">
                  <X className="w-4 h-4 text-[#8d94a0]" />
                </button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {ROLE_GUIDE.map((item) => (
                <section key={item.role} className="rounded-xl border border-[#252a33] bg-[#14181e] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <RoleBadge role={item.role} />
                    <span className="text-xs text-[#8d94a0]">{item.role === "owner" ? "Full control" : item.role === "admin" ? "Operational access" : "Shared access"}</span>
                  </div>
                  <p className="mt-3 text-sm text-[#dbe1eb]">{item.summary}</p>
                  <div className="mt-4 space-y-3">
                    {item.details.map((detail) => <GuidePoint key={detail} text={detail} />)}
                  </div>
                </section>
              ))}
            </div>
          </aside>
        </div>
      )}

      {showWorkspaceCreator && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => { if (!submitting) setShowWorkspaceCreator(false); }}>
          <div className="w-full max-w-3xl rounded-xl border border-[#252a33] bg-[#0f1217] p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Create Team Workspace</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Choose a workspace name and the monitors to share</h2>
              </div>
              <button type="button" onClick={() => setShowWorkspaceCreator(false)} className="h-9 w-9 rounded-lg border border-[#252a33] bg-[#14181e] grid place-items-center"><X className="w-4 h-4 text-[#8d94a0]" /></button>
            </div>

            <form onSubmit={handleCreateWorkspace} className="mt-6 space-y-5">
              <div className="space-y-2">
                <label className="block text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Workspace Name</label>
                <input type="text" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Production Team" className="w-full h-11 rounded-lg border border-[#252a33] bg-[#14181e] px-4 text-sm text-[#dbe1eb] focus:outline-none" required />
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Shared Monitors</label>
                  <span className="text-xs text-[#8d94a0]">{workspaceMonitorIds.length} selected</span>
                </div>
                {workspaceMonitorsLoading ? (
                  <div className="rounded-lg border border-[#252a33] bg-[#14181e] px-4 py-8 text-center text-sm text-[#8d94a0]">Loading monitors...</div>
                ) : workspaceMonitors.length === 0 ? (
                  <div className="rounded-lg border border-[#252a33] bg-[#14181e] px-4 py-8 text-center text-sm text-[#8d94a0]">No parent monitors found yet. Add monitors from the dashboard first.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[360px] overflow-y-auto pr-1">
                    {workspaceMonitors.map((monitor) => {
                      const checked = workspaceMonitorIds.includes(monitor.id);
                      return (
                        <label key={monitor.id} className={`rounded-lg border px-4 py-4 flex items-start gap-3 cursor-pointer ${checked ? "border-white/15 bg-[#191d25]" : "border-[#252a33] bg-[#14181e]"}`}>
                          <input type="checkbox" checked={checked} onChange={(event) => setWorkspaceMonitorIds((current) => event.target.checked ? [...new Set([...current, monitor.id])] : current.filter((value) => value !== monitor.id))} className="mt-1 h-4 w-4 accent-white" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#edf2fb]">{monitor.name}</p>
                            <p className="mt-1 text-xs text-[#8d94a0] break-all">{monitor.url}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button type="button" onClick={() => { setShowWorkspaceCreator(false); setWorkspaceName(""); setWorkspaceMonitorIds([]); }} className="h-10 px-4 rounded-lg border border-[#252a33] bg-[#14181e] text-sm">Cancel</button>
                <button type="submit" disabled={submitting || workspaceMonitorIds.length === 0} className="h-10 px-5 rounded-lg bg-white text-black text-sm font-semibold disabled:opacity-50">
                  {submitting ? "Creating..." : "Create Workspace"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[#0f1217] border border-[#3a2020] rounded-xl p-6 max-w-md w-full space-y-5 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-lg bg-red-500/10 border border-red-500/20 grid place-items-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-300" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Delete "{workspace?.name}"?</h2>
                <p className="text-sm text-[#9aa2b1] mt-2 leading-6">The shared workspace will be removed, but linked monitors remain available in your personal workspace.</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button type="button" onClick={() => setShowDeleteConfirm(false)} className="h-10 px-5 rounded-lg border border-[#252a33] bg-[#14181e] text-sm">Cancel</button>
              <button type="button" onClick={handleDeleteWorkspace} disabled={submitting} className="h-10 px-5 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 text-sm font-semibold disabled:opacity-50">
                {submitting ? "Deleting..." : "Delete Workspace"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role, small = false }) {
  const config = ROLE_CONFIG[role] || ROLE_CONFIG.member;
  const Icon = config.icon;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${small ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"} ${config.badge}`}><Icon className={small ? "w-3 h-3" : "w-3.5 h-3.5"} />{config.label}</span>;
}

function WorkspaceTypePill({ type }) {
  const isTeam = type === "team";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] ${isTeam ? "border-violet-400/20 bg-violet-400/10 text-violet-200" : "border-cyan-400/20 bg-cyan-400/10 text-cyan-200"}`}>{isTeam ? "Team" : "Personal"}</span>;
}

function InfoCard({ label, value, helper }) {
  return <div className="rounded-lg border border-[#252a33] bg-[#14181e] px-4 py-4"><p className="text-[10px] uppercase tracking-[0.08em] text-[#8d94a0]">{label}</p><p className="mt-2 text-lg font-semibold text-white">{value}</p><p className="mt-1 text-xs text-[#6f7785]">{helper}</p></div>;
}

function GuidePoint({ text }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-300 shrink-0">
        <Check className="w-3 h-3" />
      </span>
      <p className="text-xs leading-5 text-[#9aa2b1]">{text}</p>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
