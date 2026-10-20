import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const previewMemberTheme = vi.fn();
const exitMemberThemePreview = vi.fn();
vi.mock("./MemberThemeRuntime", () => ({ previewMemberTheme: (id: string) => previewMemberTheme(id), exitMemberThemePreview: () => exitMemberThemePreview() }));
import { MemberThemePicker } from "./MemberThemePicker";

const navy = { page_background: "#0B1A33", surface: "#12264A", text: "#EAF1FB", muted_text: "#A9BCD8", accent: "#4FA3FF", accent_foreground: "#06122A", border: "#3A5A8C", focus: "#7CC0FF" };
const catalog = { member_tier: "free", selected_theme: "base", themes: [
 { theme_id: "base", display_name: "FayFort base", description: "Standard", requires_paid: false, can_apply: true, is_current: true },
 { theme_id: "koko-water", display_name: "Importer, Exporter, Koko Water", description: "Deep navy", requires_paid: true, can_apply: false, is_current: false,
   design: { palette_preset: "koko-water-navy", wrapper_style: "soft", colors: navy, font_family: "montserrat" } },
] };
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

describe("MemberThemePicker", () => {
 afterEach(() => { cleanup(); vi.restoreAllMocks(); previewMemberTheme.mockClear(); exitMemberThemePreview.mockClear(); });
 it("draws every theme, shows the one you pick large, and lets a Free member try a paid theme but not use it", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => json(catalog));
  render(<MemberThemePicker accessToken="member-token" onApplied={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Browse themes" }));
  const list = await screen.findByRole("radiogroup", { name: "Themes" });
  expect(within(list).getAllByRole("img")).toHaveLength(2);
  expect(screen.getByRole("radio", { name: /FayFort base/ })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("button", { name: "Your theme" })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /Koko Water/ }));
  expect(screen.getByRole("heading", { name: "Importer, Exporter, Koko Water" })).toBeInTheDocument();
  expect(screen.getAllByRole("img", { name: /Koko Water: preview/ })[0]).toHaveClass("tp-dark", "tp-stage");
  expect(screen.getByText("Montserrat")).toBeInTheDocument();
  expect(screen.getByText("Dark")).toBeInTheDocument();
  expect(screen.getByText(/Standard or Pro required to use this theme/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Use this theme" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Try it for 15 seconds" }));
  await waitFor(() => expect(previewMemberTheme).toHaveBeenCalledWith("koko-water"));
 });
 it("saves a theme the member can use", async () => {
  const paid = { ...catalog, member_tier: "pro", themes: catalog.themes.map((theme) => ({ ...theme, can_apply: true })) };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
   init?.method === "PUT" ? json({ selected_theme: "koko-water" }) : json(paid));
  const onApplied = vi.fn();
  render(<MemberThemePicker accessToken="member-token" onApplied={onApplied} />);
  fireEvent.click(screen.getByRole("button", { name: "Browse themes" }));
  fireEvent.click(await screen.findByRole("radio", { name: /Koko Water/ }));
  fireEvent.click(screen.getByRole("button", { name: "Use this theme" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledWith("koko-water"));
  expect(await screen.findByText("Importer, Exporter, Koko Water is now your theme.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Your theme" })).toBeDisabled();
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/members/me/theme") && init?.method === "PUT")).toBe(true);
 });
});

describe("MemberThemePicker try limit", () => {
 afterEach(() => { cleanup(); vi.restoreAllMocks(); previewMemberTheme.mockClear(); });
 it("starts each try on the server, shows the tries left, and stops at three an hour", async () => {
  let left = 1;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
   if (String(input).endsWith("/members/themes/koko-water/try") && init?.method === "POST") {
    if (left === 0) return new Response(JSON.stringify({ detail: { message: "You've used your 3 theme tries for this hour.", retry_at: "2026-10-19T19:00:00Z" } }), { status: 429, headers: { "Content-Type": "application/json" } });
    left -= 1;
    return json({ theme_id: "koko-water", until: new Date(Date.now() + 15000).toISOString(), tries: { limit: 3, left, next_at: left === 0 ? "2026-10-19T19:00:00Z" : null, seconds: 15 } });
   }
   return json({ ...catalog, tries: { limit: 3, left, next_at: null, seconds: 15 } });
  });
  render(<MemberThemePicker accessToken="member-token" onApplied={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Browse themes" }));
  fireEvent.click(await screen.findByRole("radio", { name: /Koko Water/ }));
  expect(screen.getByText("1 of 3 tries left this hour.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try it for 15 seconds" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/try") && init?.method === "POST")).toBe(true));
  await waitFor(() => expect(previewMemberTheme).toHaveBeenCalled());
  expect(previewMemberTheme.mock.calls.at(-1)?.[0]).toBe("koko-water");
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/try") && init?.method === "POST")).toBe(true);
  // Reopen: no tries left.
  fireEvent.click(screen.getByRole("button", { name: "Browse themes" }));
  fireEvent.click(await screen.findByRole("radio", { name: /Koko Water/ }));
  expect(screen.getByText(/No tries left this hour. Next try at/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try it for 15 seconds" })).toBeDisabled();
 });
});
