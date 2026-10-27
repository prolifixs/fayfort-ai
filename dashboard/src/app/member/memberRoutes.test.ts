import { describe, expect, it } from "vitest";
import { canonicalHref, isShellPath, panelFor, panelHref } from "./memberRoutes";

describe("member addresses", () => {
  it("gives every section its own path", () => {
    expect(panelFor("/member/shop", "")).toBe("catalog");
    expect(panelFor("/member/orders", "")).toBe("requests");
    expect(panelFor("/member/finds", "?find=f1")).toBe("finds");
    expect(panelFor("/member/settings", "")).toBe("settings");
    expect(panelFor("/member/membership", "")).toBe("membership");
    expect(panelFor("/member/notifications", "")).toBe("notifications");
    expect(panelFor("/member/product", "?product=p1")).toBe("product");
    expect(panelFor("/member/product", "")).toBe("catalog");
    expect(panelHref("requests", "?panel=requests", "#request-r1")).toBe("/member/orders#request-r1");
    expect(panelHref("tools", "?panel=directory&tool=directory")).toBe("/member/tools?tool=directory");
  });

  it("keeps old links from emails and the website working, and tidies them", () => {
    expect(panelFor("/member/chat", "?panel=requests")).toBe("requests");
    expect(panelFor("/member/chat", "?panel=directory")).toBe("tools");
    expect(panelFor("/member/chat", "?panel=settings")).toBe("settings");
    expect(panelFor("/member/products", "", "#request-r1")).toBe("requests");
    expect(panelFor("/member/products", "", "#review-v1")).toBe("requests");
    expect(panelFor("/member/products", "?saved=true")).toBe("saved");
    expect(panelFor("/member/rewards", "")).toBe("chat");
    expect(canonicalHref("/member/chat", "?panel=finds&find=f1", "")).toBe("/member/finds?find=f1");
    expect(canonicalHref("/member/chat", "?panel=tools&tool=consultation", "")).toBe("/member/tools?tool=consultation");
    expect(canonicalHref("/member/products", "", "#rate-x")).toBe("/member/orders#rate-x");
    expect(canonicalHref("/member/chat", "?conversation=c1", "")).toBeNull();
    expect(canonicalHref("/member/orders", "", "")).toBeNull();
  });

  it("opens unknown member pages inside the shell, but sign-in and sign-up stay on their own page", () => {
    expect(panelFor("/member/browse", "")).toBe("notfound");
    expect(canonicalHref("/member/browse", "", "")).toBeNull();
    expect(isShellPath("/member/browse")).toBe(true);
    expect(isShellPath("/member/orders/")).toBe(true);
    expect(isShellPath("/member/account")).toBe(false);
    expect(isShellPath("/member/signup")).toBe(false);
  });
});
