const PAGE_EXTENSIONS = new Set([".html", ".htm", ".php", ".asp", ".aspx", ".jsp"]);
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

const NON_HTML_CONTENT_TYPES = [
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

const API_PATH_HINTS = ["/api", "/graphql", "/health", "/metrics", "/webhook", "/ping"];

export function buildPsiCapability(url, contentType = "") {
  const normalizedContentType = String(contentType || "").toLowerCase();
  const pathname = getPathname(url);
  const extension = getPathExtension(pathname);

  if (looksLikeStaticAsset(pathname, extension)) {
    return {
      psiEligible: false,
      psiReason: "This target looks like a file or static asset, so PageSpeed Insights audits are not available.",
    };
  }

  if (looksLikeApiPath(pathname) && !normalizedContentType.includes("text/html")) {
    return {
      psiEligible: false,
      psiReason: "This target looks like an API or service endpoint, so PageSpeed Insights audits are not available.",
    };
  }

  if (normalizedContentType.includes("text/html")) {
    return {
      psiEligible: true,
      psiReason: "This target looks like a webpage, so PageSpeed Insights audits are available.",
    };
  }

  if (matchesAnyContentType(normalizedContentType, NON_HTML_CONTENT_TYPES)) {
    return {
      psiEligible: false,
      psiReason: "This target does not return an HTML webpage, so PageSpeed Insights audits are not available.",
    };
  }

  if (extension && PAGE_EXTENSIONS.has(extension)) {
    return {
      psiEligible: true,
      psiReason: "This target looks like a webpage, so PageSpeed Insights audits are available.",
    };
  }

  if (!extension && !looksLikeApiPath(pathname)) {
    return {
      psiEligible: true,
      psiReason: "This target may be a webpage. PingMaster will allow a PageSpeed audit and confirm with Google PageSpeed Insights.",
    };
  }

  return {
    psiEligible: false,
    psiReason: "This target is still monitored normally, but PageSpeed Insights does not apply here.",
  };
}

export function attachPsiCapability(monitor, contentType = monitor?.lastContentType || "") {
  if (!monitor?.url) return monitor;
  return {
    ...monitor,
    ...buildPsiCapability(monitor.url, contentType),
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

function looksLikeStaticAsset(pathname, extension) {
  if (extension && STATIC_EXTENSIONS.has(extension)) {
    return true;
  }

  return pathname.includes("/assets/") || pathname.includes("/static/");
}

function looksLikeApiPath(pathname) {
  return API_PATH_HINTS.some((hint) => pathname === hint || pathname.startsWith(`${hint}/`));
}

function matchesAnyContentType(contentType, candidates) {
  return candidates.some((candidate) => contentType.includes(candidate));
}
