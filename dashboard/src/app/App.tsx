import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { apiRequest, websocketUrl } from "../lib/api";
import { dashboardAuthConfigured, supabaseClient } from "../lib/supabase";

type Business = { business_id: string; name: string; role: string };
type Connection = { id: string; provider: string; display_name: string; status: string; credential_status: string; provider_account_id?: string | null; provider_username?: string | null; health_checked_at?: string | null; health_error_code?: string | null; safe_settings: Record<string, unknown> };
type Automation = { id: string; name: string; trigger_type: string; action_type: string; enabled: boolean };
type Handoff = { id: string; conversation_id: string; requested_by: string; assigned_to?: string | null; status: string; reason: string; requested_at: string; updated_at?: string };
type EventRecord = { id: number; event_type: string; entity_type: string; entity_id: string; payload: Record<string, unknown>; created_at: string };

const modules = [
  ["Overview", "Workspace"], ["Conversations", "Workspace"], ["Customers", "Workspace"], ["Requests", "Workspace"],
  ["Directory & Tools", "Operations"], ["Channels", "Operations"], ["Connections", "Operations"], ["Automations", "Operations"],
  ["Entitlements", "Operations"], ["Verification", "Operations"], ["Human Agents", "Operations"], ["Analytics", "Manage"], ["Settings", "Manage"],
] as const;
const descriptions: Record<string,string> = {
  Overview:"A clear view of conversations, requests, channels, handoffs, and automation health.",
  Conversations:"Review customer conversations with operational context alongside the chat.", Customers:"Customer profiles and history from Layer 5.",
  Requests:"Structured requests, missing information, and lifecycle status.", "Directory & Tools":"Curated directory data and Layer 6 access controls.",
  Channels:"Channel behavior and receiving, auto-reply, and handoff controls.", Connections:"External accounts, connection health, and provider lifecycle.",
  Automations:"Rules, schedules, execution history, retries, and failures.", Entitlements:"Business access grants consumed by Layer 6.",
  Verification:"Review unverified directory fields and record approval history.", "Human Agents":"Human availability, assignment, takeover, and return to automation.",
  Analytics:"Operational reporting across supported channels and workflows.", Settings:"Safe business configuration managed through the FayFort control plane.",
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
  if (!session) return <div className="auth-page"><section className="auth-card"><b className="brand-mark">F</b><label>FAYFORT CONTROL CENTER</label><h1>Sign in</h1><p>Use your FayFort account to open your business workspace.</p><form onSubmit={signIn}><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/>{authError&&<p className="form-error" role="alert">{authError}</p>}<button className="primary-button" disabled={signingIn}>{signingIn?"Signing inâ€¦":"Sign in"}</button></form></section></div>;
  return <DashboardWorkspace accessToken={session.access_token} signedInEmail={session.user.email||""} onSignOut={signOut} eventStreaming={import.meta.env.VITE_DASHBOARD_EVENTS_ENABLED !== "false"}/>;
}

function SetupScreen() {
  return <div className="auth-page"><section className="auth-card"><b className="brand-mark">F</b><label>FAYFORT CONTROL CENTER</label><h1>Dashboard setup needed</h1><p>Add the public Supabase project URL and anon key, plus the FayFort API address, to <code>dashboard/.env.local</code>, then restart the dashboard.</p><p className="quiet-note">The service-role key does not belong in the dashboard.</p></section></div>;
}

