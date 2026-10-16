# Knowledge base and AI replies: handbook vs site, findings and plan

Status: decisions taken 2026-10-16 (section 5); fixes built, waiting for push, knowledge load and the scored test run (section 6). The site is the source of truth; the Employee Handbook
(Oct 2025) was used as background and for tone. Draft knowledge: docs/KNOWLEDGE_BASE_DRAFT.md.

## 1. Where the handbook and the site differ

| Topic | Handbook (Oct 2025) | Site today |
| --- | --- | --- |
| First payment | $40 "commitment / consultation fee", required before any factory details, links or pictures; refundable at purchase | No entry fee. Members submit sourcing requests free. A **sourcing deposit** (Free 50%, Standard 25%, Pro none in good standing) of the expected total is invoiced by staff; it counts toward the order and FayFort keeps it if the member doesn't buy |
| Consultation | Part of the $40 fee; the CEO calls every client after payment | A separate, optional booking: Free $100, Standard $50, Pro 1 included a month then $50. Paid by Shopify invoice; opens a consultation chat where staff agree a time. No refund rule is written down. Members can cancel it before paying |
| Who calls the client | Favour (Fayfay) personally, every client | Staff in the Operations Center; nothing routes a client to the CEO |
| How FayFort earns | A commission percentage agreed on the CEO call, paid after purchase | Not modelled. Members pay the chosen option's price on a Shopify invoice. Other income: plans ($19 / $49 a month), consultations, supplier contact credits, the shop |
| Intake questions | Product, destination country, budget, asked one at a time | Request form: what they want, how they share it (describe, saved product, catalog, link, screenshot), details, optional budget. Destination comes from the shipping address chosen before paying |
| Supplier details | Never shared outside the company | Members can buy supplier and market contacts in the Supplier directory ($15 each, 5 for $50; Pro gets 10 a month) |
| Updates to the client | Videos, photos and live updates while sourcing | Request timeline milestones, warehouse photos and videos, a delivery estimate (ETA) that changes only with a reason |
| Reply time and hours | Within 30 minutes, Mon–Sat 9:30–18:30 China time; Sunday off | The AI answers at any time. Staff work has a 24-hour deadline by default; a request for a person waits 15 minutes before the AI picks up again. Working hours aren't modelled anywhere |
| Channels | WhatsApp, Instagram, business platforms, group chats | Instagram and Messenger (connected channels) and the member dashboard chat. No WhatsApp; no group-chat tools |
| Lead follow-up | Check in after 24–48 hours if the fee isn't paid | No automatic follow-up (automation rules exist but start switched off) |
| Tracking and reports | Tracking sheet; daily or weekly summaries | Operations Center queue, archive, history and Reports |
| Tone | Warm and personal; clients assume they're talking to Fayfay; "dear" for men, "dear / love / honey" for women; "no AI or copied templates" | The AI introduces itself as FayFort AI in a neutral support voice; the member chat says "FayFort AI can make mistakes" |
| Not in the handbook | — | Membership plans, points and ranks, the shop with group buys and giveaways, disputes, cancelling requests, two shipping addresses |

## 2. How the AI works today (two separate assistants)

1. **Customer channels (Instagram, Messenger).** Answers from the business's **knowledge documents**, with a guard that
   replaces any reply naming a price, refund outcome or delivery promise that isn't in the knowledge.
2. **Member dashboard chat.** Sees **only catalog product matches**: no plans, fees, deposits or how FayFort works.

The Knowledge page in the Control Center manages **FAQs only**, and an approved FAQ is used only when a customer types
that exact question (after punctuation and case). **The AI never reads FAQs otherwise.** The documents the AI does read
have no screen; they can only be added through the API.

## 3. What the live data shows

- The Instagram test account (echolabs911, auto-reply on) is connected to **FayFort Test Business**, which has **no
  knowledge documents** (two synthetic FAQs, archived). "FayFort International" has one three-sentence document.
- Real replies on 14 October:
  - "Hi what services do you offer?" → "I'm sorry, but I don't have enough information about the services we offer."
  - "Do you have any trending products today?" → "Directory information: 1. - Category: Home, Furniture… - Product
    type: Outdoor furniture 2. …" (a raw list).
  - "I need to speak to a live agent please" → first "This conversation should be handed off to a human team member for
    review." (robotic), then correctly opened a handoff.
  - "Hello" / "Are you there?" during that handoff got no reply for about a day. The 15-minute handoff window shipped
    after this, so it should no longer happen; included in the re-test.

## 4. Fix plan (after decisions)

1. **Knowledge page shows what the AI reads.** Add "Business knowledge" documents (add, edit, archive) next to FAQs;
   FAQs and documents both feed the AI. Keep exact-match FAQ replies only for approved wording.
2. **Load the knowledge base** (docs/KNOWLEDGE_BASE_DRAFT.md) into the business that faces customers.
3. **Conversation guide** for the AI from the handbook's tone section, adjusted to the site: warm, one question at a
   time, ask what they want → where it's going → budget, then point to the next step on the site. Never promise prices,
   stock or dates; never ask for card details.
4. **Member chat gets FayFort knowledge** (plans, fees, deposits, how sourcing works), not just catalog matches.
5. **Human-sounding fallbacks.** Replace "This conversation should be handed off…" and "I don't have enough verified
   information…" with short, warm replies that say what we can do next and offer a person.
6. **Product and directory answers** written as a sentence with a few picks, not a raw list.
7. **Test script with scored conversations** (about 20: greetings, services, prices, plans, deposit, consultation,
   shipping, refunds, "speak to a person", out-of-scope, a pushy price question, an angry customer). Run against the
   real model on the server before and after, scored for: correct facts, tone, one question at a time, no invented
   promises, handoff when asked. Results recorded here.

## 5. Decisions (2026-10-16)

1. **No $40 commitment fee.** The site's plans, deposits and consultations are the model.
2. **Commission exists.** It is agreed with the customer and calculated into the product invoice when it is sent. The
   AI says that and gives no percentage.
3. **Hours published**: Monday to Saturday, 9:30 to 18:30 China time. When a customer asks for a person, the reply says
   when to expect one (within 30 minutes in working hours, otherwise the next opening time).
4. **Voice**: the FayFort team, warm, "dear"; never "love"/"honey"; doesn't claim to be Fayfay or a person, and says
   it's the team's assistant if asked.
5. **Customer-facing business**: FayFort Test Business (Instagram connected there). The member dashboard chat reads the
   same knowledge (setting MEMBER_KNOWLEDGE_BUSINESS_ID).
6. **Consultations are refunded if FayFort can't help** (for now).

## 6. What was built

- **Knowledge page**: "What the AI knows" lists Business facts and the Conversation guide with Add, Edit and Remove;
  FAQs stay below. Approved FAQs are now also given to the AI as reference answers, not only on exact match.
- **Conversation guide** documents (type "guide") are given to the AI as tone instructions, separate from facts.
- **Support hours** (app/services/support_hours.py): the handoff reply and the AI both know the time in China and
  whether the team is working.
- **Voice and fallbacks**: new persona section in the system prompt; the grounding guard's replacement replies are
  warm and offer a person.
- **Directory answers** are a short list ("Here's what I found in the FayFort directory, dear: …").
- **Member chat** answers FayFort questions (plans, deposit, consultations, contacts) from the same knowledge.
- **Test script** scripts/ai_eval.py: 22 scripted conversations through the live pipeline without saving anything.

## 7. Test results

To be filled after the knowledge load and the run on the server.
