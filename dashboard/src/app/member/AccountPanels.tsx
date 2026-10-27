import { formatMemberTier } from "./memberShared";
import { MemberPlanComparison } from "./MemberAccountDialogs";
import { PlanBilling } from "./PlanBilling";
import { PANEL_PATHS } from "./memberRoutes";

/** Membership inside the member shell (/member/membership): the current plan, the comparison and billing. */
export function MembershipPanel({ accessToken, profile }: { accessToken: string; profile: Record<string, unknown> | null }) {
  const currentTier = formatMemberTier(profile?.member_tier);
  return (
    <section className="member-workspace-panel member-account-section" aria-labelledby="membership-title">
      <header className="member-account-section-head">
        <h2 id="membership-title">Member plans</h2>
        <p className="member-current-plan" role="status">
          Your current plan: <strong>{currentTier}</strong>
        </p>
      </header>
      <MemberPlanComparison currentTier={currentTier} />
      <PlanBilling accessToken={accessToken} />
    </section>
  );
}

/** Settings inside the member shell (/member/settings). The settings form itself is passed in by the shell. */
export function SettingsSection({ children }: { children: React.ReactNode }) {
  return (
    <section className="member-workspace-panel member-account-section" aria-labelledby="settings-title">
      <header className="member-account-section-head">
        <h2 id="settings-title">Settings</h2>
        <p>Your profile, sign-in methods, addresses, notifications and theme.</p>
      </header>
      {children}
    </section>
  );
}

/** An address under /member/ that doesn't exist: stay signed in, inside the shell, with a way on. */
export function NotFoundPanel({ onGo }: { onGo: (path: "chat" | "catalog" | "requests") => void }) {
  return (
    <section className="member-workspace-panel member-not-found" aria-labelledby="not-found-title">
      <svg aria-hidden="true" viewBox="0 0 120 80" className="member-empty-art">
        <path d="M10 60 C 40 20, 80 20, 110 50" />
        <circle cx="10" cy="60" r="4" />
        <circle cx="110" cy="50" r="4" className="is-accent" />
      </svg>
      <h2 id="not-found-title">This page isn’t here</h2>
      <p>The link may be old, or the page has moved. Everything is still in your menu.</p>
      <div className="member-not-found-actions">
        <a className="primary-button" href={PANEL_PATHS.chat} onClick={(event) => { event.preventDefault(); onGo("chat"); }}>Go to chats</a>
        <a className="secondary-button" href={PANEL_PATHS.catalog} onClick={(event) => { event.preventDefault(); onGo("catalog"); }}>Shop</a>
        <a className="secondary-button" href={PANEL_PATHS.requests} onClick={(event) => { event.preventDefault(); onGo("requests"); }}>Orders &amp; requests</a>
      </div>
    </section>
  );
}
