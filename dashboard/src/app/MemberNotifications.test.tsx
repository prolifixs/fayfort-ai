import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberNotificationsBar, MemberNotificationsPage } from "./MemberNotifications";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock("../lib/api", () => ({ apiRequest: mocks.apiRequest }));
vi.mock("../lib/supabase", () => ({
  dashboardAuthConfigured: true,
  supabaseClient: { auth: { getSession: mocks.getSession, onAuthStateChange: mocks.onAuthStateChange } },
}));

const notification = {
  id: "notice-1", notification_type: "request_milestone", title: "Desk lamp", body: "Item shipped",
  href: "/member/products#request-request-1", source_id: "request-1", created_at: "2026-10-10T10:00:00Z",
  read_at: null, banner_dismissed_at: null,
};
const response = { notifications: [notification], unread_count: 1 };

beforeEach(() => {
  mocks.apiRequest.mockReset();
  mocks.apiRequest.mockResolvedValue(response);
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "member-token" } } });
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("member notifications", () => {
  it("shows unread count and dismisses the banner without marking the inbox item read", async () => {
    mocks.apiRequest.mockImplementation(async (path: string) => {
      if (path.includes("dismiss-banner")) return { banner_dismissed: true };
      return response;
    });
    render(<MemberNotificationsBar accessToken="member-token"/>);
    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
    expect(await screen.findByText("Item shipped")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss activity banner" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/members/notifications/notice-1/dismiss-banner", "member-token", { method: "POST" },
    ));
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
  });

  it("loads the inbox and supports mark-all-read", async () => {
    render(<MemberNotificationsPage/>);
    expect(await screen.findByRole("heading", { name: "Your activity" })).toBeInTheDocument();
    expect(await screen.findByText("Desk lamp")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/members/notifications/read-all", "member-token", { method: "POST" },
    ));
  });
});
