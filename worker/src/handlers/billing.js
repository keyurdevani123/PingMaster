import { json } from "../lib/http.js";
import {
  applyRazorpaySubscriptionToWorkspace,
  buildBillingSummary,
  createRazorpaySubscription,
  fetchRazorpaySubscription,
  getBillingPlanConfig,
  getRazorpayMode,
  isRazorpayConfigured,
  isPaidBillingStatus,
  mergeWorkspaceBilling,
  syncWorkspaceBillingFromRazorpay,
  verifyRazorpayCheckoutSignature,
  applyRazorpayPaymentToWorkspace,
  verifyRazorpayWebhookSignature,
} from "../services/billing.js";
import { getPlanUsageSnapshot } from "../services/planUsage.js";

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

function getRazorpaySubscriptionWorkspaceKey(subscriptionId) {
  return `razorpay_subscription_workspace:${subscriptionId}`;
}

export async function getBillingHandler(request, redis, auth, workspace, membership, env, corsHeaders) {
  if (!workspace?.id || !membership) {
    return json({ error: "Forbidden" }, 403, corsHeaders);
  }

  const isTeamWorkspace = workspace?.type === "team";
  const billing = await syncWorkspaceBillingFromRazorpay(redis, workspace, env);
  const usage = isTeamWorkspace ? null : await getPlanUsageSnapshot(redis, auth.userId);
  return json({
    billing: buildBillingSummary(billing, {
      checkoutReady: isRazorpayConfigured(env) && membership?.role === "owner" && !isTeamWorkspace,
      mode: getRazorpayMode(env),
      manageable: membership?.role === "owner" && !isTeamWorkspace,
      workspaceType: workspace?.type || "personal",
      inheritedFromWorkspaceId: isTeamWorkspace ? workspace?.sourceWorkspaceId || null : null,
      usage,
      notice: isTeamWorkspace
        ? "Shared workspaces inherit the owner's plan. Switch to your personal workspace to start or change a paid plan."
        : "",
    }),
  }, 200, corsHeaders);
}

export async function postBillingSubscribe(request, redis, auth, workspace, membership, env, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can manage billing." }, 403, corsHeaders);
  }
  if (workspace?.type === "team") {
    return json({ error: "Plans can only be purchased from your personal workspace." }, 403, corsHeaders);
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

  const existingBilling = await syncWorkspaceBillingFromRazorpay(redis, workspace, env);
  const requestedPlanCode = typeof body?.plan === "string" ? body.plan.trim().toLowerCase() : "";
  const requestedPlan = getBillingPlanConfig(requestedPlanCode);
  if (requestedPlan.code !== "free" && existingBilling.plan === requestedPlan.code && isPaidBillingStatus(existingBilling.status)) {
    return json({ error: `${requestedPlan.label} is already active for this workspace.` }, 409, corsHeaders);
  }
  if (
    requestedPlan.code !== "free"
    && existingBilling.plan === requestedPlan.code
    && existingBilling.subscriptionId
    && ["created", "authenticated", "active", "pending"].includes(String(existingBilling.status || "").toLowerCase())
  ) {
    return json({
      error: existingBilling.status === "active"
        ? `${requestedPlan.label} is already active for this workspace.`
        : `${requestedPlan.label} is already attached to this workspace and is still syncing. Refresh once before starting another checkout.`,
    }, 409, corsHeaders);
  }

  try {
    const subscription = await createRazorpaySubscription(env, workspace, auth, body);
    const planCode = typeof subscription?.notes?.plan_code === "string" ? subscription.notes.plan_code : (typeof body?.plan === "string" ? body.plan.trim().toLowerCase() : "");
    const plan = getBillingPlanConfig(planCode);
    const keepCurrentPaidPlan = existingBilling.plan !== "free" && isPaidBillingStatus(existingBilling.status) && existingBilling.plan !== plan.code;
    const savedBilling = await mergeWorkspaceBilling(redis, workspace.id, {
      provider: "razorpay",
      plan: keepCurrentPaidPlan ? existingBilling.plan : plan.code,
      pendingPlan: keepCurrentPaidPlan ? plan.code : null,
      status: subscription?.status || "created",
      orderId: null,
      paymentId: null,
      subscriptionId: subscription?.id || null,
      customerId: auth?.email || null,
      razorpayPlanId: subscription?.plan_id || null,
    });
    if (subscription?.id) {
      await redis.set(getRazorpaySubscriptionWorkspaceKey(subscription.id), {
        workspaceId: workspace.id,
        billingWorkspaceId: workspace.id,
        workspaceName: workspace.name || "Workspace",
        planCode: plan.code,
        createdAt: new Date().toISOString(),
      });
    }
    return json({
      billing: buildBillingSummary(savedBilling, {
        checkoutReady: true,
        mode: getRazorpayMode(env),
        manageable: true,
        workspaceType: workspace?.type || "personal",
      }),
      checkout: {
        key: env.RAZORPAY_KEY_ID,
        subscriptionId: subscription.id,
        name: "PingMaster",
        description: `PingMaster ${plan.label} plan`,
        prefill: {
          name: auth?.name || "",
          email: auth?.email || "",
        },
        notes: {
          workspaceId: workspace.id,
          workspaceName: workspace.name || "Workspace",
          planCode: plan.code,
        },
      },
    }, 201, corsHeaders);
  } catch (err) {
    return json({ error: err?.message || "Could not create Razorpay checkout." }, 400, corsHeaders);
  }
}

