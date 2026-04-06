import { json } from "../lib/http.js";
import { getBaseEndpoint } from "../lib/urls.js";
import { runCrawler } from "../services/crawler.js";
import { checkEndpoint, runPinger } from "../services/monitoring.js";

export async function pingNow(redis, env, corsHeaders) {
  await runPinger(redis, env);
  return json({ ok: true, message: "Pinger ran successfully" }, 200, corsHeaders);
}

export async function pingDiagnostics(request, userId, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const targetUrl = typeof body?.url === "string" ? body.url.trim() : "";
  if (!targetUrl) return json({ error: "url is required" }, 400, corsHeaders);

  const normalized = getBaseEndpoint(targetUrl);
  if (!normalized) return json({ error: "Invalid URL" }, 400, corsHeaders);

  const result = await checkEndpoint(normalized, 1);
  return json({ url: normalized, ...result }, 200, corsHeaders);
}

export async function crawlSite(request, userId, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const { url } = body;
  if (!url) return json({ error: "url is required" }, 400, corsHeaders);

  let baseUrl;
  try {
    baseUrl = new URL(url);
  } catch {
    return json({ error: "Invalid URL" }, 400, corsHeaders);
  }

  const urls = await runCrawler(baseUrl);
  return json({ urls }, 200, corsHeaders);
}
