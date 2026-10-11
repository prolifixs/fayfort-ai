import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { dashboardAuthConfigured, supabaseClient } from "../lib/supabase";
import "./theme-preview.css";

type ThemeColors={page_background:string;surface:string;text:string;muted_text:string;accent:string;accent_foreground:string;border:string;focus:string};
type ThemeRevision={palette_preset:string;wrapper_style:"clean"|"soft"|"framed";colors:ThemeColors};
type Theme={theme_id:string;display_name:string;description:string|null;status:"draft"|"published"|"archived";draft_revision:number|null;published_revision:number|null;draft:ThemeRevision|null;published:ThemeRevision|null};
type PreviewPage="chat"|"catalog"|"saved"|"notifications"|"requests"|"settings";

const pages:PreviewPage[]=["chat","catalog","saved","notifications","requests","settings"];
const pageLabels:Record<PreviewPage,string>={chat:"Chat",catalog:"Catalog",saved:"Saved products",notifications:"Notifications",requests:"Request timeline",settings:"Settings"};
const baseColors:ThemeColors={page_background:"#FFFFFF",surface:"#F7F9FA",text:"#17212B",muted_text:"#526170",accent:"#005A9C",accent_foreground:"#FFFFFF",border:"#637180",focus:"#005A9C"};

export function ThemePreviewPage(){
 const themeId=new URLSearchParams(window.location.search).get("theme")||"";
 const [token,setToken]=useState<string|null>(null);const [loading,setLoading]=useState(true);const [theme,setTheme]=useState<Theme|null>(null);const [error,setError]=useState("");const [page,setPage]=useState<PreviewPage>("chat");
 useEffect(()=>{let active=true;if(!supabaseClient){setError("FayFort authentication is not configured.");setLoading(false);return;}supabaseClient.auth.getSession().then(async({data})=>{if(!active)return;const accessToken=data.session?.access_token;if(!accessToken){setError("Sign in with a platform-admin account to preview themes.");setLoading(false);return;}setToken(accessToken);try{const result=await apiRequest<{themes:Theme[]}>('/platform/themes',accessToken);if(!active)return;const found=result.themes.find(item=>item.theme_id===themeId);if(!found)throw new Error("Theme not found in the platform catalog.");if(found.status==="archived")throw new Error("Archived themes cannot be previewed.");setTheme(found);}catch(reason){if(active)setError(reason instanceof Error?reason.message:"Theme preview could not be loaded.");}finally{if(active)setLoading(false);}});return()=>{active=false;};},[themeId]);
 const revision=theme?.draft||theme?.published;const colors=revision?.colors||baseColors;const style={"--preview-page":colors.page_background,"--preview-surface":colors.surface,"--preview-text":colors.text,"--preview-muted":colors.muted_text,"--preview-accent":colors.accent,"--preview-accent-text":colors.accent_foreground,"--preview-border":colors.border,"--preview-focus":colors.focus} as React.CSSProperties;
 if(loading)return <main className="theme-preview-screen"><p role="status">Loading private theme preview…</p></main>;
 if(error||!theme||!token)return <main className="theme-preview-screen"><section className="theme-preview-error"><h1>Theme preview unavailable</h1><p role="alert">{error||"A platform-admin session is required."}</p><a href="/">Return to Control Center</a></section></main>;
 return <main className="theme-preview-screen" style={style}>
  <header className="theme-preview-toolbar"><div><small>PRIVATE PLATFORM-ADMIN PREVIEW</small><h1>{theme.display_name}</h1><p>{theme.status} · {theme.draft?`draft revision ${theme.draft_revision}`:`published revision ${theme.published_revision}`}</p></div><a href="/">Return to Theme Studio</a></header>
  <div className="theme-preview-notice" role="note"><strong>Synthetic demo member</strong><span>Sample content only. No member data is loaded or changed. Interactive member actions are disabled.</span></div>
  <div className="theme-preview-frame"><aside className="theme-preview-side"><div className="theme-preview-brand"><b>F</b><span>FayFort<small>MEMBER</small></span></div><nav aria-label="Preview member pages">{pages.map(item=><button type="button" key={item} className={page===item?"active":""} onClick={()=>setPage(item)}>{pageLabels[item]}</button>)}</nav><div className="theme-preview-side-profile"><b>AM</b><span>Alex Morgan<small>Standard member</small></span></div></aside>
   <section className={`theme-preview-content theme-wrapper-${revision?.wrapper_style||"soft"}`} aria-label={`${pageLabels[page]} preview`}>
    <header className="theme-preview-page-head"><div><small>WELCOME BACK, ALEX</small><h2>{pageLabels[page]}</h2></div><button type="button" disabled>Notifications · 2</button></header>
    {page==="chat"&&<div className="preview-chat"><div className="preview-message member"><small>You</small><p>I’m looking for a compact blue ceramic mug.</p></div><div className="preview-message assistant"><small>FayFort assistant</small><p>Here are a few active catalog listings that may fit.</p></div><article className="preview-product"><span>HOME · AVAILABLE</span><strong>Harbor Blue Stoneware Mug</strong><p>Hand-finished ceramic · 12 oz</p><button disabled>View product</button></article><div className="preview-disabled-composer">Describe what you are looking for… <button disabled>Send</button></div></div>}
    {page==="catalog"&&<div className="preview-grid">{["Harbor Blue Stoneware Mug","Coastal Linen Throw","Blue Glass Table Vase"].map((name,index)=><article className="preview-product" key={name}><div className="preview-product-art" aria-hidden="true">{["☕","▤","◉"][index]}</div><span>HOME · AVAILABLE</span><strong>{name}</strong><p>Curated FayFort catalog item</p><button disabled>Explore item</button></article>)}</div>}
    {page==="saved"&&<div className="preview-grid">{["Harbor Blue Stoneware Mug","Coastal Linen Throw"].map(name=><article className="preview-product" key={name}><span>SAVED PRODUCT</span><strong>{name}</strong><p>Saved for later · Available</p><button disabled>View details</button></article>)}</div>}
    {page==="notifications"&&<div className="preview-list">{[["Request update","Your item has arrived at the warehouse."],["FayFort replied","A team member shared an update on your request."],["Photo review","Your product photo has been reviewed."]].map(([title,body])=><article key={title}><b aria-hidden="true">●</b><div><strong>{title}</strong><p>{body}</p><small>Today · Sample notification</small></div></article>)}</div>}
    {page==="requests"&&<article className="preview-request"><small>REQUEST FF-2048 · IN TRANSIT</small><h3>Harbor Blue Stoneware Mug</h3><p>Your request is moving through FayFort fulfillment.</p><ol>{[["Request submitted","Oct 08"],["Item in warehouse","Oct 10"],["Shipped","Oct 11"],["In transit","Today"]].map(([label,date],index)=><li className={index===3?"current":"complete"} key={label}><span>{label}</span><small>{date}</small></li>)}</ol><button disabled>Open tracking</button></article>}
    {page==="settings"&&<div className="preview-settings"><article><small>MEMBER ACCOUNT</small><h3>Alex Morgan</h3><p>alex.morgan@example.test</p></article><article><small>MEMBERSHIP</small><h3>Standard</h3><p>Premium themes are available with your membership.</p></article><article><small>APPEARANCE</small><h3>{theme.display_name}</h3><p>This preview is private to FayFort staff.</p><button disabled>Theme options</button></article></div>}
    <footer className="theme-preview-footer">Previewing the {theme.display_name} {theme.draft?"draft":"published design"}. This view is isolated from member accounts and preferences.</footer>
   </section>
  </div>
 </main>;
}
