import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeStudioPage } from "./ThemeStudioPage";

const baseTheme={theme_id:"base",display_name:"FayFort base",description:"Standard appearance",status:"published",requires_paid:false,is_builtin:true,draft_revision:null,published_revision:null,draft:null,published:null};
const draftTheme={theme_id:"spring-dawn",display_name:"Spring Dawn",description:null,draft_display_name:"Spring Dawn",draft_description:null,status:"draft",requires_paid:true,is_builtin:false,draft_revision:1,published_revision:null,draft:null,published:null};
const publishedTheme={...draftTheme,status:"published",published_revision:1};

describe("ThemeStudioPage",()=>{
 afterEach(()=>{cleanup();vi.restoreAllMocks();});

 it("creates a private draft using semantic colors and paid eligibility",async()=>{
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async(_input,init)=>{
   if(init?.method==="POST")return new Response(JSON.stringify({theme:{theme_id:"spring-dawn",draft_revision:1}}),{status:201,headers:{"Content-Type":"application/json"}});
   return new Response(JSON.stringify({themes:[baseTheme]}),{status:200,headers:{"Content-Type":"application/json"}});
  });
  render(<ThemeStudioPage accessToken="admin-token"/>);
  await screen.findByText("FayFort base");
  fireEvent.click(screen.getByRole("button",{name:"New theme"}));
  fireEvent.change(screen.getByPlaceholderText("spring-dawn"),{target:{value:"spring-dawn"}});
  fireEvent.change(screen.getByLabelText("Display name"),{target:{value:"Spring Dawn"}});
  fireEvent.click(screen.getByRole("button",{name:"Create draft"}));
  await screen.findByText("Theme draft created. It is private until published.");
  await waitFor(()=>expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(true));
  const write=fetchMock.mock.calls.find(([,init])=>init?.method==="POST");
  expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({theme_id:"spring-dawn",display_name:"Spring Dawn",design:{palette_preset:"ocean-blue",wrapper_style:"soft"}});
  expect(screen.getByRole("img",{name:/Spring Dawn: preview of the member app/})).toBeInTheDocument();
 });

 it("requires explicit confirmation before publishing to members",async()=>{
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async(_input,init)=>{
   if(init?.method==="POST")return new Response(JSON.stringify({theme_id:"spring-dawn",status:"published"}),{status:200,headers:{"Content-Type":"application/json"}});
   return new Response(JSON.stringify({themes:[baseTheme,draftTheme]}),{status:200,headers:{"Content-Type":"application/json"}});
  });
  render(<ThemeStudioPage accessToken="admin-token"/>);
  fireEvent.click(await screen.findByRole("button",{name:/Spring Dawn/}));
  fireEvent.click(screen.getByRole("button",{name:"Publish draft"}));
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("available in the member theme catalog");
  expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Publish draft"}));
  fireEvent.click(await screen.findByRole("button",{name:"Confirm publish"}));
  await waitFor(()=>expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(true));
 });

 it("explains permanent archive and waits for explicit confirmation",async()=>{
  const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async(_input,init)=>{
   if(init?.method==="POST")return new Response(JSON.stringify({theme_id:"spring-dawn",status:"archived"}),{status:200,headers:{"Content-Type":"application/json"}});
   return new Response(JSON.stringify({themes:[baseTheme,publishedTheme]}),{status:200,headers:{"Content-Type":"application/json"}});
  });
  render(<ThemeStudioPage accessToken="admin-token"/>);
  fireEvent.click(await screen.findByRole("button",{name:/Spring Dawn/}));
  await screen.findByText(/Status:/);
  fireEvent.click(await screen.findByRole("button",{name:"Archive theme"}));
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("can be republished later");
  expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Confirm archive"}));
  await waitFor(()=>expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(true));
 });
});
