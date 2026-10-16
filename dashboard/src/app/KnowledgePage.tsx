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

type KnowledgeDoc = {
  id: string;
  title: string;
  content: string;
  source_type: "manual" | "guide" | string;
  created_at: string;
  updated_at?: string | null;
};

/** The documents the AI answers from (facts) and the conversation guide (how it talks). */
export function KnowledgeDocuments({ accessToken, businessId, canManage }: {
  accessToken: string;
  businessId: string;
  canManage: boolean;
}) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"manual" | "guide">("manual");
  const [content, setContent] = useState("");
  const [confirmRemove, setConfirmRemove] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ documents: KnowledgeDoc[] }>(`/businesses/${businessId}/knowledge`, accessToken);
      setDocs(result.documents || []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Knowledge could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, businessId]);
  useEffect(() => { void refresh(); }, [refresh]);

  function open(doc: KnowledgeDoc | null) {
    setEditing(doc ? doc.id : "new");
    setTitle(doc?.title || "");
    setKind(doc?.source_type === "guide" ? "guide" : "manual");
    setContent(doc?.content || "");
    setNotice("");
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = JSON.stringify({ title: title.trim(), content: content.trim(), source_type: kind });
      const result = await apiRequest<{ error?: string }>(
        editing === "new" ? `/businesses/${businessId}/knowledge` : `/knowledge/${editing}`,
        accessToken,
        { method: editing === "new" ? "POST" : "PUT", body },
      );
      if (result?.error) throw new Error(result.error);
      setEditing(null);
      setNotice("Saved. The assistant uses it from the next message.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Knowledge could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: KnowledgeDoc) {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/knowledge/${doc.id}`, accessToken, { method: "DELETE" });
      setConfirmRemove("");
      setNotice(`Removed "${doc.title}". The assistant no longer uses it.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Knowledge could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  const groups: { key: "manual" | "guide"; title: string; help: string }[] = [
    { key: "manual", title: "Business facts", help: "What the assistant may tell customers: services, prices, plans, policies. It never states anything that isn't here." },
    { key: "guide", title: "Conversation guide", help: "How the assistant talks: tone, greetings, which questions to ask first. Not facts; never overrides the safety rules." },
  ];
  const form = canManage && editing && (
    <form className="inline-form knowledge-form" onSubmit={event => void save(event)} aria-label={editing === "new" ? "New knowledge" : "Edit knowledge"}>
      <div className="knowledge-form-row">
        <label>Title<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="Membership plans" /></label>
        <label>Type<select value={kind} onChange={event => setKind(event.target.value as "manual" | "guide")}>
          <option value="manual">Business facts</option>
          <option value="guide">Conversation guide</option>
        </select></label>
      </div>
      <label>Content<textarea required rows={12} maxLength={40000} value={content} onChange={event => setContent(event.target.value)} placeholder="Write plainly, one fact per line. Prices with currency." /></label>
      <div className="record-actions">
        <button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
      </div>
    </form>
  );
  return <section className="control-panel" aria-label="What the AI knows">
    <div className="panel-heading">
      <div><h2>What the AI knows</h2><p>The assistant on Instagram, Messenger and the member chat answers only from these documents and the approved FAQs below. Changes apply to the next message.</p></div>
      <div className="record-actions">
        {canManage && editing === null && <button type="button" className="primary-button" onClick={() => open(null)}>Add knowledge</button>}
        <button type="button" onClick={() => void refresh()} disabled={loading}>Refresh</button>
      </div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="quiet-note" role="status">{notice}</p>}
    {editing === "new" && form}
    {loading ? <p role="status">Loading knowledge…</p> : groups.map(group => {
      const rows = docs.filter(doc => (doc.source_type === "guide" ? "guide" : "manual") === group.key);
      return <div className="knowledge-group" key={group.key}>
        <h3>{group.title} <span className="status-pill">{rows.length}</span></h3>
        <p className="quiet-note">{group.help}</p>
        {rows.length === 0 ? <p className="empty-copy">Nothing here yet.</p> : <div className="record-list">{rows.map(doc => editing === doc.id ? <div key={doc.id}>{form}</div> : <div className="record knowledge-doc" key={doc.id}>
          <div>
            <strong>{doc.title}</strong>
            <small>{doc.content.length.toLocaleString()} characters · updated {new Date(doc.updated_at || doc.created_at).toLocaleString()}</small>
            <details><summary>Show content</summary><pre className="knowledge-content">{doc.content}</pre></details>
          </div>
          {canManage && <div className="record-actions">
            <button type="button" disabled={busy || editing !== null} onClick={() => open(doc)}>Edit</button>
            {confirmRemove === doc.id
              ? <><button type="button" className="danger-button" disabled={busy} onClick={() => void remove(doc)}>Yes, remove</button><button type="button" onClick={() => setConfirmRemove("")}>Keep</button></>
              : <button type="button" disabled={busy} onClick={() => setConfirmRemove(doc.id)}>Remove</button>}
          </div>}
        </div>)}</div>}
      </div>;
    })}
  </section>;
}

export function KnowledgePage(props: { accessToken: string; businessId: string; canManage: boolean }) {
  return <div className="knowledge-page">
    <KnowledgeDocuments {...props} />
    <FaqPanel {...props} />
  </div>;
}

function FaqPanel({ accessToken, businessId, canManage }: {
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
    <div className="panel-heading"><div><h2>Approved FAQ answers</h2><p>Drafts never answer customers. An approved answer is sent word for word when a customer asks that exact question, and the assistant also reads every approved answer as a fact. A revision stays a draft while the approved version stays live.</p></div><button type="button" onClick={() => void refresh()} disabled={loading}>Refresh</button></div>
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
