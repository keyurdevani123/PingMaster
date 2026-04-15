import {
  Activity,
  AlertTriangle,
  BellRing,
  ChevronRight,
  Globe,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const CAPABILITIES = [
  {
    title: "Availability Monitoring",
    description: "Track websites and important endpoints in one dashboard with response status and health context that is easy to review.",
    Icon: Activity,
  },
  {
    title: "Alert Routing",
    description: "Send alerts through the channels you already use, including email, Slack, and Discord.",
    Icon: BellRing,
  },
  {
    title: "Incident Tracking",
    description: "Create incidents, add updates, and keep operational history close to the affected services.",
    Icon: AlertTriangle,
  },
  {
    title: "Status Pages",
    description: "Publish customer-facing status pages for the monitors you choose to expose.",
    Icon: Globe,
  },
  {
    title: "Workspace Sharing",
    description: "Keep your main workspace private and open separate shared workspaces when a team needs access.",
    Icon: Users,
  },
];

const DETAILS = [
  "Track website and endpoint availability without splitting the workflow across separate tools.",
  "Keep incident context, response updates, and public status communication close to the affected service.",
  "Use shared workspaces only for services that need team access, while the rest stays private.",
];

export default function HomePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-[#08090b] text-[#f2f2f2] overflow-x-hidden">
      <header className="sticky top-0 z-50 border-b border-[#1f232b] bg-[#0d0f13]/80 backdrop-blur-md w-full">
        <div className="w-full px-6 md:px-12 py-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">PingMaster</h1>
            <p className="text-[10px] uppercase tracking-[0.15em] text-[#8b93a1] mt-1 font-medium">Website Reliability</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="h-10 px-5 rounded-lg border border-[#2a2f39] text-[#c9d1dd] hover:bg-[#12161d] text-sm font-semibold transition"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => navigate("/signup")}
              className="h-10 px-5 rounded-lg bg-white text-black hover:bg-[#e2e8f0] text-sm font-semibold transition shadow-sm"
            >
              Create Account
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative px-6 md:px-12 py-14 md:py-24 text-center bg-[radial-gradient(circle_at_top,_rgba(140,180,255,0.12),_transparent_58%)]">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-[#b8c1cf] mb-6">
            <ShieldCheck className="w-4 h-4 text-[#7be0b7]" />
            Website monitoring, alerts, incidents, and status updates
          </div>
          <h2 className="max-w-4xl mx-auto text-4xl md:text-[46px] font-bold tracking-tight text-white leading-tight">
            Monitor websites, handle incidents, and keep status communication in one place.
          </h2>
          <p className="mt-6 max-w-3xl mx-auto text-lg leading-relaxed text-[#94a3b8]">
            PingMaster lets you track service availability, send alerts to the channels your team already uses,
            record incident updates, publish public status pages, and create shared workspaces only when collaboration is needed.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            {!loading && user ? (
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="h-14 px-8 rounded-xl bg-white text-black hover:bg-[#e2e8f0] text-base font-semibold inline-flex items-center gap-2 transition hover:-translate-y-1 hover:shadow-lg"
              >
                Open Dashboard
                <ChevronRight className="w-5 h-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate("/signup")}
                className="h-14 px-8 rounded-xl bg-white text-black hover:bg-[#e2e8f0] text-base font-semibold inline-flex items-center gap-2 transition hover:-translate-y-1 hover:shadow-lg"
              >
                Start Monitoring
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </section>

        <section className="px-6 md:px-12 py-12 md:py-16 bg-[#0a0c10] border-y border-white/5">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-10">
              <p className="text-sm uppercase tracking-[0.14em] text-[#64748b]">What You Can Manage</p>
              <h3 className="mt-3 text-3xl font-bold text-white">The core workflow real teams need</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
              {CAPABILITIES.map((item) => (
                <article key={item.title} className="rounded-[24px] border border-white/5 bg-[#0d1016] p-6 transition hover:border-white/10 hover:-translate-y-1 hover:bg-[#11161d]">
                  <div className="h-12 w-12 rounded-2xl bg-white/5 border border-white/10 grid place-items-center">
                    <item.Icon className="w-6 h-6 text-[#9cc0ff]" />
                  </div>
                  <h4 className="mt-6 text-lg font-semibold text-white tracking-tight">{item.title}</h4>
                  <p className="mt-3 text-sm leading-6 text-[#94a3b8]">{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 md:px-12 py-12 md:py-16 bg-[radial-gradient(circle_at_bottom_right,_rgba(90,160,255,0.08),_transparent_46%)]">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-8 items-start">
            <div className="rounded-[28px] border border-[#1d2430] bg-[#0d1016] p-8">
              <p className="text-sm uppercase tracking-[0.14em] text-[#64748b]">Operational Detail</p>
              <h3 className="mt-4 text-3xl font-bold text-white tracking-tight">Built around day-to-day monitoring work</h3>
              <p className="mt-4 text-base leading-7 text-[#94a3b8]">
                This is not just a landing page headline. In PingMaster, users can add monitors, review uptime and response status,
                send alerts, maintain an incident timeline, expose selected services on status pages, and separate private work from team work with dedicated shared workspaces.
              </p>
            </div>

            <div className="space-y-4">
              {DETAILS.map((item) => (
                <div key={item} className="rounded-[24px] border border-[#1d2430] bg-[#0f141c] px-5 py-5 text-sm leading-6 text-[#a4adbc]">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 md:px-12 py-14 md:py-18 bg-[#08090b] border-t border-[#1f232b] text-center">
          <h3 className="text-3xl md:text-4xl font-bold text-white tracking-tight">Start with your private workspace and grow only when needed</h3>
          <p className="mt-4 max-w-2xl mx-auto text-base md:text-lg leading-7 text-[#94a3b8]">
            Keep your own monitors in a private workspace first. When a service needs team ownership, create a separate shared workspace for it.
          </p>
          <button
            type="button"
            onClick={() => navigate("/signup")}
            className="mt-8 h-14 px-8 rounded-xl bg-white text-black hover:bg-[#e2e8f0] text-base font-semibold inline-flex items-center gap-2 transition hover:-translate-y-1 hover:shadow-lg"
          >
            Create Your Account
            <ChevronRight className="w-5 h-5" />
          </button>
        </section>
      </main>
    </div>
  );
}
