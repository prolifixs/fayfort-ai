import { useEffect, useState, type ReactNode } from "react";
import { StaffChatThread, fromMemberMessage } from "../staff/StaffChatThread";
import { MemberPhotoReviewQueue } from "../staff/MemberPhotoReview";
import { currentStepIndex, DEPARTMENT_GUIDES, GLOSSARY, GUIDES, type Guide, type Step } from "./playbooks";
import { departmentLabel, departments, requestNextStages, statusLabel, type FlowContext, type WorkItem } from "./types";
import type { OperationsState } from "./useOperationsCenter";
import { formatSpan, shortDate, toLocalInput, useNow, workClock } from "./clock";

type Selected = NonNullable<OperationsState["selected"]>;

const FIRST_WEEK_KEY = "fayfort.operations.firstWeek";
/** First-week mode: every step shows its full how-to. On by default for workers, saved per browser. */
export function useFirstWeek(canManage: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(FIRST_WEEK_KEY);
      if (saved !== null) return saved === "1";
    } catch {
      /* storage unavailable */
    }
    return !canManage;
  });
  return [
    value,
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(FIRST_WEEK_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
    },
  ];
}

export function canActOn(ops: OperationsState, item: WorkItem) {
  return ops.canManage || (item.assigned_worker_id === ops.userId && item.status === "claimed");
}

