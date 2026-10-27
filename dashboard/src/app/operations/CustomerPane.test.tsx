import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerPane } from "./CustomerPane";
import type { WorkItem } from "./types";
import type { OperationsState } from "./useOperationsCenter";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../lib/api", () => ({ apiRequest: mocks.apiRequest }));

const chat: WorkItem = {
  id: "w2", department: "conversation_intake", work_type: "human_handoff", status: "claimed", priority: "normal",
  summary: "Instagram customer", next_action: "Reply", waiting_on: null, waiting_reason: null, due_at: null,
  assigned_worker_id: "me", assigned_automation_key: null, claimed_until: null, version: 1, member_request_id: null,
  member_conversation_id: null, business_id: "b", business_conversation_id: "bc1", handoff_id: "h1", created_at: "2026-10-26T10:00:00Z",
};
const card = {
  kind: "customer", name: "Chioma", profile: { channel: "instagram", username: "chioma.styles", first_seen: "2026-09-01T00:00:00Z" },
  chats: [{ id: "bc1", title: "Split payment", current: true }, { id: "bc0", title: "Wig colours", last_activity_at: "2026-10-01T00:00:00Z" }],
  requests: [{ id: "r1", title: "product order", stage: "awaiting_customer", missing: ["delivery_city"], details: { product: "Bob wig" } }],
  invoices: [],
};
function fakeOps(over: Partial<OperationsState> = {}) {
  return { token: "t", userId: "me", canManage: false, setBusinessReply: vi.fn(), setMemberReply: vi.fn(), refresh: vi.fn(), ...over } as unknown as OperationsState;
}
afterEach(() => { cleanup(); mocks.apiRequest.mockReset(); });

describe("customer pane", () => {
  it("shows who it is, what they asked for and what's still missing", async () => {
    mocks.apiRequest.mockResolvedValue({ card, locked: false });
    render(<CustomerPane ops={fakeOps()} selected={chat} />);
    const who = await screen.findByRole("region", { name: "Who this is" });
    expect(await within(who).findByRole("heading", { name: "Chioma" })).toBeInTheDocument();
    expect(within(who).getByText("Instagram customer")).toBeInTheDocument();
    expect(within(who).getByText("@chioma.styles")).toBeInTheDocument();
    expect(within(who).getByText("Still needed: delivery city")).toBeInTheDocument();
    expect(within(who).getByText("product: Bob wig")).toBeInTheDocument();
    expect(within(who).getByText("This chat")).toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/work-items/w2/customer", "t");
  });

  it("keeps member chats private until claimed", async () => {
    mocks.apiRequest.mockResolvedValue({ card: null, locked: true });
    render(<CustomerPane ops={fakeOps()} selected={{ ...chat, member_conversation_id: "mc", handoff_id: null, business_conversation_id: null, assigned_worker_id: null, status: "open" }} />);
    expect(await screen.findByText(/Claim this chat to see who the member is/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Send to another desk" })).getByText("Claim the chat first.")).toBeInTheDocument();
  });

  it("finds an answer and drops it into the reply", async () => {
    const ops = fakeOps();
    mocks.apiRequest.mockImplementation(async (path: string) =>
      path.startsWith("/operations/answers")
        ? { answers: [{ id: "f1", kind: "faq", title: "Can I split my payment?", text: "Yes, in two parts…", full: "Yes, in two parts for orders over $300." }] }
        : { card, locked: false },
    );
    render(<CustomerPane ops={ops} selected={chat} />);
    const answers = screen.getByRole("region", { name: "Answers" });
    fireEvent.change(within(answers).getByRole("searchbox", { name: "Search answers" }), { target: { value: "split payment" } });
    fireEvent.click(within(answers).getByRole("button", { name: "Search" }));
    fireEvent.click(await within(answers).findByRole("button", { name: "Use in reply" }));
    expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/answers?q=split%20payment", "t");
    const update = (ops.setBusinessReply as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as (current: string) => string;
    expect(update("")).toBe("Yes, in two parts for orders over $300.");
    expect(update("Hi Chioma")).toBe("Hi Chioma\n\nYes, in two parts for orders over $300.");
  });

  it("sends part of the chat to another desk", async () => {
    const ops = fakeOps();
    mocks.apiRequest.mockImplementation(async (path: string) => (path.endsWith("/hand-off") ? { work_item: { id: "new" } } : { card, locked: false }));
    render(<CustomerPane ops={ops} selected={chat} />);
    const send = screen.getByRole("region", { name: "Send to another desk" });
    expect(within(send).queryByRole("option", { name: "Conversations" })).not.toBeInTheDocument();
    fireEvent.change(within(send).getByRole("combobox", { name: "Send to which desk" }), { target: { value: "sourcing" } });
    fireEvent.change(within(send).getByRole("textbox", { name: "What the other desk should do" }), { target: { value: "Source a bob wig, 2 units" } });
    fireEvent.click(within(send).getByRole("button", { name: "Send to Sourcing" }));
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/work-items/w2/hand-off", "t", {
        method: "POST", body: JSON.stringify({ department: "sourcing", note: "Source a bob wig, 2 units" }),
      }),
    );
    expect(await within(send).findByRole("status")).toHaveTextContent("Sent to Sourcing");
    expect(ops.refresh).toHaveBeenCalled();
  });
});
