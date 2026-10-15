import { useState } from "react";
import { apiRequest } from "../../lib/api";
import { type SubscriptionView, formatMoney, useSubscription } from "./membershipApi";

const NAMES = { standard: "Standard", pro: "Pro" } as const;

function date(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "";
}

/** Subscribe, manage, pause and resume the member plan (Stripe Checkout and customer portal). */
export function PlanBilling({ accessToken, onChange }: { accessToken: string; onChange?: () => void }) {
  const { subscription, setSubscription } = useSubscription(accessToken);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pauseMonths, setPauseMonths] = useState(1);
  if (!subscription) return null;
  if (!subscription.available)
    return <p className="member-plan-note">Plan upgrades open soon.</p>;
  async function go(path: string, body?: unknown) {
    setBusy(path);
    setError("");
    try {
      const result = await apiRequest<{ url: string }>(path, accessToken, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      window.location.assign(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work. Please try again.");
      setBusy("");
    }
  }
  async function change(path: string, body?: unknown) {
    setBusy(path);
    setError("");
    try {
      const result = await apiRequest<SubscriptionView>(path, accessToken, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      setSubscription(result);
      onChange?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work. Please try again.");
    } finally {
      setBusy("");
    }
  }
  const price = (plan: "standard" | "pro") =>
    `${formatMoney(subscription.prices[plan].monthly, subscription.prices[plan].currency.toUpperCase())}/month`;
  const active = subscription.plan && !subscription.paused;
  return (
    <section className="member-perk member-billing" aria-label="Your subscription">
      {active ? (
        <>
          <div className="member-perk-head">
            <div>
              <h3>{NAMES[subscription.plan!]} plan</h3>
              <p>
                {subscription.status === "past_due"
                  ? "Your last payment didn't go through. Update your card to keep your plan."
                  : subscription.cancel_at_period_end
                    ? `Ends on ${date(subscription.current_period_end)}. You can turn renewal back on in Manage.`
                    : `Renews on ${date(subscription.current_period_end)} · ${subscription.months} month${subscription.months === 1 ? "" : "s"} in a row`}
              </p>
            </div>
            <strong className="member-perk-price">{price(subscription.plan!)}</strong>
          </div>
          <div className="member-perk-actions">
            <label className="member-pause">
              <span>Pause for</span>
              <select value={pauseMonths} onChange={(event) => setPauseMonths(Number(event.target.value))}>
                {Array.from({ length: subscription.max_pause_months }, (_, i) => i + 1).map((months) => (
                  <option key={months} value={months}>
                    {months} month{months === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={!!busy}
              onClick={() => void change("/members/subscription/pause", { months: pauseMonths })}
            >
              {busy === "/members/subscription/pause" ? "Pausing…" : "Pause instead of cancelling"}
            </button>
            <button type="button" className="primary-button" disabled={!!busy} onClick={() => void go("/members/subscription/portal")}>
              {busy === "/members/subscription/portal" ? "Opening…" : "Manage subscription"}
            </button>
          </div>
          <small className="member-deposit-note">
            Pausing stops payments and plan perks but keeps your months in a row and your history.
          </small>
        </>
      ) : subscription.paused ? (
        <>
          <div className="member-perk-head">
            <div>
              <h3>{subscription.plan ? NAMES[subscription.plan] : "Your"} plan is paused</h3>
              <p>No payments while paused. Your months in a row and history are kept.</p>
            </div>
          </div>
          <div className="member-perk-actions">
            <button type="button" className="primary-button" disabled={!!busy} onClick={() => void change("/members/subscription/resume")}>
              {busy ? "Resuming…" : "Resume my plan"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="member-perk-head">
            <div>
              <h3>Upgrade your plan</h3>
              <p>Cancel any time. Secure payment by Stripe.</p>
            </div>
          </div>
          <div className="member-perk-actions member-upgrade">
            {(["standard", "pro"] as const).map((plan) => (
              <button
                key={plan}
                type="button"
                className={plan === "pro" ? "primary-button" : "secondary-button"}
                disabled={!!busy}
                onClick={() => void go("/members/subscription/checkout", { plan })}
              >
                {busy && busy.endsWith("checkout") ? "Opening checkout…" : `Get ${NAMES[plan]} · ${price(plan)}`}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
