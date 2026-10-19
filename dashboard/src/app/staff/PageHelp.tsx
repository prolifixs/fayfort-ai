/**
 * "How this page works" and "What next" for the Control Center, in the same spirit as the Operations Center guides
 * (operations/playbooks.ts). Every page and every Shop tab has a short guide; panels add a "Next" line computed from
 * their own data so staff always know what the next move is and whose it is.
 */
import { useState, type ReactNode } from "react";

export type PageGuide = {
  /** One sentence: what this page is for. */
  what: string;
  /** The usual job on this page, in order. */
  steps: { title: string; how: string }[];
  /** Words or parts of the screen that confuse new staff. */
  terms?: { name: string; meaning: string }[];
  /** Where the work goes after this page, if somewhere else. */
  after?: string;
};

export const PAGE_GUIDES: Record<string, PageGuide> = {
  Overview: {
    what: "A morning check of the selected client account: what is waiting, and a shortcut to every page.",
    steps: [
      { title: "Check the tiles", how: "Any tile that isn't zero is work. Handoffs waiting comes first: a customer is waiting for a person right now." },
      { title: "Open the page", how: "Press a tile to go straight to the page where that work is done." },
      { title: "Read recent activity", how: "The feed shows what just happened (messages, handoffs, automation runs) so you can spot anything unusual." },
    ],
    terms: [{ name: "Client account", meaning: "The business you're working on, picked at the top of the menu. Every Workspace and Operations page shows only that account." }],
  },
  Conversations: {
    what: "Chats on Instagram, Messenger and the website that need a person: a customer asked for someone, or the AI handed over.",
    steps: [
      { title: "Pick the oldest waiting chat", how: "'Waiting for a person' chats come first. Open one to read it from the top." },
      { title: "Take it over", how: "Replies are only possible after a takeover: request one here, then take it over in Human Agents (or from the Operations Center)." },
      { title: "Reply", how: "Answer in the reply box. Delivery status shows under your message; a rejected one can be retried." },
      { title: "Hand it back", how: "When the customer has what they need, return the chat to the AI in Human Agents." },
    ],
    terms: [
      { name: "Not listed?", meaning: "Chats the AI is handling alone aren't listed here. Read any chat in full under Customers → the customer → Read chat." },
      { name: "Messenger 24 hours", meaning: "Messenger only accepts replies within 24 hours of the customer's last message." },
    ],
    after: "Customer requests found in a chat are under Requests.",
  },
  Customers: {
    what: "Everyone who has written to this account, with every chat (including the ones the AI handled alone) and their requests.",
    steps: [
      { title: "Find the customer", how: "Pick them from the list. Their newest activity is at the top." },
      { title: "Read a chat", how: "Press Read chat to see the full thread here, read-only." },
      { title: "Reply if needed", how: "Press Open in Conversations to reply: request a human takeover there, and the reply box opens once it's yours." },
      { title: "Check their requests", how: "Open request takes you to the request card under Requests." },
    ],
  },
  Requests: {
    what: "Things customers asked for in chat (a product, a price, an order), with what is still missing.",
    steps: [
      { title: "Look at 'Still missing'", how: "That is what the customer still has to tell us. The AI asks for it; if it's stuck, ask in the chat yourself." },
      { title: "Move it on", how: "Use Update status: Awaiting customer while we wait for them, Completed when it's done, Cancelled if they changed their mind." },
      { title: "Correct the details", how: "If the AI misunderstood, fix it in Correct request information. Every change is kept in the audit history." },
    ],
    terms: [
      { name: "Active", meaning: "We are working on it." },
      { name: "Awaiting customer", meaning: "The next move is the customer's." },
      { name: "Superseded", meaning: "A newer request from the same customer replaced it." },
    ],
  },
  "Directory & Tools": {
    what: "The supplier and product directory the AI and staff search, and which tools this account may use.",
    steps: [
      { title: "Search with a chat as context", how: "Pick the conversation you're helping, then search. FayFort checks access and verification before showing any fields." },
      { title: "Read the decision", how: "Each search records an outcome (shown, hidden, not verified). That outcome is what the customer may be told." },
    ],
    after: "Unverified records are reviewed in Verification; who may use which tool is set in Entitlements.",
  },
  "Channels & Connections": {
    what: "The customer channels this account is connected to (Instagram, Messenger) and what they receive.",
    steps: [
      { title: "Connect and verify", how: "Add the account and run the check. A connection is only used once it's verified." },
      { title: "Turn on sending", how: "Outbound delivery and automatic replies are off by default. Turn them on only when the account is ready." },
      { title: "Watch inbound activity", how: "The list below shows what each channel received. A rejected message has a reason next to it." },
    ],
  },
  Automations: {
    what: "Rules that run on their own: a reply to a known question, or a scheduled job.",
    steps: [
      { title: "Create a rule", how: "Pick the trigger and the action. New rules start disabled." },
      { title: "Test it", how: "A test rule only records runs, so you can see what it would have done without sending anything." },
      { title: "Enable it", how: "Approved replies are only sent when both the rule and the connection's auto-reply setting are on." },
      { title: "Check its runs", how: "Open a rule's runs to see what it did each time. A failed run shows its status; fix the rule or the connection, then wait for the next run." },
    ],
  },
  Entitlements: {
    what: "Manual access grants to directory tools for this account.",
    steps: [
      { title: "Grant or revoke", how: "Choose the tool, write the reason and save. Every grant and revoke is recorded in the activity feed." },
    ],
    terms: [{ name: "Not billing", meaning: "A grant here is permission only; it isn't a subscription or a payment." }],
  },
  Verification: {
    what: "Imported directory records waiting for a person to check them.",
    steps: [
      { title: "Open a record", how: "Compare the fields with the source (supplier site, documents)." },
      { title: "Decide", how: "Choose its status (Verified, Unverified...) and write a short reason. The tools only return fields that pass the verification rules." },
    ],
  },
  "Human Agents": {
    what: "The queue of chats waiting for a person, and your own availability.",
    steps: [
      { title: "Set yourself available", how: "Choose until when and how many chats you can hold at once. It switches off by itself at the end time." },
      { title: "Take over the oldest", how: "The queue is first in, first out. Take over the top chat (or assign it to a colleague)." },
      { title: "Reply", how: "Open the chat and answer. Replies go out through the connected channel." },
      { title: "Return to automation", how: "When you're done, return it to the AI. That closes the handoff." },
    ],
    terms: [
      { name: "Requested", meaning: "Waiting for a person. Nobody has it yet." },
      { name: "Assigned", meaning: "Given to someone who hasn't taken it over yet." },
      { name: "Active", meaning: "A person is replying." },
      { name: "Returned", meaning: "Back with the AI." },
    ],
  },
  Knowledge: {
    what: "Everything the AI is allowed to answer from: knowledge documents and approved FAQ answers.",
    steps: [
      { title: "Check what it knows", how: "Read the documents list. If the AI gave a wrong answer, the fix usually belongs in one of them." },
      { title: "Add an FAQ", how: "Write the exact question and the answer. Drafts never answer customers; approve it to make it live." },
    ],
    terms: [{ name: "Exact match", meaning: "An approved FAQ answer is sent word for word when a customer asks that exact question." }],
  },
  Analytics: {
    what: "How busy this account has been: chats, handoffs, AI use and everything else recorded, as charts.",
    steps: [
      { title: "Pick the window", how: "7, 30 or 90 days. Every chart and number follows it." },
      { title: "Read the tiles first", how: "They compare the window with the one before it, so you see at a glance whether things went up or down." },
      { title: "Check the AI budget", how: "If the bar is close to the ceiling, the AI will stop answering until the month resets. Tell an administrator." },
      { title: "Use the tables", how: "Every chart has 'Show as table' for the exact numbers." },
    ],
  },
  Settings: {
    what: "The client account's name and description.",
    steps: [{ title: "Edit and save", how: "Only owners and admins can change them. If someone else saved first, reload and try again." }],
  },
  "Member Requests": {
    what: "Member sourcing requests, for administrators to assign to a worker.",
    steps: [
      { title: "Assign", how: "Pick a worker for each new request. They see it in their Operations Center queue." },
    ],
    after: "The work itself (research, invoice, shipping) is done in the Operations Center.",
  },
  "FayFort Workers": {
    what: "Everyone on the FayFort team: who is online, their ratings, hours and accounts.",
    steps: [
      { title: "Invite a worker", how: "Enter their email and press Invite worker. They get an email to set their password; then set their departments on their profile." },
      { title: "Check timesheets", how: "Timesheets shows clock-ins and breaks. Approve or reject correction requests there." },
      { title: "Look after accounts", how: "Open a worker to reset their sign-in, change departments, or deactivate them." },
    ],
    terms: [{ name: "Fresh start", meaning: "A worker's rating goes back to 5.0 after the number of completed tasks you set here. Their history stays visible to administrators." }],
  },
  // Shop: each tab has its own guide (below), so the page itself has none.
  Ads: {
    what: "Ads shown to free members in the member dashboard (Google AdSense and FayFort's own).",
    steps: [
      { title: "Settings", how: "Turn ads on and connect AdSense. Standard and Pro members never see ads." },
      { title: "Placements", how: "Choose where ads can appear. Ads never appear in chats, pop-ups, checkout or next to pay buttons." },
      { title: "Custom ads", how: "Your own ads, shown where a placement uses them or when Google has nothing." },
      { title: "Results", how: "Views and clicks for the last days. Google earnings are in AdSense." },
    ],
  },
  Website: {
    what: "What appears on www.fayfort.com: Instagram posts, customer reviews and the website chat.",
    steps: [
      { title: "Instagram posts", how: "Paste a post link (⋯ → Copy link). It appears on the home page within about 2 minutes." },
      { title: "Reviews", how: "Upload a screenshot of a review a customer sent, check the text it read, then Publish. Member reviews arrive here by themselves." },
    ],
    terms: [{ name: "Pending review", meaning: "Not on the website yet. Nothing is public until staff publish it." }],
  },
  Emails: {
    what: "What FayFort emails people, what was sent, and the newsletter.",
    steps: [
      { title: "Email types", how: "Turn a type off and nobody gets it (they still see the alert in the app)." },
      { title: "Sent emails", how: "Check here first when someone says they didn't get an email: it shows sent, failed or skipped, and why." },
      { title: "Newsletter", how: "Write, preview the number of recipients, then send. It can't be undone." },
    ],
  },
  "Theme Studio": {
    what: "Member dashboard themes: colours, fonts and wrapper style.",
    steps: [
      { title: "Pick a theme or start one", how: "Choose from the catalog, or New theme. Drafts are private." },
      { title: "Set colours and font", how: "Start from a palette, then adjust each colour and the text font. The preview updates as you type." },
      { title: "Save, then publish", how: "Save the draft, check the preview, then publish it for the plans you chose. Editing a published theme makes a new draft; members keep the live one until you publish again." },
    ],
  },
  Infrastructure: {
    what: "The plumbing: Cloudflare tunnels and addresses, webhook endpoints and connected services such as Stripe.",
    steps: [
      { title: "Connections", how: "Paste a service key (Stripe) here. It's stored in the vault and never shown again; test keys first." },
      { title: "Tunnels and hostnames", how: "Only change these when moving the API to another machine." },
      { title: "Webhooks", how: "Run the preflight any time a provider says it can't reach FayFort." },
    ],
  },
  "My account": {
    what: "Your own sign-in: password, email, sessions, two-step verification and your team profile.",
    steps: [
      { title: "Keep it safe", how: "Turn on two-step verification and sign out of sessions you don't recognise." },
      { title: "Your profile", how: "Add a photo so members see who is helping them, and read how your rating's fresh start works." },
    ],
  },

  // Shop tabs ---------------------------------------------------------------------------------
  "Shop/overview": {
    what: "Is Shopify connected and in sync, and what is waiting in the other tabs.",
    steps: [
      { title: "Read 'What needs you'", how: "Each line names the tab where it's done. Work them top to bottom." },
      { title: "Sync if something looks stale", how: "Sync now copies products, prices and stock from Shopify. It also runs by itself on a schedule." },
    ],
  },
  "Shop/revenue": {
    what: "Money in from Shopify (shop orders, invoices, deposits) and Stripe (memberships), with refunds taken off.",
    steps: [
      { title: "Pick the period", how: "The tiles compare it with the period just before." },
      { title: "Import past orders once", how: "Brings in older Shopify orders so the history is complete. Safe to run again." },
    ],
    terms: [{ name: "Net", meaning: "What was paid minus refunds." }],
  },
  "Shop/trends": {
    what: "Links members shared, grouped by item, so '12 want this' is handled once.",
    steps: [
      { title: "Decide what to do with it", how: "Link it to a store product (everyone who wanted it is emailed), open a pool with a group price, or dismiss it." },
      { title: "Invoice a full pool", how: "When a pool reaches its target it shows READY TO INVOICE. Invoice pool emails each member their share." },
    ],
    terms: [{ name: "Pool", meaning: "Members buying the same item together at a group price once enough of them want it." }],
  },
  "Shop/invoices": {
    what: "Deposits and final invoices for sourcing requests.",
    steps: [
      { title: "Deposits due", how: "Enter the expected total and send the deposit. Pro members in good standing don't pay one." },
      { title: "Ready to invoice", how: "The member picked an option. Send the invoice; a paid deposit is taken off by itself." },
      { title: "Watch 'Sent'", how: "Paid invoices move the request to Purchase confirmed and on to Fulfillment by themselves. A failed one shows its error." },
    ],
  },
  "Shop/sales": {
    what: "Flash sales (automatic discount for a time window) and codes (for influencers).",
    steps: [
      { title: "Choose the products", how: "Search by name and tick them. Ids are filled in for you." },
      { title: "Set the window and discount", how: "Without a code it applies by itself between the start and end, with a countdown on the cards." },
      { title: "Create", how: "The Store team gets a task to prepare the sale before it starts." },
    ],
  },
  "Shop/giveaways": {
    what: "Giveaways members enter from the chat's front page, one entry each.",
    steps: [
      { title: "Schedule it", how: "Title, prize, start and end, and the number of winners. Pick the prize product if it's in the shop: winners then get a one-time 100% code." },
      { title: "Let it run", how: "It opens and closes by itself. The Store team gets a task to prepare it a day before." },
      { title: "Draw the winners", how: "After the end time, press Draw winners. It uses a recorded seed so anyone can repeat the draw. Winners are emailed." },
      { title: "Hand out prizes", how: "Winners without a code show up in the Operations Center as 'Arranging a prize'. A week after the draw it wraps up by itself." },
    ],
  },
  "Shop/products": {
    what: "Shopify products that don't have a FayFort category yet.",
    steps: [
      { title: "Pick a category", how: "Choose the closest of the 968 categories and save. It's written back to Shopify too." },
      { title: "Not for the shop?", how: "Tag it fayfort-hide in Shopify (a service, an ebook) and it leaves this list." },
    ],
  },
  "Shop/orders": {
    what: "Orders from the shop and from paid invoices.",
    steps: [
      { title: "Pack paid, unfulfilled orders", how: "Each one is also a 'Packing a shop order' task in the Operations Center." },
      { title: "Fulfil and refund in Shopify", how: "Mark it fulfilled with the tracking number in Shopify. Members see the status in Orders & requests." },
    ],
  },
  "Shop/billing": {
    what: "Standard and Pro member plans, billed monthly through Stripe.",
    steps: [
      { title: "Connect Stripe once", how: "Infrastructure → Connections → paste the Stripe secret key. Setup then runs by itself." },
      { title: "Check it's ready", how: "Status should say Ready and the webhook Connected. If not, press Run setup and sync now." },
    ],
  },
};

