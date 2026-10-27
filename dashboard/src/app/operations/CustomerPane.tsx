import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { DESK_LABEL, DESK_ORDER } from "./Desks";
import { statusLabel, type Answer, type CustomerCard, type Department, type WorkItem } from "./types";
import type { OperationsState } from "./useOperationsCenter";
import "./customer.css";

/** The third pane beside a chat (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R3): who the customer is and what they've asked
 * for, Answers from what the AI knows, and sending part of the chat to another desk. */

export function isChatItem(item: WorkItem) {
  return Boolean(item.member_conversation_id || item.business_conversation_id || item.handoff_id || item.work_type === "chat_handoff");
}

const PROFILE_LABEL: Record<string, string> = {
  member_tier: "Plan",
  rank_level: "Rank",
  country: "Country",
  city: "City",
  created_at: "Member since",
  channel: "Channel",
  username: "Username",
  first_seen: "First message",
  summary: "What the AI noted",
};
const PROFILE_ORDER = ["member_tier", "rank_level", "country", "city", "created_at", "channel", "username", "first_seen", "summary"];

function shownValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (key === "created_at" || key === "first_seen") return new Date(String(value)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (key === "member_tier") return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  if (key === "channel") return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  if (key === "username") return `@${String(value).replace(/^@/, "")}`;
  return String(value);
}
const readable = (field: string) => field.replaceAll("_", " ");

