const FREE_PLAN = "free";
const PLUS_PLAN = "plus";
const PRO_PLAN = "pro";
const ACTIVE_BILLING_STATUSES = new Set(["authenticated", "active", "captured"]);
const DEFAULT_PLUS_AMOUNT_PAISA = 24900;
const DEFAULT_PRO_AMOUNT_PAISA = 79900;

const PLAN_CONFIG = {
  [FREE_PLAN]: {
    code: FREE_PLAN,
    label: "Free",
    description: "Core monitoring for a personal workspace.",
    priceMonthlyPaise: 0,
    priceMonthlyLabel: "Free",
    features: [
      "1 personal workspace",
      "Up to 5 monitors",
      "Slack, Discord, and email alerts",
      "1 public status page",
    ],
    entitlements: {
      canCreateTeamWorkspaces: false,
      canUsePremiumAlertChannels: true,
      canUseAiReports: false,
      maxMonitors: 5,
      maxStatusPages: 1,
      maxTeamWorkspaces: 0,
    },
  },
  [PLUS_PLAN]: {
    code: PLUS_PLAN,
    label: "Plus",
    description: "Team-ready reliability plan for growing products.",
    priceMonthlyPaise: DEFAULT_PLUS_AMOUNT_PAISA,
    priceMonthlyLabel: "Rs 249",
    features: [
      "Up to 5 shared workspaces",
      "Up to 20 monitors",
      "Slack, Discord, and email alerts",
      "Up to 5 public status pages",
      "AI insights included",
    ],
    entitlements: {
      canCreateTeamWorkspaces: true,
      canUsePremiumAlertChannels: true,
      canUseAiReports: true,
      maxMonitors: 20,
      maxStatusPages: 5,
      maxTeamWorkspaces: 5,
    },
  },
  [PRO_PLAN]: {
    code: PRO_PLAN,
    label: "Pro",
    description: "Advanced coverage for larger teams and higher monitor volume.",
    priceMonthlyPaise: DEFAULT_PRO_AMOUNT_PAISA,
    priceMonthlyLabel: "Rs 799",
    features: [
      "Up to 25 shared workspaces",
      "Up to 100 monitors",
      "Slack, Discord, and email alerts",
      "Up to 20 public status pages",
      "AI reliability insights",
      "Higher operating limits across the workspace",
    ],
    entitlements: {
      canCreateTeamWorkspaces: true,
      canUsePremiumAlertChannels: true,
      canUseAiReports: true,
      maxMonitors: 100,
      maxStatusPages: 20,
      maxTeamWorkspaces: 25,
    },
  },
};

export function getFeatureFlags() {
  return {
    homepage: true,
    statusPages: true,
    teamFoundation: true,
    geminiInsights: false,
    visibilityMonitoring: false,
    billing: true,
  };
}

function getWorkspaceBillingKey(workspaceId) {
  return `workspace_billing:${workspaceId}`;
}

function resolveBillingWorkspaceId(workspace) {
  return typeof workspace === "string"
    ? workspace
    : (workspace?.type === "team" && workspace?.sourceWorkspaceId
      ? workspace.sourceWorkspaceId
      : workspace?.id);
}

function normalizePlanCode(value) {
  return PLAN_CONFIG[value] ? value : FREE_PLAN;
}

export function getBillingPlanConfig(planCode) {
  return PLAN_CONFIG[normalizePlanCode(planCode)];
}

function normalizeStatus(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return "free";
  return text;
}

