"""Theme patterns (Ankara, Ghana Must Go) in the theme contract."""
import unittest

from pydantic import ValidationError

from app.accounts.member_themes import ThemeDesign

COLORS = {"page_background": "#FFF8EE", "surface": "#FBEBD6", "text": "#2A1A12", "muted_text": "#6B4A33",
          "accent": "#C2410C", "accent_foreground": "#FFFFFF", "border": "#8A6A55", "focus": "#1E3FB8"}


class ThemePatternTests(unittest.TestCase):
    def test_pattern_defaults_to_none(self):
        design = ThemeDesign(palette_preset="ankara", wrapper_style="soft", colors=COLORS)
        self.assertEqual((design.pattern, design.pattern_strength), ("none", "subtle"))

    def test_known_patterns_are_accepted(self):
        for pattern in ("ankara", "ghana-must-go"):
            design = ThemeDesign(palette_preset="x", wrapper_style="soft", colors=COLORS, pattern=pattern, pattern_strength="bold")
            self.assertEqual(design.model_dump()["pattern"], pattern)

    def test_unknown_pattern_or_strength_is_refused(self):
        with self.assertRaises(ValidationError):
            ThemeDesign(palette_preset="x", wrapper_style="soft", colors=COLORS, pattern="url(evil)")
        with self.assertRaises(ValidationError):
            ThemeDesign(palette_preset="x", wrapper_style="soft", colors=COLORS, pattern="ankara", pattern_strength="loud")
