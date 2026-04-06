import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Globe, LayoutGrid, Mail, RefreshCw, Siren, Users } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  acceptTeamInvite,
  createTeamWorkspace,
  createTeamInvite,
  fetchMonitors,
  fetchTeamInvites,
  fetchTeamMembers,
  leaveTeamWorkspace,
  revokeTeamInvite,
} from "../../api";

export default function TeamPage() {
  const {
    user,
    logout,
    workspace,
    workspaces,
    currentMembershipRole,
    selectWorkspace,
  } = useAuth();
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

  const isOwner = currentMembershipRole === "owner";
  const canCreateTeamWorkspace = isOwner && workspace?.type === "personal";

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

  useEffect(() => {
    loadTeamData();
  }, [loadTeamData]);

  const loadWorkspaceMonitors = useCallback(async () => {
    if (!user || !canCreateTeamWorkspace) return;
    setWorkspaceMonitorsLoading(true);
    try {
      const monitorItems = await fetchMonitors(user);
      setWorkspaceMonitors(Array.isArray(monitorItems) ? monitorItems.filter((item) => item.type !== "child") : []);
    } catch (err) {
      setError(err?.message || "Could not load monitors for workspace creation.");
    } finally {
      setWorkspaceMonitorsLoading(false);
    }
  }, [canCreateTeamWorkspace, user]);

  const activeInvites = useMemo(
    () => invites.filter((invite) => invite.status === "pending"),
    [invites]
  );

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
    setSubmitting(true);
    setError("");
    try {
      const revokedInvite = await revokeTeamInvite(user, inviteIdToRevoke);
      setInvites((current) =>
        current.map((item) => (item.id === inviteIdToRevoke ? { ...item, ...revokedInvite } : item))
      );
    } catch (err) {
      setError(err?.message || "Could not revoke invite.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAcceptInvite() {
    if (!inviteId) return;
    setAccepting(true);
    setError("");
    setSuccess("");
    try {
      const result = await acceptTeamInvite(user, inviteId);
      if (result?.workspace?.id) {
        await selectWorkspace(result.workspace.id);
      }
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
    setSubmitting(true);
    setError("");
    try {
      await leaveTeamWorkspace(user);
      const fallbackWorkspace = workspaces.find((item) => item.id !== workspace?.id);
      if (fallbackWorkspace?.id) {
        await selectWorkspace(fallbackWorkspace.id);
      }
      setSuccess("You left the workspace.");
    } catch (err) {
      setError(err?.message || "Could not leave this workspace.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateWorkspace(event) {
    event.preventDefault();
    if (!canCreateTeamWorkspace) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const result = await createTeamWorkspace(user, {
        name: workspaceName.trim(),
        monitorIds: workspaceMonitorIds,
      });
      setWorkspaceName("");
      setWorkspaceMonitorIds([]);
      setShowWorkspaceCreator(false);
      setSuccess(`Created ${result?.workspace?.name || "team workspace"} and moved the selected monitors into it.`);
      if (result?.workspace?.id) {
        await selectWorkspace(result.workspace.id);
      }
    } catch (err) {
      setError(err?.message || "Could not create team workspace.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08090b] text-[#f2f2f2] grid place-items-center">
        <p className="text-[#8d94a0]">Loading team workspace...</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#08090b] text-[#f2f2f2] flex overflow-hidden">
      <aside className="hidden md:flex w-64 h-screen sticky top-0 overflow-hidden flex-col border-r border-[#22252b] bg-[#0f1114]">
        <div className="px-5 py-6 border-b border-[#22252b]">
          <h1 className="text-xl font-semibold tracking-tight">PingMaster</h1>
          <p className="text-[11px] uppercase tracking-[0.09em] text-[#8d94a0] mt-1">Workspace Team</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <SidebarItem Icon={LayoutGrid} label="Dashboard" onClick={() => navigate("/dashboard")} />
          <SidebarItem Icon={AlertTriangle} label="Incidents" onClick={() => navigate("/incidents")} />
          <SidebarItem Icon={Siren} label="Alerts" onClick={() => navigate("/alerts")} />
          <SidebarItem Icon={Globe} label="Status Page" onClick={() => navigate("/status-pages")} />
          <SidebarItem Icon={Users} label="Team" active />
        </nav>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <header className="sticky top-0 z-20 border-b border-[#22252b] bg-[#0d0f13] px-5 md:px-8 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Team Collaboration</p>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mt-1">{workspace?.name || "Workspace team"}</h1>
            <p className="text-sm text-[#8d94a0] mt-1">
              Roles stay simple: owners manage members and incidents, while members help operate shared monitors, alerts, and status pages.
            </p>
          </div>
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => loadTeamData({ silent: true })}
              disabled={refreshing}
              className="h-10 px-3 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              onClick={logout}
              className="h-10 px-3 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm"
            >
              Logout
            </button>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-5 md:px-8 py-6 space-y-5">
          {inviteId ? (
            <section className="rounded-xl border border-[#30466f] bg-[#101826] p-4 md:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#7fa7ff]">Invitation</p>
                <h2 className="text-lg font-semibold text-[#edf2fb] mt-2">Accept workspace invite</h2>
                <p className="text-sm text-[#b9c8e6] mt-1">
                  Sign in with the invited email address, then accept to join this team as a member.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAcceptInvite}
                disabled={accepting}
                className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold disabled:opacity-50"
              >
                {accepting ? "Accepting..." : "Accept Invitation"}
              </button>
            </section>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {success}
            </div>
          ) : null}

          <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
            <WorkspaceCard
              workspace={workspace}
              workspaces={workspaces}
              currentMembershipRole={currentMembershipRole}
              onSelectWorkspace={selectWorkspace}
              canLeave={!isOwner}
              leaving={submitting}
              onLeaveWorkspace={handleLeaveWorkspace}
            />

            <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5 space-y-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Access Model</p>
                <h2 className="text-xl font-medium text-[#edf2fb] mt-2">What is shared in this workspace</h2>
              </div>
              <ul className="space-y-3 text-sm text-[#aeb7c5] leading-6">
                <li>Monitors, alerts, incidents, and status pages belong to the workspace, not to one person.</li>
                <li>The owner can invite members, create incidents, and resolve or reopen incidents.</li>
                <li>Members can still work on shared monitors and add incident responses without losing visibility.</li>
                <li>Assignments show responsibility only. They do not remove access for anyone else in the workspace.</li>
              </ul>
            </section>
          </section>

          {canCreateTeamWorkspace ? (
            <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Create Team Workspace</p>
                  <h2 className="text-xl font-medium text-[#edf2fb] mt-2">Choose which monitors will be shared</h2>
                  <p className="text-sm text-[#8d94a0] mt-2 max-w-3xl">
                    Team workspaces are created from your personal workspace. The selected monitors are moved into the new team workspace so incidents, alerts, and status pages stay scoped correctly.
                  </p>
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
                  className="h-10 px-4 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm shrink-0"
                >
                  {showWorkspaceCreator ? "Hide" : "Create Workspace"}
                </button>
              </div>

              {showWorkspaceCreator ? (
                <form onSubmit={handleCreateWorkspace} className="space-y-4">
                  <label className="block space-y-2">
                    <span className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Workspace Name</span>
                    <input
                      type="text"
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                      placeholder="Example: Production Team"
                      className="w-full h-11 rounded-lg border border-[#252a33] bg-[#10141b] px-3 text-sm text-[#dbe1eb] focus:outline-none"
                      required
                    />
                  </label>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Monitors To Share</span>
                      <span className="text-xs text-[#8d94a0]">
                        {workspaceMonitorIds.length} selected
                      </span>
                    </div>

                    {workspaceMonitorsLoading ? (
                      <div className="rounded-xl border border-[#252a33] bg-[#10141b] px-4 py-6 text-sm text-[#8d94a0]">
                        Loading personal workspace monitors...
                      </div>
                    ) : workspaceMonitors.length === 0 ? (
                      <div className="rounded-xl border border-[#252a33] bg-[#10141b] px-4 py-6 text-sm text-[#8d94a0]">
                        No parent monitors are available in this workspace yet.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {workspaceMonitors.map((monitor) => {
                          const checked = workspaceMonitorIds.includes(monitor.id);
                          return (
                            <label key={monitor.id} className="rounded-xl border border-[#252a33] bg-[#10141b] px-4 py-3 flex items-start gap-3 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  setWorkspaceMonitorIds((current) => (
                                    event.target.checked
                                      ? [...new Set([...current, monitor.id])]
                                      : current.filter((value) => value !== monitor.id)
                                  ));
                                }}
                                className="mt-1 h-4 w-4"
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[#edf2fb]">{monitor.name}</p>
                                <p className="text-xs text-[#8d94a0] mt-1 break-all">{monitor.url}</p>
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
                      onClick={() => {
                        setShowWorkspaceCreator(false);
                        setWorkspaceName("");
                        setWorkspaceMonitorIds([]);
                      }}
                      className="h-10 px-4 rounded-lg border border-[#252a33] bg-[#14181e] text-[#d4dae4] text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || workspaceMonitorIds.length === 0}
                      className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold disabled:opacity-50"
                    >
                      {submitting ? "Creating..." : "Create Team Workspace"}
                    </button>
                  </div>
                </form>
              ) : null}
            </section>
          ) : null}

          <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-5">
            <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Members</p>
                  <h2 className="text-xl font-medium text-[#edf2fb] mt-2">Workspace people</h2>
                </div>
                <span className="rounded-full border border-[#283041] bg-[#121822] px-3 py-1 text-xs text-[#bbc5d6]">
                  {members.length} active
                </span>
              </div>

              <div className="mt-5 space-y-3">
                {members.map((member) => (
                  <div key={`${member.workspaceId}:${member.userId}`} className="rounded-xl border border-[#252a33] bg-[#10141b] px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#edf2fb] break-all">{member.email || member.userId}</p>
                      <p className="text-xs text-[#8d94a0] mt-1">
                        Joined {member.joinedAt ? new Date(member.joinedAt).toLocaleString() : "--"}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs ${member.role === "owner" ? "bg-[#1a273f] text-[#bdd0ff]" : "bg-[#16281f] text-[#9de9be]"}`}>
                      {member.role === "owner" ? "Owner" : "Member"}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5 space-y-5">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Invites</p>
                <h2 className="text-xl font-medium text-[#edf2fb] mt-2">Email invitations</h2>
              </div>

              {isOwner ? (
                <form onSubmit={handleSendInvite} className="space-y-3">
                  <label className="block space-y-2">
                    <span className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Invite Member</span>
                    <div className="flex items-center gap-2 rounded-xl border border-[#252a33] bg-[#10141b] px-3">
                      <Mail className="w-4 h-4 text-[#7e8796]" />
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="teammate@example.com"
                        className="w-full h-11 bg-transparent text-sm text-[#dbe1eb] placeholder:text-[#6f7785] focus:outline-none"
                        required
                      />
                    </div>
                  </label>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold disabled:opacity-50"
                  >
                    {submitting ? "Sending..." : "Send Invite"}
                  </button>
                </form>
              ) : (
                <div className="rounded-xl border border-[#252a33] bg-[#10141b] px-4 py-3 text-sm text-[#9aa6b8]">
                  Only workspace owners can invite new members.
                </div>
              )}

              <div className="space-y-3">
                {activeInvites.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#313642] bg-[#11151c] px-4 py-6 text-sm text-[#8d94a0]">
                    No pending invites right now.
                  </div>
                ) : (
                  activeInvites.map((invite) => (
                    <div key={invite.id} className="rounded-xl border border-[#252a33] bg-[#10141b] px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#edf2fb] break-all">{invite.email}</p>
                        <p className="text-xs text-[#8d94a0] mt-1">
                          Expires {invite.expiresAt ? new Date(invite.expiresAt).toLocaleString() : "--"}
                        </p>
                      </div>
                      {isOwner ? (
                        <button
                          type="button"
                          onClick={() => handleRevokeInvite(invite.id)}
                          disabled={submitting}
                          className="h-9 px-3 rounded-lg border border-[#303846] bg-[#161a21] text-[#d4dae4] text-sm disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </section>
          </section>
        </div>
      </main>
    </div>
  );
}

function SidebarItem(props) {
  const IconComponent = props.Icon;
  const { label, active = false, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-base transition ${
        active ? "bg-[#181c24] text-[#eff3fa]" : "text-[#9aa2b1] hover:bg-[#161a21] hover:text-[#e1e7f2]"
      }`}
    >
      <IconComponent className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}

function WorkspaceCard({
  workspace,
  workspaces,
  currentMembershipRole,
  onSelectWorkspace,
  canLeave,
  leaving,
  onLeaveWorkspace,
}) {
  return (
    <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5 space-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Current Workspace</p>
        <h2 className="text-xl font-medium text-[#edf2fb] mt-2">{workspace?.name || "My Workspace"}</h2>
      </div>

      <InfoRow label="Workspace ID" value={workspace?.id || "--"} />
      <InfoRow label="Workspace Slug" value={workspace?.slug || "--"} />
      <InfoRow label="Your Role" value={currentMembershipRole === "owner" ? "Owner" : "Member"} />

      <label className="block space-y-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Switch Workspace</span>
        <select
          value={workspace?.id || ""}
          onChange={(event) => onSelectWorkspace(event.target.value)}
          className="w-full h-11 bg-[#14181e] border border-[#252a33] text-sm text-[#dbe1eb] rounded-lg px-3 focus:outline-none"
        >
          {workspaces.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.currentRole === "owner" ? "Owner" : "Member"})
            </option>
          ))}
        </select>
      </label>

      {canLeave ? (
        <button
          type="button"
          onClick={onLeaveWorkspace}
          disabled={leaving}
          className="h-10 px-4 rounded-lg border border-[#3a2a2a] bg-[#1a1212] text-[#f2c4c4] text-sm disabled:opacity-50"
        >
          {leaving ? "Leaving..." : "Leave Workspace"}
        </button>
      ) : (
        <div className="rounded-xl border border-[#252a33] bg-[#10141b] px-4 py-3 text-sm text-[#9aa6b8]">
          Workspace owners stay attached to the workspace. Members can leave from this page.
        </div>
      )}
    </section>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="rounded-xl border border-[#252a33] bg-[#10141b] px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">{label}</p>
      <p className="text-sm text-[#dbe2ee] mt-2 break-all">{value}</p>
    </div>
  );
}