const STORAGE_KEY = "fayfort.pageHelp.seen";

function seenPages(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

/** A collapsible "How this page works". Open the first time someone visits the page, then closed unless opened. */
export function PageHelp({ id, guide: given }: { id: string; guide?: PageGuide }) {
  const guide = given || PAGE_GUIDES[id];
  const [open, setOpen] = useState(() => !seenPages()[id]);
  if (!guide) return null;
  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...seenPages(), [id]: true }));
    } catch {
      /* private window: the guide just opens again next time */
    }
  }
  return (
    <section className={open ? "page-help is-open" : "page-help"} aria-label="How this page works">
      <button type="button" className="page-help-toggle" aria-expanded={open} onClick={toggle}>
        <span aria-hidden="true" className="page-help-icon">?</span>
        <span>
          <strong>How this works</strong>
          {!open && <small>{guide.what}</small>}
        </span>
        <span aria-hidden="true" className="page-help-chevron">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="page-help-body">
          <p className="page-help-what">{guide.what}</p>
          <ol className="page-help-steps">
            {guide.steps.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <span>{step.how}</span>
              </li>
            ))}
          </ol>
          {guide.terms && (
            <dl className="page-help-terms">
              {guide.terms.map((term) => (
                <div key={term.name}>
                  <dt>{term.name}</dt>
                  <dd>{term.meaning}</dd>
                </div>
              ))}
            </dl>
          )}
          {guide.after && <p className="page-help-after">{guide.after}</p>}
        </div>
      )}
    </section>
  );
}

