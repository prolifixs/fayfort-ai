import { cleanup,fireEvent,render,screen,waitFor,within } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { App,DashboardWorkspace,WorkerInvitationAcceptancePage,WorkerPasswordResetPage,WorkerProvisioningPage } from "./App";

const authMocks=vi.hoisted(()=>({updateUser:vi.fn(),getSession:vi.fn(),onAuthStateChange:vi.fn()}));
vi.mock("../lib/supabase",()=>({dashboardAuthConfigured:true,supabaseClient:{auth:{updateUser:authMocks.updateUser,getSession:authMocks.getSession,onAuthStateChange:authMocks.onAuthStateChange}}}));

afterEach(()=>{cleanup();window.history.replaceState({},"","/");});
const business = { business_id:"business-1", name:"FayFort Test Workspace", role:"owner" };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(()=>{
  authMocks.updateUser.mockReset();
  authMocks.getSession.mockResolvedValue({data:{session:{access_token:"worker-recovery-token",user:{email:"member@example.com"}}},error:null});
  authMocks.onAuthStateChange.mockReturnValue({data:{subscription:{unsubscribe:vi.fn()}}});
  fetchMock=vi.fn(async (input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    let data:unknown={};
    if(url.endsWith("/dashboard/businesses")) data={businesses:[business]};
    else if(url.endsWith("/connections")) data={connections:[]};
    else if(url.endsWith("/automations")) data={automations:[]};
    else if(url.endsWith("/faqs")) data={faqs:[]};
    else if(url.includes("/ai-usage?")) data={days:30,sampled_requests:0,summary_truncated:false,reported_usage_requests:0,unknown_usage_requests:0,prompt_tokens:0,completion_tokens:0,total_tokens:0,source_messages:0,message_call_distribution:{},operations:{},models:{},providers:{},budget:{limit_usd:25,committed_usd:0,pending_usd:0,remaining_usd:25,month_start:"2026-10-01T00:00:00Z"}};
    else if(url.includes("/handoffs?status=waiting")) data={total:0};
    else if(url.includes("/handoffs?")) data={handoffs:[],total:0,has_more:false};
    else if(url.endsWith("/handoffs")) data={handoffs:[]};
    else if(url.includes("/conversations?")||url.endsWith("/conversations")) data={conversations:[],has_more:false};
    else if(url.includes("/events")) data={ticket:"ticket",expires_at:"2099-01-01T00:00:00Z"};
    else data={};
    return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;
  });
  vi.stubGlobal("fetch",fetchMock);
});
afterEach(()=>vi.unstubAllGlobals());
const renderWorkspace=()=>render(<DashboardWorkspace accessToken="test-access-token" eventStreaming={false}/>);

