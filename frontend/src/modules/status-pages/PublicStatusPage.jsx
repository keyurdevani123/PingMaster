import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchPublicStatusPage } from "../../api";

export default function PublicStatusPage() {
  const { slug } = useParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPage() {
      setLoading(true);
      setError("");
      try {
        const next = await fetchPublicStatusPage(slug);
        if (!active) return;
        setPayload(next);
      } catch (err) {
        if (!active) return;
        setError(err?.message || "Could not load this status page.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadPage();
    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08090b] text-[#f2f2f2]">
        <div className="mx-auto max-w-5xl px-6 py-10 space-y-4">
          <div className="rounded-2xl border border-[#22262f] bg-[#10141b] p-6">
            <div className="loading-metric-block h-4 w-32 rounded-md" />
            <div className="loading-metric-block mt-4 h-9 w-72 rounded-lg" />
            <div className="loading-metric-block mt-3 h-4 w-full max-w-2xl rounded-md" />
          </div>
          <div className="rounded-2xl border border-[#22262f] bg-[#10141b] p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-[#232833] bg-[#0f1319] p-4">
                <div className="loading-metric-block h-4 w-40 rounded-md" />
                <div className="loading-metric-block mt-3 h-3 w-full max-w-md rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="min-h-screen bg-[#08090b] text-[#f2f2f2] grid place-items-center px-6">
        <div className="text-center">
          <p className="text-lg font-semibold text-[#edf2fb]">Status page unavailable</p>
          <p className="text-sm text-[#8d94a0] mt-2">{error || "This status page could not be found."}</p>
        </div>
      </div>
    );
  }

  const summary = payload.summary || {};
  const maintenance = payload.maintenance || { active: [], upcoming: [] };
  const monitors = Array.isArray(payload.monitors) ? payload.monitors : [];
  const activeIncidents = Array.isArray(payload.activeIncidents) ? payload.activeIncidents : [];
  const recentResolvedIncidents = Array.isArray(payload.recentResolvedIncidents) ? payload.recentResolvedIncidents : [];
  const overallMeta = getOverallStatusMeta(payload.overallStatus?.tone);

  return (
    <div className="min-h-screen bg-[#08090b] text-[#f2f2f2]">
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-5">
        <section className="rounded-2xl border border-[#22262f] bg-[#10141b] p-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${overallMeta.className}`}>
              {payload.overallStatus?.label || overallMeta.label}
            </span>
            <span className="text-sm text-[#8d94a0]">Updated {formatTimestamp(payload.updatedAt)}</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight mt-4">{payload.name || "Status Page"}</h1>
          {payload.heroDescription ? (
            <p className="text-sm text-[#9ca5b3] mt-2 leading-7">{payload.heroDescription}</p>
          ) : null}
          <p className="text-sm text-[#cfd6e3] mt-4">{payload.overallStatus?.message || overallMeta.message}</p>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Operational" value={String(summary.available ?? 0)} tone="up" />
          <StatCard label="Degraded" value={String(summary.degraded ?? 0)} tone="degraded" />
          <StatCard label="Down" value={String(summary.down ?? 0)} tone="down" />
          <StatCard label="Maintenance" value={String(summary.maintenance ?? 0)} tone="maintenance" />
        </section>

        {(maintenance.active?.length > 0 || maintenance.upcoming?.length > 0) ? (
          <section className="rounded-2xl border border-[#22262f] bg-[#10141b] p-6 space-y-4">
            <div>
              <h2 className="text-lg font-medium text-[#edf2fb]">Maintenance</h2>
              <p className="text-sm text-[#8d94a0] mt-1">Planned work is shown here so scheduled interruptions are clear.</p>
            </div>

            {maintenance.active?.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.08em] text-[#8d94a0]">Active</p>
                {maintenance.active.map((item) => (
                  <MaintenanceRow key={item.id} item={item} />
                ))}
              </div>
            ) : null}

            {maintenance.upcoming?.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.08em] text-[#8d94a0]">Upcoming</p>
                {maintenance.upcoming.map((item) => (
                  <MaintenanceRow key={item.id} item={item} upcoming />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="rounded-2xl border border-[#22262f] bg-[#10141b] p-6">
          <div>
            <h2 className="text-lg font-medium text-[#edf2fb]">Components</h2>
            <p className="text-sm text-[#8d94a0] mt-1">Current status of the published monitors.</p>
          </div>

          {monitors.length === 0 ? (
            <EmptyBlock message="No public components have been added to this status page yet." />
          ) : (
            <div className="mt-4 space-y-3">
              {monitors.map((monitor) => (
                <MonitorRow key={monitor.id} monitor={monitor} />
              ))}
            </div>
          )}
        </section>

        {activeIncidents.length > 0 ? (
          <section className="rounded-2xl border border-[#22262f] bg-[#10141b] p-6">
            <div>
              <h2 className="text-lg font-medium text-[#edf2fb]">Active Incidents</h2>
              <p className="text-sm text-[#8d94a0] mt-1">These issues are currently affecting published monitors.</p>
            </div>
            <div className="mt-4 space-y-3">
              {activeIncidents.map((incident) => (
                <IncidentRow key={incident.id} incident={incident} />
              ))}
            </div>
          </section>
        ) : null}

        {recentResolvedIncidents.length > 0 ? (
          <section className="rounded-2xl border border-[#22262f] bg-[#10141b] p-6">
            <div>
              <h2 className="text-lg font-medium text-[#edf2fb]">Recently Resolved</h2>
              <p className="text-sm text-[#8d94a0] mt-1">Recent incidents that were closed on this status page.</p>
            </div>
            <div className="mt-4 space-y-3">
              {recentResolvedIncidents.map((incident) => (
                <IncidentRow key={incident.id} incident={incident} resolved />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function StatCard({ label, value, tone = "default" }) {
  const toneClass = tone === "up"
    ? "text-[#69e7ba]"
    : tone === "degraded"
      ? "text-[#f2d28c]"
      : tone === "down"
        ? "text-[#f7b3a7]"
        : tone === "maintenance"
          ? "text-[#f2c55f]"
          : "text-[#edf2fb]";

  return (
    <div className="rounded-xl border border-[#232833] bg-[#0f1319] p-4">
      <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">{label}</p>
      <p className={`text-2xl font-semibold mt-3 ${toneClass}`}>{value}</p>
    </div>
  );
}

function MonitorRow({ monitor }) {
  const statusMeta = getMonitorStatusMeta(monitor.status);
  return (
    <div className="rounded-xl border border-[#232833] bg-[#0f1319] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusMeta.dotClass}`} />
            <p className="text-base font-medium text-[#edf2fb]">{monitor.name}</p>
          </div>
          <p className="text-sm text-[#8d94a0] mt-1 break-all">{monitor.url}</p>
        </div>
        <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded-full ${statusMeta.className}`}>
          {statusMeta.label}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <MiniMetric label="24h Uptime" value={monitor.uptime24h != null ? `${monitor.uptime24h}%` : "--"} />
        <MiniMetric label="Latency" value={monitor.lastLatency != null ? `${monitor.lastLatency} ms` : "--"} />
        <MiniMetric label="Status Code" value={monitor.lastStatusCode != null ? String(monitor.lastStatusCode) : "--"} />
        <MiniMetric label="Last Checked" value={formatTimestamp(monitor.lastChecked)} />
      </div>
    </div>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div className="rounded-lg border border-[#252a33] bg-[#11161e] px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">{label}</p>
      <p className="text-sm text-[#dbe2ee] mt-2">{value}</p>
    </div>
  );
}

function MaintenanceRow({ item, upcoming = false }) {
  return (
    <div className="rounded-xl border border-[#232833] bg-[#0f1319] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#edf2fb]">{item.title}</p>
          {item.message ? <p className="text-sm text-[#8d94a0] mt-1 leading-6">{item.message}</p> : null}
        </div>
        <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded-full ${upcoming ? "bg-[#1b2330] text-[#b8c8de]" : "bg-[#47371a] text-[#f2d28c]"}`}>
          {upcoming ? "Upcoming" : "Active"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#8d94a0]">
        <span>Starts {formatTimestamp(item.startsAt)}</span>
        <span>Ends {formatTimestamp(item.endsAt)}</span>
      </div>
    </div>
  );
}

function IncidentRow({ incident, resolved = false }) {
  const badgeClass = resolved
    ? "bg-[#173126] text-[#8fe0bb]"
    : incident.severity === "critical"
      ? "bg-[#432021] text-[#f7b3a7]"
      : incident.severity === "high"
        ? "bg-[#47371a] text-[#f2d28c]"
        : "bg-[#1b2330] text-[#b8c8de]";

  return (
    <div className="rounded-xl border border-[#232833] bg-[#0f1319] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#edf2fb]">{incident.title}</p>
          <p className="text-xs text-[#8d94a0] mt-1">{incident.monitorName || incident.code}</p>
        </div>
        <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded-full ${badgeClass}`}>
          {resolved ? "Resolved" : incident.severity || "Info"}
        </span>
      </div>
      {incident.impactSummary ? (
        <p className="text-sm text-[#aeb7c5] mt-3 leading-7">{incident.impactSummary}</p>
      ) : null}
      <div className="mt-3 text-xs text-[#8d94a0]">
        {resolved ? `Resolved ${formatTimestamp(incident.resolvedAt)}` : `Started ${formatTimestamp(incident.startedAt)}`}
      </div>
      {resolved && incident.fixSummary ? (
        <p className="text-sm text-[#aeb7c5] mt-3 leading-7">
          <span className="text-[#dbe2ee]">Fix:</span> {incident.fixSummary}
        </p>
      ) : null}
    </div>
  );
}

function EmptyBlock({ message }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-[#2b313c] bg-[#0d1118] px-4 py-8 text-center text-sm text-[#7f8793]">
      {message}
    </div>
  );
}

function getOverallStatusMeta(tone) {
  if (tone === "down") {
    return {
      label: "Major outage",
      className: "bg-[#432021] text-[#f7b3a7]",
      message: "Some public components are currently unavailable.",
    };
  }
  if (tone === "degraded") {
    return {
      label: "Partial disruption",
      className: "bg-[#47371a] text-[#f2d28c]",
      message: "Some components are experiencing degraded performance.",
    };
  }
  if (tone === "maintenance") {
    return {
      label: "Scheduled maintenance",
      className: "bg-[#3f3217] text-[#f2cf80]",
      message: "Some public components are currently in a planned maintenance window.",
    };
  }
  return {
    label: "All systems operational",
    className: "bg-[#123828] text-[#69e7ba]",
    message: "All published components are operating normally.",
  };
}

function getMonitorStatusMeta(status) {
  if (status === "DOWN") return { label: "Down", className: "bg-[#432021] text-[#f7b3a7]", dotClass: "bg-[#f37d6b]" };
  if (status === "UP_RESTRICTED") return { label: "Degraded", className: "bg-[#47371a] text-[#f2d28c]", dotClass: "bg-[#f2c55f]" };
  if (status === "MAINTENANCE") return { label: "Maintenance", className: "bg-[#3f3217] text-[#f2cf80]", dotClass: "bg-[#f2c55f]" };
  return { label: "Available", className: "bg-[#123828] text-[#69e7ba]", dotClass: "bg-[#36cf9b]" };
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
