import { useCallback, useEffect, useState, type FormEvent } from "react";
import "./hr.css";
import { apiRequest } from "../../lib/api";

/* HR H5 (docs/HR_AND_HIRING_PLAN.md): Control Center → People → Records and Policies, and My HR on My account. */

type TeamRow = {
  worker_id: string; name: string; photo_url: string | null; staff_role: string; job_title: string | null; start_date: string | null;
  status: "starting" | "active" | "finished"; has_record: boolean; probation_due: boolean; probation_end: string | null; policies_to_read: number;
};
type Doc = { id: string; kind: string; kind_label: string; title: string; file_name: string | null; file_size: number | null; offer_id: string | null; visible_to_worker: boolean; created_at: string };
type PolicyState = { id: string; title: string; summary: string; version: number; published_at: string | null; accepted_at: string | null; accepted_before: boolean };
type Personal = Record<(typeof PERSONAL)[number][0], string | null>;
type Person = {
  worker_id: string; name: string; photo_url: string | null; staff_role: string; account_status: string; status: TeamRow["status"]; desks: string[];
  job: { job_title: string | null; job_type: string | null; location: string | null; start_date: string | null; probation_end: string | null;
    hours_per_week: number | null; manager_id: string | null; status: string | null; probation_passed_at: string | null };
  manager_name: string | null; personal: Personal; documents: Doc[]; policies: PolicyState[];
  timeline: { id: string; kind: string; detail: Record<string, string>; created_at: string; actor_name: string | null }[];
};
type Policy = { id: string; title: string; summary: string; body: string; status: "draft" | "published" | "archived"; version: number;
  published_at: string | null; has_changes: boolean; accepted: number; team_size: number };

