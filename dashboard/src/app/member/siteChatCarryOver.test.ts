import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../lib/api", () => api);

import { claimPendingSiteChat, rememberSiteChatCode } from "./siteChatCarryOver";

afterEach(() => {
  window.localStorage.clear();
  api.apiRequest.mockReset();
});

describe("website chat carry-over", () => {
  it("does nothing without a code", async () => {
    expect(await claimPendingSiteChat("token", null)).toBeNull();
    expect(api.apiRequest).not.toHaveBeenCalled();
  });

  it("claims the code kept in this browser, then forgets it", async () => {
    window.history.replaceState({}, "", "/member/account?site_chat=abcdefghijklmnopqrstuvwx&x=1");
    expect(rememberSiteChatCode()).toBe("abcdefghijklmnopqrstuvwx");
    expect(window.location.search).toBe("?x=1");
    api.apiRequest.mockResolvedValue({ conversation_id: "chat-9" });
    expect(await claimPendingSiteChat("token", null)).toBe("chat-9");
    expect(api.apiRequest).toHaveBeenCalledWith("/members/site-chat/claim", "token", expect.objectContaining({
      method: "POST", body: JSON.stringify({ code: "abcdefghijklmnopqrstuvwx" }) }));
    expect(window.localStorage.getItem("ff_site_chat_code")).toBeNull();
  });

  it("uses the code saved at sign-up when the email was opened in another browser", async () => {
    api.apiRequest.mockResolvedValue({ conversation_id: "chat-3" });
    const session = { user: { user_metadata: { site_chat_code: "zzzzzzzzzzzzzzzzzzzzzzzz" } } } as never;
    expect(await claimPendingSiteChat("token", session)).toBe("chat-3");
    expect(api.apiRequest.mock.calls[0][2].body).toBe("{}");
  });

  it("ignores a malformed code in the address", () => {
    window.history.replaceState({}, "", "/member/signup?site_chat=<bad>");
    expect(rememberSiteChatCode()).toBe("");
  });
});
