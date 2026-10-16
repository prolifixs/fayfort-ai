/**
 * Playbooks: the same few steps, in the same order, for every kind of work in the Operations Center
 * (docs/OPERATIONS_CENTER_PLAN.md). Steps are worked out from the data, so the stepper always shows where the
 * work really is, and the guide text explains each step for new staff.
 */
import type {
  BusinessConversationContext,
  Department,
  DisputeCase,
  FlowContext,
  HandoffContext,
  MemberConversationContext,
  RequestContext,
  RequestPayments,
  WorkItem,
} from "./types";

export type Step = {
  id: string;
  title: string;
  /** One or two plain sentences: what to do and how. */
  how: string;
  done: boolean;
  /** Set when the step is out of staff hands (member, supplier, payment, carrier...). */
  waitingOn?: string;
  /** Section on the page where the step is done. */
  target?: string;
};

export type PlaybookInput = {
  item: WorkItem;
  userId: string;
  canManage: boolean;
  request: RequestContext | null;
  candidates: number;
  payments: RequestPayments | null;
  flow: FlowContext | null;
  memberConversation: MemberConversationContext | null;
  businessConversation: BusinessConversationContext | null;
  handoff: HandoffContext | null;
  dispute: DisputeCase | null;
};

const FINISHED = ["completed", "cancelled"];
const AFTER_PAYMENT = ["purchase_confirmed", "item_in_warehouse", "shipped", "in_transit", "out_for_delivery", "delivered"];

export function stageOf(request: RequestContext | null) {
  return request?.events.at(-1)?.stage || "submitted";
}
function reached(request: RequestContext | null, stages: string[]) {
  return Boolean(request?.events.some((event) => stages.includes(event.stage)));
}
function claimStep(input: PlaybookInput, how = "Press Claim so the queue knows you have it. Your claim lasts 15 minutes and renews while you work."): Step {
  const { item, userId, canManage } = input;
  return {
    id: "claim",
    title: "Claim it",
    how: canManage ? "As an administrator you can act without claiming. Workers claim first." : how,
    done: canManage || FINISHED.includes(item.status) || (item.assigned_worker_id === userId && item.status !== "open"),
    target: "ops-step-actions",
  };
}
function finishStep(input: PlaybookInput, how: string, auto = false): Step {
  return {
    id: "finish",
    title: auto ? "Closes by itself" : "Mark it completed",
    how,
    done: FINISHED.includes(input.item.status),
    target: auto ? undefined : "ops-status",
  };
}

function sourcingSteps(input: PlaybookInput): Step[] {
  const { request, candidates, payments } = input;
  const stage = stageOf(request);
  const optionChosen = Boolean(payments?.selected_option);
  const invoices = Array.isArray(payments?.invoices) ? payments.invoices : [];
  const invoice = invoices.find((row) => row.kind === "order" && ["sent", "paid"].includes(row.status));
  const paid = reached(request, AFTER_PAYMENT) || invoices.some((row) => row.kind === "order" && row.status === "paid");
  return [
    claimStep(input),
    {
      id: "review",
      title: "Read the request",
      how: "Read what the member wants, open any link or photo they sent, then move the request to Under review. If something is missing, ask them (Needs member input) — they answer from their dashboard.",
      done: stage !== "submitted",
      waitingOn: stage === "needs_member_input" ? "member" : undefined,
      target: "ops-request",
    },
    {
      id: "eta",
      title: "Set the delivery estimate",
      how: "Within 24 hours of the request, set the ETA: your honest estimate of when the member will have the item. The member sees the date on their request. You can't move to Sourcing without it. If it changes later, change it with a reason; the member sees the reason too.",
      done: Boolean(request?.eta_at) || reached(request, ["options_sent", ...AFTER_PAYMENT]),
      target: "ops-deadline",
    },
    {
      id: "research",
      title: "Find options",
      how: "Move the request to Sourcing, then add at least one research candidate: product link, price, supplier and what you checked. Suppliers and notes stay staff-only.",
      done: candidates > 0 || reached(request, ["options_sent", ...AFTER_PAYMENT]),
      target: "ops-candidates",
    },
    {
      id: "share",
      title: "Send options to the member",
      how: "Tick the candidates worth showing and share them. The member sees name, price and your note, and picks one in their dashboard.",
      done: reached(request, ["options_sent", ...AFTER_PAYMENT]),
      target: "ops-share",
    },
    {
      id: "choice",
      title: "Member chooses",
      how: "Wait for the member to pick an option. The work item comes back to the queue with 'Send the invoice' when they do.",
      done: optionChosen || Boolean(paid),
      waitingOn: stage === "options_sent" && !optionChosen ? "member" : undefined,
    },
    {
      id: "invoice",
      title: "Send the invoice",
      how: "Send the Shopify invoice for the chosen option. A paid deposit is taken off automatically. The member pays from the email or their dashboard.",
      done: Boolean(invoice) || Boolean(paid),
      target: "ops-payments",
    },
    {
      id: "paid",
      title: "Payment arrives",
      how: "Nothing to do: when Shopify confirms payment the request becomes Purchase confirmed and moves to Fulfillment for packing.",
      done: Boolean(paid),
      waitingOn: invoice && !paid ? "payment" : undefined,
    },
  ];
}

