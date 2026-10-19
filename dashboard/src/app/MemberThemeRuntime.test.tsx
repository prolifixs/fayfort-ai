import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase",()=>({supabaseClient:{auth:{getSession:vi.fn(async()=>({data:{session:{access_token:"member-token"}}})),onAuthStateChange:vi.fn(()=>({data:{subscription:{unsubscribe:vi.fn()}}}))}}}));
import { MEMBER_THEME_PREVIEW_SESSION_KEY, MemberThemeRuntime, previewMemberTheme } from "./MemberThemeRuntime";

const base={theme_id:"base",display_name:"FayFort base",design:{palette_preset:"ocean-blue",wrapper_style:"soft",colors:{page_background:"#FFFFFF",surface:"#F7F9FA",text:"#17212B",muted_text:"#526170",accent:"#005A9C",accent_foreground:"#FFFFFF",border:"#637180",focus:"#005A9C"}}};
const preview={theme_id:"spring-dawn",display_name:"Spring Dawn",revision:2,design:{palette_preset:"forest-green",wrapper_style:"framed",colors:{page_background:"#F6FAF7",surface:"#FFFFFF",text:"#15251D",muted_text:"#4D6257",accent:"#17633E",accent_foreground:"#FFFFFF",border:"#61796B",focus:"#17633E"}}};

describe("MemberThemeRuntime",()=>{
 afterEach(()=>{cleanup();vi.restoreAllMocks();sessionStorage.clear();});

 it("applies a session-only preview across the member shell and restores saved theme on exit",async()=>{
  sessionStorage.setItem(MEMBER_THEME_PREVIEW_SESSION_KEY,JSON.stringify({theme_id:"spring-dawn",until:Date.now()+15000}));
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async(input)=>{
   if(String(input).endsWith("/members/themes/spring-dawn/preview"))return new Response(JSON.stringify(preview),{status:200,headers:{"Content-Type":"application/json"}});
   return new Response(JSON.stringify({selected_theme:"base",active_theme:base,fallback_reason:null}),{status:200,headers:{"Content-Type":"application/json"}});
  });
  const {container}=render(<MemberThemeRuntime><main className="member-chat-page">Member screen</main></MemberThemeRuntime>);
  expect(await screen.findByText("Previewing Spring Dawn")).toBeInTheDocument();
  expect(screen.getByLabelText(/seconds left/)).toHaveTextContent(/1[45]s/);
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

 it("ends a try-on after 15 seconds for everyone and goes back to the saved theme",async()=>{
  const json=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}});
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input)=>String(input).endsWith("/members/themes/spring-dawn/preview")?json(preview):json({selected_theme:"base",active_theme:base,fallback_reason:null}));
  const {container}=render(<MemberThemeRuntime><main>Member screen</main></MemberThemeRuntime>);
  const runtime=()=>container.querySelector(".member-theme-runtime");
  await waitFor(()=>expect(runtime()).toHaveAttribute("data-theme-id","base"));
  vi.useFakeTimers({shouldAdvanceTime:true});
  try{
   previewMemberTheme("spring-dawn");
   await waitFor(()=>expect(runtime()).toHaveAttribute("data-theme-id","spring-dawn"));
   vi.advanceTimersByTime(14_000);
   expect(runtime()).toHaveAttribute("data-theme-preview","true");
   vi.advanceTimersByTime(1_500);
   await waitFor(()=>expect(runtime()).toHaveAttribute("data-theme-id","base"));
   expect(screen.getByText(/Preview of Spring Dawn ended/)).toBeInTheDocument();
   expect(sessionStorage.getItem(MEMBER_THEME_PREVIEW_SESSION_KEY)).toBeNull();
  }finally{vi.useRealTimers();}
 });

 it("does not restart the clock on reload: an expired or old open-ended try-on is dropped",async()=>{
  const json=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}});
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>json({selected_theme:"base",active_theme:base,fallback_reason:null}));
  sessionStorage.setItem(MEMBER_THEME_PREVIEW_SESSION_KEY,JSON.stringify({theme_id:"spring-dawn",until:Date.now()-1}));
  const first=render(<MemberThemeRuntime><main>A</main></MemberThemeRuntime>);
  await waitFor(()=>expect(first.container.querySelector(".member-theme-runtime")).toHaveAttribute("data-theme-preview","false"));
  first.unmount();
  sessionStorage.setItem(MEMBER_THEME_PREVIEW_SESSION_KEY,"spring-dawn");
  const second=render(<MemberThemeRuntime><main>B</main></MemberThemeRuntime>);
  await waitFor(()=>expect(sessionStorage.getItem(MEMBER_THEME_PREVIEW_SESSION_KEY)).toBeNull());
  expect(second.container.querySelector(".member-theme-runtime")).toHaveAttribute("data-theme-id","base");
  expect(fetchMock.mock.calls.some(([input])=>String(input).includes("/preview"))).toBe(false);
 });

 it("sends a paid member back to their own saved theme, not FayFort base, when the try-on ends",async()=>{
  const json=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}});
  const saved={theme_id:"girl-boss",display_name:"Girl Boss",revision:2,design:{...base.design,colors:{...base.design.colors,accent:"#D6247A"}}};
  vi.spyOn(globalThis,"fetch").mockImplementation(async(input)=>String(input).endsWith("/members/themes/spring-dawn/preview")?json(preview):json({selected_theme:"girl-boss",active_theme:saved,fallback_reason:null}));
  const {container}=render(<MemberThemeRuntime><main>Member screen</main></MemberThemeRuntime>);
  const runtime=()=>container.querySelector(".member-theme-runtime");
  await waitFor(()=>expect(runtime()).toHaveAttribute("data-theme-id","girl-boss"));
  vi.useFakeTimers({shouldAdvanceTime:true});
  try{
   previewMemberTheme("spring-dawn");
   await waitFor(()=>expect(runtime()).toHaveAttribute("data-theme-id","spring-dawn"));
   vi.advanceTimersByTime(15_500);
   await waitFor(()=>expect(runtime()).toHaveAttribute("data-theme-id","girl-boss"));
  }finally{vi.useRealTimers();}
 });
});
