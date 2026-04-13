import { json } from "../lib/http.js";
import {
  applyRazorpayPaymentToWorkspace,
  applyRazorpaySubscriptionToWorkspace,
  buildBillingSummary,
  createRazorpayOrder,
  fetchRazorpayPayment,
  fetchRazorpaySubscription,
  getRazorpayMode,
  getWorkspaceBilling,
  isRazorpayConfigured,
  mergeWorkspaceBilling,
  verifyRazorpayOrderSignature,
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

function getRazorpayOrderWorkspaceKey(orderId) {
  return `razorpay_order_workspace:${orderId}`;
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
  if (existingBilling.plan === "pro" && ["authenticated", "active", "pending"].includes(existingBilling.status)) {
    return json({ error: "This workspace already has active Pro access." }, 409, corsHeaders);
  }

  try {
    const order = await createRazorpayOrder(env, workspace, auth, body);
    const savedBilling = await mergeWorkspaceBilling(redis, workspace.id, {
      provider: "razorpay",
      plan: "pro",
      status: "created",
      orderId: order?.id || null,
      paymentId: null,
      subscriptionId: null,
      customerId: auth?.email || null,
    });
    if (order?.id) {
      await redis.set(getRazorpayOrderWorkspaceKey(order.id), {
        workspaceId: workspace.id,
        workspaceName: workspace.name || "Workspace",
        createdAt: new Date().toISOString(),
      });
    }
    return json({
      billing: buildBillingSummary(savedBilling, {
        checkoutReady: true,
        mode: getRazorpayMode(env),
      }),
      checkout: {
        key: env.RAZORPAY_KEY_ID,
        amount: order.amount,
        currency: order.currency || "INR",
        orderId: order.id,
        name: "PingMaster",
        description: "PingMaster Pro workspace upgrade",
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

  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  const paymentId = typeof body?.paymentId === "string" ? body.paymentId.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";

  const valid = await verifyRazorpayOrderSignature(
    env.RAZORPAY_KEY_SECRET,
    orderId,
    paymentId,
    signature,
  );
  if (!valid) {
    return json({ error: "Razorpay payment signature verification failed." }, 400, corsHeaders);
  }

  try {
    const payment = await fetchRazorpayPayment(env, paymentId);
    const savedBilling = await applyRazorpayPaymentToWorkspace(redis, workspace.id, payment, {
      orderId,
      paymentId,
      eventType: "checkout.verified",
      status: payment?.status === "captured" ? "active" : payment?.status || "created",
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

  let workspaceId = getWorkspaceIdFromWebhook(payload);
  if (!workspaceId) {
    const orderId = payload?.payload?.payment?.entity?.order_id || "";
    if (orderId) {
      const mapped = await redis.get(getRazorpayOrderWorkspaceKey(orderId));
      workspaceId = mapped?.workspaceId || "";
    }
  }
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
    } else if (payment?.id) {
      await applyRazorpayPaymentToWorkspace(redis, workspaceId, payment, {
        orderId: payment?.order_id || null,
        paymentId: payment?.id || null,
        eventId: dedupeKey,
        eventType,
        status: payment?.status === "captured" ? "active" : payment?.status || "pending",
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
