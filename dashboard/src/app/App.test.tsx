import { cleanup,fireEvent,render,screen,waitFor,within } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { DashboardWorkspace } from "./App";

afterEach(()=>cleanup());
const business = { business_id:"business-1", name:"FayFort Test Workspace", role:"owner" };
beforeEach(()=>{
  const fetchMock=vi.fn(async (input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    let data:unknown={};
    if(url.endsWith("/dashboard/businesses")) data={businesses:[business]};
    else if(url.endsWith("/connections")) data={connections:[]};
    else if(url.endsWith("/automations")) data={automations:[]};
    else if(url.endsWith("/handoffs")) data={handoffs:[]};
    else if(url.includes("/events")) data={ticket:"ticket",expires_at:"2099-01-01T00:00:00Z"};
    else data={};
    return {ok:true,status:200,json:async()=>data,headers:new Headers()} as Response;
  });
  vi.stubGlobal("fetch",fetchMock);
});
afterEach(()=>vi.unstubAllGlobals());
const renderWorkspace=()=>render(<DashboardWorkspace accessToken="test-access-token" eventStreaming={false}/>);

describe("authenticated dashboard workspace",()=>{
 it("shows permanent module navigation and business membership",async()=>{renderWorkspace();expect(await screen.findByRole("heading",{name:"Overview"})).toBeInTheDocument();expect(screen.getByRole("combobox",{name:"Business workspace"})).toHaveValue("business-1");const nav=screen.getByRole("navigation",{name:"Main navigation"});expect(within(nav).getByRole("button",{name:/Conversations/})).toBeInTheDocument();expect(within(nav).getByRole("button",{name:/Verification/})).toBeInTheDocument();});
 it("navigates between an operational module and overview",async()=>{renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Automations/}));expect(await screen.findByRole("region",{name:"Automation management"})).toBeInTheDocument();fireEvent.click(within(nav).getByRole("button",{name:/Overview/}));expect(screen.getByRole("heading",{name:"Overview"})).toBeInTheDocument();});
 it("creates a connection through the authenticated business API without collecting credentials",async()=>{renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Connections/}));expect(await screen.findByText("No saved channel connections yet.")).toBeInTheDocument();expect(screen.getByPlaceholderText("Customer support")).toBeInTheDocument();expect(screen.getByText(/Provider credentials stay outside/)).toBeInTheDocument();});
 it("shows automation rules begin disabled and test-only",async()=>{renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Automations/}));expect(await screen.findByText("No automations yet. New rules start disabled.")).toBeInTheDocument();expect(screen.getByText(/does not send messages or change external systems/)).toBeInTheDocument();});
 it("shows handoff controls and explains delivery status",async()=>{renderWorkspace();const nav=screen.getByRole("navigation",{name:"Main navigation"});fireEvent.click(within(nav).getByRole("button",{name:/Human Agents/}));expect(await screen.findByText("No handoffs recorded.")).toBeInTheDocument();expect(screen.getByPlaceholderText("Conversation UUID")).toBeInTheDocument();expect(screen.getByText(/external delivery is not connected yet/)).toBeInTheDocument();});
});