const PERSONAL = [
  ["legal_name", "Legal name"], ["preferred_name", "Preferred name"], ["phone", "Phone or WhatsApp"], ["country", "Country"], ["city", "City"],
  ["date_of_birth", "Date of birth (optional)"], ["emergency_name", "Emergency contact"], ["emergency_relationship", "Relationship"],
  ["emergency_phone", "Emergency phone"],
] as const;
const JOB_TYPES: Record<string, string> = { full_time: "Full time", part_time: "Part time", contract: "Contract", internship: "Internship" };
const LOCATIONS: Record<string, string> = { guangzhou: "Guangzhou office", remote: "Remote", both: "Guangzhou or remote" };
const STATUS: Record<TeamRow["status"], string> = { starting: "Starting", active: "Active", finished: "Finished" };
const EVENT: Record<string, string> = {
  record_opened: "Record opened", hired: "Hired", started: "Started", job_changed: "Job details changed", details_changed: "Personal details changed",
  probation_passed: "Probation passed", probation_extended: "Probation extended", document_added: "Document added",
  document_removed: "Document removed", policy_accepted: "Policy accepted", finished: "Finished",
};
const msg = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);
const longDate = (value?: string | null) => (value ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Not set");
const initials = (name: string) => (name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

/** Opens a document: a short-lived link to the file, or the signed offer's text in a window of its own. */
async function openDocument(path: string, accessToken: string) {
  const result = await apiRequest<{ url?: string; text?: string; signed_by?: string; signed_at?: string }>(path, accessToken);
  if (result.url) {
    window.open(result.url, "_blank", "noopener");
    return null;
  }
  return result;
}

function LetterDialog({ letter, onClose }: { letter: { text?: string; signed_by?: string; signed_at?: string }; onClose: () => void }) {
  return (
    <>
      <div className="hr-scrim hr-scrim-top" onClick={onClose} aria-hidden="true" />
      <div className="hr-move-dialog hr-reader" role="dialog" aria-modal="true" aria-label="Signed offer">
        <h2>Signed offer</h2>
        <pre className="hr-letter">{letter.text}</pre>
        {letter.signed_by && <p className="muted">Signed “{letter.signed_by}”{letter.signed_at ? ` on ${longDate(letter.signed_at)}` : ""}.</p>}
        <div className="hr-editor-actions"><button type="button" className="primary-button" onClick={onClose}>Close</button></div>
      </div>
    </>
  );
}

// ---- Records ----------------------------------------------------------------------------------------------------------
export function RecordsPanel({ accessToken }: { accessToken: string }) {
  const [team, setTeam] = useState<TeamRow[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    apiRequest<{ people: TeamRow[] }>("/hr/people", accessToken).then((r) => setTeam(r.people)).catch((reason) => setError(msg(reason, "The team could not be loaded.")));
  }, [accessToken]);
  useEffect(load, [load]);
  return (
    <div className="control-panel hr-records">
      <div className="panel-heading"><h2>Records</h2><p className="muted">Everyone on the team: their job, dates, personal details, documents and policies. Pay and ID documents are never kept here.</p></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!team ? <p className="muted">Loading…</p> : (
        <ul className="hr-people-grid">
          {team.map((row) => (
            <li key={row.worker_id}>
              <button type="button" className="hr-person-card" onClick={() => setOpen(row.worker_id)}>
                <span className="hr-initials" aria-hidden="true">{row.photo_url ? <img src={row.photo_url} alt="" /> : initials(row.name)}</span>
                <span><strong>{row.name}</strong><small>{row.job_title || "No job title"}{row.start_date ? ` · since ${longDate(row.start_date)}` : ""}</small></span>
                <span className="hr-person-flags">
                  <span className={`hr-status is-${row.status === "active" ? "open" : row.status === "starting" ? "paused" : "closed"}`}>{STATUS[row.status]}</span>
                  {row.probation_due && <b className="hr-flag is-due">Probation review</b>}
                  {row.policies_to_read > 0 && <b className="hr-flag">{row.policies_to_read} to read</b>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <PersonPanel accessToken={accessToken} workerId={open} team={team || []} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

function PersonPanel({ accessToken, workerId, team, onClose, onChanged }: { accessToken: string; workerId: string; team: TeamRow[]; onClose: () => void; onChanged: () => void }) {
  const [person, setPerson] = useState<Person | null>(null);
  const [job, setJob] = useState<Record<string, string>>({});
  const [personal, setPersonal] = useState<Record<string, string>>({});
  const [upload, setUpload] = useState<{ kind: string; title: string; file: File | null; visible: boolean }>({ kind: "contract", title: "", file: null, visible: true });
  const [letter, setLetter] = useState<{ text?: string; signed_by?: string; signed_at?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const take = (p: Person) => {
    setPerson(p);
    setJob({ job_title: p.job.job_title || "", job_type: p.job.job_type || "", location: p.job.location || "", start_date: p.job.start_date || "",
      probation_end: p.job.probation_end || "", hours_per_week: p.job.hours_per_week ? String(p.job.hours_per_week) : "", manager_id: p.job.manager_id || "" });
    setPersonal(Object.fromEntries(PERSONAL.map(([key]) => [key, p.personal[key] || ""])));
  };
  useEffect(() => {
    apiRequest<{ person: Person }>(`/hr/people/${workerId}`, accessToken).then((r) => take(r.person)).catch((reason) => setError(msg(reason, "The record could not be loaded.")));
  }, [accessToken, workerId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !letter && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, letter]);

  async function call(path: string, init: RequestInit, done: string) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const result = await apiRequest<{ person: Person }>(path, accessToken, init);
      take(result.person);
      setSaved(done);
      onChanged();
    } catch (reason) {
      setError(msg(reason, "That didn't work."));
    } finally {
      setBusy(false);
    }
  }
  async function sendFile(event: FormEvent) {
    event.preventDefault();
    if (!upload.file) return;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ kind: upload.kind, title: upload.title || upload.file.name, name: upload.file.name, visible: String(upload.visible) });
      await apiRequest(`/hr/people/${workerId}/documents?${params}`, accessToken, { method: "POST", body: upload.file, headers: { "Content-Type": upload.file.type || "application/octet-stream" } }, 60_000);
      const fresh = await apiRequest<{ person: Person }>(`/hr/people/${workerId}`, accessToken);
      take(fresh.person);
      setUpload({ kind: "contract", title: "", file: null, visible: true });
      setSaved("Document added.");
    } catch (reason) {
      setError(msg(reason, "The document could not be saved."));
    } finally {
      setBusy(false);
    }
  }
  const nullable = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim() === "" ? null : k === "hours_per_week" ? Number(v) : v]));
  const probationOpen = person && person.job.probation_end && !person.job.probation_passed_at;

  return (
    <>
      <div className="hr-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="hr-panel" role="dialog" aria-modal="true" aria-label={person?.name || "Team member"}>
        <header>
          <div>
            <h2>{person?.name || "Team member"}</h2>
            {person && <p className="muted">{STATUS[person.status]}{person.desks.length ? ` · ${person.desks.join(", ")}` : ""}{person.staff_role === "ceo" ? " · CEO" : person.staff_role === "assistant" ? " · CEO's assistant" : ""}</p>}
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </header>
        {error && <p className="form-error" role="alert">{error}</p>}
        {saved && <p className="email-delivery ok" role="status">{saved}</p>}
        {!person ? <p className="muted">Loading…</p> : (
          <div className="hr-panel-body">
            {probationOpen && (
              <section className="hr-probation"><h3>Probation {person.job.probation_end && new Date(person.job.probation_end) <= new Date() ? "review due" : `ends ${longDate(person.job.probation_end)}`}</h3>
                <div className="hr-links">
                  <button type="button" className="primary-button" disabled={busy} onClick={() => void call(`/hr/people/${workerId}/probation`, { method: "POST", body: JSON.stringify({ decision: "pass" }) }, "Probation passed.")}>Pass probation</button>
                  {[1, 2, 3].map((months) => (
                    <button key={months} type="button" className="secondary-button" disabled={busy} onClick={() => void call(`/hr/people/${workerId}/probation`, { method: "POST", body: JSON.stringify({ decision: "extend", months }) }, `Probation extended by ${months} month${months > 1 ? "s" : ""}.`)}>Extend {months} month{months > 1 ? "s" : ""}</button>
                  ))}
                </div>
              </section>
            )}
            <form className="hr-record-form" onSubmit={(e) => { e.preventDefault(); void call(`/hr/people/${workerId}`, { method: "PUT", body: JSON.stringify(nullable(job)) }, "Job details saved."); }} aria-label="Job">
              <h3>Job</h3>
              <div className="hr-grid">
                <label>Job title<input value={job.job_title} maxLength={80} onChange={(e) => setJob({ ...job, job_title: e.target.value })} /></label>
                <label>Manager<select value={job.manager_id} onChange={(e) => setJob({ ...job, manager_id: e.target.value })}>
                  <option value="">No manager</option>
                  {team.filter((t) => t.worker_id !== workerId && t.status !== "finished").map((t) => <option key={t.worker_id} value={t.worker_id}>{t.name}</option>)}
                </select></label>
                <label>Job type<select value={job.job_type} onChange={(e) => setJob({ ...job, job_type: e.target.value })}><option value="">Not set</option>{Object.entries(JOB_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Location<select value={job.location} onChange={(e) => setJob({ ...job, location: e.target.value })}><option value="">Not set</option>{Object.entries(LOCATIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Start date<input type="date" value={job.start_date} onChange={(e) => setJob({ ...job, start_date: e.target.value })} /></label>
                <label>Probation ends<input type="date" value={job.probation_end} onChange={(e) => setJob({ ...job, probation_end: e.target.value })} disabled={Boolean(person.job.probation_passed_at)} /></label>
                <label>Hours a week<input type="number" min={1} max={60} value={job.hours_per_week} onChange={(e) => setJob({ ...job, hours_per_week: e.target.value })} /></label>
              </div>
              {person.job.probation_passed_at && <p className="muted">Probation passed on {longDate(person.job.probation_passed_at)}.</p>}
              <button type="submit" className="secondary-button" disabled={busy}>Save job details</button>
            </form>
            <form className="hr-record-form" onSubmit={(e) => { e.preventDefault(); void call(`/hr/people/${workerId}`, { method: "PUT", body: JSON.stringify(nullable(personal)) }, "Personal details saved."); }} aria-label="Personal details">
              <h3>Personal details and emergency contact</h3>
              <div className="hr-grid">
                {PERSONAL.map(([key, label]) => (
                  <label key={key}>{label}<input type={key === "date_of_birth" ? "date" : key.includes("phone") ? "tel" : "text"} value={personal[key] || ""} onChange={(e) => setPersonal({ ...personal, [key]: e.target.value })} /></label>
                ))}
              </div>
              <button type="submit" className="secondary-button" disabled={busy}>Save personal details</button>
            </form>
            <section className="hr-documents"><h3>Documents</h3>
              {person.documents.length === 0 ? <p className="muted">No documents yet.</p> : (
                <ul className="hr-doc-list">
                  {person.documents.map((doc) => (
                    <li key={doc.id}>
                      <span><strong>{doc.title}</strong><small className="muted">{doc.kind_label}{doc.visible_to_worker ? "" : " · HR only"} · {longDate(doc.created_at)}</small></span>
                      <button type="button" className="secondary-button" onClick={async () => { try { const text = await openDocument(`/hr/documents/${doc.id}`, accessToken); if (text) setLetter(text); } catch (reason) { setError(msg(reason, "The document could not be opened.")); } }}>Open</button>
                      {doc.kind !== "offer" && (
                        <button type="button" className="text-link-button" onClick={async () => { try { await apiRequest(`/hr/documents/${doc.id}`, accessToken, { method: "DELETE" }); setPerson({ ...person, documents: person.documents.filter((d) => d.id !== doc.id) }); } catch (reason) { setError(msg(reason, "The document could not be removed.")); } }}>Remove</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <form className="hr-upload" onSubmit={sendFile} aria-label="Add a document">
                <div className="hr-grid">
                  <label>Kind<select value={upload.kind} onChange={(e) => setUpload({ ...upload, kind: e.target.value })}><option value="contract">Contract</option><option value="certificate">Certificate</option><option value="other">Other</option></select></label>
                  <label>Title<input value={upload.title} maxLength={120} placeholder="e.g. Signed contract" onChange={(e) => setUpload({ ...upload, title: e.target.value })} /></label>
                </div>
                <label>File (PDF, Word or image, up to 10 MB)<input type="file" accept=".pdf,.docx,image/jpeg,image/png,image/webp" onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] || null })} /></label>
                <label className="hr-check"><input type="checkbox" checked={upload.visible} onChange={(e) => setUpload({ ...upload, visible: e.target.checked })} /> {person.name.split(" ")[0]} can see it in My HR</label>
                <p className="muted">Never upload passports or other ID documents.</p>
                <button type="submit" className="secondary-button" disabled={busy || !upload.file}>Add document</button>
              </form>
            </section>
            <section><h3>Policies</h3>
              {person.policies.length === 0 ? <p className="muted">No policies are published yet.</p> : (
                <ul className="hr-doc-list">{person.policies.map((p) => (
                  <li key={p.id}><span><strong>{p.title}</strong><small className="muted">Version {p.version}</small></span>
                    <span className={p.accepted_at ? "hr-status is-open" : "hr-status is-paused"}>{p.accepted_at ? `Accepted ${longDate(p.accepted_at)}` : "Not read yet"}</span></li>
                ))}</ul>
              )}
            </section>
            <section><h3>Timeline</h3>
              <ol className="hr-activity">{person.timeline.map((e) => (
                <li key={e.id}><span>{EVENT[e.kind] || e.kind}{e.detail.title ? `: ${e.detail.title}` : e.detail.job_title ? `: ${e.detail.job_title}` : e.detail.until ? ` to ${longDate(e.detail.until)}` : ""}{e.actor_name ? ` · ${e.actor_name}` : ""}</span>
                  <small>{longDate(e.created_at)}</small></li>
              ))}</ol>
            </section>
          </div>
        )}
      </aside>
      {letter && <LetterDialog letter={letter} onClose={() => setLetter(null)} />}
    </>
  );
}

// ---- Policies ---------------------------------------------------------------------------------------------------------
export function PoliciesPanel({ accessToken }: { accessToken: string }) {
  const [list, setList] = useState<Policy[] | null>(null);
  const [editing, setEditing] = useState<Policy | "new" | null>(null);
  const [form, setForm] = useState({ title: "", summary: "", body: "" });
  const [who, setWho] = useState<{ version: number; people: { worker_id: string; name: string; accepted_at: string | null }[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    apiRequest<{ policies: Policy[] }>("/hr/policies", accessToken).then((r) => setList(r.policies)).catch((reason) => setError(msg(reason, "Policies could not be loaded.")));
  }, [accessToken]);
  useEffect(load, [load]);
  function edit(policy: Policy | "new") {
    setEditing(policy);
    setConfirming(false);
    setWho(null);
    setForm(policy === "new" ? { title: "", summary: "", body: "" } : { title: policy.title, summary: policy.summary, body: policy.body });
    if (policy !== "new" && policy.status === "published") {
      apiRequest<NonNullable<typeof who>>(`/hr/policies/${policy.id}/acknowledgements`, accessToken).then(setWho).catch(() => undefined);
    }
  }
  async function run(path: string, init: RequestInit) {
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ policy: Policy }>(path, accessToken, init);
      load();
      return result.policy;
    } catch (reason) {
      setError(msg(reason, "That didn't work."));
      return null;
    } finally {
      setBusy(false);
    }
  }
  if (editing) {
    const current = editing === "new" ? null : list?.find((p) => p.id === editing.id) || editing;
    return (
      <form className="control-panel hr-editor" aria-label={current ? `Edit ${current.title}` : "New policy"} onSubmit={async (e) => {
        e.preventDefault();
        const saved = await run(current ? `/hr/policies/${current.id}` : "/hr/policies", { method: current ? "PUT" : "POST", body: JSON.stringify(form) });
        if (saved) setEditing({ ...saved, has_changes: true, accepted: 0, team_size: 0 });
      }}>
        <div className="panel-heading">
          <h2>{current ? current.title : "New policy"}</h2>
          <p className="muted">{current?.status === "published" ? `Version ${current.version} is published. Saved changes stay unpublished until you publish them.` : "Drafts aren't shown to the team until you publish them."}</p>
        </div>
        <label>Title<input value={form.title} maxLength={120} required onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>One-line summary<input value={form.summary} maxLength={300} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></label>
        <label>Policy text<textarea className="hr-letter-edit" rows={14} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {confirming && current && (
          <div className="hr-confirm" role="alertdialog" aria-label="Publish">
            <p>Publish this as version {current.version + 1}? Everyone on the team will be asked to read and accept it.</p>
            <div className="hr-links">
              <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>Not yet</button>
              <button type="button" className="primary-button" disabled={busy} onClick={async () => { const p = await run(`/hr/policies/${current.id}/publish`, { method: "POST" }); if (p) { setConfirming(false); setEditing(null); } }}>Publish</button>
            </div>
          </div>
        )}
        <div className="hr-editor-actions">
          <button type="button" className="secondary-button" onClick={() => setEditing(null)}>Back to policies</button>
          {current && current.status !== "archived" && <button type="button" className="text-link-button" disabled={busy} onClick={async () => { if (await run(`/hr/policies/${current.id}/archive`, { method: "POST" })) setEditing(null); }}>Archive</button>}
          <button type="submit" className="secondary-button" disabled={busy}>Save</button>
          {current && <button type="button" className="primary-button" disabled={busy} onClick={() => setConfirming(true)}>Publish…</button>}
        </div>
        {who && (
          <section><h3>Who has accepted version {who.version}</h3>
            <ul className="hr-doc-list">{who.people.map((p) => <li key={p.worker_id}><span>{p.name}</span><span className={p.accepted_at ? "hr-status is-open" : "hr-status is-paused"}>{p.accepted_at ? `Accepted ${longDate(p.accepted_at)}` : "Not yet"}</span></li>)}</ul>
          </section>
        )}
      </form>
    );
  }
  return (
    <div className="control-panel hr-policies">
      <div className="hr-jobs-head"><h2>Policies</h2><button type="button" className="primary-button" onClick={() => edit("new")}>New policy</button></div>
      <p className="muted">The staff handbook. Publishing a policy, or a new version of it, asks everyone to read and accept it in My HR.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!list ? <p className="muted">Loading…</p> : (
        <ul className="hr-doc-list">{list.map((p) => (
          <li key={p.id}>
            <button type="button" className="hr-policy-row" onClick={() => edit(p)}>
              <strong>{p.title}</strong><small className="muted">{p.summary}</small>
            </button>
            <span className={`hr-status is-${p.status === "published" ? "open" : p.status === "draft" ? "paused" : "closed"}`}>
              {p.status === "published" ? `v${p.version} · ${p.accepted}/${p.team_size} accepted${p.has_changes ? " · unpublished changes" : ""}` : p.status === "draft" ? "Draft" : "Archived"}
            </span>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

// ---- My HR (every team member, on My account) -------------------------------------------------------------------------
type Mine = {
  job: { job_title: string | null; job_type: string | null; location: string | null; start_date: string | null; probation_end: string | null; hours_per_week: number | null; manager: string | null };
  personal: Personal; documents: Doc[]; policies: PolicyState[];
};

export function MyHr({ accessToken }: { accessToken: string }) {
  const [mine, setMine] = useState<Mine | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [reading, setReading] = useState<{ id: string; title: string; body: string; version: number } | null>(null);
  const [agree, setAgree] = useState(false);
  const [letter, setLetter] = useState<{ text?: string; signed_by?: string; signed_at?: string } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const take = (m: Mine) => {
    setMine(m);
    setDetails(Object.fromEntries(PERSONAL.map(([key]) => [key, m.personal[key] || ""])));
  };
  useEffect(() => {
    apiRequest<Mine>("/hr/my", accessToken).then(take).catch((reason) => setError(msg(reason, "My HR could not be loaded.")));
  }, [accessToken]);
  if (error && !mine) return <section className="control-panel" aria-label="My HR"><h2>My HR</h2><p className="form-error" role="alert">{error}</p></section>;
  if (!mine) return null;
  const toRead = mine.policies.filter((p) => !p.accepted_at);
  return (
    <section className="control-panel my-hr" aria-label="My HR">
      <div className="panel-heading"><div><h2>My HR {toRead.length > 0 && <b className="hr-flag is-due">{toRead.length} to read</b>}</h2><p>Your job, your details, your documents and the staff policies.</p></div></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && <p className="email-delivery ok" role="status">{saved}</p>}
      <div className="my-hr-grid">
        <section className="my-hr-card"><h3>Policies to read</h3>
          {mine.policies.length === 0 ? <p className="muted">Nothing to read yet.</p> : (
            <ul className="hr-doc-list">{mine.policies.map((p) => (
              <li key={p.id}><span><strong>{p.title}</strong><small className="muted">{p.accepted_at ? `Accepted ${longDate(p.accepted_at)}` : p.accepted_before ? "Updated: please read the new version" : p.summary}</small></span>
                <button type="button" className={p.accepted_at ? "secondary-button" : "primary-button"} onClick={async () => {
                  try { const r = await apiRequest<{ policy: { id: string; title: string; body: string; version: number } }>(`/hr/my/policies/${p.id}`, accessToken); setAgree(false); setReading(r.policy); }
                  catch (reason) { setError(msg(reason, "The policy could not be loaded.")); }
                }}>{p.accepted_at ? "Read again" : "Read"}</button></li>
            ))}</ul>
          )}
        </section>
        <section className="my-hr-card"><h3>My job</h3>
          <dl className="hr-facts">
            <div><dt>Job title</dt><dd>{mine.job.job_title || "Not set"}</dd></div>
            <div><dt>Manager</dt><dd>{mine.job.manager || "Not set"}</dd></div>
            <div><dt>Started</dt><dd>{longDate(mine.job.start_date)}</dd></div>
            {mine.job.probation_end && <div><dt>Probation ends</dt><dd>{longDate(mine.job.probation_end)}</dd></div>}
            {mine.job.job_type && <div><dt>Type</dt><dd>{JOB_TYPES[mine.job.job_type]}{mine.job.location ? `, ${LOCATIONS[mine.job.location]}` : ""}</dd></div>}
            {mine.job.hours_per_week && <div><dt>Hours a week</dt><dd>{mine.job.hours_per_week}</dd></div>}
          </dl>
        </section>
        <section className="my-hr-card"><h3>My documents</h3>
          {mine.documents.length === 0 ? <p className="muted">No documents yet.</p> : (
            <ul className="hr-doc-list">{mine.documents.map((doc) => (
              <li key={doc.id}><span><strong>{doc.title}</strong><small className="muted">{doc.kind_label}</small></span>
                <button type="button" className="secondary-button" onClick={async () => { try { const text = await openDocument(`/hr/my/documents/${doc.id}`, accessToken); if (text) setLetter(text); } catch (reason) { setError(msg(reason, "The document could not be opened.")); } }}>Open</button></li>
            ))}</ul>
          )}
        </section>
      </div>
      <form className="hr-record-form" aria-label="My details" onSubmit={async (e) => {
        e.preventDefault();
        setSaved("");
        try {
          take(await apiRequest<Mine>("/hr/my/details", accessToken, { method: "PUT", body: JSON.stringify(Object.fromEntries(Object.entries(details).map(([k, v]) => [k, v.trim() || null]))) }));
          setSaved("Your details are saved.");
        } catch (reason) { setError(msg(reason, "Your details could not be saved.")); }
      }}>
        <h3>My details and emergency contact</h3>
        <p className="muted">Only HR sees these. Keep your emergency contact up to date.</p>
        <div className="hr-grid">
          {PERSONAL.map(([key, label]) => (
            <label key={key}>{label}<input type={key === "date_of_birth" ? "date" : key.includes("phone") ? "tel" : "text"} value={details[key] || ""} onChange={(e) => setDetails({ ...details, [key]: e.target.value })} /></label>
          ))}
        </div>
        <button type="submit" className="secondary-button">Save my details</button>
      </form>
      {reading && (
        <>
          <div className="hr-scrim hr-scrim-top" onClick={() => setReading(null)} aria-hidden="true" />
          <div className="hr-move-dialog hr-reader" role="dialog" aria-modal="true" aria-label={reading.title}>
            <h2>{reading.title}</h2>
            <div className="hr-policy-text" tabIndex={0}>{reading.body}</div>
            {!mine.policies.find((p) => p.id === reading.id)?.accepted_at && (
              <label className="hr-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I have read this policy and I will follow it.</label>
            )}
            <div className="hr-editor-actions">
              <button type="button" className="secondary-button" onClick={() => setReading(null)}>Close</button>
              {!mine.policies.find((p) => p.id === reading.id)?.accepted_at && (
                <button type="button" className="primary-button" disabled={!agree} onClick={async () => {
                  try {
                    const r = await apiRequest<{ policies: PolicyState[] }>(`/hr/my/policies/${reading.id}/accept`, accessToken, { method: "POST", body: JSON.stringify({ version: reading.version }) });
                    setMine({ ...mine, policies: r.policies });
                    setReading(null);
                    setSaved("Thank you. Policy accepted.");
                  } catch (reason) { setError(msg(reason, "That didn't work.")); setReading(null); }
                }}>Accept</button>
              )}
            </div>
          </div>
        </>
      )}
      {letter && <LetterDialog letter={letter} onClose={() => setLetter(null)} />}
    </section>
  );
}

