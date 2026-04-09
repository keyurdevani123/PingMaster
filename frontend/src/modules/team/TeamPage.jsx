import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Globe,
  LayoutGrid,
  Mail,
  RefreshCw,
  Shield,
  Siren,
  Trash2,
  UserCog,
  Users,
  X,
  ChevronDown,
  Plus,
  Crown,
  Settings,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  acceptTeamInvite,
  createTeamWorkspace,
  createTeamInvite,
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
  owner:  { label: "Owner",  color: "bg-blue-500/15 text-blue-400 border border-blue-500/30",   icon: Crown },
  admin:  { label: "Admin",  color: "bg-purple-500/15 text-purple-400 border border-purple-500/30", icon: Shield },
  member: { label: "Member", color: "bg-green-500/15 text-green-400 border border-green-500/30",  icon: Users },
};

const ROLE_PERMISSIONS = [
  { action: "View monitors & dashboard",      owner: true,  admin: true,  member: true  },
  { action: "Manually ping monitors",         owner: true,  admin: true,  member: true  },
  { action: "Add & delete monitors",          owner: true,  admin: true,  member: false },
  { action: "Manage alert channels",          owner: true,  admin: true,  member: false },
  { action: "Create & comment on incidents",  owner: true,  admin: true,  member: true  },
  { action: "Resolve & reopen incidents",     owner: true,  admin: true,  member: false },
  { action: "Invite team members",            owner: true,  admin: false, member: false },
  { action: "Change member roles",            owner: true,  admin: false, member: false },
  { action: "Remove members",                 owner: true,  admin: false, member: false },
  { action: "Delete workspace",              owner: true,  admin: false, member: false },
];

