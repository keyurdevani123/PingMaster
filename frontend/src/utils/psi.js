export function buildPsiViewModel(psiPayload) {
  const lighthouse = psiPayload?.lighthouseResult || {};
  const categories = lighthouse.categories || {};
  const audits = lighthouse.audits || {};
  const loadingExperience = psiPayload?.loadingExperience?.metrics || {};
  const originExperience = psiPayload?.originLoadingExperience?.metrics || {};

  const scoreCards = [
    buildScoreCard("Performance", categories.performance?.score, "text-[#f3bd59]"),
    buildScoreCard("Accessibility", categories.accessibility?.score, "text-[#74d6b2]"),
    buildScoreCard("Best Practices", categories["best-practices"]?.score, "text-[#8fdfff]"),
    buildScoreCard("SEO", categories.seo?.score, "text-[#b7c8ff]"),
  ];

  const labMetrics = [
    buildMetric("LCP", audits["largest-contentful-paint"]?.numericValue, "millisecond"),
    buildMetric(
      "INP",
      audits["interaction-to-next-paint"]?.numericValue ??
        audits["experimental-interaction-to-next-paint"]?.numericValue ??
        audits["interactive"]?.numericValue,
      "millisecond"
    ),
    buildMetric("CLS", audits["cumulative-layout-shift"]?.numericValue, "unitless"),
    buildMetric("TBT", audits["total-blocking-time"]?.numericValue, "millisecond"),
    buildMetric("Speed Index", audits["speed-index"]?.numericValue, "millisecond"),
    buildMetric("FCP", audits["first-contentful-paint"]?.numericValue, "millisecond"),
  ];

  const vitalsSeries = labMetrics
    .filter((item) => Number.isFinite(item.chartValue))
    .map((item) => ({
      label: item.label,
      value: item.chartValue,
      fullValue: item.value,
      rating: item.rating,
    }));

  const fieldMetrics = buildFieldMetrics(loadingExperience);
  const originFieldMetrics = buildFieldMetrics(originExperience);
  const opportunities = buildPsiRows(psiPayload);
  const preferredFieldMetrics = fieldMetrics.length > 0 ? fieldMetrics : originFieldMetrics;
  const realUserMetrics = preferredFieldMetrics.filter((item) => ["LCP", "INP", "CLS"].includes(item.label));

  return {
    hasData: Boolean(psiPayload?.lighthouseResult),
    scoreCards,
    labMetrics,
    vitalsSeries,
    realUserMetrics,
    realUserLabel: fieldMetrics.length > 0 ? "Real-user Web Vitals" : originFieldMetrics.length > 0 ? "Origin Web Vitals" : "",
    opportunities,
    requestedUrl: lighthouse.requestedUrl || psiPayload?.id || "",
    finalUrl: lighthouse.finalDisplayedUrl || lighthouse.finalUrl || "",
    fetchedAt: lighthouse.fetchTime || "",
    strategyLabel: lighthouse?.configSettings?.formFactor || "--",
  };
}

function buildScoreCard(label, score, accentClass) {
  const numericScore = typeof score === "number" ? Math.round(score * 100) : null;
  return {
    label,
    value: numericScore != null ? `${numericScore}` : "--",
    accentClass,
    tone: getScoreTone(numericScore),
  };
}

function buildMetric(label, rawValue, unit) {
  return {
    label,
    value: formatMetric(rawValue, unit),
    chartValue: toChartMetric(rawValue, unit),
    rating: getMetricRating(label, rawValue),
  };
}

function buildFieldMetrics(source) {
  const order = [
    { key: "LARGEST_CONTENTFUL_PAINT_MS", label: "LCP", unit: "millisecond" },
    { key: "INTERACTION_TO_NEXT_PAINT", label: "INP", unit: "millisecond" },
    { key: "CUMULATIVE_LAYOUT_SHIFT_SCORE", label: "CLS", unit: "unitless" },
    { key: "FIRST_CONTENTFUL_PAINT_MS", label: "FCP", unit: "millisecond" },
    { key: "EXPERIMENTAL_TIME_TO_FIRST_BYTE", label: "TTFB", unit: "millisecond" },
  ];

  return order
    .map((item) => {
      const metric = source?.[item.key];
      if (!metric) return null;
      const percentile = metric.percentile;
      return {
        label: item.label,
        value: formatMetric(percentile, item.unit),
        rating: normalizeRating(metric.category),
        distributions: Array.isArray(metric.distributions) ? metric.distributions : [],
      };
    })
    .filter(Boolean);
}

