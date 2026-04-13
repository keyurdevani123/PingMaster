import { json } from "../lib/http.js";
import {
  applyRazorpaySubscriptionToWorkspace,
  buildBillingSummary,
  createRazorpaySubscription,
  fetchRazorpaySubscription,
  getRazorpayMode,
  getWorkspaceBilling,
  isRazorpayConfigured,
  mergeWorkspaceBilling,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
} from "../services/billing.js";

function getWebhookEventKey(eventType, payload) {
  const subscriptionId = payload?.payload?.subscription?.entity?.id || payload?.payload?.payment?.entity?.subscription_id || "";
  const paymentId = payload?.payload?.payment?.entity?.id || "";
  const createdAt = payload?.created_at || "";
  return `razorpay_event:${eventType}:${subscriptionId}:${paymentId}:${createdAt}`;
}

function getWorkspaceIdFromWebhook(payload) {
  return payload?.payload?.subscription?.entity?.notes?.workspace_id
    || payload?.payload?.payment?.entity?.notes?.workspace_id
    || "";
}

export async function getBillingHandler(request, redis, auth, workspace, membership, env, corsHeaders) {
  if (!workspace?.id || !membership) {
    return json({ error: "Forbidden" }, 403, corsHeaders);
  }

  const billing = await getWorkspaceBilling(redis, workspace);
  return json({
    billing: buildBillingSummary(billing, {
      checkoutReady: isRazorpayConfigured(env),
      mode: getRazorpayMode(env),
    }),
  }, 200, corsHeaders);
}

export async function postBillingSubscribe(request, redis, auth, workspace, membership, env, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can manage billing." }, 403, corsHeaders);
  }
  if (!isRazorpayConfigured(env)) {
    return json({ error: "Razorpay is not configured on the server yet." }, 503, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const existingBilling = await getWorkspaceBilling(redis, workspace);
  if (existingBilling.subscriptionId && ["authenticated", "active", "pending"].includes(existingBilling.status)) {
    return json({ error: "This workspace already has an active billing subscription." }, 409, corsHeaders);
  }

  try {
    const subscription = await createRazorpaySubscription(env, workspace, auth, body);
    const savedBilling = await applyRazorpaySubscriptionToWorkspace(redis, workspace.id, subscription, {
      status: subscription?.status || "created",
    });
    return json({
      billing: buildBillingSummary(savedBilling, {
        checkoutReady: true,
        mode: getRazorpayMode(env),
      }),
      checkout: {
        key: env.RAZORPAY_KEY_ID,
        subscriptionId: subscription.id,
        name: "PingMaster",
        description: "PingMaster Pro subscription",
        prefill: {
          name: auth?.name || "",
          email: auth?.email || "",
        },
        notes: {
          workspaceId: workspace.id,
          workspaceName: workspace.name || "Workspace",
        },
      },
    }, 201, corsHeaders);
  } catch (err) {
    return json({ error: err?.message || "Could not create Razorpay subscription." }, 400, corsHeaders);
  }
}

export async function postBillingVerify(request, redis, auth, workspace, membership, env, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can verify payments." }, 403, corsHeaders);
  }
  if (!env?.RAZORPAY_KEY_SECRET) {
    return json({ error: "Razorpay verification is not configured." }, 503, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const paymentId = typeof body?.paymentId === "string" ? body.paymentId.trim() : "";
  const subscriptionId = typeof body?.subscriptionId === "string" ? body.subscriptionId.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";

  const valid = await verifyRazorpayCheckoutSignature(
    env.RAZORPAY_KEY_SECRET,
    paymentId,
    subscriptionId,
    signature,
  );
  if (!valid) {
    return json({ error: "Razorpay payment signature verification failed." }, 400, corsHeaders);
  }

  try {
    const subscription = await fetchRazorpaySubscription(env, subscriptionId);
    const savedBilling = await applyRazorpaySubscriptionToWorkspace(redis, workspace.id, subscription, {
      paymentId,
      eventType: "checkout.verified",
    });
    return json({
      success: true,
      billing: buildBillingSummary(savedBilling, {
        checkoutReady: isRazorpayConfigured(env),
        mode: getRazorpayMode(env),
      }),
    }, 200, corsHeaders);
  } catch (err) {
    return json({ error: err?.message || "Payment was verified, but the subscription could not be refreshed." }, 400, corsHeaders);
  }
}

export async function postRazorpayWebhook(request, redis, env, corsHeaders) {
  if (!env?.RAZORPAY_WEBHOOK_SECRET) {
    return json({ error: "Razorpay webhook secret is not configured." }, 503, corsHeaders);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("X-Razorpay-Signature") || "";
  const valid = await verifyRazorpayWebhookSignature(env.RAZORPAY_WEBHOOK_SECRET, rawBody, signature);
  if (!valid) {
    return json({ error: "Invalid Razorpay webhook signature." }, 400, corsHeaders);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid webhook JSON payload." }, 400, corsHeaders);
  }

  const eventType = typeof payload?.event === "string" ? payload.event.trim() : "unknown";
  const dedupeKey = getWebhookEventKey(eventType, payload);
  const alreadyProcessed = await redis.get(dedupeKey);
  if (alreadyProcessed) {
    return json({ received: true, deduped: true }, 200, corsHeaders);
  }

  const workspaceId = getWorkspaceIdFromWebhook(payload);
  if (!workspaceId) {
    await redis.set(dedupeKey, { processedAt: new Date().toISOString(), skipped: true });
    return json({ received: true, skipped: true }, 200, corsHeaders);
  }

  const subscription = payload?.payload?.subscription?.entity;
  const payment = payload?.payload?.payment?.entity;

  try {
    if (subscription?.id) {
      await applyRazorpaySubscriptionToWorkspace(redis, workspaceId, subscription, {
        paymentId: payment?.id || null,
        eventId: dedupeKey,
        eventType,
      });
    } else if (payment?.subscription_id) {
      const fetchedSubscription = await fetchRazorpaySubscription(env, payment.subscription_id);
      await applyRazorpaySubscriptionToWorkspace(redis, workspaceId, fetchedSubscription, {
        paymentId: payment?.id || null,
        eventId: dedupeKey,
        eventType,
      });
    } else {
      await mergeWorkspaceBilling(redis, workspaceId, {
        paymentId: payment?.id || null,
        lastWebhookEventId: dedupeKey,
        lastWebhookEventType: eventType,
      });
    }
  } catch (err) {
    return json({ error: err?.message || "Could not process Razorpay webhook." }, 400, corsHeaders);
  }

  await redis.set(dedupeKey, { processedAt: new Date().toISOString() });
  return json({ received: true }, 200, corsHeaders);
}
