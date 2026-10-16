import { describe, expect, it } from "vitest";
import { formatSpan, workClock } from "./clock";

const H = 3_600_000;
const start = Date.parse("2026-10-16T00:00:00Z");
const item = (due: number, status = "open") => ({ status, created_at: new Date(start).toISOString(), due_at: new Date(due).toISOString() });

describe("deadline clock", () => {
  it("starts green and turns red as the deadline nears", () => {
    const fresh = workClock(item(start + 24 * H), start + 1 * H);
    const late = workClock(item(start + 24 * H), start + 23 * H);
    expect(fresh.tone).toBe("fresh");
    expect(fresh.hue).toBeGreaterThan(130);
    expect(late.tone).toBe("late");
    expect(late.hue).toBeLessThan(15);
    expect(late.label).toBe("1h left");
  });

  it("shows how long work is overdue", () => {
    const clock = workClock(item(start + 24 * H), start + 27 * H + 20 * 60_000);
    expect(clock.state).toBe("overdue");
    expect(clock.label).toBe("Overdue 3h 20m");
  });

  it("has no clock once work is finished", () => {
    expect(workClock(item(start + H, "completed"), start + 5 * H).state).toBe("none");
  });

  it("formats spans for people", () => {
    expect(formatSpan(45 * 60_000)).toBe("45m");
    expect(formatSpan(52 * H)).toBe("2d 4h");
  });
});
