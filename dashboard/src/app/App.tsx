import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ApiRequestError, apiRequest, websocketUrl } from "../lib/api";
import { dashboardAuthConfigured, supabaseClient } from "../lib/supabase";
import { KnowledgePage } from "./KnowledgePage";

type Business = { business_id: string; name: string; role: string };
type Connection = { id: string; provider: string; display_name: string; status: string; credential_status: string; provider_account_id?: string | null; provider_username?: string | null; health_checked_at?: string | null; health_error_code?: string | null; safe_settings: Record<string, unknown> };
type Automation = { id: string; name: string; trigger_type: string; action_type: string; action_config?: { response_text?: string }; enabled: boolean; schedule_interval_seconds?: number | null; schedule_next_run_at?: string | null; schedule_attempts?: number; schedule_last_error_code?: string | null };
type AutomationRun = { id: string; status: string; error_code?: string | null; created_at: string; result?: Record<string, unknown> };
type WaitEstimate = {status:"estimated"|"unavailable";lower_minutes?:number;upper_minutes?:number;sample_size?:number;reason?:string};
type Handoff = { id: string; conversation_id: string; requested_by: string; assigned_to?: string | null; status: string; reason: string; requested_at: string; updated_at?: string; queue_position?:number; wait_estimate?:WaitEstimate };
type HandoffAgent = {user_id:string;role:string;handoff_availability?:"available"|"away"|"offline";handoff_available_until?:string|null;handoff_max_active?:number};
type EventRecord = { id: number; event_type: string; entity_type: string; entity_id: string; payload: Record<string, unknown>; created_at: string };

const modules = [
  ["Overview", "Workspace"], ["Conversations", "Workspace"], ["Customers", "Workspace"], ["Requests", "Workspace"],
  ["Directory & Tools", "Operations"], ["Channels", "Operations"], ["Connections", "Operations"], ["Automations", "Operations"],
  ["Entitlements", "Operations"], ["Verification", "Operations"], ["Human Agents", "Operations"], ["Knowledge", "Manage"], ["Analytics", "Manage"], ["Settings", "Manage"],
] as const;
const descriptions: Record<string,string> = {
  Overview:"A clear view of conversations, requests, channels, handoffs, and automation health.",
  Conversations:"Review customer conversations with operational context alongside the chat.", Customers:"Customer profiles and history from Layer 5.",
  Requests:"Structured requests, missing information, and lifecycle status.", "Directory & Tools":"Curated directory data and Layer 6 access controls.",
  Channels:"Channel behavior and receiving, auto-reply, and handoff controls.", Connections:"External accounts, connection health, and provider lifecycle.",
  Automations:"Rules, schedules, execution history, retries, and failures.", Entitlements:"Business access grants consumed by Layer 6.",
  Verification:"Review unverified directory fields and record approval history.", "Human Agents":"Human availability, assignment, takeover, and return to automation.",
  Knowledge:"Business-approved FAQ answers with exact question matching and version history.", Analytics:"Saved business-event history with bounded counts and time-window filters.", Settings:"Safe business configuration managed through the FayFort control plane.",
};
const groups = ["Workspace","Operations","Manage"];

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!supabaseClient) { setAuthLoading(false); return; }
    let mounted = true;
    supabaseClient.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthError("");
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!supabaseClient) return;
    setSigningIn(true); setAuthError("");
    const { error } = await supabaseClient.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setAuthError(error.message);
    setSigningIn(false);
  }
  async function signOut() { await supabaseClient?.auth.signOut(); }

  if (!dashboardAuthConfigured) return <SetupScreen />;
  if (authLoading) return <div className="auth-page"><section className="auth-card"><b className="brand-mark">F</b><h1>Loading your workspace</h1><p>Checking your FayFort sign-in session.</p></section></div>;
  if (!session) return <div className="auth-page"><section className="auth-card"><b className="brand-mark">F</b><label>FAYFORT CONTROL CENTER</label><h1>Sign in</h1><p>Use your FayFort account to open your business workspace.</p><form onSubmit={signIn}><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/>{authError&&<p className="form-error" role="alert">{authError}</p>}<button className="primary-button" disabled={signingIn}>{signingIn?"Signing in…":"Sign in"}</button></form></section></div>;
  return <DashboardWorkspace accessToken={session.access_token} signedInEmail={session.user.email||""} onSignOut={signOut} eventStreaming={import.meta.env.VITE_DASHBOARD_EVENTS_ENABLED !== "false"}/>;
}

function SetupScreen() {
  return <div className="auth-page"><section className="auth-card"><b className="brand-mark">F</b><label>FAYFORT CONTROL CENTER</label><h1>Dashboard setup needed</h1><p>Add the public Supabase project URL and anon key, plus the FayFort API address, to <code>dashboard/.env.local</code>, then restart the dashboard.</p><p className="quiet-note">The service-role key does not belong in the dashboard.</p></section></div>;
}

type WorkspaceProps = { accessToken: string; signedInEmail?: string; onSignOut?: () => void | Promise<void>; eventStreaming?: boolean };
export function DashboardWorkspace({ accessToken, signedInEmail, onSignOut, eventStreaming = true }: WorkspaceProps) {
  const [active, setActive] = useState("Overview");
  const [conversationTarget, setConversationTarget] = useState<ConversationRow | null>(null);
  const [requestTargetId, setRequestTargetId] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [businessError, setBusinessError] = useState("");
  const [invalidSession, setInvalidSession] = useState(false);
  const [businessLoading, setBusinessLoading] = useState(true);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventStatus, setEventStatus] = useState("Connecting");
  const [waitingHandoffs, setWaitingHandoffs] = useState<number | null>(null);
  const [acknowledgedWaiting, setAcknowledgedWaiting] = useState<Record<string,number>>({});
  const eventCursors = useRef<Record<string,number>>({});
  const currentBusiness = businesses.find(item=>item.business_id===businessId);

  const loadBusinesses = useCallback(async () => {
    setBusinessLoading(true);
    try {
      const data = await apiRequest<{businesses:Business[] }>("/dashboard/businesses", accessToken);
      setBusinesses(data.businesses);
      setBusinessError("");
      setInvalidSession(false);
      setBusinessId(previous => data.businesses.some(item=>item.business_id===previous) ? previous : data.businesses[0]?.business_id || "");
    } catch (error) {
      const unauthorized = error instanceof ApiRequestError && error.status === 401;
      setInvalidSession(unauthorized);
      setBusinessError(unauthorized
        ? "Your sign-in session could not be verified. Sign out, then sign in again to reconnect this workspace."
        : error instanceof Error ? error.message : "Could not load business workspaces.");
    } finally {
      setBusinessLoading(false);
    }
  }, [accessToken]);
  useEffect(()=>{ void loadBusinesses(); },[loadBusinesses]);

  useEffect(()=>{
    if (!businessId) { setWaitingHandoffs(null); return; }
    let alive = true;
    const refreshWaitingHandoffs = async () => {
      try {
        const data = await apiRequest<{total:number}>(`/businesses/${businessId}/handoffs?status=waiting&limit=1`,accessToken);
        if (alive) setWaitingHandoffs(data.total);
      } catch { if (alive) setWaitingHandoffs(null); }
    };
    void refreshWaitingHandoffs();
    const timer = window.setInterval(()=>void refreshWaitingHandoffs(),15000);
    return ()=>{alive=false;window.clearInterval(timer);};
  },[accessToken,businessId]);

  useEffect(()=>{
    if(!businessId)return;
    try { const stored=Number(window.sessionStorage.getItem(`fayfort.handoffAck.${businessId}`)||0); setAcknowledgedWaiting(previous=>({...previous,[businessId]:Number.isSafeInteger(stored)&&stored>=0?stored:0})); }
    catch { setAcknowledgedWaiting(previous=>({...previous,[businessId]:0})); }
  },[businessId]);
  useEffect(()=>{
    if(!businessId||waitingHandoffs===null)return;
    const acknowledged=acknowledgedWaiting[businessId]||0;
    if(waitingHandoffs<acknowledged){setAcknowledgedWaiting(previous=>({...previous,[businessId]:0}));try{window.sessionStorage.setItem(`fayfort.handoffAck.${businessId}`,"0");}catch{/* Acknowledgement remains in memory for this view. */}}
  },[businessId,waitingHandoffs,acknowledgedWaiting]);
  const acknowledgeWaiting=()=>{
    if(!businessId||waitingHandoffs===null)return;
    setAcknowledgedWaiting(previous=>({...previous,[businessId]:waitingHandoffs}));
    try { window.sessionStorage.setItem(`fayfort.handoffAck.${businessId}`,String(waitingHandoffs)); } catch { /* Acknowledgement remains in memory for this view. */ }
  };

  useEffect(()=>{
    setEvents([]);
    if (!businessId) { setEventStatus("Offline"); return; }
    const cursorStorageKey=`fayfort.eventCursor.${businessId}`;
    let storedCursor=0;
    try { storedCursor=Number(window.sessionStorage.getItem(cursorStorageKey)||0); } catch { /* Cursor persistence is best-effort when browser storage is blocked. */ }
    if(Number.isSafeInteger(storedCursor)&&storedCursor>=0)eventCursors.current[businessId]=Math.max(eventCursors.current[businessId]||0,storedCursor);
    if (!eventStreaming) { setEventStatus("Disabled"); return; }
    setEventStatus("Connecting");
    let alive = true;
    let socket: WebSocket | undefined;
    let retryTimer: number | undefined;
    const connect = async () => {
      try {
        const {ticket} = await apiRequest<{ticket:string}>(`/businesses/${businessId}/events/ticket`,accessToken,{method:"POST"});
        if (!alive) return;
        socket = new WebSocket(websocketUrl(`/businesses/${businessId}/events/ws`));
        socket.onopen = () => {if(alive)socket?.send(JSON.stringify({ticket,after_id:eventCursors.current[businessId]||0}));};
        socket.onmessage = message => {
          if(!alive)return;
          const packet = JSON.parse(message.data) as {type:string;event?:EventRecord};
          if (packet.type === "ready") setEventStatus("Live");
          if (packet.type === "event" && packet.event) {
            const eventId=Number(packet.event.id);
            const currentCursor=eventCursors.current[businessId]||0;
            if(!Number.isSafeInteger(eventId)||eventId<=currentCursor)return;
            eventCursors.current[businessId]=eventId;
            try { window.sessionStorage.setItem(cursorStorageKey,String(eventId)); } catch { /* The in-memory cursor still protects this connection. */ }
            setEvents(previous=>previous.some(item=>item.id===eventId)?previous:[packet.event!,...previous].slice(0,30));
          }
        };
        socket.onerror = () => {if(alive)setEventStatus("Reconnecting");};
        socket.onclose = () => { if (alive) { setEventStatus("Reconnecting"); retryTimer=window.setTimeout(()=>void connect(),2000); } };
      } catch { if (alive) { setEventStatus("Offline"); retryTimer=window.setTimeout(()=>void connect(),5000); } }
    };
    void connect();
    return ()=>{ alive=false; if(retryTimer) window.clearTimeout(retryTimer); socket?.close(); };
  },[accessToken,businessId,eventStreaming]);

  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={() => setActive("Overview")}><b className="brand-mark">F</b><span><strong>FayFort</strong><small>CONTROL CENTER</small></span></a>
      {businessLoading?<div className="business-placeholder">Checking your business workspaces�</div>:businesses.length>0?<label className="business-picker"><span>BUSINESS WORKSPACE</span><select aria-label="Business workspace" value={businessId} onChange={e=>setBusinessId(e.target.value)}>{businesses.map(item=><option key={item.business_id} value={item.business_id}>{item.name} · {item.role}</option>)}</select></label>:<div className="business-placeholder">{businessError||"Loading business workspaces…"}</div>}
      <nav aria-label="Main navigation">{groups.map(group=><section key={group} aria-label={group}><h2>{group}</h2>{modules.filter(([,g])=>g===group).map(([label])=><button key={label} className={active===label?"nav-item active":"nav-item"} aria-current={active===label?"page":undefined} onClick={()=>setActive(label)}><span>{label.slice(0,1)}</span>{label}{label==="Human Agents"&&waitingHandoffs!==null&&waitingHandoffs>0&&<b className="queue-badge" aria-label={`${waitingHandoffs} waiting`}>{waitingHandoffs>99?"99+":waitingHandoffs}</b>}</button>)}</section>)}</nav>
      <footer><i className={eventStatus==="Live"?"event-dot live":"event-dot"}/> Events {eventStatus}<button className="signout-button" onClick={()=>void onSignOut?.()}>Sign out</button></footer>
    </aside>
    <main><header><span>{currentBusiness?.name||"FayFort workspace"} <em>/</em> {active}</span><div className="header-status">{waitingHandoffs!==null&&waitingHandoffs>(acknowledgedWaiting[businessId]||0)&&<><button className="queue-alert" onClick={()=>setActive("Human Agents")} aria-label={`${waitingHandoffs} handoffs waiting; open Human Agents queue`}>{waitingHandoffs} {waitingHandoffs===1?"handoff":"handoffs"} waiting · Open queue</button><button type="button" onClick={acknowledgeWaiting} aria-label="Mark waiting handoffs as seen">Mark as seen</button></>}<small>DEVELOPMENT</small></div></header><article aria-live="polite">
      <div className="heading"><div><label>FAYFORT WORKSPACE</label><h1>{active}</h1><p>{descriptions[active]}</p></div><mark>Layer 7 build</mark></div>
      {businessLoading?<div className="empty" role="status"><b>�</b><h2>Loading your workspace</h2><p>Checking the signed-in account�s active business membership.</p></div>:businessError?<div className="notice error" role="alert">{businessError}<div className="record-actions"><button onClick={()=>void loadBusinesses()}>Retry</button>{invalidSession&&<button onClick={()=>void onSignOut?.()}>Sign out and sign in again</button>}</div></div>:businesses.length===0?<div className="empty"><b>!</b><h2>No workspace is linked to this sign-in</h2><p>Your saved business data hasn�t been removed. Signed in as {signedInEmail||"an account without an active workspace"}. Check that this is the account linked to the business membership; otherwise sign in with the correct account or ask the owner to add this one.</p><div className="record-actions"><button onClick={()=>void loadBusinesses()}>Check again</button><button onClick={()=>void onSignOut?.()}>Sign out</button></div></div>:active==="Overview"?<Overview events={events} setActive={setActive}/>:active==="Connections"?<ConnectionsPage accessToken={accessToken} businessId={businessId} canManage={["owner","admin"].includes(currentBusiness?.role||"")}/>:active==="Automations"?<AutomationsPage accessToken={accessToken} businessId={businessId}/>:active==="Human Agents"?<><AgentAvailabilityPanel accessToken={accessToken} businessId={businessId}/><HandoffsPage accessToken={accessToken} businessId={businessId}/></>:(["Conversations","Customers","Requests"].includes(active)?<WorkspaceDataPage module={active} accessToken={accessToken} businessId={businessId} canManage={["owner","admin"].includes(currentBusiness?.role||"")} setActive={setActive} conversationTarget={conversationTarget} clearConversationTarget={()=>setConversationTarget(null)} requestTargetId={requestTargetId} clearRequestTarget={()=>setRequestTargetId(null)} openConversationFromCustomer={conversation=>{setConversationTarget(conversation);setActive("Conversations");}} openRequestFromCustomer={requestId=>{setRequestTargetId(requestId);setActive("Requests");}}/>:active==="Directory & Tools"?<DirectoryToolsPage accessToken={accessToken} businessId={businessId}/>:active==="Entitlements"?<EntitlementsPage accessToken={accessToken} businessId={businessId}/>:active==="Verification"?<VerificationPage accessToken={accessToken} businessId={businessId}/>:active==="Knowledge"?<KnowledgePage accessToken={accessToken} businessId={businessId} canManage={["owner","admin"].includes(currentBusiness?.role||"")}/>:active==="Settings"?<SettingsPage accessToken={accessToken} businessId={businessId} canManage={["owner","admin"].includes(currentBusiness?.role||"")}/>:active==="Channels"?<><ConnectionsPage accessToken={accessToken} businessId={businessId} canManage={["owner","admin"].includes(currentBusiness?.role||"")}/><OperationalModulePage module="Channels" accessToken={accessToken} businessId={businessId}/></>:active==="Analytics"?<AnalyticsPage accessToken={accessToken} businessId={businessId}/>:<div className="empty"><b>{active.slice(0,1)}</b><h2>{active} is being connected</h2><p>This module will become active when its FastAPI workflow and data access are ready.</p><button onClick={()=>setActive("Overview")}>Back to overview</button></div>)}
    </article></main>
  </div>;
}