function fulfillmentSteps(input: PlaybookInput): Step[] {
  const { request } = input;
  return [
    claimStep(input),
    {
      id: "warehouse",
      title: "Receive it at the warehouse",
      how: "When the item arrives, record Item in warehouse and upload a photo or video of it. The member sees the photo on their timeline.",
      done: reached(request, ["item_in_warehouse", "shipped", "in_transit", "out_for_delivery", "delivered"]),
      target: "ops-fulfillment",
    },
    {
      id: "ship",
      title: "Pack and ship",
      how: "Pack the item, then record Shipped with the tracking number (and the carrier link if you have it).",
      done: reached(request, ["shipped", "in_transit", "out_for_delivery", "delivered"]),
      target: "ops-fulfillment",
    },
    {
      id: "transit",
      title: "Keep the member posted",
      how: "Record In transit or Out for delivery when the carrier updates. Short, factual notes only.",
      done: reached(request, ["in_transit", "out_for_delivery", "delivered"]),
      waitingOn: stageOf(request) === "shipped" ? "carrier" : undefined,
      target: "ops-fulfillment",
    },
    {
      id: "delivered",
      title: "Delivered",
      how: "Record Delivered once the carrier confirms it. The request is finished and the work closes.",
      done: reached(request, ["delivered"]) || FINISHED.includes(input.item.status),
      target: "ops-fulfillment",
    },
  ];
}

function conversationSteps(input: PlaybookInput, member: boolean): Step[] {
  const messages = member ? input.memberConversation?.messages || [] : input.businessConversation?.messages || [];
  const last = messages.at(-1);
  const staffReplied = messages.some((m) => m.sender_type === "worker" || m.sender_type === "agent" || m.sender_type === "human_agent");
  const theyAreWaiting = last && (last.sender_type === "member" || last.sender_type === "customer");
  return [
    claimStep(input),
    {
      id: "read",
      title: "Read the chat",
      how: "Read from the top. The customer is on the left, FayFort (AI and staff) on the right. Check what the AI already promised.",
      done: staffReplied,
      target: "ops-chat",
    },
    {
      id: "reply",
      title: "Reply",
      how: "Answer in the reply box. Be specific: what you checked, what happens next and when. Enter sends.",
      done: staffReplied && !theyAreWaiting,
      waitingOn: staffReplied && !theyAreWaiting && !FINISHED.includes(input.item.status) ? (member ? "member" : "customer") : undefined,
      target: "ops-chat",
    },
    member
      ? finishStep(input, "When the member has what they need, mark the work completed. If they write again it reopens by itself.")
      : {
          id: "finish",
          title: input.item.handoff_id ? "Return to the AI" : "Mark it completed",
          how: input.item.handoff_id
            ? "When you're done, return the conversation to the AI assistant. That closes this work item."
            : "When the customer has what they need, mark the work completed.",
          done: FINISHED.includes(input.item.status),
          target: input.item.handoff_id ? "ops-chat" : "ops-status",
        },
  ];
}

