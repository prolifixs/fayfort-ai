import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandedBuyersPanel } from "./LandedBuyersPanel";

const ok = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LANDED buyers panel", () => {
  it("previews the count, asks to confirm, then queues the notice", async () => {
    const sends: unknown[] = [];
    let noticeSent = 0;
    const summary = () => ({ buyers: 3, orders: 3, signed_up: 1, notice_sent: noticeSent, reminder_sent: 0, refunded_orders: 0,
      snapshot: { market: 74, service_provider: 17 }, baserow_closes: "30 November 2026", daily_limit: 95 });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/platform/landed/send")) {
        const body = JSON.parse(String(init?.body));
        sends.push(body);
        if (body.dry_run) return ok({ kind: body.kind, dry_run: true, waiting: 3, would_send: 3 });
        noticeSent = 3;
        return ok({ kind: body.kind, dry_run: false, queued: 3, still_waiting: 0 });
      }
      if (url.endsWith("/platform/landed")) return ok(summary());
      return ok({});
    }));
    render(<LandedBuyersPanel accessToken="t" />);
    expect(await screen.findByText(/74 markets and 17 service providers/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send the notice…" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("3 buyers");
    expect(sends).toEqual([{ kind: "notice", dry_run: true }]);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("3 emails queued.")).toBeInTheDocument();
    expect(sends[1]).toEqual({ kind: "notice", dry_run: false });
  });
});
