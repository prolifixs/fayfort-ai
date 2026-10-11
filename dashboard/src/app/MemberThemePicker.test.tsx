import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const previewMemberTheme = vi.fn();
const exitMemberThemePreview = vi.fn();
vi.mock("./MemberThemeRuntime", () => ({ previewMemberTheme: (id: string) => previewMemberTheme(id), exitMemberThemePreview: () => exitMemberThemePreview() }));
import { MemberThemePicker } from "./MemberThemePicker";

const catalog = { member_tier: "free", selected_theme: "base", themes: [
 { theme_id: "base", display_name: "FayFort base", description: "Standard", requires_paid: false, can_apply: true, is_current: true },
 { theme_id: "spring-dawn", display_name: "Spring Dawn", description: "A soft green theme", requires_paid: true, can_apply: false, is_current: false },
] };

describe("MemberThemePicker", () => {
 afterEach(() => { cleanup(); vi.restoreAllMocks(); previewMemberTheme.mockClear(); exitMemberThemePreview.mockClear(); });
 it("lets a Free member preview a published paid theme but does not enable apply", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(catalog), { status: 200, headers: { "Content-Type": "application/json" } }));
  render(<MemberThemePicker accessToken="member-token" onApplied={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Browse themes" }));
  expect(await screen.findByText("Spring Dawn")).toBeInTheDocument();
  expect(screen.getByText("Standard or Pro required to apply")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Apply$/ })).toBeDisabled();
  fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[1]);
  await waitFor(() => expect(previewMemberTheme).toHaveBeenCalledWith("spring-dawn"));
 });
});
