import { ReactNode, useEffect, useState } from "react";
import { supabaseClient } from "../../lib/supabase";
import { formatMemberTier } from "./memberShared";
import { ConsultationCard, ContactCreditsCard } from "./MemberPerks";
import type { MemberPlanSummary } from "./membershipApi";

export type MemberAccountDialogKind = "points" | "tier" | "account" | "settings";

type Profile = Record<string, unknown> | null;

/** One pop-up shell for the member account menu: closes on ×, Close, Escape or a click outside. */
export function MemberDialog({
  eyebrow,
  title,
  onClose,
  wide,
  children,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  const titleId = `member-dialog-${eyebrow.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="member-chat-dialog-backdrop" onClick={onClose}>
      <section
        className={wide ? "member-chat-dialog member-account-dialog wide" : "member-chat-dialog member-account-dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" aria-label={`Close ${title}`} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="member-account-dialog-body">{children}</div>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

const PLAN_ROWS: { label: string; free: string; standard: string; pro: string }[] = [
  {
    label: "Sourcing deposit",
    free: "50% of the product price",
    standard: "25% of the product price",
    pro: "None while you keep buying",
  },
  { label: "Consultation", free: "$100", standard: "$50 (50% off)", pro: "1 free each month, then $50" },
  { label: "Supplier contacts", free: "$15 each or 5 for $50", standard: "$15 each or 5 for $50", pro: "10 included each month" },
  { label: "Hotels & restaurants", free: "Free", standard: "Free", pro: "Free" },
  { label: "Premium themes", free: "—", standard: "Included", pro: "Included" },
];

/** Plan comparison shared by the tier pop-up and the /member/membership page. */
export function MemberPlanComparison({ currentTier }: { currentTier: string }) {
  const columns = ["Free", "Standard", "Pro"] as const;
  return (
    <div className="member-plan-compare">
      <table>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Benefit</span>
            </th>
            {columns.map((column) => (
              <th scope="col" key={column} className={column === currentTier ? "current" : undefined}>
                {column}
                {column === currentTier && <small>Your plan</small>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PLAN_ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className={currentTier === "Free" ? "current" : undefined}>{row.free}</td>
              <td className={currentTier === "Standard" ? "current" : undefined}>{row.standard}</td>
              <td className={currentTier === "Pro" ? "current" : undefined}>{row.pro}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="member-plan-note">
        A sourcing deposit counts toward your order when you buy. Plan perks apply while your subscription is active.
        Plan upgrades open soon.
      </p>
    </div>
  );
}

function PointsDialog({ profile }: { profile: Profile }) {
  const balance = Number(profile?.points_balance ?? 0) || 0;
  return (
    <>
      <div className="member-dialog-stat">
        <small>Your balance</small>
        <strong>{new Intl.NumberFormat().format(balance)}</strong>
        <span>virtual points</span>
      </div>
      <p className="member-chat-dialog-copy">
        Points are FayFort’s reward currency. You’ll earn them for purchases, sourcing requests that turn into orders,
        and helping other members, and spend them on giveaway entries and perks. Earning opens with member ranks.
      </p>
    </>
  );
}

function TierDialog({
  profile,
  accessToken,
  plan,
  onPlanChange,
}: {
  profile: Profile;
  accessToken?: string | null;
  plan?: MemberPlanSummary | null;
  onPlanChange?: () => void;
}) {
  const rank = Math.min(5, Math.max(1, Number(profile?.rank_level) || 1));
  const subrank = Math.min(5, Math.max(1, Number(profile?.subrank) || 1));
  const tier = formatMemberTier(profile?.member_tier);
  const step = (rank - 1) * 5 + subrank;
  return (
    <>
      <div className="member-dialog-rank">
        <div>
          <small>Rank</small>
          <strong>
            {rank}
            <span> · Subrank {subrank}</span>
          </strong>
        </div>
        <div>
          <small>Plan</small>
          <strong>{tier}</strong>
        </div>
      </div>
      <div
        className="member-rank-track"
        role="progressbar"
        aria-label="Rank progress"
        aria-valuemin={1}
        aria-valuemax={25}
        aria-valuenow={step}
      >
        {[1, 2, 3, 4, 5].map((level) => (
          <span key={level} className={level < rank ? "done" : level === rank ? "now" : undefined}>
            <i style={{ width: level < rank ? "100%" : level === rank ? `${(subrank / 5) * 100}%` : "0%" }} />
          </span>
        ))}
      </div>
      <p className="member-chat-dialog-copy">
        Your rank reflects how active you’ve been over the last 90 days. Higher ranks unlock lower rates, even on the
        Free plan.
      </p>
      <MemberPlanComparison currentTier={tier} />
      {accessToken && (
        <div className="member-perks">
          <h3 className="member-perks-title">Your perks</h3>
          <ConsultationCard accessToken={accessToken} plan={plan || null} onChange={() => onPlanChange?.()} />
          <ContactCreditsCard accessToken={accessToken} status={plan?.contacts} />
        </div>
      )}
    </>
  );
}

function AccountDialog({ profile, onOpenSettings }: { profile: Profile; onOpenSettings: () => void }) {
  const [email, setEmail] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    let mounted = true;
    supabaseClient?.auth.getSession().then(({ data }) => {
      if (mounted) setEmail(data.session?.user.email || "");
    });
    return () => {
      mounted = false;
    };
  }, []);
  const name =
    typeof profile?.display_name === "string" && profile.display_name.trim() ? profile.display_name.trim() : "Member";
  const created = typeof profile?.created_at === "string" ? new Date(profile.created_at) : null;
  const shipping = [profile?.shipping_city, profile?.shipping_country].filter(
    (part): part is string => typeof part === "string" && !!part.trim(),
  );
  async function signOut() {
    setSigningOut(true);
    await supabaseClient?.auth.signOut();
    window.location.assign("/member/account");
  }
  return (
    <>
      <dl className="member-account-facts">
        <div>
          <dt>Name</dt>
          <dd>{name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{email || "Verified account"}</dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd>{formatMemberTier(profile?.member_tier)}</dd>
        </div>
        {created && !Number.isNaN(created.getTime()) && (
          <div>
            <dt>Member since</dt>
            <dd>{created.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</dd>
          </div>
        )}
        <div>
          <dt>Ships to</dt>
          <dd>{shipping.length ? shipping.join(", ") : "No saved address"}</dd>
        </div>
      </dl>
      <div className="member-account-dialog-actions">
        <button type="button" className="secondary-button" onClick={onOpenSettings}>
          Edit in settings
        </button>
        <button type="button" className="primary-button" disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </>
  );
}

export function MemberAccountDialogs({
  kind,
  profile,
  onClose,
  onOpen,
  settings,
  accessToken,
  plan,
  onPlanChange,
}: {
  kind: MemberAccountDialogKind | null;
  profile: Profile;
  onClose: () => void;
  onOpen: (kind: MemberAccountDialogKind) => void;
  accessToken?: string | null;
  plan?: MemberPlanSummary | null;
  onPlanChange?: () => void;
  /** The settings panel, passed in so this file doesn't import the account pages (avoids a cycle). */
  settings: ReactNode;
}) {
  if (!kind) return null;
  if (kind === "points")
    return (
      <MemberDialog eyebrow="REWARDS" title="Virtual points" onClose={onClose}>
        <PointsDialog profile={profile} />
      </MemberDialog>
    );
  if (kind === "tier")
    return (
      <MemberDialog eyebrow="MEMBERSHIP" title="Member tier" onClose={onClose} wide>
        <TierDialog profile={profile} accessToken={accessToken} plan={plan} onPlanChange={onPlanChange} />
      </MemberDialog>
    );
  if (kind === "account")
    return (
      <MemberDialog eyebrow="ACCOUNT" title="Account details" onClose={onClose}>
        <AccountDialog profile={profile} onOpenSettings={() => onOpen("settings")} />
      </MemberDialog>
    );
  return (
    <MemberDialog eyebrow="ACCOUNT" title="Settings" onClose={onClose} wide>
      {settings}
    </MemberDialog>
  );
}
