import { describe, expect, it } from "vitest";
import { barsForScroll } from "./scrollAwayBars";

describe("bars that scroll away", () => {
  it("hide while scrolling down, show on scrolling up or near the top, and ignore tiny or sideways moves", () => {
    expect(barsForScroll({ previous: 200, top: 260, room: 2000 })).toBe("hide");
    expect(barsForScroll({ previous: 260, top: 200, room: 2000 })).toBe("show");
    expect(barsForScroll({ previous: 10, top: 30, room: 2000 })).toBe("show");
    expect(barsForScroll({ previous: 200, top: 202, room: 2000 })).toBeNull();
    expect(barsForScroll({ previous: 200, top: 200, room: 2000 })).toBeNull();
    expect(barsForScroll({ previous: 60, top: 100, room: 120 })).toBeNull();
  });
});