function Overview({events,setActive}:{events:EventRecord[];setActive:(page:string)=>void}) {
  return <><div className="welcome"><label>CONTROL PLANE</label><h2>Your operations, in one place</h2><p>The dashboard is signing requests with your user session. FastAPI checks your active business membership before accessing business data.</p></div><h2 className="section-title">Workspace modules <small>Connected as they are built</small></h2><div className="cards">{modules.slice(1).map(([label])=><button key={label} onClick={()=>setActive(label)}><b>{label.slice(0,1)}</b><span><strong>{label}</strong><small>{descriptions[label]}</small></span><i>↗</i></button>)}</div><h2 className="section-title">Recent activity <small>Live event stream</small></h2><div className="event-list" aria-label="Recent business activity">{events.length?events.slice(0,8).map(item=><div key={item.id}><strong>{item.event_type}</strong><small>{new Date(item.created_at).toLocaleString()}</small></div>):<p>Waiting for business events.</p>}</div></>;
}

function ConnectionsPage({accessToken,businessId,canManage=true}:{accessToken:string;businessId:string;canManage?:boolean}) {
  const [items,setItems]=useState<Connection[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [provider,setProvider]=useState("instagram");
  const [name,setName]=useState("");
  const [busy,setBusy]=useState(false);
  const [editingCredentials,setEditingCredentials]=useState("");
  const [appId,setAppId]=useState("");
  const [appSecret,setAppSecret]=useState("");
  const [accessTokenValue,setAccessTokenValue]=useState("");
  const [messengerPageId,setMessengerPageId]=useState("");
  const refresh=useCallback(async()=>{setLoading(true);try{const data=await apiRequest<{connections:Connection[]}>(`/businesses/${businessId}/connections`,accessToken);setItems(data.connections);setError("");}catch(e){setError(e instanceof Error?e.message:"Connections could not be loaded.");}finally{setLoading(false);}},[accessToken,businessId]);
  useEffect(()=>{void refresh();},[refresh]);
  async function create(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{await apiRequest(`/businesses/${businessId}/connections`,accessToken,{method:"POST",body:JSON.stringify({provider,display_name:name,safe_settings:{inbound_enabled:true,outbound_enabled:false}})});setName("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Connection could not be created.");}finally{setBusy(false);}}
  async function saveInstagramCredentials(event:FormEvent,item:Connection){event.preventDefault();setBusy(true);setError("");try{await apiRequest(`/businesses/${businessId}/connections/${item.id}/credentials/instagram`,accessToken,{method:"PUT",body:JSON.stringify({app_id:appId,app_secret:appSecret,access_token:accessTokenValue})});setAppId("");setAppSecret("");setAccessTokenValue("");setEditingCredentials("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Instagram credentials could not be saved.");}finally{setBusy(false);}}
  async function verifyInstagram(item:Connection){setBusy(true);setError("");try{await apiRequest(`/businesses/${businessId}/connections/${item.id}/verify-instagram`,accessToken,{method:"POST"});await refresh();}catch(e){setError(e instanceof Error?e.message:"Instagram account could not be verified.");}finally{setBusy(false);}}
  async function saveMessengerCredentials(event:FormEvent,item:Connection){event.preventDefault();setBusy(true);setError("");try{await apiRequest(`/businesses/${businessId}/connections/${item.id}/credentials/messenger`,accessToken,{method:"PUT",body:JSON.stringify({app_id:appId,app_secret:appSecret,page_id:messengerPageId,page_access_token:accessTokenValue})});setAppId("");setAppSecret("");setAccessTokenValue("");setMessengerPageId("");setEditingCredentials("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Messenger credentials could not be saved.");}finally{setBusy(false);}}
  async function verifyMessenger(item:Connection){setBusy(true);setError("");try{await apiRequest(`/businesses/${businessId}/connections/${item.id}/verify-messenger`,accessToken,{method:"POST"});await refresh();}catch(e){setError(e instanceof Error?e.message:"Messenger Page could not be verified.");}finally{setBusy(false);}}
  function openCredentialEditor(item:Connection){setAppId("");setAppSecret("");setAccessTokenValue("");setMessengerPageId("");setEditingCredentials(editingCredentials===item.id?"":item.id);}
  async function transition(item:Connection,action:string){setBusy(true);setError("");try{await apiRequest(`/businesses/${businessId}/connections/${item.id}/${action}`,accessToken,{method:"POST"});await refresh();}catch(e){setError(e instanceof Error?e.message:"Connection status could not be updated.");}finally{setBusy(false);}}
  async function toggleInbound(item:Connection){setBusy(true);setError("");try{const enabled=item.safe_settings?.inbound_enabled!==true;await apiRequest(`/businesses/${businessId}/connections/${item.id}/settings`,accessToken,{method:"PATCH",body:JSON.stringify({safe_settings:{inbound_enabled:enabled}})});await refresh();}catch(e){setError(e instanceof Error?e.message:"Inbound setting could not be changed.");}finally{setBusy(false);}}
  async function toggleOutboundSetting(item:Connection,key:"outbound_enabled"|"auto_reply_enabled"){setBusy(true);setError("");try{const enabled=item.safe_settings?.[key]!==true;await apiRequest(`/businesses/${businessId}/connections/${item.id}/settings`,accessToken,{method:"PATCH",body:JSON.stringify({safe_settings:{[key]:enabled}})});await refresh();}catch(e){setError(e instanceof Error?e.message:"Outbound setting could not be changed.");}finally{setBusy(false);}}
  return <section className="control-panel" aria-label="Connection lifecycle"><div className="panel-heading"><div><h2>Channel connections</h2><p>Connect and verify provider accounts, then enable outbound delivery and automatic replies explicitly when ready. Both remain off by default.</p></div></div>{error&&<p className="form-error" role="alert">{error}</p>}<form className="inline-form" onSubmit={create}><label>Provider<select value={provider} onChange={e=>setProvider(e.target.value)}><option value="instagram">Instagram</option><option value="messenger">Facebook Messenger</option></select></label><label>Display name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Instagram support"/></label><button className="primary-button" disabled={busy||!canManage}>Add connection</button></form>{!canManage&&<p className="quiet-note">Only a business owner or admin can change channel setup or credentials.</p>}{loading?<p>Loading connections...</p>:items.length===0?<p className="empty-copy">No saved channel connections yet.</p>:<div className="record-list">{items.map(item=><div className="record" key={item.id}><div><strong>{item.display_name}</strong><small>{item.provider} - {item.status} - credentials {item.credential_status}</small>{item.health_checked_at&&<small>Last provider check: {new Date(item.health_checked_at).toLocaleString()}</small>}{item.health_error_code&&<small>Health issue: {item.health_error_code.replaceAll("_"," ")}</small>}{item.provider_username&&<small>{item.provider==="messenger"?"Verified Messenger Page: ":"Verified Instagram account: @"}{item.provider_username}</small>}</div><div className="record-actions"><button disabled={busy||!canManage} onClick={()=>void toggleInbound(item)}>{item.safe_settings?.inbound_enabled===true?"Disable inbound":"Enable inbound"}</button><button type="button" disabled={busy||!canManage||!["instagram","messenger"].includes(item.provider)||item.status!=="connected"||item.credential_status!=="configured"} onClick={()=>void toggleOutboundSetting(item,"outbound_enabled")}>{item.safe_settings?.outbound_enabled===true?"Disable outbound":"Enable outbound"}</button>{item.safe_settings?.outbound_enabled===true&&<button type="button" disabled={busy||!canManage||item.status!=="connected"} onClick={()=>void toggleOutboundSetting(item,"auto_reply_enabled")}>{item.safe_settings?.auto_reply_enabled===true?"Disable auto-replies":"Enable auto-replies"}</button>}<small>Automatic replies send only when enabled and accepted by the provider within its response window.</small>{item.provider==="instagram"&&<>{item.credential_status==="configured"&&<button type="button" disabled={busy||!canManage||["paused","disconnected"].includes(item.status)} onClick={()=>void verifyInstagram(item)}>Verify account</button>}<button type="button" disabled={busy||!canManage} onClick={()=>openCredentialEditor(item)}>{item.credential_status==="configured"?"Replace credentials":"Add credentials"}</button></>}{item.provider==="messenger"&&<>{item.credential_status==="configured"&&<button type="button" disabled={busy||!canManage||["paused","disconnected"].includes(item.status)} onClick={()=>void verifyMessenger(item)}>Verify Page</button>}<button type="button" disabled={busy||!canManage} onClick={()=>openCredentialEditor(item)}>{item.credential_status==="configured"?"Replace credentials":"Add credentials"}</button></>}{item.status!=="paused"&&item.status!=="disconnected"&&<button onClick={()=>void transition(item,"pause")}>Pause</button>}{["paused","disconnected","error"].includes(item.status)&&<button onClick={()=>void transition(item,"resume")}>Resume setup</button>}{item.status!=="disconnected"&&<button onClick={()=>void transition(item,"disconnect")}>Disconnect</button>}</div>{editingCredentials===item.id&&item.provider==="messenger"&&<form className="inline-form" onSubmit={event=>void saveMessengerCredentials(event,item)}><label>Meta App ID<input required autoComplete="off" value={appId} onChange={e=>setAppId(e.target.value)}/></label><label>Meta App Secret<input required type="password" autoComplete="new-password" value={appSecret} onChange={e=>setAppSecret(e.target.value)}/></label><label>Facebook Page ID<input required autoComplete="off" value={messengerPageId} onChange={e=>setMessengerPageId(e.target.value)}/></label><label>Page Access Token<input required type="password" autoComplete="new-password" value={accessTokenValue} onChange={e=>setAccessTokenValue(e.target.value)}/></label><button className="primary-button" disabled={busy||!canManage}>{busy?"Saving...":"Save credentials"}</button><button type="button" disabled={busy} onClick={()=>openCredentialEditor(item)}>Cancel</button><small>Uses the Page access token and pages_messaging permission. Values are stored in the credential vault and never displayed again.</small></form>}{editingCredentials===item.id&&item.provider==="instagram"&&<form className="inline-form" onSubmit={event=>void saveInstagramCredentials(event,item)}><label>Instagram App ID<input required autoComplete="off" value={appId} onChange={e=>setAppId(e.target.value)}/></label><label>Instagram App Secret<input required type="password" autoComplete="new-password" value={appSecret} onChange={e=>setAppSecret(e.target.value)}/></label><label>Access Token<input required type="password" autoComplete="new-password" value={accessTokenValue} onChange={e=>setAccessTokenValue(e.target.value)}/></label><button className="primary-button" disabled={busy||!canManage}>{busy?"Saving...":"Save credentials"}</button><button type="button" disabled={busy} onClick={()=>openCredentialEditor(item)}>Cancel</button><small>Saving replaces the current token for this connection. Values are never displayed again.</small></form>}</div>)}</div>}</section>;
}

function AutomationsPage({accessToken,businessId}:{accessToken:string;businessId:string}) {
  const [items,setItems]=useState<Automation[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [name,setName]=useState("");
  const [trigger,setTrigger]=useState("manual_test");
  const [actionType,setActionType]=useState("record_test_run");
  const [responseText,setResponseText]=useState("");
  const [intervalHours,setIntervalHours]=useState(1);
  const [intentCondition,setIntentCondition]=useState("");
  const [languageCondition,setLanguageCondition]=useState("");
  const [busy,setBusy]=useState(false);
  const [runs,setRuns]=useState<Record<string,AutomationRun[]>>({});
  const [runsFor,setRunsFor]=useState("");
  const refresh=useCallback(async()=>{setLoading(true);try{const data=await apiRequest<{automations:Automation[]}>("/businesses/"+businessId+"/automations",accessToken);setItems(data.automations);setError("");}catch(e){setError(e instanceof Error?e.message:"Automations could not be loaded.");}finally{setLoading(false);}},[accessToken,businessId]);
  useEffect(()=>{void refresh();},[refresh]);
  async function create(event:FormEvent){
    event.preventDefault();setBusy(true);
    try{
      const conditions=trigger==="conversation_inbound"?{...(intentCondition?{intent:intentCondition}:{}),...(languageCondition?{language:languageCondition}:{})}:{};
      const body={name,trigger_type:trigger,action_type:actionType,conditions,...(actionType==="send_approved_reply"?{response_text:responseText}:{}),schedule_interval_seconds:trigger==="scheduled_interval"?intervalHours*3600:null};
      await apiRequest("/businesses/"+businessId+"/automations",accessToken,{method:"POST",body:JSON.stringify(body)});
      setName("");setIntentCondition("");setLanguageCondition("");setResponseText("");setActionType("record_test_run");await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Automation could not be created.");}finally{setBusy(false);}
  }
  async function action(item:Automation,actionName:string){setBusy(true);try{if(actionName==="enable"||actionName==="disable")await apiRequest("/businesses/"+businessId+"/automations/"+item.id,accessToken,{method:"PATCH",body:JSON.stringify({enabled:actionName==="enable"})});else await apiRequest("/businesses/"+businessId+"/automations/"+item.id+"/"+actionName,accessToken,{method:"POST",body:JSON.stringify({idempotency_key:crypto.randomUUID()})});await refresh();}catch(e){setError(e instanceof Error?e.message:"Automation action failed.");}finally{setBusy(false);}}
  async function showRuns(item:Automation){setRunsFor(item.id);setError("");try{const data=await apiRequest<{executions:AutomationRun[]}>("/businesses/"+businessId+"/automations/"+item.id+"/executions",accessToken);setRuns(current=>({...current,[item.id]:data.executions}));}catch(e){setError(e instanceof Error?e.message:"Automation history could not be loaded.");}}
  return <section className="control-panel" aria-label="Automation management">
    <div className="panel-heading"><div><h2>Automation rules</h2><p>Rules start disabled. Test rules only record runs. Approved replies are sent only for inbound Instagram messages when both the rule and the connection’s auto-reply setting are enabled.</p></div></div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <form className="inline-form" onSubmit={create}>
      <label>Automation name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Inbound smoke check"/></label>
      <label>Trigger<select aria-label="Automation trigger" value={trigger} onChange={e=>{setTrigger(e.target.value);setActionType("record_test_run");}}><option value="manual_test">Manual test</option><option value="conversation_inbound">New inbound conversation message</option><option value="scheduled_interval">Scheduled interval</option></select></label>
      {trigger==="conversation_inbound"&&<>
        <label>Action<select aria-label="Automation action" value={actionType} onChange={e=>setActionType(e.target.value)}><option value="record_test_run">Record test run only</option><option value="send_approved_reply">Send approved static reply</option></select></label>
        {actionType==="send_approved_reply"&&<label>Approved reply text<textarea required maxLength={1000} value={responseText} onChange={e=>setResponseText(e.target.value)} placeholder="Write the exact reply to send for matching inbound messages."/></label>}
        <label>Intent filter<select aria-label="Automation intent filter" value={intentCondition} onChange={e=>setIntentCondition(e.target.value)}><option value="">Any intent</option>{["product_sourcing","product_pricing","supplier_search","shipping","shipping_quote","order_status","quotation","payment","invoice","business_consultation","canton_fair","general_information","greeting","complaint","follow_up","human_handoff","unknown"].map(intent=><option key={intent} value={intent}>{intent.replaceAll("_"," ")}</option>)}</select></label>
        <label>Language filter<input aria-label="Automation language filter" maxLength={35} value={languageCondition} onChange={e=>setLanguageCondition(e.target.value)} placeholder="Any language (e.g. en or zh-Hant)"/></label>
      </>}
      {trigger==="scheduled_interval"&&<label>Repeat every (hours)<input aria-label="Schedule interval in hours" type="number" min={1} max={168} step={1} value={intervalHours} onChange={e=>setIntervalHours(Number(e.target.value))}/></label>}
      <button className="primary-button" disabled={busy}>{actionType==="send_approved_reply"?"Create disabled reply rule":"Create disabled test rule"}</button>
    </form>
    {loading?<p>Loading automations…</p>:items.length===0?<p className="empty-copy">No automations yet. New rules start disabled.</p>:<div className="record-list">{items.map(item=><div className="record" key={item.id}><div><strong>{item.name}</strong><small>{item.trigger_type} · {item.action_type} · {item.enabled?"enabled":"disabled"}</small>{item.action_type==="send_approved_reply"&&<small>Approved text: {item.action_config?.response_text||"Not available"}</small>}{item.trigger_type==="scheduled_interval"&&item.enabled&&item.schedule_next_run_at&&<small>Next run: {new Date(item.schedule_next_run_at).toLocaleString()}</small>}{item.schedule_last_error_code&&<small>Retrying after a scheduler error (attempt {item.schedule_attempts||1}).</small>}</div><div className="record-actions">{item.enabled?<button disabled={busy} onClick={()=>void action(item,"disable")}>Disable</button>:<button disabled={busy} onClick={()=>void action(item,"enable")}>Enable</button>}<button disabled={busy} onClick={()=>void action(item,"dry-run")}>Dry run</button>{item.enabled&&item.trigger_type==="manual_test"&&<button disabled={busy} onClick={()=>void action(item,"execute")}>Execute test</button>}<button disabled={busy} onClick={()=>void showRuns(item)}>View runs</button></div>{runsFor===item.id&&<div className="record-list">{(runs[item.id]||[]).length===0?<small>No executions recorded yet.</small>:(runs[item.id]||[]).map(run=><small key={run.id}>{run.status}{run.error_code?" - "+String(run.error_code).replaceAll("_"," "):""} - {new Date(run.created_at).toLocaleString()}</small>)}</div>}</div>)}</div>}
    <p className="quiet-note">A reply rule cannot run from the manual test or schedule controls. Instagram must also have auto-replies explicitly enabled. Keep both off until the rule is reviewed.</p>
  </section>;
}
type HandoffEvent={id:string;handoff_id:string;actor_id:string;event_type:string;details:Record<string,unknown>;created_at:string};
function AgentAvailabilityPanel({accessToken,businessId}:{accessToken:string;businessId:string}) {
 const [availability,setAvailability]=useState<"available"|"away"|"offline">("offline");const [until,setUntil]=useState("");const [capacity,setCapacity]=useState(3);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [saved,setSaved]=useState(false);
 useEffect(()=>{let alive=true;void apiRequest<{availability:"available"|"away"|"offline";available_until:string|null;max_active_handoffs:number}>(`/businesses/${businessId}/handoffs/availability`,accessToken).then(data=>{if(!alive)return;setAvailability(data.availability);setCapacity(data.max_active_handoffs);if(data.available_until){const date=new Date(data.available_until);setUntil(new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16));}else setUntil("");}).catch(e=>{if(alive)setError(e instanceof Error?e.message:"Availability could not be loaded.");}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[accessToken,businessId]);
 async function save(event:FormEvent){event.preventDefault();setBusy(true);setError("");setSaved(false);try{await apiRequest(`/businesses/${businessId}/handoffs/availability`,accessToken,{method:"PATCH",body:JSON.stringify({availability,available_until:availability==="available"&&until?new Date(until).toISOString():null,max_active_handoffs:capacity})});setSaved(true);}catch(e){setError(e instanceof Error?e.message:"Availability could not be saved.");}finally{setBusy(false);}}
 return <section className="control-panel availability-panel" aria-label="Your human-agent availability"><div className="panel-heading"><div><h2>Your availability</h2><p>Set your on-duty window and maximum concurrent handoffs. Availability expires automatically; wait estimates stay unavailable until enough recent human first-response timings exist.</p></div></div>{error&&<p className="form-error" role="alert">{error}</p>}<form className="inline-form" onSubmit={save}><label>Availability<select aria-label="Your agent availability" value={availability} disabled={loading} onChange={e=>setAvailability(e.target.value as "available"|"away"|"offline")}><option value="available">Available</option><option value="away">Away</option><option value="offline">Offline</option></select></label>{availability==="available"&&<label>On duty until<input aria-label="Available until" type="datetime-local" required value={until} onChange={e=>setUntil(e.target.value)}/></label>}<label>Maximum active handoffs<input aria-label="Maximum active handoffs" type="number" min={1} max={20} step={1} value={capacity} onChange={e=>setCapacity(Number(e.target.value))}/></label><button className="primary-button" disabled={busy||loading}>{busy?"Saving…":"Save availability"}</button>{saved&&<small role="status">Availability saved.</small>}</form></section>;
}

function HandoffsPage({accessToken,businessId}:{accessToken:string;businessId:string}) {
 const [items,setItems]=useState<Handoff[]>([]);const [conversations,setConversations]=useState<ConversationRow[]>([]);const [agents,setAgents]=useState<HandoffAgent[]>([]);const [assignTo,setAssignTo]=useState<Record<string,string>>({});const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [conversationId,setConversationId]=useState("");const [reason,setReason]=useState("customer_requested");const [busy,setBusy]=useState(false);const [reply,setReply]=useState<Record<string,string>>({});const [sourceFilter,setSourceFilter]=useState("all");const [history,setHistory]=useState<Record<string,HandoffEvent[]>>({});const [historyOpen,setHistoryOpen]=useState<Record<string,boolean>>({});const [historyBusy,setHistoryBusy]=useState<Record<string,boolean>>({});const [offset,setOffset]=useState(0);const [total,setTotal]=useState(0);const [hasMore,setHasMore]=useState(false);const [statusFilter,setStatusFilter]=useState("waiting");
 const refresh=useCallback(async()=>{setLoading(true);try{const status=statusFilter==="all"?"":`&status=${statusFilter}`;const estimates=statusFilter==="waiting"?"&with_estimates=true":"";const [d,c,a]=await Promise.all([apiRequest<{handoffs:Handoff[];total:number;has_more:boolean}>(`/businesses/${businessId}/handoffs?limit=50&offset=${offset}${status}${estimates}`,accessToken),apiRequest<{conversations:ConversationRow[]}>(`/businesses/${businessId}/conversations`,accessToken),apiRequest<{agents:HandoffAgent[]}>(`/businesses/${businessId}/handoffs/agents`,accessToken)]);setItems(d.handoffs);setTotal(d.total);setHasMore(d.has_more);setConversations(c.conversations);setAgents(a.agents);setError("");}catch(e){setError(e instanceof Error?e.message:"Handoffs could not be loaded.");}finally{setLoading(false);}},[accessToken,businessId,offset,statusFilter]);
 useEffect(()=>{void refresh();},[refresh]);
 async function request(event:FormEvent){event.preventDefault();setBusy(true);try{await apiRequest(`/businesses/${businessId}/handoffs?conversation_id=${encodeURIComponent(conversationId)}`,accessToken,{method:"POST",body:JSON.stringify({reason})});setConversationId("");if(offset!==0)setOffset(0);else await refresh();}catch(e){setError(e instanceof Error?e.message:"Handoff could not be requested.");}finally{setBusy(false);}}
 async function action(item:Handoff,path:string,body?:unknown){setBusy(true);try{await apiRequest(`/businesses/${businessId}/handoffs/${item.id}/${path}`,accessToken,{method:"POST",...(body?{body:JSON.stringify(body)}:{})});await refresh();}catch(e){setError(e instanceof Error?e.message:"Handoff action failed.");}finally{setBusy(false);}}
 async function assign(item:Handoff){const agentId=assignTo[item.id]||item.assigned_to;if(!agentId)return;await action(item,"assign",{agent_id:agentId});}
 async function toggleHistory(item:Handoff){const open=!historyOpen[item.id];setHistoryOpen(previous=>({...previous,[item.id]:open}));if(!open||history[item.id])return;setHistoryBusy(previous=>({...previous,[item.id]:true}));try{const data=await apiRequest<{events:HandoffEvent[]}>(`/businesses/${businessId}/handoffs/${item.id}/events`,accessToken);setHistory(previous=>({...previous,[item.id]:data.events}));}catch(e){setError(e instanceof Error?e.message:"Handoff history could not be loaded.");setHistoryOpen(previous=>({...previous,[item.id]:false}));}finally{setHistoryBusy(previous=>({...previous,[item.id]:false}));}}
 const byId=new Map(conversations.map(c=>[c.id,c]));const source=(h:Handoff)=>byId.get(h.conversation_id)?.channel||byId.get(h.conversation_id)?.platform||"unknown";const sources=Array.from(new Set(items.map(source))).sort();const visible=items.filter(h=>sourceFilter==="all"||source(h)===sourceFilter);
 return <section className="control-panel" aria-label="Human handoff management"><div className="panel-heading"><div><h2>Human agent queue</h2><p>FIFO queue · {total} handoff{total===1?"":"s"} in this business. Assigned human replies use the connected provider when outbound delivery is enabled; delivery status appears in the conversation.</p></div></div>{error&&<p className="form-error" role="alert">{error}</p>}<form className="inline-form" onSubmit={request}><label>Conversation<select required value={conversationId} onChange={e=>setConversationId(e.target.value)}><option value="">Choose a conversation</option>{conversations.map(c=><option key={c.id} value={c.id}>{c.customer_name||c.customer_external_id||"Customer"} � {c.channel||c.platform||"Unknown source"} � {new Date(c.last_message_at||c.created_at).toLocaleString()}</option>)}</select></label><label>Reason<input maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="primary-button" disabled={busy||!conversationId}>Request human handoff</button></form><label className="queue-filter">Queue status<select aria-label="Queue status" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setOffset(0);}}><option value="waiting">Waiting</option><option value="active">Active</option><option value="returned">Returned</option><option value="all">All handoffs</option></select></label><label className="queue-filter">Filter queue by source<select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)}><option value="all">All sources</option>{sources.map(x=><option key={x} value={x}>{x}</option>)}</select></label>{loading?<p>Loading handoffs�</p>:visible.length===0?<p className="empty-copy">{items.length?"No handoffs match this source filter.":"No handoffs recorded."}</p>:<div className="record-list">{visible.map(item=><div className="record handoff-record" key={item.id}><div><strong>{item.status} � {item.reason}</strong><small>{byId.get(item.conversation_id)?.customer_name||byId.get(item.conversation_id)?.customer_external_id||"Customer"} � {source(item)} � Requested {new Date(item.requested_at).toLocaleString()}</small>{item.queue_position&&<small>FIFO position {item.queue_position} · {item.wait_estimate?.status==="estimated"?`Estimated first response: ${item.wait_estimate.lower_minutes}–${item.wait_estimate.upper_minutes} min (${item.wait_estimate.sample_size} samples)`:item.wait_estimate?.reason||"Wait estimate unavailable."}</small>}<div className="record-actions">{["requested","assigned"].includes(item.status)&&<><label>Assign to<select aria-label={`Assign handoff ${item.id} to agent`} value={assignTo[item.id]||item.assigned_to||""} onChange={e=>setAssignTo(previous=>({...previous,[item.id]:e.target.value}))}><option value="">Choose an active agent</option>{agents.map(agent=><option key={agent.user_id} value={agent.user_id}>{agent.user_id} · {agent.role}</option>)}</select></label><button disabled={busy||!(assignTo[item.id]||item.assigned_to)} onClick={()=>void assign(item)}>Assign</button><button disabled={busy} onClick={()=>void action(item,"take-over")}>Take over</button></>}{item.status==="active"&&<><button disabled={busy} onClick={()=>void action(item,"return-to-automation")}>Return to automation</button><input aria-label={`Reply for ${item.id}`} value={reply[item.id]||""} onChange={e=>setReply(p=>({...p,[item.id]:e.target.value}))} placeholder="Human reply"/><button disabled={busy||!reply[item.id]?.trim()} onClick={()=>void action(item,"messages",{content:reply[item.id]})}>Send reply</button></>}</div><button type="button" className="handoff-history-toggle" onClick={()=>void toggleHistory(item)}>{historyOpen[item.id]?"Hide history":"View history"}</button>{historyOpen[item.id]&&<div className="handoff-history" aria-label="Handoff history">{historyBusy[item.id]?<p role="status">Loading handoff history…</p>:(history[item.id]||[]).length===0?<p className="quiet-note">No state changes recorded for this handoff.</p>:<ul>{history[item.id].map(event=><li key={event.id}><strong>{event.event_type.replaceAll("_"," ")}</strong><small>{event.actor_id||"Actor not recorded"} · {new Date(event.created_at).toLocaleString()}</small></li>)}</ul>}</div>}</div></div>)}</div>}{!loading&&<div className="record-actions queue-pagination"><button disabled={offset===0||loading} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous queue page</button><small>{total===0?"No handoffs":`Showing ${offset+1}–${Math.min(offset+items.length,total)} of ${total}`}</small><button disabled={!hasMore||loading} onClick={()=>setOffset(offset+50)}>Next queue page</button></div>}</section>;
}
type ConversationRow = { id: string; customer_external_id?: string | null; customer_name?: string | null; customer_username?: string | null; channel?: string | null; platform?: string | null; status: string; summary?: string | null; last_message_at?: string | null; created_at: string };
type CustomerRow = { id: string; channel: string; external_customer_id: string; profile: Record<string, unknown>; created_at: string; updated_at: string };
type CustomerConversationRow = Pick<ConversationRow,"id"|"customer_external_id"|"channel"|"platform"|"status"|"summary"|"last_message_at"|"created_at">;
type RequestRow = { id: string; customer_id: string; conversation_id: string; related_request_id?: string|null; request_type: string; status: string; details: Record<string, unknown>; required_information: string[]; missing_information: string[]; created_at: string; updated_at: string };
type CustomerRequestRow = Pick<RequestRow,"id"|"conversation_id"|"request_type"|"status"|"details"|"required_information"|"missing_information"|"created_at"|"updated_at">;
type CustomerDetail = { customer: CustomerRow; conversations: CustomerConversationRow[]; requests: CustomerRequestRow[] };
type MessageRow = { id: string; sender_type: string; content: string; created_at: string; delivery?: { id:string; status:string; attempt_count:number; safe_error_code?:string|null } | null };
type ConversationDetail = { customer: CustomerRow | null; requests: Array<Pick<RequestRow,"id"|"request_type"|"status"|"details"|"required_information"|"missing_information"|"created_at"|"updated_at">> };

