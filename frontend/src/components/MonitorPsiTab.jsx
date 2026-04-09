import { Fragment, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Monitor, Smartphone } from "lucide-react";
import { buildPsiViewModel } from "../utils/psi";

export default function MonitorPsiTab({
  monitorName,
  monitorUrl,
  psiEligible = true,
  psiReason = "",
  psiData,
  psiStrategy,
  psiLoading,
  psiError,
  onStrategyChange,
  onRunAudit,
}) {
  const [expandedAuditIds, setExpandedAuditIds] = useState(new Set());
  const viewModel = useMemo(() => buildPsiViewModel(psiData), [psiData]);
  const canRunAudit = true;

  function toggleAuditDetails(auditId) {
    setExpandedAuditIds((prev) => {
      const next = new Set(prev);
      if (next.has(auditId)) next.delete(auditId);
      else next.add(auditId);
      return next;
    });
  }

  return (
    <section className="space-y-5">
      {/* Header card */}
      <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-[#8d94a0]">PageSpeed Insights</p>
            <h3 className="text-xl font-semibold text-[#edf2fb] mt-1">Performance Audit</h3>
            <p className="text-xs text-[#6f7785] mt-1">
              {viewModel.fetchedAt
                ? `Last run ${formatAuditTime(viewModel.fetchedAt)} · ${viewModel.strategyLabel}`
                : `${monitorName || "this monitor"} — run an audit to load data`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onStrategyChange("desktop")}
              className={`h-9 px-3 rounded-lg text-sm border inline-flex items-center gap-2 ${
                psiStrategy === "desktop"
                  ? "bg-[#d3d6dc] text-[#111317] border-[#d3d6dc]"
                  : "border-[#2a2f39] text-[#9ca3af] bg-transparent"
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              Desktop
            </button>
            <button
              type="button"
              onClick={() => onStrategyChange("mobile")}
              className={`h-9 px-3 rounded-lg text-sm border inline-flex items-center gap-2 ${
                psiStrategy === "mobile"
                  ? "bg-[#d3d6dc] text-[#111317] border-[#d3d6dc]"
                  : "border-[#2a2f39] text-[#9ca3af] bg-transparent"
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              Mobile
            </button>
            <button
              type="button"
              onClick={onRunAudit}
              disabled={psiLoading}
              className="h-9 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${psiLoading ? "animate-spin" : ""}`} />
              {psiLoading ? "Running..." : "Run Audit"}
            </button>
          </div>
        </div>

        {psiError && <p className="text-sm text-[#f0a496] mt-3">{psiError}</p>}

        {psiEligible === false && (
          <div className="mt-4 rounded-xl border border-[#2a3040] bg-[#141821] p-3.5 flex items-start gap-3">
            <span className="mt-0.5 shrink-0 text-yellow-400">⚠</span>
            <div>
              <p className="text-sm font-medium text-[#d6dce7]">This target may not be a standard webpage</p>
              <p className="text-xs text-[#8d94a0] mt-1">
                {psiReason || "PSI works best on public HTML pages. You can still run the audit — Google\u2019s API will report if this URL is unsupported."}
              </p>
            </div>
          </div>
        )}

        {/* Score cards - always shown, empty before first audit */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {viewModel.scoreCards.map((item) => (
            <ScoreCard key={item.label} item={item} />
          ))}
        </div>
      </section>

      <>
      {/* Side-by-side: Lab vs Real-User */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Lab metrics */}
        <div className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
          <div className="mb-3">
            <h3 className="text-sm font-medium text-[#edf2fb]">Lab Metrics</h3>
            <p className="text-xs text-[#8d94a0] mt-0.5">
              Simulated · throttled CPU + network · cold cache
            </p>
          </div>
          <div className="rounded-lg border border-[#252a33] bg-[#12161d] divide-y divide-[#1e2330]">
            {viewModel.labMetrics.length === 0 ? (
              <p className="text-sm text-[#6f7785] px-3 py-4">Run audit to view lab metrics.</p>
            ) : (
              viewModel.labMetrics.map((item) => (
                <MetricRow key={item.label} item={item} />
              ))
            )}
          </div>
        </div>

        {/* Real-user metrics */}
        <div className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
          <div className="mb-3">
            <h3 className="text-sm font-medium text-[#edf2fb]">
              {viewModel.realUserLabel || "Real-User Metrics (CrUX)"}
            </h3>
            <p className="text-xs text-[#8d94a0] mt-0.5">
              Aggregated · actual Chrome users · p75 field data
            </p>
          </div>
          <div className="rounded-lg border border-[#252a33] bg-[#12161d] divide-y divide-[#1e2330]">
            {viewModel.realUserMetrics.length === 0 ? (
              <p className="text-sm text-[#6f7785] px-3 py-4">
                No CrUX field data available — run audit or insufficient traffic.
              </p>
            ) : (
              buildExtendedRealUserRows(viewModel).map((item) => (
                <MetricRow key={item.label} item={item} />
              ))
            )}
          </div>
        </div>
      </section>

      {/* Optimization Opportunities */}
      <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-4 md:p-5">
        <div className="mb-4">
          <h3 className="text-sm font-medium">Optimization Opportunities</h3>
          <p className="text-xs text-[#8d94a0] mt-0.5">Highest-impact Lighthouse items, ordered by likely user benefit.</p>
        </div>

        {viewModel.opportunities.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#2a2f39] bg-[#10141b] px-4 py-10 text-center text-sm text-[#7f8793]">
            Run an audit to load performance opportunities.
          </div>
        ) : (
          <div className="space-y-3">
            {viewModel.opportunities.map((row, index) => {
              const expanded = expandedAuditIds.has(row.id);
              return (
                <Fragment key={`${row.id}-${row.name}`}>
                  <article className={`rounded-xl border bg-[#12161d] p-4 ${index === 0 ? "border-[#3a4b5f]" : "border-[#252a33]"}`}>
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {index === 0 && (
                            <span className="text-[11px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full bg-[#21272f] text-[#9fb0c7]">
                              Top Opportunity
                            </span>
                          )}
                          <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full ${row.priority.className}`}>
                            {row.priority.label}
                          </span>
                          <span className="text-[11px] uppercase tracking-[0.08em] px-2 py-0.5 rounded-full bg-[#202631] text-[#b9c2cf]">
                            {row.type}
                          </span>
                        </div>
                        <p className="text-base text-[#edf2fb] font-medium mt-3">{row.name}</p>
                        <p className="text-sm text-[#9ca3af] mt-2">{row.why}</p>
                        <div className="mt-3 rounded-lg border border-[#252a33] bg-[#10141b] px-3 py-2.5">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-[#7f8793]">What to do first</p>
                          <p className="text-sm text-[#d6dce7] mt-1">{row.quickAction}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3 min-w-[220px]">
                        <CompactMetric label="Current State" value={row.currentValue} />
                        <CompactMetric label="Estimated Savings" value={row.gain} />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 mt-4">
                      {row.fullDescription && row.fullDescription !== row.why ? (
                        <button
                          type="button"
                          onClick={() => toggleAuditDetails(row.id)}
                          className="inline-flex items-center px-3 py-1.5 rounded-lg border border-[#2a2f39] text-xs text-[#8d94a0] hover:text-[#cbd5e0]"
                        >
                          {expanded ? "Hide Details" : "View Details"}
                        </button>
                      ) : null}
                      {row.docsUrl && (
                        <a
                          href={row.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[#8d94a0] hover:text-[#cbd5e0]"
                        >
                          Docs
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    {expanded && row.fullDescription && row.fullDescription !== row.why && (
                      <div className="mt-4 rounded-lg border border-[#2a2f39] bg-[#10141b] p-3">
                        <DetailBlock label="Audit Details" value={row.fullDescription} />
                      </div>
                    )}
                  </article>
                </Fragment>
              );
            })}
          </div>
        )}
      </section>
      </>
    </section>
  );
}

// Pull all available real-user metrics from the raw PSI payload via viewModel
// Falls back to the 3 core vitals if extended data is unavailable
function buildExtendedRealUserRows(viewModel) {
  // realUserMetrics contains whatever CrUX provided (up to 5: LCP, INP, CLS, FCP, TTFB)
  // labMetrics has all 6 lab values for labels we can cross-reference
  const labMap = Object.fromEntries(viewModel.labMetrics.map((m) => [m.label, m]));

  return viewModel.realUserMetrics.map((item) => {
    const lab = labMap[item.label];
    return {
      ...item,
      labValue: lab?.value ?? null,
    };
  });
}

function ScoreCard({ item }) {
  const toneClass = getToneClass(item.tone);
  return (
    <article className="rounded-xl border border-[#252a33] bg-[#12161d] p-3.5">
      <p className="text-xs uppercase tracking-[0.1em] text-[#8d94a0]">{item.label}</p>
      <p className="text-3xl font-semibold mt-1.5 text-[#edf2fb]">{item.value}</p>
      <p className="mt-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] ${toneClass}`}>
          {readableTone(item.tone)}
        </span>
      </p>
    </article>
  );
}

function MetricRow({ item }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-[#c9d1dd]">{item.label}</p>
        <p className="text-sm text-[#edf2fb] font-medium mt-0.5">{item.value}</p>
      </div>
      <span className={`text-[11px] uppercase tracking-[0.08em] shrink-0 ${getToneClass(item.rating)}`}>
        {readableTone(item.rating)}
      </span>
    </div>
  );
}

function CompactMetric({ label, value, accent = "text-[#d4dae4]" }) {
  return (
    <div className="rounded-lg border border-[#252a33] bg-[#10141b] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.08em] text-[#7f8793]">{label}</p>
      <p className={`text-sm font-medium mt-1 ${accent}`}>{value}</p>
    </div>
  );
}

function DetailBlock({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-[#7f8793] uppercase tracking-[0.08em] text-xs">{label}</p>
      <p className="text-[#cfd6e2] mt-1 text-xs">{value || "--"}</p>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="rounded-lg border border-[#252a33] bg-[#10141b] px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-[0.08em] text-[#7f8793]">{label}</p>
      <p className="text-sm text-[#d3dae6] mt-1 break-all">{value || "--"}</p>
    </div>
  );
}

function formatAuditTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getToneClass(tone) {
  if (tone === "good") return "bg-green-500/12 text-green-300";
  if (tone === "needs-improvement") return "bg-yellow-500/12 text-yellow-300";
  if (tone === "poor") return "bg-red-500/12 text-red-300";
  return "bg-[#202631] text-[#cbd5e1]";
}

function readableTone(tone) {
  if (tone === "good") return "Good";
  if (tone === "needs-improvement") return "Needs improvement";
  if (tone === "poor") return "Poor";
  return "—";
}
