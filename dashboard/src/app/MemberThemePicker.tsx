import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { exitMemberThemePreview, previewMemberTheme } from "./MemberThemeRuntime";
import { FayfortLoader } from "./brand/FayfortLogo";
import { ThemeMiniPreview, ThemeSwatches, type MiniThemeDesign } from "./ThemeMiniPreview";
import { themeFont } from "./themeFonts";
import { themeTone } from "./themeTone";

type ThemeChoice = {
  theme_id: string;
  display_name: string;
  description: string;
  requires_paid: boolean;
  can_apply: boolean;
  is_current: boolean;
  /** Published design, so every theme can be drawn before it's picked. Older APIs leave it out. */
  design?: MiniThemeDesign | null;
};
type ThemeCatalog = { member_tier: string; selected_theme: string; themes: ThemeChoice[] };

const BASE_DESIGN: MiniThemeDesign = {
  wrapper_style: "soft",
  font_family: "system",
  colors: { page_background: "#FFFFFF", surface: "#F7F9FA", text: "#17212B", muted_text: "#526170", accent: "#005A9C", accent_foreground: "#FFFFFF", border: "#637180", focus: "#005A9C" },
};

/** Member Settings → Choose a theme: every theme drawn as a small picture of the app, a big preview of the one
 * you're looking at, then Use this theme (or try it on the whole app first). */
export function MemberThemePicker({ accessToken, onApplied }: { accessToken: string; onApplied: (themeId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<ThemeCatalog | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!open || catalog) return;
    let active = true;
    setLoading(true);
    setError("");
    apiRequest<ThemeCatalog>("/members/themes", accessToken)
      .then((result) => {
        if (!active) return;
        setCatalog(result);
        setFocus((current) => current || result.themes.find((theme) => theme.is_current)?.theme_id || result.themes[0]?.theme_id || null);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Themes could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, catalog, accessToken]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  async function tryOn(theme: ThemeChoice) {
    setError("");
    setNotice("");
    try {
      if (theme.theme_id !== "base") await apiRequest(`/members/themes/${encodeURIComponent(theme.theme_id)}/preview`, accessToken);
      previewMemberTheme(theme.theme_id);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Theme preview could not be loaded.");
    }
  }
  async function apply(theme: ThemeChoice) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ selected_theme: string }>("/members/me/theme", accessToken, {
        method: "PUT",
        body: JSON.stringify({ theme_id: theme.theme_id }),
      });
      exitMemberThemePreview();
      onApplied(result.selected_theme);
      setCatalog((current) =>
        current
          ? { ...current, selected_theme: result.selected_theme, themes: current.themes.map((item) => ({ ...item, is_current: item.theme_id === result.selected_theme })) }
          : current,
      );
      setNotice(`${theme.display_name} is now your theme.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Theme preference could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  const designOf = (theme: ThemeChoice) => theme.design || (theme.theme_id === "base" ? BASE_DESIGN : null);
  const shown = catalog?.themes.find((theme) => theme.theme_id === focus) || null;
  const shownDesign = shown ? designOf(shown) : null;
  return (
    <>
      <button className="secondary-button" type="button" onClick={() => setOpen(true)}>
        Browse themes
      </button>
      {open && (
        <div
          className="member-theme-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="member-theme-dialog mtp" role="dialog" aria-modal="true" aria-labelledby="member-theme-dialog-title">
            <header>
              <div>
                <h2 id="member-theme-dialog-title">Choose a theme</h2>
                <p>See how FayFort looks in each theme before you use it. Only you see your theme.</p>
              </div>
              <button type="button" aria-label="Close themes" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            {loading && <FayfortLoader label="Loading themes…" />}
            {catalog && shown && (
              <div className="mtp-body">
                <div className="mtp-stage">
                  {shownDesign ? (
                    <ThemeMiniPreview design={shownDesign} name={shown.display_name} />
                  ) : (
                    <div className="mtp-stage-missing">Preview this theme on the whole app to see it.</div>
                  )}
                  <div className="mtp-stage-copy">
                    <h3>{shown.display_name}</h3>
                    {shown.description && <p>{shown.description}</p>}
                    {shownDesign && (
                      <p className="mtp-meta">
                        <ThemeSwatches colors={shownDesign.colors} />
                        <span>{themeFont(shownDesign.font_family).label}</span>
                        {themeTone(shownDesign.colors.page_background) === "dark" && <span>Dark</span>}
                      </p>
                    )}
                  </div>
                  <div className="mtp-actions">
                    {shown.is_current ? (
                      <button className="primary-button" type="button" disabled>
                        Your theme
                      </button>
                    ) : (
                      <button className="primary-button" type="button" disabled={busy || !shown.can_apply} onClick={() => void apply(shown)}>
                        {busy ? "Saving…" : "Use this theme"}
                      </button>
                    )}
                    <button className="secondary-button" type="button" onClick={() => void tryOn(shown)}>
                      Try on the whole app
                    </button>
                  </div>
                  {shown.requires_paid && !shown.can_apply && (
                    <p className="mtp-locked">Standard or Pro required to use this theme. You can still try it on.</p>
                  )}
                </div>
                <div className="mtp-list" role="radiogroup" aria-label="Themes">
                  {catalog.themes.map((theme) => {
                    const design = designOf(theme);
                    return (
                      <button
                        key={theme.theme_id}
                        type="button"
                        role="radio"
                        aria-checked={theme.theme_id === focus}
                        className={theme.theme_id === focus ? "mtp-card is-on" : "mtp-card"}
                        onClick={() => setFocus(theme.theme_id)}
                      >
                        {design ? <ThemeMiniPreview design={design} name={theme.display_name} size="thumb" /> : <span className="mtp-thumb-missing" />}
                        <span className="mtp-card-name">{theme.display_name}</span>
                        <span className="mtp-card-tags">
                          {theme.is_current && <small className="is-current">Your theme</small>}
                          {theme.requires_paid && (
                            <small className={theme.can_apply ? undefined : "is-locked"}>
                              {!theme.can_apply && (
                                <svg aria-hidden="true" viewBox="0 0 16 16">
                                  <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z" />
                                </svg>
                              )}
                              Standard or Pro
                            </small>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {catalog?.themes.length === 1 && <p className="quiet-note">No other themes are published yet.</p>}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {notice && <p role="status" className="mtp-notice">{notice}</p>}
            <footer>
              <span>Your plan: {catalog?.member_tier ? catalog.member_tier[0].toUpperCase() + catalog.member_tier.slice(1) : "—"}</span>
              <button className="secondary-button" type="button" onClick={() => setOpen(false)}>
                Done
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
