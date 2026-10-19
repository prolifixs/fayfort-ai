import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { supabaseClient } from "../lib/supabase";
import { loadThemeFont, themeFont } from "./themeFonts";
import { themeTone } from "./themeTone";

export const MEMBER_THEME_PREVIEW_SESSION_KEY="fayfort.member-theme-preview";
const MEMBER_THEME_PREVIEW_EVENT="fayfort-member-theme-preview-change";
type ThemeColors={page_background:string;surface:string;text:string;muted_text:string;accent:string;accent_foreground:string;border:string;focus:string};
type ThemeDesign={palette_preset:string;wrapper_style:"clean"|"soft"|"framed";colors:ThemeColors;font_family?:string};
type ResolvedTheme={theme_id:string;display_name:string;revision?:number|null;design:ThemeDesign};
type MemberThemeResponse={selected_theme:string;active_theme:ResolvedTheme;fallback_reason:string|null};
type PreviewThemeResponse=ResolvedTheme;

const baseDesign:ThemeDesign={palette_preset:"ocean-blue",wrapper_style:"soft",colors:{page_background:"#FFFFFF",surface:"#F7F9FA",text:"#17212B",muted_text:"#526170",accent:"#005A9C",accent_foreground:"#FFFFFF",border:"#637180",focus:"#005A9C"}};

/** Trying a theme on the whole app lasts 15 seconds for every member, then the saved theme comes back (owner
 * decision, 2026-10-19, to stop free members using paid themes through the preview). The end time is stored, so
 * reloading the page doesn't restart the clock. */
export const MEMBER_THEME_PREVIEW_SECONDS=15;
type StoredPreview={theme_id:string;until:number};
export function readMemberThemePreview():StoredPreview|null{
 let raw:string|null=null;try{raw=sessionStorage.getItem(MEMBER_THEME_PREVIEW_SESSION_KEY);}catch{return null;}
 if(!raw)return null;
 try{const value=JSON.parse(raw) as StoredPreview;if(value&&typeof value.theme_id==="string"&&typeof value.until==="number"&&value.until>Date.now())return value;}catch{/* an older open-ended preview: end it */}
 try{sessionStorage.removeItem(MEMBER_THEME_PREVIEW_SESSION_KEY);}catch{/* ignore */}
 return null;
}
export function previewMemberTheme(themeId:string){try{sessionStorage.setItem(MEMBER_THEME_PREVIEW_SESSION_KEY,JSON.stringify({theme_id:themeId,until:Date.now()+MEMBER_THEME_PREVIEW_SECONDS*1000}));}catch{/* ignore */}window.dispatchEvent(new Event(MEMBER_THEME_PREVIEW_EVENT));}
export function exitMemberThemePreview(){try{sessionStorage.removeItem(MEMBER_THEME_PREVIEW_SESSION_KEY);}catch{/* ignore */}window.dispatchEvent(new Event(MEMBER_THEME_PREVIEW_EVENT));}

/** Themes only set the eight base colour tokens (src/styles/tokens.css); every other colour derives from them. */
export function MemberThemeRuntime({children}:{children:React.ReactNode}){
 const [theme,setTheme]=useState<ResolvedTheme>({theme_id:"base",display_name:"FayFort base",design:baseDesign});const [previewing,setPreviewing]=useState(false);const [until,setUntil]=useState(0);const [now,setNow]=useState(Date.now());const [ended,setEnded]=useState("");
 const refresh=useCallback(async(token:string)=>{try{const saved=await apiRequest<MemberThemeResponse>("/members/me/theme",token);let resolved=saved.active_theme;const stored=readMemberThemePreview();if(stored){try{resolved=await apiRequest<PreviewThemeResponse>(`/members/themes/${encodeURIComponent(stored.theme_id)}/preview`,token);setPreviewing(true);setUntil(stored.until);setNow(Date.now());setEnded("");}catch{setPreviewing(false);}}else setPreviewing(false);setTheme(resolved||{theme_id:"base",display_name:"FayFort base",design:baseDesign});}catch{setTheme({theme_id:"base",display_name:"FayFort base",design:baseDesign});setPreviewing(false);}},[]);
 useEffect(()=>{if(!supabaseClient)return;let active=true;let currentToken="";const load=(token:string|null)=>{currentToken=token||"";if(token)void refresh(token);else{setTheme({theme_id:"base",display_name:"FayFort base",design:baseDesign});setPreviewing(false);}};supabaseClient.auth.getSession().then(({data})=>{if(active)load(data.session?.access_token||null);});const {data:{subscription}}=supabaseClient.auth.onAuthStateChange((_event,session)=>load(session?.access_token||null));const onPreview=()=>{if(currentToken)void refresh(currentToken);};window.addEventListener(MEMBER_THEME_PREVIEW_EVENT,onPreview);return()=>{active=false;subscription.unsubscribe();window.removeEventListener(MEMBER_THEME_PREVIEW_EVENT,onPreview);};},[refresh]);
 useEffect(()=>{if(!previewing||!until)return;const name=theme.display_name;const tick=window.setInterval(()=>setNow(Date.now()),250);const stop=window.setTimeout(()=>{exitMemberThemePreview();setEnded(name);},Math.max(0,until-Date.now()));return()=>{window.clearInterval(tick);window.clearTimeout(stop);};},[previewing,until,theme.display_name]);
 useEffect(()=>{if(!ended)return;const hide=window.setTimeout(()=>setEnded(""),6000);return()=>window.clearTimeout(hide);},[ended]);
 const secondsLeft=Math.max(0,Math.ceil((until-now)/1000));
 const fontKey=theme.design?.font_family||"system";useEffect(()=>{loadThemeFont(fontKey);},[fontKey]);const font=themeFont(fontKey);
 const colors=theme.design?.colors||baseDesign.colors;const style={"--font-sans":font.family,fontFamily:font.family,"--color-bg":colors.page_background,"--color-surface":colors.surface,"--color-text":colors.text,"--color-muted":colors.muted_text,"--color-accent":colors.accent,"--color-accent-text":colors.accent_foreground,"--color-border-strong":colors.border,"--color-focus":colors.focus,"--member-page":colors.page_background,"--member-surface":colors.surface,"--member-text":colors.text,"--member-muted":colors.muted_text,"--member-accent":colors.accent,"--member-accent-text":colors.accent_foreground,"--member-border":colors.border,"--member-focus":colors.focus} as React.CSSProperties;
 return <div className={`member-theme-runtime member-theme-wrapper-${theme.design?.wrapper_style||"soft"}`} style={style} data-theme-id={theme.theme_id} data-theme-font={font.key} data-theme-tone={themeTone(colors.page_background)} data-theme-preview={previewing?"true":"false"} data-theme-label={theme.display_name}>{previewing&&<div className="member-theme-preview-banner" role="status"><span>Previewing {theme.display_name}</span><span className="member-theme-preview-time" aria-label={`${secondsLeft} seconds left`}><b className="member-theme-preview-track"><i style={{width:`${Math.min(100,Math.max(0,((until-now)/(MEMBER_THEME_PREVIEW_SECONDS*1000))*100))}%`}} /></b>{secondsLeft}s</span><button type="button" onClick={exitMemberThemePreview}>Exit preview</button></div>}{!previewing&&ended&&<div className="member-theme-preview-banner is-ended" role="status"><span>Preview of {ended} ended. Choose it in Settings → Themes to keep it.</span><button type="button" onClick={()=>setEnded("")}>OK</button></div>}{children}</div>;
}
