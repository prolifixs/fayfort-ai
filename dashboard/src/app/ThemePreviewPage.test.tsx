import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase",()=>({dashboardAuthConfigured:true,supabaseClient:{auth:{getSession:vi.fn(async()=>({data:{session:{access_token:"admin-token"}}}))}}}));
import { ThemePreviewPage } from "./ThemePreviewPage";

const theme={theme_id:"spring-dawn",display_name:"Spring Dawn",description:"A sample theme",status:"draft",draft_revision:2,published_revision:1,draft:{palette_preset:"forest-green",wrapper_style:"framed",colors:{page_background:"#F6FAF7",surface:"#FFFFFF",text:"#15251D",muted_text:"#4D6257",accent:"#17633E",accent_foreground:"#FFFFFF",border:"#61796B",focus:"#17633E"}},published:null};

describe("ThemePreviewPage",()=>{
 afterEach(()=>{cleanup();vi.restoreAllMocks();window.history.replaceState({},"","/");});

 it("shows private synthetic member pages using the selected draft without writes",async()=>{
  window.history.replaceState({},"","/platform/themes/preview?theme=spring-dawn");
  const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({themes:[theme]}),{status:200,headers:{"Content-Type":"application/json"}}));
  render(<ThemePreviewPage/>);
  expect(await screen.findByText("PRIVATE PLATFORM-ADMIN PREVIEW")).toBeInTheDocument();
  expect(screen.getByText("Synthetic demo member")).toBeInTheDocument();
  expect(screen.getByText("I’m looking for a compact blue ceramic mug.")).toBeInTheDocument();
  expect(document.querySelector(".theme-preview-screen")).toHaveStyle({"--preview-accent":"#17633E"});
  fireEvent.click(screen.getByRole("button",{name:"Request timeline"}));
  expect(screen.getByRole("region",{name:"Request timeline preview"})).toBeInTheDocument();
  expect(screen.getByText("Harbor Blue Stoneware Mug")).toBeInTheDocument();
  await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({Authorization:"Bearer admin-token"});
  expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST"||init?.method==="PUT"||init?.method==="DELETE")).toBe(false);
 });

 it("shows the server denial when the current account is not a platform admin",async()=>{
  window.history.replaceState({},"","/platform/themes/preview?theme=spring-dawn");
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({detail:"A FayFort platform administrator is required."}),{status:403,headers:{"Content-Type":"application/json"}}));
  render(<ThemePreviewPage/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("A FayFort platform administrator is required.");
  expect(screen.queryByText("Synthetic demo member")).not.toBeInTheDocument();
 });
});