function disputeSteps(input: PlaybookInput): Step[] {
  const status = input.dispute?.status || "open";
  return [
    claimStep(input),
    {
      id: "investigate",
      title: "Investigate",
      how: "Read the member's request timeline and evidence. Set the case to Investigating and note what you checked.",
      done: status !== "open",
      target: "ops-dispute",
    },
    {
      id: "contact",
      title: "Talk to the member or supplier",
      how: "If you need something from them, set Awaiting member or Awaiting supplier so the queue knows who has the next move.",
      done: ["resolved", "closed"].includes(status),
      waitingOn: status === "awaiting_member" ? "member" : status === "awaiting_supplier" ? "supplier" : undefined,
      target: "ops-dispute",
    },
    {
      id: "resolve",
      title: "Resolve",
      how: "Write the resolution (refund, replacement, explanation) and set Resolved. The member is told the outcome.",
      done: ["resolved", "closed"].includes(status),
      target: "ops-dispute",
    },
    { id: "close", title: "Close the case", how: "Close the case once the resolution is carried out.", done: status === "closed", target: "ops-dispute" },
  ];
}

function storeOrderSteps(input: PlaybookInput): Step[] {
  const order = input.flow?.order;
  const fulfilled = order?.fulfillment_status === "fulfilled";
  return [
    claimStep(input),
    {
      id: "pick",
      title: "Pick the items",
      how: "Check the item list below against the shelf. Tick each line in the checklist as you pick it.",
      done: fulfilled || FINISHED.includes(input.item.status),
      target: "ops-flow",
    },
    {
      id: "pack",
      title: "Pack and label",
      how: "Pack the order and buy or print the shipping label. Write the tracking number down.",
      done: fulfilled || FINISHED.includes(input.item.status),
      target: "ops-flow",
    },
    {
      id: "fulfil",
      title: "Mark fulfilled in Shopify",
      how: "Open the order in Shopify, press Fulfill items and enter the tracking number. Shopify emails the customer.",
      done: fulfilled || FINISHED.includes(input.item.status),
      target: "ops-flow",
    },
    finishStep(input, "When Shopify reports the order fulfilled, this work closes by itself.", true),
  ];
}

function groupBuySteps(input: PlaybookInput): Step[] {
  const trend = input.flow?.trend;
  const invoices = input.flow?.invoices || [];
  const sent = invoices.some((row) => ["sent", "paid"].includes(row.status));
  const allPaid = invoices.length > 0 && invoices.every((row) => row.status === "paid");
  return [
    claimStep(input),
    {
      id: "price",
      title: "Confirm the group price",
      how: "Get the supplier's price for the whole group, then enter the price each buyer pays (shipping and margin included).",
      done: Boolean(trend?.pool_price) || sent,
      target: "ops-flow",
    },
    {
      id: "invoice",
      title: "Invoice every buyer",
      how: "Press Send group invoices. Each buyer gets a Shopify invoice tied to their own request.",
      done: sent,
      target: "ops-flow",
    },
    {
      id: "paid",
      title: "Buyers pay",
      how: "Nothing to do: each paid invoice moves that buyer's request to Fulfillment. Chase anyone who hasn't paid in their chat.",
      done: allPaid,
      waitingOn: sent && !allPaid ? "payment" : undefined,
    },
    finishStep(input, "Closes by itself once every invoice is paid. Order the stock from the supplier for the whole group.", true),
  ];
}

