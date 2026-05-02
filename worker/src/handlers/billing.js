import { json } from "../lib/http.js";
import {
  buildBillingSummary,
  clearWorkspaceOpenBillingSession,
  createRazorpayOrder,
  fetchRazorpayPayment,
  getBillingCheckoutSession,
  getBillingPlanConfig,
  getRazorpayMode,
  getWorkspaceBilling,
  getWorkspaceOpenBillingSession,
  isRazorpayConfigured,
  isPaidBillingStatus,
  isPendingCheckoutSessionState,
  mergeBillingCheckoutSession,
  mergeWorkspaceBilling,
  saveBillingCheckoutSession,
  setWorkspaceOpenBillingSession,
  syncWorkspaceBillingFromRazorpay,
  verifyRazorpayOrderSignature,
  applyRazorpayPaymentToWorkspace,
  verifyRazorpayWebhookSignature,
} from "../services/billing.js";
import { getPlanUsageSnapshot } from "../services/planUsage.js";

const ACTIONABLE_PAYMENT_EVENTS = new Set([
  "payment.authorized",
  "payment.captured",
  "payment.failed",
]);

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

function buildCheckoutResponse(env, auth, workspace, session) {
  const plan = getBillingPlanConfig(session?.requestedPlan);
  return {
    key: env.RAZORPAY_KEY_ID,
    orderId: session.orderId,
    amount: session.amount,
    currency: session.currency || "INR",
    name: "PingMaster",
    description: `PingMaster ${plan.label} one-time payment`,
    prefill: {
      name: auth?.name || "",
      email: auth?.email || "",
    },
    notes: {
      workspaceId: workspace.id,
      workspaceName: workspace.name || "Workspace",
      planCode: session.requestedPlan,
    },
  };
}