export function CustomerPane({ ops, selected }: { ops: OperationsState; selected: WorkItem }) {
  const token = ops.token;
  const [card, setCard] = useState<CustomerCard | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setLoading(true);
    setFailed("");
    apiRequest<{ card: CustomerCard | null; locked: boolean }>(`/operations/work-items/${selected.id}/customer`, token)
      .then((found) => {
        if (!alive) return;
        setCard(found.card);
        setLocked(found.locked);
      })
      .catch((reason) => {
        if (alive) setFailed(reason instanceof Error ? reason.message : "The customer card could not be loaded.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, selected.id, selected.assigned_worker_id]);

  const profileRows = card ? PROFILE_ORDER.map((key) => [key, shownValue(key, card.profile[key])] as const).filter(([, value]) => value) : [];
  return (
    <aside className="ops-customer-pane" aria-label="Customer card">
      <section className="ops-pane-card" aria-label="Who this is">
        {loading ? (
          <p className="operations-muted">Loading the customer…</p>
        ) : failed ? (
          <p className="form-error" role="alert">{failed}</p>
        ) : locked ? (
          <p className="operations-muted">Claim this chat to see who the member is. Member chats stay private to whoever is answering.</p>
        ) : !card ? (
          <p className="operations-muted">No customer details for this item.</p>
        ) : (
          <>
            <header className="ops-customer-head">
              <span className="ops-customer-avatar" aria-hidden="true">
                {card.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <div>
                <h3>{card.name}</h3>
                <small>{card.kind === "member" ? "FayFort member" : `${shownValue("channel", card.profile.channel) || "Customer"} customer`}</small>
              </div>
            </header>
            {profileRows.length > 0 && (
              <dl className="ops-customer-facts">
                {profileRows.map(([key, value]) => (
                  <div key={key}>
                    <dt>{PROFILE_LABEL[key]}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <h4>What they've asked for</h4>
            {card.requests.length === 0 ? (
              <p className="operations-muted">Nothing yet.</p>
            ) : (
              <ul className="ops-customer-requests">
                {card.requests.map((request) => (
                  <li key={request.id}>
                    <div>
                      <strong>{request.title}</strong>
                      {request.stage && <span className="ops-chip">{statusLabel(request.stage)}</span>}
                    </div>
                    {request.details && Object.keys(request.details).length > 0 && (
                      <small>
                        {Object.entries(request.details)
                          .slice(0, 4)
                          .map(([key, value]) => `${readable(key)}: ${value}`)
                          .join(" · ")}
                      </small>
                    )}
                    {request.missing.length > 0 && (
                      <p className="ops-missing">
                        Still needed: {request.missing.map(readable).join(", ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {card.invoices.length > 0 && (
              <>
                <h4>Invoices</h4>
                <ul className="ops-customer-list">
                  {card.invoices.map((invoice) => (
                    <li key={invoice.id}>
                      <span>{invoice.title}</span>
                      <small>
                        {Number(invoice.amount).toFixed(2)} {invoice.currency} · {statusLabel(invoice.status)}
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {card.chats.length > 1 && (
              <>
                <h4>Their chats</h4>
                <ul className="ops-customer-list">
                  {card.chats.map((chat) => (
                    <li key={chat.id} className={chat.current ? "is-current" : undefined}>
                      <span>{chat.title}</span>
                      <small>
                        {chat.current ? "This chat" : chat.last_activity_at ? new Date(chat.last_activity_at).toLocaleDateString() : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>
      <AnswersSearch ops={ops} selected={selected} />
      {selected.work_type !== "chat_handoff" && <SendToDesk ops={ops} selected={selected} />}
    </aside>
  );
}

/** Answers: search what the AI knows, then copy an answer or drop it into the reply box. */
export function AnswersSearch({ ops, selected }: { ops: OperationsState; selected?: WorkItem }) {
  const [query, setQuery] = useState("");
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const canInsert = Boolean(selected && (selected.member_conversation_id || selected.business_conversation_id || selected.handoff_id));

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!ops.token || query.trim().length < 2) return;
    setBusy(true);
    setError("");
    try {
      const found = await apiRequest<{ answers: Answer[] }>(`/operations/answers?q=${encodeURIComponent(query.trim())}`, ops.token);
      setAnswers(found.answers);
      setOpen(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Answers could not be searched.");
    } finally {
      setBusy(false);
    }
  }
  function insert(answer: Answer) {
    if (!selected) return;
    const text = answer.full.trim();
    const add = (current: string) => (current.trim() ? `${current.trim()}\n\n${text}` : text);
    if (selected.member_conversation_id) ops.setMemberReply(add);
    else ops.setBusinessReply(add);
    document.getElementById("ops-chat")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }
  async function copy(answer: Answer) {
    try {
      await navigator.clipboard.writeText(answer.full.trim());
      setCopied(answer.id);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setOpen(answer.id); // can't copy here: show the whole answer to select by hand
    }
  }
  return (
    <section className="ops-pane-card" aria-label="Answers">
      <h3>Answers</h3>
      <p className="operations-muted">What the AI knows, so you give the same answers. Search a few words.</p>
      <form className="ops-answers-form" onSubmit={search} role="search" aria-label="Search answers">
        <input type="search" aria-label="Search answers" placeholder="deposit, shipping to Lagos, split payment…" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} />
        <button type="submit" className="secondary-button" disabled={busy || query.trim().length < 2}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {answers && answers.length === 0 && <p className="operations-muted">Nothing matches. Try other words, or ask an administrator to add it to Knowledge.</p>}
      {answers && answers.length > 0 && (
        <ul className="ops-answers">
          {answers.map((answer) => (
            <li key={answer.id}>
              <button type="button" className="ops-answer-title" aria-expanded={open === answer.id} onClick={() => setOpen(open === answer.id ? null : answer.id)}>
                <span className="ops-chip">{answer.kind === "faq" ? "FAQ" : "Knowledge"}</span> {answer.title}
              </button>
              <p>{open === answer.id ? answer.full : answer.text}</p>
              <div className="ops-answer-actions">
                {canInsert && (
                  <button type="button" className="secondary-button" onClick={() => insert(answer)}>
                    Use in reply
                  </button>
                )}
                <button type="button" className="ops-link-button" onClick={() => void copy(answer)}>
                  {copied === answer.id ? "Copied" : "Copy"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Send part of a chat to another desk as its own work item; the chat stays here. */
function SendToDesk({ ops, selected }: { ops: OperationsState; selected: WorkItem }) {
  const [department, setDepartment] = useState<Department | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const mine = selected.assigned_worker_id === ops.userId && ["claimed", "waiting"].includes(selected.status);
  const finished = ["completed", "cancelled"].includes(selected.status);
  useEffect(() => {
    setDepartment("");
    setNote("");
    setError("");
    setSent("");
  }, [selected.id]);
  if (finished) return null;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!ops.token || !department) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/operations/work-items/${selected.id}/hand-off`, ops.token, {
        method: "POST",
        body: JSON.stringify({ department, note: note.trim() }),
      });
      setSent(DESK_LABEL[department]);
      setNote("");
      setDepartment("");
      void ops.refresh(ops.token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That couldn't be sent.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ops-pane-card" aria-label="Send to another desk">
      <h3>Send to another desk</h3>
      <p className="operations-muted">A product to source, a refund, a dispute: the other desk gets it with this chat attached. You keep the chat.</p>
      {!mine && !ops.canManage ? (
        <p className="operations-muted">Claim the chat first.</p>
      ) : (
        <form className="ops-send-desk" onSubmit={send}>
          <label>
            Desk
            <select aria-label="Send to which desk" value={department} onChange={(event) => setDepartment(event.target.value as Department)} required>
              <option value="">Choose a desk</option>
              {DESK_ORDER.filter((desk) => desk !== selected.department).map((desk) => (
                <option key={desk} value={desk}>
                  {DESK_LABEL[desk]}
                </option>
              ))}
            </select>
          </label>
          <label>
            What they should do
            <textarea aria-label="What the other desk should do" rows={3} maxLength={500} required minLength={3} value={note} placeholder="Source a 22 inch body wave wig, 2 units, delivery to Abuja" onChange={(event) => setNote(event.target.value)} />
          </label>
          <button type="submit" className="primary-button" disabled={busy || !department || note.trim().length < 3}>
            {busy ? "Sending…" : department ? `Send to ${DESK_LABEL[department]}` : "Send"}
          </button>
          {sent && <p className="ops-sent" role="status">Sent to {sent}. It shows in its queue with this chat attached.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
      )}
    </section>
  );
}
