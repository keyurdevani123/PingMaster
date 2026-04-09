import { Activity, AlertTriangle, BellRing, ChevronRight, Globe, ShieldCheck, Zap } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const FEATURE_ITEMS = [
  {
    title: "Availability Monitoring",
    description: "Track website uptime, latency, and endpoint health from one dashboard without adding operational clutter.",
    Icon: Activity,
  },
  {
    title: "Actionable Performance Guidance",
    description: "Use PSI results to surface the fixes that matter first, instead of reading through raw audit output alone.",
    Icon: Zap,
  },
  {
    title: "Incidents and Alerts Together",
    description: "Move from issue detection to alert delivery and incident handling in one connected workflow.",
    Icon: AlertTriangle,
  },
  {
    title: "Public Reliability Updates",
    description: "Publish a simple status page for selected monitors so users can see service health without opening the app.",
    Icon: Globe,
  },
];

export default function HomePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#08090b] text-[#f2f2f2] overflow-x-hidden">
      {/* ── Top Navigation ── */}
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
              Sign Up Free
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero Loading Full Screen Width ── */}
      <main className="w-full">
        {/* HERO SECTION */}
        <section className="relative w-full px-6 md:px-12 py-12 md:py-20 flex flex-col items-center text-center bg-[radial-gradient(ellipse_at_top,_rgba(120,135,255,0.08),_transparent_60%)]">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md px-4 py-1.5 text-xs text-[#b8c1cf] shadow-sm mb-6">
            <ShieldCheck className="w-4 h-4 text-[#7be0b7]" />
            Enterprise-Grade Incident Workflows
          </div>
          
          {/* Properly sized typography as requested */}
          <h2 className="max-w-4xl text-4xl md:text-[44px] font-bold tracking-tight text-white leading-tight">
            Monitoring, incidents, and status in one clean workflow.
          </h2>
          
          <p className="mt-6 max-w-2xl text-lg text-[#94a3b8] leading-relaxed">
            PingMaster helps you monitor availability, review endpoint health, act on PSI guidance, and publish public reliability updates without bouncing between tools.
          </p>
          
          <div className="mt-10 flex items-center justify-center gap-4">
            {!loading && user ? (
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="h-14 px-8 rounded-xl bg-white text-black hover:bg-[#e2e8f0] text-base font-semibold inline-flex items-center gap-2 transition hover:-translate-y-1 hover:shadow-lg"
              >
                Go to Dashboard
                <ChevronRight className="w-5 h-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate("/signup")}
                className="h-14 px-8 rounded-xl bg-white text-black hover:bg-[#e2e8f0] text-base font-semibold inline-flex items-center gap-2 transition hover:-translate-y-1 hover:shadow-lg"
              >
                Start Monitoring For Free
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
          <div className="mt-5 flex items-center justify-center gap-2 text-sm text-[#64748b]">
            <BellRing className="w-4 h-4 text-[#94a3b8]" />
            Discord, Slack, and Email alert routing supported.
          </div>

        </section>

        {/* FEATURES GRID SECTION - Wide Layout */}
        <section className="w-full px-6 md:px-12 py-12 md:py-16 bg-[#0a0c10] border-y border-white/5">
          <div className="max-w-7xl mx-auto">
            <h3 className="text-3xl font-bold text-white mb-8 text-center">Engineered for Reliability</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {FEATURE_ITEMS.map((item) => (
                <article key={item.title} className="group rounded-[24px] border border-white/5 bg-[#0d1016] p-8 transition hover:border-white/10 hover:-translate-y-1 hover:bg-[#11161d]">
                  <div className="h-14 w-14 rounded-2xl bg-white/5 border border-white/10 grid place-items-center transition group-hover:scale-110 group-hover:bg-white/10">
                    <item.Icon className="w-6 h-6 text-[#91b4ff]" />
                  </div>
                  <h4 className="mt-8 text-xl font-semibold text-white tracking-tight">{item.title}</h4>
                  <p className="mt-4 text-[15px] leading-relaxed text-[#94a3b8]">{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* WORKFLOW SECTION - Stretched out */}
        <section className="w-full px-6 md:px-12 py-12 md:py-16 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(89,170,255,0.05),_transparent_50%)]">
          <div className="max-w-4xl mx-auto space-y-10">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.15em] font-medium text-[#64748b]">How It Works</p>
              <h3 className="text-2xl md:text-3xl font-bold text-white mt-4">A complete workflow from ping to resolution</h3>
            </div>
            
            <div className="space-y-0 relative before:absolute before:inset-0 before:ml-4 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-[#1e2430] before:to-transparent">
              <WorkflowStep
                num="01"
                title="Monitor websites and endpoints"
                description="Track response time, status, and endpoint coverage across all global regions seamlessly from your customizable workspace."
              />
              <WorkflowStep
                num="02"
                title="Confirm real failures"
                description="Our servers retry checks up to three times from independent geographic nodes so false spikes do not dominate the workflow."
              />
              <WorkflowStep
                num="03"
                title="Route alerts and manage incidents"
                description="Automatically dispatch payloads to Slack or Discord and keep a permanent response history attached to the unified incident log."
              />
              <WorkflowStep
                num="04"
                title="Share public health updates"
                description="Instantly expose selected services through a beautiful, clean status page so your customers never have to guess if you are online."
              />
            </div>
          </div>
        </section>

        {/* BOTTOM CTA SECTION - Makes the page explicitly longer */}
        <section className="w-full px-6 md:px-12 py-12 md:py-16 bg-[#08090b] border-t border-[#1f232b] text-center">
          <h3 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">Ready to fortify your endpoints?</h3>
          <p className="text-base md:text-lg text-[#94a3b8] mb-8 max-w-xl mx-auto">Join hundreds of engineers who trust PingMaster to monitor their production architecture every single day.</p>
          <button
            type="button"
            onClick={() => navigate("/signup")}
            className="h-14 px-8 rounded-xl bg-white text-black hover:bg-[#e2e8f0] text-base font-semibold inline-flex items-center gap-2 transition hover:-translate-y-1 hover:shadow-lg"
          >
            Create Your Free Account
            <ChevronRight className="w-5 h-5" />
          </button>
        </section>
      </main>
    </div>
  );
}

function WorkflowStep({ num, title, description }) {
  return (
    <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active py-8">
      {/* Icon/Number */}
      <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-[#08090b] bg-[#1a202c] text-white text-xs font-bold shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-[0_0_15px_rgba(255,255,255,0.05)] z-10 transition group-hover:scale-110 group-hover:bg-[#202836]">
        {num}
      </div>
      {/* Card */}
      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] rounded-[24px] border border-white/5 bg-[#0d1016] p-8 glass shadow-lg transition hover:border-white/10 hover:-translate-y-1">
        <h4 className="text-xl font-semibold text-white tracking-tight">{title}</h4>
        <p className="text-[15px] text-[#94a3b8] mt-3 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
