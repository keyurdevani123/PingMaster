const STATIC_EXTENSIONS = new Set([
  ".json",
  ".xml",
  ".txt",
  ".csv",
  ".pdf",
  ".zip",
  ".gz",
  ".rar",
  ".7z",
  ".css",
  ".js",
  ".mjs",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".map",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".ogg",
]);

const NON_HTML_TYPES = [
  "application/json",
  "application/xml",
  "text/xml",
  "text/plain",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/octet-stream",
  "application/pdf",
  "image/",
  "audio/",
  "video/",
  "font/",
];

const API_HINTS = ["/api", "/graphql", "/health", "/metrics", "/webhook", "/ping"];

export function normalizeMonitorPsiCapability(monitor) {
  if (!monitor?.url) return monitor;

  const contentType = String(monitor.lastContentType || "").toLowerCase();
  const pathname = getPathname(monitor.url);
  const extension = getPathExtension(pathname);

  let capability;
  if ((extension && STATIC_EXTENSIONS.has(extension)) || pathname.includes("/assets/") || pathname.includes("/static/")) {
    capability = {
      psiEligible: false,
      psiReason: "This target looks like a file or static asset, so PageSpeed Insights audits are not available.",
    };
  } else if (contentType.includes("text/html")) {
    capability = {
      psiEligible: true,
      psiReason: "This target looks like a webpage, so PageSpeed Insights audits are available.",
    };
  } else if (API_HINTS.some((hint) => pathname === hint || pathname.startsWith(`${hint}/`))) {
    capability = {
      psiEligible: false,
      psiReason: "This target looks like an API or service endpoint, so PageSpeed Insights audits are not available.",
    };
  } else if (NON_HTML_TYPES.some((type) => contentType.includes(type))) {
    capability = {
      psiEligible: false,
      psiReason: "This target does not return an HTML webpage, so PageSpeed Insights audits are not available.",
    };
  } else {
    capability = {
      psiEligible: true,
      psiReason: "This target may be a webpage. PingMaster will allow a PageSpeed audit and confirm with Google PageSpeed Insights.",
    };
  }

  return {
    ...monitor,
    ...capability,
  };
}

function getPathname(url) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function getPathExtension(pathname) {
  const lastSegment = pathname.split("/").filter(Boolean).pop() || "";
  const match = lastSegment.match(/(\.[a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}
