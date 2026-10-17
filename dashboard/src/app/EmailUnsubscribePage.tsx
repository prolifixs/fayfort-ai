import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api";
import { BrandMark } from "./brand/FayfortLogo";

const LABELS: Record<string, string> = {
  conversations: "chat reply emails",
  fulfillment: "request update emails",
  notifications: "account notification emails",
  newsletter: "the newsletter",
  all: "all FayFort emails",
};

/** /email/unsubscribe?token=…&category=… — opened from the link at the bottom of an email. */
export function EmailUnsubscribePage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const category = params.get("category") || "all";
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [scope, setScope] = useState(category in LABELS ? category : "all");

  async function unsubscribe(target: string) {
    setState("working");
    try {
      const response = await fetch(`${API_BASE}/email/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, category: target }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setScope(target);
      setState("done");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    if (token) void unsubscribe(category in LABELS ? category : "all");
    else setState("error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="auth-page">
      <section className="auth-card">
        <BrandMark />
        <label>FAYFORT EMAIL</label>
        {state === "working" && (
          <>
            <h1>One moment</h1>
            <p role="status">Updating your email settings…</p>
          </>
        )}
        {state === "done" && (
          <>
            <h1>You're unsubscribed</h1>
            <p role="status">You won't get {LABELS[scope]} anymore. You can turn emails back on any time in Settings.</p>
            {scope !== "all" && (
              <button type="button" className="secondary-button" onClick={() => void unsubscribe("all")}>
                Unsubscribe from all FayFort emails
              </button>
            )}
          </>
        )}
        {state === "error" && (
          <>
            <h1>That link didn't work</h1>
            <p role="alert">Sign in and change your email choices in Settings instead.</p>
          </>
        )}
        <p className="quiet-note">
          <a href="/member/settings">Email settings</a>
        </p>
      </section>
    </div>
  );
}
