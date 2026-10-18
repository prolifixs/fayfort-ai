"""Walk-throughs: when someone asks how buying with FayFort works, every chat explains the whole journey.

Shared by the channel assistant (Instagram, Messenger, WhatsApp), the member dashboard chat and the website chat
(docs/KNOWLEDGE_AND_AI_PLAN.md, "Walking customers through a process"). Also holds the word filter used by the
directory and catalog searches so filler words ("to", "me", "through", "process") never match products.
"""
from __future__ import annotations

import re

_PROCESS_QUESTION = re.compile(
    r"\bwalk (?:me|us) through\b"
    r"|\bstep[- ]by[- ]step\b|\b(?:the|what are the|which) steps\b|\bsteps? (?:to|for|involved)\b"
    r"|\b(?:purchase|purchasing|buying|order|ordering|sourcing|shipping|delivery|payment|checkout|import|importing)"
    r" process\b"
    r"|\bwhat(?:'s| is) the (?:process|procedure)\b|\bexplain (?:the|your) (?:process|procedure)\b"
    r"|\bhow (?:does|do|will|would) (?:it|this|that|fayfort|you|the process|sourcing|ordering|buying|delivery|"
    r"shipping|payment|the deposit|a group buy|group buying)\b.{0,40}\b(?:work|handle|go|happen|process)"
    r"|\bhow (?:do|can|would|should) (?:i|we) (?:order|buy|purchase|start|begin|pay|get started|place an order|"
    r"import|get (?:it|this|them|my order))\b"
    r"|\bhow to (?:order|buy|purchase|place an order|import|get started|start)\b"
    r"|\bwhat happens (?:next|after|when|once|if)\b|\bfrom start to finish\b|\bend[- ]to[- ]end\b"
    r"|\bhow (?:does|do) (?:i|we) (?:go about|proceed)\b",
    re.IGNORECASE,
)


def asks_for_process(text: str | None) -> bool:
    """True when the message asks how something works or what the steps are, whatever the product."""
    return bool(_PROCESS_QUESTION.search(text or ""))


WALKTHROUGH_GUIDANCE = (
    "The customer is asking how the process works. Walk them through it from start to finish, using only the "
    "business knowledge. This overrides the usual two to four sentences and one-question-at-a-time rhythm for this "
    "reply.\n"
    "- Pick the path that fits what they want: a sourcing request for something we find for them (most products, "
    "bulk and custom orders, furniture and furnishing packages), the shop for in-stock items, a group buy for a "
    "trending item, a consultation for a big project or a business plan. If more than one could fit, give the "
    "sourcing path and mention the other in one line.\n"
    "- Mention the product they named so it feels like their order, not a brochure.\n"
    "- Number the steps (\"1.\", \"2.\" ...), one short line each, six to eight steps, in present tense describing "
    "what happens (\"We review your request within 24 hours\"). Cover the whole journey: signing up free, sending the "
    "request, the review, the deposit if their plan has one, the delivery estimate, the options they choose from, "
    "the invoice and address, the warehouse check with photos, shipping with tracking, and delivery.\n"
    "- Only state times, prices, percentages and rules that appear in the business knowledge. If they ask about "
    "something the knowledge doesn't cover (for example a shipping cost or method), say the team confirms it for "
    "their order.\n"
    "- Plain text, no markdown. Finish with the single next step they can take now, and at most one question "
    "(usually where it ships to, if that isn't known yet)."
)

# Words that never identify a product: grammar, chat filler and process words. Used by every directory and catalog
# search so "walk me through the purchase process" doesn't match "Garment" or "Hair tools".
STOP_WORDS = frozenset("""
a about above after again all also am an and any are as at be because been before being below between both but by
can could did do does doing done down during each else even ever every few for from further get gets getting give
go goes going got had has have having he her here hers him his how i if in into is it its just know let like look
looking make many may me might mine more most much must my myself need needs no nor not now of off on once only or
other our ours out over own please really same say see she should show so some such tell than that the their them
then there these they this those through to too under until up us use very want wanted wants was way we well were
what when where which while who whom why will with would yes yet you your yours
hi hello hey thanks thank okay ok dear sir madam pls plz kindly help hope
buy buying bought purchase purchasing order ordering ordered process procedure step steps walk start started finish
work works working handle handled happen happens next first then later price prices cost costs much many find found
source sourcing sourced supplier suppliers market markets fayfort item items product products
thing things stuff something anything everything get quote quotes ship shipping shipped deliver delivery send sent
""".split())

_WORD = re.compile(r"[a-z0-9一-鿿]+")


def meaningful_terms(text: str | None, *, limit: int = 6) -> list[str]:
    """Words that could name a product, place or category: three letters or more (any length for Chinese), not
    filler. Simple plurals also try their singular ("wigs" finds "wig")."""
    terms: list[str] = []
    for word in _WORD.findall((text or "").casefold()):
        chinese = bool(re.search(r"[一-鿿]", word))
        if word in STOP_WORDS or (not chinese and len(word) < 3) or word.isdigit():
            continue
        if not chinese and len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        if word not in terms:
            terms.append(word)
    return terms[:limit]
