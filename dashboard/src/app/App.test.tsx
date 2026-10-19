import { cleanup,fireEvent,render,screen,waitFor,within } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { MemberPhotoReviewQueue } from "./staff/MemberPhotoReview";
import { App,DashboardWorkspace,WorkerInvitationAcceptancePage,WorkerPasswordResetPage,WorkerProvisioningPage } from "./App";

const authMocks=vi.hoisted(()=>({updateUser:vi.fn(),getSession:vi.fn(),onAuthStateChange:vi.fn(),signInWithOAuth:vi.fn(),getUserIdentities:vi.fn(),linkIdentity:vi.fn()}));
vi.mock("../lib/supabase",()=>({dashboardAuthConfigured:true,openedAt:{pathname:"",search:"",hash:""},supabaseClient:{auth:{updateUser:authMocks.updateUser,getSession:authMocks.getSession,onAuthStateChange:authMocks.onAuthStateChange,signInWithOAuth:authMocks.signInWithOAuth,getUserIdentities:authMocks.getUserIdentities,linkIdentity:authMocks.linkIdentity,mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:"aal2",nextLevel:"aal2"},error:null})}}}}));

afterEach(()=>{cleanup();window.history.replaceState({},"","/");});
const business = { business_id:"business-1", name:"FayFort Test Workspace" };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(()=>{
  authMocks.updateUser.mockReset();
  authMocks.signInWithOAuth.mockReset().mockResolvedValue({error:null});
  authMocks.getUserIdentities.mockReset().mockResolvedValue({data:{identities:[{provider:"email"}]},error:null});
  authMocks.linkIdentity.mockReset().mockResolvedValue({error:null});
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
 it("starts Google member sign-in with the member callback",async()=>{
  window.history.replaceState({},"","/member/signup");
  render(<App/>);
  fireEvent.click(screen.getByRole("button",{name:"Continue with Google"}));
  await waitFor(()=>expect(authMocks.signInWithOAuth).toHaveBeenCalledWith({provider:"google",options:{redirectTo:`${window.location.origin}/member/account`}}));
 });

 it("keeps Apple sign-in deferred from the member entry flow",async()=>{
  window.history.replaceState({},"","/member/signup");
  render(<App/>);
  expect(screen.queryByRole("button",{name:/Apple/})).not.toBeInTheDocument();
 });

 it("shows the member plan comparison without exposing checkout",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>String(input).endsWith("/members/me")?{ok:true,status:200,json:async()=>({profile:{user_id:"member-1",member_tier:"free",selected_theme:"base"}}),headers:new Headers()} as Response:{ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response);
  window.history.replaceState({},"","/member/membership");render(<App/>);
  expect(await screen.findByText("Your current plan:")).toHaveTextContent("Free");
  for(const plan of ["Free","Standard","Pro"])expect(screen.getByRole("columnheader",{name:new RegExp(plan)})).toBeInTheDocument();
  expect(screen.getByRole("columnheader",{name:/Free\s*Your plan/})).toBeInTheDocument();
  expect(screen.getByRole("row",{name:/Consultation\s*\$100\s*\$50 \(50% off\)\s*1 free each month, then \$50/})).toBeInTheDocument();
  expect(screen.getByRole("row",{name:/Sourcing deposit\s*50% of the product price\s*25% of the product price\s*None while you keep buying/})).toBeInTheDocument();
  expect(screen.getByRole("row",{name:/Supplier contacts\s*\$15 each or 5 for \$50\s*\$15 each or 5 for \$50\s*10 included each month/})).toBeInTheDocument();
  expect(screen.getByText(/counts toward your order/)).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:/subscribe|upgrade|checkout/i})).not.toBeInTheDocument();
 });

 it("runs giveaways from the Shop page, with no separate Giveaways page",async()=>{
  render(<DashboardWorkspace accessToken="test-access-token" platformAdmin eventStreaming={false}/>);
  const nav=screen.getByRole("navigation",{name:"Main navigation"});
  expect(within(nav).queryByRole("button",{name:/Giveaways/})).not.toBeInTheDocument();
  fireEvent.click(within(nav).getByRole("button",{name:/Shop/}));
  fireEvent.click(await screen.findByRole("tab",{name:"Giveaways"}));
  expect(await screen.findByRole("region",{name:"Giveaways workspace"})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Schedule giveaway"})).toBeInTheDocument();
 });

 it("explains when the API server hasn't been updated for the Shop",async()=>{
  const base=fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>String(input).includes("/platform/commerce/")?{ok:false,status:404,json:async()=>({detail:"Not Found"}),headers:new Headers()} as Response:base(input,init));
  render(<DashboardWorkspace accessToken="test-access-token" platformAdmin eventStreaming={false}/>);
  fireEvent.click(within(screen.getByRole("navigation",{name:"Main navigation"})).getByRole("button",{name:/Shop/}));
  expect(await screen.findByText(/API server is still running the previous version/)).toBeInTheDocument();
 });

 it("routes a Supabase recovery callback to the password form",async()=>{
  window.history.replaceState({},"","/worker/accept?type=recovery");
  render(<App/>);
  expect(await screen.findByRole("heading",{name:"Set a new password"})).toBeInTheDocument();
 });

 it("shows verified member account details and server-managed points and tier without client-side tier controls",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   const url=String(input);
   if(url.endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1",display_name:"Jordan Member",points_balance:250,rank_level:3,subrank:4}}),headers:new Headers()} as Response;
   if(url.endsWith("/members/conversations"))return {ok:true,status:200,json:async()=>({conversations:[]}),headers:new Headers()} as Response;
   if(url.endsWith("/members/requests"))return {ok:true,status:200,json:async()=>({requests:[]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/account");
  const account=render(<App/>);
  const details=await screen.findByRole("region",{name:"Member account details"});
  expect(within(details).getByText("member@example.com")).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button",{name:/Apple/})).not.toBeInTheDocument();
  account.unmount();
  window.history.replaceState({},"","/member/chat");
  render(<App/>);
  const openMenu=async()=>{fireEvent.click(await screen.findByRole("button",{name:"Open member account menu"}));return screen.findByRole("menu",{name:"Account"});};
  let menu=await openMenu();
  expect(within(menu).getByText("Jordan Member")).toBeInTheDocument();
  fireEvent.click(within(menu).getByRole("menuitem",{name:/Virtual points\s*250/}));
  expect(screen.queryByRole("menu",{name:"Account"})).not.toBeInTheDocument();
  const points=await screen.findByRole("dialog",{name:"Virtual points"});
  expect(within(points).getByText("250")).toBeInTheDocument();
  expect(window.location.pathname).toBe("/member/chat");
  fireEvent.click(within(points).getByRole("button",{name:"Close"}));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  menu=await openMenu();
  fireEvent.click(within(menu).getByRole("menuitem",{name:/Hunter · 4/}));
  const tier=await screen.findByRole("dialog",{name:"Member tier"});
  expect(within(tier).getByRole("progressbar",{name:"Rank progress"})).toHaveAttribute("aria-valuenow","14");
  // Plans moved to Settings → Plan: the tier pop-up has no plan table, only a way there.
  expect(within(tier).queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(within(tier).getByRole("button",{name:"Plans and perks in Settings"}));
  const planSettings=await screen.findByRole("dialog",{name:"Settings"});
  expect(await within(planSettings).findByRole("heading",{name:"Plan"})).toBeInTheDocument();
  expect(within(planSettings).getByRole("row",{name:/Sourcing deposit/})).toBeInTheDocument();
  fireEvent.keyDown(window,{key:"Escape"});
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  menu=await openMenu();
  fireEvent.click(within(menu).getByRole("menuitem",{name:"Account details"}));
  const account2=await screen.findByRole("dialog",{name:"Account details"});
  expect(within(account2).getByText("Jordan Member")).toBeInTheDocument();
  fireEvent.click(within(account2).getByRole("button",{name:"Edit in settings"}));
  const settings=await screen.findByRole("dialog",{name:"Settings"});
  expect(await within(settings).findByRole("heading",{name:"Sign-in methods"})).toBeInTheDocument();
  fireEvent.click(within(settings).getByRole("button",{name:"Close Settings"}));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([input,init])=>String(input).endsWith("/members/me")&&init?.method&&init.method!=="GET")).toBe(false);
 });

 it("links Google to the current member identity rather than starting a new sign-in",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>String(input).endsWith("/members/me")?{ok:true,status:200,json:async()=>({profile:{user_id:"member-1"}}),headers:new Headers()} as Response:{ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response);
  window.history.replaceState({},"","/member/settings");render(<App/>);
  expect(await screen.findByRole("heading",{name:"Sign-in methods"})).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button",{name:"Link Google"}));
  await waitFor(()=>expect(authMocks.linkIdentity).toHaveBeenCalledWith({provider:"google",options:{redirectTo:`${window.location.origin}/member/account`}}));
  expect(authMocks.signInWithOAuth).not.toHaveBeenCalled();
 });

 it("opens the mobile member discovery chat and persists an assistant turn",async()=>{
  const chat={id:"chat-1",title:"New chat",retention_hold:false,created_at:"2026-10-10T00:00:00Z",last_activity_at:"2026-10-10T00:00:00Z"};
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1"}}),headers:new Headers()} as Response;
   if(url.endsWith("/members/conversations")&&init?.method==="POST")return {ok:true,status:201,json:async()=>({conversation:chat}),headers:new Headers()} as Response;
   if(url.endsWith("/members/conversations"))return {ok:true,status:200,json:async()=>({conversations:[]}),headers:new Headers()} as Response;
   if(url.endsWith("/members/requests"))return {ok:true,status:200,json:async()=>({requests:[]}),headers:new Headers()} as Response;
   if(url.includes("/members/conversations/chat-1/messages")&&init?.method==="POST")return {ok:true,status:201,json:async()=>({member_message:{id:"m1",sender_type:"member",content:"I need a hand tool",created_at:"2026-10-10T00:00:01Z"},assistant_message:{id:"m2",sender_type:"assistant",content:"Here is an active catalog suggestion.",created_at:"2026-10-10T00:00:02Z"},products:[{id:"p1",name:"Hammer",category_ref:"tools",availability_status:"available"}]}),headers:new Headers()} as Response;
   if(url.includes("/members/conversations/chat-1/messages"))return {ok:true,status:200,json:async()=>({messages:[]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/chat");render(<App/>);
  expect(await screen.findByRole("complementary",{name:"Chats and navigation"})).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button",{name:"Start chat"}));
  const input=await screen.findByRole("textbox",{name:"Message FayFort"});
  fireEvent.change(input,{target:{value:"I need a hand tool"}});
  fireEvent.click(screen.getByRole("button",{name:"Send message"}));
  expect(await screen.findByText("Here is an active catalog suggestion.")).toBeInTheDocument();
  expect(screen.getByRole("region",{name:"Catalog suggestions"})).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url,init])=>String(url).includes("/members/conversations/chat-1/messages")&&init?.method==="POST")).toBe(true);
 });

 it("shows human replies and lets the member confirm a chat-linked sourcing request",async()=>{
  const chat={id:"chat-human",title:"New chat",retention_hold:false,created_at:"2026-10-10T00:00:00Z",last_activity_at:"2026-10-10T00:00:00Z"};
  const product={id:"product-human",name:"Sample wrench",category_ref:"Tools",description:"A hand tool",availability_status:"listed" as const};
  let submittedBody:Record<string,unknown>|null=null;
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1"}}),headers:new Headers()} as Response;
   if(url.endsWith("/members/conversations"))return {ok:true,status:200,json:async()=>({conversations:[chat]}),headers:new Headers()} as Response;
   if(url.endsWith("/members/requests")&&init?.method==="POST"){submittedBody=JSON.parse(String(init.body));return {ok:true,status:201,json:async()=>({request_id:"request-human",stage:"submitted"}),headers:new Headers()} as Response;}
   if(url.endsWith("/members/requests"))return {ok:true,status:200,json:async()=>({requests:[]}),headers:new Headers()} as Response;
   if(url.includes("/members/conversations/chat-human/messages"))return {ok:true,status:200,json:async()=>({messages:[{id:"human-1",sender_type:"worker",content:"This appears to be a compact hand tool.",related_product_ids:[product.id],created_at:"2026-10-10T00:01:00Z"}],products:[product]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/chat");render(<App/>);
  expect(await screen.findByText("FayFort human support")).toBeInTheDocument();
  expect(screen.getByText("This appears to be a compact hand tool.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Request this item"}));
  expect(await screen.findByRole("heading",{name:"Create a sourcing request"})).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox",{name:"Details for your request (optional)"}),{target:{value:"Please confirm available sizes."}});
  fireEvent.click(screen.getByRole("button",{name:"Submit request"}));
  expect(await screen.findByText("Your sourcing request was submitted. Follow progress in Orders & requests.")).toBeInTheDocument();
  expect(submittedBody).toEqual({request_title:"Sample wrench",request_description:"Please confirm available sizes.",source_type:"catalog_product",source_url:null,product_id:"product-human",conversation_id:"chat-human",expected_total:null});
 });

 it("lets the assigned worker reply with active catalog suggestions after review",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.includes("/workers/member-reviews/catalog"))return {ok:true,status:200,json:async()=>({products:[{id:"product-human",name:"Sample wrench",category_ref:"Tools",availability_status:"listed"}]}),headers:new Headers()} as Response;
   if(url==="/api/workers/member-reviews"||url.endsWith("/workers/member-reviews"))return {ok:true,status:200,json:async()=>({reviews:[{id:"review-human",status:"reviewed",created_at:"2026-10-10T00:00:00Z",media:[]}]}),headers:new Headers()} as Response;
   if(url.endsWith("/workers/member-reviews/review-human/messages"))return {ok:true,status:200,json:async()=>({messages:[{id:"context-1",sender_type:"member",content:"I need a small wrench.",related_product_ids:[],created_at:"2026-10-10T00:00:00Z"}]}),headers:new Headers()} as Response;
   if(url.endsWith("/workers/member-reviews/review-human/reply")&&init?.method==="POST")return {ok:true,status:201,json:async()=>({message:{sender_type:"worker"}}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({worker:{status:"active"}}),headers:new Headers()} as Response;
  });
  render(<MemberPhotoReviewQueue accessToken="test-access-token" platformAdmin={false} onlyReviewId="review-human"/>);
  expect(await screen.findByRole("heading",{name:"Reply to member"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"View member chat"}));
  expect(await screen.findByText("I need a small wrench.")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox",{name:"Message"}),{target:{value:"This looks like a compact wrench."}});
  fireEvent.change(screen.getByRole("textbox",{name:"Find active products to suggest"}),{target:{value:"wrench"}});
  fireEvent.click(screen.getByRole("button",{name:"Search catalog"}));
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button",{name:"Send reply"}));
  expect(await screen.findByText("Your reply was sent to the member chat.")).toBeInTheDocument();
  const sent=fetchMock.mock.calls.find(([url,init])=>String(url).includes("/workers/member-reviews/review-human/reply")&&init?.method==="POST");
  expect(JSON.parse(String(sent?.[1]?.body))).toEqual({content:"This looks like a compact wrench.",product_ids:["product-human"]});
 });

 it("requires member consent before sending a photo to human review",async()=>{
  const chat={id:"chat-photo",title:"New chat",retention_hold:false,created_at:"2026-10-10T00:00:00Z",last_activity_at:"2026-10-10T00:00:00Z"};
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1"}}),headers:new Headers()} as Response;
   if(url.endsWith("/members/conversations"))return {ok:true,status:200,json:async()=>({conversations:[chat]}),headers:new Headers()} as Response;
   if(url.includes("/members/conversations/chat-photo/messages"))return {ok:true,status:200,json:async()=>({messages:[],products:[]}),headers:new Headers()} as Response;
   if(url.includes("/members/conversations/chat-photo/review-media")&&init?.method==="POST")return {ok:true,status:201,json:async()=>({review:{id:"review-1",status:"pending_assignment"}}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({requests:[]}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/chat");render(<App/>);
  const file=new File([new Uint8Array([137,80,78,71,13,10,26,10])],"item.png",{type:"image/png"});
  fireEvent.click(await screen.findByRole("button",{name:"Ask a person to review a photo"}));
  fireEvent.change(await screen.findByLabelText("Choose a photo"),{target:{files:[file]}});
  const submit=screen.getByRole("button",{name:"Send for human review"});
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(submit);
  expect(await screen.findByText(/Photo sent for FayFort human review/)).toBeInTheDocument();
  const upload=fetchMock.mock.calls.find(([url,init])=>String(url).includes("/review-media")&&init?.method==="POST");
  expect(upload).toBeDefined();
  expect(String(upload?.[0])).toContain("consent=true");
  expect(upload?.[1]?.body).toBe(file);
 });

 it("links an owned sourcing request to a chat retention hold",async()=>{
  const chat={id:"chat-2",title:"Find a part",retention_hold:false,created_at:"2026-10-10T00:00:00Z",last_activity_at:"2026-10-10T00:00:00Z"};
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1"}}),headers:new Headers()} as Response;
   if(url.endsWith("/members/conversations"))return {ok:true,status:200,json:async()=>({conversations:[chat]}),headers:new Headers()} as Response;
   if(url.endsWith("/members/requests"))return {ok:true,status:200,json:async()=>({requests:[{id:"request-2",request_title:"Source a part",events:[]}]}),headers:new Headers()} as Response;
   if(url.includes("/members/conversations/chat-2/messages"))return {ok:true,status:200,json:async()=>({messages:[]}),headers:new Headers()} as Response;
   if(url.endsWith("/retention-hold")&&init?.method==="POST")return {ok:true,status:200,json:async()=>({retention_hold:true}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/chat");render(<App/>);
  fireEvent.click(await screen.findByRole("button",{name:"Link an existing request"}));
  expect(screen.getByRole("dialog",{name:"Link a sourcing request"})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Choose one of your sourcing requests"),{target:{value:"request-2"}});
  fireEvent.click(screen.getByRole("button",{name:"Link request"}));
  expect(await screen.findByText("This chat is retained with your sourcing request. It is now read-only.")).toBeInTheDocument();
  const hold=fetchMock.mock.calls.find(([url,init])=>String(url).endsWith("/members/conversations/chat-2/retention-hold")&&init?.method==="POST");
  expect(JSON.parse(String(hold?.[1]?.body))).toEqual({request_id:"request-2"});
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

 it("keeps automated photo matching out of the product catalog",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   const url=String(input);
   if(url.endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1"}}),headers:new Headers()} as Response;
   if(url.includes("/members/products"))return {ok:true,status:200,json:async()=>({products:[],saved_product_ids:[],categories:[]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/products");render(<App/>);
  expect(await screen.findByRole("heading",{name:"Products"})).toBeInTheDocument();
  expect(screen.queryByRole("region",{name:/photo/i})).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/product photo/i)).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([input])=>String(input).includes("product-image-search"))).toBe(false);
 });

 it("submits a member sourcing request and displays its persisted timeline",async()=>{
  let created=false;
  let submittedBody:Record<string,unknown>|null=null;
  const catalogProduct={id:"site-product",name:"Catalog item",category_ref:"Tools",availability_status:"listed" as const};
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1"}}),headers:new Headers()} as Response;
   if(url.includes("/members/products"))return {ok:true,status:200,json:async()=>({products:url.includes("saved_only=true")?[]:[catalogProduct],saved_product_ids:[],categories:[]}),headers:new Headers()} as Response;
   if(url.endsWith("/members/requests")&&init?.method==="POST"){created=true;submittedBody=JSON.parse(String(init.body));return {ok:true,status:201,json:async()=>({request_id:"request-1",stage:"submitted"}),headers:new Headers()} as Response;}
   if(url.endsWith("/members/requests"))return {ok:true,status:200,json:async()=>({requests:created?[{id:"request-1",request_title:"Source a widget",request_description:"Two units",events:[{id:"event-1",sequence_no:1,stage:"submitted",member_note:null,created_at:"2026-10-10T00:00:00Z"}]}]:[]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/products");render(<App/>);
  fireEvent.change(await screen.findByRole("textbox",{name:"Request title"}),{target:{value:"Source a widget"}});
  fireEvent.click(screen.getByRole("radio",{name:"Site catalog"}));
  fireEvent.change(await screen.findByRole("combobox",{name:"Catalog product"}),{target:{value:"site-product"}});
  fireEvent.change(screen.getByRole("textbox",{name:"Request details"}),{target:{value:"Two units"}});
  fireEvent.click(screen.getByRole("button",{name:"Submit request"}));
  expect(await screen.findByRole("heading",{name:"Source a widget"})).toBeInTheDocument();
  expect(within(screen.getByRole("list",{name:"Update history for Source a widget"})).getByText("Request received")).toBeInTheDocument();
  expect(submittedBody).toMatchObject({request_title:"Source a widget",request_description:"Two units",source_type:"catalog_product",product_id:"site-product",source_url:null});
 });

 it("lets a member answer when FayFort needs a detail and shows sourcing carrying on",async()=>{
  let answered:Record<string,unknown>|null=null;
  const asked=[{id:"e1",sequence_no:1,stage:"submitted",member_note:null,created_at:"2026-10-10T00:00:00Z"},{id:"e2",sequence_no:2,stage:"needs_member_input",member_note:"Which length would you like?",created_at:"2026-10-10T00:05:00Z"}];
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1"}}),headers:new Headers()} as Response;
   if(url.includes("/members/products"))return {ok:true,status:200,json:async()=>({products:[],saved_product_ids:[],categories:[]}),headers:new Headers()} as Response;
   if(url.endsWith("/members/requests/request-1/answer")&&init?.method==="POST"){answered=JSON.parse(String(init.body));return {ok:true,status:200,json:async()=>({request_id:"request-1",stage:"sourcing"}),headers:new Headers()} as Response;}
   if(url.endsWith("/members/requests"))return {ok:true,status:200,json:async()=>({requests:[{id:"request-1",request_title:"Source a wig",request_description:null,events:answered?[...asked,{id:"e3",sequence_no:3,stage:"sourcing",member_note:"Member answered: 22 inch",created_at:"2026-10-10T00:09:00Z"}]:asked}]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/products");render(<App/>);
  const form=await screen.findByRole("form",{name:"Answer FayFort about Source a wig"});
  expect(within(form).getByText(/Which length would you like/)).toBeInTheDocument();
  fireEvent.change(within(form).getByRole("textbox",{name:"Your answer"}),{target:{value:"22 inch"}});
  fireEvent.click(within(form).getByRole("button",{name:"Send answer"}));
  await waitFor(()=>expect(answered).toEqual({message:"22 inch"}));
  await waitFor(()=>expect(screen.queryByRole("form",{name:"Answer FayFort about Source a wig"})).not.toBeInTheDocument());
 });

 it("shows the delivery estimate and lets a member cancel an unpaid request",async()=>{
  let cancelled:Record<string,unknown>|null=null;
  const events=[{id:"e1",sequence_no:1,stage:"submitted",member_note:null,created_at:"2026-10-10T00:00:00Z"},{id:"e2",sequence_no:2,stage:"sourcing",member_note:null,created_at:"2026-10-10T00:05:00Z"}];
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1"}}),headers:new Headers()} as Response;
   if(url.includes("/members/products"))return {ok:true,status:200,json:async()=>({products:[],saved_product_ids:[],categories:[]}),headers:new Headers()} as Response;
   if(url.endsWith("/members/requests/request-1/cancel")&&init?.method==="POST"){cancelled=JSON.parse(String(init.body));return {ok:true,status:200,json:async()=>({request_id:"request-1",stage:"cancelled"}),headers:new Headers()} as Response;}
   if(url.endsWith("/members/requests"))return {ok:true,status:200,json:async()=>({requests:[{id:"request-1",request_title:"Source a wig",request_description:null,eta_at:"2026-10-24T18:00:00Z",eta_reason:"Supplier restocks Friday",events:cancelled?[...events,{id:"e3",sequence_no:3,stage:"cancelled",member_note:"You cancelled this request.",created_at:"2026-10-10T00:09:00Z"}]:events}]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/products");render(<App/>);
  const eta=await screen.findByLabelText("Estimated delivery for Source a wig");
  expect(within(eta).getByText(/Supplier restocks Friday/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Cancel request"}));
  const confirm=screen.getByRole("group",{name:"Cancel Source a wig"});
  fireEvent.change(within(confirm).getByRole("textbox",{name:/Reason/}),{target:{value:"Found it elsewhere"}});
  fireEvent.click(within(confirm).getByRole("button",{name:"Yes, cancel request"}));
  await waitFor(()=>expect(cancelled).toEqual({reason:"Found it elsewhere"}));
  await waitFor(()=>expect(screen.queryByRole("button",{name:"Cancel request"})).not.toBeInTheDocument());
 });

 it("creates a recurring request schedule only after the member approves the no-automatic-order terms",async()=>{
  const requestPosts:unknown[]=[];
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1"}}),headers:new Headers()} as Response;
   if(url.includes("/members/products"))return {ok:true,status:200,json:async()=>({products:[],saved_product_ids:[],categories:[]}),headers:new Headers()} as Response;
   if(url.endsWith("/members/requests/recurring-intent")&&init?.method==="POST")return {ok:true,status:201,json:async()=>({schedule_intent_id:"intent-1"}),headers:new Headers()} as Response;
   if(url.endsWith("/members/requests/recurring-intents/intent-1/activate")&&init?.method==="POST")return {ok:true,status:201,json:async()=>({schedule:{id:"schedule-1"}}),headers:new Headers()} as Response;
   if(url.endsWith("/members/requests")&&init?.method==="POST"){requestPosts.push(init.body);return {ok:true,status:201,json:async()=>({request_id:"request-1"}),headers:new Headers()} as Response;}
   if(url.endsWith("/members/requests"))return {ok:true,status:200,json:async()=>({requests:[]}),headers:new Headers()} as Response;
   if(url.includes("/members/recurring-schedules"))return {ok:true,status:200,json:async()=>({schedules:[]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/products");render(<App/>);
  fireEvent.change(await screen.findByRole("textbox",{name:"Request title"}),{target:{value:"Monthly tea supply"}});
  fireEvent.click(screen.getByRole("checkbox",{name:"Make this a recurring purchase"}));
  fireEvent.change(screen.getByRole("combobox",{name:"Repeat interval"}),{target:{value:"custom"}});
  fireEvent.change(screen.getByRole("spinbutton",{name:"Custom interval count"}),{target:{value:"2"}});
  fireEvent.change(screen.getByRole("combobox",{name:"Custom interval unit"}),{target:{value:"weeks"}});
  fireEvent.change(screen.getByRole("spinbutton",{name:"Units per order"}),{target:{value:"4"}});
  fireEvent.change(screen.getByRole("spinbutton",{name:"Total cycles"}),{target:{value:"6"}});
  expect(screen.getByText("Preview: Every 2 weeks · 4 units per order · 6 total cycles")).toBeInTheDocument();
  expect(screen.getByText(/No automatic order or charge\./)).toBeInTheDocument();
  const submit=screen.getByRole("button",{name:"Create recurring request schedule"});
  fireEvent.change(screen.getByRole("combobox",{name:"Schedule time zone"}),{target:{value:"America/Los_Angeles"}});
  fireEvent.change(screen.getByLabelText("First repeat date and time"),{target:{value:"2026-11-15T10:30"}});
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox",{name:"Acknowledge recurring request terms"}));
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  expect(await screen.findByText(/Recurring sourcing schedule created/)).toBeInTheDocument();
  const intent=fetchMock.mock.calls.find(([url,init])=>String(url).endsWith("/members/requests/recurring-intent")&&init?.method==="POST");
  const intentBody=JSON.parse(String(intent?.[1]?.body));
  expect(intentBody).toMatchObject({request_title:"Monthly tea supply",source_type:"description",recurrence:{cadence:"custom",interval_count:2,interval_unit:"weeks",units_per_order:4,occurrence_count:6}});
  expect(typeof intentBody.idempotency_key).toBe("string");
  const activate=fetchMock.mock.calls.find(([url,init])=>String(url).endsWith("/recurring-intents/intent-1/activate")&&init?.method==="POST");
  expect(JSON.parse(String(activate?.[1]?.body))).toEqual({time_zone:"America/Los_Angeles",first_repeat_local:"2026-11-15T10:30",acknowledge_mvp_policy:true});
  expect(requestPosts).toHaveLength(0);
 });

 it("sends old worker photo-review links to the Operations Center",async()=>{
  window.history.replaceState({},"","/worker/member-reviews");render(<App/>);
  expect(await screen.findByText(/Photo reviews moved to the/)).toBeInTheDocument();
  expect(screen.getByRole("link",{name:"Operations Center"})).toHaveAttribute("href","/operations");
  window.history.replaceState({},"","/");
 });

 it("keeps Member Requests as an admin assignment page; workers do request work in the Operations Center",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   const url=String(input);
   if(url.endsWith("/workers/me"))return {ok:true,status:200,json:async()=>({worker:{status:"active"}}),headers:new Headers()} as Response;
   if(url.endsWith("/dashboard/businesses"))return {ok:true,status:200,json:async()=>({businesses:[]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});
  await waitFor(()=>expect(fetchMock).toHaveBeenCalled());
  expect(within(nav).queryByRole("button",{name:/Member Requests/})).not.toBeInTheDocument();
 });

 it("shows paid purchase, private warehouse evidence, and shipment tracking on the member timeline",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{
   const url=String(input);
   if(url.endsWith("/members/me"))return {ok:true,status:200,json:async()=>({profile:{user_id:"member-1"}}),headers:new Headers()} as Response;
   if(url.includes("/members/products"))return {ok:true,status:200,json:async()=>({products:[],saved_product_ids:[],categories:[]}),headers:new Headers()} as Response;
   if(url.endsWith("/members/requests"))return {ok:true,status:200,json:async()=>({requests:[{id:"request-1",request_title:"Source a widget",request_description:null,events:[
    {id:"event-received",sequence_no:1,stage:"submitted",member_note:"Request received.",created_at:"2026-10-10T00:00:00Z"},
    {id:"event-review",sequence_no:2,stage:"under_review",member_note:"We are confirming the specifications.",created_at:"2026-10-10T00:01:00Z"},
    {id:"event-sourcing",sequence_no:3,stage:"sourcing",member_note:"We are comparing supplier options.",created_at:"2026-10-10T00:02:00Z"},
    {id:"event-paid",sequence_no:4,stage:"purchase_confirmed",member_note:"Payment completed.",created_at:"2026-10-10T00:03:00Z"},
    {id:"event-warehouse",sequence_no:5,stage:"item_in_warehouse",member_note:"Quality check completed.",media:[{id:"media-1",url:"https://storage.example.test/signed/photo",content_type:"image/png",byte_size:100,original_filename:"warehouse.png",created_at:"2026-10-10T00:04:00Z"}],created_at:"2026-10-10T00:04:00Z"},
    {id:"event-shipped",sequence_no:6,stage:"shipped",member_note:"Your parcel has left the warehouse.",details:{carrier_name:"FayShip",tracking_number:"FF-TRACK-1",tracking_url:"https://tracking.example.test/FF-TRACK-1"},created_at:"2026-10-10T00:05:00Z"},
    {id:"event-transit",sequence_no:7,stage:"in_transit",member_note:"The parcel is moving through the carrier network.",created_at:"2026-10-10T00:06:00Z"},
    {id:"event-out-for-delivery",sequence_no:8,stage:"out_for_delivery",member_note:"Expected to arrive today.",created_at:"2026-10-10T00:07:00Z"},
    {id:"event-delivered",sequence_no:9,stage:"delivered",member_note:"Delivered to the requested address.",created_at:"2026-10-10T00:08:00Z"},
   ]}]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  window.history.replaceState({},"","/member/products");render(<App/>);
  expect(await screen.findByText("Purchase confirmed · paid")).toBeInTheDocument();
  expect(screen.getByText("We received your request and saved the details.")).toBeInTheDocument();
  expect(screen.getByText("The item has arrived at FayFort. A team member may add inspection photos or video.")).toBeInTheDocument();
  expect(screen.getByText("Delivery is marked complete.")).toBeInTheDocument();
  expect(screen.getByText(/Tracking number:/)).toHaveTextContent("FF-TRACK-1");
  expect(screen.getByRole("link",{name:"Track shipment with carrier"})).toHaveAttribute("href","https://tracking.example.test/FF-TRACK-1");
  expect(screen.getByRole("img",{name:"warehouse.png"})).toHaveAttribute("src","https://storage.example.test/signed/photo");
  expect(screen.getByText("Delivered to the requested address.")).toBeInTheDocument();
  expect(within(screen.getByRole("list",{name:"Update history for Source a widget"})).getAllByRole("listitem")).toHaveLength(9);
 });

 it("lets platform admins assign member requests to active workers",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith("/platform/requests"))return {ok:true,status:200,json:async()=>({requests:[{id:"request-1",request_title:"Source widget",product_name_snapshot:null,created_at:"2026-10-10T00:00:00Z",assigned_worker_id:null}],active_workers:[{user_id:"worker-1",email:"worker@example.com"}]}),headers:new Headers()} as Response;
   if(url.endsWith("/dashboard/businesses"))return {ok:true,status:200,json:async()=>({businesses:[business]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  render(<DashboardWorkspace accessToken="test-access-token" platformAdmin eventStreaming={false}/>);
  fireEvent.click(within(screen.getByRole("navigation",{name:"Main navigation"})).getByRole("button",{name:/Member Requests/}));
  const assignment=await screen.findByRole("combobox",{name:"Assign Source widget"});
  fireEvent.change(assignment,{target:{value:"worker-1"}});
  await waitFor(()=>expect(fetchMock.mock.calls.some(([input,init])=>String(input).includes("/platform/requests/request-1/assignment")&&init?.method==="PATCH")).toBe(true));
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
  expect(await screen.findByRole("alert")).toHaveTextContent("This link has expired or was already used");
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
 it("shows permanent module navigation and an explicit disabled-stream status",async()=>{renderWorkspace();expect(await screen.findByRole("heading",{name:"Overview"})).toBeInTheDocument();expect(screen.getByRole("combobox",{name:"Client account"})).toHaveValue("business-1");const nav=screen.getByRole("navigation",{name:"Main navigation"});expect(within(nav).getByRole("button",{name:/Conversations/})).toBeInTheDocument();expect(within(nav).getByRole("button",{name:/Verification/})).toBeInTheDocument();await waitFor(()=>expect(screen.getByText(/Events Disabled/)).toBeInTheDocument());});
 it("lets staff switch the Control Center to dark mode and back, remembered on this device",async()=>{
  window.localStorage.removeItem("fayfort.staffTheme");
  const view=renderWorkspace();
  fireEvent.click(await screen.findByRole("button",{name:"Switch to dark mode"}));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(window.localStorage.getItem("fayfort.staffTheme")).toBe("dark");
  fireEvent.click(screen.getByRole("button",{name:"Switch to light mode"}));
  expect(document.documentElement.dataset.theme).toBe("light");
  view.unmount();
  expect(document.documentElement.dataset.theme).toBeUndefined();
 });
 it("shows what the AI knows and lets staff add, edit and remove knowledge",async()=>{
  const docs=[{id:"d1",title:"Membership plans",content:"Standard costs $19 a month.",source_type:"manual",created_at:"2026-10-16T00:00:00Z"},{id:"d2",title:"Tone",content:"Warm, one question at a time.",source_type:"guide",created_at:"2026-10-16T00:00:00Z"}];
  const calls:{url:string;method:string;body?:string}[]=[];
  fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);const method=init?.method||"GET";
   if(url.includes("/knowledge"))calls.push({url,method,body:init?.body?String(init.body):undefined});
   if(url.endsWith("/dashboard/businesses"))return {ok:true,status:200,json:async()=>({businesses:[{business_id:"business-1",name:"FayFort Test Business",role:"owner"}]}),headers:new Headers()} as Response;
   if(url.endsWith("/business-1/knowledge")&&method==="GET")return {ok:true,status:200,json:async()=>({documents:docs}),headers:new Headers()} as Response;
   if(url.includes("/knowledge"))return {ok:true,status:200,json:async()=>({document:{}}),headers:new Headers()} as Response;
   if(url.endsWith("/faqs"))return {ok:true,status:200,json:async()=>({faqs:[]}),headers:new Headers()} as Response;
   return {ok:true,status:200,json:async()=>({}),headers:new Headers()} as Response;
  });
  renderWorkspace();
  fireEvent.click(within(await screen.findByRole("navigation",{name:"Main navigation"})).getByRole("button",{name:/Knowledge/}));
  const panel=await screen.findByRole("region",{name:"What the AI knows"});
  expect(await within(panel).findByText("Membership plans")).toBeInTheDocument();
  expect(within(panel).getByRole("heading",{name:/Conversation guide/})).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole("button",{name:"Add knowledge"}));
  const form=within(panel).getByRole("form",{name:"New knowledge"});
  fireEvent.change(within(form).getByLabelText("Title"),{target:{value:"Hours"}});
  fireEvent.change(within(form).getByLabelText("Type"),{target:{value:"guide"}});
  fireEvent.change(within(form).getByLabelText("Content"),{target:{value:"Monday to Saturday."}});
  fireEvent.click(within(form).getByRole("button",{name:"Save"}));
  await waitFor(()=>expect(calls.find(c=>c.method==="POST")?.body).toBe(JSON.stringify({title:"Hours",content:"Monday to Saturday.",source_type:"guide"})));
  fireEvent.click((await within(panel).findAllByRole("button",{name:"Remove"}))[0]);
  fireEvent.click(within(panel).getByRole("button",{name:"Yes, remove"}));
  await waitFor(()=>expect(calls.some(c=>c.method==="DELETE"&&c.url.endsWith("/knowledge/d1"))).toBe(true));
 });
 it("loads the Knowledge page and saves new FAQ content only as a draft",async()=>{
  renderWorkspace();
  fireEvent.click(within(await screen.findByRole("navigation",{name:"Main navigation"})).getByRole("button",{name:/Knowledge/}));
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
  const secondBusiness={business_id:"business-2",name:"Second Workspace"};
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
  expect(await screen.findByText("Handoff requested")).toBeInTheDocument();
  expect(screen.getAllByText("Handoff requested")).toHaveLength(1);
  expect(screen.queryByText("Old event")).not.toBeInTheDocument();
  expect(window.sessionStorage.getItem("fayfort.eventCursor.business-1")).toBe("12");
  fireEvent.change(screen.getByRole("combobox",{name:"Client account"}),{target:{value:"business-2"}});
  await waitFor(()=>expect(sockets).toHaveLength(2));sockets[1].onopen?.();
  expect(JSON.parse(sockets[1].sent[0])).toMatchObject({after_id:0});
  fireEvent.change(screen.getByRole("combobox",{name:"Client account"}),{target:{value:"business-1"}});
  await waitFor(()=>expect(sockets).toHaveLength(3));sockets[2].onopen?.();
  expect(JSON.parse(sockets[2].sent[0])).toMatchObject({after_id:12});
 });
 it("navigates between an operational module and overview",async()=>{renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Automations/}));expect(await screen.findByRole("region",{name:"Automation management"})).toBeInTheDocument();fireEvent.click(within(nav).getByRole("button",{name:/Overview/}));expect(screen.getByRole("heading",{name:"Overview"})).toBeInTheDocument();});
 it("loads Analytics and issues only one request when its time window changes",async()=>{
  const event={id:2,event_type:"settings.updated",entity_type:"business",entity_id:"business-1",payload:{},created_at:"2026-10-09T00:00:00Z"};
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{const url=String(input);const data=url.endsWith("/dashboard/businesses")?{businesses:[business]}:url.includes("/ai-usage?")?{days:7,sampled_requests:0,summary_truncated:false,reported_usage_requests:0,unknown_usage_requests:0,prompt_tokens:0,completion_tokens:0,total_tokens:0,source_messages:0,message_call_distribution:{},operations:{},models:{},providers:{},budget:{limit_usd:25,committed_usd:0,pending_usd:0,remaining_usd:25,month_start:"2026-10-01T00:00:00Z"}}:url.includes("/analytics?")?{days:Number(new URL(url).searchParams.get("days")),sampled_events:1,summary_truncated:false,event_counts:{"settings.updated":1},events:[event],has_more:false,next_before_id:null}:{};return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;});
  renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Analytics/}));
  await waitFor(()=>expect(screen.getAllByText("settings.updated")).toHaveLength(1));
  fireEvent.change(screen.getByRole("combobox",{name:"Analytics time window"}),{target:{value:"7"}});
  await waitFor(()=>expect(fetchMock.mock.calls.filter(([input])=>String(input).includes("/analytics?days=7&")).length).toBe(1));
  expect(screen.getByText("Business activity analytics")).toBeInTheDocument();
 });
 it("shows provider-reported AI token usage without presenting a dollar estimate",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{const url=String(input);const data=url.endsWith("/dashboard/businesses")?{businesses:[business]}:url.includes("/ai-usage?")?{days:30,sampled_requests:3,summary_truncated:false,reported_usage_requests:2,unknown_usage_requests:1,prompt_tokens:600,completion_tokens:250,total_tokens:850,source_messages:1,message_call_distribution:{"1":1,"2":1},operations:{intent:{calls:1,prompt_tokens:200,completion_tokens:40,total_tokens:240},response:{calls:2,prompt_tokens:400,completion_tokens:210,total_tokens:610}},models:{"openai/gpt-oss-120b":3},providers:{deepinfra:3},budget:{limit_usd:25,committed_usd:0.0012,pending_usd:0.0002,remaining_usd:24.9986,month_start:"2026-10-01T00:00:00Z"}}:url.includes("/analytics?")?{days:30,sampled_events:0,summary_truncated:false,event_counts:{},events:[],has_more:false,next_before_id:null}:{};return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;});
  renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Analytics/}));
  expect(await screen.findByText(/3 model requests · 1 source message/)).toBeInTheDocument();
  expect(screen.getByText(/850 tokens reported \(600 input, 250 output\)/)).toBeInTheDocument();
  expect(screen.getByText("$0.0012 used of $25.00 · $24.9986 left")).toBeInTheDocument();
  expect(screen.getByText("intent calls · 240 reported tokens")).toBeInTheDocument();
  expect(screen.getByText("Model calls per source message: 1 message with 1 call · 1 message with 2 calls")).toBeInTheDocument();
 });
 it("does not append a slow previous-window page after the Analytics window changes",async()=>{
  const event=(id:number,eventType:string)=>({id,event_type:eventType,entity_type:"business",entity_id:"business-1",payload:{},created_at:"2026-10-09T00:00:00Z"});
  let resolveOlder:(response:Response)=>void=()=>{};
  fetchMock.mockImplementation((input:RequestInfo|URL)=>{const url=String(input);if(url.endsWith("/dashboard/businesses"))return Promise.resolve({ok:true,status:200,json:async()=>({businesses:[business]}),headers:new Headers()} as Response);if(url.includes("/ai-usage?"))return Promise.resolve({ok:true,status:200,json:async()=>({days:url.includes("days=7")?7:30,sampled_requests:0,summary_truncated:false,reported_usage_requests:0,unknown_usage_requests:0,prompt_tokens:0,completion_tokens:0,total_tokens:0,source_messages:0,message_call_distribution:{},operations:{},models:{},providers:{},budget:{limit_usd:25,committed_usd:0,pending_usd:0,remaining_usd:25,month_start:"2026-10-01T00:00:00Z"}}),headers:new Headers()} as Response);if(url.includes("/analytics?")&&url.includes("before_id=50"))return new Promise<Response>(resolve=>{resolveOlder=resolve;});const data=url.includes("/analytics?")?url.includes("days=7")?{days:7,sampled_events:1,summary_truncated:false,event_counts:{"new-window.event":1},events:[event(100,"new-window.event")],has_more:false,next_before_id:null}:{days:30,sampled_events:1,summary_truncated:false,event_counts:{"initial-window.event":1},events:[event(50,"initial-window.event")],has_more:true,next_before_id:50}:{};return Promise.resolve({ok:true,status:200,json:async()=>data,headers:new Headers()} as Response);});
  renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Analytics/}));
  await waitFor(()=>expect(screen.getAllByText("initial-window.event")).toHaveLength(1));fireEvent.click(screen.getByRole("button",{name:"Load older activity"}));
  await waitFor(()=>expect(fetchMock.mock.calls.some(([input])=>String(input).includes("before_id=50"))).toBe(true));
  fireEvent.change(screen.getByRole("combobox",{name:"Analytics time window"}),{target:{value:"7"}});
  await waitFor(()=>expect(screen.getAllByText("new-window.event")).toHaveLength(1));
  resolveOlder({ok:true,status:200,json:async()=>({days:30,sampled_events:0,summary_truncated:false,event_counts:{},events:[event(1,"stale-page.event")],has_more:false,next_before_id:null}),headers:new Headers()} as Response);
  await waitFor(()=>expect(screen.queryByText("stale-page.event")).not.toBeInTheDocument());
  expect(screen.getAllByText("new-window.event")).toHaveLength(1);
 });
 it("shows connection setup without collecting provider credentials",async()=>{renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Connections/}));expect(await screen.findByText("No saved channel connections yet.")).toBeInTheDocument();expect(screen.getByPlaceholderText("Instagram support")).toBeInTheDocument();expect(screen.getByText(/Connect and verify provider accounts/)).toBeInTheDocument();});
 it("offers vaulted Facebook Messenger Page setup",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{const url=String(input);const data=url.endsWith("/dashboard/businesses")?{businesses:[business]}:url.endsWith("/connections")?{connections:[{id:"messenger-connection",provider:"messenger",display_name:"Facebook Support",status:"setup_required",credential_status:"not_configured",safe_settings:{inbound_enabled:true,outbound_enabled:false}}]}:{};return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;});
  renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Connections/}));
  fireEvent.click(await screen.findByRole("button",{name:"Add credentials"}));
  fireEvent.change(screen.getByLabelText("Meta App ID"),{target:{value:"meta-app"}});fireEvent.change(screen.getByLabelText("Meta App Secret"),{target:{value:"private-secret"}});fireEvent.change(screen.getByLabelText("Facebook Page ID"),{target:{value:"page-123"}});fireEvent.change(screen.getByLabelText("Page Access Token"),{target:{value:"private-page-token"}});
  fireEvent.click(screen.getByRole("button",{name:"Save credentials"}));
  await waitFor(()=>expect(fetchMock.mock.calls.some(([input,init])=>String(input).endsWith("/credentials/messenger")&&init?.method==="PUT")).toBe(true));
  expect(screen.queryByText("private-secret")).not.toBeInTheDocument();expect(screen.queryByText("private-page-token")).not.toBeInTheDocument();
 });
 it("keeps outbound and auto-replies unavailable until an Instagram connection is verified",async()=>{
  fetchMock.mockImplementation(async(input:RequestInfo|URL)=>{const url=String(input);const data=url.endsWith("/dashboard/businesses")?{businesses:[business]}:url.endsWith("/connections")?{connections:[{id:"connection-1",provider:"instagram",display_name:"Support",status:"setup_required",credential_status:"configured",safe_settings:{outbound_enabled:false,auto_reply_enabled:false}}]}:{};return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;});
  renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Connections/}));
  const outbound=await screen.findByRole("button",{name:"Enable outbound"});expect(outbound).toBeDisabled();expect(screen.queryByRole("button",{name:/auto-replies/i})).not.toBeInTheDocument();
 });
 it("shows automation rules begin disabled and test-only",async()=>{renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Automations/}));expect(await screen.findByText("No automations yet. New rules start disabled.")).toBeInTheDocument();expect(screen.getByText(/Test rules only record runs/)).toBeInTheDocument();});
 it("shows handoff controls and explains delivery status",async()=>{renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Human Agents/}));expect(await screen.findByText("No handoffs recorded.")).toBeInTheDocument();expect(screen.getByRole("combobox",{name:"Conversation"})).toBeInTheDocument();expect(screen.getByText(/delivery status appears in the conversation/)).toBeInTheDocument();});
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
  renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});
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
  renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Settings/}));
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
  const nav=await screen.findByRole("navigation",{name:"Main navigation"});
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
  renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Directory & Tools/}));
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
  renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Directory & Tools/}));
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
  renderWorkspace();const nav=await screen.findByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Directory & Tools/}));
  expect(await screen.findByRole("region",{name:"Products catalog"})).toBeInTheDocument();expect(await screen.findByText("Sample widget")).toBeInTheDocument();expect(screen.getByText(/Tools · available/)).toBeInTheDocument();expect(screen.getByRole("img",{name:"Sample widget preview"})).toHaveAttribute("src","https://cdn.example.test/widget.jpg");expect(screen.queryByRole("button",{name:"Add product"})).not.toBeInTheDocument();
 });
});