export async function getBillingHandler(request, redis, auth, workspace, membership, env, corsHeaders) {
  if (!workspace?.id || !membership) {
    return json({ error: "Forbidden" }, 403, corsHeaders);
  }

  const isTeamWorkspace = workspace?.type === "team";
  const billing = await syncWorkspaceBillingFromRazorpay(redis, workspace, env);
  const checkoutSession = isTeamWorkspace ? null : await getWorkspaceOpenBillingSession(redis, workspace.id);
  const usage = isTeamWorkspace ? null : await getPlanUsageSnapshot(redis, auth.userId);
  return json({
    billing: buildBillingSummary(billing, {
      checkoutSession,
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
  if (requestedPlanCode !== "plus" && requestedPlanCode !== "pro") {
    return json({ error: "Select Plus or Pro to start checkout." }, 400, corsHeaders);
  }
  if (requestedPlan.code !== "free" && existingBilling.plan === requestedPlan.code && isPaidBillingStatus(existingBilling.status)) {
    return json({ error: `${requestedPlan.label} is already active for this workspace.` }, 409, corsHeaders);
  }

  const openSession = await getWorkspaceOpenBillingSession(redis, workspace.id);
  if (openSession && isPendingCheckoutSessionState(openSession.state)) {
    if (openSession.requestedPlan === requestedPlan.code) {
      return json({
        billing: buildBillingSummary(existingBilling, {
          checkoutSession: openSession,
          checkoutReady: true,
          mode: getRazorpayMode(env),
          manageable: true,
          workspaceType: workspace?.type || "personal",
        }),
        checkout: buildCheckoutResponse(env, auth, workspace, openSession),
        reused: true,
      }, 200, corsHeaders);
    }

    await mergeBillingCheckoutSession(redis, openSession.orderId, {
      state: "cancelled",
      reason: "superseded_by_new_checkout",
      lastEventType: "checkout.superseded",
    });
    await clearWorkspaceOpenBillingSession(redis, workspace.id, openSession.orderId);
  }

  try {
    const order = await createRazorpayOrder(env, workspace, auth, body);
    const planCode = typeof order?.notes?.plan_code === "string" ? order.notes.plan_code : (typeof body?.plan === "string" ? body.plan.trim().toLowerCase() : "");
    const plan = getBillingPlanConfig(planCode);
    const savedSession = await saveBillingCheckoutSession(redis, order.id, {
      orderId: order.id,
      workspaceId: workspace.id,
      requestedPlan: plan.code,
      previousPlan: existingBilling.plan,
      state: "created",
      amount: order.amount,
      currency: order.currency || "INR",
      receipt: order.receipt || null,
      paymentId: null,
      reason: "",
      createdAt: new Date().toISOString(),
    });
    await setWorkspaceOpenBillingSession(redis, workspace.id, order.id);
    const savedBilling = await mergeWorkspaceBilling(redis, workspace.id, {
      provider: "razorpay",
      plan: existingBilling.plan,
      pendingPlan: null,
      status: existingBilling.status,
      customerId: auth?.email || null,
      orderId: null,
      paymentId: existingBilling.paymentId || null,
      subscriptionId: null,
      razorpayPlanId: null,
    });
    if (order?.id) {
      await redis.set(getRazorpayOrderWorkspaceKey(order.id), {
        workspaceId: workspace.id,
        billingWorkspaceId: workspace.id,
        workspaceName: workspace.name || "Workspace",
        planCode: plan.code,
        createdAt: new Date().toISOString(),
      });
    }
    return json({
      billing: buildBillingSummary(savedBilling, {
        checkoutSession: savedSession,
        checkoutReady: true,
        mode: getRazorpayMode(env),
        manageable: true,
        workspaceType: workspace?.type || "personal",
      }),
      checkout: buildCheckoutResponse(env, auth, workspace, savedSession),
    }, 201, corsHeaders);
  } catch (err) {
    return json({ error: err?.message || "Could not create Razorpay checkout." }, 400, corsHeaders);
  }
}

export async function postBillingCancel(request, redis, auth, workspace, membership, env, corsHeaders) {
  if (membership?.role !== "owner") {
    return json({ error: "Only workspace owners can manage billing." }, 403, corsHeaders);
  }
  if (workspace?.type === "team") {
    return json({ error: "Plans can only be purchased from your personal workspace." }, 403, corsHeaders);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const requestedOrderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  const session = requestedOrderId
    ? await getBillingCheckoutSession(redis, requestedOrderId)
    : await getWorkspaceOpenBillingSession(redis, workspace.id);

  if (session?.workspaceId === workspace.id && isPendingCheckoutSessionState(session.state)) {
    await mergeBillingCheckoutSession(redis, session.orderId, {
      state: "cancelled",
      reason: "user_cancelled",
      lastEventType: "checkout.cancelled",
    });
    await clearWorkspaceOpenBillingSession(redis, workspace.id, session.orderId);
  }

  const billing = await syncWorkspaceBillingFromRazorpay(redis, workspace, env);
  return json({
    success: true,
    billing: buildBillingSummary(billing, {
      checkoutSession: null,
      checkoutReady: isRazorpayConfigured(env),
      mode: getRazorpayMode(env),
      manageable: true,
      workspaceType: workspace?.type || "personal",
    }),
  }, 200, corsHeaders);
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
    const existingSession = await getBillingCheckoutSession(redis, orderId);
    const mappedOrder = orderId ? await redis.get(getRazorpayOrderWorkspaceKey(orderId)) : null;
    const payment = await fetchRazorpayPayment(env, paymentId);
    const billingWorkspaceId = existingSession?.workspaceId || mappedOrder?.billingWorkspaceId || workspace.id;
    const currentBilling = await getWorkspaceBilling(redis, billingWorkspaceId);
    const nextSession = await mergeBillingCheckoutSession(redis, orderId, {
      workspaceId: billingWorkspaceId,
      requestedPlan: existingSession?.requestedPlan || mappedOrder?.planCode || currentBilling.plan,
      previousPlan: existingSession?.previousPlan || currentBilling.plan,
      state: payment?.status === "captured" ? "captured" : (payment?.status === "authorized" ? "authorized" : (payment?.status || "pending")),
      amount: existingSession?.amount || payment?.amount || 0,
      currency: existingSession?.currency || payment?.currency || "INR",
      paymentId,
      lastEventType: "checkout.verified",
    });

    let savedBilling = currentBilling;
    if (nextSession?.state === "captured") {
      savedBilling = await applyRazorpayPaymentToWorkspace(redis, billingWorkspaceId, payment, {
        orderId,
        paymentId,
        planCode: nextSession.requestedPlan,
        eventType: "checkout.verified",
        status: "active",
      });
      await clearWorkspaceOpenBillingSession(redis, billingWorkspaceId, orderId);
    } else if (nextSession?.state === "failed") {
      await clearWorkspaceOpenBillingSession(redis, billingWorkspaceId, orderId);
      savedBilling = await syncWorkspaceBillingFromRazorpay(redis, workspace, env);
    } else {
      savedBilling = await syncWorkspaceBillingFromRazorpay(redis, workspace, env);
    }

    return json({
      success: true,
      billing: buildBillingSummary(savedBilling, {
        checkoutSession: nextSession?.state === "captured" ? null : nextSession,
        checkoutReady: isRazorpayConfigured(env),
        mode: getRazorpayMode(env),
        manageable: true,
        workspaceType: workspace?.type || "personal",
      }),
    }, 200, corsHeaders);
  } catch (err) {
    return json({ error: err?.message || "Payment was verified, but the checkout state could not be refreshed." }, 400, corsHeaders);
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

  const shouldProcessPayment = ACTIONABLE_PAYMENT_EVENTS.has(eventType);
  if (!shouldProcessPayment) {
    await redis.set(dedupeKey, {
      processedAt: new Date().toISOString(),
      skipped: true,
      eventType,
      reason: "unsupported_event_type",
    });
    return json({ received: true, skipped: true }, 200, corsHeaders);
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

  const payment = payload?.payload?.payment?.entity;

  try {
    if (shouldProcessPayment && payment?.id) {
      const orderId = payment?.order_id || null;
      const existingSession = orderId ? await getBillingCheckoutSession(redis, orderId) : null;
      const currentBilling = await getWorkspaceBilling(redis, workspaceId);
      const nextSession = orderId
        ? await mergeBillingCheckoutSession(redis, orderId, {
          workspaceId,
          requestedPlan: existingSession?.requestedPlan || mappedOrder?.planCode || currentBilling.plan,
          previousPlan: existingSession?.previousPlan || currentBilling.plan,
          state: payment?.status === "captured" ? "captured" : (payment?.status === "authorized" ? "authorized" : (payment?.status || "pending")),
          amount: existingSession?.amount || payment?.amount || 0,
          currency: existingSession?.currency || payment?.currency || "INR",
          paymentId: payment?.id || null,
          lastEventId: dedupeKey,
          lastEventType: eventType,
        })
        : null;

      if (payment?.status === "captured") {
        await applyRazorpayPaymentToWorkspace(redis, workspaceId, payment, {
          orderId,
          paymentId: payment?.id || null,
          planCode: nextSession?.requestedPlan || mappedOrder?.planCode || null,
          eventId: dedupeKey,
          eventType,
          status: "active",
        });
        await clearWorkspaceOpenBillingSession(redis, workspaceId, orderId || "");
      } else if (payment?.status === "failed") {
        await clearWorkspaceOpenBillingSession(redis, workspaceId, orderId || "");
      }
    }
  } catch (err) {
    return json({ error: err?.message || "Could not process Razorpay webhook." }, 400, corsHeaders);
  }

  await redis.set(dedupeKey, { processedAt: new Date().toISOString() });
  return json({ received: true }, 200, corsHeaders);
}
