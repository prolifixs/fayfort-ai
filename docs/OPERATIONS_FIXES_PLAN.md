# Operations, chats, giveaways and notifications: review and fix plan

Status: analysis done 2026-10-26 from the owner's walkthrough (screenshots of Operations, Orders & requests, Tour guide,
Conversations, Browse). Phase A built 2026-10-26 (section 4). Decisions taken (section 3).

## 1. What I found, issue by issue

| # | What you saw | What is actually happening | Kind |
| --- | --- | --- | --- |
| 1 | A worker can go ahead with an item without claiming it | You're signed in as the **administrator**. The server lets administrators act on any item without claiming, and the screen offers them most actions. Workers are blocked by the server, but several panels (stage, payments, delivery date, checklist) still show their buttons before claiming and only fail when pressed. | Rule not consistent; confusing |
| 2 | Workers can work without clocking in | Same cause: the clock-in gate applies to workers, and **administrators are exempt** (your header shows "Clock in" but nothing stops you). Workers can't open Operations or claim work without clocking in. | By design, but not what you want |
| 3 | No option to cancel a deposit (or any) quote | True. Once a deposit or order invoice is sent, staff can't withdraw it and the member can't decline it. The Shopify payment link stays live. | Missing feature |
| 4 | "Move the request into sourcing before sharing options" — is the transfer automatic? | **No.** The request stage is moved by hand ("Move the request to…"). As an administrator who hadn't claimed, you could see **Share options** but not the stage control ("Workers move the request stage after claiming it"), so you hit the error with no way forward on screen. Moving between **departments** is also by hand (Update status → Transfer, folded away). Only payment moves things on by itself (paid → Purchase confirmed). | Flow gap + missing guidance |
| 5 | Batches are confusing | "Add to batch" ticks plus "Create batch" only put a **label** ("In a batch") on requests. Nothing else uses it: no shared research, no shared invoice. | Feature with no payoff |
| 6 | Tour guide booking screen looks bad | Reproduced: the card stretches to the full height, so the rows float in empty space and "Request a tour guide" becomes a huge blue block. | Layout bug |
| 7 | Conversations disappeared from the Control Center | On 2026-10-15 the Conversations page was changed to list **only chats waiting for a person**; everything else moved under Customers → Read chat. Member-app chats aren't listed anywhere in the Control Center; staff only reach them through a work item. | Earlier decision that hurts |
| 8 | In Operations there's no "take over from the AI", and the AI keeps answering while a worker types | Two things: (a) Operations has no Take over / Hand back for member chats (the Control Center has it for Instagram and Messenger). (b) **Bug**: the AI only stays quiet while the worker's last message is newer than the work item's "last updated" time. Any update to the item (a claim, a note, a status change) resets that clock, so the AI decides nobody is helping and replies. It also picks an arbitrary work item when a chat has more than one. | Missing feature + bug |
| 9 | Giveaways don't click; no information page or pop-up | The giveaway card only has an Enter button; there's no details view (prize, rules, dates, entries, winners). | Missing feature |
| 9b | No email when the draw ended | The giveaway ended on 15 Oct but was only drawn today (26 Oct, 08:36 UTC), when someone pressed Draw. **The draw is not automatic**: a "Draw winners" task opens and waits. The winner email for today's draw **was** recorded as sent at 08:36:27 UTC to the winner's account email (code WIN-70863305), so check that inbox and its spam. Entrants who didn't win get nothing. | Not automatic + partial emails |
| 10 | Notifications stopped showing member and worker activity | The staff notifications only cover a few events. A member message makes a notification **only** when the item was "waiting for the member"; a message in a chat a worker is handling makes none. New requests, payments, bookings and tour requests make none either. The last "member replied" notification is from 12 Oct, the last "assigned" from 13 Oct. Nothing broke; the coverage was always too narrow. | Missing coverage |
| 11 | "The chat could not be deleted" (seen in your screenshot) | Deleting a member chat that has a staff work item behind it fails: the work history is kept on purpose and blocks the delete. | Bug |
| 12 | [ACCEPTANCE TEST] items 13 days overdue in the live queue | Test items from 11–12 Oct are still open in Sourcing and inflate the overdue counts. | Clean-up |

## 2. Plan

