import { useEffect, useState } from "react";

/** The main script the open page was built with, e.g. "/assets/index-CsduILao.js". */
export function currentBuild(doc: Document = document): string {
  const script = doc.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return script ? new URL(script.src, window.location.origin).pathname : "";
}

/** The main script named in a freshly fetched index.html. */
export function buildIn(html: string): string {
  return html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] || "";
}

const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * A tab left open keeps running the version it loaded, so a release can look half there. This checks for a newer
 * build every few minutes and whenever the tab comes back into view, and offers a one-tap reload.
 */
export function UpdateNotice() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const loaded = currentBuild();
    if (!loaded) return;
    let stopped = false;
    async function check() {
      if (stopped || document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/?v=" + Date.now(), { cache: "no-store" });
        if (!response.ok) return;
        const latest = buildIn(await response.text());
        if (latest && latest !== loaded) setReady(true);
      } catch {
        // Offline or blocked: try again on the next check.
      }
    }
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  if (!ready) return null;
  return (
    <div className="app-update-notice" role="status">
      <span>A new version of FayFort is ready.</span>
      <button type="button" className="primary-button" onClick={() => window.location.reload()}>
        Reload
      </button>
      <button type="button" className="link-button" onClick={() => setReady(false)}>
        Later
      </button>
    </div>
  );
}
