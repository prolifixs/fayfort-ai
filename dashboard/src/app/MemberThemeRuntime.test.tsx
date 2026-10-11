import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase",()=>({supabaseClient:{auth:{getSession:vi.fn(async()=>({data:{session:{access_token:"member-token"}}})),onAuthStateChange:vi.fn(()=>({data:{subscription:{unsubscribe:vi.fn()}}}))}}}));
import { MEMBER_THEME_PREVIEW_SESSION_KEY, MemberThemeRuntime } from "./MemberThemeRuntime";

const base={theme_id:"base",display_name:"FayFort base",design:{palette_preset:"ocean-blue",wrapper_style:"soft",colors:{page_background:"#FFFFFF",surface:"#F7F9FA",text:"#17212B",muted_text:"#526170",accent:"#005A9C",accent_foreground:"#FFFFFF",border:"#637180",focus:"#005A9C"}}};
const preview={theme_id:"spring-dawn",display_name:"Spring Dawn",revision:2,design:{palette_preset:"forest-green",wrapper_style:"framed",colors:{page_background:"#F6FAF7",surface:"#FFFFFF",text:"#15251D",muted_text:"#4D6257",accent:"#17633E",accent_foreground:"#FFFFFF",border:"#61796B",focus:"#17633E"}}};

describe("MemberThemeRuntime",()=>{
 afterEach(()=>{cleanup();vi.restoreAllMocks();sessionStorage.clear();});

 it("applies a session-only preview across the member shell and restores saved theme on exit",async()=>{
  sessionStorage.setItem(MEMBER_THEME_PREVIEW_SESSION_KEY,"spring-dawn");
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async(input)=>{
   if(String(input).endsWith("/members/themes/spring-dawn/preview"))return new Response(JSON.stringify(preview),{status:200,headers:{"Content-Type":"application/json"}});
   return new Response(JSON.stringify({selected_theme:"base",active_theme:base,fallback_reason:null}),{status:200,headers:{"Content-Type":"application/json"}});
  });
  const {container}=render(<MemberThemeRuntime><main className="member-chat-page">Member screen</main></MemberThemeRuntime>);
  expect(await screen.findByText("Previewing Spring Dawn")).toBeInTheDocument();
  expect(container.querySelector(".member-theme-runtime")).toHaveAttribute("data-theme-id","spring-dawn");
  expect(container.querySelector(".member-theme-runtime")).toHaveAttribute("data-theme-preview","true");
  expect(container.querySelector(".member-theme-runtime")).toHaveClass("member-theme-wrapper-framed");
  expect(container.querySelector(".member-theme-runtime")).toHaveStyle({"--member-accent":"#17633E"});
  fireEvent.click(screen.getByRole("button",{name:"Exit preview"}));
  await waitFor(()=>expect(container.querySelector(".member-theme-runtime")).toHaveAttribute("data-theme-id","base"));
  expect(container.querySelector(".member-theme-runtime")).toHaveAttribute("data-theme-preview","false");
  expect(sessionStorage.getItem(MEMBER_THEME_PREVIEW_SESSION_KEY)).toBeNull();
  expect(fetchMock.mock.calls.some(([,init])=>["POST","PUT","DELETE"].includes(init?.method||""))).toBe(false);
 });
});
