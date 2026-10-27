import { ReactNode, useEffect, useState } from "react";
import { supabaseClient } from "../../lib/supabase";
import { formatMemberTier } from "./memberShared";
import { apiRequest } from "../../lib/api";
import { type MemberPlanSummary, RANK_NAMES, type RankStatus, useMemberRank } from "./membershipApi";

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
  { label: "Price", free: "Free", standard: "$5.99 a month or $71.88 a year", pro: "$14.99 a month or $179.88 a year" },
  { label: "FayFort Finds (new every Monday)", free: "A week later, 3 featured", standard: "On Monday, with the research", pro: "Two days early" },
  { label: "Finds pricing", free: "—", standard: "Price per unit by quantity", pro: "Plus landed cost and margin" },
  { label: "Watched finds", free: "5, no alerts", standard: "25, with alerts", pro: "Unlimited, with alerts" },
  { label: "Niche research for you", free: "—", standard: "—", pro: "2 a month" },
  {
    label: "Sourcing deposit",
    free: "50% of the product price",
    standard: "25% of the product price",
    pro: "None once you've bought with us in the last 90 days",
  },
  { label: "Consultation (1 hour)", free: "$100", standard: "$85", pro: "$50" },
  { label: "Supplier contacts", free: "$15 each or 5 for $50", standard: "1 included each paid month", pro: "3 included each paid month" },
  { label: "Hotels & restaurants", free: "Free", standard: "Free", pro: "Free" },
  { label: "Ads", free: "Shown", standard: "None", pro: "None" },
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
        A sourcing deposit counts toward your order when you buy. Your first paid month runs on the plan below (Pro on
        Standard prices, Standard on Free prices); full perks start with your second paid month. Paying yearly (12 months at
        the same price) gives full perks from the start. Included contacts renew each paid month.
      </p>
    </div>
  );
}

