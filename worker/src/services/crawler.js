import { getBaseEndpoint, isStaticPath } from "../lib/urls.js";

export async function runCrawler(baseUrl) {
  const MAX_PAGES = 50;
  const MAX_DEPTH = 2;
  const TIMEOUT_MS = 5000;
  const PARALLEL = 5;

  const origin = baseUrl.origin;
  const visited = new Set();
  const discovered = new Set();

  const seed = getBaseEndpoint(baseUrl.toString()) || baseUrl.origin;
  visited.add(seed);
  discovered.add(seed);

  const queue = [{ url: seed, depth: 0 }];

  while (queue.length > 0 && discovered.size < MAX_PAGES) {
    const batch = queue.splice(0, PARALLEL);
    const batchResults = await Promise.all(
      batch.map(({ url, depth }) => fetchPageLinks(url, depth, origin, TIMEOUT_MS, MAX_DEPTH))
    );

    for (const links of batchResults) {
      for (const item of links) {
        if (!visited.has(item.url) && discovered.size < MAX_PAGES) {
          visited.add(item.url);
          if (!isStaticPath(item.url)) {
            discovered.add(item.url);
          }
          queue.push(item);
        }
      }
    }
  }

  return [...discovered].sort((a, b) => {
    if (a === seed) return -1;
    if (b === seed) return 1;
    return a.localeCompare(b);
  });
}

async function fetchPageLinks(url, depth, origin, timeoutMs, maxDepth) {
  if (depth >= maxDepth) return [];

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "PingMaster-Crawler/1.0" },
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return [];

    const html = await response.text();
    const links = extractLinks(html, origin, url);
    return links.map((link) => ({ url: link, depth: depth + 1 }));
  } catch {
    return [];
  }
}

function extractLinks(html, origin, currentUrl) {
  const links = new Set();
  const hrefRegex = /href=["']([^"'#]+)["']/gi;
  const apiRegex = /["'`](\/(?:api|v\d+|graphql|rest|health|status|endpoint|ws|rpc)[^"'`\s?#]*)/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], currentUrl);
      if (resolved.origin === origin) {
        const clean = resolved.origin + resolved.pathname.replace(/\/$/, "");
        if ((clean !== origin || resolved.pathname === "/") && !isStaticPath(clean || origin)) {
          links.add(clean || origin);
        }
      }
    } catch {
      // Ignore bad href values.
    }
  }

  while ((match = apiRegex.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], origin);
      if (resolved.origin === origin) {
        const candidate = resolved.origin + resolved.pathname;
        if (!isStaticPath(candidate)) {
          links.add(candidate);
        }
      }
    } catch {
      // Ignore bad API-shaped paths.
    }
  }

  return [...links];
}
