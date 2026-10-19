import pytest
from pydantic import ValidationError

from app.accounts.member_themes import ThemeDesign, ThemeDraftInput, contrast_ratio


def valid_theme_design(**updates):
    values = {
        "palette_preset": "ocean-blue",
        "wrapper_style": "soft",
        "colors": {
            "page_background": "#FFFFFF",
            "surface": "#F7F9FA",
            "text": "#17212B",
            "muted_text": "#526170",
            "accent": "#005A9C",
            "accent_foreground": "#FFFFFF",
            "border": "#637180",
            "focus": "#005A9C",
        },
    }
    values.update(updates)
    return values


def test_theme_design_accepts_supported_tokens_and_wrapper():
    design = ThemeDesign.model_validate(valid_theme_design())

    assert design.palette_preset == "ocean-blue"
    assert design.wrapper_style == "soft"
    assert design.colors.accent == "#005A9C"


def test_theme_design_rejects_text_color_below_aa_contrast():
    values = valid_theme_design(colors={
        "page_background": "#FFFFFF",
        "surface": "#FFFFFF",
        "text": "#999999",
        "muted_text": "#526170",
        "accent": "#005A9C",
        "accent_foreground": "#FFFFFF",
        "border": "#637180",
        "focus": "#005A9C",
    })

    with pytest.raises(ValidationError, match="at least 4.5:1"):
        ThemeDesign.model_validate(values)


def test_theme_design_rejects_low_focus_contrast():
    values = valid_theme_design(colors={
        "page_background": "#FFFFFF",
        "surface": "#FFFFFF",
        "text": "#17212B",
        "muted_text": "#526170",
        "accent": "#005A9C",
        "accent_foreground": "#FFFFFF",
        "border": "#637180",
        "focus": "#EEEEEE",
    })

    with pytest.raises(ValidationError, match="focus color must have at least 3:1"):
        ThemeDesign.model_validate(values)


def test_theme_design_rejects_unsupported_wrapper_and_extra_css():
    with pytest.raises(ValidationError):
        ThemeDesign.model_validate(valid_theme_design(wrapper_style="custom-css"))
    with pytest.raises(ValidationError):
        ThemeDesign.model_validate(valid_theme_design(css="body { display: none }"))


def test_theme_draft_reserves_base_and_normalizes_slug_and_name():
    theme = ThemeDraftInput.model_validate({
        "theme_id": "Spring-Dawn",
        "display_name": "  Spring Dawn  ",
        "description": "  A warm theme.  ",
    })

    assert theme.theme_id == "spring-dawn"
    assert theme.display_name == "Spring Dawn"
    assert theme.description == "A warm theme."
    with pytest.raises(ValidationError, match="'base' is reserved"):
        ThemeDraftInput.model_validate({"theme_id": "base", "display_name": "Override"})
    with pytest.raises(ValidationError, match="protected built-in theme name"):
        ThemeDraftInput.model_validate({"theme_id": "another-base", "display_name": "FayFort base"})


def test_contrast_ratio_calculation():
    assert contrast_ratio("#000000", "#FFFFFF") == pytest.approx(21)


def test_font_defaults_to_system_and_rejects_unknown_fonts():
    from app.accounts.member_themes import THEME_FONTS
    colors = {"page_background": "#FFFFFF", "surface": "#F7F9FA", "text": "#17212B", "muted_text": "#526170",
              "accent": "#005A9C", "accent_foreground": "#FFFFFF", "border": "#637180", "focus": "#005A9C"}
    assert ThemeDesign(palette_preset="ocean-blue", wrapper_style="soft", colors=colors).font_family == "system"
    assert ThemeDesign(palette_preset="x", wrapper_style="soft", colors=colors, font_family="poppins").font_family == "poppins"
    with pytest.raises(ValidationError):
        ThemeDesign(palette_preset="x", wrapper_style="soft", colors=colors, font_family="comic-sans")
    migration = open("supabase/migrations/20261019150000_theme_fonts.sql").read()
    for font in THEME_FONTS:
        assert f"'{font}'" in migration