type WorkspaceProps = { accessToken: string; signedInEmail?: string; onSignOut?: () => void | Promise<void>; eventStreaming?: boolean };
export function DashboardWorkspace({ accessToken, signedInEmail, onSignOut, eventStreaming = true }: WorkspaceProps) {
  const [active, setActive] = useState("Overview");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [businessError, setBusinessError] = useState("");
  const [businessLoading, setBusinessLoading] = useState(true);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventStatus, setEventStatus] = useState("Connecting");
  const eventCursor = useRef(0);
  const currentBusiness = businesses.find(item=>item.business_id===businessId);

  const loadBusinesses = useCallback(async () => {
    setBusinessLoading(true);
    try {
      const data = await apiRequest<{businesses:Business[] }>("/dashboard/businesses", accessToken);
      setBusinesses(data.businesses);
      setBusinessError("");
      setBusinessId(previous => data.businesses.some(item=>item.business_id===previous) ? previous : data.businesses[0]?.business_id || "");
    } catch (error) {
      setBusinessError(error instanceof Error ? error.message : "Could not load business workspaces.");
    } finally {
      setBusinessLoading(false);
    }
  }, [accessToken]);
  useEffect(()=>{ void loadBusinesses(); },[loadBusinesses]);

  useEffect(()=>{
    if (!eventStreaming || !businessId) return;
    let alive = true;
    let socket: WebSocket | undefined;
    let retryTimer: number | undefined;
    const connect = async () => {
      try {
        const {ticket} = await apiRequest<{ticket:string}>(`/businesses/${businessId}/events/ticket`,accessToken,{method:"POST"});
        if (!alive) return;
        socket = new WebSocket(websocketUrl(`/businesses/${businessId}/events/ws`));
        socket.onopen = () => socket?.send(JSON.stringify({ticket,after_id:eventCursor.current}));
        socket.onmessage = message => {
          const packet = JSON.parse(message.data) as {type:string;event?:EventRecord};
          if (packet.type === "ready") setEventStatus("Live");
          if (packet.type === "event" && packet.event) {
            eventCursor.current = packet.event.id;
            setEvents(previous=>[packet.event!,...previous].slice(0,30));
          }
        };
        socket.onerror = () => setEventStatus("Reconnecting");
        socket.onclose = () => { if (alive) { setEventStatus("Reconnecting"); retryTimer=window.setTimeout(()=>void connect(),2000); } };
      } catch { if (alive) { setEventStatus("Offline"); retryTimer=window.setTimeout(()=>void connect(),5000); } }
    };
    void connect();
    return ()=>{ alive=false; if(retryTimer) window.clearTimeout(retryTimer); socket?.close(); };
  },[accessToken,businessId,eventStreaming]);

  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={() => setActive("Overview")}><b className="brand-mark">F</b><span><strong>FayFort</strong><small>CONTROL CENTER</small></span></a>
      {businessLoading?<div className="business-placeholder">Checking your business workspaces…</div>:businesses.length>0?<label className="business-picker"><span>BUSINESS WORKSPACE</span><select aria-label="Business workspace" value={businessId} onChange={e=>setBusinessId(e.target.value)}>{businesses.map(item=><option key={item.business_id} value={item.business_id}>{item.name} Â· {item.role}</option>)}</select></label>:<div className="business-placeholder">{businessError||"Loading business workspacesâ€¦"}</div>}
      <nav aria-label="Main navigation">{groups.map(group=><section key={group} aria-label={group}><h2>{group}</h2>{modules.filter(([,g])=>g===group).map(([label])=><button key={label} className={active===label?"nav-item active":"nav-item"} aria-current={active===label?"page":undefined} onClick={()=>setActive(label)}><span>{label.slice(0,1)}</span>{label}</button>)}</section>)}</nav>
      <footer><i className={eventStatus==="Live"?"event-dot live":"event-dot"}/> Events {eventStatus}<button className="signout-button" onClick={()=>void onSignOut?.()}>Sign out</button></footer>
    </aside>
    <main><header><span>{currentBusiness?.name||"FayFort workspace"} <em>/</em> {active}</span><small>DEVELOPMENT</small></header><article aria-live="polite">
      <div className="heading"><div><label>FAYFORT WORKSPACE</label><h1>{active}</h1><p>{descriptions[active]}</p></div><mark>Layer 7 build</mark></div>
      {businessLoading?<div className="empty" role="status"><b>…</b><h2>Loading your workspace</h2><p>Checking the signed-in account’s active business membership.</p></div>:businessError?<div className="notice error" role="alert">{businessError}<button onClick={()=>void loadBusinesses()}>Retry</button></div>:businesses.length===0?<div className="empty"><b>!</b><h2>No workspace is linked to this sign-in</h2><p>Your saved business data hasn’t been removed. Signed in as {signedInEmail||"an account without an active workspace"}. Check that this is the account linked to the business membership; otherwise sign in with the correct account or ask the owner to add this one.</p><div className="record-actions"><button onClick={()=>void loadBusinesses()}>Check again</button><button onClick={()=>void onSignOut?.()}>Sign out</button></div></div>:active==="Overview"?<Overview events={events} setActive={setActive}/>:active==="Connections"?<ConnectionsPage accessToken={accessToken} businessId={businessId} canManage={["owner","admin"].includes(currentBusiness?.role||"")}/>:active==="Automations"?<AutomationsPage accessToken={accessToken} businessId={businessId}/>:active==="Human Agents"?<HandoffsPage accessToken={accessToken} businessId={businessId}/>:(["Conversations","Customers","Requests"].includes(active)?<WorkspaceDataPage module={active} accessToken={accessToken} businessId={businessId} canManage={["owner","admin"].includes(currentBusiness?.role||"")}/>:active==="Directory & Tools"?<DirectoryToolsPage accessToken={accessToken} businessId={businessId}/>:active==="Entitlements"?<EntitlementsPage accessToken={accessToken} businessId={businessId}/>:active==="Verification"?<VerificationPage accessToken={accessToken} businessId={businessId}/>:active==="Settings"?<SettingsPage accessToken={accessToken} businessId={businessId} canManage={["owner","admin"].includes(currentBusiness?.role||"")}/>:active==="Channels"?<><ConnectionsPage accessToken={accessToken} businessId={businessId} canManage={["owner","admin"].includes(currentBusiness?.role||"")}/><OperationalModulePage module="Channels" accessToken={accessToken} businessId={businessId}/></>:active==="Analytics"?<OperationalModulePage module={active} accessToken={accessToken} businessId={businessId}/>:<div className="empty"><b>{active.slice(0,1)}</b><h2>{active} is being connected</h2><p>This module will become active when its FastAPI workflow and data access are ready.</p><button onClick={()=>setActive("Overview")}>Back to overview</button></div>)}
    </article></main>
  </div>;
}

