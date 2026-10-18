# Knowledge base and AI replies: handbook vs site, findings and plan

Status: fixes live and knowledge loaded into FayFort Test Business on 2026-10-16; first scored run in section 7, with a short list of fixes left. The site is the source of truth; the Employee Handbook
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

## 7. Test results (2026-10-16, real model, 22 conversations, FayFort Test Business)

Run with scripts/ai_eval.py on the server, outside working hours (Saturday 01:30 China time).

**Good (16 of 22).** Services (a clear list instead of "I don't have enough information"), plan prices, consultation
prices and the refund rule, commission ("built into the invoice", no commitment fee), deposit refund (kept for the
sourcing work), hours, asking for a person (warm reply naming the next opening time, "today at 9:30 China time"),
"Fayfay or a bot?" ("the FayFort team's chat assistant"), group buys, cancelling a request, card numbers in chat
(refused, points to checkout), shipping cost (varies, asks which item), delivery guarantee (won't promise), budget
explanation in the handbook's words.

**Needs fixing (6).**
1. *Correct answers replaced by "I can't confirm that".* "Is there a $40 commitment fee?" should get "No"; the price
   guard rejects the reply because $40 isn't in the knowledge (the customer said it). "Do I have to pay anything before
   you source?" should explain the deposit; the action guard reads "we'll send you an invoice" as a promise of an action
   already done, and the odd line "I haven't sent or forwarded anything yet." is added.
2. *Markdown in replies* (`**bold**`, bullet lists). Instagram and Messenger show the asterisks. Replies should be plain
   text with short lines.
3. *New enquiry loops on quantity.* After "Lagos, Nigeria" and "Around 2000 dollars" it asks "How many units?" again and
   never points to the next step (sign up and send a request). Part of this is the test script (it skips the
   customer-state memory the live chat uses), so it needs one live Instagram check before changing the prompt.
4. *Supplier contact request goes straight to a person.* "Contact of a wig factory in Guangzhou?" should explain the
   supplier directory ($15 a contact, unlock in the dashboard) and offer a person, not open a handoff.
5. *Upset customer:* apologises and asks which order, but doesn't offer a person (the guide says to).
6. *"Trending products?"* offers to "show what's trending" it can't show on Instagram; it should point to Browse →
   What's moving in the member dashboard.

Greeting is fine but plain ("Hi! How can we help you today?"); the guide's "dear" shows in fallbacks more than in
normal replies.

**Fixes built (2026-10-16, second batch).**
1. Guard: a reply may repeat the customer's own figure to deny it ("there is no $40 fee"); describing the process
   ("once you choose, we'll send an invoice") is no longer read as a promise. Invented prices and bare promises are
   still blocked.
2. Replies are plain text: the prompt forbids markdown and `plain_text()` strips bold and headings and turns list
   markers into "• " (customer channels and the member chat).
3. Prompt: never re-ask what the customer already gave; quantity is optional; once what, where and budget are known,
   give the next step (sign up and send a sourcing request, or ask for a person).
4. A handoff opens only when the customer asks for a person (English wording, or 人工/客服; other languages trust the
   classifier). The classifier is told supplier or factory contacts are supplier_search answered from the knowledge.
5. Upset customers: apologise once, ask the one detail needed, offer a person in the same reply.
6. Knowledge: "What's trending" points to Browse → What's moving. scripts/load_knowledge.py updates changed documents.

**Second run (2026-10-16, after 5dd9e38).** Fixed: the $40 fee ("We don't have a separate $40 commitment fee"),
plain text everywhere, the new-enquiry flow (asks what → where → budget once each, then "sign up free … submit a
sourcing request"), delivery promises, trending (points to Browse after the knowledge update), commission, consultation
refund. Still wrong, fixed in the third batch:
- "Do I have to pay anything before you source?" answered "No". The knowledge now says plainly that Free and Standard
  members get a deposit invoice after the review, before sourcing starts.
- "Fayfay or a bot?" opened a handoff ("Fayfay" was counted as asking for a person). Removed.
- The upset customer got a cold fallback. Fallbacks now apologise when the customer is upset and say plainly "I can't
  check or send anything myself, but a member of the FayFort team can".
- "Ghana" (a one-word answer) got an empty reply from the model; the reply is now retried once.
- Supplier contacts: the knowledge now says how to unlock one in the Supplier directory; the team doesn't send contacts
  in chat.

**Third run (2026-10-17, after 8dbfc46, during working hours).** 21 of 22 as intended:
- Deposit: "No, you can submit a sourcing request for free. If you're a Free or Standard member, we'll review it and then
  send a deposit invoice … before we start sourcing. Pro members in good standing don't pay a deposit."
- "$40 commitment fee?" → "No, there isn't a $40 commitment fee", then explains deposits.
- "Fayfay or a bot?" → "I'm the FayFort team's assistant. If you'd like a person to join the chat, just let me know."
  (no handoff).
- Upset customer → "I'm sorry about this. … a member of the FayFort team can. Just ask for a person …".
- Supplier contact → sign up free, Supplier directory, search "wigs Guangzhou", unlock.
- Trending → Browse → "What's moving". Greeting → "Hi dear, what would you like to source from China?"
- Asking for a person (in working hours) → "a person usually replies within 30 minutes".
- "Ghana" (one word) now answered: asks for the budget with the handbook's explanation.

Still open: the new-enquiry flow asks "How many pieces?" again after the customer gave destination and budget
(quantity is never given, so the classifier keeps listing it as missing). Suggested fix: once the assistant has asked
for quantity, drop it from the missing details and move to the next step.

## 8. Walking customers through a process (2026-10-18)

Found on Instagram: "I want to buy furniture, walk me through the purchase process" got a directory list of
"Embroidery fabric" and "Hair tools". Two causes:
- Anything that looked like buying (intent product_sourcing, or the words "source", "market", "supplier") went to the
  directory search, whose reply replaces the AI's. The AI, and the "How sourcing works" knowledge, never saw it.
- The directory search split the whole sentence into words and matched any of them anywhere: "to" matched "Hair
  tools" and "me" matched "Garment". The member chat's product cards had the same problem ("the", "through").

What changed:
- `app/services/process_guide.py` recognises process questions ("walk me through", "how does it work", "how do I
  order", "what happens after", "step by step", "from start to finish") for any product.
- Those questions skip the directory, approved FAQs and canned auto-replies, and go to the AI with walk-through
  guidance: the path that fits (sourcing request, shop, group buy, consultation for big projects), numbered steps from
  first message to delivery, the product they named, only facts from the knowledge, then one next step. The reply may
  be longer than the usual two to four sentences (up to 900 tokens).
- The same guidance applies in the member dashboard chat (steps name the dashboard pages; no sign-up step) and the
  website chat (first step is Join free).
- Numbered steps ("2. We will send you options") are no longer mistaken for promises by the answer guard; a bare
  "I'll forward this" outside the steps is still replaced.
- Directory and catalog searches use only words that can name something (three letters or more, no filler or process
  words, simple plurals folded), and return only the rows that match the most of them. Directory keywords match whole
  words ("great" no longer means restaurants).
- Knowledge: new document "From first message to delivery" (docs/KNOWLEDGE_BASE_DRAFT.md section 12), added to FayFort
  Test Business on 2026-10-18. Edit it on the Knowledge page.

Tests: `tests/test_process_guide.py`.