function toIsoString(value) {
  if (!value && value !== 0) return null;
  const date = typeof value === "number"
    ? new Date(value * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeBillingRecord(workspaceId, value = {}) {
  return {
    workspaceId,
    provider: value?.provider || "razorpay",
    plan: normalizePlanCode(value?.plan),
    pendingPlan: value?.pendingPlan ? normalizePlanCode(value.pendingPlan) : null,
    status: normalizeStatus(value?.status),
    customerId: value?.customerId || null,
    orderId: value?.orderId || null,
    subscriptionId: value?.subscriptionId || null,
    paymentId: value?.paymentId || null,
    razorpayPlanId: value?.razorpayPlanId || null,
    currentPeriodStart: toIsoString(value?.currentPeriodStart),
    currentPeriodEnd: toIsoString(value?.currentPeriodEnd),
    lastWebhookEventId: value?.lastWebhookEventId || null,
    lastWebhookEventType: value?.lastWebhookEventType || null,
    createdAt: toIsoString(value?.createdAt) || new Date().toISOString(),
    updatedAt: toIsoString(value?.updatedAt) || new Date().toISOString(),
  };
}

export function listBillingPlans() {
  return Object.values(PLAN_CONFIG).map((plan) => ({
    code: plan.code,
    label: plan.label,
    description: plan.description,
    priceMonthlyPaise: plan.priceMonthlyPaise,
    priceMonthlyLabel: plan.priceMonthlyLabel,
    features: [...plan.features],
    entitlements: { ...plan.entitlements },
  }));
}

export function isPaidBillingStatus(status) {
  return ACTIVE_BILLING_STATUSES.has(normalizeStatus(status));
}

export function getEntitlementsForBilling(billing) {
  const planCode = normalizePlanCode(billing?.plan);
  const normalized = planCode !== FREE_PLAN && isPaidBillingStatus(billing?.status)
    ? PLAN_CONFIG[planCode]
    : PLAN_CONFIG[FREE_PLAN];
  return { ...normalized.entitlements };
}

export function buildBillingSummary(billing, options = {}) {
  const plan = PLAN_CONFIG[normalizePlanCode(billing?.plan)];
  const status = normalizeStatus(billing?.status);
  const isPaid = plan.code !== FREE_PLAN && isPaidBillingStatus(status);
  return {
    provider: billing?.provider || "razorpay",
    plan: plan.code,
    planLabel: plan.label,
    pendingPlan: billing?.pendingPlan || null,
    pendingPlanLabel: billing?.pendingPlan ? getBillingPlanConfig(billing.pendingPlan).label : null,
    description: plan.description,
    priceMonthlyPaise: plan.priceMonthlyPaise,
    priceMonthlyLabel: plan.priceMonthlyLabel,
    status,
    isPaid,
    orderId: billing?.orderId || null,
    subscriptionId: billing?.subscriptionId || null,
    customerId: billing?.customerId || null,
    paymentId: billing?.paymentId || null,
    currentPeriodStart: billing?.currentPeriodStart || null,
    currentPeriodEnd: billing?.currentPeriodEnd || null,
    entitlements: getEntitlementsForBilling(billing),
    availablePlans: listBillingPlans(),
    checkoutReady: options.checkoutReady === true,
    mode: options.mode || null,
    manageable: options.manageable !== false,
    workspaceType: options.workspaceType || "personal",
    inheritedFromWorkspaceId: options.inheritedFromWorkspaceId || null,
    usage: options.usage || null,
    notice: options.notice || "",
  };
}

export async function getWorkspaceBilling(redis, workspace) {
  const workspaceId = resolveBillingWorkspaceId(workspace);
  if (!workspaceId) {
    return normalizeBillingRecord("", {});
  }
  const existing = await redis.get(getWorkspaceBillingKey(workspaceId));
  return normalizeBillingRecord(workspaceId, existing || {});
}

export async function saveWorkspaceBilling(redis, workspaceId, value) {
  const nextValue = normalizeBillingRecord(workspaceId, value);
  await redis.set(getWorkspaceBillingKey(workspaceId), nextValue);
  return nextValue;
}

export async function mergeWorkspaceBilling(redis, workspaceId, patch) {
  const current = await getWorkspaceBilling(redis, workspaceId);
  return saveWorkspaceBilling(redis, workspaceId, {
    ...current,
    ...patch,
    workspaceId,
    updatedAt: new Date().toISOString(),
  });
}

export function isRazorpayConfigured(env) {
  return Boolean(
    env?.RAZORPAY_KEY_ID
    && env?.RAZORPAY_KEY_SECRET
  );
}

export function getRazorpayMode(env) {
  const keyId = typeof env?.RAZORPAY_KEY_ID === "string" ? env.RAZORPAY_KEY_ID.trim() : "";
  if (!keyId) return null;
  return keyId.startsWith("rzp_test_") ? "test" : "live";
}

function getBasicAuthHeader(keyId, keySecret) {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

async function parseRazorpayResponse(response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

async function requestRazorpay(env, path, options = {}) {
  const keyId = env?.RAZORPAY_KEY_ID;
  const keySecret = env?.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Razorpay keys are not configured.");
  }

  const response = await fetch(`https://api.razorpay.com${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: getBasicAuthHeader(keyId, keySecret),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await parseRazorpayResponse(response);
  if (!response.ok) {
    throw new Error(payload?.error?.description || payload?.description || "Razorpay request failed.");
  }
  return payload;
}

export async function createRazorpaySubscription(env, workspace, auth, options = {}) {
  const planCode = normalizePlanCode(options?.plan);
  if (planCode === FREE_PLAN) {
    throw new Error("The Free plan does not require checkout.");
  }
  const planId = planCode === PLUS_PLAN ? env?.RAZORPAY_PLAN_ID_PLUS : env?.RAZORPAY_PLAN_ID_PRO;
  if (!planId) {
    throw new Error(`Razorpay ${getBillingPlanConfig(planCode).label} plan is not configured.`);
  }

  return requestRazorpay(env, "/v1/subscriptions", {
    method: "POST",
    body: {
      plan_id: planId,
      total_count: 1200,
      quantity: 1,
      customer_notify: 1,
      notes: {
        workspace_id: workspace?.id || "",
        workspace_name: workspace?.name || "Workspace",
        owner_user_id: auth?.userId || "",
        owner_email: auth?.email || "",
        plan_code: planCode,
      },
    },
  });
}

function getPlanAmountPaise(env, planCode) {
  const envKey = planCode === PLUS_PLAN ? "RAZORPAY_PLUS_AMOUNT_PAISA" : "RAZORPAY_PRO_AMOUNT_PAISA";
  const fallback = planCode === PLUS_PLAN ? DEFAULT_PLUS_AMOUNT_PAISA : DEFAULT_PRO_AMOUNT_PAISA;
  const raw = typeof env?.[envKey] === "string" ? env[envKey].trim() : "";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function createRazorpayOrder(env, workspace, auth, options = {}) {
  const planCode = normalizePlanCode(options?.plan);
  if (planCode === FREE_PLAN) {
    throw new Error("The Free plan does not require checkout.");
  }

  const amount = getPlanAmountPaise(env, planCode);
  const receiptSuffix = `${Date.now()}`.slice(-10);
  const plan = getBillingPlanConfig(planCode);

  return requestRazorpay(env, "/v1/orders", {
    method: "POST",
    body: {
      amount,
      currency: "INR",
      receipt: `pm_${receiptSuffix}_${String(workspace?.id || "").slice(-10)}`,
      notes: {
        workspace_id: workspace?.id || "",
        workspace_name: workspace?.name || "Workspace",
        owner_user_id: auth?.userId || "",
        owner_email: auth?.email || "",
        plan_code: planCode,
        plan_label: plan.label,
      },
    },
  });
}

export async function fetchRazorpaySubscription(env, subscriptionId) {
  if (!subscriptionId) {
    throw new Error("Subscription ID is required.");
  }
  return requestRazorpay(env, `/v1/subscriptions/${subscriptionId}`);
}

export async function fetchRazorpayPayment(env, paymentId) {
  if (!paymentId) {
    throw new Error("Payment ID is required.");
  }
  return requestRazorpay(env, `/v1/payments/${paymentId}`);
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function createHmacHex(secret, payload) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyRazorpayCheckoutSignature(secret, paymentId, subscriptionId, signature) {
  if (!secret || !paymentId || !subscriptionId || !signature) return false;
  const generated = await createHmacHex(secret, `${paymentId}|${subscriptionId}`);
  return generated === String(signature).trim();
}

export async function verifyRazorpayOrderSignature(secret, orderId, paymentId, signature) {
  if (!secret || !orderId || !paymentId || !signature) return false;
  const generated = await createHmacHex(secret, `${orderId}|${paymentId}`);
  return generated === String(signature).trim();
}

export async function verifyRazorpayWebhookSignature(secret, rawBody, signature) {
  if (!secret || !rawBody || !signature) return false;
  const generated = await createHmacHex(secret, rawBody);
  return generated === String(signature).trim();
}

export async function applyRazorpaySubscriptionToWorkspace(redis, workspaceId, subscription, options = {}) {
  if (!workspaceId || !subscription) {
    throw new Error("Workspace billing update requires a workspace and subscription.");
  }

  return mergeWorkspaceBilling(redis, workspaceId, {
    provider: "razorpay",
    plan: normalizePlanCode(subscription?.notes?.plan_code || options.planCode || PRO_PLAN),
    pendingPlan: null,
    status: normalizeStatus(subscription?.status || options.status || "created"),
    customerId: subscription?.customer_id || null,
    orderId: options.orderId || null,
    subscriptionId: subscription?.id || options.subscriptionId || null,
    paymentId: options.paymentId || null,
    razorpayPlanId: subscription?.plan_id || null,
    currentPeriodStart: toIsoString(subscription?.current_start),
    currentPeriodEnd: toIsoString(subscription?.current_end),
    lastWebhookEventId: options.eventId || null,
    lastWebhookEventType: options.eventType || null,
  });
}

export async function applyRazorpayPaymentToWorkspace(redis, workspaceId, payment, options = {}) {
  if (!workspaceId || !payment) {
    throw new Error("Workspace billing update requires a workspace and payment.");
  }

  return mergeWorkspaceBilling(redis, workspaceId, {
    provider: "razorpay",
    plan: normalizePlanCode(payment?.notes?.plan_code || options.planCode || PRO_PLAN),
    pendingPlan: null,
    status: normalizeStatus(options.status || (payment?.status === "captured" ? "active" : payment?.status || "created")),
    customerId: payment?.email || payment?.contact || null,
    orderId: payment?.order_id || options.orderId || null,
    subscriptionId: payment?.subscription_id || null,
    paymentId: payment?.id || options.paymentId || null,
    razorpayPlanId: payment?.notes?.plan_id || null,
    currentPeriodStart: toIsoString(options.currentPeriodStart || Date.now()),
    currentPeriodEnd: toIsoString(options.currentPeriodEnd || null),
    lastWebhookEventId: options.eventId || null,
    lastWebhookEventType: options.eventType || null,
  });
}

export async function syncWorkspaceBillingFromRazorpay(redis, workspace, env) {
  const workspaceId = resolveBillingWorkspaceId(workspace);
  const billing = await getWorkspaceBilling(redis, workspaceId);
  if (!workspaceId || !isRazorpayConfigured(env)) {
    return billing;
  }

  const hasPendingPaidState = billing.plan !== FREE_PLAN && (!isPaidBillingStatus(billing.status) || Boolean(billing.pendingPlan));
  if (!hasPendingPaidState || !billing.subscriptionId) {
    return billing;
  }

  try {
    const subscription = await fetchRazorpaySubscription(env, billing.subscriptionId);
    return applyRazorpaySubscriptionToWorkspace(redis, workspaceId, subscription, {
      paymentId: billing.paymentId || null,
      planCode: billing.pendingPlan || billing.plan,
      eventType: "billing.sync",
    });
  } catch {
    return billing;
  }
}