function Overview({events,setActive}:{events:EventRecord[];setActive:(page:string)=>void}) {
  return <><div className="welcome"><label>CONTROL PLANE</label><h2>Your operations, in one place</h2><p>The dashboard is signing requests with your user session. FastAPI checks your active business membership before accessing business data.</p></div><h2 className="section-title">Workspace modules <small>Connected as they are built</small></h2><div className="cards">{modules.slice(1).map(([label])=><button key={label} onClick={()=>setActive(label)}><b>{label.slice(0,1)}</b><span><strong>{label}</strong><small>{descriptions[label]}</small></span><i>â†—</i></button>)}</div><h2 className="section-title">Recent activity <small>Live event stream</small></h2><div className="event-list" aria-label="Recent business activity">{events.length?events.slice(0,8).map(item=><div key={item.id}><strong>{item.event_type}</strong><small>{new Date(item.created_at).toLocaleString()}</small></div>):<p>Waiting for business events.</p>}</div></>;
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
  const refresh=useCallback(async()=>{setLoading(true);try{const data=await apiRequest<{connections:Connection[]}>(`/businesses/${businessId}/connections`,accessToken);setItems(data.connections);setError("");}catch(e){setError(e instanceof Error?e.message:"Connections could not be loaded.");}finally{setLoading(false);}},[accessToken,businessId]);
  useEffect(()=>{void refresh();},[refresh]);
  async function create(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{await apiRequest(`/businesses/${businessId}/connections`,accessToken,{method:"POST",body:JSON.stringify({provider,display_name:name,safe_settings:{inbound_enabled:true,outbound_enabled:false}})});setName("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Connection could not be created.");}finally{setBusy(false);}}
  async function saveInstagramCredentials(event:FormEvent,item:Connection){event.preventDefault();setBusy(true);setError("");try{await apiRequest(`/businesses/${businessId}/connections/${item.id}/credentials/instagram`,accessToken,{method:"PUT",body:JSON.stringify({app_id:appId,app_secret:appSecret,access_token:accessTokenValue})});setAppId("");setAppSecret("");setAccessTokenValue("");setEditingCredentials("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Instagram credentials could not be saved.");}finally{setBusy(false);}}
  async function verifyInstagram(item:Connection){setBusy(true);setError("");try{await apiRequest(`/businesses/${businessId}/connections/${item.id}/verify-instagram`,accessToken,{method:"POST"});await refresh();}catch(e){setError(e instanceof Error?e.message:"Instagram account could not be verified.");}finally{setBusy(false);}}
  function openCredentialEditor(item:Connection){setAppId("");setAppSecret("");setAccessTokenValue("");setEditingCredentials(editingCredentials===item.id?"":item.id);}
  async function transition(item:Connection,action:string){setBusy(true);setError("");try{await apiRequest(`/businesses/${businessId}/connections/${item.id}/${action}`,accessToken,{method:"POST"});await refresh();}catch(e){setError(e instanceof Error?e.message:"Connection status could not be updated.");}finally{setBusy(false);}}
  async function toggleInbound(item:Connection){setBusy(true);setError("");try{const enabled=item.safe_settings?.inbound_enabled!==true;await apiRequest(`/businesses/${businessId}/connections/${item.id}/settings`,accessToken,{method:"PATCH",body:JSON.stringify({safe_settings:{inbound_enabled:enabled}})});await refresh();}catch(e){setError(e instanceof Error?e.message:"Inbound setting could not be changed.");}finally{setBusy(false);}}
  async function toggleOutboundSetting(item:Connection,key:"outbound_enabled"|"auto_reply_enabled"){setBusy(true);setError("");try{const enabled=item.safe_settings?.[key]!==true;await apiRequest(`/businesses/${businessId}/connections/${item.id}/settings`,accessToken,{method:"PATCH",body:JSON.stringify({safe_settings:{[key]:enabled}})});await refresh();}catch(e){setError(e instanceof Error?e.message:"Outbound setting could not be changed.");}finally{setBusy(false);}}
  return <section className="control-panel" aria-label="Connection lifecycle"><div className="panel-heading"><div><h2>Channel connections</h2><p>Connect and verify provider accounts, then enable outbound delivery and automatic replies explicitly when ready. Both remain off by default.</p></div></div>{error&&<p className="form-error" role="alert">{error}</p>}<form className="inline-form" onSubmit={create}><label>Provider key<input required minLength={2} maxLength={64} value={provider} onChange={e=>setProvider(e.target.value)} placeholder="instagram"/></label><label>Display name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Instagram support"/></label><button className="primary-button" disabled={busy||!canManage}>Add connection</button></form>{!canManage&&<p className="quiet-note">Only a business owner or admin can change channel setup or credentials.</p>}{loading?<p>Loading connections...</p>:items.length===0?<p className="empty-copy">No saved channel connections yet.</p>:<div className="record-list">{items.map(item=><div className="record" key={item.id}><div><strong>{item.display_name}</strong><small>{item.provider} - {item.status} - credentials {item.credential_status}</small>{item.health_checked_at&&<small>Last provider check: {new Date(item.health_checked_at).toLocaleString()}</small>}{item.health_error_code&&<small>Health issue: {item.health_error_code.replaceAll("_"," ")}</small>}{item.provider_username&&<small>Verified Instagram account: @{item.provider_username}</small>}</div><div className="record-actions"><button disabled={busy||!canManage} onClick={()=>void toggleInbound(item)}>{item.safe_settings?.inbound_enabled===true?"Disable inbound":"Enable inbound"}</button><button type="button" disabled={busy||!canManage||item.provider!=="instagram"||item.status!=="connected"||item.credential_status!=="configured"} onClick={()=>void toggleOutboundSetting(item,"outbound_enabled")}>{item.safe_settings?.outbound_enabled===true?"Disable outbound":"Enable outbound"}</button>{item.safe_settings?.outbound_enabled===true&&<button type="button" disabled={busy||!canManage||item.status!=="connected"} onClick={()=>void toggleOutboundSetting(item,"auto_reply_enabled")}>{item.safe_settings?.auto_reply_enabled===true?"Disable auto-replies":"Enable auto-replies"}</button>}<small>Automatic replies send only when enabled and Instagram accepts the message in its reply window.</small>{item.provider==="instagram"&&<>{item.credential_status==="configured"&&<button type="button" disabled={busy||!canManage||["paused","disconnected"].includes(item.status)} onClick={()=>void verifyInstagram(item)}>Verify account</button>}<button type="button" disabled={busy||!canManage} onClick={()=>openCredentialEditor(item)}>{item.credential_status==="configured"?"Replace credentials":"Add credentials"}</button></>}{item.status!=="paused"&&item.status!=="disconnected"&&<button onClick={()=>void transition(item,"pause")}>Pause</button>}{["paused","disconnected","error"].includes(item.status)&&<button onClick={()=>void transition(item,"resume")}>Resume setup</button>}{item.status!=="disconnected"&&<button onClick={()=>void transition(item,"disconnect")}>Disconnect</button>}</div>{editingCredentials===item.id&&item.provider==="instagram"&&<form className="inline-form" onSubmit={event=>void saveInstagramCredentials(event,item)}><label>Instagram App ID<input required autoComplete="off" value={appId} onChange={e=>setAppId(e.target.value)}/></label><label>Instagram App Secret<input required type="password" autoComplete="new-password" value={appSecret} onChange={e=>setAppSecret(e.target.value)}/></label><label>Access Token<input required type="password" autoComplete="new-password" value={accessTokenValue} onChange={e=>setAccessTokenValue(e.target.value)}/></label><button className="primary-button" disabled={busy||!canManage}>{busy?"Saving...":"Save credentials"}</button><button type="button" disabled={busy} onClick={()=>openCredentialEditor(item)}>Cancel</button><small>Saving replaces the current token for this connection. Values are never displayed again.</small></form>}</div>)}</div>}</section>;
}