function goTo(target?: string) {
  if (!target) return;
  const element = document.getElementById(target);
  if (!element) return;
  if (element instanceof HTMLDetailsElement) element.open = true;
  element.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function money(amount: number | string | null | undefined, currency?: string | null) {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = Number(amount);
  if (Number.isNaN(value)) return String(amount);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || ""}`.trim();
  }
}

/** A titled section that keeps its place on every work item. The "?" opens the guide for this work type. */
export function OpsSection({
  id,
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  onHelp,
  aside,
}: {
  id?: string;
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  onHelp?: () => void;
  aside?: ReactNode;
}) {
  const help = onHelp && (
    <button
      type="button"
      className="ops-help-button"
      aria-label={`How ${title.toLowerCase()} works`}
      title="How this works"
      onClick={(event) => {
        event.preventDefault();
        onHelp();
      }}
    >
      ?
    </button>
  );
  if (collapsible)
    return (
      <details className="ops-section" id={id} open={defaultOpen}>
        <summary>
          <h3>{title}</h3>
          {aside}
          {help}
        </summary>
        <div className="ops-section-body">{children}</div>
      </details>
    );
  return (
    <section className="ops-section" id={id} aria-label={title}>
      <header>
        <h3>{title}</h3>
        {aside}
        {help}
      </header>
      <div className="ops-section-body">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Steps bar and "Do now"
// ---------------------------------------------------------------------------------------------
export function PlaybookPanel({
  ops,
  selected,
  steps,
  firstWeek,
  onHelp,
}: {
  ops: OperationsState;
  selected: Selected;
  steps: Step[];
  firstWeek: boolean;
  onHelp: () => void;
}) {
  const index = currentStepIndex(steps);
  const step = steps[index];
  const finished = ["completed", "cancelled"].includes(selected.status);
  const [showHow, setShowHow] = useState(firstWeek);
  useEffect(() => setShowHow(firstWeek), [firstWeek, selected.id, step?.id]);
  const needsClaim = step?.id === "claim" && !ops.canManage && !finished;
  return (
    <section className="ops-playbook" aria-label="Steps for this work">
      <ol className="ops-steps">
        {steps.map((item, position) => {
          const state = item.done ? "done" : position === index ? (item.waitingOn ? "waiting" : "current") : "todo";
          return (
            <li key={item.id} className={`ops-step is-${state}`} aria-current={position === index ? "step" : undefined}>
              <span className="ops-step-dot" aria-hidden="true">
                {item.done ? "✓" : state === "waiting" ? "…" : position + 1}
              </span>
              <span className="ops-step-title">{item.title}</span>
              <span className="sr-only">
                {item.done ? " (done)" : position === index ? (item.waitingOn ? ` (waiting on ${item.waitingOn})` : " (now)") : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {finished ? (
        <div className="ops-do-now is-finished" role="status">
          <small>{selected.status === "completed" ? "Finished" : "Cancelled"}</small>
          <strong>This work is {selected.status === "completed" ? "done" : "cancelled"}.</strong>
          <p>It stays in the Archive with its full history.</p>
        </div>
      ) : (
        step && (
          <div className={`ops-do-now${step.waitingOn ? " is-waiting" : ""}`} aria-label="Do now">
            <small>
              Step {index + 1} of {steps.length}
              {step.waitingOn ? ` · waiting on ${step.waitingOn}` : " · do now"}
            </small>
            <strong>{step.title}</strong>
            {showHow ? (
              <p>{step.how}</p>
            ) : (
              <button type="button" className="ops-link-button" onClick={() => setShowHow(true)}>
                How do I do this?
              </button>
            )}
            {selected.next_action && selected.next_action !== step.how && (
              <p className="ops-next-action">
                <span>Next action</span> {selected.next_action}
              </p>
            )}
            <div className="ops-do-now-actions">
              {needsClaim ? (
                <button type="button" className="primary-button" disabled={ops.busy} onClick={() => void ops.claim(selected)}>
                  {selected.assigned_worker_id && selected.assigned_worker_id !== ops.userId ? "Take over" : "Claim it"}
                </button>
              ) : (
                step.target && (
                  <button type="button" className="primary-button" onClick={() => goTo(step.target)}>
                    Go to this step
                  </button>
                )
              )}
              <button type="button" className="secondary-button" onClick={onHelp}>
                Read the guide
              </button>
            </div>
          </div>
        )
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Deadline and delivery estimate
// ---------------------------------------------------------------------------------------------
/** Every piece of work has a deadline. On a member request it is the delivery estimate (ETA) the member sees. */
export function DeadlinePanel({ ops, selected, onHelp }: { ops: OperationsState; selected: Selected; onHelp?: () => void }) {
  const now = useNow();
  const request = selected.member_request_id ? ops.requestContext : null;
  const isRequest = Boolean(selected.member_request_id);
  const eta = request?.eta_at || null;
  const finished = ["completed", "cancelled"].includes(selected.status);
  const clock = workClock(selected, now);
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setWhen("");
    setReason("");
    setEditing(false);
  }, [selected.id]);
  const firstEstimate = isRequest && !eta;
  const needsReason = !firstEstimate;
  const act = canActOn(ops, selected) && !finished;
  const title = isRequest ? "Delivery estimate (ETA)" : "Deadline";
  const changes = request?.eta_changes || [];
  return (
    <OpsSection id="ops-deadline" title={title} onHelp={onHelp}>
      <div className="ops-deadline">
        <div className="ops-deadline-now" style={{ ["--clock-hue" as string]: String(clock.hue) }}>
          {isRequest && !eta ? (
            <>
              <strong>Not set yet</strong>
              <small>
                Review is due {selected.due_at ? shortDate(selected.due_at) : "within 24 hours"}. Set the ETA before moving the request to
                Sourcing.
              </small>
            </>
          ) : (
            <>
              <strong>{shortDate((isRequest ? eta : selected.due_at) || "") || "No deadline"}</strong>
              {isRequest && <small>The member sees this date.</small>}
            </>
          )}
          {clock.state !== "none" && (
            <span className={`ops-deadline-badge${clock.state === "overdue" ? " is-overdue" : ""}`}>{clock.label}</span>
          )}
        </div>
        {isRequest && request?.eta_reason && (
          <p className="operations-muted">Last change: {request.eta_reason}</p>
        )}
        {changes.length > 1 && (
          <ol className="ops-deadline-history" aria-label="Delivery estimate history">
            {changes.map((change) => (
              <li key={change.id}>
                {shortDate(change.created_at)}: {change.previous_eta_at ? `${shortDate(change.previous_eta_at)} → ` : "set to "}
                {shortDate(change.eta_at)}
                {change.reason ? ` · ${change.reason}` : ""}
                {change.previous_eta_at &&
                  new Date(change.eta_at).getTime() > new Date(change.previous_eta_at).getTime() &&
                  ` (+${formatSpan(new Date(change.eta_at).getTime() - new Date(change.previous_eta_at).getTime())})`}
              </li>
            ))}
          </ol>
        )}
        {act &&
          (editing || firstEstimate ? (
            <form
              aria-label={firstEstimate ? "Set the delivery estimate" : `Change the ${title.toLowerCase()}`}
              onSubmit={(event) => {
                event.preventDefault();
                if (!when || (needsReason && reason.trim().length < 3)) return;
                void ops.setDeadline(when, reason).then(() => {
                  setEditing(false);
                  setReason("");
                });
              }}
            >
              <label>
                {firstEstimate ? "Estimated delivery date" : "New date"}
                <input
                  type="datetime-local"
                  required
                  min={toLocalInput(new Date(now + 60_000).toISOString())}
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                />
              </label>
              {needsReason && (
                <label>
                  Reason for the change (required{isRequest ? ", the member sees it" : ""})
                  <input
                    required
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={isRequest ? "For example: the supplier restocks on Friday" : "Why this needs more time"}
                  />
                </label>
              )}
              <div className="member-request-cancel-actions">
                <button className="primary-button" disabled={ops.busy || !when || (needsReason && reason.trim().length < 3)}>
                  {firstEstimate ? "Set ETA" : "Save new date"}
                </button>
                {!firstEstimate && (
                  <button type="button" className="secondary-button" onClick={() => setEditing(false)}>
                    Keep the current date
                  </button>
                )}
              </div>
            </form>
          ) : (
            <button type="button" className="secondary-button" onClick={() => setEditing(true)}>
              {isRequest ? "Change the ETA" : "Change the deadline"}
            </button>
          ))}
        {!act && !finished && <p className="operations-muted">Claim this work to set or change the date.</p>}
      </div>
    </OpsSection>
  );
}

// ---------------------------------------------------------------------------------------------
// Sourcing: request stage and payments
// ---------------------------------------------------------------------------------------------
export function RequestStagePanel({ ops, selected }: { ops: OperationsState; selected: Selected }) {
  const { requestContext, requestStage, setRequestStage, requestStageNote, setRequestStageNote, recordRequestStage, busy, userId, canManage } = ops;
  const stage = requestContext?.events.at(-1)?.stage || "submitted";
  const next = requestNextStages[stage] || [];
  if (!next.length) return null;
  const owner = selected.assigned_worker_id === userId && selected.status === "claimed";
  if (!owner)
    return (
      <p className="operations-muted">
        {canManage ? "Workers move the request stage after claiming it." : "Claim this work to move the request on."}
      </p>
    );
  const label = (value: string) =>
    value === "needs_member_input" ? "Ask the member for details" : value === "under_review" ? "Under review" : statusLabel(value);
  return (
    <form className="ops-stage-form" onSubmit={recordRequestStage}>
      <label>
        Move the request to
        <select aria-label="Next request stage" value={requestStage} onChange={(event) => setRequestStage(event.target.value)}>
          <option value="">Choose…</option>
          {next.map((value) => (
            <option key={value} value={value}>
              {label(value)}
            </option>
          ))}
        </select>
      </label>
      {["sourcing", "options_sent"].includes(requestStage) && !requestContext?.eta_at && (
        <label className="ops-eta-needed">
          Estimated delivery date (required before Sourcing; the member sees it)
          <input
            type="datetime-local"
            aria-label="Estimated delivery date"
            required
            value={ops.requestEta}
            onChange={(event) => ops.setRequestEta(event.target.value)}
          />
        </label>
      )}
      {requestStage && (
        <label>
          {requestStage === "needs_member_input" ? "Your question for the member (required)" : "Note for the member (optional)"}
          <textarea
            rows={2}
            maxLength={1000}
            value={requestStageNote}
            required={requestStage === "needs_member_input"}
            onChange={(event) => setRequestStageNote(event.target.value)}
            placeholder={requestStage === "needs_member_input" ? "For example: which length and colour would you like?" : "Short, factual update"}
          />
        </label>
      )}
      <button className="primary-button" disabled={busy || !requestStage}>
        {busy ? "Saving…" : requestStage === "needs_member_input" ? "Send question" : "Update stage"}
      </button>
    </form>
  );
}

export function PaymentsPanel({ ops, selected }: { ops: OperationsState; selected: Selected }) {
  const { payments, busy, sendDeposit, sendInvoice } = ops;
  const [total, setTotal] = useState("");
  const [currency, setCurrency] = useState("USD");
  useEffect(() => {
    setTotal(payments?.expected_total ? String(payments.expected_total) : "");
    setCurrency(payments?.expected_currency || "USD");
  }, [payments?.expected_total, payments?.expected_currency, selected.id]);
  if (!payments) return <p className="operations-muted">Payments couldn't be loaded for this request.</p>;
  const act = canActOn(ops, selected);
  const rate = payments.deposit_terms?.rate || 0;
  const invoices = Array.isArray(payments.invoices) ? payments.invoices : [];
  const deposit = invoices.find((row) => row.kind === "deposit" && row.status !== "cancelled");
  const order = invoices.find((row) => row.kind === "order" && ["sent", "paid", "draft"].includes(row.status));
  const failedOrder = invoices.find((row) => row.kind === "order" && row.status === "failed");
  const option = payments.selected_option;
  return (
    <div className="ops-payments">
      <div className="ops-pay-row">
        <div>
          <strong>Deposit</strong>
          <small>
            {rate > 0
              ? `${Math.round(rate * 100)}% for this member's plan (${payments.deposit_terms?.tier || "plan"}). Taken off the final invoice.`
              : "No deposit needed for this member's plan."}
          </small>
        </div>
        {deposit ? (
          <InvoiceChip invoice={deposit} />
        ) : rate > 0 && act ? (
          <form
            className="ops-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(total);
              if (value > 0) void sendDeposit(value, currency);
            }}
          >
            <label>
              Expected total
              <input type="number" min="0.01" step="0.01" required value={total} onChange={(event) => setTotal(event.target.value)} />
            </label>
            <label>
              Currency
              <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                {["USD", "EUR", "GBP", "CAD", "AUD", "NGN"].map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </label>
            <button className="secondary-button" disabled={busy || !(Number(total) > 0)}>
              Send deposit {Number(total) > 0 ? money(Number(total) * rate, currency) : ""}
            </button>
          </form>
        ) : rate > 0 ? (
          <span className="ops-chip">Not sent</span>
        ) : null}
      </div>
      <div className="ops-pay-row">
        <div>
          <strong>Invoice</strong>
          <small>
            {option
              ? `Member chose ${option.product_name}${option.price_amount ? ` · ${money(option.price_amount, option.currency)}` : ""}.`
              : "Waiting for the member to choose an option."}
          </small>
        </div>
        {order ? (
          <InvoiceChip invoice={order} />
        ) : act && option ? (
          <button type="button" className="primary-button" disabled={busy || !option.price_amount} onClick={() => void sendInvoice()}>
            {failedOrder ? "Send the invoice again" : "Send the invoice"}
          </button>
        ) : (
          <span className="ops-chip">Not sent</span>
        )}
      </div>
      {failedOrder && !order && <p className="form-error">Last attempt failed: {failedOrder.error || "unknown error"}</p>}
    </div>
  );
}

