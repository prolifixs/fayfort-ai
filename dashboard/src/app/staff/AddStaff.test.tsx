import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ session: null as null | { access_token: string; user: { email: string } }, signOut: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  dashboardAuthConfigured: true,
  openedAt: { pathname: "", search: "", hash: "" },
  supabaseClient: {
    auth: {
      getSession: async () => ({ data: { session: auth.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: auth.signOut,
    },
  },
}));

import { AddStaffPanel } from "./AddStaff";
import { StaffJoinPage } from "./StaffJoinPage";
import { rememberReturn, safeReturnPath, takeReturn } from "../../lib/returnTo";

const reply = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
let calls: { url: string; method: string; body?: Record<string, unknown>; auth?: string | null }[] = [];
let handler: (url: string, method: string) => Response;

beforeEach(() => {
  calls = [];
  auth.session = null;
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        auth: new Headers(init?.headers).get("Authorization"),
      });
      return handler(url, method);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Add staff", () => {
  it("searches existing accounts and invites one with a role and departments", async () => {
    handler = (url) => {
      if (url.includes("/platform/staff/candidates"))
        return reply({
          accounts: [
            { user_id: "u1", email: "ada@example.com", display_name: "Ada", username: "ada", eligible: true, reason: null },
            { user_id: "u2", email: "ada.staff@example.com", display_name: null, username: null, eligible: false, reason: "Already on the team" },
          ],
        });
      if (url.endsWith("/platform/staff/invitations")) return reply({ invitation: { email: "ada@example.com", kind: "existing_account" } }, 201);
      return reply({});
    };
    const onInvited = vi.fn();
    render(<AddStaffPanel accessToken="admin" onInvited={onInvited} />);
    fireEvent.change(screen.getByLabelText("Find an account"), { target: { value: "ada" } });
    expect(await screen.findByText("Already on the team")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose ada.staff@example.com" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Choose ada@example.com" }));
    fireEvent.click(screen.getByLabelText(/Personal assistant to the CEO/));
    fireEvent.click(screen.getByLabelText("Member support"));
    fireEvent.change(screen.getByLabelText("Job title (optional)"), { target: { value: "Assistant" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("status")).toHaveTextContent("sign in with their usual account and press Accept");
    expect(calls.find((c) => c.url.endsWith("/platform/staff/invitations"))?.body).toEqual({
      user_id: "u1",
      staff_role: "assistant",
      job_title: "Assistant",
      departments: ["member_support"],
    });
    expect(onInvited).toHaveBeenCalled();
  });

  it("invites a new person by email and shows refusals", async () => {
    handler = (url) =>
      url.endsWith("/platform/staff/invitations")
        ? reply({ detail: "Fay is the CEO. There can only be one CEO: change their role first." }, 409)
        : reply({});
    render(<AddStaffPanel accessToken="admin" />);
    fireEvent.click(screen.getByRole("tab", { name: "New person" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByLabelText(/^CEO/));
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only be one CEO");
    expect(calls[0].body).toMatchObject({ email: "new@example.com", staff_role: "ceo" });
  });
});

describe("Accepting a staff invitation", () => {
  const invitation = { email_hint: "a••@example.com", role_label: "Personal assistant to the CEO", job_title: null, invited_by: "Favour", expired: false };

  it("asks a signed-out person to sign in and remembers the link", async () => {
    window.history.replaceState({}, "", "/staff/join?token=abcdefghijklmnopqrstuvwxyz");
    handler = () => reply({ invitation });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, search: "?token=abcdefghijklmnopqrstuvwxyz" });
    render(<StaffJoinPage />);
    expect(await screen.findByText(/Favour invited you/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in to accept" }));
    expect(assign).toHaveBeenCalledWith("/member/account");
    expect(takeReturn()).toBe("/staff/join?token=abcdefghijklmnopqrstuvwxyz");
  });

  it("accepts as the signed-in account", async () => {
    vi.stubGlobal("location", { ...window.location, search: "?token=abcdefghijklmnopqrstuvwxyz" });
    auth.session = { access_token: "member-token", user: { email: "ada@example.com" } };
    handler = (url) => (url.endsWith("/staff/invitations/accept") ? reply({ worker: { staff_role: "assistant" } }) : reply({ invitation }));
    render(<StaffJoinPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByRole("heading", { name: "You're on the team" })).toBeInTheDocument();
    const accept = calls.find((c) => c.url.endsWith("/staff/invitations/accept"));
    expect(accept?.body).toEqual({ token: "abcdefghijklmnopqrstuvwxyz" });
    expect(accept?.auth).toBe("Bearer member-token");
  });

  it("offers to switch accounts when the invitation is for someone else", async () => {
    vi.stubGlobal("location", { ...window.location, search: "?token=abcdefghijklmnopqrstuvwxyz" });
    auth.session = { access_token: "t", user: { email: "other@example.com" } };
    handler = (url) =>
      url.endsWith("/staff/invitations/accept")
        ? reply({ detail: "This invitation is for a different account. Sign out, then sign in with the email the invitation was sent to." }, 403)
        : reply({ invitation });
    render(<StaffJoinPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByRole("button", { name: "Sign out and use a••@example.com" })).toBeInTheDocument();
  });
});

describe("Return after sign-in", () => {
  it("only keeps FayFort app paths", () => {
    expect(safeReturnPath("/staff/join?token=x")).toBe("/staff/join?token=x");
    expect(safeReturnPath("/member/chat?panel=tools")).toBe("/member/chat?panel=tools");
    expect(safeReturnPath("//evil.example")).toBeNull();
    expect(safeReturnPath("https://evil.example")).toBeNull();
    expect(safeReturnPath("/platform/workers")).toBeNull();
    rememberReturn("https://evil.example");
    expect(takeReturn()).toBeNull();
    rememberReturn("/member/chat");
    expect(takeReturn()).toBe("/member/chat");
    expect(takeReturn()).toBeNull();
  });
});

void waitFor;
