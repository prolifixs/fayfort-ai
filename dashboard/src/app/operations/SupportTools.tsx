import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { ToolCard } from "./Desks";
import { statusLabel, type WorkItem } from "./types";
import "./support.css";

/** Member support desk cards and the dispute case file (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R5). */

type InvoiceRow = { id: string; member_name: string; title: string; amount: number | string; currency: string; status: string; kind: string; error?: string | null; sent_at?: string | null; work_item_id?: string | null };
type GiveawayRow = { id: string; title: string; prize?: string | null; ends_at: string; winners?: number | null; entries: number; work_item_id?: string | null };
type SupportOverview = { failed_invoices: InvoiceRow[]; unpaid_invoices: InvoiceRow[]; unpaid_days: number; giveaways_to_draw: GiveawayRow[]; giveaways_running: GiveawayRow[] };
type BookingRow = { id: string; kind: string; status: string; starts_at: string; member_name: string; host: { name: string }; topic?: string | null };

const money = (amount: number | string | null | undefined, currency?: string | null) =>
  amount === null || amount === undefined ? "—" : `${Number(amount).toFixed(2)} ${currency || ""}`.trim();
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export function useSupportOverview(token: string | null, enabled: boolean, reloadKey: unknown) {
  const [data, setData] = useState<SupportOverview | null>(null);
  useEffect(() => {
    if (!token || !enabled) return;
    let alive = true;
    apiRequest<SupportOverview>("/operations/member-support/overview", token)
      .then((found) => {
        if (alive && Array.isArray(found?.failed_invoices)) setData(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [token, enabled, reloadKey]);
  return data;
}

export function BookingsTodayCard({ token, enabled, reloadKey, onOpen }: { token: string; enabled: boolean; reloadKey: unknown; onOpen: () => void }) {
  const [bookings, setBookings] = useState<BookingRow[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    apiRequest<{ bookings: BookingRow[] }>("/operations/bookings?view=today", token)
      .then((found) => {
        if (alive && Array.isArray(found?.bookings)) setBookings(found.bookings.filter((row) => row.status !== "cancelled"));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [token, enabled, reloadKey]);
  return (
    <ToolCard title="Bookings today" line="Consultations with the CEO and China tours." count={bookings?.length} countLabel="today" onOpen={onOpen} openLabel="Open bookings and tours">
      {bookings && bookings.length === 0 && <p className="operations-muted">Nothing booked today.</p>}
      {bookings && bookings.length > 0 && (
        <ul className="ops-tool-list">
          {bookings.slice(0, 5).map((booking) => (
            <li key={booking.id}>
              <div>
                <strong>
                  {booking.kind === "tour" ? day(booking.starts_at) : time(booking.starts_at)} · {booking.member_name}
                </strong>
                <small>
                  {booking.kind === "tour" ? "China tour" : booking.kind === "session" ? "Session" : "Consultation"} with {booking.host.name}
                  {booking.status === "held" ? " · not confirmed yet" : ""}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ToolCard>
  );
}

export function InvoicesCard({ data, onOpen }: { data: SupportOverview | null; onOpen: (workItemId: string) => void }) {
  const failed = data?.failed_invoices || [];
  const unpaid = data?.unpaid_invoices || [];
  return (
    <ToolCard title="Invoices" line={`Invoices that failed to send, and ones unpaid after ${data?.unpaid_days ?? 3} days (a friendly nudge in the chat helps).`} count={failed.length + unpaid.length} countLabel="to look at">
      {data && failed.length + unpaid.length === 0 && <p className="operations-muted">Every invoice went out and nothing is overdue.</p>}
      {failed.length + unpaid.length > 0 && (
        <ul className="ops-tool-list">
          {[...failed, ...unpaid].slice(0, 6).map((invoice) => (
            <li key={invoice.id}>
              <div>
                <strong>
                  {invoice.member_name} · {money(invoice.amount, invoice.currency)}
                </strong>
                <small className={invoice.status === "failed" ? "ops-tool-warn" : undefined}>
                  {invoice.status === "failed" ? `Didn't send${invoice.error ? `: ${invoice.error}` : ""}` : `Unpaid since ${day(invoice.sent_at)}`} · {invoice.title}
                </small>
              </div>
              {invoice.work_item_id && (
                <button type="button" className="secondary-button" onClick={() => onOpen(invoice.work_item_id!)}>
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </ToolCard>
  );
}

export function GiveawaysCard({ data, onOpen }: { data: SupportOverview | null; onOpen: (workItemId: string) => void }) {
  const toDraw = data?.giveaways_to_draw || [];
  const running = data?.giveaways_running || [];
  return (
    <ToolCard title="Giveaways" line="Giveaways that ended and need their winners drawn, and the ones still running." count={toDraw.length} countLabel="to draw">
      {data && toDraw.length + running.length === 0 && <p className="operations-muted">No giveaways right now.</p>}
      {toDraw.length + running.length > 0 && (
        <ul className="ops-tool-list">
          {toDraw.map((giveaway) => (
            <li key={giveaway.id}>
              <div>
                <strong>{giveaway.title}</strong>
                <small className="ops-tool-warn">
                  Ended {day(giveaway.ends_at)} · {giveaway.entries} entries · draw {giveaway.winners || 1}
                </small>
              </div>
              {giveaway.work_item_id && (
                <button type="button" className="secondary-button" onClick={() => onOpen(giveaway.work_item_id!)}>
                  Draw
                </button>
              )}
            </li>
          ))}
          {running.slice(0, 4).map((giveaway) => (
            <li key={giveaway.id}>
              <div>
                <strong>{giveaway.title}</strong>
                <small>
                  Running until {day(giveaway.ends_at)} · {giveaway.entries} entries so far
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ToolCard>
  );
}

// ---------------------------------------------------------------------------------------------
// The dispute case file
// ---------------------------------------------------------------------------------------------
type CaseFileData = {
  kind: "order_dispute" | "card_dispute";
  member: { name: string; profile: Record<string, string | number | null | undefined> } | null;
  order: {
    title: string;
    description?: string | null;
    stage?: string | null;
    eta_at?: string | null;
    requested_at?: string | null;
    chosen?: { product_name: string; price_amount?: number | null; currency?: string | null; product_url?: string | null } | null;
    timeline: { stage: string; note?: string | null; at: string }[];
  } | null;
  dispute: { amount: number; currency: string; reason?: string | null; status: string; evidence_due_by?: string | null; opened_at?: string | null } | null;
  payments: { title: string; kind?: string; amount: number | string; currency: string; status: string; paid_at?: string | null; sent_at?: string | null; disputed?: boolean }[];
  links: { label: string; url: string }[];
  chat: { id: string; title?: string; messages: { id: string; sender_type: string; content: string; created_at: string }[] } | null;
  chat_locked: boolean;
};

export function isDisputeItem(item: WorkItem) {
  return item.department === "disputes" || item.work_type === "dispute_case" || item.work_type === "membership_dispute";
}

export function CaseFile({ token, item }: { token: string; item: WorkItem }) {
  const [data, setData] = useState<CaseFileData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none" | "failed">("loading");
  useEffect(() => {
    let alive = true;
    setState("loading");
    apiRequest<{ case_file: CaseFileData | null }>(`/operations/work-items/${item.id}/case-file`, token)
      .then((found) => {
        if (!alive) return;
        setData(found.case_file);
        setState(found.case_file ? "ready" : "none");
      })
      .catch(() => alive && setState("failed"));
    return () => {
      alive = false;
    };
  }, [token, item.id, item.assigned_worker_id]);
  if (state === "loading") return <p className="operations-muted">Loading the case file…</p>;
  if (state === "failed") return <p className="form-error" role="alert">The case file couldn't be loaded. Refresh to try again.</p>;
  if (!data) return null;
  const plan = data.member?.profile?.member_tier;
  return (
    <section className="operations-detail-section ops-case-file" aria-label="Case file">
      <header className="ops-case-head">
        <div>
          <h3>Case file</h3>
          <p>
            {data.member?.name || "Member"}
            {plan ? ` · ${String(plan).charAt(0).toUpperCase()}${String(plan).slice(1)} plan` : ""}
            {data.kind === "card_dispute" ? " · card dispute on a membership payment" : " · order dispute"}
          </p>
        </div>
        {data.links.length > 0 && (
          <div className="ops-case-links">
            {data.links.map((link) => (
              <a key={link.url} className="secondary-button" href={link.url} target="_blank" rel="noreferrer">
                {link.label} ↗
              </a>
            ))}
          </div>
        )}
      </header>
      <div className="ops-case-grid">
        <section aria-label={data.kind === "card_dispute" ? "The dispute" : "The order"}>
          {data.kind === "card_dispute" && data.dispute ? (
            <>
              <h4>The dispute</h4>
              <dl className="ops-case-facts">
                <div><dt>Amount</dt><dd>{money(data.dispute.amount, data.dispute.currency)}</dd></div>
                <div><dt>Bank's reason</dt><dd>{statusLabel(data.dispute.reason || "unknown")}</dd></div>
                <div><dt>Status</dt><dd>{statusLabel(data.dispute.status)}</dd></div>
                <div><dt>Answer by</dt><dd className={data.dispute.evidence_due_by ? "ops-tool-warn" : undefined}>{data.dispute.evidence_due_by ? new Date(data.dispute.evidence_due_by).toLocaleString() : "—"}</dd></div>
              </dl>
              <p className="operations-muted">Answer it in Stripe with the evidence: the member's sign-up, their use of the plan and the chat.</p>
            </>
          ) : data.order ? (
            <>
              <h4>The order</h4>
              <p className="ops-case-title">{data.order.title}</p>
              {data.order.description && <p className="operations-muted">{data.order.description}</p>}
              <dl className="ops-case-facts">
                <div><dt>Stage</dt><dd>{statusLabel(data.order.stage || "submitted")}</dd></div>
                <div><dt>ETA</dt><dd>{data.order.eta_at ? new Date(data.order.eta_at).toLocaleDateString() : "—"}</dd></div>
                {data.order.chosen && (
                  <div>
                    <dt>They chose</dt>
                    <dd>
                      {data.order.chosen.product_name}
                      {data.order.chosen.price_amount != null ? ` · ${money(data.order.chosen.price_amount, data.order.chosen.currency)}` : ""}
                    </dd>
                  </div>
                )}
              </dl>
              {data.order.timeline.length > 0 && (
                <ol className="ops-case-timeline" aria-label="Order timeline">
                  {data.order.timeline.map((step, index) => (
                    <li key={`${step.stage}-${index}`}>
                      <strong>{statusLabel(step.stage)}</strong> <small>{new Date(step.at).toLocaleDateString()}</small>
                      {step.note && <p>{step.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : null}
        </section>
        <section aria-label="Payments">
          <h4>Payments</h4>
          {data.payments.length === 0 ? (
            <p className="operations-muted">No payments yet.</p>
          ) : (
            <ul className="ops-tool-list">
              {data.payments.map((payment, index) => (
                <li key={index}>
                  <div>
                    <strong>
                      {payment.title} · {money(payment.amount, payment.currency)}
                    </strong>
                    <small className={payment.disputed ? "ops-tool-warn" : undefined}>
                      {payment.disputed ? "The disputed payment · " : ""}
                      {statusLabel(payment.status)}
                      {payment.paid_at ? ` ${day(payment.paid_at)}` : payment.sent_at ? ` · sent ${day(payment.sent_at)}` : ""}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="The chat">
          <h4>The chat</h4>
          {data.chat_locked ? (
            <p className="operations-muted">Claim this case to read the member's chat.</p>
          ) : !data.chat || data.chat.messages.length === 0 ? (
            <p className="operations-muted">No chat about this yet.</p>
          ) : (
            <ol className="ops-transcript" aria-label="The member's chat">
              {data.chat.messages.map((message) => (
                <li key={message.id} className={`is-${message.sender_type}`}>
                  <small>
                    {message.sender_type === "member" ? data.member?.name || "Member" : message.sender_type === "assistant" ? "FayFort AI" : "FayFort team"} ·{" "}
                    {new Date(message.created_at).toLocaleString()}
                  </small>
                  <p>{message.content}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </section>
  );
}
