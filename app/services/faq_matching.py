from __future__ import annotations

import unicodedata

from app.database.business_faqs import find_approved_faq


def normalize_faq_question(question: str) -> str:
    normalized = unicodedata.normalize("NFKC", question).casefold()
    characters = [character if character.isalnum() or character.isspace() else " " for character in normalized]
    return " ".join("".join(characters).split())


def match_approved_faq(business_id: str, customer_message: str) -> dict | None:
    question_key = normalize_faq_question(customer_message)
    if not question_key:
        return None
    return find_approved_faq(business_id, question_key)