function giveawaySteps(input: PlaybookInput): Step[] {
  const drawn = Boolean(input.flow?.giveaway?.drawn_at) || input.flow?.giveaway?.status === "drawn";
  return [
    claimStep(input),
    { id: "check", title: "Check the entries", how: "Look at how many members entered. Anything odd (duplicate accounts)? Tell an admin before drawing.", done: drawn, target: "ops-flow" },
    { id: "draw", title: "Draw the winners", how: "Press Draw winners. Winners are picked at random and emailed a 100% discount code for the prize.", done: drawn, target: "ops-flow" },
    finishStep(input, "Closes by itself after the draw. A winner whose prize can't be claimed with a code gets their own 'Arrange the prize' item.", true),
  ];
}

function prizeSteps(input: PlaybookInput): Step[] {
  return [
    claimStep(input),
    { id: "contact", title: "Contact the winner", how: "Congratulate the winner in their member chat and confirm the delivery address.", done: FINISHED.includes(input.item.status), target: "ops-flow" },
    { id: "send", title: "Send the prize", how: "Pack and ship the prize, then post the tracking number in their chat.", done: FINISHED.includes(input.item.status), target: "ops-flow" },
    finishStep(input, "Mark it completed once the prize is on its way."),
  ];
}

function photoReviewSteps(input: PlaybookInput): Step[] {
  const status = input.flow?.review?.status;
  return [
    claimStep(input, "Press Claim. The photo review is assigned to you so you can open the private photo."),
    { id: "look", title: "Look at the photo", how: "Open the private photo and the member's chat to see what they're asking.", done: status === "reviewed" || FINISHED.includes(input.item.status), target: "ops-flow" },
    { id: "reply", title: "Reply in the chat", how: "Say what the item appears to be and suggest up to five matching products from the catalog. Sending the reply closes this work.", done: FINISHED.includes(input.item.status), target: "ops-flow" },
  ];
}

function billingSteps(input: PlaybookInput): Step[] {
  return [
    claimStep(input),
    { id: "message", title: "Message the member", how: "Stripe is retrying their card. Send a friendly note in their chat asking them to update the card in Plans & billing.", done: FINISHED.includes(input.item.status), target: "ops-flow" },
    finishStep(input, "Closes by itself when the payment goes through. If the subscription is cancelled instead, mark it completed.", true),
  ];
}

function invoiceVoidSteps(input: PlaybookInput): Step[] {
  return [
    claimStep(input),
    { id: "delete", title: "Delete it in Shopify", how: "Open the draft order with the button below and delete it. While it exists, the member could still pay the old link.", done: FINISHED.includes(input.item.status), target: "ops-flow" },
    finishStep(input, "Mark it completed once the draft order is deleted."),
  ];
}

function refundSteps(input: PlaybookInput): Step[] {
  return [
    claimStep(input),
    { id: "refund", title: "Refund in Shopify", how: "The member paid an invoice after cancelling the request. Find the order in Shopify and refund it in full.", done: FINISHED.includes(input.item.status), target: "ops-flow" },
    { id: "tell", title: "Tell the member", how: "Message the member below: the refund is on its way and how long their bank usually takes.", done: FINISHED.includes(input.item.status), target: "ops-flow" },
    finishStep(input, "Mark it completed once the refund is done and the member knows."),
  ];
}

function invoiceFailedSteps(input: PlaybookInput): Step[] {
  return [
    claimStep(input),
    { id: "check", title: "Read the error", how: "The error below says why Shopify refused the invoice — usually the member's email or the Shopify connection.", done: FINISHED.includes(input.item.status), target: "ops-flow" },
    { id: "resend", title: "Fix it and send again", how: "Fix the cause, then send the invoice again from the request (Send the invoice step).", done: FINISHED.includes(input.item.status), target: "ops-flow" },
    finishStep(input, "Mark it completed once the invoice has gone out."),
  ];
}

