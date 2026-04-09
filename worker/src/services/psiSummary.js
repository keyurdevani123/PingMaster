export async function getStoredPsiSummary(redis, workspaceId, monitorId, strategy = "desktop") {
  return redis.get(getPsiSummaryKey(workspaceId, monitorId, strategy));
}

export async function saveStoredPsiSummary(redis, workspaceId, monitorId, strategy, psiPayload) {
  const summary = normalizePsiSummary(psiPayload, strategy);
  if (!summary) return null;
  await redis.set(getPsiSummaryKey(workspaceId, monitorId, summary.strategy), summary);
  return summary;
}

function getPsiSummaryKey(workspaceId, monitorId, strategy) {
  return `psi_summary:${workspaceId}:${monitorId}:${strategy || "desktop"}`;
}

export function normalizePsiSummary(psiPayload, strategyHint = "desktop") {
  if (!psiPayload?.lighthouseResult) return null;

  const lighthouse = psiPayload.lighthouseResult;
  const categories = lighthouse.categories || {};
  const audits = lighthouse.audits || {};

  const metrics = [
    "largest-contentful-paint",
    "interaction-to-next-paint",
    "experimental-interaction-to-next-paint",
    "cumulative-layout-shift",
    "total-blocking-time",
    "speed-index",
    "first-contentful-paint",
  ]
    .map((key) => audits[key])
    .filter(Boolean)
    .slice(0, 6)
    .map((audit) => ({
      id: audit.id,
      title: audit.title,
      value: audit.displayValue || "--",
      score: Number.isFinite(audit.score) ? Math.round(audit.score * 100) : null,
    }));

  const opportunities = Object.values(audits)
    .filter((audit) => Number.isFinite(audit?.numericValue) && audit.numericValue > 0)
    .sort((left, right) => (right.numericValue || 0) - (left.numericValue || 0))
    .slice(0, 5)
    .map((audit) => ({
      id: audit.id,
      title: audit.title,
      value: audit.displayValue || "--",
      description: stripMarkdownLinks(audit.description || ""),
    }));

  return {
    strategy: strategyHint || lighthouse?.configSettings?.formFactor || "desktop",
    fetchedAt: lighthouse.fetchTime || new Date().toISOString(),
    requestedUrl: lighthouse.requestedUrl || psiPayload?.id || "",
    finalUrl: lighthouse.finalDisplayedUrl || lighthouse.finalUrl || "",
    scores: {
      performance: toScore(categories.performance?.score),
      accessibility: toScore(categories.accessibility?.score),
      bestPractices: toScore(categories["best-practices"]?.score),
      seo: toScore(categories.seo?.score),
    },
    metrics,
    opportunities,
  };
}

function toScore(score) {
  return Number.isFinite(score) ? Math.round(score * 100) : null;
}

function stripMarkdownLinks(text) {
  return String(text || "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}