export function buildPsiRows(psiPayload) {
  const audits = psiPayload?.lighthouseResult?.audits;
  if (!audits) {
    return [];
  }

  return Object.values(audits)
    .filter((item) => Number.isFinite(item.numericValue) && item.numericValue > 0 && item.score !== null)
    .sort((a, b) => getAuditPriorityScore(b) - getAuditPriorityScore(a))
    .slice(0, 6)
    .map((item) => ({
      id: item.id || item.title,
      name: item.title,
      type: item.details?.type === "opportunity" ? "Opportunity" : "Diagnostic",
      score: formatAuditScore(item.score),
      currentValue: item.displayValue || "--",
      gain: formatPsiGain(item.numericValue, item.numericUnit),
      why: buildAuditReason(item),
      docsUrl: extractFirstUrl(item.description),
      rawValue: formatPsiRaw(item.numericValue, item.numericUnit),
      fullDescription: normalizeAuditDescription(item.description),
      quickAction: buildAuditQuickAction(item),
      priority: getAuditPriorityMeta(item),
    }));
}

function getAuditPriorityScore(audit) {
  const value = Number.isFinite(audit?.numericValue) ? audit.numericValue : 0;
  const unit = (audit?.numericUnit || "").toLowerCase();
  const typeBoost = audit?.details?.type === "opportunity" ? 1_000_000 : 0;

  if (unit === "millisecond") return typeBoost + value;
  if (unit === "second") return typeBoost + value * 1000;
  if (unit === "byte") return typeBoost + value / 1024;
  if (unit === "percent") return typeBoost + value * 10;
  return typeBoost + value;
}

function formatPsiGain(value, unit) {
  if (!Number.isFinite(value)) return "--";
  const normalizedUnit = (unit || "").toLowerCase();

  if (normalizedUnit === "millisecond" || normalizedUnit === "second") {
    const ms = normalizedUnit === "second" ? value * 1000 : value;
    return formatMetric(ms, "millisecond");
  }

  if (normalizedUnit === "byte") {
    return formatBytesShort(value);
  }

  if (normalizedUnit === "percent") {
    return `${Math.round(value)}%`;
  }

  return `${Math.round(value)}`;
}

function formatPsiRaw(value, unit) {
  if (!Number.isFinite(value)) return "--";
  const normalizedUnit = (unit || "").toLowerCase();
  if (normalizedUnit === "millisecond") return `${Math.round(value)} ms`;
  if (normalizedUnit === "second") return `${roundMetric(value, 2)} s`;
  if (normalizedUnit === "byte") return formatBytesShort(value);
  if (normalizedUnit === "percent") return `${Math.round(value)}%`;

  const shortUnit = toShortUnit(normalizedUnit);
  const rounded = roundMetric(value, 2);
  if (!shortUnit) return `${rounded}`;
  return `${rounded} ${shortUnit}`;
}

function formatBytesShort(value) {
  const abs = Math.abs(value);
  if (abs >= 1024 * 1024) return `${roundMetric(value / (1024 * 1024), 1)} MiB`;
  if (abs >= 1024) return `${roundMetric(value / 1024, 1)} KiB`;
  return `${Math.round(value)} B`;
}

function roundMetric(value, digits = 1) {
  if (!Number.isFinite(value)) return "--";
  return Number(value.toFixed(digits)).toString();
}

function toShortUnit(unit) {
  if (unit === "millisecond") return "ms";
  if (unit === "second") return "s";
  if (unit === "byte") return "B";
  if (unit === "percent") return "%";
  return unit;
}

