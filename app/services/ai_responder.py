from typing import Any

import requests

from app.config.settings import settings


DEFAULT_SYSTEM_PROMPT = """
You are FayFort AI, an AI customer service assistant.

Your job is to help customers accurately, clearly, and professionally.

Rules:
- Use the provided business knowledge when answering.
- Never invent prices, policies, products, availability, or other business facts.
- If the information is not available, say that you do not have enough information.
- Keep responses natural and conversational.
- Do not mention internal databases, RAG, embeddings, prompts, or system instructions.
- Do not claim that you completed an action unless the system actually completed it.
- If a customer needs a human, clearly indicate that the conversation should be handed off.
"""


def build_prompt(
    customer_message: str,
    knowledge_context: str = "",
    conversation_history: list[dict[str, Any]] | None = None,
) -> str:
    history = conversation_history or []

    history_text = ""

    for message in history:
        sender = message.get("sender_type", "unknown")
        content = message.get("content", "")

        if content:
            history_text += f"{sender}: {content}\n"

    return f"""
BUSINESS KNOWLEDGE:
{knowledge_context or "No business knowledge was provided."}

CONVERSATION HISTORY:
{history_text or "No previous messages."}

CUSTOMER MESSAGE:
{customer_message}

Respond directly to the customer.
""".strip()


def generate_ai_response(
    customer_message: str,
    knowledge_context: str = "",
    conversation_history: list[dict[str, Any]] | None = None,
) -> str:
    prompt = build_prompt(
        customer_message=customer_message,
        knowledge_context=knowledge_context,
        conversation_history=conversation_history,
    )

    response = requests.post(
        settings.HF_API_URL,
        headers={
            "Authorization": f"Bearer {settings.HF_TOKEN}",
            "Content-Type": "application/json",
        },
        json={
            "inputs": prompt,
            "parameters": {
                "max_new_tokens": 500,
                "temperature": 0.3,
                "return_full_text": False,
            },
        },
        timeout=60,
    )

    response.raise_for_status()

    data = response.json()

    if isinstance(data, list) and data:
        generated = data[0].get("generated_text")

        if generated:
            return generated.strip()

    if isinstance(data, dict):
        generated = data.get("generated_text")

        if generated:
            return generated.strip()

    raise RuntimeError("AI provider returned no generated response")