"""The FayFort AI's knowledge documents about plans, consultations, deposits and points, written from the plan rules
(app/membership/plans.py, app/membership/ranks.py, settings) so a price change can't leave the AI quoting old numbers.

Run after a price or perk change (on the API host):
    python -c "from app.knowledge.plan_facts import refresh; print(refresh())"
It rewrites the documents with these titles in place (same ids) and rebuilds their chunks, like an edit in Control
Center -> Knowledge would.
"""
from __future__ import annotations

from typing import Any

from app.config.settings import settings
from app.membership import plans, ranks


def _usd(value: float) -> str:
    return f"${value:,.2f}".replace(".00", "")


def documents() -> dict[str, str]:
    standard, pro = settings.MEMBER_STANDARD_MONTHLY_PRICE, settings.MEMBER_PRO_MONTHLY_PRICE
    c = plans.CONSULTATION_PRICE
    a = plans.CONTACT_ALLOWANCE
    single, pack = plans.CONTACT_PACKS["single"], plans.CONTACT_PACKS["pack5"]
    sub = ranks.SUBSCRIPTION_POINTS
    return {
        "Membership plans": f"""| | Free | Standard | Pro |
|---|---|---|---|
| Price | $0 | {_usd(standard)} a month | {_usd(pro)} a month |
| Sourcing deposit | 50% of the expected total | 25% | None once you've bought with us in the last 90 days (otherwise 25%) |
| Consultation (1 hour) | {_usd(c['free'])} | {_usd(c['standard'])} | {_usd(c['pro'])} |
| Supplier contacts | {_usd(single['price'])} each or {pack['credits']} for {_usd(pack['price'])} | {a['standard']} included each paid month, then credits | {a['pro']} included each paid month, then credits |
| Hotels and restaurants in the directory | Free | Free | Free |
| Ads | Shown | None | None |
| Premium themes | No | Yes | Yes |

- Plans are paid monthly by card through Stripe. There is no free trial. You can switch, pause (1–3 months) or cancel any
  time from Member tier.
- Perks grow with loyalty: in your first paid month you get the plan below (Pro on Standard prices, Standard on Free
  prices). Your full plan perks start with your second paid month.
- Included contacts renew each paid month (from your renewal date, not the 1st of the month).
- Moving to a higher plan is charged straight away; moving to a lower plan, and a pause, start when your paid month ends.
- If a payment fails you keep your plan for {settings.BILLING_PAST_DUE_GRACE_DAYS} days while you update your card; after
  that you're on Free until it's paid.
- Pro's deposit-free sourcing needs a paid order in the last 90 days and at least one purchase for every three sourcing
  requests (over the last 90 days).
- Free members who reach rank 4 (Insider) get Standard prices (not the included contacts) while the rank holds.""",
        "Consultations": f"""- A consultation is a one-hour conversation with the FayFort team about your sourcing plan or doing business in China.
- Price: Free {_usd(c['free'])}, Standard {_usd(c['standard'])}, Pro {_usd(c['pro'])}. In the first paid month of a plan
  you pay the price of the plan below. No consultation is included free in a plan.
- Book it from Member tier → Your perks → Book a consultation, with a short topic.
- After payment a consultation chat opens and the team agrees a time with you.
- You can cancel a consultation you haven't paid for from Orders & requests.
- If FayFort can't help with what the consultation was booked for, the consultation fee is refunded.""",
        "Sourcing deposit": """- Before sourcing starts, FayFort may ask for a deposit on the expected product total.
- It is not an extra cost: when you buy the product, the deposit is taken off.
- If you decide not to buy, FayFort keeps the deposit for the sourcing work done.
- The rate depends on your plan: Free 50%, Standard 25%, Pro none once you've bought with us in the last 90 days and keep
  buying (otherwise 25%). In your first paid month of Pro the deposit is 25%.""",
        "Points and ranks": f"""- You earn points for paid orders, sourcing requests that become purchases, deposits, group buys, consultations,
  giveaway entries and each paid plan month (Standard +{sub['standard']}, Pro +{sub['pro']}). Chatting and browsing don't
  earn points. Orders under ${ranks.SMALL_ORDER} earn 1 point per dollar. A refunded or disputed payment earns nothing.
- Ranks: Browser, Scout, Hunter, Insider, Founder's Circle. Insider and above on the Free plan get Standard prices.
- {ranks.REWARDS['contact_credit']['cost']} points can be spent on one supplier contact credit.""",
    }


def refresh() -> dict[str, Any]:
    """Rewrite the plan documents the AI uses and rebuild their chunks. Returns what changed."""
    from app.commerce.db import db
    from app.database.knowledge import delete_knowledge_chunks, update_knowledge_document
    from app.services.knowledge_ingestion import ingest_knowledge

    done: dict[str, Any] = {}
    for title, content in documents().items():
        found = db().table("knowledge_documents").select("id,source_type,content").eq("title", title).execute().data or []
        if not found:
            done[title] = "missing"
            continue
        for document in found:
            if document.get("content") == content:
                done[title] = "unchanged"
                continue
            update_knowledge_document(document_id=document["id"], title=title, content=content,
                                      source_type=document.get("source_type") or "manual")
            delete_knowledge_chunks(document["id"])
            chunks = ingest_knowledge(document_id=document["id"], content=content)
            done[title] = f"updated ({len(chunks) if isinstance(chunks, list) else chunks} chunks)"
    return done