**Phase A: bugs (one release)**
1. **AI stays quiet while staff help**: base it on the staff reply time, not the item's update time; use the chat's live work item; also stay quiet while the item is "waiting". Plus an explicit **Take over / Hand back to AI** in the Operations chat: while taken over, the AI never replies; it hands back automatically after the idle window, or by pressing Hand back.
2. **Notifications**: member message in any chat with live staff work goes to the assignee (or the department if nobody has it), at most one per chat every few minutes. Also new work in your departments, payment received, new booking or tour request, a quote declined, and items handed to you. Bell and badge refresh live.
3. **Chat delete**: the member's chat is removed from their list but the staff copy and history are kept (archived), so the delete always works.
4. **Tour guide screen**: fix the layout (rows at the top, normal-size button, a clear status for each trip).
5. **Giveaways**: tap a giveaway to open a details pop-up with the prize, rules, dates, entries, Enter button and, after the draw, winners and your code. **Automatic draw** when it ends, with emails to winners and a short "results" email to everyone else. The Draw task stays only as a fallback if the automatic draw fails.
6. **Clean-up**: close the [ACCEPTANCE TEST] items (I'll list them for you first).

**Phase B: flow and guidance**
7. **One rule for claiming**: anything that changes an item needs it claimed by you. Unclaimed, each panel shows **Claim and continue**, so it's one click, never an error. Administrators follow the same rule (decision 1).
8. **Clocking in**: workers as now. Administrators per decision 2.
9. **Automatic stages**: sharing options moves the request into Sourcing and then "Options sent" by itself (asking for the delivery date in the same form if it's missing). Payment keeps moving it on as now. Each step ends with a line saying **what happens next and who does it**, and the step card links to its guide.
10. **Withdraw and decline quotes**: staff get **Withdraw invoice** (the Shopify link stops working) and **Send a new quote**. Members get **Decline** with a reason on a deposit or quote; the item returns to the worker with a notification.
11. **Batches**: per decision 3.
12. **Conversations back**: the Conversations page gets **Waiting for a person** (default) and **All chats**, plus a **Member chats** channel with the member-app chats, each openable with Take over and Reply.

**Phase C**: bookings batch 3 (members pick a time in the app and on fayfort.com), with the tour date picker done together with the tour screen.

Every phase gets tests, screenshots at phone, iPad and desktop, guide text, and an update of this document.

## 3. Decisions (owner, 2026-10-26)

1. **Administrators claim before acting**, like workers (one click, "Claim and continue").
2. **Administrators don't clock in**; a reminder shows when they claim work.
3. **Batches stay.** They're for several members sourcing the same item; Phase B makes them understandable (what a batch
   is for, shared research across the batch, one place to work the batch) instead of removing them.
4. **Order**: A, then B, then C. The Stripe check (live key connected, setup not yet run) comes right after Phase A.

## 4. What was built: Phase A (2026-10-26)

- **AI stays quiet while staff help** (`app/handoffs/window.py`): the rule uses the staff member's last message and the
  work item's start, not its "last updated" time, and counts items that are waiting. New **Take over from the AI / Hand
  back to the AI** on the Operations member chat (`POST /operations/work-items/{id}/take-over | hand-back`); replying
  takes the chat over automatically. A takeover ends by itself after 30 minutes with no staff message
  (HANDOFF_IDLE_MINUTES), and the member is told when a person joins and when the AI is back.
- **Notifications** (migration `20261028090000_operations_fixes_a.sql`): member messages in chats with live staff work
  (to whoever has it, otherwise the department; administrators always; at most one per chat every 10 minutes), new
  unassigned work in your departments, payments received, bookings (new, moved or cancelled by the member), tour
  requests (these were failing silently before: their type wasn't allowed), and work finished by a worker (to
  administrators). The bell refreshes every 20 seconds.
- **Chat delete**: a chat staff worked on is hidden for the member (`member_conversations.member_hidden_at`) and kept
  for the team, so deleting always works.
- **Tour guide card**: it shared a class name with the first-visit tour overlay, which made it full-screen. Renamed;
  trips show a status pill (Quote ready, Waiting for quote, Confirmed) with the next step.
- **Giveaways**: tapping a giveaway opens a details pop-up (prize, description, dates, winners, entries so far, rules,
  Enter, your code or the winners as "Amaka O."). Ended giveaways are **drawn automatically** by the campaign sweep;
  winners get the existing email and everyone else a short results email. The Draw winners task remains the fallback.
- Test: the stale "operator signs in" browser test was rewritten for the current sign-in.
- Open: the 7 [ACCEPTANCE TEST] items in Sourcing are listed for the owner to approve closing.
