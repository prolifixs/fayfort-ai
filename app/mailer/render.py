"""Branded FayFort email rendering: one HTML shell plus a plain-text alternative for every email."""
from __future__ import annotations

import html
import re
from dataclasses import dataclass

BRAND = "#197c69"
_URL = re.compile(r"(https?://[^\s<>\"']+)")


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str


def _esc(value: str) -> str:
    return html.escape(value or "", quote=True)


def text_to_html_paragraphs(body: str) -> str:
    """Newsletter body: blank lines separate paragraphs, single newlines become line breaks,
    and bare https links become clickable. Everything else is escaped."""
    paragraphs = [block.strip() for block in re.split(r"\n\s*\n", (body or "").replace("\r\n", "\n")) if block.strip()]
    rendered = []
    for block in paragraphs:
        escaped = _esc(block)
        linked = _URL.sub(lambda m: f'<a href="{m.group(1)}" style="color:{BRAND}">{m.group(1)}</a>', escaped)
        rendered.append(
            f'<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#2f3a4a">{linked.replace(chr(10), "<br>")}</p>'
        )
    return "".join(rendered)


def shell(*, heading: str, intro_html: str, button_label: str | None, button_url: str | None,
          footer_note: str, unsubscribe_url: str | None) -> str:
    button = (
        f'<a href="{_esc(button_url)}" style="display:inline-block;background:{BRAND};color:#ffffff;text-decoration:none;'
        f'font-weight:700;font-size:14px;padding:12px 20px;border-radius:8px">{_esc(button_label)}</a>'
        if button_label and button_url else ""
    )
    unsubscribe = (
        f'<br><a href="{_esc(unsubscribe_url)}" style="color:#8992a0">Unsubscribe from these emails</a>'
        if unsubscribe_url else ""
    )
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#1c2434">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e9ef;border-radius:14px">
<tr><td style="padding:32px 32px 8px">
<div style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;border-radius:9px;background:#e5f5ee;color:{BRAND};font-weight:700;font-size:18px">F</div>
<p style="margin:18px 0 0;font-size:11px;letter-spacing:2px;color:#718091;font-weight:700">FAYFORT</p>
<h1 style="margin:8px 0 14px;font-size:22px;line-height:1.3;color:#1c2434">{_esc(heading)}</h1>
{intro_html}
{button}
</td></tr>
<tr><td style="padding:22px 32px 28px;font-size:12px;line-height:1.6;color:#8992a0">{_esc(footer_note)}<br>FayFort &middot; fayfort.com{unsubscribe}</td></tr>
</table></td></tr></table></body></html>"""


def _paragraph(text: str) -> str:
    return f'<p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#596274">{_esc(text)}</p>'


def notification_email(*, category: str, title: str, body: str, url: str,
                       unsubscribe_url: str | None) -> RenderedEmail:
    """Customer alert email built from the same title/body the member sees in-app."""
    if category == "conversations":
        subject, heading, button = "FayFort replied to you", title or "FayFort replied", "Open the conversation"
        intro = f"{body}\n\nOpen your chat to read the reply and continue the conversation."
    elif category == "fulfillment":
        subject = f"Update on your request: {title}"[:150]
        heading, button = body.split(" — ")[0] or "Request update", "View your request"
        intro = f"{title}: {body}"
    else:
        subject, heading, button = f"FayFort update: {title}"[:150], title or "Account update", "Open FayFort"
        intro = body
    footer = "You're getting this because of activity on your FayFort member account."
    html_body = shell(heading=heading, intro_html="".join(_paragraph(part) for part in intro.split("\n\n")),
                      button_label=button, button_url=url, footer_note=footer, unsubscribe_url=unsubscribe_url)
    text = f"{heading}\n\n{intro}\n\n{button}: {url}\n\n{footer}"
    if unsubscribe_url:
        text += f"\nUnsubscribe: {unsubscribe_url}"
    return RenderedEmail(subject=subject, html=html_body, text=text)


def newsletter_email(*, subject: str, body_text: str, unsubscribe_url: str | None,
                     footer: str = "You're getting this because you have a FayFort member account.") -> RenderedEmail:
    html_body = shell(heading=subject, intro_html=text_to_html_paragraphs(body_text), button_label=None,
                      button_url=None, footer_note=footer, unsubscribe_url=unsubscribe_url)
    text = f"{subject}\n\n{body_text.strip()}\n\n{footer}"
    if unsubscribe_url:
        text += f"\nUnsubscribe: {unsubscribe_url}"
    return RenderedEmail(subject=subject, html=html_body, text=text)


def staff_password_reset_email(*, action_link: str) -> RenderedEmail:
    footer = "If you didn't expect this, ignore it; your password stays the same."
    intro = _paragraph("A FayFort administrator sent you a link to choose a new password for your team account. "
                       "The link works once and expires in 24 hours.")
    html_body = shell(heading="Reset your FayFort password", intro_html=intro, button_label="Choose a new password",
                      button_url=action_link, footer_note=footer, unsubscribe_url=None)
    text = ("Reset your FayFort password\n\nA FayFort administrator sent you a link to choose a new password. "
            f"It works once and expires in 24 hours.\n\n{action_link}\n\n{footer}")
    return RenderedEmail(subject="Reset your FayFort password", html=html_body, text=text)