export async function postBillingVerify(request, redis, auth, workspace, membership, env, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can verify payments." }, 403, corsHeaders);
  }
  if (workspace?.type === "team") {
    return json({ error: "Plans can only be verified from your personal workspace." }, 403, corsHeaders);
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
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  const subscriptionId = typeof body?.subscriptionId === "string" ? body.subscriptionId.trim() : "";

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
    const mappedSubscription = subscriptionId ? await redis.get(getRazorpaySubscriptionWorkspaceKey(subscriptionId)) : null;
    const fetchedSubscription = await fetchRazorpaySubscription(env, subscriptionId);
    const billingWorkspaceId = mappedSubscription?.billingWorkspaceId || workspace.id;
    const savedBilling = await applyRazorpaySubscriptionToWorkspace(redis, billingWorkspaceId, fetchedSubscription, {
      paymentId,
      subscriptionId,
      planCode: mappedSubscription?.planCode || null,
      eventType: "checkout.verified",
    });
    return json({
      success: true,
      billing: buildBillingSummary(savedBilling, {
        checkoutReady: isRazorpayConfigured(env),
        mode: getRazorpayMode(env),
        manageable: true,
        workspaceType: workspace?.type || "personal",
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
  let mappedOrder = null;
  let mappedSubscription = null;
  const paymentSubscriptionId = payload?.payload?.payment?.entity?.subscription_id || "";
  const subscriptionId = payload?.payload?.subscription?.entity?.id || paymentSubscriptionId;
  if (!workspaceId && subscriptionId) {
    mappedSubscription = await redis.get(getRazorpaySubscriptionWorkspaceKey(subscriptionId));
    workspaceId = mappedSubscription?.billingWorkspaceId || mappedSubscription?.workspaceId || "";
  }
  if (!workspaceId) {
    const orderId = payload?.payload?.payment?.entity?.order_id || "";
    if (orderId) {
      mappedOrder = await redis.get(getRazorpayOrderWorkspaceKey(orderId));
      workspaceId = mappedOrder?.billingWorkspaceId || mappedOrder?.workspaceId || "";
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
        planCode: mappedSubscription?.planCode || mappedOrder?.planCode || null,
        eventId: dedupeKey,
        eventType,
      });
    } else if (payment?.subscription_id) {
      const fetchedSubscription = await fetchRazorpaySubscription(env, payment.subscription_id);
      await applyRazorpaySubscriptionToWorkspace(redis, workspaceId, fetchedSubscription, {
        paymentId: payment?.id || null,
        planCode: mappedSubscription?.planCode || mappedOrder?.planCode || null,
        eventId: dedupeKey,
        eventType,
      });
    } else if (payment?.id) {
      await applyRazorpayPaymentToWorkspace(redis, workspaceId, payment, {
        orderId: payment?.order_id || null,
        paymentId: payment?.id || null,
        planCode: mappedOrder?.planCode || null,
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
