import { useState } from "react";
import { ConsultationCard, ContactCreditsCard, DirectoryPanel } from "./MemberPerks";
import { TourGuideCard } from "./TourGuide";
import { useMemberPlan } from "./membershipApi";

/** Member app → Tools: bookings and the supplier tools in one place (owner request, 2026-10-20). */
export type ToolKey = "consultation" | "tour" | "directory" | "contacts";

const TOOLS: { key: ToolKey; title: string; line: string; icon: string }[] = [
  {
    key: "consultation",
    title: "Virtual consultation",
    line: "One-to-one video time with a FayFort sourcing specialist.",
    icon: "M4 6h11v12H4zM15 10l5-3v10l-5-3",
  },
  {
    key: "tour",
    title: "Tour guide in China",
    line: "A FayFort team member meets you in China.",
    icon: "M12 21s-6-5.6-6-10.5A6 6 0 0 1 18 10.5C18 15.4 12 21 12 21zM12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  },
  {
    key: "directory",
    title: "Supplier directory",
    line: "Markets, factories and service providers in China.",
    icon: "M4 5h16v14H4zM4 9h16M9 9v10",
  },
  {
    key: "contacts",
    title: "Supplier contacts",
    line: "Unlock phone numbers and WeChat with contact credits.",
    icon: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h3",
  },
];

export function toolFromUrl(): ToolKey | null {
  try {
    const value = new URLSearchParams(window.location.search).get("tool");
    return TOOLS.some((t) => t.key === value) ? (value as ToolKey) : null;
  } catch {
    return null;
  }
}

export function ToolsPanel({ accessToken, initial }: { accessToken: string; initial?: ToolKey | null }) {
  const [tool, setTool] = useState<ToolKey | null>(initial ?? null);
  const { plan, reload } = useMemberPlan(accessToken);
  function choose(next: ToolKey) {
    setTool(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("panel", "tools");
      url.searchParams.set("tool", next);
      window.history.replaceState(null, "", url.pathname + url.search);
    } catch {
      /* the address bar is a convenience */
    }
    window.setTimeout(() => document.getElementById("member-tool-view")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }
  return (
    <section className="member-workspace-panel member-tools" aria-labelledby="member-tools-title">
      <header>
        <small>FAYFORT TOOLS</small>
        <h2 id="member-tools-title">Tools</h2>
        <p>Book time with our team and find suppliers in China.</p>
      </header>
      <nav className="member-tool-grid" aria-label="Choose a tool">
        {TOOLS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={tool === item.key ? "member-tool-tile is-on" : "member-tool-tile"}
            aria-current={tool === item.key ? "true" : undefined}
            onClick={() => choose(item.key)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d={item.icon} />
            </svg>
            <span>
              <strong>{item.title}</strong>
              <small>{item.line}</small>
            </span>
          </button>
        ))}
      </nav>
      <div id="member-tool-view" className="member-tool-view">
        {tool === "consultation" && <ConsultationCard accessToken={accessToken} plan={plan || null} onChange={reload} />}
        {tool === "tour" && <TourGuideCard accessToken={accessToken} />}
        {tool === "contacts" && <ContactCreditsCard accessToken={accessToken} status={plan?.contacts} />}
        {tool === "directory" && <DirectoryPanel accessToken={accessToken} />}
      </div>
    </section>
  );
}