export type NextTone = "do" | "wait" | "done" | "problem";

/** One line under a record: what happens next and whose move it is. */
export function NextHint({ tone = "do", children }: { tone?: NextTone; children: ReactNode }) {
  const label = tone === "do" ? "Next" : tone === "wait" ? "Waiting" : tone === "problem" ? "Fix" : "Done";
  return (
    <small className={`next-hint is-${tone}`}>
      <b>{label}</b> {children}
    </small>
  );
}

/** The "do this first" list at the top of a panel, built from its data. Hidden when there's nothing to do. */
export function NextUp({ items, title = "What needs you" }: { items: { text: ReactNode; tone?: NextTone; action?: ReactNode }[]; title?: string }) {
  if (!items.length) return null;
  return (
    <section className="next-up" aria-label={title}>
      <small>{title}</small>
      <ul>
        {items.map((item, index) => (
          <li key={index} className={`is-${item.tone || "do"}`}>
            <span>{item.text}</span>
            {item.action}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Operations Center tool guides (Products, Schedule) in the same collapsible form. */
export function toPageGuide(guide: { what: string; why?: string; steps: { title: string; how: string }[]; screen?: { name: string; meaning: string }[] }): PageGuide {
  return { what: guide.why ? `${guide.what} ${guide.why}` : guide.what, steps: guide.steps, terms: guide.screen };
}
