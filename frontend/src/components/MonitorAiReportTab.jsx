import { Bot, Copy, FileDown, RefreshCw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

export default function MonitorAiReportTab({
  monitor,
  reportPayload,
  loading,
  error,
  onGenerate,
}) {
  const report = reportPayload?.report || null;
  const generatedAt = reportPayload?.generatedAt || "";
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  const summaryText = useMemo(() => buildSummaryText(monitor, reportPayload), [monitor, reportPayload]);
  const topAction = report?.priorityActions?.[0] || "--";
  const topRisk = report?.topRisks?.[0] || "--";
  const healthSnippet = report?.currentHealth || report?.executiveSummary || "--";
  const visibleConfigSignals = Array.isArray(report?.pageConfigurationSignals) ? report.pageConfigurationSignals : [];
  const visibleEvidence = Array.isArray(report?.evidenceChips) ? report.evidenceChips : [];

  async function handleCopySummary() {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function handleExportPdf() {
    if (!report) return;
    setExporting(true);
    try {
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "50px";
      iframe.style.bottom = "50px";
      iframe.style.width = "100px";
      iframe.style.height = "100px";
      iframe.style.border = "3px solid #4c515e";
      iframe.setAttribute("aria-hidden", "true");
      document.body.appendChild(iframe);

      const cleanup = () => {
        setTimeout(() => {
          iframe.remove();
        }, 1200);
        setExporting(false);
      };

      const doc = iframe.contentWindow?.document;
      if (!doc || !iframe.contentWindow) {
        cleanup();
        return;
      }

      doc.open();
      doc.write(buildPrintableHtml(monitor, reportPayload));
      doc.close();

      const tryPrint = () => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } finally {
          cleanup();
        }
      };

      if (doc.readyState === "complete") {
        setTimeout(tryPrint, 250);
      } else {
        iframe.onload = () => {
          setTimeout(tryPrint, 250);
        };
      }
    } catch {
      setExporting(false);
    }
  }

  if (!report) {
    return (
      <section className="space-y-5">
        <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-[#8d94a0]">Detailed AI Report</p>
              <h3 className="text-xl font-semibold text-[#edf2fb] mt-1">Manual deep inspection</h3>
              <p className="text-sm text-[#8d94a0] mt-2 max-w-2xl">
                Generate a workspace-shared report that highlights the current state, main risk, best next action,
                and supporting evidence from monitor health, incidents, maintenance, PSI, and a live page snapshot.
              </p>
            </div>
            <button
              type="button"
              onClick={onGenerate}
              disabled={loading}
              className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              {loading ? "Generating..." : "Generate Report"}
            </button>
          </div>

          {loading ? <ProgressPanel /> : null}
          {error ? <p className="text-sm text-[#f0a496] mt-4">{error}</p> : null}
        </section>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-[#dce4ef]" />
              <p className="text-xs uppercase tracking-[0.12em] text-[#8d94a0]">Detailed AI Report</p>
            </div>
            <h3 className="text-xl font-semibold text-[#edf2fb] mt-1">Workspace-shared monitor analysis</h3>
            <p className="text-sm text-[#8d94a0] mt-2">
              Generated {formatTimestamp(generatedAt)}. A fresh run usually takes around 6-15 seconds depending on live page access and Gemini response time.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopySummary}
              className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d4dae4] inline-flex items-center gap-2"
            >
              <Copy className="w-4 h-4" />
              {copied ? "Copied" : "Copy Summary"}
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exporting}
              className="h-10 px-4 rounded-lg border border-[#2a2f39] bg-[#14181e] text-sm text-[#d4dae4] inline-flex items-center gap-2 disabled:opacity-50"
            >
              <FileDown className="w-4 h-4" />
              {exporting ? "Preparing..." : "Export PDF"}
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={loading}
              className="h-10 px-4 rounded-lg bg-[#d3d6dc] text-[#111317] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Regenerating..." : "Regenerate Report"}
            </button>
          </div>
        </div>

        {loading ? <ProgressPanel compact /> : null}
        {error ? <p className="text-sm text-[#f0a496] mt-4">{error}</p> : null}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <HighlightCard title="Current State" body={healthSnippet} tone="neutral" />
        <HighlightCard title="Main Risk" body={topRisk} tone="risk" />
        <HighlightCard title="Best Next Action" body={topAction} tone="action" />
      </section>

      <SectionCard title="Executive Summary" body={report.executiveSummary} />

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ListSection title="Fix First" items={report.priorityActions} emptyLabel="No priority actions were generated." tone="action" />
        <ListSection title="Top Risks" items={report.topRisks} emptyLabel="No top risks were generated." tone="risk" />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <SectionCard title="Reliability Findings" body={report.reliabilityAnalysis} />
        <SectionCard title="Performance Findings" body={report.performanceAnalysis} />
      </section>

      {Array.isArray(report.recentChanges) && report.recentChanges.length > 0 ? (
        <ListSection title="Recent Changes" items={report.recentChanges} emptyLabel="" />
      ) : null}

      {visibleConfigSignals.length > 0 ? (
        <ListSection title="Page Configuration Signals" items={visibleConfigSignals} emptyLabel="" />
      ) : null}

      <ListSection title="Suggested Next Checks" items={report.nextChecks} emptyLabel="No next checks were generated." />

      {visibleEvidence.length > 0 ? (
        <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5">
          <h3 className="text-sm font-medium text-[#edf2fb]">Evidence</h3>
          <div className="flex flex-wrap gap-2 mt-3">
            {visibleEvidence.map((item, index) => (
              <span
                key={`${item}-${index}`}
                className="text-xs rounded-full border border-[#2a2f39] bg-[#12161d] px-3 py-1.5 text-[#cfd6e2]"
              >
                {item}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {Array.isArray(report.limitations) && report.limitations.length > 0 ? (
        <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5">
          <h3 className="text-sm font-medium text-[#edf2fb]">Limitations</h3>
          <p className="text-xs text-[#8d94a0] mt-1">Shown only when inputs were limited or unavailable.</p>
          <div className="space-y-2 mt-3">
            {report.limitations.map((item, index) => (
              <div key={`${item}-${index}`} className="rounded-lg border border-[#252a33] bg-[#12161d] px-3 py-3 text-sm text-[#c5ccd8]">
                {item}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function HighlightCard({ title, body, tone }) {
  const toneClass = tone === "action"
    ? "border-[#3a414d] bg-[#14181e]"
    : "border-[#2a2f39] bg-[#12161d]";

  return (
    <section className={`rounded-xl border p-5 ${toneClass}`}>
      <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">{title}</p>
      <p className="text-sm text-[#e2e8f3] leading-6 mt-3">{body || "--"}</p>
    </section>
  );
}

function SectionCard({ title, body }) {
  return (
    <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5">
      <h3 className="text-sm font-medium text-[#edf2fb]">{title}</h3>
      <p className="text-sm text-[#cfd6e2] mt-3 leading-6">{body || "--"}</p>
    </section>
  );
}

function ListSection({ title, items, emptyLabel, tone = "default" }) {
  const toneClass = tone === "action"
    ? "border-[#3a414d] bg-[#14181e]"
    : "border-[#252a33] bg-[#12161d]";

  return (
    <section className="bg-[#0f1217] border border-[#22252b] rounded-xl p-5">
      <h3 className="text-sm font-medium text-[#edf2fb]">{title}</h3>
      {Array.isArray(items) && items.length > 0 ? (
        <div className="space-y-2 mt-3">
          {items.map((item, index) => (
            <div key={`${item}-${index}`} className={`rounded-lg border px-3 py-3 text-sm text-[#d5dce7] ${toneClass}`}>
              {item}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[#8d94a0] mt-3">{emptyLabel}</p>
      )}
    </section>
  );
}

function ProgressPanel({ compact = false } = {}) {
  return (
    <div className={`rounded-xl border border-[#252a33] bg-[#12161d] ${compact ? "mt-4 px-4 py-3" : "mt-5 px-4 py-4"}`}>
      <div className="space-y-2 text-sm text-[#cfd6e2]">
        <p>Collecting monitor signals...</p>
        <p>Reading live page snapshot...</p>
        <p>Generating AI summary...</p>
      </div>
    </div>
  );
}

function buildSummaryText(monitor, reportPayload) {
  const report = reportPayload?.report || {};
  return [
    "PingMaster AI Summary",
    `Monitor: ${monitor?.name || "--"}`,
    `URL: ${monitor?.url || "--"}`,
    `Status: ${monitor?.status || "--"}`,
    `Generated: ${formatTimestamp(reportPayload?.generatedAt)}`,
    "",
    "Summary:",
    report.executiveSummary || "--",
    "",
    "Top Risks:",
    ...(Array.isArray(report.topRisks) && report.topRisks.length > 0 ? report.topRisks.map((item) => `- ${item}`) : ["- --"]),
    "",
    "Fix First:",
    ...(Array.isArray(report.priorityActions) && report.priorityActions.length > 0 ? report.priorityActions.map((item) => `- ${item}`) : ["- --"]),
    "",
    "Next Checks:",
    ...(Array.isArray(report.nextChecks) && report.nextChecks.length > 0 ? report.nextChecks.map((item) => `- ${item}`) : ["- --"]),
  ].join("\n");
}

function buildPrintableHtml(monitor, reportPayload) {
  const report = reportPayload?.report || {};
  const sections = [
    sectionHtml("Executive Summary", [report.executiveSummary]),
    sectionHtml("Current Health", [report.currentHealth]),
    sectionHtml("Top Risks", report.topRisks),
    sectionHtml("Fix First", report.priorityActions),
    sectionHtml("Reliability Findings", [report.reliabilityAnalysis]),
    sectionHtml("Performance Findings", [report.performanceAnalysis]),
    sectionHtml("Recent Changes", report.recentChanges),
    sectionHtml("Page Configuration Signals", report.pageConfigurationSignals),
    sectionHtml("Suggested Next Checks", report.nextChecks),
    sectionHtml("Evidence", report.evidenceChips),
    sectionHtml("Limitations", report.limitations),
  ].filter(Boolean).join("");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>PingMaster AI Report</title>
      <style>
        @page { size: A4; margin: 18mm; }
        * { box-sizing: border-box; }
        html, body { width: 210mm; max-width: 100%; }
        body {
          font-family: Arial, sans-serif;
          color: #111;
          margin: 0 auto;
          padding: 0;
          line-height: 1.45;
          font-size: 12px;
        }
        .page {
          width: 100%;
          max-width: 174mm;
          margin: 0 auto;
        }
        h1 { font-size: 22px; margin: 0 0 6px; }
        h2 { font-size: 15px; margin: 20px 0 8px; }
        .meta { color: #555; margin-bottom: 14px; font-size: 11.5px; }
        .meta div { margin-bottom: 3px; }
        .card {
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 10px 12px;
          margin-bottom: 10px;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        section { page-break-inside: avoid; break-inside: avoid; }
        ul { padding-left: 18px; margin: 0; }
        li { margin-bottom: 5px; }
      </style>
    </head>
    <body>
      <div class="page">
        <h1>PingMaster Detailed AI Report</h1>
        <div class="meta">
          <div><strong>Monitor:</strong> ${escapeHtml(monitor?.name || "--")}</div>
          <div><strong>URL:</strong> ${escapeHtml(monitor?.url || "--")}</div>
          <div><strong>Status:</strong> ${escapeHtml(monitor?.status || "--")}</div>
          <div><strong>Generated:</strong> ${escapeHtml(formatTimestamp(reportPayload?.generatedAt))}</div>
        </div>
        ${sections}
      </div>
    </body>
  </html>`;
}

function sectionHtml(title, items) {
  const normalized = Array.isArray(items)
    ? items.filter(Boolean)
    : [items].filter(Boolean);
  if (normalized.length === 0) return "";
  const content = normalized.length === 1
    ? `<div class="card">${escapeHtml(normalized[0])}</div>`
    : `<div class="card"><ul>${normalized.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
  return `<section><h2>${escapeHtml(title)}</h2>${content}</section>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTimestamp(value) {
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