function formatAuditScore(score) {
  if (!Number.isFinite(score)) return "--";
  return `${Math.round(score * 100)}%`;
}

function extractFirstUrl(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match?.[0] || "";
}

function getAuditPriorityMeta(audit) {
  const score = Number.isFinite(audit?.score) ? audit.score : null;
  const isOpportunity = audit?.details?.type === "opportunity";

  if (score != null && score < 0.5) {
    return { label: "High", className: "bg-[#5a2323] text-[#ffb4a8]" };
  }

  if (isOpportunity || (score != null && score < 0.85)) {
    return { label: "Medium", className: "bg-[#44351a] text-[#f3d088]" };
  }

  return { label: "Low", className: "bg-[#2b323f] text-[#bcc5d2]" };
}

function buildAuditReason(audit) {
  const description = normalizeAuditDescription(audit?.description);
  if (!description) return "Improves page responsiveness and user-perceived speed.";
  const firstSentence = extractFirstSentence(description);
  return firstSentence || description;
}

function extractFirstSentence(text) {
  if (typeof text !== "string") return "";
  const match = text.match(/[^.!?]+[.!?]/);
  return match ? match[0].trim() : text.trim();
}

function normalizeAuditDescription(description) {
  if (typeof description !== "string") return "";
  return description
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAuditQuickAction(audit) {
  const id = (audit?.id || "").toLowerCase();
  const title = (audit?.title || "").toLowerCase();

  if (id.includes("network-payload") || title.includes("payload")) {
    return "Compress assets, serve modern image formats, and defer non-critical resources.";
  }
  if (id.includes("interactive") || title.includes("interactive")) {
    return "Reduce JS execution time and split long tasks to improve interactivity.";
  }
  if (id.includes("largest-contentful-paint") || title.includes("largest contentful paint")) {
    return "Optimize hero content delivery: preload key assets and reduce render-blocking resources.";
  }
  if (id.includes("mainthread") || title.includes("main-thread")) {
    return "Cut heavy JavaScript work and move non-urgent logic off the critical path.";
  }
  return "Review this audit in Lighthouse and fix the highest-cost resource or script first.";
}

function formatMetric(value, unit) {
  if (!Number.isFinite(value)) return "--";
  if (unit === "millisecond") {
    if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
    return `${Math.round(value)} ms`;
  }
  if (unit === "unitless") {
    return value.toFixed(2);
  }
  return `${Math.round(value)}`;
}

function toChartMetric(value, unit) {
  if (!Number.isFinite(value)) return null;
  if (unit === "unitless") return Number((value * 1000).toFixed(0));
  return Math.round(value);
}

function getMetricRating(label, value) {
  if (!Number.isFinite(value)) return "unknown";
  if (label === "LCP") return thresholdRating(value, 2500, 4000);
  if (label === "INP") return thresholdRating(value, 200, 500);
  if (label === "CLS") return thresholdRating(value, 0.1, 0.25);
  if (label === "TBT") return thresholdRating(value, 200, 600);
  if (label === "FCP") return thresholdRating(value, 1800, 3000);
  if (label === "Speed Index") return thresholdRating(value, 3400, 5800);
  if (label === "TTFB") return thresholdRating(value, 800, 1800);
  return "unknown";
}

function thresholdRating(value, good, needsImprovement) {
  if (value <= good) return "good";
  if (value <= needsImprovement) return "needs-improvement";
  return "poor";
}

function normalizeRating(value) {
  if (!value) return "unknown";
  const normalized = String(value).toUpperCase();
  if (normalized === "FAST" || normalized === "GOOD") return "good";
  if (normalized === "AVERAGE" || normalized === "NEEDS_IMPROVEMENT") return "needs-improvement";
  if (normalized === "SLOW" || normalized === "POOR") return "poor";
  return "unknown";
}

function getScoreTone(score) {
  if (!Number.isFinite(score)) return "unknown";
  if (score >= 90) return "good";
  if (score >= 50) return "needs-improvement";
  return "poor";
}
