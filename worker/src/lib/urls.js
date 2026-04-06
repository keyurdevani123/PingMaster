export function getBaseEndpoint(url) {
  try {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return null;
  }
}

export function normalizeEndpointList(endpoints, monitorUrl) {
  const seen = new Set();
  const list = [];
  const baseEndpoint = getBaseEndpoint(monitorUrl);

  if (baseEndpoint) {
    seen.add(baseEndpoint);
    list.push(baseEndpoint);
  }

  for (const candidate of endpoints) {
    if (typeof candidate !== "string") continue;
    const cleaned = candidate.trim();
    if (!cleaned) continue;

    const endpoint = getBaseEndpoint(cleaned);
    if (!endpoint || isStaticPath(endpoint) || seen.has(endpoint)) continue;

    seen.add(endpoint);
    list.push(endpoint);
  }

  return list;
}

export function buildChildMonitorName(parentName, url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : parsed.hostname;
    return `${parentName} • ${path}`;
  } catch {
    return `${parentName} • endpoint`;
  }
}

export function isStaticPath(url) {
  try {
    const { pathname } = new URL(url);
    return /\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|pdf|txt|xml|zip|tar|gz|mp4|webm|mp3|wav|json)$/i.test(pathname);
  } catch {
    return false;
  }
}
