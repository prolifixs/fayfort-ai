"""Scripted conversations through the customer-channel AI (docs/KNOWLEDGE_AND_AI_PLAN.md step 7).

Runs each scenario turn by turn with the same steps the live pipeline uses (intent → action → handoff check →
approved FAQ → reply), against the business's real knowledge, without saving messages, opening handoffs or touching
Operations. Only the AI usage ledger records the calls. Prints one JSON object per scenario.

On the API server:
    docker compose -f deploy/api/compose.yml exec -T api python - --business <id> < scripts/ai_eval.py
"""
from __future__ import annotations

import argparse
import json
import sys
import time

from app.services.ai_responder import generate_ai_response
from app.services.action_handler import prepare_action
from app.services.faq_matching import match_approved_faq
from app.services.intent_engine import analyze_intent
from app.services.rag import build_business_context
from app.handoffs.automatic import customer_asked_for_human
from app.config.settings import settings
from app.directory.response import format_directory_response
from app.directory.service import lookup_for_message

EVAL_CONVERSATION = "00000000-0000-0000-0000-000000000000"

SCENARIOS: list[tuple[str, list[str]]] = [
    ("greeting", ["Hello"]),
    ("services", ["Hi what services do you offer?"]),
    ("new_enquiry_flow", ["I want to start a clothing business", "Mostly casual wear for women",
                          "Lagos, Nigeria", "Around 2000 dollars"]),
    ("budget_reluctant", ["I need 500 office chairs", "Ghana", "Why do you need my budget?"]),
    ("plans_prices", ["How much are your membership plans?"]),
    ("deposit", ["Do I have to pay anything before you source for me?"]),
    ("deposit_refund", ["If I pay the deposit and don't buy, do I get it back?"]),
    ("consultation", ["How much is a consultation?", "Can I get a refund if you can't help me?"]),
    ("commission", ["How do you make money? Do you charge commission?"]),
    ("old_40_fee", ["Someone told me there's a $40 commitment fee, is that true?"]),
    ("supplier_contacts", ["Can you give me the contact of a wig factory in Guangzhou?"]),
    ("shipping_cost", ["How much is shipping to London?"]),
    ("delivery_promise", ["Can you guarantee my order arrives in 7 days?"]),
    ("hours", ["What are your working hours?"]),
    ("ask_for_person", ["I want to talk to a real person"]),
    ("are_you_a_bot", ["Am I talking to Fayfay or a bot?"]),
    ("group_buy", ["What is a group buy?"]),
    ("cancel_request", ["How do I cancel my sourcing request?"]),
    ("angry", ["This is ridiculous, I've waited 3 days and nobody updated me!"]),
    ("price_pressure", ["Just tell me the price of an iPhone 15 from China, roughly"]),
    ("card_details", ["Can I just send you my card number here to pay?"]),
    ("trending", ["Do you have any trending products today?"]),
]


def run(business_id: str, only: set[str] | None) -> None:
    knowledge = build_business_context(business_id)
    for name, turns in SCENARIOS:
        if only and name not in only:
            continue
        history: list[dict] = []
        transcript = []
        for text in turns:
            history.append({"sender_type": "customer", "content": text})
            started = time.time()
            try:
                intent = analyze_intent(customer_message=text, conversation_history=history, knowledge_context=knowledge,
                                        business_id=business_id)
                decision = prepare_action(intent)
                try:
                    directory = lookup_for_message(message=text, intent=str(intent.intent),
                                                   conversation={"id": EVAL_CONVERSATION, "business_id": business_id},
                                                   enabled=settings.DIRECTORY_TOOLS_ENABLED, authorization=None)
                except Exception:
                    directory = None
                if customer_asked_for_human(intent):
                    from app.services.support_hours import handoff_reply
                    reply, route = handoff_reply(), "handoff"
                elif directory and not directory.requires_human:
                    reply, route = format_directory_response(directory), "directory"
                else:
                    faq = match_approved_faq(business_id, text)
                    if faq:
                        reply, route = faq["answer"], "faq"
                    else:
                        reply = generate_ai_response(customer_message=text, knowledge_context=knowledge,
                                                     conversation_history=history, intent_result=intent,
                                                     action_decision=decision, business_id=business_id)
                        route = "ai"
                meta = {"intent": str(intent.intent), "action": str(intent.action), "route": route}
            except Exception as exc:  # keep going; record the failure
                reply, meta = f"[error: {type(exc).__name__}: {exc}]", {"route": "error"}
            history.append({"sender_type": "ai", "content": reply})
            transcript.append({"customer": text, "reply": reply, **meta, "seconds": round(time.time() - started, 1)})
        print(json.dumps({"scenario": name, "turns": transcript}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--business", required=True)
    parser.add_argument("--only", default="")
    args = parser.parse_args(sys.argv[1:])
    run(args.business, {part for part in args.only.split(",") if part} or None)
