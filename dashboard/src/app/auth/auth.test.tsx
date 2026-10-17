import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authCallbackUrl, friendlyAuthError, parseAuthCallback, passwordProblems } from "./authLinks";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  updateUser: vi.fn(),
  reauthenticate: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  resend: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  getUserIdentities: vi.fn(),
}));
const mfa = vi.hoisted(() => ({
  getAuthenticatorAssuranceLevel: vi.fn(),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challengeAndVerify: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: { auth: { ...auth, mfa } } }));

import { App } from "../App";
import { AccountSecuritySection } from "./MemberSecuritySection";
import { STAFF_IDLE_LIMIT_MS, StaffMfaGate } from "./StaffMfaGate";

let fetchMock: ReturnType<typeof vi.fn>;
const json = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;

beforeEach(() => {
  Object.values(auth).forEach((mock) => mock.mockReset());
  Object.values(mfa).forEach((mock) => mock.mockReset());
  mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
  mfa.unenroll.mockResolvedValue({ error: null });
  try {
    localStorage.clear();
  } catch {
    /* jsdom storage */
  }
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  auth.resend.mockResolvedValue({ data: {}, error: null });
  auth.signUp.mockResolvedValue({ data: {}, error: null });
  auth.updateUser.mockResolvedValue({ data: {}, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith("/workers/me") ? json({ worker: { status: "active" } }) : json({}),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("auth link parsing", () => {
  it("reads the link type, audience and errors from the hash or query", () => {
    expect(parseAuthCallback({ pathname: "/auth/callback", search: "?audience=member", hash: "#type=recovery&access_token=x" }))
      .toMatchObject({ type: "recovery", audience: "member", errorCode: "" });
    expect(parseAuthCallback({ pathname: "/worker/accept", search: "", hash: "#type=invite" }))
      .toMatchObject({ type: "invite", audience: "staff" });
    expect(parseAuthCallback({ pathname: "/auth/callback", search: "?code=abc", hash: "" }))
      .toMatchObject({ type: "oauth", audience: "member" });
    expect(
      parseAuthCallback({
        pathname: "/auth/callback",
        search: "?audience=staff",
        hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      }),
    ).toMatchObject({ audience: "staff", errorCode: "otp_expired", errorDescription: "Email link is invalid or has expired" });
  });

  it("builds callback links on the current origin", () => {
    expect(authCallbackUrl("staff", "recovery")).toBe(`${window.location.origin}/auth/callback?audience=staff&type=recovery`);
  });

  it("enforces the password policy", () => {
    expect(passwordProblems("short1")).toContain("At least 10 characters");
    expect(passwordProblems("onlyletterspassword")).toEqual(["At least one number"]);
    expect(passwordProblems("good-password-42")).toEqual([]);
  });

  it("turns credential errors into wording that doesn't reveal accounts", () => {
    expect(friendlyAuthError(new Error("Invalid login credentials"), "x")).toMatch(/don't match/);
  });
});

describe("forgot password", () => {
  it("sends a staff reset link to the shared callback and answers the same way for any email", async () => {
    window.history.replaceState({}, "", "/auth/forgot?audience=staff");
    render(<App />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "worker@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a reset link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("If an account uses that email");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("worker@example.com", {
      redirectTo: `${window.location.origin}/auth/callback?audience=staff&type=recovery`,
      captchaToken: undefined,
    });
    expect(screen.getByRole("button", { name: /You can send another in/ })).toBeDisabled();
  });

  it("shows the one sign-in page at the Control Center address and at /member/account", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Members and the FayFort team use the same sign-in.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/auth/forgot?audience=member");
    expect(screen.queryByText(/FAYFORT CONTROL CENTER/)).not.toBeInTheDocument();
    cleanup();
    window.history.replaceState({}, "", "/member/account");
    render(<App />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("Return to FayFort Control Center")).not.toBeInTheDocument();
    cleanup();
    window.history.replaceState({}, "", "/member/signup");
    render(<App />);
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
  });
});

describe("landing after sign-in", () => {
  const session = (meta: Record<string, unknown> = {}) =>
    ({ access_token: "t", user: { id: "u", email: "a@b.c", app_metadata: meta } }) as never;
  const respond = (routes: Record<string, unknown>) =>
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const hit = Object.keys(routes).find((path) => String(input).endsWith(path));
      return hit ? json(routes[hit]) : { ok: false, status: 403, json: async () => ({ detail: "no" }), headers: new Headers() } as Response;
    });

  it("sends the FayFort team and business owners to the Control Center and members to their chat", async () => {
    const { landingFor } = await import("./landing");
    expect(await landingFor(session({ platform_admin: true }))).toBe("/");
    respond({ "/workers/me": { worker: { status: "active" } }, "/members/me": { profile: { user_id: "u" } } });
    expect(await landingFor(session())).toBe("/");
    respond({ "/dashboard/businesses": { businesses: [{ business_id: "b" }] } });
    expect(await landingFor(session())).toBe("/");
    respond({ "/workers/me": { worker: { status: "inactive" } }, "/members/me": { profile: { user_id: "u" } } });
    expect(await landingFor(session())).toBe("/member/chat");
  });
});

describe("auth callback", () => {
  it("offers a new link when the email link has expired", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/callback?audience=member&type=recovery#error=access_denied&error_code=otp_expired&error_description=expired",
    );
    render(<App />);
    expect(await screen.findByRole("heading", { name: "This link can't be used" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("expired");
    expect(screen.getByRole("button", { name: "Email me a reset link" })).toBeInTheDocument();
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("tells an invited worker to ask for a new invitation instead of offering self-service", async () => {
    window.history.replaceState({}, "", "/auth/callback?audience=staff&type=invite#error_code=otp_expired");
    render(<App />);
    expect(await screen.findByText(/resend your invitation/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reset link/ })).not.toBeInTheDocument();
  });

  it("makes an invited worker set a password before showing the invitation status", async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { access_token: "invite-token", user: { email: "new.worker@example.com" } } },
      error: null,
    });
    window.history.replaceState({}, "", "/auth/callback?audience=staff&type=invite");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Set your password" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "worker-pass-2026" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "worker-pass-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("heading", { name: "Invitation accepted" })).toBeInTheDocument();
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "worker-pass-2026" });
  });

  it("rejects a weak password before calling Supabase", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "t", user: { email: "a@b.c" } } }, error: null });
    window.history.replaceState({}, "", "/auth/callback?audience=member&type=recovery");
    render(<App />);
    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your password needs");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("asks for the emailed code when Supabase requires reauthentication", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "t", user: { email: "a@b.c" } } }, error: null });
    auth.updateUser
      .mockResolvedValueOnce({ error: Object.assign(new Error("Password update requires reauthentication"), { code: "reauthentication_needed" }) })
      .mockResolvedValueOnce({ error: null });
    auth.reauthenticate.mockResolvedValue({ error: null });
    window.history.replaceState({}, "", "/auth/callback?audience=member&type=recovery");
    render(<App />);
    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "member-pass-2026" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "member-pass-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    fireEvent.change(await screen.findByLabelText("Confirmation code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByRole("heading", { name: "Password updated" })).toBeInTheDocument();
    expect(auth.updateUser).toHaveBeenLastCalledWith({ password: "member-pass-2026", nonce: "123456" });
  });
});