export function playbookSteps(input: PlaybookInput): Step[] {
  const { item } = input;
  switch (item.work_type) {
    case "member_request":
      return item.department === "fulfillment" ? fulfillmentSteps(input) : sourcingSteps(input);
    case "member_conversation":
      return conversationSteps(input, true);
    case "human_handoff":
    case "business_conversation":
      return conversationSteps(input, false);
    case "dispute_case":
      return disputeSteps(input);
    case "store_order":
      return storeOrderSteps(input);
    case "group_buy":
      return groupBuySteps(input);
    case "giveaway_draw":
      return giveawaySteps(input);
    case "giveaway_prize":
      return prizeSteps(input);
    case "photo_review":
      return photoReviewSteps(input);
    case "billing_issue":
      return billingSteps(input);
    case "invoice_failed":
      return invoiceFailedSteps(input);
    case "invoice_void":
      return invoiceVoidSteps(input);
    case "refund_after_cancel":
      return refundSteps(input);
    default:
      return [
        claimStep(input),
        { id: "do", title: "Do the work", how: item.next_action, done: FINISHED.includes(item.status), target: "ops-status" },
        finishStep(input, "Mark it completed when the next action is done."),
      ];
  }
}

export function currentStepIndex(steps: Step[]) {
  const index = steps.findIndex((step) => !step.done);
  return index === -1 ? steps.length - 1 : index;
}

/** A short label for the queue card, from the item alone (no extra loading). */
export function queueStepLabel(item: WorkItem, userId: string, canManage = false): string {
  if (item.status === "completed") return "Done";
  if (item.status === "cancelled") return "Cancelled";
  if (item.status === "waiting") return `Waiting on ${item.waiting_on || "someone"}`;
  if (item.status === "blocked") return "Blocked — needs help";
  if (item.status === "open") return canManage ? "Ready · nobody has it yet" : "Step 1 · Claim it";
  if (item.assigned_worker_id === userId) return "You have it";
  return "Someone has it";
}

// ---------------------------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------------------------
export type Guide = {
  title: string;
  department: Department;
  what: string;
  why: string;
  appears: string;
  steps: { title: string; how: string }[];
  screen: { name: string; meaning: string }[];
  finishes: string;
  outside?: string;
};

const sample = (fn: (input: PlaybookInput) => Step[], item: Partial<WorkItem> = {}) =>
  fn({
    item: { status: "open", work_type: "", department: "sourcing", assigned_worker_id: null, handoff_id: null, ...item } as WorkItem,
    userId: "",
    canManage: false,
    request: null,
    candidates: 0,
    payments: null,
    flow: null,
    memberConversation: null,
    businessConversation: null,
    handoff: null,
    dispute: null,
  }).map(({ title, how }) => ({ title, how }));

const COMMON_SCREEN = [
  { name: "Deadline / ETA", meaning: "When this must be done. Cards start green and turn amber, then red, as the time runs out; past it they show how long they're overdue. On a member request this is the delivery estimate the member sees. Changing it needs a reason." },
  { name: "Steps bar", meaning: "Where the work is. Green ticks are done, the highlighted step is yours now, three dots (…) mean someone else has the next move." },
  { name: "Do now", meaning: "The one thing to do next, with a button that takes you to the right place on the page." },
  { name: "Update status", meaning: "Change the status by hand: Waiting (say on whom), Blocked (needs help) or Completed." },
  { name: "Checklist and notes", meaning: "Your own to-do lines and staff-only notes. Type @email in a note to call a coworker in." },
  { name: "History", meaning: "Everything that happened to this work item, newest last. It can't be edited." },
];

