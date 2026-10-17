import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { exitMemberThemePreview, previewMemberTheme } from "./MemberThemeRuntime";
import { FayfortLoader } from "./brand/FayfortLogo";

type ThemeChoice = { theme_id: string; display_name: string; description: string; requires_paid: boolean; can_apply: boolean; is_current: boolean };
type ThemeCatalog = { member_tier: string; selected_theme: string; themes: ThemeChoice[] };

export function MemberThemePicker({ accessToken, onApplied }: { accessToken: string; onApplied: (themeId: string) => void }) {
 const [open, setOpen] = useState(false);
 const [catalog, setCatalog] = useState<ThemeCatalog | null>(null);
 const [loading, setLoading] = useState(false);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState("");
 const [notice, setNotice] = useState("");
 useEffect(() => {
  if (!open || catalog) return;
  let active = true;
  setLoading(true); setError("");
  apiRequest<ThemeCatalog>("/members/themes", accessToken).then(result => { if (active) setCatalog(result); })
   .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Themes could not be loaded."); })
   .finally(() => { if (active) setLoading(false); });
  return () => { active = false; };
 }, [open, catalog, accessToken]);
 async function preview(theme: ThemeChoice) {
  setError(""); setNotice("");
  try {
   if (theme.theme_id !== "base") await apiRequest(`/members/themes/${encodeURIComponent(theme.theme_id)}/preview`, accessToken);
   previewMemberTheme(theme.theme_id);
   setNotice(`Previewing ${theme.display_name}. It is temporary and has not changed your saved theme.`);
  } catch (reason) { setError(reason instanceof Error ? reason.message : "Theme preview could not be loaded."); }
 }
 async function apply(theme: ThemeChoice) {
  setBusy(true); setError(""); setNotice("");
  try {
   const result = await apiRequest<{ selected_theme: string }>("/members/me/theme", accessToken, { method: "PUT", body: JSON.stringify({ theme_id: theme.theme_id }) });
   exitMemberThemePreview(); onApplied(result.selected_theme); setCatalog(current => current ? { ...current, selected_theme: result.selected_theme, themes: current.themes.map(item => ({ ...item, is_current: item.theme_id === result.selected_theme })) } : current);
   setNotice(`${theme.display_name} is now your saved theme.`);
  } catch (reason) { setError(reason instanceof Error ? reason.message : "Theme preference could not be saved."); }
  finally { setBusy(false); }
 }
 return <>
  <button className="secondary-button" type="button" onClick={() => setOpen(true)}>Browse themes</button>
  {open && <div className="member-theme-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
   <section className="member-theme-dialog" role="dialog" aria-modal="true" aria-labelledby="member-theme-dialog-title">
    <header><div><p className="eyebrow">MEMBER APPEARANCE</p><h2 id="member-theme-dialog-title">Choose a theme</h2></div><button type="button" aria-label="Close themes" onClick={() => setOpen(false)}>×</button></header>
    <p>Preview any published theme. FayFort base is available to everyone; applying premium themes requires Standard or Pro.</p>
    {loading && <FayfortLoader label="Loading published themes…" />}
    {catalog && <div className="member-theme-choice-list">{catalog.themes.map(theme => <article key={theme.theme_id} className="member-theme-choice">
     <div><h3>{theme.display_name} {theme.is_current && <small>Saved</small>}</h3><p>{theme.description || "A FayFort member theme."}</p>{theme.requires_paid && !theme.can_apply && <span className="quiet-note">Standard or Pro required to apply</span>}</div>
     <div className="member-theme-choice-actions"><button className="secondary-button" type="button" onClick={() => void preview(theme)}>Preview</button><button className="primary-button" type="button" disabled={busy || !theme.can_apply || theme.is_current} onClick={() => void apply(theme)}>{theme.is_current ? "Current theme" : busy ? "Saving…" : "Apply"}</button></div>
    </article>)}</div>}
    {catalog?.themes.length === 1 && <p className="quiet-note">No premium themes are published yet.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <footer><span>Your plan: {catalog?.member_tier ? catalog.member_tier[0].toUpperCase() + catalog.member_tier.slice(1) : "—"}</span><button className="secondary-button" type="button" onClick={() => setOpen(false)}>Done</button></footer>
   </section>
  </div>}
 </>;
}
