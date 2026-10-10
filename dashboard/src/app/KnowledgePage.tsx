import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

type Faq = {
  id: string;
  faq_group_id: string;
  version: number;
  question: string;
  answer: string;
  status: "draft" | "approved" | "superseded" | "archived";
  created_at: string;
  created_by: string;
  approved_by?: string | null;
  approved_at?: string | null;
};
type FaqEvent = { id: number; event_type: string; actor_id: string; created_at: string };

export function KnowledgePage({ accessToken, businessId, canManage }: {
  accessToken: string;
  businessId: string;
  canManage: boolean;
}) {
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [revisionFor, setRevisionFor] = useState("");
  const [events, setEvents] = useState<Record<string, FaqEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ faqs: Faq[] }>(`/businesses/${businessId}/faqs`, accessToken);
      setFaqs(result.faqs);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "FAQs could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, businessId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const path = revisionFor
        ? `/businesses/${businessId}/faqs/${revisionFor}/revisions`
        : `/businesses/${businessId}/faqs`;
      await apiRequest(path, accessToken, {
        method: "POST",
        body: JSON.stringify({ question, answer }),
      });
      setQuestion("");
      setAnswer("");
      setRevisionFor("");
      setNotice("Saved as a draft. It will not answer customers until an owner or admin approves it.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "FAQ draft could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function review(faq: Faq, decision: "approve" | "archive") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/businesses/${businessId}/faqs/${faq.id}/review`, accessToken, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      setNotice(decision === "approve"
        ? "FAQ approved. Only an exact normalized question match can use this answer."
        : "FAQ version archived.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "FAQ review could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEvents(faq: Faq) {
    if (events[faq.id]) {
      setEvents(current => { const next = { ...current }; delete next[faq.id]; return next; });
      return;
    }
    setError("");
    try {
      const result = await apiRequest<{ events: FaqEvent[] }>(
        `/businesses/${businessId}/faqs/${faq.id}/events`, accessToken,
      );
      setEvents(current => ({ ...current, [faq.id]: result.events }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "FAQ review history could not be loaded.");
    }
  }

  function beginRevision(faq: Faq) {
    setRevisionFor(faq.id);
    setQuestion(faq.question);
    setAnswer(faq.answer);
    setNotice("");
    setError("");
  }

  return <section className="control-panel" aria-label="Approved business FAQs">
    <div className="panel-heading"><div><h2>Approved FAQ answers</h2><p>Drafts never answer customers. Approval publishes an exact question match after case, punctuation, and whitespace normalization; there is no fuzzy or semantic matching. A revision remains a draft while the current approved version stays live.</p></div><button type="button" onClick={() => void refresh()} disabled={loading}>Refresh</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="quiet-note" role="status">{notice}</p>}
    {canManage && <form className="inline-form faq-form" onSubmit={event => void saveDraft(event)}>
      <label>Exact customer question<input required maxLength={500} value={question} onChange={event => setQuestion(event.target.value)} placeholder="What are your opening hours?" /></label>
      <label>Approved answer<textarea required maxLength={3000} rows={3} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Enter the exact answer your business approves." /></label>
      <div className="record-actions"><button className="primary-button" disabled={busy}>{busy ? "Saving…" : revisionFor ? "Save new draft version" : "Create FAQ draft"}</button>{revisionFor && <button type="button" disabled={busy} onClick={() => { setRevisionFor(""); setQuestion(""); setAnswer(""); }}>Cancel revision</button>}</div>
    </form>}
    {!canManage && <p className="quiet-note">You can read FAQ versions. Only a business owner or admin can create, revise, approve, or archive them.</p>}
    {loading ? <p role="status">Loading FAQs…</p> : faqs.length === 0 ? <p className="empty-copy">No FAQ drafts or approved answers yet.</p> : <div className="record-list">{faqs.map(faq => <div className="record" key={faq.id}>
      <div><strong>{faq.question}</strong><small>Version {faq.version} · {faq.status}</small><p>{faq.answer}</p><small>Created {new Date(faq.created_at).toLocaleString()} · author {faq.created_by}</small>{faq.approved_at && <small>Approved {new Date(faq.approved_at).toLocaleString()} · reviewer {faq.approved_by}</small>}</div>
      <div className="record-actions">{faq.status === "draft" && canManage && <button disabled={busy} onClick={() => void review(faq, "approve")}>Approve</button>}{["draft", "approved"].includes(faq.status) && canManage && <button disabled={busy} onClick={() => beginRevision(faq)}>Create revision</button>}{["draft", "approved"].includes(faq.status) && canManage && <button disabled={busy} onClick={() => void review(faq, "archive")}>Archive version</button>}<button onClick={() => void toggleEvents(faq)}>{events[faq.id] ? "Hide review history" : "Review history"}</button></div>
      {events[faq.id] && <div className="record-list" aria-label={`${faq.question} review history`}>{events[faq.id].length ? events[faq.id].map(item => <div className="record" key={item.id}><div><strong>{item.event_type}</strong><small>{new Date(item.created_at).toLocaleString()} · actor {item.actor_id}</small></div></div>) : <p className="empty-copy">No history for this version.</p>}</div>}
    </div>)}</div>}
  </section>;
}