function AutomationsPage({accessToken,businessId}:{accessToken:string;businessId:string}) {
  const [items,setItems]=useState<Automation[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState(""); const [name,setName]=useState(""); const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{setLoading(true);try{const data=await apiRequest<{automations:Automation[]}>(`/businesses/${businessId}/automations`,accessToken);setItems(data.automations);setError("");}catch(e){setError(e instanceof Error?e.message:"Automations could not be loaded.");}finally{setLoading(false);}},[accessToken,businessId]);
  useEffect(()=>{void refresh();},[refresh]);
  async function create(event:FormEvent){event.preventDefault();setBusy(true);try{await apiRequest(`/businesses/${businessId}/automations`,accessToken,{method:"POST",body:JSON.stringify({name,trigger_type:"manual_test",action_type:"record_test_run",conditions:{}})});setName("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Automation could not be created.");}finally{setBusy(false);}}
  async function action(item:Automation,actionName:string){setBusy(true);try{if(actionName==="enable"||actionName==="disable")await apiRequest(`/businesses/${businessId}/automations/${item.id}`,accessToken,{method:"PATCH",body:JSON.stringify({enabled:actionName==="enable"})});else await apiRequest(`/businesses/${businessId}/automations/${item.id}/${actionName}`,accessToken,{method:"POST",body:JSON.stringify({idempotency_key:crypto.randomUUID()})});await refresh();}catch(e){setError(e instanceof Error?e.message:"Automation action failed.");}finally{setBusy(false);}}
  return <section className="control-panel" aria-label="Automation management"><div className="panel-heading"><div><h2>Safe automation test lab</h2><p>The available action only writes a run record. It does not send messages or change external systems.</p></div></div>{error&&<p className="form-error" role="alert">{error}</p>}<form className="inline-form" onSubmit={create}><label>Automation name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Manual smoke check"/></label><button className="primary-button" disabled={busy}>Create disabled test rule</button></form>{loading?<p>Loading automationsâ€¦</p>:items.length===0?<p className="empty-copy">No automations yet. New rules start disabled.</p>:<div className="record-list">{items.map(item=><div className="record" key={item.id}><div><strong>{item.name}</strong><small>{item.trigger_type} Â· {item.action_type} Â· {item.enabled?"enabled":"disabled"}</small></div><div className="record-actions">{item.enabled?<button disabled={busy} onClick={()=>void action(item,"disable")}>Disable</button>:<button disabled={busy} onClick={()=>void action(item,"enable")}>Enable</button>}<button disabled={busy} onClick={()=>void action(item,"dry-run")}>Dry run</button>{item.enabled&&<button disabled={busy} onClick={()=>void action(item,"execute")}>Execute test</button>}</div></div>)}</div>}<p className="quiet-note">Scheduling, retry policy, and automatic conversation-trigger evaluation are still being built.</p></section>;
}

