import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberIdentityGate } from "./MemberIdentity";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

describe("required name card", () => {
 afterEach(() => { cleanup(); vi.restoreAllMocks(); });
 it("prefills from the sign-in, checks the username, and can't be finished without all three", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
   const url = String(input);
   if (url.endsWith("/members/me/identity") && init?.method === "PUT") return json({ first_name: "Amaka", last_name: "Obi", username: "amaka.obi", display_name: "Amaka Obi", complete: true });
   if (url.endsWith("/members/me/identity")) return json({ first_name: null, last_name: null, username: null, complete: false, suggestion: { first_name: "Amaka", last_name: "", username: "" } });
   if (url.includes("/members/me/username?u=taken")) return json({ username: "taken", available: false, reason: "That username is taken." });
   if (url.includes("/members/me/username")) return json({ username: "amaka.obi", available: true, reason: null });
   return json({});
  });
  const onDone = vi.fn();
  render(<MemberIdentityGate accessToken="t" onDone={onDone} />);
  expect(screen.getByRole("dialog", { name: "Tell us who you are" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  await waitFor(() => expect(screen.getByLabelText("First name")).toHaveValue("Amaka"));
  const save = screen.getByRole("button", { name: "Save and continue" });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Surname"), { target: { value: "Obi" } });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "taken" } });
  expect(await screen.findByText("That username is taken.")).toBeInTheDocument();
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Amaka.Obi" } });
  expect(await screen.findByText("@amaka.obi is free.")).toBeInTheDocument();
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ username: "amaka.obi", display_name: "Amaka Obi" })));
  const put = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/members/me/identity") && init?.method === "PUT")!;
  expect(JSON.parse(String(put[1]!.body))).toEqual({ first_name: "Amaka", last_name: "Obi", username: "amaka.obi" });
 });
});