export const GUIDES: Record<string, Guide> = {
  sourcing_request: {
    title: "Sourcing a member request",
    department: "sourcing",
    what: "A member asked FayFort to find and buy something for them.",
    why: "This is the core service: we find the item, the member chooses and pays, then Fulfillment ships it.",
    appears: "When a member sends a request from their dashboard, or a recurring order comes due.",
    steps: sample(sourcingSteps, { work_type: "member_request" }),
    screen: [
      { name: "Member request", meaning: "What they asked for, their link or photo, and the request timeline the member also sees." },
      { name: "Research candidates", meaning: "Products you found. Supplier names and evidence are staff-only." },
      { name: "Share options", meaning: "Sends the ticked candidates to the member to choose from." },
      { name: "Payments", meaning: "Deposit (if their plan needs one) and the final invoice. Shows sent and paid status." },
      ...COMMON_SCREEN,
    ],
    finishes: "When the invoice is paid the request moves to Fulfillment on its own; the sourcing work is done.",
    outside: "Supplier sites, to check the product. Everything else happens here.",
  },
  fulfillment_request: {
    title: "Fulfilling a paid request",
    department: "fulfillment",
    what: "A member has paid; the item has to reach the warehouse and be shipped to them.",
    why: "Members follow every step on their timeline, so each milestone you record is what they see.",
    appears: "Automatically when a sourcing request's invoice is paid (Purchase confirmed).",
    steps: sample(fulfillmentSteps, { work_type: "member_request", department: "fulfillment" }),
    screen: [
      { name: "Fulfillment milestones", meaning: "Record the next stage. Shipped needs a tracking number." },
      { name: "Warehouse evidence", meaning: "Photo or video of the item on arrival. The member sees it." },
      ...COMMON_SCREEN,
    ],
    finishes: "Delivered closes the request and the work item.",
    outside: "The carrier's site to buy labels and check tracking.",
  },
  store_order: {
    title: "Packing a shop order",
    department: "fulfillment",
    what: "A member bought in-stock items from the FayFort shop (Shopify checkout).",
    why: "Shop orders are paid up front; the customer expects them shipped quickly.",
    appears: "When Shopify tells us an order from the shop was paid.",
    steps: sample(storeOrderSteps, { work_type: "store_order", department: "fulfillment" }),
    screen: [
      { name: "Order", meaning: "Order number, items and quantities, total, and the customer." },
      { name: "Open in Shopify", meaning: "Where you mark the order fulfilled and add tracking." },
      ...COMMON_SCREEN,
    ],
    finishes: "Closes by itself when Shopify says the order is fulfilled (or cancelled/refunded).",
    outside: "Shopify admin, only to mark the order fulfilled with tracking.",
  },
  group_buy: {
    title: "Running a group buy",
    department: "sourcing",
    what: "Enough members want the same trending item to buy it together at a better price.",
    why: "One supplier order for the whole group; each buyer pays their share.",
    appears: "When the number of members who want an item reaches the group target.",
    steps: sample(groupBuySteps, { work_type: "group_buy" }),
    screen: [
      { name: "Group", meaning: "Item, number of buyers and the target." },
      { name: "Group price", meaning: "What each buyer pays. Set it before invoicing." },
      { name: "Invoices", meaning: "One per buyer, with sent and paid status." },
      ...COMMON_SCREEN,
    ],
    finishes: "Closes by itself once every buyer has paid. Their own requests wait on this item until then.",
  },
  giveaway_draw: {
    title: "Drawing a giveaway",
    department: "member_support",
    what: "A giveaway has ended and needs its winners picked.",
    why: "Members are waiting to hear; draw promptly.",
    appears: "Shortly after the giveaway's end time.",
    steps: sample(giveawaySteps, { work_type: "giveaway_draw", department: "member_support" }),
    screen: [{ name: "Giveaway", meaning: "Prize, number of entries and number of winners." }, ...COMMON_SCREEN],
    finishes: "Closes after the draw.",
  },
  giveaway_prize: {
    title: "Arranging a prize",
    department: "member_support",
    what: "A giveaway winner whose prize can't be claimed with a discount code.",
    why: "Every winner should receive their prize.",
    appears: "After a draw, for each winner without a code.",
    steps: sample(prizeSteps, { work_type: "giveaway_prize", department: "member_support" }),
    screen: [{ name: "Winner", meaning: "Who won, which giveaway, and why there's no code." }, ...COMMON_SCREEN],
    finishes: "Mark it completed when the prize ships.",
  },
  photo_review: {
    title: "Reviewing a member's photo",
    department: "member_support",
    what: "A member sent a photo and asked a person to say what it is.",
    why: "It often turns into a sale: suggest matching products.",
    appears: "When a member asks for a human photo review in their chat.",
    steps: sample(photoReviewSteps, { work_type: "photo_review", department: "member_support" }),
    screen: [{ name: "Photo review", meaning: "Private photo, the chat, catalog search and your reply." }, ...COMMON_SCREEN],
    finishes: "Sending the reply closes it.",
  },
  billing_issue: {
    title: "Helping with a failed payment",
    department: "member_support",
    what: "Stripe couldn't take a member's subscription payment and is retrying.",
    why: "A quick friendly message keeps the member subscribed.",
    appears: "When a subscription becomes past due.",
    steps: sample(billingSteps, { work_type: "billing_issue", department: "member_support" }),
    screen: [{ name: "Subscription", meaning: "Plan, status and renewal date." }, ...COMMON_SCREEN],
    finishes: "Closes by itself when the payment goes through.",
  },
  invoice_failed: {
    title: "Fixing an invoice that didn't send",
    department: "member_support",
    what: "A Shopify invoice couldn't be created or emailed.",
    why: "The member can't pay until it goes out.",
    appears: "When sending an invoice fails.",
    steps: sample(invoiceFailedSteps, { work_type: "invoice_failed", department: "member_support" }),
    screen: [{ name: "Invoice", meaning: "What it was for, the amount and the error." }, ...COMMON_SCREEN],
    finishes: "Mark it completed when the invoice has been sent.",
  },
  invoice_void: {
    title: "Deleting a cancelled invoice",
    department: "member_support",
    what: "A member cancelled a request, but Shopify didn't delete its unpaid invoice.",
    why: "The old payment link still works until the draft order is deleted.",
    appears: "Only when deleting the invoice automatically fails after a member cancels.",
    steps: sample(invoiceVoidSteps, { work_type: "invoice_void", department: "member_support" }),
    screen: [{ name: "Draft order", meaning: "A button that opens the draft order in Shopify." }, ...COMMON_SCREEN],
    finishes: "Mark it completed when the draft order is deleted.",
    outside: "Shopify admin, to delete the draft order.",
  },
  refund_after_cancel: {
    title: "Refunding a payment after a cancellation",
    department: "member_support",
    what: "A member paid an invoice for a request they had already cancelled.",
    why: "They shouldn't pay for something we aren't getting them.",
    appears: "When Shopify reports a payment for a cancelled request. It's marked urgent.",
    steps: sample(refundSteps, { work_type: "refund_after_cancel", department: "member_support" }),
    screen: [{ name: "Payment", meaning: "What was paid and how much." }, { name: "Chat", meaning: "Message the member." }, ...COMMON_SCREEN],
    finishes: "Mark it completed when the refund is done and the member knows.",
    outside: "Shopify admin, to refund the order.",
  },
  member_conversation: {
    title: "Supporting a member in chat",
    department: "conversation_intake",
    what: "A member asked for a person in their FayFort chat.",
    why: "The AI handles most questions; this is when a human is needed.",
    appears: "When a member asks for staff support in their chat, or writes again after you replied.",
    steps: sample((i) => conversationSteps(i, true), { work_type: "member_conversation", department: "conversation_intake" }),
    screen: [{ name: "Chat", meaning: "Member on the left, FayFort on the right, reply box at the bottom." }, ...COMMON_SCREEN],
    finishes: "Mark it completed when they're helped. It reopens if they write again.",
  },
  human_handoff: {
    title: "Taking over a customer chat",
    department: "conversation_intake",
    what: "A customer of a business on FayFort (Instagram, Messenger, website chat) needs a person.",
    why: "The AI handed off because it couldn't help or the customer asked for someone.",
    appears: "When the AI assistant hands a conversation to a human.",
    steps: sample((i) => conversationSteps(i, false), { work_type: "human_handoff", department: "conversation_intake", handoff_id: "x" }),
    screen: [{ name: "Chat", meaning: "Customer on the left, AI and staff on the right." }, ...COMMON_SCREEN],
    finishes: "Return the conversation to the AI when you're done.",
    outside: "None. Messenger only accepts replies within 24 hours of the customer's last message.",
  },
  dispute_case: {
    title: "Handling a dispute",
    department: "disputes",
    what: "A member has a problem with a request: wrong item, damage, delay or a refund question.",
    why: "Disputes are handled separately so the request timeline stays clean.",
    appears: "When staff open a dispute from a request.",
    steps: sample(disputeSteps, { work_type: "dispute_case", department: "disputes" }),
    screen: [{ name: "Dispute case", meaning: "Category, summary, status and resolution." }, ...COMMON_SCREEN],
    finishes: "Close the case once the resolution is carried out.",
  },
};