function PointsDialog({
  profile,
  accessToken,
  onChange,
}: {
  profile: Profile;
  accessToken?: string | null;
  onChange?: () => void;
}) {
  const { rank, setRank, error } = useMemberRank(accessToken);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const balance = rank ? rank.balance : Number(profile?.points_balance ?? 0) || 0;
  async function redeem(reward: RankStatus["rewards"][number]) {
    if (!accessToken) return;
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      const next = await apiRequest<RankStatus>("/members/points/redeem", accessToken, {
        method: "POST",
        body: JSON.stringify({ reward: reward.id }),
      });
      setRank(next);
      setNotice(`Done: ${reward.label} added. Use it in the Supplier directory.`);
      onChange?.();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Your points could not be spent.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="member-dialog-stat">
        <small>Your balance</small>
        <strong>{new Intl.NumberFormat().format(balance)}</strong>
        <span>virtual points to spend</span>
      </div>
      {rank?.rewards.map((reward) => (
        <div className="member-perk-row member-reward" key={reward.id}>
          <span>
            <strong>{reward.label}</strong>
            <small>{new Intl.NumberFormat().format(reward.cost)} points</small>
          </span>
          <button type="button" className="primary-button" disabled={busy || balance < reward.cost} onClick={() => void redeem(reward)}>
            {balance < reward.cost ? `${new Intl.NumberFormat().format(reward.cost - balance)} to go` : "Redeem"}
          </button>
        </div>
      ))}
      {notice && <p role="status" className="member-deposit-note">{notice}</p>}
      {(problem || error) && <p className="form-error" role="alert">{problem || error}</p>}
      {rank && (
        <>
          <h3 className="member-perks-title">How to earn</h3>
          <table className="member-earn-table">
            <tbody>
              {rank.earn.map((item) => (
                <tr key={item.kind}>
                  <th scope="row">{item.label}</th>
                  <td>{item.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="member-plan-note">Chatting and browsing don't earn points. The same points raise your rank.</p>
          {rank.recent.length > 0 && (
            <>
              <h3 className="member-perks-title">Recent activity</h3>
              <ul className="member-activity-list">
                {rank.recent.map((item, index) => (
                  <li key={index}>
                    <span>{item.label}</span>
                    <strong className={item.points < 0 ? "spent" : undefined}>
                      {item.points > 0 ? "+" : ""}
                      {item.points}
                    </strong>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}

function TierDialog({
  profile,
  accessToken,
  onOpenPlan,
}: {
  profile: Profile;
  accessToken?: string | null;
  /** Plans, billing and plan perks live in Settings → Plan (owner decision 2026-10-17). */
  onOpenPlan?: () => void;
}) {
  const { rank: status } = useMemberRank(accessToken);
  const rank = status?.rank ?? Math.min(5, Math.max(1, Number(profile?.rank_level) || 1));
  const subrank = status?.subrank ?? Math.min(5, Math.max(1, Number(profile?.subrank) || 1));
  const tier = formatMemberTier(profile?.member_tier);
  const step = (rank - 1) * 5 + subrank;
  const toNext = status?.next ? Math.max(status.next.at - status.score, 0) : 0;
  const stepProgress =
    status?.next && status.next.at > status.current_at
      ? Math.min(100, Math.max(0, ((status.score - status.current_at) / (status.next.at - status.current_at)) * 100))
      : 100;
  return (
    <>
      <div className="member-dialog-rank">
        <div>
          <small>Rank {rank}</small>
          <strong>
            {status?.name || RANK_NAMES[rank]}
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
          <span key={level} className={level < rank ? "done" : level === rank ? "now" : undefined} title={RANK_NAMES[level]}>
            <i style={{ width: level < rank ? "100%" : level === rank ? `${(subrank / 5) * 100}%` : "0%" }} />
          </span>
        ))}
      </div>
      {status && (
        <div className="member-rank-next">
          <p>
            <strong>{new Intl.NumberFormat().format(status.score)}</strong> points in the last {status.window_days} days
            {status.next
              ? ` · ${new Intl.NumberFormat().format(toNext)} more for ${status.next.name} ${status.next.subrank}`
              : " · top rank"}
          </p>
          {status.next && (
            <div className="member-rank-bar" aria-hidden="true">
              <i style={{ width: `${stepProgress}%` }} />
            </div>
          )}
          {status.grace.below && (
            <p className="member-directory-notice" role="status">
              Your recent activity is below this rank. Keep your rank by buying or sourcing before{" "}
              {status.grace.ends_at ? new Date(status.grace.ends_at).toLocaleDateString() : "the grace period ends"}; after
              that it drops one subrank at a time.
            </p>
          )}
        </div>
      )}
      <p className="member-chat-dialog-copy">
        Your rank counts what you've done in the last 90 days: orders, sourcing that ends in a purchase, group buys, and
        links that bring in buyers. From Insider (rank 4), Free members pay Standard rates.
      </p>
      {status && status.perks.length > 0 && (
        <ul className="member-rank-perks">
          {status.perks.map((perk) => (
            <li key={perk.label} className={perk.active ? "active" : undefined}>
              <strong>{perk.active ? "Unlocked" : `From ${RANK_NAMES[perk.rank]}`}</strong>
              <span>{perk.label}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="member-tier-plan-link">
        <span>
          Your plan: <strong>{tier}</strong>
        </span>
        {onOpenPlan && (
          <button type="button" className="secondary-button" onClick={onOpenPlan}>
            Plans and perks in Settings
          </button>
        )}
      </div>
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
  onPlanChange,
  onOpenPlan,
}: {
  kind: MemberAccountDialogKind | null;
  profile: Profile;
  onClose: () => void;
  onOpen: (kind: MemberAccountDialogKind) => void;
  accessToken?: string | null;
  plan?: MemberPlanSummary | null;
  onPlanChange?: () => void;
  /** Opens Settings scrolled to the Plan section. */
  onOpenPlan?: () => void;
  /** The settings panel, passed in so this file doesn't import the account pages (avoids a cycle). */
  settings: ReactNode;
}) {
  if (!kind) return null;
  if (kind === "points")
    return (
      <MemberDialog eyebrow="REWARDS" title="Virtual points" onClose={onClose}>
        <PointsDialog profile={profile} accessToken={accessToken} onChange={onPlanChange} />
      </MemberDialog>
    );
  if (kind === "tier")
    return (
      <MemberDialog eyebrow="MEMBERSHIP" title="Member tier" onClose={onClose} wide>
        <TierDialog profile={profile} accessToken={accessToken} onOpenPlan={onOpenPlan} />
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