function HandoffsPage({accessToken,businessId}:{accessToken:string;businessId:string}) {
 const [items,setItems]=useState<Handoff[]>([]);const [conversations,setConversations]=useState<ConversationRow[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [conversationId,setConversationId]=useState("");const [reason,setReason]=useState("customer_requested");const [busy,setBusy]=useState(false);const [reply,setReply]=useState<Record<string,string>>({});const [sourceFilter,setSourceFilter]=useState("all");
 const refresh=useCallback(async()=>{setLoading(true);try{const [d,c]=await Promise.all([apiRequest<{handoffs:Handoff[]}>(`/businesses/${businessId}/handoffs`,accessToken),apiRequest<{conversations:ConversationRow[]}>(`/businesses/${businessId}/conversations`,accessToken)]);setItems(d.handoffs);setConversations(c.conversations);setError("");}catch(e){setError(e instanceof Error?e.message:"Handoffs could not be loaded.");}finally{setLoading(false);}},[accessToken,businessId]);
 useEffect(()=>{void refresh();},[refresh]);
 async function request(event:FormEvent){event.preventDefault();setBusy(true);try{await apiRequest(`/businesses/${businessId}/handoffs?conversation_id=${encodeURIComponent(conversationId)}`,accessToken,{method:"POST",body:JSON.stringify({reason})});setConversationId("");await refresh();}catch(e){setError(e instanceof Error?e.message:"Handoff could not be requested.");}finally{setBusy(false);}}
 async function action(item:Handoff,path:string,body?:unknown){setBusy(true);try{await apiRequest(`/businesses/${businessId}/handoffs/${item.id}/${path}`,accessToken,{method:"POST",...(body?{body:JSON.stringify(body)}:{})});await refresh();}catch(e){setError(e instanceof Error?e.message:"Handoff action failed.");}finally{setBusy(false);}}
 const byId=new Map(conversations.map(c=>[c.id,c]));const source=(h:Handoff)=>byId.get(h.conversation_id)?.channel||byId.get(h.conversation_id)?.platform||"unknown";const sources=Array.from(new Set(items.map(source))).sort();const visible=items.filter(h=>sourceFilter==="all"||source(h)===sourceFilter);
 return <section className="control-panel" aria-label="Human handoff management"><div className="panel-heading"><div><h2>Human agent queue</h2><p>Use Conversations as the workspace for each chat. Assigned human replies use the connected provider when outbound delivery is enabled; delivery status appears in the conversation.</p></div></div>{error&&<p className="form-error" role="alert">{error}</p>}<form className="inline-form" onSubmit={request}><label>Conversation<select required value={conversationId} onChange={e=>setConversationId(e.target.value)}><option value="">Choose a conversation</option>{conversations.map(c=><option key={c.id} value={c.id}>{c.customer_name||c.customer_external_id||"Customer"} · {c.channel||c.platform||"Unknown source"} · {new Date(c.last_message_at||c.created_at).toLocaleString()}</option>)}</select></label><label>Reason<input maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="primary-button" disabled={busy||!conversationId}>Request human handoff</button></form><label className="queue-filter">Filter queue by source<select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)}><option value="all">All sources</option>{sources.map(x=><option key={x} value={x}>{x}</option>)}</select></label>{loading?<p>Loading handoffs…</p>:visible.length===0?<p className="empty-copy">{items.length?"No handoffs match this source filter.":"No handoffs recorded."}</p>:<div className="record-list">{visible.map(item=><div className="record handoff-record" key={item.id}><div><strong>{item.status} · {item.reason}</strong><small>{byId.get(item.conversation_id)?.customer_name||byId.get(item.conversation_id)?.customer_external_id||"Customer"} · {source(item)} · Requested {new Date(item.requested_at).toLocaleString()}</small><div className="record-actions">{["requested","assigned"].includes(item.status)&&<button disabled={busy} onClick={()=>void action(item,"take-over")}>Take over</button>}{item.status==="active"&&<><button disabled={busy} onClick={()=>void action(item,"return-to-automation")}>Return to automation</button><input aria-label={`Reply for ${item.id}`} value={reply[item.id]||""} onChange={e=>setReply(p=>({...p,[item.id]:e.target.value}))} placeholder="Human reply"/><button disabled={busy||!reply[item.id]?.trim()} onClick={()=>void action(item,"messages",{content:reply[item.id]})}>Send reply</button></>}</div></div></div>)}</div>}</section>;
}
type ConversationRow = { id: string; customer_external_id?: string | null; customer_name?: string | null; channel?: string | null; platform?: string | null; status: string; summary?: string | null; last_message_at?: string | null; created_at: string };
type CustomerRow = { id: string; channel: string; external_customer_id: string; profile: Record<string, unknown>; created_at: string; updated_at: string };
type RequestRow = { id: string; customer_id: string; conversation_id: string; request_type: string; status: string; details: Record<string, unknown>; required_information: string[]; missing_information: string[]; created_at: string; updated_at: string };
type MessageRow = { id: string; sender_type: string; content: string; created_at: string; delivery?: { id:string; status:string; attempt_count:number; provider_message_id?:string|null; safe_error_code?:string|null } | null };