function InvoiceChip({ invoice }: { invoice: { status: string; amount: number; currency: string; invoice_url: string | null; deposit_credit?: number } }) {
  return (
    <span className="ops-invoice-chip">
      <span className={`ops-chip is-${invoice.status}`}>{statusLabel(invoice.status)}</span>
      {money(invoice.amount - (invoice.deposit_credit || 0), invoice.currency)}
      {invoice.invoice_url && (
        <a href={invoice.invoice_url} target="_blank" rel="noreferrer">
          Open
        </a>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Work that came from outside a request or conversation
// ---------------------------------------------------------------------------------------------
function FlowChat({ ops, selected }: { ops: OperationsState; selected: Selected }) {
  const chat = ops.flowContext?.chat;
  const act = canActOn(ops, selected) && !["completed", "cancelled"].includes(selected.status);
  return (
    <div className="ops-flow-chat">
      <h4>Message {ops.flowContext?.member_name || "the member"}</h4>
      <StaffChatThread
        label="Member chat"
        messages={(chat?.messages || []).map(fromMemberMessage)}
        emptyText="No chat yet. Your message starts one; the member gets a notification."
        composer={
          act
            ? {
                id: "ops-flow-message",
                label: "Message to member",
                value: ops.memberReply,
                onChange: ops.setMemberReply,
                onSubmit: ops.sendFlowMessage,
                busy: ops.busy,
                placeholder: "Write to the member…",
                sendLabel: "Send message",
              }
            : null
        }
        footer={!act ? <p className="operations-muted">Claim this work to message the member.</p> : null}
      />
    </div>
  );
}

export function FlowPanel({ ops, selected }: { ops: OperationsState; selected: Selected }) {
  const flow = ops.flowContext;
  const act = canActOn(ops, selected);
  const live = !["completed", "cancelled"].includes(selected.status);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  useEffect(() => {
    setPrice(flow?.trend?.pool_price ? String(flow.trend.pool_price) : "");
    setCurrency(flow?.trend?.pool_currency || "USD");
  }, [flow?.trend?.pool_price, flow?.trend?.pool_currency, selected.id]);
  if (!flow) return <p className="operations-muted">Loading details…</p>;
  const meta = flow.metadata || {};
  switch (flow.kind) {
    case "shopify_order": {
      const order = flow.order;
      const lines = order?.line_items || (meta.line_items as NonNullable<FlowContext["order"]>["line_items"]) || [];
      return (
        <div className="ops-flow">
          <dl className="ops-facts">
            <div><dt>Order</dt><dd>{order?.order_name || String(meta.order_name || "Shop order")}</dd></div>
            <div><dt>Customer</dt><dd>{flow.member_name || "Shop customer"}</dd></div>
            <div><dt>Total</dt><dd>{money(order?.total ?? (meta.total as string), order?.currency || (meta.currency as string))}</dd></div>
            <div><dt>Payment</dt><dd>{statusLabel(order?.financial_status || "paid")}</dd></div>
            <div><dt>Shipping</dt><dd>{order?.fulfillment_status ? statusLabel(order.fulfillment_status) : "Not shipped yet"}</dd></div>
          </dl>
          <h4>Pick list</h4>
          <ul className="ops-pick-list">
            {(lines || []).map((line, position) => (
              <li key={position}>
                <strong>{line.quantity || 1} ×</strong> {line.title}
                {line.variant_title ? <small> · {line.variant_title}</small> : null}
              </li>
            ))}
          </ul>
          {typeof meta.admin_url === "string" && (
            <p>
              <a className="secondary-button" href={meta.admin_url} target="_blank" rel="noreferrer">
                Open order in Shopify ↗
              </a>
              <small className="ops-outside-note"> Mark it fulfilled there with the tracking number. This item then closes by itself.</small>
            </p>
          )}
        </div>
      );
    }
    case "trend_pool": {
      const trend = flow.trend;
      const invoices = flow.invoices || [];
      const paid = invoices.filter((row) => row.status === "paid").length;
      const sent = invoices.filter((row) => ["sent", "paid"].includes(row.status)).length;
      return (
        <div className="ops-flow">
          <dl className="ops-facts">
            <div><dt>Item</dt><dd>{trend?.title || String(meta.trend_title || "Group buy")}</dd></div>
            <div><dt>Buyers</dt><dd>{flow.buyers ?? trend?.want_count ?? 0} (target {trend?.pool_target ?? String(meta.pool_target ?? "—")})</dd></div>
            <div><dt>Group price</dt><dd>{trend?.pool_price ? money(trend.pool_price, trend.pool_currency) : "Not set"}</dd></div>
            <div><dt>Invoices</dt><dd>{sent ? `${paid} of ${sent} paid` : "None sent"}</dd></div>
          </dl>
          {trend?.source_url && (
            <p>
              <a href={trend.source_url} target="_blank" rel="noreferrer">Where it's trending ↗</a>
            </p>
          )}
          {act && live && (
            <>
              <form
                className="ops-inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (Number(price) > 0) void ops.setGroupPrice(Number(price), currency);
                }}
              >
                <label>
                  Price each buyer pays
                  <input type="number" min="0.01" step="0.01" required value={price} onChange={(event) => setPrice(event.target.value)} />
                </label>
                <label>
                  Currency
                  <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                    {["USD", "EUR", "GBP", "CAD", "AUD", "NGN"].map((code) => (
                      <option key={code}>{code}</option>
                    ))}
                  </select>
                </label>
                <button className="secondary-button" disabled={ops.busy || !(Number(price) > 0)}>
                  Save price
                </button>
              </form>
              <button
                type="button"
                className="primary-button"
                disabled={ops.busy || !trend?.pool_price}
                onClick={() => void ops.sendGroupInvoices()}
              >
                {sent ? "Invoice new buyers" : "Send group invoices"}
              </button>
              {!trend?.pool_price && <small className="operations-muted"> Save the group price first.</small>}
            </>
          )}
          {invoices.length > 0 && (
            <ul className="ops-invoice-list">
              {invoices.map((row) => (
                <li key={row.id}>
                  <span className={`ops-chip is-${row.status}`}>{statusLabel(row.status)}</span> {money(row.amount, row.currency)}
                  <small> · {row.paid_at ? `paid ${new Date(row.paid_at).toLocaleDateString()}` : row.sent_at ? `sent ${new Date(row.sent_at).toLocaleDateString()}` : ""}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    case "giveaway": {
      const giveaway = flow.giveaway;
      const drawn = giveaway?.status === "drawn";
      return (
        <div className="ops-flow">
          <dl className="ops-facts">
            <div><dt>Giveaway</dt><dd>{giveaway?.title || String(meta.giveaway_title || "")}</dd></div>
            <div><dt>Prize</dt><dd>{giveaway?.prize_text || "—"}</dd></div>
            <div><dt>Entries</dt><dd>{flow.entries ?? 0}</dd></div>
            <div><dt>Winners to draw</dt><dd>{giveaway?.winner_count ?? 1}</dd></div>
            <div><dt>Ended</dt><dd>{giveaway?.ends_at ? new Date(giveaway.ends_at).toLocaleString() : "—"}</dd></div>
          </dl>
          {drawn ? (
            <p className="operations-notice">Winners were drawn {giveaway?.drawn_at ? new Date(giveaway.drawn_at).toLocaleString() : ""}.</p>
          ) : act && live ? (
            <button type="button" className="primary-button" disabled={ops.busy || !flow.entries} onClick={() => void ops.drawGiveaway()}>
              Draw winners
            </button>
          ) : null}
          {!drawn && !flow.entries && <p className="operations-muted">Nobody entered. Mark the work completed instead of drawing.</p>}
        </div>
      );
    }
    case "giveaway_winner":
      return (
        <div className="ops-flow">
          <dl className="ops-facts">
            <div><dt>Winner</dt><dd>{flow.member_name || "Member"}</dd></div>
            <div><dt>Giveaway</dt><dd>{flow.giveaway?.title || "—"}</dd></div>
            <div><dt>Prize</dt><dd>{flow.giveaway?.prize_text || "—"}</dd></div>
            {typeof meta.prize_error === "string" && <div><dt>Why no code</dt><dd>{meta.prize_error}</dd></div>}
          </dl>
          <FlowChat ops={ops} selected={selected} />
        </div>
      );
    case "photo_review":
      return ops.token ? (
        <MemberPhotoReviewQueue
          accessToken={ops.token}
          platformAdmin={ops.canManage}
          onlyReviewId={String(meta.source_id || "")}
          onReplied={() => ops.token && void ops.refresh(ops.token)}
        />
      ) : null;
    case "subscription_past_due":
      return (
        <div className="ops-flow">
          <dl className="ops-facts">
            <div><dt>Member</dt><dd>{flow.member_name || "Member"}</dd></div>
            <div><dt>Plan</dt><dd>{statusLabel(flow.subscription?.plan || String(meta.plan || "—"))}</dd></div>
            <div><dt>Status</dt><dd>{statusLabel(flow.subscription?.status || "past_due")}</dd></div>
            <div>
              <dt>Renews</dt>
              <dd>{flow.subscription?.current_period_end ? new Date(flow.subscription.current_period_end).toLocaleDateString() : "—"}</dd>
            </div>
          </dl>
          <FlowChat ops={ops} selected={selected} />
        </div>
      );
    case "invoice":
      return (
        <div className="ops-flow">
          <dl className="ops-facts">
            <div><dt>Invoice</dt><dd>{flow.invoice?.title || "—"}</dd></div>
            <div><dt>Amount</dt><dd>{money(flow.invoice?.amount, flow.invoice?.currency)}</dd></div>
            <div><dt>Status</dt><dd>{statusLabel(flow.invoice?.status || "failed")}</dd></div>
            <div><dt>Member</dt><dd>{flow.member_name || "Member"}</dd></div>
          </dl>
          <p className="form-error">{flow.invoice?.error || String(meta.error || "Shopify refused the invoice.")}</p>
          <p className="operations-muted">
            {flow.invoice?.request_id
              ? "Fix the cause, then open the member's sourcing request in the queue and use its Send the invoice step."
              : "Fix the cause, then send the invoice again from Shop → Invoices."}
          </p>
          <FlowChat ops={ops} selected={selected} />
        </div>
      );
    case "invoice_void":
      return (
        <div className="ops-flow">
          <p>The member cancelled this request. Delete the unpaid draft order so its payment link stops working.</p>
          {typeof meta.error === "string" && <p className="form-error">Shopify said: {meta.error}</p>}
          {typeof meta.admin_url === "string" && (
            <p>
              <a className="secondary-button" href={meta.admin_url} target="_blank" rel="noreferrer">
                Open the draft order in Shopify ↗
              </a>
            </p>
          )}
        </div>
      );
    case "paid_after_cancel":
      return (
        <div className="ops-flow">
          <dl className="ops-facts">
            <div><dt>Paid</dt><dd>{money(meta.amount as string, meta.currency as string)}</dd></div>
            <div><dt>For</dt><dd>{String(meta.title || "Invoice")}</dd></div>
            <div><dt>Member</dt><dd>{flow.member_name || "Member"}</dd></div>
          </dl>
          <p className="form-error">The member cancelled this request before paying. Refund the payment in Shopify.</p>
          <FlowChat ops={ops} selected={selected} />
        </div>
      );
    default:
      return <p className="operations-muted">{selected.next_action}</p>;
  }
}

// ---------------------------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------------------------
export function ArchiveControls({ ops }: { ops: OperationsState }) {
  const { archiveQuery, setArchiveQuery, archiveDays, setArchiveDays, filterDepartment, setFilterDepartment, visibleDepartments, hasMore } = ops;
  const [draft, setDraft] = useState(archiveQuery);
  return (
    <form
      className="ops-toolbar ops-archive-controls"
      aria-label="Archive search"
      onSubmit={(event) => {
        event.preventDefault();
        setArchiveQuery(draft);
      }}
    >
      <div className="ops-search">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          type="search"
          className="ops-search-input"
          aria-label="Search finished work"
          maxLength={100}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search finished work: order, request, words in the title…"
        />
      </div>
      <div className="ops-toolbar-filters">
        <label className="ops-select">
          <span>Finished</span>
          <select aria-label="Archive period" value={archiveDays} onChange={(event) => setArchiveDays(Number(event.target.value) as 30 | 90 | 0)}>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={0}>Any time</option>
          </select>
        </label>
        <label className="ops-select">
          <span>Department</span>
          <select aria-label="Archive department" value={filterDepartment} onChange={(event) => setFilterDepartment(event.target.value)}>
            <option value="">All</option>
            {visibleDepartments.map((department) => (
              <option key={department} value={department}>
                {departmentLabel[department]}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button">Search</button>
      </div>
      {hasMore && <small className="ops-toolbar-note">Showing the newest 200. Narrow the search to see older work.</small>}
    </form>
  );
}

export function ReopenForm({ ops }: { ops: OperationsState }) {
  const [reason, setReason] = useState("");
  return (
    <form
      className="ops-reopen"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim().length >= 3) void ops.reopenWork(reason.trim());
      }}
    >
      <label>
        Reopen with a reason
        <input required minLength={3} maxLength={400} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example: customer wrote back about a missing item" />
      </label>
      <button className="secondary-button" disabled={ops.busy || reason.trim().length < 3}>
        Reopen
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------------------------
export function GuideArticle({ guide }: { guide: Guide }) {
  return (
    <article className="ops-guide-article">
      <small>{departmentLabel[guide.department]}</small>
      <h2>{guide.title}</h2>
      <p className="ops-guide-lead">{guide.what}</p>
      <dl className="ops-guide-facts">
        <div><dt>Why it matters</dt><dd>{guide.why}</dd></div>
        <div><dt>When it shows up</dt><dd>{guide.appears}</dd></div>
        <div><dt>When it's finished</dt><dd>{guide.finishes}</dd></div>
        {guide.outside && <div><dt>Leaving FayFort</dt><dd>{guide.outside}</dd></div>}
      </dl>
      <h3>The steps</h3>
      <ol className="ops-guide-steps">
        {guide.steps.map((step) => (
          <li key={step.title}>
            <strong>{step.title}</strong>
            <p>{step.how}</p>
          </li>
        ))}
      </ol>
      <h3>What's on the screen</h3>
      <dl className="ops-guide-screen">
        {guide.screen.map((part) => (
          <div key={part.name}>
            <dt>{part.name}</dt>
            <dd>{part.meaning}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function GuideTab({ firstWeek, setFirstWeek }: { firstWeek: boolean; setFirstWeek: (value: boolean) => void }) {
  const [open, setOpen] = useState<string>("sourcing_request");
  const guide = GUIDES[open];
  return (
    <div className="ops-guide">
      <aside className="ops-guide-index" aria-label="Guides">
        <label className="ops-first-week">
          <input type="checkbox" checked={firstWeek} onChange={(event) => setFirstWeek(event.target.checked)} />
          <span>
            <strong>First-week mode</strong>
            <small>Show the full how-to on every step.</small>
          </span>
        </label>
        {departments.map((department) => {
          const entries = Object.entries(GUIDES).filter(([, value]) => value.department === department);
          if (!entries.length) return null;
          return (
            <section key={department}>
              <h3>{departmentLabel[department]}</h3>
              <p>{DEPARTMENT_GUIDES[department]}</p>
              {entries.map(([key, value]) => (
                <button key={key} type="button" aria-pressed={open === key} onClick={() => setOpen(key)}>
                  {value.title}
                </button>
              ))}
            </section>
          );
        })}
        <section>
          <h3>Words we use</h3>
          <button type="button" aria-pressed={open === "glossary"} onClick={() => setOpen("glossary")}>
            Glossary
          </button>
        </section>
      </aside>
      <div className="ops-guide-body">
        {open === "glossary" ? (
          <article className="ops-guide-article">
            <h2>Glossary</h2>
            <dl className="ops-guide-screen">
              {GLOSSARY.map((entry) => (
                <div key={entry.term}>
                  <dt>{entry.term}</dt>
                  <dd>{entry.meaning}</dd>
                </div>
              ))}
            </dl>
          </article>
        ) : (
          guide && <GuideArticle guide={guide} />
        )}
      </div>
    </div>
  );
}

/** Side sheet with the guide for the open work item, so staff never lose their place. */
export function HelpSheet({ guideKey, onClose }: { guideKey: string; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const guide = GUIDES[guideKey];
  return (
    <div className="ops-sheet-scrim" onClick={onClose}>
      <aside className="ops-sheet" role="dialog" aria-modal="true" aria-label="How this work is done" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="ops-sheet-close" aria-label="Close guide" onClick={onClose}>
          ×
        </button>
        {guide ? (
          <GuideArticle guide={guide} />
        ) : (
          <article className="ops-guide-article">
            <h2>Glossary</h2>
            <dl className="ops-guide-screen">
              {GLOSSARY.map((entry) => (
                <div key={entry.term}>
                  <dt>{entry.term}</dt>
                  <dd>{entry.meaning}</dd>
                </div>
              ))}
            </dl>
          </article>
        )}
      </aside>
    </div>
  );
}
