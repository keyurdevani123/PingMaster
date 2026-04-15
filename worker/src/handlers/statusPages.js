import { json } from "../lib/http.js";
import { getBillingPlanConfig, getEntitlementsForBilling, getWorkspaceBilling } from "../services/billing.js";
import { countOwnedStatusPages } from "../services/planUsage.js";
import {
  listStatusPages,
  loadStatusPage,
  loadStatusPageBySlug,
  normalizeStatusPageInput,
  saveStatusPage,
  getPublicStatusPayloadCached,
} from "../services/statusPages.js";

export async function getStatusPages(request, redis, auth, workspace, membership, corsHeaders) {
  return json(await listStatusPages(redis, auth.userId, workspace.id), 200, corsHeaders);
}

export async function createStatusPage(request, redis, auth, workspace, membership, corsHeaders) {
  if (!["owner", "admin"].includes(membership?.role)) {
    return json({ error: "Only workspace owners and admins can create status pages." }, 403, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const billing = await getWorkspaceBilling(redis, workspace);
  const entitlements = getEntitlementsForBilling(billing);
  const ownedStatusPageCount = await countOwnedStatusPages(redis, auth.userId);
  if (Number.isFinite(entitlements.maxStatusPages) && ownedStatusPageCount >= entitlements.maxStatusPages) {
    const currentPlan = getBillingPlanConfig(billing?.plan);
    return json({
      error: `Your ${currentPlan.label} plan includes up to ${entitlements.maxStatusPages} status page${entitlements.maxStatusPages === 1 ? "" : "s"}. Upgrade to publish more.`,
    }, 403, corsHeaders);
  }

  const statusPage = normalizeStatusPageInput(workspace.id, auth.userId, body);
  if (!statusPage.name) return json({ error: "name is required" }, 400, corsHeaders);
  if (!statusPage.slug) return json({ error: "slug is required" }, 400, corsHeaders);

  const existingSlug = await loadStatusPageBySlug(redis, statusPage.slug);
  if (existingSlug) {
    return json({ error: "slug is already in use" }, 400, corsHeaders);
  }

  await saveStatusPage(redis, statusPage);
  return json(statusPage, 201, corsHeaders);
}

export async function updateStatusPage(request, redis, auth, workspace, membership, statusPageId, corsHeaders) {
  if (!["owner", "admin"].includes(membership?.role)) {
    return json({ error: "Only workspace owners and admins can update status pages." }, 403, corsHeaders);
  }

  const existing = await loadStatusPage(redis, statusPageId, workspace.id);
  if (!existing) return json({ error: "Status page not found" }, 404, corsHeaders);
  if (existing.workspaceId !== workspace.id) {
    return json({ error: "Forbidden" }, 403, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const next = normalizeStatusPageInput(workspace.id, auth.userId, body, existing);
  if (!next.name) return json({ error: "name is required" }, 400, corsHeaders);
  if (!next.slug) return json({ error: "slug is required" }, 400, corsHeaders);

  if (next.slug !== existing.slug) {
    const conflict = await loadStatusPageBySlug(redis, next.slug);
    if (conflict && conflict.id !== existing.id) {
      return json({ error: "slug is already in use" }, 400, corsHeaders);
    }
    await redis.del(`status_page:slug:${existing.slug}`);
  }

  await saveStatusPage(redis, next);
  return json(next, 200, corsHeaders);
}

export async function getPublicStatusPage(request, redis, slug, corsHeaders) {
  const page = await loadStatusPageBySlug(redis, slug);
  if (!page || page.isPublic === false) {
    return json({ error: "Status page not found" }, 404, corsHeaders);
  }

  return json(await getPublicStatusPayloadCached(redis, page), 200, corsHeaders);
}
