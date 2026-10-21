"""Validated contract for member theme catalog entries and revisions.

Theme values are design tokens rather than arbitrary CSS. Route handlers and
the admin editor are introduced in the next implementation step.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
_THEME_KEY = re.compile(r"^[a-z][a-z0-9-]{1,79}$")
_PALETTE_KEY = re.compile(r"^[a-z][a-z0-9-]{0,39}$")


def _linear_channel(value: int) -> float:
    channel = value / 255
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def _relative_luminance(color: str) -> float:
    red, green, blue = (int(color[index:index + 2], 16) for index in (1, 3, 5))
    return 0.2126 * _linear_channel(red) + 0.7152 * _linear_channel(green) + 0.0722 * _linear_channel(blue)


def contrast_ratio(first: str, second: str) -> float:
    """Return the WCAG contrast ratio for two validated six-digit hex colors."""
    high, low = sorted((_relative_luminance(first), _relative_luminance(second)), reverse=True)
    return (high + 0.05) / (low + 0.05)


class ThemeColors(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page_background: str
    surface: str
    text: str
    muted_text: str
    accent: str
    accent_foreground: str
    border: str
    focus: str

    @field_validator("page_background", "surface", "text", "muted_text", "accent", "accent_foreground", "border", "focus")
    @classmethod
    def valid_hex_color(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not _HEX_COLOR.fullmatch(normalized):
            raise ValueError("Theme colors must be six-digit hexadecimal values such as #147964.")
        return normalized


# Text fonts a theme may use. "system" is FayFort's standard stack; the others load from Google Fonts in the member
# app (dashboard/src/app/themeFonts.ts keeps the same list).
THEME_FONTS = ("system", "poppins", "quicksand", "nunito", "montserrat", "dm-sans", "playfair", "lora")
ThemeFont = Literal["system", "poppins", "quicksand", "nunito", "montserrat", "dm-sans", "playfair", "lora"]


THEME_PATTERNS = ("none", "ankara", "ghana-must-go")
ThemePattern = Literal["none", "ankara", "ghana-must-go"]


class ThemeDesign(BaseModel):
    """Persistable, versioned theme payload with accessible color pairings."""

    model_config = ConfigDict(extra="forbid")

    palette_preset: str = Field(min_length=1, max_length=40)
    wrapper_style: Literal["clean", "soft", "framed"]
    colors: ThemeColors
    font_family: ThemeFont = "system"
    # A cultural pattern placed in a few calm spots (top band, sidebar header, chat welcome, card edge), never behind
    # text-heavy content. Keep in step with dashboard/src/app/themePatterns.ts.
    pattern: ThemePattern = "none"
    pattern_strength: Literal["subtle", "bold"] = "subtle"

    @field_validator("palette_preset")
    @classmethod
    def valid_palette_key(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if not _PALETTE_KEY.fullmatch(normalized):
            raise ValueError("Palette preset must be a lowercase key using letters, numbers, or hyphens.")
        return normalized

    @model_validator(mode="after")
    def enforce_contrast(self) -> "ThemeDesign":
        c = self.colors
        text_pairs = (
            ("text on page background", c.text, c.page_background),
            ("text on surface", c.text, c.surface),
            ("muted text on page background", c.muted_text, c.page_background),
            ("muted text on surface", c.muted_text, c.surface),
            ("accent text on accent", c.accent_foreground, c.accent),
        )
        for label, foreground, background in text_pairs:
            if contrast_ratio(foreground, background) < 4.5:
                raise ValueError(f"Theme contrast for {label} must be at least 4.5:1.")
        for background in (c.page_background, c.surface):
            if contrast_ratio(c.focus, background) < 3:
                raise ValueError("Theme focus color must have at least 3:1 contrast on page and surface backgrounds.")
        return self


class ThemeDraftInput(BaseModel):
    """Metadata for a new catalog theme; the built-in base key is reserved."""

    model_config = ConfigDict(extra="forbid")

    theme_id: str = Field(min_length=2, max_length=80)
    display_name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=300)

    @field_validator("theme_id")
    @classmethod
    def valid_theme_key(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if normalized == "base" or not _THEME_KEY.fullmatch(normalized):
            raise ValueError("Theme ID must be a unique lowercase slug; 'base' is reserved for FayFort base.")
        return normalized

    @field_validator("display_name")
    @classmethod
    def nonblank_display_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Theme name cannot be blank.")
        if normalized.casefold() == "fayfort base":
            raise ValueError("FayFort base is a protected built-in theme name.")
        return normalized

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None
