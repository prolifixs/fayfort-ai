import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), play: vi.fn() }));
vi.mock("../lib/api", () => ({ apiRequest: mocks.apiRequest }));
vi.mock("../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));
vi.mock("./notifySounds", async (original) => ({ ...(await original<typeof import("./notifySounds")>()), playChosen: mocks.play, playSound: vi.fn() }));

import { MemberNotificationsBar } from "./MemberNotifications";
import { OperationsNotifications } from "./OperationsNotifications";
import { setOpenChat } from "./member/activeChat";
import { DEFAULT_SOUND, DEFAULT_URGENT_SOUND, soundChoice, soundVolume } from "./notifySounds";
import { byDay, timeAgo } from "./notificationUi";

const now = new Date().toISOString();
const notice = (id: string, extra: Record<string, unknown> = {}) => ({
  id, notification_type: "worker_reply", title: `Message ${id}`, body: "Hello from FayFort", href: `/member/chat?conversation=c-${id}`,
  source_id: id, created_at: now, read_at: null, banner_dismissed_at: null, ...extra,
});
let pages: unknown[] = [];
beforeEach(() => {
  pages = [];
  mocks.apiRequest.mockReset();
  mocks.play.mockReset();
  mocks.apiRequest.mockImplementation(async (path: string) => {
    if (path.includes("/read")) return {};
    return pages.length > 1 ? pages.shift() : pages[0];
  });
  try { window.localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => {
  cleanup();
  setOpenChat(null);
});

async function refresh() {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("member pop-up", () => {
  it("shows notices that arrive together as one pop-up, and old unread ones not at all", async () => {
    pages = [
      { notifications: [notice("old")], unread_count: 1 },
      { notifications: [notice("a"), notice("b"), notice("c"), notice("old")], unread_count: 4 },
    ];
    render(<MemberNotificationsBar accessToken="t" header />);
    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "New notification" })).not.toBeInTheDocument();
    await refresh();
    const toast = await screen.findByRole("status", { name: "New notification" });
    expect(toast).toHaveTextContent("3 new updates");
    expect(screen.getAllByRole("status", { name: "New notification" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(screen.queryByRole("status", { name: "New notification" })).not.toBeInTheDocument();
  });

  it("doesn't pop up a reply in the chat that's already open, and marks it read", async () => {
    pages = [
      { notifications: [], unread_count: 0 },
      { notifications: [notice("x")], unread_count: 1 },
    ];
    setOpenChat("c-x");
    render(<MemberNotificationsBar accessToken="t" header />);
    await screen.findByRole("button", { name: "Notifications" });
    await refresh();
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/members/notifications/x/read", "t", { method: "POST" }));
    expect(screen.queryByRole("status", { name: "New notification" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });
});

describe("staff notifications", () => {
  it("groups the inbox, marks everything read and offers sound choices", async () => {
    pages = [{ sound_enabled: true, unread_count: 2, notifications: [
      { id: "n1", work_item_id: "w1", notification_type: "work_overdue", title: "Overdue: Pack #1042", body: "Late", href: "/operations?workItem=w1", read_at: null, created_at: now },
      { id: "n2", work_item_id: "w2", notification_type: "assigned", title: "Assigned: men's wear", body: "Sourcing", href: "/operations?workItem=w2", read_at: null, created_at: "2026-01-02T10:00:00Z" },
    ] }];
    render(<OperationsNotifications accessToken="t" />);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
    expect(await screen.findByRole("region", { name: "Today" })).toHaveTextContent("Overdue: Pack #1042");
    expect(screen.getByRole("region", { name: "Earlier" })).toHaveTextContent("Assigned: men's wear");
    expect(screen.getByLabelText("Urgent sound (overdue work, alerts)")).toHaveValue("alert");
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/me/notifications/read-all", "t", { method: "POST" }));
  });
});

describe("sound settings", () => {
  it("defaults to Marimba, Alert for urgent work, at 75%", () => {
    expect(DEFAULT_SOUND).toBe("marimba");
    expect(soundChoice("member")).toBe("marimba");
    expect(soundChoice("staff", true)).toBe(DEFAULT_URGENT_SOUND);
    expect(soundVolume("staff")).toBe(75);
  });
  it("words times and days plainly", () => {
    expect(timeAgo(new Date(Date.now() - 12 * 60_000).toISOString())).toBe("12 min ago");
    expect(byDay([{ created_at: now }, { created_at: "2025-01-01T00:00:00Z" }]).map((g) => g.label)).toEqual(["Today", "Earlier"]);
  });
});