describe("member sign-up", () => {
  it("requires a strong, confirmed password and sends verification through the callback", async () => {
    window.history.replaceState({}, "", "/member/signup");
    render(<App />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "member-pass-2026" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "member-pass-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Create member account" }));
    await waitFor(() =>
      expect(auth.signUp).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "member-pass-2026",
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?audience=member&type=signup`, captchaToken: undefined },
      }),
    );
    expect(await screen.findByText("Didn't get the verification email?")).toBeInTheDocument();
  });
});

describe("account security", () => {
  it("shows the sign-in email but offers no way to change it, for members and staff", () => {
    for (const audience of ["member", "staff"] as const) {
      const { unmount } = render(<AccountSecuritySection audience={audience} email="old@example.com" hasPassword />);
      expect(screen.getByText("old@example.com")).toBeInTheDocument();
      expect(screen.queryByLabelText(/Change sign-in email/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Send confirmation" })).not.toBeInTheDocument();
      expect(screen.getByText(/can't be changed here/)).toBeInTheDocument();
      unmount();
    }
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("signs out every session for the account", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, origin: window.location.origin });
    render(<AccountSecuritySection audience="staff" email="admin@example.com" hasPassword />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  });

  it("offers to add a password for a Google-only account", () => {
    render(<AccountSecuritySection audience="member" email="g@example.com" hasPassword={false} />);
    expect(screen.getByRole("button", { name: "Add a password" })).toBeInTheDocument();
  });
});

describe("staff two-step verification", () => {
  const workspace = <p>Workspace content</p>;

  it("opens the workspace for an MFA-verified session", async () => {
    render(<StaffMfaGate signedIn email="admin@example.com">{workspace}</StaffMfaGate>);
    expect(await screen.findByText("Workspace content")).toBeInTheDocument();
  });

  it("makes staff without a factor enrol an authenticator app before entering", async () => {
    mfa.getAuthenticatorAssuranceLevel
      .mockResolvedValueOnce({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null })
      .mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [{ id: "stale", status: "unverified" }] }, error: null });
    mfa.enroll.mockResolvedValue({ data: { id: "factor-1", totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "ABC123" } }, error: null });
    mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    render(<StaffMfaGate signedIn email="worker@example.com">{workspace}</StaffMfaGate>);
    expect(await screen.findByRole("heading", { name: "Set up two-step verification" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR code for your authenticator app" })).toBeInTheDocument();
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "stale" });
    expect(screen.queryByText("Workspace content")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on two-step verification" }));
    expect(await screen.findByText("Workspace content")).toBeInTheDocument();
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-1", code: "123456" });
  });

  it("asks enrolled staff for a code and explains a wrong one", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: "factor-9", status: "verified" }], all: [] }, error: null });
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: new Error("Invalid TOTP code entered") });
    render(<StaffMfaGate signedIn email="admin@example.com">{workspace}</StaffMfaGate>);
    expect(await screen.findByRole("heading", { name: "Enter your verification code" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't work");
    expect(mfa.enroll).not.toHaveBeenCalled();
    expect(screen.queryByText("Workspace content")).not.toBeInTheDocument();
  });

  it("signs a staff browser out after 12 idle hours", async () => {
    localStorage.setItem("fayfort-staff-last-activity", String(Date.now() - STAFF_IDLE_LIMIT_MS - 1000));
    render(<StaffMfaGate signedIn email="admin@example.com">{workspace}</StaffMfaGate>);
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
  });

  it("passes through to the page's own sign-in when nobody is signed in", async () => {
    render(<StaffMfaGate signedIn={false}>{workspace}</StaffMfaGate>);
    expect(await screen.findByText("Workspace content")).toBeInTheDocument();
    expect(mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });
});

describe("turnstile hosts", () => {
  it("only runs the check on fayfort.com hosts registered in Cloudflare", async () => {
    const { turnstileEnabled } = await import("./Turnstile");
    // Tests build without a site key, so it is off everywhere here.
    expect(turnstileEnabled("app.fayfort.com")).toBe(false);
    expect(turnstileEnabled("127.0.0.1")).toBe(false);
  });
});