describe("authenticated dashboard workspace",()=>{
 it("shows an empty giveaways placeholder to platform staff without campaign controls",async()=>{
  render(<DashboardWorkspace accessToken="test-access-token" platformAdmin eventStreaming={false}/>);
  const nav=screen.getByRole("navigation",{name:"Main navigation"});
  fireEvent.click(within(nav).getByRole("button",{name:/Giveaways/}));
  expect(await screen.findByRole("region",{name:"Giveaways workspace"})).toBeInTheDocument();
  expect(screen.getByRole("heading",{name:"No giveaways yet"})).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:/upload|campaign|create giveaway/i})).not.toBeInTheDocument();
 });

 it("lets an active FayFort worker open Giveaways without a business workspace",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   const url=String(input);
   if(url.endsWith("/workers/me"))return {ok:true,status:200,json:async()=>({worker:{status:"active"}}),headers:new Headers()} as Response;
   if(url.endsWith("/dashboard/businesses"))return {ok:true,status:200,json:async()=>({businesses:[]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  renderWorkspace();
  const nav=screen.getByRole("navigation",{name:"Main navigation"});
  fireEvent.click(await within(nav).findByRole("button",{name:/Giveaways/}));
  expect(await screen.findByRole("region",{name:"Giveaways workspace"})).toBeInTheDocument();
 });

 it("routes a Supabase recovery callback to the password form",async()=>{
  window.history.replaceState({},"","/worker/accept?type=recovery");
  render(<App/>);
  expect(await screen.findByRole("heading",{name:"Set your password"})).toBeInTheDocument();
 });

 it("shows the verified member profile, points, and tier without client-side tier controls",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   if(String(input).endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1",display_name:"Jordan Member",points_balance:250,rank_level:3,subrank:4}}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/account");
  render(<App/>);
  expect(await screen.findByRole("region",{name:"Member profile"})).toBeInTheDocument();
  expect(screen.getByText("Jordan Member")).toBeInTheDocument();
  expect(screen.getByText("member@example.com")).toBeInTheDocument();
  expect(await screen.findByRole("region",{name:"Member rewards and tier"})).toBeInTheDocument();
  expect(screen.getByText("250")).toBeInTheDocument();
  expect(screen.getByText("Rank 3 · Subrank 4")).toBeInTheDocument();
  expect(screen.getByText(/points are not earned or spent yet/)).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([input,init])=>String(input).endsWith("/members/me")&&init?.method&&init.method!=="GET")).toBe(false);
 });

 it("browses active member products and saves/removes them through the member API",async()=>{
  let isSaved=false;
  const product={id:"product-1",name:"Sample widget",category_ref:"cat-1",description:"Catalog item",availability_status:"available",media_url:"https://cdn.example.test/widget.jpg",media_type:"image",media_source:"url"};
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1"}}),headers:new Headers()} as Response;
   if(url.includes("/members/products/")){
    if(init?.method==="POST")isSaved=true;
    if(init?.method==="DELETE")isSaved=false;
    return {ok:true,status:200,json:async()=>({product_id:"product-1",saved:isSaved}),headers:new Headers()} as Response;
   }
   if(url.includes("/members/products"))return {ok:true,status:200,json:async()=>({products:[product],saved_product_ids:isSaved?["product-1"]:[],categories:[{source_ref:"cat-1",category:"Tools",product_type:"Widget"}]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/products");
  render(<App/>);
  expect(await screen.findByRole("region",{name:"Available products"})).toBeInTheDocument();
  expect(screen.getByRole("heading",{name:"Sample widget"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Save product"}));
  expect(await screen.findByRole("button",{name:"Remove saved product"})).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([input,init])=>String(input).includes("/members/products/product-1/saved")&&init?.method==="POST")).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Remove saved product"}));
  expect(await screen.findByRole("button",{name:"Save product"})).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([input,init])=>String(input).includes("/members/products/product-1/saved")&&init?.method==="DELETE")).toBe(true);
 });

 it("requires matching password confirmation before updating worker credentials",async()=>{
  render(<WorkerPasswordResetPage/>);
  fireEvent.change(screen.getByLabelText("New password"),{target:{value:"first-password-123"}});
  fireEvent.change(screen.getByLabelText("Confirm password"),{target:{value:"different-password-123"}});
  fireEvent.click(screen.getByRole("button",{name:"Update password"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("The passwords do not match.");
  expect(authMocks.updateUser).not.toHaveBeenCalled();
 });

 it("updates the password through Supabase Auth and confirms completion",async()=>{
  authMocks.updateUser.mockResolvedValue({error:null});
  render(<WorkerPasswordResetPage/>);
  fireEvent.change(screen.getByLabelText("New password"),{target:{value:"new-worker-password-123"}});
  fireEvent.change(screen.getByLabelText("Confirm password"),{target:{value:"new-worker-password-123"}});
  fireEvent.click(screen.getByRole("button",{name:"Update password"}));
  expect(await screen.findByRole("status")).toHaveTextContent("Your password has been updated");
  expect(authMocks.updateUser).toHaveBeenCalledWith({password:"new-worker-password-123"});
 });

 it("shows Supabase recovery errors without claiming the password changed",async()=>{
  authMocks.updateUser.mockResolvedValue({error:new Error("Recovery link expired.")});
  render(<WorkerPasswordResetPage/>);
  fireEvent.change(screen.getByLabelText("New password"),{target:{value:"new-worker-password-123"}});
  fireEvent.change(screen.getByLabelText("Confirm password"),{target:{value:"new-worker-password-123"}});
  fireEvent.click(screen.getByRole("button",{name:"Update password"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Recovery link expired.");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
 });

 it("shows worker invitation acceptance only after the worker API confirms active status",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   if(String(input).endsWith("/workers/me"))return {ok:true,status:200,json:async()=>({worker:{status:"active"}}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  render(<WorkerInvitationAcceptancePage accessToken="worker-token"/>);
  expect(await screen.findByRole("heading",{name:"Invitation accepted"})).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("verified and active");
  expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/workers\/me$/),expect.objectContaining({headers:expect.objectContaining({Authorization:"Bearer worker-token"})}));
 });

 it("explains worker status lookup failures and lets the worker retry",async()=>{
  let attempts=0;
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   if(String(input).endsWith("/workers/me")){
    attempts++;
    if(attempts===1)throw new TypeError("Failed to fetch");
    return {ok:true,status:200,json:async()=>({worker:{status:"active"}}),headers:new Headers()} as Response;
   }
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  render(<WorkerInvitationAcceptancePage accessToken="worker-token"/>);
  expect(await screen.findByRole("heading",{name:"Unable to confirm worker account"})).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Failed to fetch");
  fireEvent.click(screen.getByRole("button",{name:"Retry"}));
  expect(await screen.findByRole("heading",{name:"Invitation accepted"})).toBeInTheDocument();
 });

 it("allows the platform worker invitation workflow through its protected API",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   if(String(input).endsWith("/platform/workers"))return {ok:true,status:201,json:async()=>({worker:{email:"worker@example.com",status:"invited"}}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  render(<WorkerProvisioningPage accessToken="platform-admin-token"/>);
  fireEvent.change(screen.getByLabelText("Worker email"),{target:{value:"worker@example.com"}});
  fireEvent.click(screen.getByRole("button",{name:"Invite worker"}));
  expect(await screen.findByRole("status")).toHaveTextContent("Invitation sent to worker@example.com. Worker status: invited.");
  const request=fetchMock.mock.calls.find(([input])=>String(input).endsWith("/platform/workers"));
  expect(request?.[1]?.method).toBe("POST");
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({email:"worker@example.com"});
  expect(new Headers(request?.[1]?.headers).get("Authorization")).toBe("Bearer platform-admin-token");
 });
 it("offers reauthentication when the business list rejects an expired session",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   if(String(input).endsWith("/dashboard/businesses"))return {ok:false,status:401,json:async()=>({detail:"A valid signed-in user is required."}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  const onSignOut=vi.fn();
  render(<DashboardWorkspace accessToken="expired-token" onSignOut={onSignOut} eventStreaming={false}/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Your sign-in session could not be verified. Sign out, then sign in again to reconnect this workspace.");
  fireEvent.click(screen.getByRole("button",{name:"Sign out and sign in again"}));
  expect(onSignOut).toHaveBeenCalledOnce();
  expect(screen.getByRole("button",{name:"Retry"})).toBeInTheDocument();
 });
 it("surfaces a bounded API timeout with a retry action instead of loading forever",async()=>{
  fetchMock.mockRejectedValue(new DOMException("The operation timed out","TimeoutError"));
  renderWorkspace();
  expect(await screen.findByRole("alert")).toHaveTextContent("FayFort API did not respond within 20 seconds.");
  expect(screen.getByRole("button",{name:"Retry"})).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Sign out and sign in again"})).not.toBeInTheDocument();
 });
 it("shows permanent module navigation and an explicit disabled-stream status",async()=>{renderWorkspace();expect(await screen.findByRole("heading",{name:"Overview"})).toBeInTheDocument();expect(screen.getByRole("combobox",{name:"Business workspace"})).toHaveValue("business-1");const nav=screen.getByRole("navigation",{name:"Main navigation"});expect(within(nav).getByRole("button",{name:/Conversations/})).toBeInTheDocument();expect(within(nav).getByRole("button",{name:/Verification/})).toBeInTheDocument();await waitFor(()=>expect(screen.getByText(/Events Disabled/)).toBeInTheDocument());});
 it("loads the Knowledge page and saves new FAQ content only as a draft",async()=>{
  renderWorkspace();
  fireEvent.click(await screen.findByRole("button",{name:/Knowledge/}));
  expect(await screen.findByRole("heading",{name:"Approved FAQ answers"})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Exact customer question"),{target:{value:"What are our hours?"}});
  fireEvent.change(screen.getByLabelText("Approved answer"),{target:{value:"We close at 6 PM."}});
  fireEvent.click(screen.getByRole("button",{name:"Create FAQ draft"}));
  await waitFor(()=>expect(fetchMock.mock.calls.some(([input,init])=>String(input).endsWith("/business-1/faqs")&&init?.method==="POST")).toBe(true));
  expect(await screen.findByRole("status")).toHaveTextContent("Saved as a draft");
  const request=fetchMock.mock.calls.find(([input,init])=>String(input).endsWith("/business-1/faqs")&&init?.method==="POST");
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({question:"What are our hours?",answer:"We close at 6 PM."});
 });
 it("persists independent cursors per business and ignores duplicate or old event packets",async()=>{
  const secondBusiness={business_id:"business-2",name:"Second Workspace",role:"owner"};
  const sockets:Array<{url:string;sent:string[];onopen?:()=>void;onmessage?:(event:{data:string})=>void;onclose?:()=>void}> = [];
  vi.stubGlobal("WebSocket",class {url:string;sent:string[]=[];onopen?:()=>void;onmessage?:(event:{data:string})=>void;onclose?:()=>void;constructor(url:string){this.url=url;sockets.push(this);}send(data:string){this.sent.push(data);}close(){}});
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   const url=String(input);const data=url.endsWith("/dashboard/businesses")?{businesses:[business,secondBusiness]}:url.endsWith("/events/ticket")?{ticket:"one-use-ticket-value"}:url.endsWith("/handoffs?status=requested")||url.endsWith("/handoffs")?{handoffs:[]}:{};
   return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;
  });
  window.sessionStorage.setItem("fayfort.eventCursor.business-1","4");
  render(<DashboardWorkspace accessToken="test-access-token" eventStreaming/>);
  await waitFor(()=>expect(sockets).toHaveLength(1));
  sockets[0].onopen?.();
  expect(JSON.parse(sockets[0].sent[0])).toMatchObject({after_id:4});
  sockets[0].onmessage?.({data:JSON.stringify({type:"event",event:{id:12,event_type:"handoff.requested",entity_type:"handoff",entity_id:"handoff-12",payload:{},created_at:"2026-10-09T00:00:00Z"}})});
  sockets[0].onmessage?.({data:JSON.stringify({type:"event",event:{id:12,event_type:"handoff.requested",entity_type:"handoff",entity_id:"handoff-12",payload:{},created_at:"2026-10-09T00:00:00Z"}})});
  sockets[0].onmessage?.({data:JSON.stringify({type:"event",event:{id:11,event_type:"old.event",entity_type:"test",entity_id:"old",payload:{},created_at:"2026-10-09T00:00:00Z"}})});
  expect(await screen.findByText("handoff.requested")).toBeInTheDocument();
  expect(screen.getAllByText("handoff.requested")).toHaveLength(1);
  expect(screen.queryByText("old.event")).not.toBeInTheDocument();
  expect(window.sessionStorage.getItem("fayfort.eventCursor.business-1")).toBe("12");
  fireEvent.change(screen.getByRole("combobox",{name:"Business workspace"}),{target:{value:"business-2"}});
  await waitFor(()=>expect(sockets).toHaveLength(2));sockets[1].onopen?.();
  expect(JSON.parse(sockets[1].sent[0])).toMatchObject({after_id:0});
  fireEvent.change(screen.getByRole("combobox",{name:"Business workspace"}),{target:{value:"business-1"}});
  await waitFor(()=>expect(sockets).toHaveLength(3));sockets[2].onopen?.();
  expect(JSON.parse(sockets[2].sent[0])).toMatchObject({after_id:12});
 });
 it("navigates between an operational module and overview",async()=>{renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Automations/}));expect(await screen.findByRole("region",{name:"Automation management"})).toBeInTheDocument();fireEvent.click(within(nav).getByRole("button",{name:/Overview/}));expect(screen.getByRole("heading",{name:"Overview"})).toBeInTheDocument();});
 it("loads Analytics and issues only one request when its time window changes",async()=>{
  const event={id:2,event_type:"settings.updated",entity_type:"business",entity_id:"business-1",payload:{},created_at:"2026-10-09T00:00:00Z"};
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{const url=String(input);const data=url.endsWith("/dashboard/businesses")?{businesses:[business]}:url.includes("/ai-usage?")?{days:7,sampled_requests:0,summary_truncated:false,reported_usage_requests:0,unknown_usage_requests:0,prompt_tokens:0,completion_tokens:0,total_tokens:0,source_messages:0,message_call_distribution:{},operations:{},models:{},providers:{},budget:{limit_usd:25,committed_usd:0,pending_usd:0,remaining_usd:25,month_start:"2026-10-01T00:00:00Z"}}:url.includes("/analytics?")?{days:Number(new URL(url).searchParams.get("days")),sampled_events:1,summary_truncated:false,event_counts:{"settings.updated":1},events:[event],has_more:false,next_before_id:null}:{};return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;});
  renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Analytics/}));
  await waitFor(()=>expect(screen.getAllByText("settings.updated")).toHaveLength(2));
  fireEvent.change(screen.getByRole("combobox",{name:"Analytics time window"}),{target:{value:"7"}});
  await waitFor(()=>expect(fetchMock.mock.calls.filter(([input])=>String(input).includes("/analytics?days=7&")).length).toBe(1));
  expect(screen.getByText("Business activity analytics")).toBeInTheDocument();
 });
 it("shows provider-reported AI token usage without presenting a dollar estimate",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{const url=String(input);const data=url.endsWith("/dashboard/businesses")?{businesses:[business]}:url.includes("/ai-usage?")?{days:30,sampled_requests:3,summary_truncated:false,reported_usage_requests:2,unknown_usage_requests:1,prompt_tokens:600,completion_tokens:250,total_tokens:850,source_messages:1,message_call_distribution:{"1":1,"2":1},operations:{intent:{calls:1,prompt_tokens:200,completion_tokens:40,total_tokens:240},response:{calls:2,prompt_tokens:400,completion_tokens:210,total_tokens:610}},models:{"openai/gpt-oss-120b":3},providers:{deepinfra:3},budget:{limit_usd:25,committed_usd:0.0012,pending_usd:0.0002,remaining_usd:24.9986,month_start:"2026-10-01T00:00:00Z"}}:url.includes("/analytics?")?{days:30,sampled_events:0,summary_truncated:false,event_counts:{},events:[],has_more:false,next_before_id:null}:{};return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;});
  renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Analytics/}));
  expect(await screen.findByText("3 model requests · 1 source message")).toBeInTheDocument();
  expect(screen.getByText("850 tokens reported (600 input, 250 output)")).toBeInTheDocument();
  expect(screen.getByText("$25.00 monthly ceiling · $0.0012 committed · $24.9986 remaining (UTC calendar month)")).toBeInTheDocument();
  expect(screen.getByText("intent calls · 240 reported tokens")).toBeInTheDocument();
  expect(screen.getByText("Model calls per source message: 1 message with 1 call · 1 message with 2 calls")).toBeInTheDocument();
 });
 it("does not append a slow previous-window page after the Analytics window changes",async()=>{
  const event=(id:number,eventType:string)=>({id,event_type:eventType,entity_type:"business",entity_id:"business-1",payload:{},created_at:"2026-10-09T00:00:00Z"});
  let resolveOlder:(response:Response)=>void=()=>{};
  fetchMock.mockImplementation((input:RequestInfo|URL)=>{const url=String(input);if(url.endsWith("/dashboard/businesses"))return Promise.resolve({ok:true,status:200,json:async()=>({businesses:[business]}),headers:new Headers()} as Response);if(url.includes("/ai-usage?"))return Promise.resolve({ok:true,status:200,json:async()=>({days:url.includes("days=7")?7:30,sampled_requests:0,summary_truncated:false,reported_usage_requests:0,unknown_usage_requests:0,prompt_tokens:0,completion_tokens:0,total_tokens:0,source_messages:0,message_call_distribution:{},operations:{},models:{},providers:{},budget:{limit_usd:25,committed_usd:0,pending_usd:0,remaining_usd:25,month_start:"2026-10-01T00:00:00Z"}}),headers:new Headers()} as Response);if(url.includes("/analytics?")&&url.includes("before_id=50"))return new Promise<Response>(resolve=>{resolveOlder=resolve;});const data=url.includes("/analytics?")?url.includes("days=7")?{days:7,sampled_events:1,summary_truncated:false,event_counts:{"new-window.event":1},events:[event(100,"new-window.event")],has_more:false,next_before_id:null}:{days:30,sampled_events:1,summary_truncated:false,event_counts:{"initial-window.event":1},events:[event(50,"initial-window.event")],has_more:true,next_before_id:50}:{};return Promise.resolve({ok:true,status:200,json:async()=>data,headers:new Headers()} as Response);});
  renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Analytics/}));
  await waitFor(()=>expect(screen.getAllByText("initial-window.event")).toHaveLength(2));fireEvent.click(screen.getByRole("button",{name:"Load older activity"}));
  await waitFor(()=>expect(fetchMock.mock.calls.some(([input])=>String(input).includes("before_id=50"))).toBe(true));
  fireEvent.change(screen.getByRole("combobox",{name:"Analytics time window"}),{target:{value:"7"}});
  await waitFor(()=>expect(screen.getAllByText("new-window.event")).toHaveLength(2));
  resolveOlder({ok:true,status:200,json:async()=>({days:30,sampled_events:0,summary_truncated:false,event_counts:{},events:[event(1,"stale-page.event")],has_more:false,next_before_id:null}),headers:new Headers()} as Response);
  await waitFor(()=>expect(screen.queryByText("stale-page.event")).not.toBeInTheDocument());
  expect(screen.getAllByText("new-window.event")).toHaveLength(2);
 });
 it("shows connection setup without collecting provider credentials",async()=>{renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Connections/}));expect(await screen.findByText("No saved channel connections yet.")).toBeInTheDocument();expect(screen.getByPlaceholderText("Instagram support")).toBeInTheDocument();expect(screen.getByText(/Connect and verify provider accounts/)).toBeInTheDocument();});
 it("offers vaulted Facebook Messenger Page setup",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{const url=String(input);const data=url.endsWith("/dashboard/businesses")?{businesses:[business]}:url.endsWith("/connections")?{connections:[{id:"messenger-connection",provider:"messenger",display_name:"Facebook Support",status:"setup_required",credential_status:"not_configured",safe_settings:{inbound_enabled:true,outbound_enabled:false}}]}:{};return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;});
  renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Connections/}));
  fireEvent.click(await screen.findByRole("button",{name:"Add credentials"}));
  fireEvent.change(screen.getByLabelText("Meta App ID"),{target:{value:"meta-app"}});fireEvent.change(screen.getByLabelText("Meta App Secret"),{target:{value:"private-secret"}});fireEvent.change(screen.getByLabelText("Facebook Page ID"),{target:{value:"page-123"}});fireEvent.change(screen.getByLabelText("Page Access Token"),{target:{value:"private-page-token"}});
  fireEvent.click(screen.getByRole("button",{name:"Save credentials"}));
  await waitFor(()=>expect(fetchMock.mock.calls.some(([input,init])=>String(input).endsWith("/credentials/messenger")&&init?.method==="PUT")).toBe(true));
  expect(screen.queryByText("private-secret")).not.toBeInTheDocument();expect(screen.queryByText("private-page-token")).not.toBeInTheDocument();
 });
 it("keeps outbound and auto-replies unavailable until an Instagram connection is verified",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{const url=String(input);const data=url.endsWith("/dashboard/businesses")?{businesses:[business]}:url.endsWith("/connections")?{connections:[{id:"connection-1",provider:"instagram",display_name:"Support",status:"setup_required",credential_status:"configured",safe_settings:{outbound_enabled:false,auto_reply_enabled:false}}]}:{};return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;});
  renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Connections/}));
  const outbound=await screen.findByRole("button",{name:"Enable outbound"});expect(outbound).toBeDisabled();expect(screen.queryByRole("button",{name:/auto-replies/i})).not.toBeInTheDocument();
 });
 it("shows automation rules begin disabled and test-only",async()=>{renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Automations/}));expect(await screen.findByText("No automations yet. New rules start disabled.")).toBeInTheDocument();expect(screen.getByText(/Test rules only record runs/)).toBeInTheDocument();});
 it("shows handoff controls and explains delivery status",async()=>{renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Human Agents/}));expect(await screen.findByText("No handoffs recorded.")).toBeInTheDocument();expect(screen.getByRole("combobox",{name:"Conversation"})).toBeInTheDocument();expect(screen.getByText(/delivery status appears in the conversation/)).toBeInTheDocument();});
 it("shows and routes a global badge for waiting human handoffs",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   const url=String(input);const data=url.endsWith("/dashboard/businesses")?{businesses:[business]}:url.includes("/handoffs?status=waiting")?{total:2}:url.endsWith("/handoffs/agents")?{agents:[]}:url.includes("/handoffs?")?{handoffs:[],total:0,has_more:false}:url.endsWith("/handoffs")?{handoffs:[]}:url.endsWith("/conversations")?{conversations:[]}:{};
   return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;
  });
  renderWorkspace();
  const alert=await screen.findByRole("button",{name:"2 handoffs waiting; open Human Agents queue"});
  expect(alert).toBeInTheDocument();
  fireEvent.click(alert);
  expect(await screen.findByRole("region",{name:"Human handoff management"})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:/2 waiting/})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Mark waiting handoffs as seen"}));
  expect(screen.queryByRole("button",{name:"2 handoffs waiting; open Human Agents queue"})).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:/2 waiting/})).toBeInTheDocument();
 });
 it("pages the FIFO Human Agents queue without losing its exact total",async()=>{
  const makeHandoff=(id:string,conversationId:string)=>({id,conversation_id:conversationId,requested_by:"user-1",status:"returned",reason:id,requested_at:"2026-10-09T00:00:00Z"});
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   const url=String(input);let data:unknown={};
   if(url.endsWith("/dashboard/businesses"))data={businesses:[business]};
  else if(url.includes("/handoffs?status=waiting"))data={total:0};
   else if(url.includes("/handoffs?limit=50&offset=50"))data={handoffs:[makeHandoff("handoff-51","conversation-51")],total:51,has_more:false};
   else if(url.includes("/handoffs?limit=50&offset=0"))data={handoffs:[makeHandoff("handoff-1","conversation-1")],total:51,has_more:true};
   else if(url.endsWith("/handoffs/agents"))data={agents:[]};
   else if(url.endsWith("/conversations"))data={conversations:[]};
   return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;
  });
  renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});
  fireEvent.click(within(nav).getByRole("button",{name:/Human Agents/}));
  fireEvent.change(await screen.findByRole("combobox",{name:"Queue status"}),{target:{value:"all"}});
  expect(await screen.findByText("Showing 1–1 of 51")).toBeInTheDocument();
  expect(screen.getByText(/handoff-1/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Next queue page"}));
  expect(await screen.findByText("Showing 51–51 of 51")).toBeInTheDocument();
  expect(screen.getByText(/handoff-51/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Previous queue page"}));
  expect(await screen.findByText(/handoff-1/)).toBeInTheDocument();
 });
 it("surfaces stale settings conflicts and sends the version token",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);let data:unknown={};let status=200;let ok=true;
   if(url.endsWith("/dashboard/businesses"))data={businesses:[business]};
   else if(url.endsWith("/settings")&&init?.method==="PATCH"){data={detail:"Workspace settings changed since you opened this page. Refresh and reapply your change."};status=409;ok=false;}
   else if(url.endsWith("/settings"))data={business:{name:"Workspace",description:"Current description",created_at:"2026-10-09T00:00:00Z",updated_at:"2026-10-09T01:00:00Z"}};
   return {ok,status,json:async()=>data,headers:new Headers()} as Response;
  });
  renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Settings/}));
  fireEvent.change(await screen.findByRole("textbox",{name:"Business name"}),{target:{value:"Changed name"}});fireEvent.click(screen.getByRole("button",{name:"Save settings"}));
  expect(await screen.findByRole("alert")).toHaveTextContent(/changed since you opened this page/i);
  const patchCall=fetchMock.mock.calls.find(([input,init])=>String(input).endsWith("/settings")&&init?.method==="PATCH");
  expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({expected_updated_at:"2026-10-09T01:00:00Z",name:"Changed name"});
 });
 it("paginates the bounded conversation list in both directions",async()=>{
  const firstPage=Array.from({length:50},(_,index)=>({id:`conversation-${index}`,business_id:"business-1",customer_external_id:`customer-${index}`,channel:"manual_test",status:"open",summary:`Conversation ${index}`,created_at:"2026-10-09T00:00:00Z",last_message_at:"2026-10-09T00:00:00Z"}));
  const secondPage=[{id:"conversation-50",business_id:"business-1",customer_external_id:"customer-50",channel:"manual_test",status:"open",summary:"Conversation 50",created_at:"2026-10-09T00:00:00Z",last_message_at:"2026-10-09T00:00:00Z"}];
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   const url=String(input);let data:unknown={};
   if(url.endsWith("/dashboard/businesses"))data={businesses:[business]};
   else if(url.includes("/conversations?"))data=url.includes("offset=50")?{conversations:secondPage,has_more:false}:{conversations:firstPage,has_more:true};
   else if(url.includes("/handoffs?status=waiting"))data={total:0};
   else if(url.includes("/handoffs?"))data={handoffs:[],total:0,has_more:false};
   else if(url.endsWith("/handoffs"))data={handoffs:[]};
   else data={};
   return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;
  });
  renderWorkspace();
  const nav=screen.getByRole("navigation",{name:"Main navigation"});
  fireEvent.click(within(nav).getByRole("button",{name:/Conversations/}));
  expect(await screen.findByRole("button",{name:/customer-0/})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Next page"})).toBeEnabled();
  fireEvent.click(screen.getByRole("button",{name:"Next page"}));
  expect(await screen.findByRole("button",{name:/customer-50/})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Previous page"})).toBeEnabled();
  expect(screen.getByRole("button",{name:"Next page"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"Previous page"}));
  expect(await screen.findByRole("button",{name:/customer-0/})).toBeInTheDocument();
 });
 it("shows the authorized directory projection returned by the gateway",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   const url=String(input);let data:unknown={};
   if(url.endsWith("/dashboard/businesses"))data={businesses:[business]};
   else if(url.endsWith("/directory/tools"))data={tools:[{tool_id:"city_area_guide_search",family:"city_area_guide",description:"City guide",verification_policy:"verified_records_only",active:true}]};
   else if(url.includes("/conversations"))data={conversations:[{id:"conversation-1",customer_external_id:"customer-1",channel:"manual_test",status:"open",created_at:"2026-10-09T00:00:00Z"}],has_more:false};
   else if(url.endsWith("/directory/search"))data={tool_id:"city_area_guide_search",outcome:"ALLOW",message:"Use only the returned fields.",records:[{city:"Guangzhou",known_for:"Textiles"}],allowed_fields:["city","known_for"]};
   return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;
  });
  renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Directory & Tools/}));
  fireEvent.change(await screen.findByRole("textbox",{name:"Search query"}),{target:{value:"area guide"}});fireEvent.click(screen.getByRole("button",{name:"Search directory"}));
  expect(await screen.findByRole("heading",{name:"Search decision: ALLOW"})).toBeInTheDocument();expect(screen.getByText(/Fields returned:/).parentElement).toHaveTextContent("city, known_for");expect(screen.getByText("Guangzhou")).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([input])=>String(input).endsWith("/directory/search"))).toBe(true);
 });
 it("shows human-review guidance without rendering records for an unverified match",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   const url=String(input);let data:unknown={};
   if(url.endsWith("/dashboard/businesses"))data={businesses:[business]};
   else if(url.endsWith("/directory/tools"))data={tools:[{tool_id:"hotel_search",family:"hotel",description:"Hotels",verification_policy:"verified_records_only",active:true}]};
   else if(url.includes("/conversations"))data={conversations:[{id:"conversation-1",customer_external_id:"customer-1",channel:"manual_test",status:"open",created_at:"2026-10-09T00:00:00Z"}],has_more:false};
   else if(url.endsWith("/directory/search"))data={tool_id:"hotel_search",outcome:"HUMAN_REQUIRED",message:"A matching record needs review.",records:[],requires_human:true};
   return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;
  });
  renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Directory & Tools/}));
  fireEvent.change(await screen.findByRole("textbox",{name:"Search query"}),{target:{value:"hotel near the station"}});fireEvent.click(screen.getByRole("button",{name:"Search directory"}));
  expect(await screen.findByRole("heading",{name:"Search decision: HUMAN REQUIRED"})).toBeInTheDocument();expect(screen.getByText("This result requires a human review before it can be used.")).toBeInTheDocument();
 });
 it("shows the sixth Products list with existing category labels",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   const url=String(input);let data:unknown={};
   if(url.endsWith("/dashboard/businesses"))data={businesses:[business]};
   else if(url.endsWith("/directory/tools"))data={tools:[{tool_id:"hotel_search",family:"hotel",description:"Hotels",verification_policy:"verified_records_only",active:true}]};
   else if(url.includes("/conversations"))data={conversations:[],has_more:false};
   else if(url.endsWith("/directory/products"))data={products:[{id:"product-1",name:"Sample widget",category_ref:"cat-1",description:"Catalog item",availability_status:"available",active:true,media_url:"https://cdn.example.test/widget.jpg",media_type:"image",media_source:"url",updated_at:"2026-10-10T12:00:00Z"}],categories:[{source_ref:"cat-1",category:"Tools",product_type:"Widget"}],can_manage:false};
   return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;
  });
  renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Directory & Tools/}));
  expect(await screen.findByRole("region",{name:"Products catalog"})).toBeInTheDocument();expect(screen.getByText("Sample widget")).toBeInTheDocument();expect(screen.getByText(/Tools · available/)).toBeInTheDocument();expect(screen.getByRole("img",{name:"Sample widget preview"})).toHaveAttribute("src","https://cdn.example.test/widget.jpg");expect(screen.queryByRole("button",{name:"Add product"})).not.toBeInTheDocument();
 });
});
