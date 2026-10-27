import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogCard, DepositsCard, OrdersCard, TrendsCard, type Trend } from "./SourcingTools";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../lib/api", () => ({ apiRequest: mocks.apiRequest }));
afterEach(() => { cleanup(); mocks.apiRequest.mockReset(); });

const trends: Trend[] = [
  { id: "t1", title: "Satin bonnet", url: "https://tiktok.com/a", platform: "tiktok", status: "open", want_count: 37, share_count: 40, pool: null, ready: false, in_store: false },
  { id: "t2", title: "Edge brush", url: "https://tiktok.com/b", platform: "tiktok", status: "pooling", want_count: 12, share_count: 12,
    pool: { target: 10, price: 4.5, currency: "USD", deadline: null, progress: 1 }, ready: true, in_store: false },
];

describe("Sourcing and Fulfillment tool cards", () => {
  it("shows what members want and starts a group buy", async () => {
    const changed = vi.fn();
    mocks.apiRequest.mockResolvedValue({ trend: {} });
    render(<TrendsCard token="t" trends={trends} onChanged={changed} />);
    const card = screen.getByRole("region", { name: "Trends and group buys" });
    expect(within(card).getByText("37 want this")).toBeInTheDocument();
    expect(within(card).getByText("Ready to invoice")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar", { name: /Edge brush/ })).toHaveAttribute("aria-valuenow", "100");
    fireEvent.click(within(card).getByRole("button", { name: "Start a group buy" }));
    const form = within(card).getByRole("form", { name: /Start a group buy for Satin bonnet/ });
    expect(within(form).getByLabelText("Buyers needed")).toHaveValue(37);
    fireEvent.change(within(form).getByLabelText("Group price each"), { target: { value: "6.50" } });
    fireEvent.click(within(form).getByRole("button", { name: "Start the group buy" }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/sourcing/trends/t1/pool", "t", {
      method: "POST", body: JSON.stringify({ target: 37, price: 6.5, currency: "USD", deadline: null, note: null }),
    });
  });

  it("lists deposits to ask for and opens the request", () => {
    const open = vi.fn();
    render(<DepositsCard deposits={[{ request_id: "r1", work_item_id: "w1", title: "Lace wig", stage: "under_review", tier: "free", rate: 0.5, expected_total: 200, currency: "USD", suggested_deposit: 100, claimed: false }]} onOpen={open} />);
    const card = screen.getByRole("region", { name: "Deposits due" });
    expect(within(card).getByText("Free · 50% · about 100.00 USD")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Open" }));
    expect(open).toHaveBeenCalledWith("w1");
  });

  it("searches the catalog", async () => {
    mocks.apiRequest.mockResolvedValue({ products: [{ id: "p1", name: "Body wave lace wig", where: "Store", price_min: 120, currency: "USD", in_stock: false }] });
    render(<CatalogCard token="t" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the catalog" }), { target: { value: "lace wig" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Store · 120.00 USD · sold out")).toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/catalog?q=lace%20wig", "t");
  });

  it("lists shop orders to pack, oldest first", async () => {
    const open = vi.fn();
    mocks.apiRequest.mockResolvedValue({ to_pack_count: 1, shipped_this_week: 4, to_pack: [{ id: "o1", order_name: "#1042", total: "184.00", currency: "USD", placed_at: new Date(Date.now() - 5 * 3600_000).toISOString(), units: 3, work_item_id: "w4", claimed: false }] });
    render(<OrdersCard token="t" enabled reloadKey={1} canManage={false} onOpen={open} />);
    const card = screen.getByRole("region", { name: "Shop orders" });
    expect(await within(card).findByText("#1042 · 3 items")).toBeInTheDocument();
    expect(within(card).getByText(/4 shipped this week/)).toBeInTheDocument();
    expect(within(card).queryByText(/Open full page/)).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Open" }));
    expect(open).toHaveBeenCalledWith("w4");
  });
});
