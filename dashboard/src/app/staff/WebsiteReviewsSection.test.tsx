import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebsiteReviewsSection, type StaffReview } from "./WebsiteReviewsSection";
import { ReviewPrompts } from "../member/ReviewPrompts";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));

const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;
let reviews: StaffReview[];
const base = { featured: false, country: null, product: null, reviewed_on: null, staff_note: null, ocr_text: null, screenshot_url: null, created_at: "2026-10-18T10:00:00Z" };

beforeEach(() => {
  reviews = [
    { ...base, id: "s1", source: "instagram", status: "pending", rating: null, body: "My wig came in 9 days, exactly like the video!",
      display_name: "Amaka O.", screenshot_url: "https://storage.example/s1.png", ocr_text: "Amaka Obi\nMy wig came in 9 days", staff_note: null },
    { ...base, id: "m1", source: "member", status: "pending", rating: 3, body: "Okay overall, shipping was slow.", display_name: "Kofi A." },
    { ...base, id: "p1", source: "whatsapp", status: "published", rating: null, body: "Thank you FayFort!", display_name: "Tolu" },
  ];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/platform/site/reviews/screenshot")) return ok({ review: reviews[0] }, 201);
    if (url.includes("/platform/site/reviews/") && init?.method === "PUT") return ok({ review: reviews[0] });
    if (url.endsWith("/platform/site/reviews") && init?.method === "POST") return ok({ review: reviews[0] }, 201);
    if (url.includes("/platform/site/reviews")) return ok({ reviews, counts: { pending: 2, published: 1, hidden: 0 } });
    if (url.endsWith("/members/reviews") && init?.method === "POST") return ok({ review: { id: "x", status: "pending" } }, 201);
    if (url.includes("/members/reviews/invites/")) return ok({ dismissed: "i1" });
    if (url.endsWith("/members/reviews")) return ok({ invites: [{ id: "i1", title: "Body wave wig 22 inch", kind: "request", created_at: "2026-10-18" }],
      reviews: [], defaults: { display_name: "Amaka O.", country: "Nigeria" } });
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Control Center customer reviews", () => {
  it("lists reviews to check, with the screenshot, and publishes one", async () => {
    render(<WebsiteReviewsSection accessToken="t" />);
    const card = await screen.findByRole("listitem", { name: "Review from Amaka O." });
    expect(within(card).getByRole("button", { name: "Open the screenshot" })).toBeInTheDocument();
    expect(within(card).getByLabelText("Customer's words")).toHaveValue("My wig came in 9 days, exactly like the video!");
    expect(screen.queryByRole("listitem", { name: "Review from Tolu" })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/platform/site/reviews/s1") && init?.method === "PUT");
      expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ status: "published", display_name: "Amaka O." });
    });
  });

  it("shows a member's words read-only", async () => {
    render(<WebsiteReviewsSection accessToken="t" />);
    const card = await screen.findByRole("listitem", { name: "Review from Kofi A." });
    expect(within(card).getByText("Okay overall, shipping was slow.")).toBeInTheDocument();
    expect(within(card).queryByLabelText("Customer's words")).not.toBeInTheDocument();
    expect(within(card).getByText("Verified order")).toBeInTheDocument();
  });

  it("uploads each screenshot as it is, with the chosen source and a longer wait", async () => {
    render(<WebsiteReviewsSection accessToken="t" />);
    await screen.findByRole("listitem", { name: "Review from Amaka O." });
    fireEvent.change(screen.getByLabelText("Screenshots from"), { target: { value: "whatsapp" } });
    const file = new File([new Uint8Array([137, 80, 78, 71])], "review.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choose screenshots"), { target: { files: [file] } });
    await screen.findByText("1 screenshot read. Check it below, then publish.");
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/screenshot?source=whatsapp"));
    expect(call?.[1]?.body).toBe(file);
    expect((call?.[1]?.headers as Record<string, string>)["Content-Type"]).toBe("image/png");
  });

  it("filters by status", async () => {
    render(<WebsiteReviewsSection accessToken="t" />);
    await screen.findByRole("listitem", { name: "Review from Amaka O." });
    fireEvent.click(screen.getByRole("tab", { name: /Published/ }));
    expect(screen.getByRole("listitem", { name: "Review from Tolu" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Review from Amaka O." })).not.toBeInTheDocument();
  });
});

describe("member review prompt", () => {
  it("rates a shipped order and sends the review", async () => {
    render(<ReviewPrompts accessToken="t" />);
    const prompt = await screen.findByRole("article", { name: "Review Body wave wig 22 inch" });
    fireEvent.click(within(prompt).getByRole("radio", { name: "5 stars, Excellent" }));
    expect(within(prompt).getByLabelText("Name shown")).toHaveValue("Amaka O.");
    fireEvent.change(within(prompt).getByLabelText("Tell other buyers how it went"), { target: { value: "Arrived exactly as described, great team." } });
    fireEvent.click(within(prompt).getByRole("button", { name: "Send review" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Thank you!");
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/members/reviews") && init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ invite_id: "i1", rating: 5, body: "Arrived exactly as described, great team.",
      display_name: "Amaka O.", country: "Nigeria" });
  });

  it("is hidden when nothing is waiting", async () => {
    fetchMock.mockImplementation(async () => ok({ invites: [], reviews: [], defaults: {} }));
    const { container } = render(<ReviewPrompts accessToken="t" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