function WorkspaceDataPage({module,accessToken,businessId,canManage=false}:{module:string;accessToken:string;businessId:string;canManage?:boolean}) {
  const [conversations,setConversations]=useState<ConversationRow[]>([]);
  const [customers,setCustomers]=useState<CustomerRow[]>([]);
  const [requests,setRequests]=useState<RequestRow[]>([]);
  const [selected,setSelected]=useState<ConversationRow|null>(null);
  const [messages,setMessages]=useState<MessageRow[]>([]);
  const [handoff,setHandoff]=useState<Handoff|null>(null);
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
    setLoading(true);setError("");
    try {
      if(module==="Conversations") { const data=await apiRequest<{conversations:ConversationRow[]}>(`/businesses/${businessId}/conversations`,accessToken);setConversations(data.conversations); }
      else if(module==="Customers") { const data=await apiRequest<{customers:CustomerRow[]}>(`/businesses/${businessId}/customers`,accessToken);setCustomers(data.customers); }
      else { const data=await apiRequest<{requests:RequestRow[]}>(`/businesses/${businessId}/requests`,accessToken);setRequests(data.requests); }
    } catch(e) { setError(e instanceof Error?e.message:`${module} could not be loaded.`); }
    finally { setLoading(false); }
  },[accessToken,businessId,module]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{if(!handoff||!["requested","assigned"].includes(handoff.status))return;const timer=window.setInterval(()=>setClockNow(Date.now()),1000);return()=>window.clearInterval(timer);},[handoff]);
  async function updateRequestStatus(item:RequestRow,status:string) {
    setRequestBusy(item.id);setError("");
    try { await apiRequest(`/businesses/${businessId}/requests/${item.id}`,accessToken,{method:"PATCH",body:JSON.stringify({status})}); await refresh(); }
    catch(e) { setError(e instanceof Error?e.message:"Request status could not be changed."); }
    finally { setRequestBusy(""); }
  }
  async function openConversation(item:ConversationRow) {
    setSelected(item);setDetailLoading(true);setDetailError("");
    try { const [data,hd]=await Promise.all([apiRequest<{messages:MessageRow[]}>(`/businesses/${businessId}/conversations/${item.id}/messages`,accessToken),apiRequest<{handoffs:Handoff[]}>(`/businesses/${businessId}/handoffs`,accessToken)]);setMessages(data.messages);setHandoffs(hd.handoffs);setHandoff(hd.handoffs.find(h=>h.conversation_id===item.id&&["requested","assigned","active"].includes(h.status))||null); }
    catch(e) { setDetailError(e instanceof Error?e.message:"Conversation details could not be loaded.");setMessages([]);setHandoff(null); }
    finally { setDetailLoading(false); }
  }
  async function retryDelivery(message:MessageRow){if(!selected||!message.delivery)return;setRetryBusy(message.id);setDetailError("");try{await apiRequest("/businesses/"+businessId+"/channel-deliveries/"+message.delivery.id+"/retry",accessToken,{method:"POST"});await openConversation(selected);}catch(e){setDetailError(e instanceof Error?e.message:"Delivery retry could not be completed.");}finally{setRetryBusy("");}}
  async function requestHumanHandoff(){if(!selected)return;setHandoffBusy(true);setDetailError("");try{const d=await apiRequest<{handoff:Handoff}>(`/businesses/${businessId}/handoffs?conversation_id=${encodeURIComponent(selected.id)}`,accessToken,{method:"POST",body:JSON.stringify({reason:"customer_requested"})});setHandoff(d.handoff);setHandoffs(p=>[d.handoff,...p]);}catch(e){setDetailError(e instanceof Error?e.message:"Human handoff could not be requested.");}finally{setHandoffBusy(false);}}
  const queue=[...handoffs].filter(h=>h.status==="requested").sort((a,b)=>Date.parse(a.requested_at)-Date.parse(b.requested_at));const position=handoff?.status==="requested"?queue.findIndex(h=>h.id===handoff.id)+1:0;const timerEnd=handoff?.status==="active"&&handoff.updated_at?Date.parse(handoff.updated_at):clockNow;const seconds=handoff?Math.max(0,Math.floor((timerEnd-Date.parse(handoff.requested_at))/1000)):0;const timer=`${String(Math.floor(seconds/3600)).padStart(2,"0")}:${String(Math.floor(seconds%3600/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
  return <section className="control-panel" aria-label={`${module} workspace`}>
    <div className="panel-heading"><div><h2>{module}</h2><p>{module==="Conversations"?"Business conversations and their recorded message history.":module==="Customers"?"Customer profiles and channels seen by this business.":"Structured customer requests, missing information, and current status."}</p></div><button onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {loading?<p role="status">Loading {module.toLowerCase()}â€¦</p>:module==="Conversations"?(conversations.length===0?<p className="empty-copy">No conversations have been recorded for this business.</p>:<div className="workspace-split"><div className="record-list">{conversations.map(item=><button className={selected?.id===item.id?"record selected-record":"record"} key={item.id} onClick={()=>void openConversation(item)}><span><strong>{item.customer_name||item.customer_external_id||"Customer"}</strong><small>{item.channel||item.platform||"Unknown channel"} Â· {item.status} Â· {new Date(item.last_message_at||item.created_at).toLocaleString()}</small>{item.summary&&<small>{item.summary}</small>}</span></button>)}</div><div className="message-panel">{!selected?<p className="empty-copy">Select a conversation to view its messages.</p>:<><h3>Conversation messages</h3><p className="quiet-note">{selected.customer_name||selected.customer_external_id||selected.id}</p>{detailError&&<p className="form-error" role="alert">{detailError}</p>}{!detailLoading&&module==="Conversations"&&<div className={handoff?"handoff-status":"handoff-start"}>{handoff?<><strong>Human handoff · {handoff.status.replaceAll("_"," ")}</strong><span>{handoff.status==="active"?"Wait to takeover ":"Waiting "}{timer}{position?` · FIFO position ${position}`:""}{handoff.assigned_to?` · assigned to ${handoff.assigned_to}`:""}</span><small>Timer shows elapsed wait. A response-time estimate needs agent availability and handling-time data.</small></>:<><span>No human takeover requested.</span><button disabled={handoffBusy} onClick={()=>void requestHumanHandoff()}>{handoffBusy?"Requesting…":"Request human takeover"}</button></>}</div>}{detailLoading?<p role="status">Loading messagesâ€¦</p>:messages.length===0?<p className="empty-copy">No messages recorded in this conversation.</p>:<div className="message-list">{messages.map(message=><article className="message-item" key={message.id}><strong>{message.sender_type}</strong><p>{message.content}</p><small>{new Date(message.created_at).toLocaleString()}</small>{canManage&&message.delivery?.status==="rejected"&&message.delivery.safe_error_code!=="response_window_expired"&&<button type="button" disabled={retryBusy===message.id} onClick={()=>void retryDelivery(message)}>{retryBusy===message.id?"Retrying...":"Retry rejected delivery"}</button>}{message.delivery&&<small>Delivery: {message.delivery.status.replaceAll("_"," ")}{message.delivery.safe_error_code?` · ${message.delivery.safe_error_code.replaceAll("_"," ")}`:""}</small>}</article>)}</div>}</>}</div></div>):module==="Customers"?(customers.length===0?<p className="empty-copy">No customer profiles have been recorded for this business.</p>:<div className="record-list">{customers.map(item=><div className="record" key={item.id}><div><strong>{String(item.profile?.name||item.profile?.full_name||item.external_customer_id)}</strong><small>{item.channel} Â· Customer ID {item.external_customer_id} Â· Updated {new Date(item.updated_at).toLocaleString()}</small><small>{Object.keys(item.profile||{}).length?JSON.stringify(item.profile):"No additional profile details."}</small></div></div>)}</div>):(requests.length===0?<p className="empty-copy">No structured requests have been recorded for this business.</p>:<div className="record-list">{requests.map(item=><div className="record" key={item.id}><div><strong>{item.request_type} Â· {item.status}</strong><small>Request {item.id} Â· Conversation {item.conversation_id}</small><small>Missing: {item.missing_information?.length?item.missing_information.join(", "):"None"}</small><small>Details: {JSON.stringify(item.details||{})}</small>{!["completed","cancelled","superseded"].includes(item.status)&&<div className="record-actions"><select aria-label={`Next status for request ${item.id}`} defaultValue="" onChange={e=>{if(e.target.value)void updateRequestStatus(item,e.target.value)}} disabled={requestBusy===item.id}><option value="">Update status…</option>{(item.status==="active"?["awaiting_customer","completed","cancelled"]:["active","completed","cancelled"]).map(status=><option key={status} value={status}>{status.replaceAll("_"," ")}</option>)}</select>{requestBusy===item.id&&<small>Saving…</small>}</div>}</div></div>)}</div>)}
  </section>;
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
    {loading?<p role="status">Loading directory tools and conversations…</p>:<>
      {!tools.length?<p className="empty-copy">No active directory tools are currently registered.</p>:!conversations.length?<p className="empty-copy">Record a conversation first to provide an auditable search context.</p>:<form className="inline-form directory-search-form" onSubmit={search}>
        <label>Directory tool<select required value={toolId} onChange={e=>setToolId(e.target.value)}>{tools.map(item=><option key={item.tool_id} value={item.tool_id}>{item.tool_id} · {item.family}</option>)}</select></label>
        <label>Conversation<select required value={conversationId} onChange={e=>setConversationId(e.target.value)}>{conversations.map(item=><option key={item.id} value={item.id}>{item.customer_name||item.customer_external_id||"Customer"} · {item.channel||item.platform||"channel"} · {item.id}</option>)}</select></label>
        <label>Search query<input required minLength={1} maxLength={1000} value={query} onChange={e=>setQuery(e.target.value)} placeholder="What should FayFort look up?"/></label>
        <button className="primary-button" disabled={busy||!toolId||!conversationId}>{busy?"Checking access…":"Search directory"}</button>
      </form>}
      {tools.length>0&&<div className="record-list directory-tool-list">{tools.map(item=><div className="record" key={item.tool_id}><div><strong>{item.tool_id} · {item.family}</strong><small>{item.description}</small><small>Verification policy: {item.verification_policy}</small></div></div>)}</div>}
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
  return <section className="control-panel" aria-label="Business entitlements"><div className="panel-heading"><div><h2>Business access grants</h2><p>Manual grants are recorded with a reason and appear in the activity feed. This does not represent a subscription or payment.</p></div><button onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>{error&&<p className="form-error" role="alert">{error}</p>}{canManage?<form className="inline-form" onSubmit={grant}><label>Tool<select required value={toolId} onChange={e=>setToolId(e.target.value)}>{tools.map(t=><option key={t.tool_id} value={t.tool_id}>{t.tool_id}</option>)}</select></label><label>Access level<select value={accessLevel} onChange={e=>setAccessLevel(e.target.value)}><option value="registered">Registered</option><option value="premium">Premium</option></select></label><label>Reason for manual grant<input required minLength={5} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Approved by business owner"/></label><label>Optional expiry<input type="datetime-local" value={expiresAt} onChange={e=>setExpiresAt(e.target.value)}/></label><button className="primary-button" disabled={busy||!toolId}>{busy?"Saving…":"Grant access"}</button></form>:<p className="quiet-note">Only a FayFort platform administrator can manage access grants.</p>}{loading?<p>Loading grants…</p>:rows.length===0?<p className="empty-copy">No access grants are recorded for this business.</p>:<div className="record-list">{rows.map(row=><div className="record" key={row.id}><div><strong>{row.tool_id} · {row.access_level} · {row.status}</strong><small>Source: {row.entitlement_source||"—"} · Starts: {row.starts_at||"—"} · Expires: {row.expires_at||"Never"}</small>{row.source_reference&&<small>Reason: {row.source_reference}</small>}</div>{canManage&&row.status==="active"&&<button disabled={busy} onClick={()=>void revoke(row)}>Revoke</button>}</div>)}</div>}</section>;
}

type VerificationQueueRow = {source_type:string;tool_id:string;record_id:string;verification_status:string;label:string};
type VerificationDecisionRow = {id:string;tool_id:string;outcome:string;verification_state?:string;reason_code?:string;created_at:string};
function VerificationPage({accessToken,businessId}:{accessToken:string;businessId:string}) {
  const [queue,setQueue]=useState<VerificationQueueRow[]>([]);const [canManage,setCanManage]=useState(false);const [decisions,setDecisions]=useState<VerificationDecisionRow[]>([]);const [statuses,setStatuses]=useState<Record<string,string>>({});const [reasons,setReasons]=useState<Record<string,string>>({});const [loading,setLoading]=useState(true);const [busy,setBusy]=useState("");const [error,setError]=useState("");
  const refresh=useCallback(async()=>{setLoading(true);try{const data=await apiRequest<{review_queue:VerificationQueueRow[];decisions:VerificationDecisionRow[];can_review:boolean}>(`/businesses/${businessId}/verification`,accessToken);setCanManage(data.can_review);setQueue(data.review_queue);setDecisions(data.decisions);setError("");}catch(e){setError(e instanceof Error?e.message:"Verification history could not be loaded.");}finally{setLoading(false);}},[accessToken,businessId]);
  useEffect(()=>{void refresh();},[refresh]);
  async function review(item:VerificationQueueRow){setBusy(item.record_id);setError("");try{await apiRequest(`/businesses/${businessId}/verification/${item.source_type}/${item.record_id}`,accessToken,{method:"POST",body:JSON.stringify({verification_status:statuses[item.record_id]||"verified",reason:reasons[item.record_id]?.trim()||"Reviewed against the source record."})});await refresh();}catch(e){setError(e instanceof Error?e.message:"Review could not be saved.");}finally{setBusy("");}}
  return <section className="control-panel" aria-label="Directory verification review"><div className="panel-heading"><div><h2>Directory verification</h2><p>Review individual imported records. Your choice and reason are stored in an audit trail and affect which tool results can be returned.</p></div><button onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>{error&&<p className="form-error" role="alert">{error}</p>}{!canManage&&<p className="quiet-note">Only a FayFort platform administrator can change the shared directory verification status.</p>}{loading?<p>Loading review queue…</p>:queue.length===0?<p className="empty-copy">No unverified or conflicting directory records are waiting for review.</p>:<div className="record-list">{queue.map(item=><div className="record verification-record" key={`${item.source_type}-${item.record_id}`}><div><strong>{item.label||item.record_id}</strong><small>{item.tool_id} · {item.source_type.replaceAll("_"," ")} · Current status: {item.verification_status}</small>{canManage&&<div className="record-actions"><select aria-label={`Verification decision for ${item.record_id}`} value={statuses[item.record_id]||"verified"} onChange={e=>setStatuses(previous=>({...previous,[item.record_id]:e.target.value}))}><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="conflicting">Conflicting</option><option value="unknown">Unknown</option></select><input aria-label={`Review reason for ${item.record_id}`} minLength={8} maxLength={500} value={reasons[item.record_id]||""} onChange={e=>setReasons(previous=>({...previous,[item.record_id]:e.target.value}))} placeholder="Why is this status supported?"/><button disabled={busy===item.record_id||((reasons[item.record_id]||"").trim().length<8)} onClick={()=>void review(item)}>{busy===item.record_id?"Saving…":"Save review"}</button></div>}</div></div>)}</div>}<h3 className="section-title">Recent access decisions</h3>{decisions.length===0?<p className="empty-copy">No directory access decisions recorded yet.</p>:<div className="record-list">{decisions.map(item=><div className="record" key={item.id}><div><strong>{item.tool_id} · {item.outcome}</strong><small>Verification: {item.verification_state||"not required"} · {item.reason_code||"—"} · {new Date(item.created_at).toLocaleString()}</small></div></div>)}</div>}</section>;
}

function SettingsPage({accessToken,businessId,canManage}:{accessToken:string;businessId:string;canManage:boolean}) {
  const [name,setName]=useState("");const [description,setDescription]=useState("");const [createdAt,setCreatedAt]=useState("");const [updatedAt,setUpdatedAt]=useState("");const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [saved,setSaved]=useState(false);
  const refresh=useCallback(async()=>{setLoading(true);try{const data=await apiRequest<{business:{name:string;description?:string|null;created_at:string;updated_at:string}}>(`/businesses/${businessId}/settings`,accessToken);setName(data.business.name);setDescription(data.business.description||"");setCreatedAt(data.business.created_at);setUpdatedAt(data.business.updated_at);setError("");}catch(e){setError(e instanceof Error?e.message:"Workspace settings could not be loaded.");}finally{setLoading(false);}},[accessToken,businessId]);
  useEffect(()=>{void refresh();},[refresh]);
  async function save(event:FormEvent){event.preventDefault();setBusy(true);setError("");setSaved(false);try{await apiRequest(`/businesses/${businessId}/settings`,accessToken,{method:"PATCH",body:JSON.stringify({name:name.trim(),description:description.trim()||null})});setSaved(true);await refresh();}catch(e){setError(e instanceof Error?e.message:"Settings could not be saved.");}finally{setBusy(false);}}
  return <section className="control-panel" aria-label="Business settings"><div className="panel-heading"><div><h2>Workspace settings</h2><p>Edit the business display name and description. Higher-risk operational settings are not exposed until their behavior is defined.</p></div><button onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>{error&&<p className="form-error" role="alert">{error}</p>}{saved&&<p className="success-note" role="status">Settings saved.</p>}{loading?<p>Loading workspace details…</p>:<><form className="settings-form" onSubmit={save}><label>Business name<input required minLength={1} maxLength={120} value={name} onChange={e=>setName(e.target.value)} disabled={!canManage}/></label><label>Description<textarea maxLength={500} rows={4} value={description} onChange={e=>setDescription(e.target.value)} disabled={!canManage}/></label>{canManage?<button className="primary-button" disabled={busy}>{busy?"Saving…":"Save settings"}</button>:<p className="quiet-note">Only a business owner or admin can edit workspace settings.</p>}</form><div className="record-list"><div className="record"><div><small>Business ID: {businessId}</small><small>Created: {createdAt}</small><small>Updated: {updatedAt}</small></div></div></div></>}</section>;
}

type OperationalRecord = Record<string, unknown>;
const operationalRoutes: Record<string,{path:string;collection?:string}> = {
  "Directory & Tools":{path:"directory/tools",collection:"tools"}, Channels:{path:"channels",collection:"events"},
  Entitlements:{path:"entitlements",collection:"entitlements"}, Verification:{path:"verification",collection:"decisions"},
  Analytics:{path:"analytics",collection:"events"}, Settings:{path:"settings"},
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
    {loading?<p role="status">Loading {module.toLowerCase()}â€¦</p>:<>
      {module==="Analytics"&&<div className="metrics"><div><strong>{String(summary.total_events??0)}</strong><small>Saved events in latest 500</small></div>{Object.entries((summary.event_counts||{}) as Record<string,unknown>).map(([key,value])=><div key={key}><strong>{String(value)}</strong><small>{key}</small></div>)}</div>}
      {module==="Settings"&&settingsBusiness&&<><div className="record-list"><div className="record"><div><strong>{String(settingsBusiness.name||"Business")}</strong><small>Business ID: {String(settingsBusiness.id)}</small><small>Created: {String(settingsBusiness.created_at||"â€”")}</small><small>Updated: {String(settingsBusiness.updated_at||"â€”")}</small></div></div></div><p className="quiet-note">Workspace settings are read-only. Editable settings arenâ€™t available because the API does not yet define a safe settings allowlist.</p></>}
      {module==="Verification"&&<p className="quiet-note">This is an audit history view. Field-level approval and reviewer history are not yet implemented, so this page does not change verification status.</p>}
      {rows.length===0?(module==="Settings"?null:<p className="empty-copy">{module==="Directory & Tools"?"No directory tools are currently registered.":module==="Channels"?"No inbound channel events have been recorded yet.":module==="Entitlements"?"No access grants are recorded for this business.":module==="Verification"?"No directory access decisions have been recorded yet.":"No business activity events have been recorded yet."}</p>):<div className="record-list">{rows.map((row,index)=><div className="record" key={String(row.id||row.entity_id||row.tool_id||index)}><div>{Object.entries(row).map(([key,value])=><small key={key}><strong>{key.replaceAll("_"," ")}: </strong>{value===null||value===undefined?"â€”":typeof value==="object"?JSON.stringify(value):String(value)}</small>)}</div></div>)}</div>}
    </>}
  </section>;
}
