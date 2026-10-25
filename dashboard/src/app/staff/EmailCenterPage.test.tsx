import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailCenterPage } from "./EmailCenterPage";
import { MemberEmailPreferences } from "../member/MemberEmailPreferences";
import { EmailUnsubscribePage } from "../EmailUnsubscribePage";

const ok = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
const now = new Date().toISOString();
const overview = {
  delivery: { configured: true, enabled: true, from: "FayFort <updates@fayfort.com>", reply_to: "support@fayfort.com" },
  categories: [
    { category: "conversations", label: "Conversation replies", description: "d", enabled: true, locked: false, last_7_days: { sent: 4, skipped: 2 } },
    { category: "newsletter", label: "Newsletter", description: "d", enabled: true, locked: false, last_7_days: {} },
    { category: "account_security", label: "Staff security emails", description: "d", enabled: true, locked: true, last_7_days: {} },
  ],
};
let fetchMock: ReturnType<typeof vi.fn>;
let letters: Record<string, unknown>[];

beforeEach(() => {
  letters = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    if (url.endsWith("/platform/email/overview")) return ok(overview);
    if (url.includes("/platform/email/categories/")) return ok({ enabled: false });
    if (url.includes("/platform/email/log")) {
      if (url.endsWith("/retry")) return ok({ queued: true });
      return ok({
        emails: [
          { id: "e1", category: "fulfillment", template: "request_milestone", recipient: "m@example.com", status: "failed", skip_reason: null, subject: null, attempts: 5, last_error: "Resend 500", created_at: now, sent_at: null },
          { id: "e2", category: "conversations", template: "worker_reply", recipient: "m@example.com", status: "skipped", skip_reason: "coalesced: a conversation email was sent in the last 15 minutes", subject: null, attempts: 1, last_error: null, created_at: now, sent_at: null },
        ],
      });
    }
    if (url.endsWith("/platform/newsletters") && method === "GET") return ok({ newsletters: letters });
    if (url.endsWith("/platform/newsletters") && method === "POST") {
      const body = JSON.parse(String(init?.body));
      const letter = { id: "n1", ...body, status: "draft", recipient_count: 0, created_at: now, sent_at: null, delivery: {} };
      letters = [letter];
      return ok({ newsletter: letter }, 201);
    }
    if (url.endsWith("/platform/newsletters/n1") && method === "PUT") return ok({ newsletter: { ...letters[0], ...JSON.parse(String(init?.body)) } });
    if (url.endsWith("/platform/newsletters/n1/preview")) return ok({ subject: "s", html: "<html><body>Preview body</body></html>", recipients: 42, members: 40, visitors: 2 });
    if (url.endsWith("/platform/newsletters/n1/test")) return ok({ sent_to: "admin@example.com" });
    if (url.endsWith("/platform/newsletters/n1/send")) return ok({ recipients: 42, members: 40, visitors: 2 });
    if (url.endsWith("/members/me/email-preferences"))
      return ok({ preferences: { conversations: method === "PUT" ? false : true, fulfillment: true, notifications: true, newsletter: true } });
    if (url.endsWith("/email/unsubscribe")) return ok({ unsubscribed: [JSON.parse(String(init?.body)).category] });
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("email types", () => {
  it("shows delivery status, counts and switches, with security locked on", async () => {
    render(<EmailCenterPage accessToken="admin" />);
    expect(await screen.findByText(/Sending is on, from FayFort/)).toBeInTheDocument();
    expect(screen.getByText(/4 sent · 2 skipped/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Staff security emails emails" })).toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "Newsletter emails" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/platform\/email\/categories\/newsletter$/),
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ enabled: false }) }),
      ),
    );
  });

  it("warns when sending is off on the server", async () => {
    overview.delivery.configured = false;
    render(<EmailCenterPage accessToken="admin" />);
    expect(await screen.findByText(/Resend API key isn't set yet/)).toBeInTheDocument();
    overview.delivery.configured = true;
  });
});

describe("sent emails", () => {
  it("lists emails with reasons and retries failed ones", async () => {
    render(<EmailCenterPage accessToken="admin" />);
    fireEvent.click(screen.getByRole("tab", { name: "Sent emails" }));
    const table = await screen.findByRole("table");
    expect(within(table).getByText(/coalesced/)).toBeInTheDocument();
    expect(within(table).getByText("Resend 500")).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/Queued again/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "failed" } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("status=failed"))).toBe(true));
  });
});

describe("newsletter", () => {
  it("saves, previews, tests and sends only after confirmation", async () => {
    render(<EmailCenterPage accessToken="admin" />);
    fireEvent.click(screen.getByRole("tab", { name: "Newsletter" }));
    fireEvent.click(await screen.findByRole("button", { name: "New newsletter" }));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "October update" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello members\n\nNew sourcing trips." } });
    fireEvent.click(screen.getByRole("button", { name: "Send a test to me" }));
    expect(await screen.findByText("Test sent to admin@example.com.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send to subscribers…" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Confirm newsletter send" });
    expect(confirm).toHaveTextContent("to 42 people (40 members, 2 newsletter sign-ups) now");
    expect(screen.getByTitle("Newsletter preview")).toHaveAttribute("srcdoc", expect.stringContaining("Preview body"));
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/send"))).toBe(false);
    fireEvent.click(within(confirm).getByRole("button", { name: "Send to 42" }));
    expect(await screen.findByText(/Sending to 42 subscribers/)).toBeInTheDocument();
    const send = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/platform/newsletters/n1/send"));
    expect(send?.[1]).toMatchObject({ method: "POST" });
  });
});

describe("member email choices", () => {
  it("lets a member turn a type off", async () => {
    render(<MemberEmailPreferences accessToken="member" />);
    const replies = await screen.findByRole("switch", { name: "Chat replies emails" });
    expect(replies).toBeChecked();
    fireEvent.click(replies);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Chat replies emails" })).not.toBeChecked());
  });

  it("unsubscribes from the link in an email without signing in", async () => {
    window.history.replaceState({}, "", `/email/unsubscribe?token=11111111-2222-3333-4444-555555555555&category=newsletter`);
    render(<EmailUnsubscribePage />);
    expect(await screen.findByRole("heading", { name: "You're unsubscribed" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("the newsletter");
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/email/unsubscribe"));
    expect(call?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ token: "11111111-2222-3333-4444-555555555555", category: "newsletter" }) });
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe from all FayFort emails" }));
    expect(await screen.findByText(/all FayFort emails anymore/)).toBeInTheDocument();
  });

  it("explains a broken link", async () => {
    window.history.replaceState({}, "", "/email/unsubscribe");
    render(<EmailUnsubscribePage />);
    expect(await screen.findByRole("heading", { name: "That link didn't work" })).toBeInTheDocument();
  });
});