export function guideKeyFor(item: Pick<WorkItem, "work_type" | "department">): string {
  if (item.work_type === "member_request") return item.department === "fulfillment" ? "fulfillment_request" : "sourcing_request";
  if (item.work_type === "business_conversation") return "human_handoff";
  return GUIDES[item.work_type] ? item.work_type : "";
}

export const DEPARTMENT_GUIDES: Record<Department, string> = {
  conversation_intake: "People who need a person: member chats and customer chats the AI handed over.",
  sourcing: "Finding what members asked for, getting their choice and their payment. Group buys too.",
  fulfillment: "Everything paid that has to be packed and shipped: sourced requests and shop orders.",
  disputes: "Problems after purchase: damage, wrong items, delays, refunds.",
  member_support: "Photo reviews, giveaways, failed payments and invoices.",
};

export const GLOSSARY: { term: string; meaning: string }[] = [
  { term: "ETA (delivery estimate)", meaning: "When we expect the member to have their item. Required before Sourcing, shown to the member, and changed only with a reason they can read." },
  { term: "Deadline colours", meaning: "Every task has a deadline (24 hours unless set). Green means plenty of time, amber is getting close, red is nearly due. A red card with 'Overdue' has passed its deadline: deal with it first." },
  { term: "Claim", meaning: "Take a work item so nobody else works on it at the same time. Lasts 15 minutes and renews while you work." },
  { term: "Open", meaning: "Nobody has it yet." },
  { term: "Claimed", meaning: "Someone is working on it." },
  { term: "Waiting", meaning: "The next move is someone else's (member, supplier, payment, carrier). It comes back by itself when they act." },
  { term: "Blocked", meaning: "You can't continue without help. Add a note saying why." },
  { term: "Completed / Cancelled", meaning: "Finished. It moves to the Archive." },
  { term: "Archive", meaning: "Finished work from the last 30 days (or longer). Read-only; an admin can reopen it." },
  { term: "Transfer", meaning: "Send the work to another department with a reason. Releases your claim." },
  { term: "Deposit", meaning: "Part-payment before we buy, set by the member's plan (Free 50%, Standard 25%, Pro none in good standing). It is taken off the final invoice." },
  { term: "Invoice", meaning: "A Shopify payment link emailed to the member. Paying it moves the request on by itself." },
  { term: "Group buy", meaning: "Several members buying the same item together at a group price." },
  { term: "Handoff", meaning: "The AI passing a customer conversation to a person." },
  { term: "Milestone", meaning: "A stage on the member's request timeline (Under review, Shipped...). Members see every one." },
  { term: "Due", meaning: "When the work should be done by. Overdue work is flagged and notified." },
];
