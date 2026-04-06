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

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-[#08090b] text-[#f2f2f2]">
      <header className="border-b border-[#1f232b] bg-[#0d0f13]">
        <div className="mx-auto max-w-7xl px-6 py-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">PingMaster</h1>
            <p className="text-xs uppercase tracking-[0.12em] text-[#8b93a1] mt-1">Website Reliability Platform</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="h-11 px-5 rounded-xl bg-[#d9dde4] text-[#111317] text-sm font-semibold"
          >
            Sign In
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10 md:py-14 space-y-10">
        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)] gap-6">
          <div className="rounded-3xl border border-[#22262f] bg-[radial-gradient(circle_at_top_left,_rgba(89,170,255,0.14),_transparent_28%),linear-gradient(180deg,_#12161d_0%,_#0f1217_100%)] p-8 md:p-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#29303b] bg-[#131923] px-3 py-1 text-xs text-[#b8c1cf]">
              <ShieldCheck className="w-3.5 h-3.5 text-[#7be0b7]" />
              Detect downtime, latency shifts, and customer-impacting failures early
            </div>
            <h2 className="mt-5 max-w-3xl text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
              Monitoring, incidents, alerts, and status updates in one clean workflow.
            </h2>
            <p className="mt-5 max-w-2xl text-base md:text-lg text-[#aeb7c5] leading-8">
              PingMaster helps you monitor availability, review endpoint health, act on PSI guidance, and publish public reliability updates without bouncing between tools.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="h-12 px-5 rounded-xl bg-[#d9dde4] text-[#111317] text-sm font-semibold inline-flex items-center gap-2"
              >
                Open Dashboard
                <ChevronRight className="w-4 h-4" />
              </button>
              <div className="inline-flex items-center gap-2 text-sm text-[#93a0b1]">
                <BellRing className="w-4 h-4" />
                Discord, Slack, and Email alert routing already supported
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-[#22262f] bg-[#10141b] p-6 md:p-7 space-y-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-[#8b93a1]">How It Works</p>
            <WorkflowStep
              title="Monitor websites and endpoints"
              description="Track response time, status, and endpoint coverage from one workspace."
            />
            <WorkflowStep
              title="Confirm real failures"
              description="Retry checks and store history so false spikes do not dominate the workflow."
            />
            <WorkflowStep
              title="Route alerts and manage incidents"
              description="Send alerts to the right channels and keep response history attached to the incident."
            />
            <WorkflowStep
              title="Share public health updates"
              description="Expose selected services through a clean status page for customers or stakeholders."
              isLast
            />
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {FEATURE_ITEMS.map((item) => (
            <article key={item.title} className="rounded-2xl border border-[#22262f] bg-[#10141b] p-5">
              <div className="h-10 w-10 rounded-xl bg-[#171c25] border border-[#273040] grid place-items-center">
                <item.Icon className="w-4 h-4 text-[#91b4ff]" />
              </div>
              <h3 className="mt-4 text-lg font-medium text-[#eef3fb]">{item.title}</h3>
              <p className="mt-2 text-sm leading-7 text-[#9ca6b5]">{item.description}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}

function WorkflowStep({ title, description, isLast = false }) {
  return (
    <div className="relative pl-8">
      {!isLast && <div className="absolute left-[9px] top-8 h-[calc(100%-1rem)] w-px bg-[#28303b]" />}
      <div className="absolute left-0 top-1 h-5 w-5 rounded-full border border-[#3b4758] bg-[#18212d]" />
      <div>
        <p className="text-sm font-medium text-[#eef3fb]">{title}</p>
        <p className="text-sm text-[#96a0af] mt-1 leading-7">{description}</p>
      </div>
    </div>
  );
}
