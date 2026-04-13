import { NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { LayoutGrid, AlertTriangle, Siren, Globe, Users, CreditCard, LogOut, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const NAV_ITEMS = [
  { to: "/dashboard",    Icon: LayoutGrid,   label: "Dashboard"   },
  { to: "/incidents",    Icon: AlertTriangle, label: "Incidents"   },
  { to: "/alerts",       Icon: Siren,         label: "Alerts"      },
  { to: "/status-pages", Icon: Globe,         label: "Status Pages" },
  { to: "/workspaces",   Icon: Users,         label: "Workspaces"   },
  { to: "/billing",      Icon: CreditCard,    label: "Billing"      },
];

export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);

  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const initials = displayName.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="h-screen bg-[#08090b] text-[#f2f2f2] flex overflow-hidden">
      {/* ── Sidebar ─────────────────────────────── */}
      <aside className="hidden md:flex w-65 h-screen sticky top-0 flex-col border-r border-[#1a1d24] bg-[#0c0e12] shrink-0">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-[#1a1d24]">
          <h1 className="text-[15px] font-bold tracking-tight text-white">PingMaster</h1>
          <p className="text-[12px] text-[#6b7280] mt-0.5">Website Reliability</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ to, Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-[17px] font-medium transition-colors ${
                  isActive
                    ? "bg-white/5 text-white border border-white/8"
                    : "text-[#8b93a5] hover:bg-[#13161e] hover:text-[#d1d8e6]"
                }`
              }
            >
              <Icon className="w-[16px] h-[16px] shrink-0" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom: user + logout */}
        <div className="px-3 py-4 border-t border-[#1a1d24] space-y-0.5">
          {/* Profile row — clickable */}
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[#13161e] transition-colors text-left"
          >
            <div className="w-8 h-8 rounded-full bg-[#1e2330] border border-[#2a3050] grid place-items-center text-[13px] font-semibold text-[#c9d1dd] shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[#d1d8e6] truncate leading-tight">{displayName}</p>
              <p className="text-[11px] text-[#6b7280] truncate leading-tight mt-0.5">View profile</p>
            </div>
          </button>

          {/* Logout */}
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium text-[#8b93a5] hover:bg-[#1a0e0e] hover:text-red-400 transition-colors group"
          >
            <LogOut className="w-4 h-4 shrink-0 group-hover:text-red-400 transition-colors" />
            Logout
          </button>
        </div>
      </aside>

      {/* ── Content area ────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>

      {/* ── Profile modal ───────────────────────── */}
      {profileOpen && (
        <ProfileModal
          user={user}
          initials={initials}
          displayName={displayName}
          onClose={() => setProfileOpen(false)}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}

function ProfileModal({ user, initials, displayName, onClose, onLogout }) {
  const provider = user?.providerData?.[0]?.providerId === "google.com" ? "Google" : "Email / Password";
  const joined = user?.metadata?.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#111111] border border-[#222222] rounded-2xl w-full max-w-[340px] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header row */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#1e2330] border border-[#2a3050] grid place-items-center text-[14px] font-semibold text-white">
              {initials}
            </div>
            <div>
              <p className="text-[14px] font-semibold text-white">{displayName}</p>
              <p className="text-[12px] text-[#666666]">{user?.email || "—"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] grid place-items-center text-[#666666] hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Details */}
        <div className="space-y-3 border-t border-[#1e1e1e] pt-4">
          <Row label="Sign-in method" value={provider} />
          <Row label="Member since" value={joined} />
          <Row
            label="Email verified"
            value={
              user?.emailVerified
                ? <span className="text-[#6ee7b7]">Verified</span>
                : <span className="text-[#fbbf24]">Not verified</span>
            }
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-9 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-sm text-[#cccccc] hover:bg-[#222222] transition"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="flex-1 h-9 rounded-lg bg-[#1a0f0f] border border-[#3d1a1a] text-sm text-[#f87171] hover:bg-[#221212] transition"
          >
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-[#666666]">{label}</span>
      <span className="text-[12px] text-[#cccccc]">{value}</span>
    </div>
  );
}
