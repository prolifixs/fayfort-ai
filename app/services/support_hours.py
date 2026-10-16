"""FayFort's working hours (docs/KNOWLEDGE_AND_AI_PLAN.md): Monday to Saturday, 9:30 to 18:30 China time.

Used to tell a customer when a person will reply (handoffs) and to give the AI the current time in China.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.config.settings import settings

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _clock(value: str, fallback: time) -> time:
    try:
        hours, minutes = value.split(":")
        return time(int(hours), int(minutes))
    except (ValueError, AttributeError):
        return fallback


def _days() -> set[int]:
    names = [part.strip().lower()[:3] for part in str(settings.SUPPORT_DAYS or "").split(",") if part.strip()]
    index = {name.lower()[:3]: number for number, name in enumerate(DAY_NAMES)}
    days = {index[name] for name in names if name in index}
    return days or {0, 1, 2, 3, 4, 5}


def _zone() -> ZoneInfo:
    try:
        return ZoneInfo(settings.SUPPORT_TIMEZONE)
    except Exception:
        return ZoneInfo("Asia/Shanghai")


def _time_label(value: time) -> str:
    return f"{value.hour}:{value.minute:02d}"


def hours_label() -> str:
    days = sorted(_days())
    open_at, close_at = _clock(settings.SUPPORT_OPEN, time(9, 30)), _clock(settings.SUPPORT_CLOSE, time(18, 30))
    if days == list(range(days[0], days[-1] + 1)) and len(days) > 1:
        span = f"{DAY_NAMES[days[0]]} to {DAY_NAMES[days[-1]]}"
    else:
        span = ", ".join(DAY_NAMES[day] for day in days)
    return f"{span}, {_time_label(open_at)} to {_time_label(close_at)} China time"


@dataclass(frozen=True)
class SupportStatus:
    open: bool
    local_now: datetime
    next_open: datetime | None
    label: str

    def next_open_label(self) -> str:
        if self.next_open is None:
            return ""
        today = self.local_now.date()
        day = self.next_open.date()
        when = "today" if day == today else "tomorrow" if day == today + timedelta(days=1) else DAY_NAMES[day.weekday()]
        return f"{when} at {_time_label(self.next_open.time())} China time"


def support_status(now: datetime | None = None) -> SupportStatus:
    zone = _zone()
    local = (now or datetime.now(timezone.utc)).astimezone(zone)
    open_at, close_at = _clock(settings.SUPPORT_OPEN, time(9, 30)), _clock(settings.SUPPORT_CLOSE, time(18, 30))
    days = _days()
    is_open = local.weekday() in days and open_at <= local.time() < close_at
    next_open = None
    if not is_open:
        for offset in range(0, 8):
            day = local.date() + timedelta(days=offset)
            if day.weekday() not in days:
                continue
            candidate = datetime.combine(day, open_at, tzinfo=zone)
            if candidate > local:
                next_open = candidate
                break
    return SupportStatus(open=is_open, local_now=local, next_open=next_open, label=hours_label())


def handoff_reply(now: datetime | None = None) -> str:
    """What the customer is told when they ask for a person."""
    status = support_status(now)
    if status.open:
        return (
            "Of course, dear. I've asked a member of the FayFort team to join this chat. "
            f"During working hours ({status.label}) a person usually replies within "
            f"{settings.SUPPORT_REPLY_MINUTES} minutes."
        )
    return (
        "Of course, dear. I've asked a member of the FayFort team to join this chat. "
        f"Our team works {status.label}, so a person will reply when they're back, {status.next_open_label()}. "
        "I'm still here if I can help in the meantime."
    )


def ai_time_context(now: datetime | None = None) -> str:
    """The current time in China and whether the team is working, for the AI's system prompt."""
    status = support_status(now)
    stamp = status.local_now.strftime("%A %H:%M")
    if status.open:
        return (f"Now in China: {stamp}. The FayFort team is working ({status.label}); a person usually replies "
                f"within {settings.SUPPORT_REPLY_MINUTES} minutes when asked.")
    return (f"Now in China: {stamp}. The FayFort team is offline; working hours are {status.label}. "
            f"A person will reply {status.next_open_label()}.")
