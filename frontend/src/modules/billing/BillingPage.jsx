import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, CreditCard, ShieldCheck, Sparkles } from "lucide-react";
import PageLoader from "../../components/PageLoader";
import { createBillingSubscription, fetchBilling, verifyBillingSubscription } from "../../api";
import { useAuth } from "../../context/AuthContext";

const RAZORPAY_CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";
const PLAN_RANK = {
  free: 0,
  plus: 1,
  pro: 2,
};

let razorpayLoader = null;
const BILLING_SYNC_ATTEMPTS = 6;
const BILLING_SYNC_DELAY_MS = 1500;

function loadRazorpayCheckout() {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (razorpayLoader) return razorpayLoader;

  razorpayLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${RAZORPAY_CHECKOUT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.Razorpay)), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Razorpay checkout.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_URL;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => reject(new Error("Could not load Razorpay checkout."));
    document.body.appendChild(script);
  });

  return razorpayLoader;
}

export default function BillingPage() {
  const { user, workspace, workspaces, billing: sessionBilling, refreshSession, selectWorkspace } = useAuth();
  const [billingState, setBillingState] = useState(sessionBilling || null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("plus");

  const isTeamWorkspace = workspace?.type === "team";
  const personalWorkspace = useMemo(
    () => workspaces.find((item) => item.type === "personal") || null,
    [workspaces],
  );

  const loadBillingState = useCallback(async ({ silent = false } = {}) => {
    if (!user) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const payload = await fetchBilling(user, { force: true });
      setBillingState(payload?.billing || null);
    } catch (err) {
      setError(err?.message || "Could not load plan details.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setBillingState(sessionBilling || null);
  }, [sessionBilling]);

  useEffect(() => {
    loadBillingState();
  }, [loadBillingState, workspace?.id]);

  useEffect(() => {
    const lockedPlan = getLockedPlanCode(billingState);
    if (lockedPlan !== "free") {
      setSelectedPlan(lockedPlan);
      return;
    }
    setSelectedPlan((prev) => (prev === "free" ? "plus" : prev));
  }, [billingState?.isPaid, billingState?.plan, billingState?.pendingPlan, billingState?.status]);

  async function waitForPaidBillingState(expectedPlan) {
    for (let attempt = 0; attempt < BILLING_SYNC_ATTEMPTS; attempt += 1) {
      const payload = await fetchBilling(user, { force: true });
      const nextBilling = payload?.billing || null;
      setBillingState(nextBilling);
      if (nextBilling?.isPaid && nextBilling?.plan === expectedPlan) {
        return nextBilling;
      }
      if (attempt < BILLING_SYNC_ATTEMPTS - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, BILLING_SYNC_DELAY_MS));
      }
    }
    return null;
  }

  async function openCheckout(checkout) {
    const loaded = await loadRazorpayCheckout();
    if (!loaded || !window.Razorpay) {
      throw new Error("Razorpay checkout could not be loaded.");
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const finishReject = (reason) => {
        if (settled) return;
        settled = true;
        reject(reason);
      };

      const razorpay = new window.Razorpay({
        key: checkout.key,
        subscription_id: checkout.subscriptionId,
        recurring: true,
        name: checkout.name,
        description: checkout.description,
        prefill: checkout.prefill,
        notes: checkout.notes,
        theme: { color: "#f8fafc" },
        handler: async (response) => {
          try {
            await verifyBillingSubscription(user, {
              paymentId: response?.razorpay_payment_id || "",
              subscriptionId: response?.razorpay_subscription_id || checkout.subscriptionId || "",
              signature: response?.razorpay_signature || "",
            });
            finishResolve(response);
          } catch (err) {
            finishReject(err);
          }
        },
        modal: {
          ondismiss: () => finishResolve({ dismissed: true }),
        },
      });

      razorpay.open();
    });
  }

  async function handleStartCheckout() {
    const planToStart = getPlanRank(selectedPlan) < getPlanRank(getLockedPlanCode(billingState || sessionBilling || null))
      ? getLockedPlanCode(billingState || sessionBilling || null)
      : selectedPlan;
    if (planToStart === "free") return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const payload = await createBillingSubscription(user, { plan: planToStart });
      const checkoutResult = await openCheckout(payload?.checkout);
      const paidBilling = await waitForPaidBillingState(planToStart);
      if (!paidBilling?.isPaid || paidBilling?.plan !== planToStart) {
        if (checkoutResult?.dismissed) {
          throw new Error("Checkout closed before PingMaster could confirm the subscription. If Razorpay shows success, refresh once and it should sync.");
        }
        throw new Error("The subscription was received, but the new plan has not synced yet. Refresh in a moment and it should appear.");
      }
      await refreshSession();
      await loadBillingState({ silent: true });
      setSuccess(`${paidBilling.planLabel} is now active for your workspace.`);
    } catch (err) {
      setError(err?.message || "Could not complete Razorpay checkout.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSwitchToPersonalWorkspace() {
    if (!personalWorkspace?.id) return;
    await selectWorkspace(personalWorkspace.id);
  }

  if (loading) return <PageLoader rows={3} />;

  const billing = billingState || sessionBilling || null;
  const currentPlanCode = getPlanCode(billing?.plan);
  const lockedPlanCode = getLockedPlanCode(billing);
  const hasLockedPaidPlan = lockedPlanCode !== "free";
  const resolvedSelectedPlan = hasLockedPaidPlan && getPlanRank(selectedPlan) < getPlanRank(lockedPlanCode)
    ? lockedPlanCode
    : selectedPlan;
  const displayPlanCode = hasLockedPaidPlan ? lockedPlanCode : currentPlanCode;
  const displayPlanConfig = (billing?.availablePlans || []).find((plan) => plan.code === displayPlanCode) || null;
  const displayEntitlements = displayPlanConfig?.entitlements || billing?.entitlements || {};
  const selectedPlanConfig = (billing?.availablePlans || []).find((plan) => plan.code === resolvedSelectedPlan) || null;
  const isCurrentSelectionActive = resolvedSelectedPlan !== "free" && billing?.isPaid && billing?.plan === resolvedSelectedPlan;
  const isAttachedSelection = resolvedSelectedPlan !== "free" && resolvedSelectedPlan === lockedPlanCode && Boolean(billing?.subscriptionId);

  return (
    <div className="min-h-screen bg-[#08090b] text-[#f2f2f2]">
      <header className="border-b border-[#1a1d24] bg-[#0d0f13]">
        <div className="max-w-7xl mx-auto px-6 md:px-8 py-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Workspace Plans</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">Plans</h1>
            <p className="mt-2 text-sm text-[#8d94a0]">Pick the plan that matches your monitor count, shared workspaces, and public status page needs.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {billing?.mode ? (
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${billing.mode === "test" ? "border-amber-400/20 bg-amber-400/10 text-amber-100" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"}`}>
                {billing.mode === "test" ? "Razorpay Test Mode" : "Razorpay Live Mode"}
              </span>
            ) : null}
            <span className="inline-flex items-center rounded-full border border-[#2a2f39] bg-[#12161d] px-3 py-1 text-xs text-[#dbe1eb]">
              {billing?.planLabel || "Free"}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 md:px-8 py-8 space-y-6">
        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {success && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}
        {billing?.notice && <div className="rounded-xl border border-[#2b3442] bg-[#10141b] px-4 py-3 text-sm text-[#cfd6e3]">{billing.notice}</div>}
        {hasLockedPaidPlan ? (
          <div className="rounded-xl border border-[#2b3442] bg-[#10141b] px-4 py-3 text-sm text-[#cfd6e3]">
            {billing?.pendingPlan && billing.pendingPlan !== billing?.plan
              ? `${formatPlanLabel(billing.pendingPlan)} is syncing for this workspace. Lower plans stay locked until the billing state is settled.`
              : `${formatPlanLabel(lockedPlanCode)} is attached to this workspace. Lower plans stay locked here so the UI cannot drift below your real subscription.`}
          </div>
        ) : null}

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            label="Current Plan"
            value={displayPlanConfig?.label || billing?.planLabel || "Free"}
            helper={displayPlanConfig?.description || billing?.description || "Workspace plan"}
          />
          <MetricCard
            label="Plan Status"
            value={formatStatusLabel(billing?.status)}
            helper={billing?.isPaid ? "Paid access is active" : hasLockedPaidPlan ? "Paid plan is attached and syncing" : "Core access only"}
          />
          <MetricCard label="Renewal" value={formatDate(billing?.currentPeriodEnd)} helper={billing?.currentPeriodEnd ? "Current billing period end" : "No renewal scheduled"} />
        </section>

        {billing?.usage ? (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              label="Monitors Used"
              value={formatUsageValue(billing.usage.monitors, displayEntitlements?.maxMonitors)}
              helper="Across workspaces you own"
            />
            <MetricCard
              label="Status Pages"
              value={formatUsageValue(billing.usage.statusPages, displayEntitlements?.maxStatusPages)}
              helper="Published public status pages"
            />
            <MetricCard
              label="Shared Workspaces"
              value={formatUsageValue(billing.usage.teamWorkspaces, displayEntitlements?.maxTeamWorkspaces)}
              helper="Workspaces created from your personal workspace"
            />
          </section>
        ) : null}

        <section className="rounded-xl border border-[#22252b] bg-[#0f1217] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Choose the right plan</h2>
              <p className="mt-2 text-sm text-[#8d94a0]">Slack and Discord alerts are available on every plan. Plus unlocks shared workspaces and AI insights. Pro lifts the operating limits further.</p>
            </div>
            <div className="w-11 h-11 rounded-xl border border-[#252a33] bg-[#14181e] grid place-items-center shrink-0">
              <CreditCard className="w-5 h-5 text-[#dbe1eb]" />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 xl:grid-cols-3 gap-4">
            {(billing?.availablePlans || []).map((plan) => {
              const active = plan.code === currentPlanCode;
              const selected = plan.code === resolvedSelectedPlan;
              const lockedOut = hasLockedPaidPlan && getPlanRank(plan.code) < getPlanRank(lockedPlanCode);
              return (
                <button
                  key={plan.code}
                  type="button"
                  onClick={() => {
                    if (!lockedOut) setSelectedPlan(plan.code);
                  }}
                  disabled={lockedOut}
                  className={`rounded-xl border p-5 text-left transition ${selected ? "border-white/20 bg-[#171c25]" : "border-[#252a33] bg-[#14181e] hover:bg-[#171c25]"} ${active ? "shadow-[0_0_0_1px_rgba(255,255,255,0.06)]" : ""} ${lockedOut ? "cursor-not-allowed opacity-50 hover:bg-[#14181e]" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{plan.label}</h3>
                      <p className="mt-1 text-sm text-[#8d94a0]">{plan.description}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {active ? (
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] text-emerald-200">Current</span>
                      ) : null}
                      {lockedOut ? (
                        <span className="rounded-full border border-[#2b3442] bg-[#10141b] px-3 py-1 text-[11px] text-[#aab4c3]">Lower tier locked</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5">
                    <p className="text-2xl font-semibold text-white">{plan.priceMonthlyLabel || "Custom"}</p>
                    <p className="mt-1 text-xs text-[#6f7785]">Monthly recurring subscription</p>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {(plan.features || []).map((feature) => (
                      <FeatureRow key={feature} text={feature} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
          <section className="rounded-xl border border-[#22252b] bg-[#0f1217] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Selected plan details</h2>
                <p className="mt-2 text-sm text-[#8d94a0]">Review the limit changes before you start checkout.</p>
              </div>
              <div className="w-11 h-11 rounded-xl border border-[#252a33] bg-[#14181e] grid place-items-center shrink-0">
                <Sparkles className="w-5 h-5 text-[#dbe1eb]" />
              </div>
            </div>

            {selectedPlanConfig ? (
              <div className="mt-5 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <MetricCard
                    label="Monitors"
                    value={formatLimit(selectedPlanConfig.entitlements?.maxMonitors)}
                    helper="Parent monitors across your owned workspaces"
                  />
                  <MetricCard
                    label="Status Pages"
                    value={formatLimit(selectedPlanConfig.entitlements?.maxStatusPages)}
                    helper="Public pages you can publish"
                  />
                  <MetricCard
                    label="Shared Workspaces"
                    value={formatLimit(selectedPlanConfig.entitlements?.maxTeamWorkspaces)}
                    helper="Workspaces you can create for collaboration"
                  />
                </div>

                <div className="rounded-xl border border-[#252a33] bg-[#14181e] p-4 space-y-3">
                  <InfoLine icon={CheckCircle2} text="Slack, Discord, and email delivery are available across all plans." />
                  <InfoLine icon={ShieldCheck} text={selectedPlanConfig.entitlements?.canUseAiReports ? "AI insights are included in this plan." : "AI insights are not included in this plan."} />
                  <InfoLine icon={ArrowRight} text={resolvedSelectedPlan === "free" ? "Stay on Free for core monitoring." : "Razorpay verifies the subscription before the new plan is activated."} />
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-[#22252b] bg-[#0f1217] p-5 space-y-5">
            <div>
              <h2 className="text-xl font-semibold text-white">{isTeamWorkspace ? "Shared workspace billing" : "Plan checkout"}</h2>
              <p className="mt-2 text-sm text-[#8d94a0]">
                {isTeamWorkspace
                  ? "Shared workspaces inherit the owner's paid plan, but they cannot be purchased directly."
                  : billing?.mode === "test"
                    ? "This workspace is ready for Razorpay test subscriptions. Use test cards or test UPI in checkout."
                    : "Use this page to start or change a recurring paid plan for your personal workspace."}
              </p>
            </div>

            {isTeamWorkspace ? (
              <div className="rounded-xl border border-[#2b3442] bg-[#10141b] p-4 space-y-4">
                <p className="text-sm text-[#d5dcea]">Switch to your personal workspace to purchase, renew, or change plans. This shared workspace will continue to inherit that plan automatically.</p>
                <button
                  type="button"
                  onClick={handleSwitchToPersonalWorkspace}
                  disabled={!personalWorkspace?.id}
                  className="h-11 px-5 rounded-lg bg-white text-black text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                >
                  Open Personal Workspace
                </button>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-[#252a33] bg-[#14181e] p-4 space-y-3">
                  <InfoLine icon={ShieldCheck} text="Subscriptions unlock only after backend signature verification." />
                  <InfoLine icon={CheckCircle2} text="Webhook updates keep renewals and plan state in sync after the first checkout." />
                  <InfoLine icon={ArrowRight} text="Plus unlocks shared workspaces. Pro raises the limits further." />
                </div>

                <button
                  type="button"
                  onClick={handleStartCheckout}
                  disabled={submitting || !billing?.checkoutReady || resolvedSelectedPlan === "free" || isCurrentSelectionActive || isAttachedSelection}
                  className="h-11 px-5 rounded-lg bg-white text-black text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                >
                  {resolvedSelectedPlan === "free"
                    ? "Free Plan Selected"
                    : isCurrentSelectionActive || isAttachedSelection
                      ? `${selectedPlanConfig?.label || "Plan"} Already Active`
                      : submitting
                        ? "Opening Subscription..."
                        : `Start ${selectedPlanConfig?.label || "Selected"} Subscription`}
                </button>

                {resolvedSelectedPlan === "free" ? (
                  <div className="rounded-lg border border-[#252a33] bg-[#14181e] px-4 py-3 text-sm text-[#cfd6e3]">
                    Free stays active by default. Select Plus or Pro when you want higher limits.
                  </div>
                ) : null}

                {!billing?.checkoutReady ? (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    Razorpay keys are not configured yet.
                  </div>
                ) : null}
              </>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}

function MetricCard({ label, value, helper }) {
  return (
    <div className="rounded-xl border border-[#22252b] bg-[#0f1217] px-4 py-4">
      <p className="text-[10px] uppercase tracking-[0.08em] text-[#8d94a0]">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-[#6f7785]">{helper}</p>
    </div>
  );
}

function FeatureRow({ text }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-300 shrink-0">
        <CheckCircle2 className="w-3.5 h-3.5" />
      </span>
      <p className="text-sm text-[#dbe1eb]">{text}</p>
    </div>
  );
}

function InfoLine({ icon: Icon, text }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-[#cbd5e1] mt-0.5 shrink-0" />
      <p className="text-sm text-[#cbd5e1]">{text}</p>
    </div>
  );
}

function formatStatusLabel(value) {
  if (!value) return "--";
  if (value === "free") return "Free";
  return String(value)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function getPlanCode(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized in PLAN_RANK ? normalized : "free";
}

function getPlanRank(value) {
  return PLAN_RANK[getPlanCode(value)] ?? PLAN_RANK.free;
}

function getLockedPlanCode(billing) {
  const currentPlan = getPlanCode(billing?.plan);
  const pendingPlan = getPlanCode(billing?.pendingPlan);
  return getPlanRank(pendingPlan) > getPlanRank(currentPlan) ? pendingPlan : currentPlan;
}

function formatPlanLabel(value) {
  const planCode = getPlanCode(value);
  return planCode.charAt(0).toUpperCase() + planCode.slice(1);
}

function formatUsageValue(current, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return `${current || 0}`;
  return `${current || 0} / ${limit}`;
}

function formatLimit(limit) {
  if (!Number.isFinite(limit) || limit <= 0) return "Not included";
  return String(limit);
}
