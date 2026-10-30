import { Component, type ReactNode } from "react";

/** Line icons for the Control Center navigation (24px grid, drawn with currentColor). */
const ICONS: Record<string, string> = {
  Overview: "M4 11.5 12 5l8 6.5V20h-5v-5h-6v5H4z",
  Conversations: "M20 12a7.5 7.5 0 0 1-8 7.4 8.6 8.6 0 0 1-3.3-.7L4 20l1.3-3.6A7 7 0 0 1 4 12c0-4.1 3.6-7.4 8-7.4s8 3.3 8 7.4Z",
  Customers: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6 6 0 0 1 3 5.5",
  Requests: "M8 4h8v3H8zM7 5.5H5.5V21h13V5.5H17M8.5 11h7M8.5 14.5h7M8.5 18h4",
  "Directory & Tools": "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6",
  Channels: "M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v8M9 20h6",
  "Channels & Connections": "M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v8M9 20h6",
  Connections: "M9 15 15 9M10 6.5l1.5-1.5a4 4 0 0 1 5.7 5.7L15.5 12.5M8.5 11.5 6.8 13.2a4 4 0 0 0 5.7 5.7L14 17.5",
  Automations: "M13 3 5 13.5h6L10 21l8-10.5h-6Z",
  Entitlements: "M15 9.5a4.5 4.5 0 1 0-4.4 4.5L9 15.5V18H6.5v2.5H4V18l6.5-6.5M15 9.5h.01",
  Verification: "M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6zM9 12l2.2 2.2L15.5 10",
  "Human Agents": "M5 14v-2a7 7 0 0 1 14 0v2M5 14h2.5v5H5zm14 0h-2.5v5H19zM19 19c0 1-1.5 2-4 2h-2",
  Knowledge: "M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5zM12 6v13.5",
  Analytics: "M4 20h16M7 16v-4M12 16V7M17 16v-6",
  Settings: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5",
  "Member Requests": "M4 13.5 6.5 5h11l2.5 8.5V19H4zM4 13.5h4.5a3.5 3.5 0 0 0 7 0H20",
  "Operations Center": "M12 3 3 7.5 12 12l9-4.5zM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5",
  People: "M7 4h10v17H7zM10 4v2.5h4V4M12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-3 4.5a3 3 0 0 1 6 0",
  Shop: "M5 8h14l-1 12.5H6zM9 8V6.5a3 3 0 0 1 6 0V8",
  Emails: "M4 6h16v12H4zM4 7l8 6 8-6",
  Website: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9M12 3C9.5 5.5 8.5 8.5 8.5 12s1 6.5 3.5 9",
  Ads: "M4 9.5h3l8-4.5v14l-8-4.5H4zM7 14.5l1.5 5h2.5L10 15M18.5 9.5a3 3 0 0 1 0 5",
  "Theme Studio": "M12 4a8 8 0 1 0 0 16c1.2 0 1.6-.9 1.2-1.8-.5-1 .2-2.2 1.3-2.2H17a3 3 0 0 0 3-3c0-5-3.6-9-8-9ZM7.5 11h.01M10 7.5h.01M14.5 7.5h.01",
  Infrastructure: "M4 5h16v5H4zM4 14h16v5H4zM7.5 7.5h.01M7.5 16.5h.01",
  "My account": "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  "Sign out": "M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10",
  menu: "M4 7h16M4 12h16M4 17h10",
  close: "M6 6l12 12M18 6 6 18",
};

export function NavIcon({ name }: { name: string }) {
  return (
    <svg className="staff-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d={ICONS[name] || ICONS.Overview} />
    </svg>
  );
}

/** A page that fails to render shows a message instead of blanking the whole Control Center. */
export class PageErrorBoundary extends Component<{ page: string; children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
  componentDidUpdate(previous: { page: string }) {
    if (previous.page !== this.props.page && this.state.error) this.setState({ error: "" });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice error" role="alert">
        <strong>{this.props.page} couldn't be shown.</strong>
        <p>Something in the data for this page was unexpected. Other pages still work. Details: {this.state.error}</p>
        <div className="record-actions">
          <button type="button" onClick={() => this.setState({ error: "" })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}

/** Turns stored values like "awaiting_customer" into "Awaiting customer". */
export function readable(value: string | null | undefined): string {
  const text = String(value || "").replaceAll("_", " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/** Short reference for an internal ID, with the full value one click away. */
export function ShortId({ id, label = "ID" }: { id: string; label?: string }) {
  return (
    <button
      type="button"
      className="short-id"
      title={`Copy ${label}: ${id}`}
      onClick={() => void navigator.clipboard?.writeText(id).catch(() => undefined)}
    >
      {label} {id.length > 10 ? `${id.slice(0, 8)}…` : id}
    </button>
  );
}
