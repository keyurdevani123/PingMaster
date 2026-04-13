import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, CreditCard, ShieldCheck } from "lucide-react";
import PageLoader from "../../components/PageLoader";
import { createBillingSubscription, fetchBilling, verifyBillingSubscription } from "../../api";
import { useAuth } from "../../context/AuthContext";

const RAZORPAY_CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";

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
  const { user, workspace, billing: sessionBilling, refreshSession } = useAuth();
  const [billingState, setBillingState] = useState(sessionBilling || null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadBillingState = useCallback(async ({ silent = false } = {}) => {
    if (!user) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const payload = await fetchBilling(user);
      setBillingState(payload?.billing || null);
    } catch (err) {
      setError(err?.message || "Could not load billing details.");
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

  async function waitForPaidBillingState() {
    for (let attempt = 0; attempt < BILLING_SYNC_ATTEMPTS; attempt += 1) {
      const payload = await fetchBilling(user, { force: true });
      const nextBilling = payload?.billing || null;
      setBillingState(nextBilling);
      if (nextBilling?.isPaid && nextBilling?.plan === "pro") {
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
        order_id: checkout.orderId,
        amount: checkout.amount,
        currency: checkout.currency || "INR",
        name: checkout.name,
        description: checkout.description,
        prefill: checkout.prefill,
        notes: checkout.notes,
        theme: { color: "#f8fafc" },
        handler: async (response) => {
          try {
            await verifyBillingSubscription(user, {
              orderId: response?.razorpay_order_id || "",
              paymentId: response?.razorpay_payment_id || "",
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
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const payload = await createBillingSubscription(user, { plan: "pro" });
      const checkoutResult = await openCheckout(payload?.checkout);
      const paidBilling = await waitForPaidBillingState();
      if (!paidBilling?.isPaid || paidBilling?.plan !== "pro") {
        if (checkoutResult?.dismissed) {
          throw new Error("Checkout closed before PingMaster could confirm the payment. If Razorpay shows success, refresh once and try again.");
        }
        throw new Error("Payment was received, but Pro access has not synced yet. Refresh in a moment and it should appear.");
      }
      await refreshSession();
      await loadBillingState({ silent: true });
      setSuccess("Test payment verified. Pro access is now active for this workspace.");
    } catch (err) {
      setError(err?.message || "Could not complete Razorpay checkout.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader rows={3} />;

  const billing = billingState || sessionBilling || null;
  const isPro = Boolean(billing?.isPaid && billing?.plan === "pro");

  return (
    <div className="min-h-screen bg-[#08090b] text-[#f2f2f2]">
      <header className="border-b border-[#1a1d24] bg-[#0d0f13]">
        <div className="max-w-7xl mx-auto px-6 md:px-8 py-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8d94a0]">Workspace Billing</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">Billing</h1>
            <p className="mt-2 text-sm text-[#8d94a0]">Use Razorpay test mode first, verify payment flow locally, then switch to live keys later.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${billing?.mode === "test" ? "border-amber-400/20 bg-amber-400/10 text-amber-100" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"}`}>
              {billing?.mode === "test" ? "Razorpay Test Mode" : "Razorpay Live Mode"}
            </span>
            <span className="inline-flex items-center rounded-full border border-[#2a2f39] bg-[#12161d] px-3 py-1 text-xs text-[#dbe1eb]">
              {billing?.planLabel || "Free"}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 md:px-8 py-8 space-y-6">
        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {success && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard label="Plan" value={billing?.planLabel || "Free"} helper={billing?.description || "Workspace plan"} />
          <MetricCard label="Status" value={formatStatusLabel(billing?.status)} helper={billing?.isPaid ? "Paid access is active" : "No paid access yet"} />
          <MetricCard label="Renewal" value={formatDate(billing?.currentPeriodEnd)} helper={billing?.currentPeriodEnd ? "Current billing period end" : "No renewal scheduled"} />
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
          <section className="rounded-xl border border-[#22252b] bg-[#0f1217] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Current workspace access</h2>
                <p className="mt-2 text-sm text-[#8d94a0]">Billing is attached to the selected workspace. The first paid feature wired right now is team workspace creation.</p>
              </div>
              <div className="w-11 h-11 rounded-xl border border-[#252a33] bg-[#14181e] grid place-items-center shrink-0">
                <CreditCard className="w-5 h-5 text-[#dbe1eb]" />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              {(billing?.availablePlans || []).map((plan) => {
                const active = plan.code === billing?.plan;
                return (
                  <article key={plan.code} className={`rounded-xl border p-4 ${active ? "border-white/12 bg-[#161b23]" : "border-[#252a33] bg-[#14181e]"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-white">{plan.label}</h3>
                        <p className="mt-1 text-sm text-[#8d94a0]">{plan.description}</p>
                      </div>
                      {active && <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] text-emerald-200">Current</span>}
                    </div>
                    <div className="mt-4 space-y-2.5">
                      {(plan.features || []).map((feature) => (
                        <FeatureRow key={feature} text={feature} />
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-[#22252b] bg-[#0f1217] p-5 space-y-5">
            <div>
              <h2 className="text-xl font-semibold text-white">Start test checkout</h2>
              <p className="mt-2 text-sm text-[#8d94a0]">
                {billing?.mode === "test"
                  ? "This workspace is ready for Razorpay test payments. Use test cards or UPI in checkout, then PingMaster verifies the payment before any feature unlock happens."
                  : "The billing backend is wired, but this workspace is not currently using a test key."}
              </p>
            </div>

            <div className="rounded-xl border border-[#252a33] bg-[#14181e] p-4 space-y-3">
              <InfoLine icon={ShieldCheck} text="Payment unlocks only after backend signature verification." />
              <InfoLine icon={CheckCircle2} text="Webhook updates keep billing in sync after the initial checkout verification." />
              <InfoLine icon={ArrowRight} text="After a successful test payment, team workspace creation becomes available." />
            </div>

            <button
              type="button"
              onClick={handleStartCheckout}
              disabled={submitting || !billing?.checkoutReady || isPro}
              className="h-11 px-5 rounded-lg bg-white text-black text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              {isPro ? "Pro Already Active" : submitting ? "Opening Checkout..." : billing?.mode === "test" ? "Start Test Checkout" : "Upgrade to Pro"}
            </button>

            {!billing?.checkoutReady && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Razorpay keys are not configured yet.
              </div>
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