export default function TeamPage() {
  const { user, logout, workspace, workspaces, currentMembershipRole, selectWorkspace } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteId = searchParams.get("invite") || "";

  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingRemoveMemberId, setPendingRemoveMemberId] = useState(null);
  const [roleChanging, setRoleChanging] = useState({});

  const isOwner = currentMembershipRole === "owner";
  const isAdmin = currentMembershipRole === "admin";
  const isTeamWorkspace = workspace?.type === "team";
  const canCreateTeamWorkspace = isOwner && !isTeamWorkspace;
  const canInvite = isOwner && isTeamWorkspace;
  const canDelete = isOwner && isTeamWorkspace && (workspace?.memberCount ?? 2) <= 1;

  const loadTeamData = useCallback(async ({ silent = false } = {}) => {
    if (!user || !workspace?.id) return;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [memberItems, inviteItems] = await Promise.all([
        fetchTeamMembers(user),
        fetchTeamInvites(user),
      ]);
      setMembers(Array.isArray(memberItems) ? memberItems : []);
      setInvites(Array.isArray(inviteItems) ? inviteItems : []);
    } catch (err) {
      setError(err?.message || "Could not load workspace members.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, workspace?.id]);

  useEffect(() => { loadTeamData(); }, [loadTeamData]);

  const loadWorkspaceMonitors = useCallback(async () => {
    if (!user) return;
    setWorkspaceMonitorsLoading(true);
    try {
      const personalId = workspaces.find((w) => w.type === "personal")?.id || "";
      const monitorItems = await fetchMonitors(user, { workspaceId: personalId });
      setWorkspaceMonitors(Array.isArray(monitorItems) ? monitorItems.filter((item) => item.type !== "child") : []);
    } catch (err) {
      setError(err?.message || "Could not load monitors for workspace creation.");
    } finally {
      setWorkspaceMonitorsLoading(false);
    }
  }, [user, workspaces]);

  const activeInvites = useMemo(() => invites.filter((invite) => invite.status === "pending"), [invites]);

  async function handleSendInvite(event) {
    event.preventDefault();
    if (!inviteEmail.trim()) return;
    setSubmitting(true);
    setError(""); setSuccess("");
    try {
      const result = await createTeamInvite(user, inviteEmail.trim());
      setInviteEmail("");
      setSuccess(result?.delivery?.providerResponse || "Invite sent.");
      if (result?.invite?.id) {
        setInvites((current) => {
          const next = [result.invite, ...current.filter((item) => item.id !== result.invite.id)];
          next.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
          return next;
        });
      }
    } catch (err) {
      setError(err?.message || "Could not send invite.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevokeInvite(inviteIdToRevoke) {
    setSubmitting(true); setError("");
    try {
      const revokedInvite = await revokeTeamInvite(user, inviteIdToRevoke);
      setInvites((current) => current.map((item) => (item.id === inviteIdToRevoke ? { ...item, ...revokedInvite } : item)));
    } catch (err) {
      setError(err?.message || "Could not revoke invite.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAcceptInvite() {
    if (!inviteId) return;
    setAccepting(true); setError(""); setSuccess("");
    try {
      const result = await acceptTeamInvite(user, inviteId);
      if (result?.workspace?.id) await selectWorkspace(result.workspace.id);
      setSuccess("Invite accepted. This workspace is now available in your team list.");
      setSearchParams({});
      await loadTeamData({ silent: true });
    } catch (err) {
      setError(err?.message || "Could not accept invite.");
    } finally {
      setAccepting(false);
    }
  }

  async function handleLeaveWorkspace() {
    setSubmitting(true); setError("");
    try {
      await leaveTeamWorkspace(user);
      const fallbackWorkspace = workspaces.find((item) => item.id !== workspace?.id);
      if (fallbackWorkspace?.id) await selectWorkspace(fallbackWorkspace.id);
      setSuccess("You left the workspace.");
    } catch (err) {
      setError(err?.message || "Could not leave this workspace.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteWorkspace() {
    setSubmitting(true); setError(""); setShowDeleteConfirm(false);
    try {
      const result = await deleteTeamWorkspace(user);
      const personalWorkspace = workspaces.find((item) => item.type === "personal" || item.id === result?.restoredToWorkspaceId);
      if (personalWorkspace?.id) await selectWorkspace(personalWorkspace.id);
      setSuccess("Workspace deleted. Monitors restored to your personal workspace.");
    } catch (err) {
      setError(err?.message || "Could not delete workspace.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveMember(targetUserId) {
    setSubmitting(true); setError(""); setPendingRemoveMemberId(null);
    try {
      await removeTeamMember(user, targetUserId);
      setMembers((current) => current.filter((m) => m.userId !== targetUserId));
      setSuccess("Member removed from workspace.");
    } catch (err) {
      setError(err?.message || "Could not remove member.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(targetUserId, newRole) {
    setRoleChanging((prev) => ({ ...prev, [targetUserId]: true }));
    setError(""); setSuccess("");
    try {
      await updateMemberRole(user, targetUserId, newRole);
      setMembers((current) =>
        current.map((m) => (m.userId === targetUserId ? { ...m, role: newRole } : m))
      );
      setSuccess(`Role updated to ${ROLE_CONFIG[newRole]?.label || newRole}.`);
    } catch (err) {
      setError(err?.message || "Could not update role.");
    } finally {
      setRoleChanging((prev) => ({ ...prev, [targetUserId]: false }));
    }
  }

  async function handleCreateWorkspace(event) {
    event.preventDefault();
    if (!canCreateTeamWorkspace) return;
    setSubmitting(true); setError(""); setSuccess("");
    try {
      const result = await createTeamWorkspace(user, { name: workspaceName.trim(), monitorIds: workspaceMonitorIds });
      setWorkspaceName(""); setWorkspaceMonitorIds([]); setShowWorkspaceCreator(false);
      setSuccess(`Created "${result?.workspace?.name || "team workspace"}". Invite members to begin collaborating.`);
      if (result?.workspace?.id) await selectWorkspace(result.workspace.id);
    } catch (err) {
      setError(err?.message || "Could not create team workspace.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08090b] text-[#f2f2f2] grid place-items-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-white/10 border-t-white/60 rounded-full animate-spin mx-auto" />
          <p className="text-[#8d94a0] text-sm">Loading team workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#08090b] text-[#f2f2f2] flex overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="hidden md:flex w-60 h-screen sticky top-0 overflow-hidden flex-col border-r border-[#1a1d24] bg-[#0c0e12]">
        <div className="px-5 py-6 border-b border-[#1a1d24]">
          <h1 className="text-xl font-bold tracking-tight text-white">PingMaster</h1>
          <p className="text-[10px] uppercase tracking-[0.15em] text-[#8d94a0] mt-1">Workspace</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <SidebarItem Icon={LayoutGrid} label="Dashboard"   onClick={() => navigate("/dashboard")} />
          <SidebarItem Icon={AlertTriangle} label="Incidents" onClick={() => navigate("/incidents")} />
          <SidebarItem Icon={Siren}       label="Alerts"     onClick={() => navigate("/alerts")} />
          <SidebarItem Icon={Globe}       label="Status Page" onClick={() => navigate("/status-pages")} />
          <SidebarItem Icon={Users}       label="Team"       active />
        </nav>
        <div className="px-3 py-4 border-t border-[#1a1d24]">
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#9aa2b1] hover:bg-[#161a21] hover:text-[#e1e7f2] transition"
          >
            <Settings className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {/* Header */}
        <header className="sticky top-0 z-20 border-b border-[#1a1d24] bg-[#0d0f13]/90 backdrop-blur-md px-6 md:px-8 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">
                {isTeamWorkspace ? "Team Workspace" : "Personal Workspace"}
              </p>
              {isTeamWorkspace && (
                <RoleBadge role={currentMembershipRole} small />
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight mt-0.5 text-white">{workspace?.name || "Workspace"}</h1>
          </div>
          <button
            type="button"
            onClick={() => loadTeamData({ silent: true })}
            disabled={refreshing}
            className="h-9 px-4 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm inline-flex items-center gap-2 disabled:opacity-50 transition hover:bg-[#1a1e27]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </header>

        <div className="max-w-6xl mx-auto px-6 md:px-8 py-8 space-y-6">
          {/* ── Invite Banner ── */}
          {inviteId && (
            <section className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.08em] text-blue-400 font-medium">Invitation</p>
                <h2 className="text-lg font-semibold text-white mt-1">Accept workspace invite</h2>
                <p className="text-sm text-[#b9c8e6] mt-1">Sign in with the invited email address and click accept to join as a member.</p>
              </div>
              <button
                type="button"
                onClick={handleAcceptInvite}
                disabled={accepting}
                className="h-10 px-5 rounded-xl bg-white text-black text-sm font-semibold disabled:opacity-50 transition hover:bg-[#e2e8f0] shrink-0"
              >
                {accepting ? "Accepting..." : "Accept Invitation"}
              </button>
            </section>
          )}

          {/* ── Alerts ── */}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
              <X className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              {success}
            </div>
          )}

          {/* ── Workspace Overview ── */}
          <section className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-6">
            <div className="bg-[#0f1217] border border-[#1e2330] rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0] font-medium">Current Workspace</p>
                <span className="text-xs text-[#8d94a0]">{workspace?.type === "team" ? "Team" : "Personal"}</span>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{workspace?.name}</p>
                <p className="text-sm text-[#8d94a0] mt-1">ID: <span className="font-mono text-xs text-[#6f7785]">{workspace?.id}</span></p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Your Role" value={ROLE_CONFIG[currentMembershipRole]?.label || currentMembershipRole} colored={currentMembershipRole} />
                <StatCard label="Members" value={String(workspace?.memberCount ?? members.length)} />
              </div>

              {/* Switch Workspace */}
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Switch Workspace</p>
                <div className="relative">
                  <select
                    value={workspace?.id || ""}
                    onChange={(event) => selectWorkspace(event.target.value)}
                    className="w-full h-10 bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 pr-9 focus:outline-none appearance-none"
                  >
                    {workspaces.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} {item.currentRole === "owner" ? "(Owner" : "(Member"}{item.type === "team" ? " · Team)" : ")"}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-[#6f7785] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Leave / Delete */}
              {!isOwner && (
                <button
                  type="button"
                  onClick={handleLeaveWorkspace}
                  disabled={submitting}
                  className="h-9 px-4 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 text-sm font-medium disabled:opacity-50 transition hover:bg-red-500/10"
                >
                  {submitting ? "Leaving..." : "Leave Workspace"}
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="h-9 px-4 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 text-sm font-medium inline-flex items-center gap-2 transition hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Workspace
                </button>
              )}
              {isOwner && isTeamWorkspace && !canDelete && (
                <p className="text-xs text-[#6f7785] bg-[#11151c] border border-[#1e2330] rounded-lg px-3 py-2">
                  You can only delete the workspace when you are the sole remaining member.
                </p>
              )}
            </div>

            {/* ── Role Permission Matrix ── */}
            <div className="bg-[#0f1217] border border-[#1e2330] rounded-2xl p-6 space-y-4">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0] font-medium">Role Permissions</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left text-[11px] uppercase tracking-[0.08em] text-[#8d94a0] pb-3 font-medium">Action</th>
                      {["owner", "admin", "member"].map((role) => (
                        <th key={role} className="text-center pb-3">
                          <RoleBadge role={role} small />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1d24]">
                    {ROLE_PERMISSIONS.map((row) => (
                      <tr key={row.action}>
                        <td className="py-2.5 pr-4 text-[#aeb7c5] text-xs">{row.action}</td>
                        {["owner", "admin", "member"].map((role) => (
                          <td key={role} className="py-2.5 text-center">
                            <span className={row[role] ? "text-emerald-400" : "text-[#3a3f4b]"}>
                              {row[role] ? "✓" : "–"}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── Create Team Workspace ── */}
          {canCreateTeamWorkspace && (
            <section className="bg-[#0f1217] border border-[#1e2330] rounded-2xl p-6 space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0] font-medium">Step 1</p>
                  <h2 className="text-xl font-semibold text-white mt-1">Create a Team Workspace</h2>
                  <p className="text-sm text-[#8d94a0] mt-2">Share monitors with collaborators by creating a dedicated team workspace.</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const next = !showWorkspaceCreator;
                    setShowWorkspaceCreator(next);
                    if (next && workspaceMonitors.length === 0 && !workspaceMonitorsLoading) {
                      await loadWorkspaceMonitors();
                    }
                  }}
                  className="h-9 px-4 rounded-xl bg-white text-black text-sm font-semibold inline-flex items-center gap-2 transition hover:bg-[#e2e8f0] shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  New Workspace
                </button>
              </div>

              {showWorkspaceCreator && (
                <form onSubmit={handleCreateWorkspace} className="space-y-5 pt-2 border-t border-[#1e2330]">
                  <div className="space-y-2">
                    <label className="block text-[11px] uppercase tracking-[0.08em] text-[#8d94a0] font-medium">Workspace Name</label>
                    <input
                      type="text"
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                      placeholder="e.g. Production Team"
                      className="w-full h-11 rounded-xl border border-[#252a33] bg-[#10141b] px-4 text-sm text-[#dbe1eb] focus:outline-none focus:border-[#3a4152] transition"
                      required
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0] font-medium">Monitors to Share</label>
                      <span className="text-xs text-[#8d94a0]">{workspaceMonitorIds.length} selected</span>
                    </div>
                    {workspaceMonitorsLoading ? (
                      <div className="rounded-xl border border-[#252a33] bg-[#10141b] px-4 py-6 text-sm text-[#8d94a0] text-center">Loading monitors...</div>
                    ) : workspaceMonitors.length === 0 ? (
                      <div className="rounded-xl border border-[#252a33] bg-[#10141b] px-4 py-6 text-sm text-[#8d94a0] text-center">No monitors yet. Add some from the dashboard first.</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {workspaceMonitors.map((monitor) => {
                          const checked = workspaceMonitorIds.includes(monitor.id);
                          return (
                            <label
                              key={monitor.id}
                              className={`rounded-xl border px-4 py-3 flex items-start gap-3 cursor-pointer transition ${
                                checked ? "border-white/20 bg-white/5" : "border-[#252a33] bg-[#10141b] hover:border-[#3a4152]"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  setWorkspaceMonitorIds((current) =>
                                    event.target.checked
                                      ? [...new Set([...current, monitor.id])]
                                      : current.filter((value) => value !== monitor.id)
                                  );
                                }}
                                className="mt-1 h-4 w-4 accent-white"
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[#edf2fb]">{monitor.name}</p>
                                <p className="text-xs text-[#8d94a0] mt-0.5 break-all">{monitor.url}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => { setShowWorkspaceCreator(false); setWorkspaceName(""); setWorkspaceMonitorIds([]); }}
                      className="h-10 px-4 rounded-xl border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm transition hover:bg-[#1a1e27]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || workspaceMonitorIds.length === 0}
                      className="h-10 px-5 rounded-xl bg-white text-black text-sm font-semibold disabled:opacity-50 transition hover:bg-[#e2e8f0]"
                    >
                      {submitting ? "Creating..." : "Create Workspace"}
                    </button>
                  </div>
                </form>
              )}

              {/* Existing team workspaces quick-switch */}
              {workspaces.filter((w) => w.type === "team").length > 0 && (
                <div className="pt-4 border-t border-[#1e2330]">
                  <p className="text-xs text-[#7f8793] mb-3">Your team workspaces:</p>
                  <div className="flex flex-wrap gap-2">
                    {workspaces.filter((w) => w.type === "team").map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => selectWorkspace(w.id)}
                        className={`h-8 px-3 rounded-lg border text-sm transition ${
                          w.id === workspace?.id
                            ? "border-white/20 bg-white/5 text-white"
                            : "border-[#252a33] bg-[#12161d] text-[#c9d1dd] hover:border-[#3a4152]"
                        }`}
                      >
                        {w.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── Invite Members ── */}
          {canInvite && (
            <section className="bg-[#0f1217] border border-[#1e2330] rounded-2xl p-6 space-y-5">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0] font-medium">Step 2</p>
                <h2 className="text-xl font-semibold text-white mt-1">Invite Team Members</h2>
                <p className="text-sm text-[#8d94a0] mt-1">
                  Send an email invite to join <span className="text-[#c9d1dd] font-medium">{workspace?.name}</span>. They join as <RoleBadge role="member" small inline />.
                </p>
              </div>
              <form onSubmit={handleSendInvite} className="flex gap-3">
                <div className="flex-1 flex items-center gap-2 rounded-xl border border-[#252a33] bg-[#10141b] px-4 focus-within:border-[#3a4152] transition">
                  <Mail className="w-4 h-4 text-[#7e8796] shrink-0" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="teammate@example.com"
                    className="flex-1 h-11 bg-transparent text-sm text-[#dbe1eb] placeholder:text-[#6f7785] focus:outline-none"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-11 px-5 rounded-xl bg-white text-black text-sm font-semibold disabled:opacity-50 transition hover:bg-[#e2e8f0] shrink-0"
                >
                  {submitting ? "Sending..." : "Send Invite"}
                </button>
              </form>

              {activeInvites.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[#1e2330]">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0] font-medium">Pending Invites ({activeInvites.length})</p>
                  {activeInvites.map((invite) => (
                    <div key={invite.id} className="rounded-xl border border-[#252a33] bg-[#10141b] px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#edf2fb] break-all">{invite.email}</p>
                        <p className="text-xs text-[#8d94a0] mt-0.5">
                          Expires {invite.expiresAt ? new Date(invite.expiresAt).toLocaleString() : "--"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRevokeInvite(invite.id)}
                        disabled={submitting}
                        className="h-8 px-3 rounded-lg border border-[#303846] bg-[#161a21] text-[#d4dae4] text-xs disabled:opacity-50 transition hover:bg-[#1e2330]"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── Members Table ── */}
          <section className="bg-[#0f1217] border border-[#1e2330] rounded-2xl overflow-hidden">
            <div className="px-6 py-5 flex items-center justify-between gap-3 border-b border-[#1e2330]">
              <div className="flex items-center gap-3">
                <UserCog className="w-5 h-5 text-[#8d94a0]" />
                <div>
                  <h2 className="text-base font-semibold text-white">Workspace Members</h2>
                  <p className="text-xs text-[#8d94a0] mt-0.5">{members.length} {members.length === 1 ? "member" : "members"} in this workspace</p>
                </div>
              </div>
            </div>
            <div className="divide-y divide-[#1a1d24]">
              {members.map((member) => (
                <div key={`${member.workspaceId}:${member.userId}`} className="px-6 py-4 flex items-center gap-4">
                  {/* Avatar */}
                  <div className="h-9 w-9 rounded-full bg-[#1a1e27] border border-[#252a33] grid place-items-center shrink-0 text-sm font-semibold text-[#c9d1dd]">
                    {(member.email || member.userId || "?").charAt(0).toUpperCase()}
                  </div>
                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#edf2fb] break-all">{member.email || member.userId}</p>
                    <p className="text-xs text-[#8d94a0] mt-0.5">
                      Joined {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : "--"}
                    </p>
                  </div>
                  {/* Role badge and controls */}
                  <div className="flex items-center gap-2 shrink-0">
                    <RoleBadge role={member.role} />

                    {/* Role change dropdown — owner only, non-owner targets */}
                    {isOwner && member.role !== "owner" && (
                      <div className="relative">
                        <select
                          value={member.role}
                          disabled={roleChanging[member.userId]}
                          onChange={(e) => handleRoleChange(member.userId, e.target.value)}
                          className="h-8 pl-3 pr-7 rounded-lg border border-[#252a33] bg-[#14181e] text-xs text-[#d4dae4] appearance-none focus:outline-none focus:border-[#3a4152] cursor-pointer disabled:opacity-50 transition"
                        >
                          <option value="admin">Promote to Admin</option>
                          <option value="member">Set as Member</option>
                        </select>
                        <ChevronDown className="w-3 h-3 text-[#6f7785] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    )}

                    {/* Remove button */}
                    {isOwner && member.role !== "owner" && (
                      pendingRemoveMemberId === member.userId ? (
                        <div className="flex items-center gap-2 animate-fade-in">
                          <span className="text-xs text-[#f6b5a8]">Remove?</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(member.userId)}
                            disabled={submitting}
                            className="h-8 px-3 rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 text-xs font-semibold disabled:opacity-50 transition hover:bg-red-500/25"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingRemoveMemberId(null)}
                            className="h-8 w-8 rounded-lg border border-[#252a33] bg-[#14181e] grid place-items-center transition hover:bg-[#1a1e27]"
                          >
                            <X className="w-3.5 h-3.5 text-[#8d94a0]" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingRemoveMemberId(member.userId)}
                          className="h-8 w-8 rounded-lg border border-[#252a33] bg-[#14181e] grid place-items-center transition hover:bg-red-500/10 hover:border-red-500/20 group"
                          title="Remove member"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-[#8d94a0] group-hover:text-red-400" />
                        </button>
                      )
                    )}
                  </div>
                </div>
              ))}
              {members.length === 0 && (
                <div className="px-6 py-12 text-center">
                  <Users className="w-8 h-8 text-[#3a4152] mx-auto mb-3" />
                  <p className="text-sm text-[#8d94a0]">No members yet. Invite your team to get started.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* ── Delete Confirmation Modal ── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f1217] border border-[#3a2020] rounded-2xl p-6 max-w-md w-full space-y-5 animate-fade-in shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 grid place-items-center shrink-0">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Delete "{workspace?.name}"?</h2>
                <p className="text-sm text-[#9aa2b1] mt-2 leading-6">
                  All monitors, incidents, and maintenance windows will be moved back to your personal workspace. This workspace will be permanently removed and cannot be recovered.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="h-10 px-5 rounded-xl border border-[#252a33] bg-[#14181e] text-sm text-[#d4dae4] transition hover:bg-[#1a1e27]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteWorkspace}
                disabled={submitting}
                className="h-10 px-5 rounded-xl bg-red-500/15 text-red-400 border border-red-500/30 text-sm font-semibold disabled:opacity-50 transition hover:bg-red-500/25"
              >
                {submitting ? "Deleting..." : "Delete Workspace"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role, small = false, inline = false }) {
  const config = ROLE_CONFIG[role] || ROLE_CONFIG.member;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ${
      small ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1"
    } ${config.color} ${inline ? "inline" : ""}`}>
      <Icon className={small ? "w-2.5 h-2.5" : "w-3 h-3"} />
      {config.label}
    </span>
  );
}

function StatCard({ label, value, colored }) {
  const roleConfig = colored ? ROLE_CONFIG[colored] : null;
  return (
    <div className="rounded-xl border border-[#1e2330] bg-[#10141b] px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.08em] text-[#8d94a0] font-medium">{label}</p>
      <p className={`text-base font-bold mt-1 ${roleConfig ? roleConfig.color.split(" ").find(c => c.startsWith("text-")) : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

function SidebarItem({ Icon, label, active = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
        active ? "bg-white/5 text-white border border-white/10" : "text-[#9aa2b1] hover:bg-[#161a21] hover:text-[#e1e7f2]"
      }`}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}
