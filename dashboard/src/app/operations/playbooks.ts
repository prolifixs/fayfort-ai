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
  const { item, userId } = input;
  return {
    id: "claim",
    title: "Claim it",
    // One rule for everyone, administrators included (owner decision 2026-10-26).
    how,
    done: FINISHED.includes(item.status) || (item.assigned_worker_id === userId && item.status !== "open"),
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

function chatHandoffSteps(input: PlaybookInput): Step[] {
  return [
    claimStep(input),
    { id: "read", title: "Read the note and the chat", how: "Conversations sent this with a note. The chat it came from is below, and the customer card shows who it is and what they asked for.", done: FINISHED.includes(input.item.status), target: "ops-flow" },
    { id: "do", title: "Do what it needs", how: "Take it from there in your desk's usual way. For a member you can message them in their FayFort team chat below.", done: FINISHED.includes(input.item.status), target: "ops-flow" },
    finishStep(input, "Mark it completed once it's done. The chat itself stays with Conversations."),
  ];
}

// ---------------------------------------------------------------------------------------------
// Store team (docs/CATALOG_MERCHANDISING_PLAN.md)
// ---------------------------------------------------------------------------------------------
/** The research parts a find's listing still needs (app/finds/service.py research_missing). */
const FIND_RESEARCH = ["where it's moving (platforms)", "why it's a find (for members)", "its trend stage", "how much competition there is", "the China check", "at least one price break", "the weight of one unit"];

/** FayFort Finds (docs/FINDS_PLAN.md): the listing steps with the research and China check first. */
function findSteps(input: PlaybookInput): Step[] {
  const [claim, ...rest] = listingSteps(input);
  const listing = input.flow?.listing;
  const sent = ["in_review", "published"].includes(listing?.status || "") || FINISHED.includes(input.item.status);
  const researched = sent || (Array.isArray(listing?.missing) && !listing!.missing!.some((m: string) => FIND_RESEARCH.includes(m)));
  return [
    claim,
    {
      id: "research",
      title: "Research and China check",
      how: "Open Products → Finds and fill in what you saw (platforms, why it's a find, in your own words), check it in China (how, cost, minimum order, sample) and press Mark as checked. Add the price per unit at each quantity and the weight of one unit. Can't get it? Press Not obtainable.",
      done: researched,
      target: "ops-listing-details",
    },
    ...rest,
  ];
}

function listingSteps(input: PlaybookInput): Step[] {
  const listing = input.flow?.listing;
  const store = (listing?.kind || input.item.metadata?.listing_kind) === "store_product";
  const status = listing?.status || "draft";
  const sent = ["in_review", "published"].includes(status);
  const live = status === "published" || FINISHED.includes(input.item.status);
  return [
    claimStep(input),
    {
      id: "details",
      title: "Details",
      how: store
        ? "Write a clear title and description and choose the FayFort category. If it comes in sizes or colours, add one option (for example Size) with its values."
        : "Quickest: paste the product's page link in Add from a product link and press Fill from link. It fills the name, description, a rough price and one photo when the shop allows it. Then check the title and description and choose the FayFort category. Say what it's made of and what it's for: the AI uses this text to answer members.",
      done: Boolean(listing?.steps?.details) || sent || live,
      target: "ops-listing-details",
    },
    {
      id: "media",
      title: "Photos and video",
      how: "Upload up to 10 photos or short videos, best first. Bright, square photos on a plain background sell best. The first one is the card members see.",
      done: Boolean(listing?.steps?.media) || sent || live,
      target: "ops-listing-media",
    },
    {
      id: "price",
      title: store ? "Price" : "Rough price",
      how: store
        ? "Enter the price members pay. Add a crossed-out price only if it was really sold for more. Cost is staff-only and shows the margin."
        : "Enter a rough price (from–to) a member can expect, the minimum order and the lead time. It's an estimate: the member still gets a real quote. No price? Leave it empty and members see Contact our team for a price.",
      done: Boolean(listing?.steps?.price) || sent || live,
      target: "ops-listing-price",
    },
    {
      id: "send",
      title: "Send for review",
      how: store
        ? "Press Send for review. FayFort creates the product in Shopify as a draft (customers can't see it) and an administrator checks it."
        : "Press Send for review. An administrator checks the listing before members see it.",
      done: sent || live,
      target: "ops-listing-actions",
    },
    {
      id: "review",
      title: input.canManage ? "Review and publish" : "Administrator review",
      how: input.canManage
        ? "Check the preview: photos, title, price and category. Publish it, or send it back with a note saying exactly what to change."
        : "An administrator checks the preview, then publishes it or sends it back with a note. If it comes back, the note is at the top.",
      done: live,
      waitingOn: status === "in_review" && !input.canManage ? "administrator" : undefined,
      target: "ops-listing-actions",
    },
    finishStep(input, store ? "Closes when it's published. Stock is entered in Shopify by the administrator." : "Closes when it's published.", true),
  ];
}

function mapSteps(input: PlaybookInput): Step[] {
  const done = FINISHED.includes(input.item.status) || Boolean(input.flow?.product?.category_ref && !input.flow?.product?.category_needs_mapping);
  return [
    claimStep(input),
    { id: "choose", title: "Choose the category", how: "Search the FayFort categories and pick the closest one. Members browse by these, and the AI uses them to suggest products.", done, target: "ops-flow" },
    finishStep(input, "Closes as soon as the category is saved. It's also written back to Shopify as a hidden field.", true),
  ];
}

function retireSteps(input: PlaybookInput): Step[] {
  const meta = input.item.metadata || {};
  const asked = Boolean(meta.retire_requested_by);
  return [
    claimStep(input),
    { id: "look", title: "Check the listing", how: String(meta.reason || "Look at why it was flagged.") + " Check whether it's seasonal or coming back.", done: asked || FINISHED.includes(input.item.status), target: "ops-flow" },
    {
      id: "decide",
      title: "Retire or keep",
      how: meta.store_product
        ? "Keep it with a reason (it won't be flagged again for 30 days), or retire it. Retiring a store product archives it in Shopify, so an administrator confirms."
        : "Keep it with a reason (it won't be flagged again for 60 days), or retire it. A retired sourcing item disappears from Browse and can come back with an edit.",
      done: FINISHED.includes(input.item.status),
      waitingOn: asked && !input.canManage && input.item.status === "waiting" ? "administrator" : undefined,
      target: "ops-flow",
    },
    finishStep(input, "Closes when it's kept or retired.", true),
  ];
}

function sectionSteps(input: PlaybookInput): Step[] {
  const done = FINISHED.includes(input.item.status);
  return [
    claimStep(input),
    { id: "check", title: "Check the section", how: "See which products dropped out (sold out or retired) and when it ends.", done, target: "ops-flow" },
    { id: "swap", title: "Swap products or dates", how: "Open the section, replace the missing products with live ones, and set new dates if it should run longer. Keep the hook true (for example 'From $5').", done, target: "ops-flow" },
    finishStep(input, "Saving the section finishes this work.", true),
  ];
}

function campaignSteps(input: PlaybookInput): Step[] {
  const prep = input.flow?.prep;
  const giveaway = (input.item.metadata?.campaign_kind || prep?.kind) === "giveaway";
  return [
    claimStep(input),
    {
      id: "prize",
      title: giveaway ? "Prize ready" : "Products ready",
      how: giveaway
        ? "Check the prize is in stock (or arranged) for every winner. A store-product prize is held back from what members can buy until the giveaway wraps up."
        : "Check every sale product is in stock and has good photos. A sold-out product in a sale disappoints people.",
      done: Boolean(prep?.prize_ready_at) || FINISHED.includes(input.item.status),
      target: "ops-flow",
    },
    {
      id: "section",
      title: giveaway ? "Giveaway on Browse" : "Flash sale section",
      how: giveaway
        ? "The giveaway shows on Browse by itself while it's live. Check its title and prize text read well, and add a matching store section if it helps."
        : "The Flash sale section fills itself while the sale runs. Check it looks right, and refresh any section that clashes.",
      done: Boolean(prep?.section_ready_at) || FINISHED.includes(input.item.status),
      target: "ops-flow",
    },
    {
      id: "announce",
      title: "Announcement",
      how: "Write the post or message announcing it (Instagram, TikTok, WhatsApp). Keep the dates and the prize or discount exact.",
      done: Boolean(prep?.announcement) || FINISHED.includes(input.item.status),
      target: "ops-flow",
    },
    finishStep(input, "Closes once all three are ready. Do it before the start date; the deadline is a day before.", true),
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
    case "chat_handoff":
      return chatHandoffSteps(input);
    case "list_store_product":
    case "list_sourcing_item":
      return listingSteps(input);
    case "list_find":
      return findSteps(input);
    case "map_product":
      return mapSteps(input);
    case "retire_listing":
      return retireSteps(input);
    case "refresh_section":
      return sectionSteps(input);
    case "prepare_campaign":
      return campaignSteps(input);
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
  if (item.status === "open") return "Step 1 · Claim it";
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

Object.assign(GUIDES, {
  list_store_product: {
    title: "Listing a store product",
    department: "store_team",
    what: "Adding something FayFort holds in stock to the shop, or changing one that's already there.",
    why: "Store products are what members can buy straight away, here and on TikTok and Instagram. A clear listing sells; a vague one doesn't.",
    appears: "When you press New store product (or Edit on a product) in Products, or an administrator asks for one.",
    steps: sample(listingSteps, { work_type: "list_store_product", department: "store_team", metadata: { listing_kind: "store_product" } }),
    screen: [
      { name: "Preview", meaning: "How the card and price will look to members. Check it before sending." },
      { name: "Details", meaning: "Title, description, category and one option (Size, Colour) with its values." },
      { name: "Photos and video", meaning: "Up to 10. Drag the best one first: it's the card's picture. Instagram links can't go to Shopify; upload the file." },
      { name: "Price", meaning: "Price, an optional crossed-out price, and cost (staff only)." },
      { name: "Send for review", meaning: "Creates the Shopify draft and hands it to an administrator. You can't edit while it's with them." },
      ...COMMON_SCREEN,
    ],
    finishes: "When an administrator publishes it. They also enter the stock in Shopify.",
    outside: "Shopify, only for the administrator: stock and sales channels.",
  },
  list_sourcing_item: {
    title: "Listing a sourcing item",
    department: "store_team",
    what: "Adding something FayFort can find for members but doesn't keep in stock.",
    why: "Members see it in Browse with Request this item, and the AI can answer questions about it. It turns 'can you get this?' into a request.",
    appears: "When you press New sourcing item, or by itself when 3 or more members share the same trend link.",
    steps: sample(listingSteps, { work_type: "list_sourcing_item", department: "store_team", metadata: { listing_kind: "sourcing_item" } }),
    screen: [
      { name: "Price guide", meaning: "From–to price a member can expect. Shown as 'From $12', never as a fixed price." },
      { name: "Minimum order and lead time", meaning: "The smallest order the supplier accepts and how many days sourcing usually takes." },
      { name: "Availability", meaning: "Sourced on request, Quick to source, or Not available now. None of them shows a Buy button." },
      ...COMMON_SCREEN,
    ],
    finishes: "When an administrator publishes it. A trend it came from links to it, so people who shared it see it.",
  },
  list_find: {
    title: "Preparing a FayFort Find",
    department: "store_team",
    what: "A trending product or rare find for paid members: what you saw, proof it can be got in China, and prices for buying in quantity.",
    why: "Finds are what members pay for. The research and the China check are the value, so members see how each one was found.",
    appears: "When you press Scout a trending find or Scout a rare find in Products → Finds.",
    steps: sample(findSteps, { work_type: "list_find", department: "store_team", metadata: { listing_kind: "sourcing_item" } }),
    screen: [
      { name: "Why it's a find", meaning: "Members read this. Write it in your own words; keep other tools' numbers in Scout notes." },
      { name: "China check", meaning: "In person, with a supplier or online. Members see how and where; the supplier and cost stay with the team." },
      { name: "Price breaks", meaning: "Our price per unit (USD, commission included) from each quantity. Standard and Pro see them." },
      { name: "Weight of one unit", meaning: "Packed weight. With the shipping rates it gives Pro members a landed cost for their country." },
      ...COMMON_SCREEN,
    ],
    finishes: "When an administrator publishes the listing. The find goes into the next Monday drop with room and stays out of Browse until a week after release.",
  },
  chat_handoff: {
    title: "Something sent from a chat",
    department: "sourcing",
    what: "Whoever was answering a chat on the Conversations desk sent part of it to your desk: a product to source, a refund, a dispute.",
    why: "The person in the chat shouldn't have to explain twice, and the chat keeps going while you handle your part.",
    appears: "When someone on Conversations presses Send to another desk in a chat and writes what's needed.",
    steps: sample(chatHandoffSteps, { work_type: "chat_handoff", department: "sourcing" }),
    screen: COMMON_SCREEN,
    finishes: "When you mark it completed. The chat itself stays with Conversations.",
  },
  fill_finds_drop: {
    title: "Filling a Finds drop",
    department: "store_team",
    what: "The next Monday drop has fewer finds than its target, three days before it opens for Pro.",
    why: "Members pay for a full weekly drop. A thin week is noticed.",
    appears: "By itself, three days before a drop opens for Pro when it's short.",
    steps: sample(() => [], { work_type: "fill_finds_drop", department: "store_team" }),
    screen: COMMON_SCREEN,
    finishes: "By itself when the drop is full, or when it opens.",
  },
  research_niche: {
    title: "Researching a niche for a Pro member",
    department: "store_team",
    what: "A Pro member asked the team to scout a niche (they get two a month).",
    why: "It's a Pro perk, and good niches often become finds for everyone.",
    appears: "When a Pro member sends Research a niche for me on the Finds page.",
    steps: sample(() => [], { work_type: "research_niche", department: "store_team" }),
    screen: COMMON_SCREEN,
    finishes: "When you reply to the member in their chat and mark it completed. Add anything worth it as a find.",
    outside: "Reply in the member's chat with what you found; scout the good ones as finds.",
  },
  map_product: {
    title: "Choosing a category",
    department: "store_team",
    what: "A product came from Shopify without a FayFort category.",
    why: "Without a category it's hard to find in Browse and the AI can't suggest it.",
    appears: "When a Shopify product is added or changed without the FayFort category field.",
    steps: sample(mapSteps, { work_type: "map_product", department: "store_team" }),
    screen: [{ name: "Category search", meaning: "Type a word (wig, lace, ankara) to find the category." }, ...COMMON_SCREEN],
    finishes: "As soon as the category is saved.",
  },
  retire_listing: {
    title: "Retiring a listing",
    department: "store_team",
    what: "A listing nobody wants any more: no views or requests for 60 days, or sold out for 30 days.",
    why: "Old listings make Browse feel stale and waste members' time.",
    appears: "By itself when a listing meets one of those rules.",
    steps: sample(retireSteps, { work_type: "retire_listing", department: "store_team" }),
    screen: [{ name: "Retire or keep", meaning: "Keep needs a reason. Retire hides it; a store product is archived in Shopify after an administrator confirms." }, ...COMMON_SCREEN],
    finishes: "When it's kept or retired.",
  },
  refresh_section: {
    title: "Refreshing a store section",
    department: "store_team",
    what: "A store section on Browse is ending soon, or has lost products and is hidden.",
    why: "Sections are the shop window. They should always be full and current.",
    appears: "Two days before a section ends, or when it has fewer live products than its minimum.",
    steps: sample(sectionSteps, { work_type: "refresh_section", department: "store_team" }),
    screen: [{ name: "Section", meaning: "Its products (greyed out if they're not live), its dates and its hook." }, ...COMMON_SCREEN],
    finishes: "When you save the section.",
  },
  prepare_campaign: {
    title: "Preparing a giveaway or flash sale",
    department: "store_team",
    what: "A giveaway or flash sale is scheduled and has to be ready before it starts.",
    why: "A campaign that starts with a missing prize or no announcement wastes the attention it gets.",
    appears: "When an administrator schedules a giveaway or a flash sale. Due a day before it starts.",
    steps: sample(campaignSteps, { work_type: "prepare_campaign", department: "store_team" }),
    screen: [
      { name: "Campaign", meaning: "Dates, prize or discount, and the products with their stock." },
      { name: "Checklist", meaning: "Prize or products ready, Browse section ready, announcement written. All three finish the task." },
      ...COMMON_SCREEN,
    ],
    finishes: "When all three are ticked.",
  },
} satisfies Record<string, Guide>);

/** Guides for the Operations tools that aren't a work type. */
export const TOOL_GUIDES: Record<string, Omit<Guide, "department"> & { department?: Department }> = {
  products_workspace: {
    title: "The Products workspace",
    what: "Everything in the shop in one place: store products from Shopify, sourcing items, listings in progress and store sections.",
    why: "The Store team keeps the catalog fresh here without leaving the Operations Center.",
    appears: "Products tab, for the Store team and administrators.",
    steps: [
      { title: "Find a product", how: "Pick Store or Sourcing and search by name. The label shows its state: Live, Sold out, Draft in Shopify, Waiting for review, Retired." },
      { title: "Change it", how: "Press Edit. It opens a listing with the current details; send it for review like a new one." },
      { title: "Add something new", how: "New store product or New sourcing item. It opens a Store team work item claimed by you." },
      { title: "Scout a find", how: "Finds → Scout a trending find or Scout a rare find. Fill in the research and China check there, then the listing, and send it for review." },
    ],
    screen: [
      { name: "Store", meaning: "Products from Shopify. 'Open in Shopify' is for administrators: stock and sales channels." },
      { name: "Sourcing", meaning: "Items FayFort can find but doesn't stock." },
      { name: "In progress", meaning: "Listings being prepared, waiting for review, or sent back." },
      { name: "Finds", meaning: "FayFort Finds for paid members: research, China check, price breaks, and the weekly drops." },
      { name: "Sections", meaning: "The themed tiles on Browse." },
    ],
    finishes: "—",
  },
  store_sections: {
    title: "Building a store section",
    what: "A themed tile on Browse, like 'Dollar deals · 3 from $0.99', with 3 to 12 products and its own dates.",
    why: "Members arriving from TikTok and Instagram scan the tiles first. Fresh, honest tiles make Browse feel like a shop.",
    appears: "Products → Sections → New section.",
    steps: [
      { title: "Name it and write the hook", how: "A short title and a hook that's true for every product in it: 'From $5', 'Up to 40% off', 'New this week'. Use Suggest to work one out from the prices." },
      { title: "Pick the products", how: "Choose 3 to 12 live products. Sold-out products drop out by themselves; if it falls under its minimum it hides and asks for a refresh." },
      { title: "Set the dates", how: "When it goes live and, if it should, when it ends. Two days before the end you get a refresh task." },
    ],
    screen: [
      { name: "Style", meaning: "Deal (prices and discounts), Trend (what's new or viral) or Category (one category)." },
      { name: "Priority", meaning: "Lower numbers show first." },
      { name: "Minimum", meaning: "How many live products it needs to show." },
    ],
    finishes: "—",
  },
  schedule: {
    title: "Reading the Schedule",
    what: "One calendar of what's coming: giveaways, flash sales, sections, product launches, your deadlines and recurring orders.",
    why: "So nothing starts unprepared and nothing slips past its deadline.",
    appears: "Schedule tab, for everyone. Workers see the shop calendar plus their own work and the open work in their departments.",
    steps: [
      { title: "Pick the view", how: "Week, Month, or the list on a phone. Today is one tap away." },
      { title: "Filter", how: "Untick what you don't need. Administrators can also pick a person or a department." },
      { title: "Open an entry", how: "Every entry opens the work item or page that owns it. You change things there, not in the calendar." },
      { title: "Plan (administrators)", how: "Press + on a day to schedule a giveaway or a store section. A 'Prepare a campaign' task opens for the Store team." },
    ],
    screen: [
      { name: "Colours", meaning: "Pink giveaways, gold sales, navy sections, green launches, grey recurring orders. Red means overdue." },
    ],
    finishes: "—",
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
  store_team: "The shop itself: listing products, choosing categories, store sections, retiring old listings and preparing campaigns.",
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
  { term: "Listing", meaning: "A store product or sourcing item being prepared or edited by the Store team. It goes live only when an administrator publishes it." },
  { term: "Draft (Shopify)", meaning: "A product that exists in Shopify but customers can't see. Store team listings become drafts when they're sent for review." },
  { term: "Publish", meaning: "An administrator's approval that puts a listing live. Workers never publish." },
  { term: "Sent back", meaning: "An administrator asked for changes. The note is at the top of the listing; fix it and send it again." },
  { term: "Store product", meaning: "Something FayFort holds in stock with a fixed price. Members buy it straight away (Shopify checkout)." },
  { term: "Sourcing item", meaning: "Something FayFort can find but doesn't stock. Members request it and get a quote. Its price is a guide, never a fixed price." },
  { term: "Price guide", meaning: "The from–to price a member can expect for a sourcing item." },
  { term: "Store section", meaning: "A themed tile on Browse (title, hook, 3 to 12 products, dates)." },
  { term: "Hook", meaning: "The short line on a section tile, such as 'From $5' or 'Up to 40% off'. It must be true for the products in it." },
  { term: "Retire", meaning: "Take a listing out of Browse. A store product is archived in Shopify after an administrator confirms." },
  { term: "Campaign", meaning: "A giveaway or flash sale. The Store team prepares it before it starts." },
  { term: "Prize hold", meaning: "Stock of a giveaway prize kept back from what members can buy until the giveaway wraps up. Winners can still check out." },
  { term: "Wrap up", meaning: "A week after a giveaway's draw, once every prize is handled: its results are saved and the prize hold ends." },
  { term: "Schedule", meaning: "The calendar tab: campaigns, sections, launches, deadlines and recurring orders in one view." },
];
