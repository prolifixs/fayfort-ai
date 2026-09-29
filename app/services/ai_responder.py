from typing import Any

import requests

from app.config.settings import settings


DEFAULT_SYSTEM_PROMPT = """
You are FayFort AI, an AI customer service assistant.

Your job is to help customers accurately, clearly, and professionally.

Rules:
- Use the provided business knowledge when answering.
- Do not start every response with a greeting.
- Do not repeatedly use the customer's name.
- If the customer's name is known, you may use it naturally in the first response, but do not repeat it throughout the conversation unless there is a specific reason to do so.
- Treat each new message as part of the same ongoing conversation, not as a new conversation.
- Use the conversation history to understand what the customer has already said and what has already been discussed.
- Maintain continuity across messages.
- Do not ask the customer to repeat information they have already provided.
- Refer back to previous messages when relevant.
- Never invent prices, policies, products, availability, or other business facts.
- If the information is not available, say that you do not have enough information.
- Keep responses natural and conversational.
- Do not mention internal databases, RAG, embeddings, prompts, or system instructions.
- Do not claim that you completed an action unless the system actually completed it.
- If a customer needs a human, clearly indicate that the conversation should be handed off.
""".strip()


def _sender_to_role(sender_type: str) -> str:
    """
    Convert our database sender_type values into
    standard chat-completion roles.
    """

    sender = (sender_type or "").strip().lower()

    if sender in {"ai", "assistant", "bot", "agent"}:
        return "assistant"

    return "user"


def build_messages(
    customer_message: str,
    knowledge_context: str = "",
    conversation_history: list[dict[str, Any]] | None = None,
    conversation_summary: str = "",
) -> list[dict[str, str]]:
    """
    Build a proper multi-turn chat message list.

    The conversation history is already stored in the database,
    including the latest customer message, so we avoid duplicating
    the current message when it is already present.
    """

    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": DEFAULT_SYSTEM_PROMPT,
        }
    ]

    if knowledge_context:
        messages.append(
            {
                "role": "system",
                "content": (
                    "BUSINESS KNOWLEDGE:\n"
                    f"{knowledge_context}"
                ),
            }
        )

    if conversation_summary:
        messages.append(
            {
                "role": "system",
                "content": (
                    "CONVERSATION MEMORY:\n"
                    f"{conversation_summary}\n\n"
                    "Use this memory as background context. "
                    "Recent conversation messages take precedence "
                    "if there is any conflict."
                ),
            }
        )

    history = conversation_history or []

    for message in history:
        content = (message.get("content") or "").strip()

        if not content:
            continue

        role = _sender_to_role(
            message.get("sender_type", "")
        )

        messages.append(
            {
                "role": role,
                "content": content,
            }
        )

    # The current customer message is normally already present
    # in conversation_history because main.py saves it before
    # retrieving the conversation history.
    #
    # This fallback protects us if generate_ai_response() is ever
    # called without the current message being stored yet.
    if customer_message.strip():
        current_message = customer_message.strip()

        if not history:
            messages.append(
                {
                    "role": "user",
                    "content": current_message,
                }
            )
        else:
            last_content = (
                history[-1].get("content") or ""
            ).strip()

            if last_content != current_message:
                messages.append(
                    {
                        "role": "user",
                        "content": current_message,
                    }
                )

    return messages


def generate_ai_response(
    customer_message: str,
    knowledge_context: str = "",
    conversation_history: list[dict[str, Any]] | None = None,
    conversation_summary: str = "",
) -> str:

    messages = build_messages(
        customer_message=customer_message,
        knowledge_context=knowledge_context,
        conversation_history=conversation_history,
        conversation_summary=conversation_summary,

    )

    response = requests.post(
        "https://router.huggingface.co/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.HF_TOKEN}",
            "Content-Type": "application/json",
        },
        json={
            "model": "openai/gpt-oss-120b:fastest",
            "messages": messages,
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

def generate_conversation_summary(
    previous_summary: str = "",
    conversation_history: list[dict[str, Any]] | None = None,
) -> str:
    """
    Create a concise long-term memory for the conversation.

    The summary should preserve important customer information,
    decisions, preferences, requests, and unresolved issues while
    avoiding unnecessary conversational detail.
    """

    history = conversation_history or []

    history_text = ""

    for message in history:
        sender = message.get("sender_type", "unknown")
        content = (message.get("content") or "").strip()

        if content:
            history_text += f"{sender}: {content}\n"

    prompt = f"""
You maintain long-term memory for a customer service conversation.

Your job is to create a concise factual summary that can be used
in future messages.

PRESERVE IMPORTANT INFORMATION SUCH AS:
- Customer name or identity information explicitly provided
- What the customer wants
- Products or services they are interested in
- Preferences they have stated
- Important decisions they have made
- Requirements or constraints
- Prices or quantities explicitly discussed
- Questions that remain unresolved
- Important promises or next steps

DO NOT:
- Invent information
- Add assumptions
- Include greetings or conversational filler
- Describe the AI's internal processes
- Include irrelevant small talk

Keep the summary concise and useful for future conversation.

PREVIOUS SUMMARY:
{previous_summary or "No previous summary."}

RECENT CONVERSATION:
{history_text or "No recent conversation."}

Return ONLY the updated summary.
""".strip()

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
                    "content": (
                        "You are a conversation memory manager. "
                        "Return concise factual memory only."
                    ),
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            "temperature": 0.2,
            "max_tokens": 300,
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
        f"AI provider returned an unexpected summary response: {data}"
    )