import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import "./operations-notifications.css";
import { useDismiss } from "./ui/useDismiss";

type Notice = {id:string;work_item_id:string|null;notification_type:string;title:string;body:string;href:string;read_at:string|null;created_at:string};
type Inbox = {notifications:Notice[];unread_count:number;sound_enabled:boolean};

function playWorkerSound(){
  try{
    const AudioContextType=window.AudioContext||(window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
    if(!AudioContextType)return;
    const context=new AudioContextType();const oscillator=context.createOscillator();const gain=context.createGain();
    oscillator.type="sine";oscillator.frequency.setValueAtTime(660,context.currentTime);oscillator.frequency.setValueAtTime(880,context.currentTime+0.1);
    gain.gain.setValueAtTime(0.0001,context.currentTime);gain.gain.exponentialRampToValueAtTime(0.08,context.currentTime+0.02);gain.gain.exponentialRampToValueAtTime(0.0001,context.currentTime+0.24);
    oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+0.25);oscillator.onended=()=>{void context.close();};
  }catch{/* Browser audio may be unavailable until user interaction. */}
}

export function OperationsNotifications({accessToken}:{accessToken:string}){
  const [inbox,setInbox]=useState<Inbox|null>(null);const [open,setOpen]=useState(false);const wrapRef=useRef<HTMLDivElement>(null);useDismiss(open,()=>setOpen(false),[wrapRef]);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const seenIds=useRef<Set<string>|null>(null);
  const load=useCallback(async(playForNew:boolean)=>{
    try{
      const next=await apiRequest<Inbox>("/operations/me/notifications",accessToken);
      const prior=seenIds.current;const incoming=prior?next.notifications.some(item=>!prior.has(item.id)):false;
      seenIds.current=new Set(next.notifications.map(item=>item.id));setInbox(next);setError("");
      if(playForNew&&incoming&&next.sound_enabled)playWorkerSound();
    }catch(reason){setError(reason instanceof Error?reason.message:"Notifications unavailable.");}
  },[accessToken]);
  useEffect(()=>{void load(false);const timer=window.setInterval(()=>void load(true),30000);return()=>window.clearInterval(timer);},[load]);
  async function setSound(enabled:boolean){setBusy(true);setError("");try{await apiRequest("/operations/me/notification-preferences",accessToken,{method:"PUT",body:JSON.stringify({sound_enabled:enabled})});await load(false);if(enabled)playWorkerSound();}catch(reason){setError(reason instanceof Error?reason.message:"Sound preference could not be saved.");}finally{setBusy(false);}}
  async function updateNotice(item:Notice,action:"read"|"dismiss"){try{await apiRequest(`/operations/me/notifications/${item.id}`,accessToken,{method:"PATCH",body:JSON.stringify({action})});await load(false);if(action==="read")window.location.assign(item.href);}catch(reason){setError(reason instanceof Error?reason.message:"Notification could not be updated.");}}
  return <div className="operations-notifications" ref={wrapRef}><button className="ops-head-button operations-notifications-toggle" type="button" aria-expanded={open} aria-label={`Notifications${inbox?.unread_count?`, ${inbox.unread_count} unread`:""}`} onClick={()=>{setOpen(value=>!value);void load(false);}}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg><span>Notifications</span>{inbox?.unread_count?<b className="ops-badge">{inbox.unread_count>99?"99+":inbox.unread_count}</b>:null}</button>{open&&<section className="operations-notifications-popover" aria-label="Worker notifications"><header><strong>Staff notifications</strong><button type="button" className="secondary-button" onClick={()=>void load(false)}>Refresh</button></header><label className="operations-sound-setting"><input type="checkbox" checked={inbox?.sound_enabled??false} disabled={busy} onChange={event=>void setSound(event.target.checked)}/> Sound for new notifications</label><button className="operations-notifications-test" type="button" onClick={playWorkerSound}>Test sound</button>{error&&<p role="alert">{error}</p>}{inbox&&!inbox.notifications.length?<p className="operations-muted">No staff notifications yet. Assignments, member replies, mentions, due work, and automation alerts appear here.</p>:inbox?.notifications.length?<ul>{inbox.notifications.map(item=><li key={item.id} className={item.read_at?"":"is-unread"}><button type="button" className="operations-notification-open" onClick={()=>void updateNotice(item,"read")}><strong>{item.title}</strong><span>{item.body}</span><small>{new Date(item.created_at).toLocaleString()}</small></button><button type="button" aria-label="Dismiss notification" onClick={()=>void updateNotice(item,"dismiss")}>×</button></li>)}</ul>:null}</section>}</div>;
}