function WorkspaceDataPage({module,accessToken,businessId,canManage=false,setActive,conversationTarget,clearConversationTarget,requestTargetId,clearRequestTarget,openConversationFromCustomer,openRequestFromCustomer}:{module:string;accessToken:string;businessId:string;canManage?:boolean;setActive:(page:string)=>void;conversationTarget:CustomerConversationRow|null;clearConversationTarget:()=>void;requestTargetId:string|null;clearRequestTarget:()=>void;openConversationFromCustomer:(conversation:CustomerConversationRow)=>void;openRequestFromCustomer:(requestId:string)=>void}) {
  const [conversations,setConversations]=useState<ConversationRow[]>([]);
  const [conversationStatus,setConversationStatus]=useState("");
  const [conversationChannel,setConversationChannel]=useState("");
  const [conversationSearch,setConversationSearch]=useState("");
  const [conversationOffset,setConversationOffset]=useState(0);
  const [conversationHasMore,setConversationHasMore]=useState(false);
  const [customers,setCustomers]=useState<CustomerRow[]>([]);
  const [requests,setRequests]=useState<RequestRow[]>([]);
  const [requestStatus,setRequestStatus]=useState("");
  const [focusedRequestId,setFocusedRequestId]=useState<string|null>(null);
  const [loadedModule,setLoadedModule]=useState("");
  const [selected,setSelected]=useState<ConversationRow|null>(null);
  const [messages,setMessages]=useState<MessageRow[]>([]);
  const [handoff,setHandoff]=useState<Handoff|null>(null);
  const [relatedCustomer,setRelatedCustomer]=useState<CustomerRow|null>(null);
  const [relatedRequests,setRelatedRequests]=useState<ConversationDetail["requests"]>([]);
  const [handoffs,setHandoffs]=useState<Handoff[]>([]);
  const [clockNow,setClockNow]=useState(Date.now());
  const [handoffBusy,setHandoffBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [detailLoading,setDetailLoading]=useState(false);
  const [error,setError]=useState("");
  const [detailError,setDetailError]=useState("");
  const [requestBusy,setRequestBusy]=useState("");
  const [retryBusy,setRetryBusy]=useState("");
  const refresh=useCallback(async()=>{
    setLoading(true);setLoadedModule("");setError("");
    try {
      if(module==="Conversations") {
        const params=new URLSearchParams({limit:"50",offset:String(conversationOffset)});
        if(conversationStatus)params.set("status",conversationStatus);
        if(conversationChannel.trim())params.set("channel",conversationChannel.trim());
        const data=await apiRequest<{conversations:ConversationRow[];has_more:boolean}>(`/businesses/${businessId}/conversations?${params.toString()}`,accessToken);
        setConversations(data.conversations);setConversationHasMore(data.has_more);
      }
      else if(module==="Customers") { const data=await apiRequest<{customers:CustomerRow[]}>(`/businesses/${businessId}/customers`,accessToken);setCustomers(data.customers); }
      else { const params=new URLSearchParams();if(requestStatus)params.set("status",requestStatus);const data=await apiRequest<{requests:RequestRow[]}>(`/businesses/${businessId}/requests?${params.toString()}`,accessToken);setRequests(data.requests); }
    } catch(e) { setError(e instanceof Error?e.message:`${module} could not be loaded.`); }
    finally { setLoading(false);setLoadedModule(module); }
  },[accessToken,businessId,module,conversationOffset,conversationStatus,conversationChannel,requestStatus]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{if(!handoff||!["requested","assigned"].includes(handoff.status))return;const timer=window.setInterval(()=>setClockNow(Date.now()),1000);return()=>window.clearInterval(timer);},[handoff]);
  async function updateRequestStatus(item:RequestRow,status:string) {
    setRequestBusy(item.id);setError("");
    try { await apiRequest(`/businesses/${businessId}/requests/${item.id}`,accessToken,{method:"PATCH",body:JSON.stringify({status})}); await refresh(); }
    catch(e) { setError(e instanceof Error?e.message:"Request status could not be changed."); }
    finally { setRequestBusy(""); }
  }
  async function updateRequestFields(item:RequestRow,updates:Record<string,unknown>) {
    setRequestBusy(item.id);setError("");
    try { await apiRequest(`/businesses/${businessId}/requests/${item.id}`,accessToken,{method:"PATCH",body:JSON.stringify(updates)}); await refresh(); }
    catch(e) { setError(e instanceof Error?e.message:"Request update failed."); }
    finally { setRequestBusy(""); }
  }
  const visibleConversations=conversations.filter(item=>!conversationSearch.trim()||[item.customer_name,item.customer_username,item.customer_external_id,item.summary].some(value=>String(value||"").toLocaleLowerCase().includes(conversationSearch.trim().toLocaleLowerCase())));
  async function openConversation(item:ConversationRow) {
    setSelected(item);setDetailLoading(true);setDetailError("");
    try {
      const [data,hd]=await Promise.all([apiRequest<{messages:MessageRow[]}&ConversationDetail>(`/businesses/${businessId}/conversations/${item.id}/messages`,accessToken),apiRequest<{handoffs:Handoff[]}>(`/businesses/${businessId}/handoffs`,accessToken)]);
      const missing=[] as string[];
      if(!data||!Array.isArray(data.messages))missing.push("messages");
      if(!data||!Array.isArray(data.requests))missing.push("related requests");
      if(!data||!("customer" in data))missing.push("customer profile");
      if(!hd||!Array.isArray(hd.handoffs))missing.push("handoffs");
      if(missing.length)throw new Error(`Conversation details are missing ${missing.join(", ")}. Confirm the dashboard API is running the current code and retry.`);
      const messages=data.messages.map(message=>({...message,content:typeof message.content==="string"?message.content:String(message.content??""),delivery:message.delivery?{...message.delivery,status:typeof message.delivery.status==="string"?message.delivery.status:"unknown"}:null}));
      setMessages(messages);setRelatedCustomer(data.customer);setRelatedRequests(data.requests);setHandoffs(hd.handoffs);setHandoff(hd.handoffs.find(h=>h.conversation_id===item.id&&["requested","assigned","active"].includes(h.status))||null);
    }
    catch(e) { setDetailError(e instanceof Error?e.message:"Conversation details could not be loaded.");setMessages([]);setRelatedCustomer(null);setRelatedRequests([]);setHandoff(null); }
    finally { setDetailLoading(false); }
  }
  useEffect(()=>{if(module==="Conversations"&&conversationTarget){void openConversation(conversationTarget);clearConversationTarget();}},[module,conversationTarget]);
  useEffect(()=>{if(module!=="Requests"||!requestTargetId||loading||loadedModule!=="Requests")return;if(requests.some(item=>item.id===requestTargetId))setFocusedRequestId(requestTargetId);else setError("That customer request is not in the loaded request list.");clearRequestTarget();},[module,requestTargetId,loading,loadedModule,requests]);
  async function retryDelivery(message:MessageRow){if(!selected||!message.delivery)return;setRetryBusy(message.id);setDetailError("");try{await apiRequest("/businesses/"+businessId+"/channel-deliveries/"+message.delivery.id+"/retry",accessToken,{method:"POST"});await openConversation(selected);}catch(e){setDetailError(e instanceof Error?e.message:"Delivery retry could not be completed.");}finally{setRetryBusy("");}}
  async function requestHumanHandoff(){if(!selected)return;setHandoffBusy(true);setDetailError("");try{const d=await apiRequest<{handoff:Handoff}>(`/businesses/${businessId}/handoffs?conversation_id=${encodeURIComponent(selected.id)}`,accessToken,{method:"POST",body:JSON.stringify({reason:"customer_requested"})});setHandoff(d.handoff);setHandoffs(p=>[d.handoff,...p]);}catch(e){setDetailError(e instanceof Error?e.message:"Human handoff could not be requested.");}finally{setHandoffBusy(false);}}
  const queue=[...handoffs].filter(h=>h.status==="requested").sort((a,b)=>Date.parse(a.requested_at)-Date.parse(b.requested_at));const position=handoff?.status==="requested"?queue.findIndex(h=>h.id===handoff.id)+1:0;const timerEnd=handoff?.status==="active"&&handoff.updated_at?Date.parse(handoff.updated_at):clockNow;const seconds=handoff?Math.max(0,Math.floor((timerEnd-Date.parse(handoff.requested_at))/1000)):0;const timer=`${String(Math.floor(seconds/3600)).padStart(2,"0")}:${String(Math.floor(seconds%3600/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
  return <section className="control-panel" aria-label={`${module} workspace`}>
    <div className="panel-heading"><div><h2>{module}</h2><p>{module==="Conversations"?"Business conversations and their recorded message history.":module==="Customers"?"Customer profiles and channels seen by this business.":"Structured customer requests, missing information, and current status."}</p></div><button onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {module==="Conversations"&&<div className="record-actions conversation-filters"><label>Status<select aria-label="Filter conversations by status" value={conversationStatus} onChange={e=>{setConversationOffset(0);setConversationStatus(e.target.value);}}><option value="">All statuses</option><option value="open">Open</option><option value="closed">Closed</option></select></label><label>Channel<input aria-label="Filter conversations by channel" maxLength={50} value={conversationChannel} onChange={e=>{setConversationOffset(0);setConversationChannel(e.target.value);}} placeholder="All channels (e.g. instagram)"/></label><label>Search this page<input aria-label="Search loaded conversations" maxLength={100} value={conversationSearch} onChange={e=>setConversationSearch(e.target.value)} placeholder="Customer, username, ID or summary"/></label></div>}
    {module==="Requests"&&<div className="record-actions conversation-filters"><label>Status<select aria-label="Filter requests by status" value={requestStatus} onChange={e=>setRequestStatus(e.target.value)}><option value="">All statuses</option>{["active","awaiting_customer","completed","cancelled","superseded"].map(status=><option key={status} value={status}>{status.replaceAll("_"," ")}</option>)}</select></label></div>}
    {loading?<p role="status">Loading {module.toLowerCase()}…</p>:module==="Conversations"?(conversations.length===0?<p className="empty-copy">No conversations on this page. Try another filter or page.</p>:<div className="workspace-split"><div className="record-list">{visibleConversations.length===0?<p className="empty-copy">No conversations on this page match that search.</p>:visibleConversations.map(item=><button className={selected?.id===item.id?"record selected-record":"record"} key={item.id} onClick={()=>void openConversation(item)}><span><strong>{item.customer_name||item.customer_external_id||"Customer"}</strong><small>{item.channel||item.platform||"Unknown channel"} · {item.status} · {new Date(item.last_message_at||item.created_at).toLocaleString()}</small>{item.summary&&<small>{item.summary}</small>}</span></button>)}<div className="record-actions"><button disabled={conversationOffset===0||loading} onClick={()=>setConversationOffset(Math.max(0,conversationOffset-50))}>Previous page</button><small>Showing {conversationOffset+1}�{conversationOffset+conversations.length}{conversationHasMore?"+":""} conversations</small><button disabled={!conversationHasMore||loading} onClick={()=>setConversationOffset(conversationOffset+50)}>Next page</button></div></div><div className="message-panel">{!selected?<p className="empty-copy">Select a conversation to view its messages.</p>:<><h3>Conversation messages</h3><p className="quiet-note">{selected.customer_name||selected.customer_external_id||selected.id}</p><div className="record-actions conversation-related">{relatedCustomer?<><span>Customer profile linked: {String(relatedCustomer.profile?.name||relatedCustomer.profile?.full_name||relatedCustomer.external_customer_id)}</span><button type="button" onClick={()=>setActive("Customers")}>Open Customers</button></>:<span>No customer profile is linked to this conversation.</span>}{relatedRequests.length>0?<button type="button" onClick={()=>setActive("Requests")}>Open {relatedRequests.length} related request{relatedRequests.length===1?"":"s"}</button>:<span>No related requests.</span>}{handoff&&<button type="button" onClick={()=>setActive("Human Agents")}>Open Human Agents queue</button>}</div>{relatedRequests.length>0&&<div className="related-requests" aria-label="Related requests">{relatedRequests.map(request=><article className="message-item" key={request.id}><strong>{request.request_type} · {request.status}</strong><small>Request {request.id}</small><small>Missing: {request.missing_information?.length?request.missing_information.join(", "):"None"}</small></article>)}</div>}{detailError&&<p className="form-error" role="alert">{detailError}</p>}{!detailLoading&&module==="Conversations"&&<div className={handoff?"handoff-status":"handoff-start"}>{handoff?<><strong>Human handoff � {handoff.status.replaceAll("_"," ")}</strong><span>{handoff.status==="active"?"Wait to takeover ":"Waiting "}{timer}{position?` � FIFO position ${position}`:""}{handoff.assigned_to?` � assigned to ${handoff.assigned_to}`:""}</span><small>Timer shows elapsed wait. A response-time estimate needs agent availability and handling-time data.</small></>:<><span>No human takeover requested.</span><button disabled={handoffBusy} onClick={()=>void requestHumanHandoff()}>{handoffBusy?"Requesting�":"Request human takeover"}</button></>}</div>}{detailLoading?<p role="status">Loading messages…</p>:messages.length===0?<p className="empty-copy">No messages recorded in this conversation.</p>:<div className="message-list">{messages.map(message=><article className="message-item" key={message.id}><strong>{message.sender_type}</strong><p>{message.content}</p><small>{new Date(message.created_at).toLocaleString()}</small>{canManage&&message.delivery?.status==="rejected"&&message.delivery.safe_error_code!=="response_window_expired"&&<button type="button" disabled={retryBusy===message.id} onClick={()=>void retryDelivery(message)}>{retryBusy===message.id?"Retrying...":"Retry rejected delivery"}</button>}{message.delivery&&<small>Delivery: {message.delivery.status.replaceAll("_"," ")}{message.delivery.safe_error_code?` � ${message.delivery.safe_error_code.replaceAll("_"," ")}`:""}</small>}</article>)}</div>}</>}</div></div>):module==="Customers"?<CustomerWorkspace customers={customers} accessToken={accessToken} businessId={businessId} setActive={setActive} openConversation={openConversationFromCustomer} openRequest={openRequestFromCustomer}/>:<RequestWorkspace requests={requests} accessToken={accessToken} businessId={businessId} busyId={requestBusy} focusedId={focusedRequestId} onUpdateStatus={(item,status)=>void updateRequestStatus(item,status)} onUpdateFields={(item,updates)=>void updateRequestFields(item,updates)}/> }
  </section>;
}

function RequestWorkspace({requests,accessToken,businessId,busyId,focusedId,onUpdateStatus,onUpdateFields}:{requests:RequestRow[];accessToken:string;businessId:string;busyId:string;focusedId:string|null;onUpdateStatus:(item:RequestRow,status:string)=>void;onUpdateFields:(item:RequestRow,updates:Record<string,unknown>)=>void}) {
  return <div className="record-list" aria-label="Structured customer requests">{requests.length===0?<p className="empty-copy">No structured requests match this status.</p>:requests.map(item=><RequestManagementCard key={item.id} item={item} requests={requests} accessToken={accessToken} businessId={businessId} busy={busyId===item.id} focused={focusedId===item.id} onUpdateStatus={status=>onUpdateStatus(item,status)} onUpdateFields={updates=>onUpdateFields(item,updates)}/>)}</div>;
}

function RequestManagementCard({item,requests,accessToken,businessId,busy,focused,onUpdateStatus,onUpdateFields}:{item:RequestRow;requests:RequestRow[];accessToken:string;businessId:string;busy:boolean;focused:boolean;onUpdateStatus:(status:string)=>void;onUpdateFields:(updates:Record<string,unknown>)=>void}) {
  const [required,setRequired]=useState(item.required_information.join(", "));
  const [missing,setMissing]=useState(item.missing_information.join(", "));
  const [details,setDetails]=useState(JSON.stringify(item.details||{},null,2));
  const [events,setEvents]=useState<Array<{id:number;event_type:string;payload:Record<string,unknown>;created_at:string}>|null>(null);
  const [error,setError]=useState("");
  async function showHistory(){setError("");try{const data=await apiRequest<{events:Array<{id:number;event_type:string;payload:Record<string,unknown>;created_at:string}>}>(`/businesses/${businessId}/requests/${item.id}/events`,accessToken);setEvents(data.events);}catch(e){setError(e instanceof Error?e.message:"Request history could not be loaded.");}}
  function saveCorrections(){try{const parsed=JSON.parse(details);if(!parsed||Array.isArray(parsed)||typeof parsed!=="object")throw new Error("Request details must be a JSON object.");onUpdateFields({required_information:required.split(",").map(x=>x.trim()).filter(Boolean),missing_information:missing.split(",").map(x=>x.trim()).filter(Boolean),details:parsed});setError("");}catch(e){setError(e instanceof Error?e.message:"Request details must be valid JSON.");}}
  return <article className={focused?"record selected-record":"record"}><div><strong>{item.request_type} · {item.status}</strong><small>Request {item.id} · Conversation {item.conversation_id}</small><small>Missing: {item.missing_information.length?item.missing_information.join(", "):"None"}</small><small>Details: {JSON.stringify(item.details||{})}</small><small>{item.related_request_id?`Related to request ${item.related_request_id}`:"No related request"} · Layer 5 continuation updates the existing request record.</small><div className="record-actions"><select aria-label={`Next status for request ${item.id}`} value="" onChange={e=>{if(e.target.value)onUpdateStatus(e.target.value)}} disabled={busy||["completed","cancelled","superseded"].includes(item.status)}><option value="">Update status…</option>{(item.status==="active"?["awaiting_customer","completed","cancelled"]:item.status==="awaiting_customer"?["active","completed","cancelled"]:[]).map(status=><option key={status} value={status}>{status.replaceAll("_"," ")}</option>)}</select><select aria-label={`Related request for ${item.id}`} value={item.related_request_id||""} disabled={busy} onChange={e=>onUpdateFields({related_request_id:e.target.value||null})}><option value="">No related request</option>{requests.filter(other=>other.customer_id===item.customer_id&&other.id!==item.id).map(other=><option key={other.id} value={other.id}>{other.request_type} · {other.status} · {other.id}</option>)}</select>{busy&&<small>Saving…</small>}</div><details><summary>Correct request information</summary><label>Required information (comma separated)<input value={required} onChange={e=>setRequired(e.target.value)}/></label><label>Missing information (comma separated)<input value={missing} onChange={e=>setMissing(e.target.value)}/></label><label>Request details (JSON)<textarea rows={5} value={details} onChange={e=>setDetails(e.target.value)}/></label><button type="button" disabled={busy} onClick={saveCorrections}>Save correction</button></details><details onToggle={e=>{if((e.currentTarget as HTMLDetailsElement).open&&events===null)void showHistory();}}><summary>Request audit history</summary>{error&&<p className="form-error" role="alert">{error}</p>}{events===null?<p>Loading request history…</p>:events.length===0?<p className="empty-copy">No dashboard changes have been recorded for this request.</p>:events.map(event=><small key={event.id}>{event.event_type.replaceAll("."," ")} · {new Date(event.created_at).toLocaleString()} · {String(event.payload.updated_fields||event.payload.status||"")}</small>)}</details></div></article>;
}

function CustomerWorkspace({customers,accessToken,businessId,setActive,openConversation,openRequest}:{customers:CustomerRow[];accessToken:string;businessId:string;setActive:(page:string)=>void;openConversation:(conversation:CustomerConversationRow)=>void;openRequest:(requestId:string)=>void}) {
  const [selected,setSelected]=useState<CustomerRow|null>(null);
  const [detail,setDetail]=useState<CustomerDetail|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  async function selectCustomer(item:CustomerRow) {
    setSelected(item);setDetail(null);setLoading(true);setError("");
    try {
      const data=await apiRequest<CustomerDetail>(`/businesses/${businessId}/customers/${item.id}`,accessToken);
      if(!data?.customer||!Array.isArray(data.conversations)||!Array.isArray(data.requests))throw new Error("Customer details returned an incomplete response.");
      setDetail(data);
    } catch(e) { setError(e instanceof Error?e.message:"Customer details could not be loaded."); }
    finally { setLoading(false); }
  }
  const profile=detail?.customer.profile&&typeof detail.customer.profile==="object"?Object.entries(detail.customer.profile):[];
  return <div className="workspace-split customer-workspace"><div className="record-list" aria-label="Customer profiles">
    {customers.length===0?<p className="empty-copy">No customer profiles have been recorded for this business.</p>:customers.map(item=><button className={selected?.id===item.id?"record selected-record":"record"} key={item.id} onClick={()=>void selectCustomer(item)}><span><strong>{String(item.profile?.name||item.profile?.full_name||item.external_customer_id)}</strong><small>{item.channel} · Customer ID {item.external_customer_id} · Updated {new Date(item.updated_at).toLocaleString()}</small></span></button>)}
  </div><div className="message-panel" aria-label="Customer profile and history">{!selected?<p className="empty-copy">Select a customer to view their profile and history.</p>:<>
    <h3>Customer profile</h3><p className="quiet-note">{selected.channel} · Customer ID {selected.external_customer_id}</p>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {loading?<p role="status">Loading customer history…</p>:detail&&<>
      {profile.length? <dl className="customer-profile">{profile.map(([key,value])=><div key={key}><dt>{key.replaceAll("_"," ")}</dt><dd>{typeof value==="string"?value:JSON.stringify(value)}</dd></div>)}</dl>:<p className="empty-copy">No additional profile details.</p>}
      <div className="customer-history-section"><div className="panel-heading"><h3>Conversation history</h3><button type="button" disabled={!detail.conversations.length} onClick={()=>setActive("Conversations")}>Open Conversations</button></div>
        {detail.conversations.length===0?<p className="empty-copy">No conversations are linked to this customer.</p>:<div className="related-requests">{detail.conversations.map(conversation=><article className="message-item" key={conversation.id}><strong>{conversation.channel||conversation.platform||"Unknown channel"} · {conversation.status}</strong><small>Conversation {conversation.id} · {new Date(conversation.last_message_at||conversation.created_at).toLocaleString()}</small>{conversation.summary&&<p>{conversation.summary}</p>}<button type="button" onClick={()=>openConversation(conversation)}>Open conversation</button></article>)}</div>}
      </div>
      <div className="customer-history-section"><div className="panel-heading"><h3>Requests</h3><button type="button" disabled={!detail.requests.length} onClick={()=>setActive("Requests")}>Open Requests</button></div>
        {detail.requests.length===0?<p className="empty-copy">No requests are linked to this customer.</p>:<div className="related-requests">{detail.requests.map(request=><article className="message-item" key={request.id}><strong>{request.request_type} · {request.status}</strong><small>Request {request.id}</small><small>Missing: {request.missing_information?.length?request.missing_information.join(", "):"None"}</small><button type="button" onClick={()=>openRequest(request.id)}>Open request</button></article>)}</div>}
      </div>
    </>}
  </>}</div></div>;
}


type DirectoryToolRow = { tool_id:string; family:string; description:string; verification_policy:string; active:boolean };
type DirectorySearchResult = { tool_id:string; outcome:string; message:string; records?:Record<string,unknown>[]; requires_human?:boolean; verification_state?:string; allowed_fields?:string[] };
function DirectoryToolsPage({accessToken,businessId}:{accessToken:string;businessId:string}) {
  const [tools,setTools]=useState<DirectoryToolRow[]>([]);
  const [conversations,setConversations]=useState<ConversationRow[]>([]);
  const [toolId,setToolId]=useState("");
  const [conversationId,setConversationId]=useState("");
  const [query,setQuery]=useState("");
  const [result,setResult]=useState<DirectorySearchResult|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const refresh=useCallback(async()=>{
    setLoading(true);setError("");
    try {
      const [toolData,conversationData]=await Promise.all([
        apiRequest<{tools:DirectoryToolRow[]}>(`/businesses/${businessId}/directory/tools`,accessToken),
        apiRequest<{conversations:ConversationRow[]}>(`/businesses/${businessId}/conversations`,accessToken),
      ]);
      const activeTools=toolData.tools.filter(item=>item.active);
      setTools(activeTools);setConversations(conversationData.conversations);
      setToolId(previous=>activeTools.some(item=>item.tool_id===previous)?previous:activeTools[0]?.tool_id||"");
      setConversationId(previous=>conversationData.conversations.some(item=>item.id===previous)?previous:conversationData.conversations[0]?.id||"");
    } catch(e) { setError(e instanceof Error?e.message:"Directory tools could not be loaded."); }
    finally { setLoading(false); }
  },[accessToken,businessId]);
  useEffect(()=>{void refresh();},[refresh]);
  async function search(event:FormEvent) {
    event.preventDefault();setBusy(true);setError("");setResult(null);
    try {
      const data=await apiRequest<DirectorySearchResult>(`/businesses/${businessId}/directory/search`,accessToken,{method:"POST",body:JSON.stringify({tool_id:toolId,conversation_id:conversationId,query:query.trim()})});
      setResult(data);
    } catch(e) { setError(e instanceof Error?e.message:"Directory search could not be completed."); }
    finally { setBusy(false); }
  }
  return <section className="control-panel" aria-label="Directory search and access controls">
    <div className="panel-heading"><div><h2>Directory &amp; Tools</h2><p>Search with a recorded conversation as context. FayFort checks access, verification rules, and records each decision before showing any matching fields.</p></div><button onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {loading?<p role="status">Loading directory tools and conversations�</p>:<>
      {!tools.length?<p className="empty-copy">No active directory tools are currently registered.</p>:!conversations.length?<p className="empty-copy">Record a conversation first to provide an auditable search context.</p>:<form className="inline-form directory-search-form" onSubmit={search}>
        <label>Directory tool<select required value={toolId} onChange={e=>setToolId(e.target.value)}>{tools.map(item=><option key={item.tool_id} value={item.tool_id}>{item.tool_id} � {item.family}</option>)}</select></label>
        <label>Conversation<select required value={conversationId} onChange={e=>setConversationId(e.target.value)}>{conversations.map(item=><option key={item.id} value={item.id}>{item.customer_name||item.customer_external_id||"Customer"} � {item.channel||item.platform||"channel"} � {item.id}</option>)}</select></label>
        <label>Search query<input required minLength={1} maxLength={1000} value={query} onChange={e=>setQuery(e.target.value)} placeholder="What should FayFort look up?"/></label>
        <button className="primary-button" disabled={busy||!toolId||!conversationId}>{busy?"Checking access�":"Search directory"}</button>
      </form>}
      {tools.length>0&&<div className="record-list directory-tool-list">{tools.map(item=><div className="record" key={item.tool_id}><div><strong>{item.tool_id} � {item.family}</strong><small>{item.description}</small><small>Verification policy: {item.verification_policy}</small></div></div>)}</div>}
      {result&&<section className="directory-result" aria-live="polite"><h3>Search decision: {result.outcome.replaceAll("_"," ")}</h3><p>{result.message}</p>{result.verification_state&&<p><strong>Record verification:</strong> {result.verification_state.replaceAll("_"," ")}</p>}{result.allowed_fields?.length?<p><strong>Fields returned:</strong> {result.allowed_fields.join(", ")}</p>:null}{result.requires_human&&<p className="quiet-note">This result requires a human review before it can be used.</p>}{result.records?.length?<div className="record-list">{result.records.map((record,index)=><div className="record" key={index}><div>{Object.entries(record).map(([key,value])=><small key={key}><strong>{key.replaceAll("_"," ")}: </strong>{typeof value==="object"?JSON.stringify(value):String(value)}</small>)}</div></div>)}</div>:null}</section>}
    </>}
  </section>;
}

type EntitlementRow = {id:string;tool_id:string;access_level:string;status:string;starts_at?:string|null;expires_at?:string|null;entitlement_source?:string;source_reference?:string};
function EntitlementsPage({accessToken,businessId}:{accessToken:string;businessId:string}) {
  const [rows,setRows]=useState<EntitlementRow[]>([]);const [canManage,setCanManage]=useState(false);const [tools,setTools]=useState<DirectoryToolRow[]>([]);const [toolId,setToolId]=useState("");const [accessLevel,setAccessLevel]=useState("premium");const [reason,setReason]=useState("");const [expiresAt,setExpiresAt]=useState("");const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const refresh=useCallback(async()=>{setLoading(true);try{const [ent,registry]=await Promise.all([apiRequest<{entitlements:EntitlementRow[];can_manage:boolean}>(`/businesses/${businessId}/entitlements`,accessToken),apiRequest<{tools:DirectoryToolRow[]}>(`/businesses/${businessId}/directory/tools`,accessToken)]);setRows(ent.entitlements);setCanManage(ent.can_manage);setTools(registry.tools);setToolId(previous=>registry.tools.some(t=>t.tool_id===previous)?previous:registry.tools[0]?.tool_id||"");setError("");}catch(e){setError(e instanceof Error?e.message:"Entitlements could not be loaded.");}finally{setLoading(false);}},[accessToken,businessId]);
  useEffect(()=>{void refresh();},[refresh]);
  async function grant(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{await apiRequest(`/businesses/${businessId}/entitlements`,accessToken,{method:"POST",body:JSON.stringify({tool_id:toolId,access_level:accessLevel,reason:reason.trim(),...(expiresAt?{expires_at:new Date(expiresAt).toISOString()}: {})})});setReason("");setExpiresAt("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Entitlement could not be granted.");}finally{setBusy(false);}}
  async function revoke(item:EntitlementRow){setBusy(true);setError("");try{await apiRequest(`/businesses/${businessId}/entitlements/${item.id}/revoke`,accessToken,{method:"POST"});await refresh();}catch(e){setError(e instanceof Error?e.message:"Entitlement could not be revoked.");}finally{setBusy(false);}}
  return <section className="control-panel" aria-label="Business entitlements"><div className="panel-heading"><div><h2>Business access grants</h2><p>Manual grants are recorded with a reason and appear in the activity feed. This does not represent a subscription or payment.</p></div><button onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>{error&&<p className="form-error" role="alert">{error}</p>}{canManage?<form className="inline-form" onSubmit={grant}><label>Tool<select required value={toolId} onChange={e=>setToolId(e.target.value)}>{tools.map(t=><option key={t.tool_id} value={t.tool_id}>{t.tool_id}</option>)}</select></label><label>Access level<select value={accessLevel} onChange={e=>setAccessLevel(e.target.value)}><option value="registered">Registered</option><option value="premium">Premium</option></select></label><label>Reason for manual grant<input required minLength={5} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Approved by business owner"/></label><label>Optional expiry<input type="datetime-local" value={expiresAt} onChange={e=>setExpiresAt(e.target.value)}/></label><button className="primary-button" disabled={busy||!toolId}>{busy?"Saving�":"Grant access"}</button></form>:<p className="quiet-note">Only a FayFort platform administrator can manage access grants.</p>}{loading?<p>Loading grants�</p>:rows.length===0?<p className="empty-copy">No access grants are recorded for this business.</p>:<div className="record-list">{rows.map(row=><div className="record" key={row.id}><div><strong>{row.tool_id} � {row.access_level} � {row.status}</strong><small>Source: {row.entitlement_source||"�"} � Starts: {row.starts_at||"�"} � Expires: {row.expires_at||"Never"}</small>{row.source_reference&&<small>Reason: {row.source_reference}</small>}</div>{canManage&&row.status==="active"&&<button disabled={busy} onClick={()=>void revoke(row)}>Revoke</button>}</div>)}</div>}</section>;
}

type VerificationQueueRow = {source_type:string;tool_id:string;record_id:string;verification_status:string;label:string};
type VerificationDecisionRow = {id:string;tool_id:string;outcome:string;verification_state?:string;reason_code?:string;created_at:string};
type VerificationReviewRow = {id:string;reviewer_user_id:string;source_table:string;record_id:string;tool_id:string;previous_status:string;verification_status:string;reason:string;created_at:string};
function VerificationPage({accessToken,businessId}:{accessToken:string;businessId:string}) {
  const [queue,setQueue]=useState<VerificationQueueRow[]>([]);const [canManage,setCanManage]=useState(false);const [decisions,setDecisions]=useState<VerificationDecisionRow[]>([]);const [reviews,setReviews]=useState<VerificationReviewRow[]>([]);const [statuses,setStatuses]=useState<Record<string,string>>({});const [reasons,setReasons]=useState<Record<string,string>>({});const [loading,setLoading]=useState(true);const [busy,setBusy]=useState("");const [error,setError]=useState("");
  const refresh=useCallback(async()=>{setLoading(true);try{const data=await apiRequest<{review_queue:VerificationQueueRow[];decisions:VerificationDecisionRow[];reviews:VerificationReviewRow[];can_review:boolean}>(`/businesses/${businessId}/verification`,accessToken);setCanManage(data.can_review);setQueue(data.review_queue);setDecisions(data.decisions);setReviews(data.reviews||[]);setError("");}catch(e){setError(e instanceof Error?e.message:"Verification history could not be loaded.");}finally{setLoading(false);}},[accessToken,businessId]);
  useEffect(()=>{void refresh();},[refresh]);
  async function review(item:VerificationQueueRow){setBusy(item.record_id);setError("");try{await apiRequest(`/businesses/${businessId}/verification/${item.source_type}/${item.record_id}`,accessToken,{method:"POST",body:JSON.stringify({verification_status:statuses[item.record_id]||"verified",reason:reasons[item.record_id]?.trim()||"Reviewed against the source record."})});await refresh();}catch(e){setError(e instanceof Error?e.message:"Review could not be saved.");}finally{setBusy("");}}
  return <section className="control-panel" aria-label="Directory verification review"><div className="panel-heading"><div><h2>Directory verification</h2><p>Review individual imported records. Your choice and reason are stored in an audit trail and affect which tool results can be returned.</p></div><button onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>{error&&<p className="form-error" role="alert">{error}</p>}{!canManage&&<p className="quiet-note">Only a FayFort platform administrator can change the shared directory verification status.</p>}{loading?<p>Loading review queue�</p>:queue.length===0?<p className="empty-copy">No unverified or conflicting directory records are waiting for review.</p>:<div className="record-list">{queue.map(item=><div className="record verification-record" key={`${item.source_type}-${item.record_id}`}><div><strong>{item.label||item.record_id}</strong><small>{item.tool_id} � {item.source_type.replaceAll("_"," ")} � Current status: {item.verification_status}</small>{canManage&&<div className="record-actions"><select aria-label={`Verification decision for ${item.record_id}`} value={statuses[item.record_id]||"verified"} onChange={e=>setStatuses(previous=>({...previous,[item.record_id]:e.target.value}))}><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="conflicting">Conflicting</option><option value="unknown">Unknown</option></select><input aria-label={`Review reason for ${item.record_id}`} minLength={8} maxLength={500} value={reasons[item.record_id]||""} onChange={e=>setReasons(previous=>({...previous,[item.record_id]:e.target.value}))} placeholder="Why is this status supported?"/><button disabled={busy===item.record_id||((reasons[item.record_id]||"").trim().length<8)} onClick={()=>void review(item)}>{busy===item.record_id?"Saving�":"Save review"}</button></div>}</div></div>)}</div>}<h3 className="section-title">Recent reviews</h3>{reviews.length===0?<p className="empty-copy">No verification reviews recorded for this business.</p>:<div className="record-list">{reviews.map(item=><div className="record" key={item.id}><div><strong>{item.tool_id} � {item.previous_status} � {item.verification_status}</strong><small>{item.source_table} � {item.record_id} � Reviewer {item.reviewer_user_id} � {new Date(item.created_at).toLocaleString()}</small><small>{item.reason}</small></div></div>)}</div>}<h3 className="section-title">Recent access decisions</h3>{decisions.length===0?<p className="empty-copy">No directory access decisions recorded yet.</p>:<div className="record-list">{decisions.map(item=><div className="record" key={item.id}><div><strong>{item.tool_id} � {item.outcome}</strong><small>Verification: {item.verification_state||"not required"} � {item.reason_code||"�"} � {new Date(item.created_at).toLocaleString()}</small></div></div>)}</div>}</section>;
}

function SettingsPage({accessToken,businessId,canManage}:{accessToken:string;businessId:string;canManage:boolean}) {
  const [name,setName]=useState("");const [description,setDescription]=useState("");const [createdAt,setCreatedAt]=useState("");const [updatedAt,setUpdatedAt]=useState("");const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [saved,setSaved]=useState(false);
  const refresh=useCallback(async()=>{setLoading(true);try{const data=await apiRequest<{business:{name:string;description?:string|null;created_at:string;updated_at:string}}>(`/businesses/${businessId}/settings`,accessToken);setName(data.business.name);setDescription(data.business.description||"");setCreatedAt(data.business.created_at);setUpdatedAt(data.business.updated_at);setError("");}catch(e){setError(e instanceof Error?e.message:"Workspace settings could not be loaded.");}finally{setLoading(false);}},[accessToken,businessId]);
  useEffect(()=>{void refresh();},[refresh]);
  async function save(event:FormEvent){event.preventDefault();setBusy(true);setError("");setSaved(false);try{await apiRequest(`/businesses/${businessId}/settings`,accessToken,{method:"PATCH",body:JSON.stringify({expected_updated_at:updatedAt,name:name.trim(),description:description.trim()||null})});setSaved(true);await refresh();}catch(e){setError(e instanceof Error?e.message:"Settings could not be saved.");}finally{setBusy(false);}}
  return <section className="control-panel" aria-label="Business settings"><div className="panel-heading"><div><h2>Workspace settings</h2><p>Edit the business display name and description. Higher-risk operational settings are not exposed until their behavior is defined.</p></div><button onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>{error&&<p className="form-error" role="alert">{error}</p>}{saved&&<p className="success-note" role="status">Settings saved.</p>}{loading?<p>Loading workspace details�</p>:<><form className="settings-form" onSubmit={save}><label>Business name<input required minLength={1} maxLength={120} value={name} onChange={e=>setName(e.target.value)} disabled={!canManage}/></label><label>Description<textarea maxLength={500} rows={4} value={description} onChange={e=>setDescription(e.target.value)} disabled={!canManage}/></label>{canManage?<button className="primary-button" disabled={busy}>{busy?"Saving�":"Save settings"}</button>:<p className="quiet-note">Only a business owner or admin can edit workspace settings.</p>}</form><div className="record-list"><div className="record"><div><small>Business ID: {businessId}</small><small>Created: {createdAt}</small><small>Updated: {updatedAt}</small></div></div></div></>}</section>;
}

type AnalyticsEvent = {id:number;event_type:string;entity_type:string;entity_id:string;created_at:string};
type AnalyticsResult = {days:number;sampled_events:number;summary_truncated:boolean;event_counts:Record<string,number>;events:AnalyticsEvent[];has_more:boolean;next_before_id:number|null};
type AiUsageResult = {days:number;sampled_requests:number;summary_truncated:boolean;reported_usage_requests:number;unknown_usage_requests:number;prompt_tokens:number;completion_tokens:number;total_tokens:number;source_messages:number;message_call_distribution:Record<string,number>;operations:Record<string,{calls:number;prompt_tokens:number;completion_tokens:number;total_tokens:number}>;models:Record<string,number>;providers:Record<string,number>;budget:{limit_usd:number;committed_usd:number;pending_usd:number;remaining_usd:number;month_start:string}};
const emptyAiUsage=(days:number):AiUsageResult=>({days,sampled_requests:0,summary_truncated:false,reported_usage_requests:0,unknown_usage_requests:0,prompt_tokens:0,completion_tokens:0,total_tokens:0,source_messages:0,message_call_distribution:{},operations:{},models:{},providers:{},budget:{limit_usd:0,committed_usd:0,pending_usd:0,remaining_usd:0,month_start:""}});
const formatUsd=(value:number)=>value.toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:6});
function AnalyticsPage({accessToken,businessId}:{accessToken:string;businessId:string}) {
  const [days,setDays]=useState(30);const [events,setEvents]=useState<AnalyticsEvent[]>([]);const [counts,setCounts]=useState<Record<string,number>>({});const [sampled,setSampled]=useState(0);const [truncated,setTruncated]=useState(false);const [cursor,setCursor]=useState<number|null>(null);const [hasMore,setHasMore]=useState(false);const [loading,setLoading]=useState(true);const [paging,setPaging]=useState(false);const [error,setError]=useState("");const [usageError,setUsageError]=useState("");const [usage,setUsage]=useState<AiUsageResult>(emptyAiUsage(30));
  const requestVersion=useRef(0);
  const refresh=useCallback(async(windowDays=days)=>{const version=++requestVersion.current;setLoading(true);setPaging(false);setError("");setUsageError("");setUsage(emptyAiUsage(windowDays));setEvents([]);setCounts({});setSampled(0);setTruncated(false);setCursor(null);setHasMore(false);const [activityResult,usageResult]=await Promise.allSettled([apiRequest<AnalyticsResult>(`/businesses/${businessId}/analytics?days=${windowDays}&limit=50`,accessToken),apiRequest<AiUsageResult>(`/businesses/${businessId}/ai-usage?days=${windowDays}`,accessToken)]);if(version!==requestVersion.current)return;if(activityResult.status==="fulfilled"){const data=activityResult.value;setEvents(data.events);setCounts(data.event_counts);setSampled(data.sampled_events);setTruncated(data.summary_truncated);setCursor(data.next_before_id);setHasMore(data.has_more);}else setError(activityResult.reason instanceof Error?activityResult.reason.message:"Analytics could not be loaded.");if(usageResult.status==="fulfilled")setUsage(usageResult.value);else setUsageError(usageResult.reason instanceof Error?usageResult.reason.message:"AI usage could not be loaded.");setLoading(false);},[accessToken,businessId,days]);
  useEffect(()=>{void refresh();return()=>{requestVersion.current+=1;};},[refresh]);
  async function loadOlder(){if(cursor===null)return;const version=requestVersion.current;const windowDays=days;setPaging(true);setError("");try{const data=await apiRequest<AnalyticsResult>(`/businesses/${businessId}/analytics?days=${windowDays}&limit=50&before_id=${cursor}`,accessToken);if(version!==requestVersion.current)return;setEvents(current=>[...current,...data.events]);setCursor(data.next_before_id);setHasMore(data.has_more);}catch(e){if(version===requestVersion.current)setError(e instanceof Error?e.message:"Older activity could not be loaded.");}finally{if(version===requestVersion.current)setPaging(false);}}
  return <section className="control-panel" aria-label="Analytics activity"><div className="panel-heading"><div><h2>Business activity analytics</h2><p>Event counts summarize the latest 500 saved business events in the selected window. Activity is ordered by event ID, newest first; this view does not infer revenue, conversation totals, or other source-table totals.</p></div><div className="record-actions"><label>Time window <select aria-label="Analytics time window" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label><button onClick={()=>void refresh()} disabled={loading}>Refresh</button></div></div>
    {error&&<p className="form-error" role="alert">{error}</p>}{loading?<p role="status">Loading business activity…</p>:<>
      <div className="record"><div><strong>AI usage and monthly budget</strong><small>{formatUsd(usage.budget.limit_usd)} monthly ceiling · {formatUsd(usage.budget.committed_usd)} committed · {formatUsd(usage.budget.remaining_usd)} remaining (UTC calendar month)</small><small>{formatUsd(usage.budget.pending_usd)} held for provider outcomes without confirmed usage</small><small>{usage.sampled_requests} model requests · {usage.source_messages} source {usage.source_messages===1?"message":"messages"}</small><small>{usage.total_tokens.toLocaleString()} tokens reported ({usage.prompt_tokens.toLocaleString()} input, {usage.completion_tokens.toLocaleString()} output)</small><small>{usage.unknown_usage_requests} requests without provider token counts{usage.summary_truncated?" · latest 5,000 requests shown":""}</small><small>Models: {Object.keys(usage.models).sort().join(", ")||"none recorded"} · Providers: {Object.keys(usage.providers).sort().join(", ")||"none recorded"}</small><small>Budget reservations use the pinned provider's live published rates with a conservative maximum-token estimate; the provider invoice may differ.</small></div></div>
      {Object.keys(usage.message_call_distribution).length>0&&<p className="quiet-note">Model calls per source message: {Object.entries(usage.message_call_distribution).sort(([a],[b])=>Number(a)-Number(b)).map(([calls,messages])=>`${messages} message${Number(messages)===1?"":"s"} with ${calls} call${Number(calls)===1?"":"s"}`).join(" · ")}</p>}
      {usageError&&<p className="quiet-note" role="alert">AI usage summary unavailable: {usageError}</p>}
      {Object.keys(usage.operations).length>0&&<div className="metrics" aria-label="AI usage by operation">{Object.entries(usage.operations).sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=><div key={name}><strong>{value.calls}</strong><small>{name} calls · {value.total_tokens.toLocaleString()} reported tokens</small></div>)}</div>}
      <div className="metrics"><div><strong>{sampled}{truncated?"+":""}</strong><small>Events counted in window{truncated?" (500 event cap)":""}</small></div>{Object.entries(counts).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=><div key={key}><strong>{value}</strong><small>{key}</small></div>)}</div>
      {truncated&&<p className="quiet-note" role="status">Counts are capped at 500 events. Narrow the time window for a complete count of the returned sample.</p>}
      {events.length===0?<p className="empty-copy">No business events were recorded in the last {days} days.</p>:<div className="record-list" aria-label="Recent business events">{events.map(item=><div className="record" key={item.id}><div><strong>{item.event_type}</strong><small>{item.entity_type} · {item.entity_id} · {new Date(item.created_at).toLocaleString()}</small><small>Event #{item.id}</small></div></div>)}</div>}
      {hasMore&&<div className="record-actions"><button onClick={()=>void loadOlder()} disabled={paging}>{paging?"Loading…":"Load older activity"}</button></div>}
    </>}
  </section>;
}

type OperationalRecord = Record<string, unknown>;
const operationalRoutes: Record<string,{path:string;collection?:string}> = {
  "Directory & Tools":{path:"directory/tools",collection:"tools"}, Channels:{path:"channels",collection:"events"},
  Entitlements:{path:"entitlements",collection:"entitlements"}, Verification:{path:"verification",collection:"decisions"},
  Settings:{path:"settings"},
};
function OperationalModulePage({module,accessToken,businessId}:{module:string;accessToken:string;businessId:string}) {
  const [rows,setRows]=useState<OperationalRecord[]>([]);
  const [summary,setSummary]=useState<OperationalRecord>({});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const route=operationalRoutes[module];
  const refresh=useCallback(async()=>{
    setLoading(true);setError("");
    try {
      const data=await apiRequest<Record<string,unknown>>(`/businesses/${businessId}/${route.path}`,accessToken);
      const values=route.collection?data[route.collection]:undefined;
      setRows(Array.isArray(values)?values as OperationalRecord[]:[]);
      setSummary(data);
    } catch(e) { setError(e instanceof Error?e.message:`${module} could not be loaded.`); }
    finally { setLoading(false); }
  },[accessToken,businessId,module,route]);
  useEffect(()=>{void refresh();},[refresh]);
  const settingsBusiness=summary.business as OperationalRecord|undefined;
  return <section className="control-panel" aria-label={`${module} workspace`}>
    <div className="panel-heading"><div><h2>{module}</h2><p>{module==="Directory & Tools"?"Available Layer 6 tools and their access rules.":module==="Channels"?"Recorded inbound channel event health. Provider setup and outbound delivery are not available here yet.":module==="Entitlements"?"Business-level access grants. No subscription tiers or prices are inferred.":module==="Verification"?"Layer 6 access decisions and verification outcomes recorded for this business.":module==="Analytics"?"Counts and recent activity derived from saved business events.":"Workspace identity and configuration status."}</p></div><button onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {loading?<p role="status">Loading {module.toLowerCase()}…</p>:<>
      {module==="Settings"&&settingsBusiness&&<><div className="record-list"><div className="record"><div><strong>{String(settingsBusiness.name||"Business")}</strong><small>Business ID: {String(settingsBusiness.id)}</small><small>Created: {String(settingsBusiness.created_at||"—")}</small><small>Updated: {String(settingsBusiness.updated_at||"—")}</small></div></div></div><p className="quiet-note">Workspace settings are read-only. Editable settings aren’t available because the API does not yet define a safe settings allowlist.</p></>}
      {module==="Verification"&&<p className="quiet-note">This is an audit history view. Field-level approval and reviewer history are not yet implemented, so this page does not change verification status.</p>}
      {rows.length===0?(module==="Settings"?null:<p className="empty-copy">{module==="Directory & Tools"?"No directory tools are currently registered.":module==="Channels"?"No inbound channel events have been recorded yet.":module==="Entitlements"?"No access grants are recorded for this business.":module==="Verification"?"No directory access decisions have been recorded yet.":"No business activity events have been recorded yet."}</p>):<div className="record-list">{rows.map((row,index)=><div className="record" key={String(row.id||row.entity_id||row.tool_id||index)}><div>{Object.entries(row).map(([key,value])=><small key={key}><strong>{key.replaceAll("_"," ")}: </strong>{value===null||value===undefined?"—":typeof value==="object"?JSON.stringify(value):String(value)}</small>)}</div></div>)}</div>}
    </>}
  </section>;
}
