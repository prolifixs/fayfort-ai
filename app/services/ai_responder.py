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
""".strip()


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
        "https://router.huggingface.co/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.HF_TOKEN}",
            "Content-Type": "application/json",
        },
        json={
            "model": "openai/gpt-oss-120b:fastest",
            "messages": [
                {
                    "role": "system",
                    "content": DEFAULT_SYSTEM_PROMPT,
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            "temperature": 0.3,
            "max_tokens": 500,
            "stream": False,
        },
        timeout=60,
    )

    response.raise_for_status()

    data = response.json()

    try:
        content = data["choices"][0]["message"]["content"]

        if content:
            return content.strip()
    except (KeyError, IndexError, TypeError):
        pass

    raise RuntimeError(
        f"AI provider returned an unexpected response: {data}"
    )