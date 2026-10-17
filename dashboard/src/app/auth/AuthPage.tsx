import type { ReactNode } from "react";
import { AuthGlobe } from "./AuthGlobe";
import "./auth-shell.css";

/**
 * The frame for every sign-in screen (docs/AUTH_PAGES_PLAN.md): navy globe background, logo, a link back to
 * fayfort.com (hidden on staff-only screens) and the clean white card in front.
 */
export function AuthPage({ children, staff = false }: { children: ReactNode; staff?: boolean }) {
  return (
    <div className="auth-page auth-globe-page">
      <AuthGlobe />
      <header className="auth-topbar">
        <span className="auth-logo">
          <b className="brand-mark">F</b>
          <span>FAYFORT</span>
        </span>
        {!staff && (
          <a className="auth-back" href="https://www.fayfort.com">
            ← fayfort.com
          </a>
        )}
      </header>
      <main className="auth-main">{children}</main>
      <p className="auth-caption" aria-hidden="true">
        Shipping from Guangzhou to Lagos, Accra, Nairobi, Johannesburg, London and New York
      </p>
    </div>
  );
}
