import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinishEmployment, MyReviews, ReviewForm, type Offboarding, type Review } from "./PeopleReviews";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));
const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;
const review: Review = { id: "r1", worker_id: "w2", kind: "probation", due_on: "2026-11-06", status: "open", self_review: "I learned the Baima suppliers.",
  self_submitted_at: "2026-11-02T00:00:00Z", scores: {}, manager_note: null, decision: null, completed_at: null };
const board: Offboarding = { worker_id: "w2", last_day: "2026-11-13", reason_kind: "resigned", reason_label: "Resigned", reason: "Moving", exit_note: null,
  open_work: 2, future_bookings: 1, deactivated_at: null, steps_list: [{ key: "equipment_returned", label: "Equipment returned (laptop, phone, keys)", done: false }] };

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/hr/reviews/r1/complete")) return ok({ review: { ...review, status: "completed", decision: "extend" } });
    if (url.includes("/hr/my/reviews/r1/self")) return ok({ review: { ...review, self_review: "Going well, I'd like more training on quality checks." } });
    if (url.includes("/offboarding")) return ok({ person: { offboarding: board } });
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Reviews and finishing employment", () => {
  it("completes a probation review with scores, a note and an extension", async () => {
    const done = vi.fn();
    render(<ReviewForm review={review} context={{ rating: 4.8, rating_count: 12, hours: 410.5, shifts: 58, finished_work: 96, leave_days: 2 }} name="Ben Li" accessToken="t" onDone={done} />);
    expect(screen.getByText("4.8 ★ (12)")).toBeInTheDocument();
    expect(screen.getByText("I learned the Baima suppliers.")).toBeInTheDocument();
    const finish = screen.getByRole("button", { name: "Finish the review" });
    for (const label of ["Speed: 3", "Care: 4", "Accuracy: 2"]) fireEvent.click(screen.getByRole("radio", { name: label }));
    fireEvent.change(screen.getByLabelText(/Note for Ben/), { target: { value: "Accuracy needs more care." } });
    expect(finish).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Extend" }));
    fireEvent.change(screen.getByLabelText("Extend by"), { target: { value: "2" } });
    fireEvent.click(finish);
    await waitFor(() => expect(done).toHaveBeenCalled());
    const sent = fetchMock.mock.calls.find(([url]) => String(url).includes("/complete"));
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ scores: { speed: 3, care: 4, accuracy: 2 }, note: "Accuracy needs more care.", decision: "extend", extend_months: 2 });
  });

  it("lets the person write their self-review", async () => {
    const changed = vi.fn();
    render(<MyReviews reviews={[review]} accessToken="t" onChanged={changed} />);
    fireEvent.change(screen.getByLabelText(/How is it going/), { target: { value: "Going well, I'd like more training on quality checks." } });
    fireEvent.click(screen.getByRole("button", { name: "Save my self-review" }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it("starts finishing employment and works through the checklist", async () => {
    const onPerson = vi.fn();
    const { rerender } = render(<FinishEmployment workerId="w2" name="Ben Li" offboarding={null} accessToken="t" isActive onPerson={onPerson} />);
    fireEvent.click(screen.getByRole("button", { name: "Finish employment…" }));
    fireEvent.change(screen.getByLabelText("Last day"), { target: { value: "2026-11-13" } });
    fireEvent.click(screen.getByRole("button", { name: "Start finishing employment" }));
    await waitFor(() => expect(onPerson).toHaveBeenCalledWith({ offboarding: board }));
    rerender(<FinishEmployment workerId="w2" name="Ben Li" offboarding={board} accessToken="t" isActive onPerson={onPerson} />);
    expect(screen.getByText("2 pieces of open work")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hand back to the desks" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Equipment returned/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/hr/people/w2/offboarding"), expect.objectContaining({ method: "PUT", body: JSON.stringify({ steps: { equipment_returned: true } }) })));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/offboarding/release"), expect.objectContaining({ method: "POST" }));
  });
});
