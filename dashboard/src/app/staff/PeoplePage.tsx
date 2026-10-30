import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest } from "../../lib/api";
import { WorkforcePage } from "./WorkforcePage";
import "./hr.css";

/* Control Center → People (docs/HR_AND_HIRING_PLAN.md, H1). Hiring for HR staff, the CEO and the owner; Team (today's
   workforce directory) and HR access for the owner. */

type Question = { id?: string; label: string; kind: "short" | "yes_no" | "choice"; options: string[]; required: boolean };
export type HrJob = {
  id: string;
  slug: string;
  title: string;
  department: string;
  job_type: string;
  location: string;
  pay_range: string | null;
  show_pay: boolean;
  summary: string;
  duties: string[];
  requirements: string[];
  questions: Question[];
  trial_task: boolean;
  trial_paid: boolean;
  status: "draft" | "open" | "paused" | "closed";
  counts?: Record<string, number>;
};
type JobsResponse = { jobs: HrJob[]; departments: Record<string, string>; job_types: Record<string, string>; locations: Record<string, string> };
type ApplicationRow = {
  id: string; job_id: string; job_title: string; stage: string; created_at: string; stage_changed_at?: string;
  name: string; email: string | null; location: string | null; languages: string | null; days_in_stage?: number;
};
type Detail = {
  application: { id: string; stage: string; answers: { label: string; answer: string }[]; cv_name: string | null; has_cv: boolean;
    portfolio_url: string | null; heard_from: string | null; close_reason: string | null; created_at: string };
  candidate: { full_name: string | null; email: string | null; phone: string | null; location: string | null; languages: string | null; retain_until: string | null };
  job: { id: string; title: string; trial_task: boolean };
  other_applications: { id: string; stage: string }[];
  events: { id: string; kind: string; detail: Record<string, string>; created_at: string }[];
};

export const STAGES: [string, string][] = [
  ["applied", "Applied"], ["screening", "Screening"], ["interview", "Interview"], ["trial_task", "Trial task"],
  ["offer", "Offer"], ["hired", "Hired"], ["not_moving_forward", "Not moving forward"], ["withdrew", "Withdrew"],
];
const STAGE_LABEL = Object.fromEntries(STAGES);
const STATUS_LABEL: Record<HrJob["status"], string> = { draft: "Draft", open: "Open", paused: "Paused", closed: "Closed" };
const SITE = "https://www.fayfort.com";
const day = (value?: string | null) => (value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
const message = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);

export function PeoplePage({ accessToken, platformAdmin }: { accessToken: string; platformAdmin: boolean }) {
  const [tab, setTab] = useState<"hiring" | "team" | "access">(() => {
    // Old links (?page=workforce, a worker profile, #timesheets) open the Team tab.
    const query = new URLSearchParams(window.location.search);
    return platformAdmin && (query.get("page") === "workforce" || query.get("worker") || window.location.hash === "#timesheets") ? "team" : "hiring";
  });
  const tabs = platformAdmin ? ([["hiring", "Hiring"], ["team", "Team"], ["access", "HR access"]] as const) : ([["hiring", "Hiring"]] as const);
  return (
    <div className="people-page">
      {tabs.length > 1 && (
        <div className="team-tabs" role="tablist" aria-label="People">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === "hiring" && <HiringPanel accessToken={accessToken} />}
      {tab === "team" && platformAdmin && <WorkforcePage accessToken={accessToken} />}
      {tab === "access" && platformAdmin && <HrAccessPanel accessToken={accessToken} />}
    </div>
  );
}

// ---- Hiring -----------------------------------------------------------------------------------------------------------
function HiringPanel({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<HrJob | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiRequest<JobsResponse>("/hr/jobs", accessToken));
      setError("");
    } catch (reason) {
      setError(message(reason, "Jobs could not be loaded."));
    }
  }, [accessToken]);
  useEffect(() => void load(), [load]);

  const job = data?.jobs.find((item) => item.id === selected) || null;
  if (error && !data) return <p className="form-error" role="alert">{error}</p>;
  if (!data) return <p className="muted">Loading jobs…</p>;

  if (editing)
    return (
      <JobEditor
        accessToken={accessToken}
        job={editing === "new" ? null : editing}
        options={data}
        onDone={(saved) => {
          setEditing(null);
          if (saved) setSelected(saved.id);
          void load();
        }}
      />
    );

  return (
    <div className="hr-hiring">
      <aside className="control-panel hr-jobs" aria-label="Jobs">
        <div className="hr-jobs-head">
          <h2>Jobs</h2>
          <button type="button" className="primary-button" onClick={() => setEditing("new")}>New job</button>
        </div>
        {data.jobs.length === 0 ? (
          <p className="muted">No jobs yet. Add one, then open it to show it on fayfort.com/careers.</p>
        ) : (
          <ul>
            <li>
              <button type="button" className={selected === null ? "hr-job is-active" : "hr-job"} onClick={() => setSelected(null)}>
                <strong>All applications</strong>
                <small>{data.jobs.reduce((sum, item) => sum + Object.values(item.counts || {}).reduce((a, b) => a + b, 0), 0)} in total</small>
              </button>
            </li>
            {data.jobs.map((item) => {
              const total = Object.values(item.counts || {}).reduce((a, b) => a + b, 0);
              const fresh = item.counts?.applied || 0;
              return (
                <li key={item.id}>
                  <button type="button" className={selected === item.id ? "hr-job is-active" : "hr-job"} onClick={() => setSelected(item.id)}>
                    <strong>{item.title}</strong>
                    <small>
                      <span className={`hr-status is-${item.status}`}>{STATUS_LABEL[item.status]}</span> {total} applied
                      {fresh > 0 && <b className="hr-new">{fresh} new</b>}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
      <section className="hr-main">
        {job && <JobSummary job={job} accessToken={accessToken} onEdit={() => setEditing(job)} onChanged={() => void load()} />}
        <ApplicationsPanel accessToken={accessToken} jobId={selected} trialTask={job ? job.trial_task : data.jobs.some((item) => item.trial_task)} />
      </section>
    </div>
  );
}

function JobSummary({ job, accessToken, onEdit, onChanged }: { job: HrJob; accessToken: string; onEdit: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function setStatus(status: HrJob["status"]) {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/hr/jobs/${job.id}/status`, accessToken, { method: "POST", body: JSON.stringify({ status }) });
      onChanged();
    } catch (reason) {
      setError(message(reason, "The job could not be updated."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="control-panel hr-job-summary">
      <div>
        <h2>{job.title}</h2>
        <p className="muted">
          <span className={`hr-status is-${job.status}`}>{STATUS_LABEL[job.status]}</span>
          {job.status === "open" && (
            <> · <a href={`${SITE}/careers/${job.slug}`} target="_blank" rel="noreferrer">fayfort.com/careers/{job.slug}</a></>
          )}
        </p>
      </div>
      <div className="hr-job-actions">
        <button type="button" className="secondary-button" onClick={onEdit}>Edit</button>
        {job.status !== "open" && <button type="button" className="primary-button" disabled={busy} onClick={() => void setStatus("open")}>Open on the careers page</button>}
        {job.status === "open" && <button type="button" className="secondary-button" disabled={busy} onClick={() => void setStatus("paused")}>Pause</button>}
        {job.status !== "closed" && job.status !== "draft" && <button type="button" className="secondary-button" disabled={busy} onClick={() => void setStatus("closed")}>Close</button>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

function JobEditor({ job, accessToken, options, onDone }: { job: HrJob | null; accessToken: string; options: JobsResponse; onDone: (saved: HrJob | null) => void }) {
  const [form, setForm] = useState(() => ({
    title: job?.title || "", department: job?.department || "sourcing", job_type: job?.job_type || "full_time",
    location: job?.location || "guangzhou", pay_range: job?.pay_range || "", show_pay: job?.show_pay || false,
    summary: job?.summary || "", duties: (job?.duties || []).join("\n"), requirements: (job?.requirements || []).join("\n"),
    trial_task: job?.trial_task || false, trial_paid: job?.trial_paid || false,
  }));
  const [questions, setQuestions] = useState<Question[]>(job?.questions || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = JSON.stringify({
        ...form, pay_range: form.pay_range.trim() || null, duties: lines(form.duties), requirements: lines(form.requirements),
        questions: questions.filter((q) => q.label.trim()).map((q) => ({ ...q, options: q.kind === "choice" ? q.options.filter(Boolean) : [] })),
      });
      const saved = job
        ? await apiRequest<{ job: HrJob }>(`/hr/jobs/${job.id}`, accessToken, { method: "PUT", body })
        : await apiRequest<{ job: HrJob }>("/hr/jobs", accessToken, { method: "POST", body });
      onDone(saved.job);
    } catch (reason) {
      setError(message(reason, "The job could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="control-panel hr-editor" onSubmit={save} aria-label={job ? `Edit ${job.title}` : "New job"}>
      <div className="panel-heading">
        <h2>{job ? `Edit ${job.title}` : "New job"}</h2>
        <p className="muted">Saved jobs stay as drafts until you open them on the careers page.</p>
      </div>
      <div className="hr-grid">
        <label className="hr-wide">Job title<input required maxLength={80} value={form.title} onChange={(e) => set("title", e.target.value)} /></label>
        <label>Desk<select value={form.department} onChange={(e) => set("department", e.target.value)}>
          {Object.entries(options.departments).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Job type<select value={form.job_type} onChange={(e) => set("job_type", e.target.value)}>
          {Object.entries(options.job_types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Location<select value={form.location} onChange={(e) => set("location", e.target.value)}>
          {Object.entries(options.locations).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Pay range (optional)<input maxLength={80} placeholder="e.g. 8,000 to 10,000 CNY a month" value={form.pay_range} onChange={(e) => set("pay_range", e.target.value)} /></label>
        <label className="hr-check"><input type="checkbox" checked={form.show_pay} onChange={(e) => set("show_pay", e.target.checked)} /> Show the pay range on the careers page</label>
      </div>
      <label>Description<textarea rows={4} maxLength={1200} value={form.summary} onChange={(e) => set("summary", e.target.value)} placeholder="Two or three sentences about the role and the team." /></label>
      <div className="hr-grid">
        <label>What you&apos;ll do (one per line)<textarea rows={5} value={form.duties} onChange={(e) => set("duties", e.target.value)} /></label>
        <label>What we&apos;re looking for (one per line)<textarea rows={5} value={form.requirements} onChange={(e) => set("requirements", e.target.value)} /></label>
      </div>
      <fieldset className="hr-questions">
        <legend>Screening questions (up to 5)</legend>
        {questions.map((question, index) => (
          <div key={index} className="hr-question">
            <input aria-label={`Question ${index + 1}`} maxLength={200} placeholder="Question" value={question.label}
              onChange={(e) => setQuestions((all) => all.map((q, i) => (i === index ? { ...q, label: e.target.value } : q)))} />
            <select aria-label={`Answer type for question ${index + 1}`} value={question.kind}
              onChange={(e) => setQuestions((all) => all.map((q, i) => (i === index ? { ...q, kind: e.target.value as Question["kind"] } : q)))}>
              <option value="short">Short answer</option><option value="yes_no">Yes or no</option><option value="choice">Multiple choice</option>
            </select>
            {question.kind === "choice" && (
              <input aria-label={`Choices for question ${index + 1}`} placeholder="Choices, separated by commas" value={question.options.join(", ")}
                onChange={(e) => setQuestions((all) => all.map((q, i) => (i === index ? { ...q, options: e.target.value.split(",").map((s) => s.trim()) } : q)))} />
            )}
            <button type="button" className="text-link-button" onClick={() => setQuestions((all) => all.filter((_, i) => i !== index))}>Remove</button>
          </div>
        ))}
        {questions.length < 5 && (
          <button type="button" className="secondary-button" onClick={() => setQuestions((all) => [...all, { label: "", kind: "short", options: [], required: true }])}>Add a question</button>
        )}
      </fieldset>
      <div className="hr-trial">
        <label className="hr-check"><input type="checkbox" checked={form.trial_task} onChange={(e) => set("trial_task", e.target.checked)} /> This role has a trial task</label>
        {form.trial_task && (
          <div className="hr-segment" role="radiogroup" aria-label="Trial task pay">
            {[[true, "Paid"], [false, "Unpaid"]].map(([value, label]) => (
              <label key={String(label)} className={form.trial_paid === value ? "is-active" : ""}>
                <input type="radio" name="trial_paid" checked={form.trial_paid === value} onChange={() => set("trial_paid", value as boolean)} />{label}
              </label>
            ))}
          </div>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="hr-editor-actions">
        <button type="button" className="secondary-button" onClick={() => onDone(null)}>Cancel</button>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save job"}</button>
      </div>
    </form>
  );
}

type ListMeta = { close_reasons: string[]; emailed_stages: string[] };
const OPEN_STAGES = ["applied", "screening", "interview", "trial_task", "offer"];
const CLOSED_STAGES = ["not_moving_forward", "withdrew"];
const initials = (name: string) => (name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

function ApplicationsPanel({ accessToken, jobId, trialTask }: { accessToken: string; jobId: string | null; trialTask: boolean }) {
  const [rows, setRows] = useState<ApplicationRow[] | null>(null);
  const [meta, setMeta] = useState<ListMeta>({ close_reasons: [], emailed_stages: [] });
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [view, setView] = useState<"board" | "list">(() => (typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1100px)").matches ? "board" : "list"));
  const [search, setSearch] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState<{ row: ApplicationRow; stage: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ applications: ApplicationRow[] } & ListMeta>(`/hr/applications${jobId ? `?job_id=${jobId}` : ""}`, accessToken);
      setRows(result.applications);
      setMeta({ close_reasons: result.close_reasons || [], emailed_stages: result.emailed_stages || [] });
      setError("");
    } catch (reason) {
      setError(message(reason, "Applications could not be loaded."));
    }
  }, [accessToken, jobId]);
  useEffect(() => void load(), [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (rows || []).filter((row) => !needle || `${row.name} ${row.location || ""} ${row.languages || ""}`.toLowerCase().includes(needle));
  }, [rows, search]);
  const stages = [...OPEN_STAGES.filter((key) => key !== "trial_task" || trialTask), ...(showClosed ? CLOSED_STAGES : [])];
  const groups = stages.map((key) => ({ key, label: STAGE_LABEL[key], items: filtered.filter((row) => row.stage === key) }));
  const closedCount = (rows || []).filter((row) => CLOSED_STAGES.includes(row.stage)).length;

  function drop(stage: string) {
    const row = filtered.find((item) => item.id === dragging);
    setDragging(null);
    setOver(null);
    if (!row || row.stage === stage || stage === "withdrew") return;
    setPending({ row, stage });
  }

  const card = (row: ApplicationRow) => (
    <button
      type="button"
      className={`hr-candidate${dragging === row.id ? " is-dragging" : ""}`}
      draggable={view === "board"}
      onDragStart={(event) => { event.dataTransfer.setData("text/plain", row.id); event.dataTransfer.effectAllowed = "move"; setDragging(row.id); }}
      onDragEnd={() => { setDragging(null); setOver(null); }}
      onClick={() => setOpen(row.id)}
    >
      <span className="hr-initials" aria-hidden="true">{initials(row.name)}</span>
      <span><strong>{row.name}</strong><small>{[row.location, !jobId ? row.job_title : null].filter(Boolean).join(" · ")}</small></span>
      <small className={`hr-when${(row.days_in_stage || 0) >= 7 && OPEN_STAGES.includes(row.stage) ? " is-late" : ""}`}
        title={`${row.days_in_stage || 0} days in this stage`}>{row.days_in_stage ? `${row.days_in_stage}d` : "New"}</small>
    </button>
  );

  return (
    <div className="control-panel hr-applications">
      <div className="hr-applications-head">
        <h2>Applications</h2>
        <div className="hr-tools">
          <input type="search" aria-label="Search applications" placeholder="Name, country or language" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="hr-segment" role="radiogroup" aria-label="View">
            {(["board", "list"] as const).map((key) => (
              <label key={key} className={view === key ? "is-active" : ""}>
                <input type="radio" name="hr-view" checked={view === key} onChange={() => setView(key)} />{key === "board" ? "Board" : "List"}
              </label>
            ))}
          </div>
          <label className="hr-check"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Closed ({closedCount})</label>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!rows ? <p className="muted">Loading…</p> : rows.length === 0 ? (
        <p className="muted">No applications yet. They appear here as soon as someone applies on fayfort.com/careers.</p>
      ) : view === "board" ? (
        <div className="hr-board" style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(200px, 1fr))` }}>
          {groups.map((group) => (
            <section
              key={group.key}
              className={`hr-column${over === group.key ? " is-over" : ""}`}
              aria-label={group.label}
              onDragOver={(event) => { if (dragging) { event.preventDefault(); setOver(group.key); } }}
              onDragLeave={() => setOver((current) => (current === group.key ? null : current))}
              onDrop={(event) => { event.preventDefault(); drop(group.key); }}
            >
              <h3>{group.label} <span>{group.items.length}</span></h3>
              <ul>{group.items.map((row) => <li key={row.id}>{card(row)}</li>)}</ul>
              {group.items.length === 0 && <p className="hr-column-empty">{dragging ? "Drop here" : "Nobody here"}</p>}
            </section>
          ))}
        </div>
      ) : (
        groups.filter((group) => group.items.length).map((group) => (
          <section key={group.key} className="hr-stage" aria-label={group.label}>
            <h3>{group.label} <span>{group.items.length}</span></h3>
            <ul>{group.items.map((row) => <li key={row.id}>{card(row)}</li>)}</ul>
          </section>
        ))
      )}
      {pending && (
        <MoveDialog
          accessToken={accessToken}
          row={pending.row}
          stage={pending.stage}
          meta={meta}
          onClose={() => setPending(null)}
          onMoved={() => { setPending(null); void load(); }}
        />
      )}
      {open && <CandidatePanel accessToken={accessToken} applicationId={open} meta={meta} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </div>
  );
}

/** Asked after a card is dropped on another stage: email the candidate or not, and a reason when closing. */
function MoveDialog({ accessToken, row, stage, meta, onClose, onMoved }: {
  accessToken: string; row: ApplicationRow; stage: string; meta: ListMeta; onClose: () => void; onMoved: () => void;
}) {
  const emails = meta.emailed_stages.includes(stage);
  const [notify, setNotify] = useState(emails);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  async function move() {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/hr/applications/${row.id}/stage`, accessToken, { method: "POST", body: JSON.stringify({ stage, reason: reason || null, notify: emails && notify }) });
      onMoved();
    } catch (reason) {
      setError(message(reason, "The application could not be moved."));
      setBusy(false);
    }
  }
  const first = row.name.split(" ")[0];
  return (
    <>
      <div className="hr-scrim" onClick={onClose} aria-hidden="true" />
      <div className="hr-move-dialog" role="dialog" aria-modal="true" aria-labelledby="hr-move-title">
        <h2 id="hr-move-title">Move {first} to {STAGE_LABEL[stage]}?</h2>
        {stage === "not_moving_forward" && (
          <ReasonPicker reasons={meta.close_reasons} value={reason} onChange={setReason} />
        )}
        {emails && (
          <label className="hr-check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email {first} about this</label>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="hr-editor-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" disabled={busy || (stage === "not_moving_forward" && !reason.trim())} onClick={() => void move()}>{busy ? "Moving…" : "Move"}</button>
        </div>
      </div>
    </>
  );
}

function ReasonPicker({ reasons, value, onChange }: { reasons: string[]; value: string; onChange: (value: string) => void }) {
  const preset = reasons.includes(value) && value !== "Other" ? value : value ? "Other" : "";
  return (
    <div className="hr-reason">
      <label>Reason (stays inside FayFort)
        <select value={preset} onChange={(e) => onChange(e.target.value === "Other" ? " " : e.target.value)}>
          <option value="">Choose a reason</option>
          {reasons.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      {preset === "Other" && (
        <input aria-label="Other reason" maxLength={300} placeholder="Write the reason" value={value.trim() === "" ? "" : value} onChange={(e) => onChange(e.target.value || " ")} />
      )}
    </div>
  );
}

function CandidatePanel({ accessToken, applicationId, meta, onClose, onChanged }: { accessToken: string; applicationId: string; meta: ListMeta; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest<Detail>(`/hr/applications/${applicationId}`, accessToken)
      .then((result) => { setDetail(result); setStage(result.application.stage); })
      .catch((reason) => setError(message(reason, "The application could not be loaded.")));
  }, [accessToken, applicationId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(path: string, body: object) {
    setBusy(true);
    setError("");
    try {
      setDetail(await apiRequest<Detail>(path, accessToken, { method: "POST", body: JSON.stringify(body) }));
      onChanged();
      return true;
    } catch (reason) {
      setError(message(reason, "That didn't work."));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function openCv() {
    try {
      const { url } = await apiRequest<{ url: string }>(`/hr/applications/${applicationId}/cv`, accessToken);
      window.open(url, "_blank", "noopener");
    } catch (reason) {
      setError(message(reason, "The CV could not be opened."));
    }
  }

  const c = detail?.candidate;
  const closed = detail ? ["withdrew", "hired"].includes(detail.application.stage) : true;
  return (
    <>
      <div className="hr-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="hr-panel" role="dialog" aria-modal="true" aria-label={c?.full_name || "Candidate"}>
        <header>
          <div>
            <h2>{c?.full_name || "Candidate"}</h2>
            {detail && <p className="muted">{detail.job.title} · {STAGE_LABEL[detail.application.stage]} · applied {day(detail.application.created_at)}</p>}
          </div>
          <button type="button" className="secondary-button" onClick={onClose} aria-label="Close">Close</button>
        </header>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!detail ? <p className="muted">Loading…</p> : (
          <div className="hr-panel-body">
            {detail.other_applications.length > 0 && (
              <p className="hr-duplicate">This person has applied before ({detail.other_applications.length} other application{detail.other_applications.length > 1 ? "s" : ""}).</p>
            )}
            <dl className="hr-facts">
              {c?.email && <div><dt>Email</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd></div>}
              {c?.phone && <div><dt>Phone</dt><dd>{c.phone}</dd></div>}
              {c?.location && <div><dt>Location</dt><dd>{c.location}</dd></div>}
              {c?.languages && <div><dt>Languages</dt><dd>{c.languages}</dd></div>}
              {detail.application.heard_from && <div><dt>Heard from</dt><dd>{detail.application.heard_from}</dd></div>}
              {c?.retain_until && <div><dt>Kept until</dt><dd>{new Date(c.retain_until).toLocaleDateString()}</dd></div>}
            </dl>
            <div className="hr-links">
              {detail.application.has_cv && <button type="button" className="primary-button" onClick={() => void openCv()}>Open CV{detail.application.cv_name ? ` (${detail.application.cv_name})` : ""}</button>}
              {detail.application.portfolio_url && <a className="secondary-button" href={detail.application.portfolio_url} target="_blank" rel="noreferrer noopener">Portfolio or LinkedIn</a>}
            </div>
            {detail.application.answers.length > 0 && (
              <section><h3>Answers</h3>
                <dl className="hr-answers">{detail.application.answers.map((a) => <div key={a.label}><dt>{a.label}</dt><dd>{a.answer || "No answer"}</dd></div>)}</dl>
              </section>
            )}
            {!closed && (
              <section className="hr-move"><h3>Move to</h3>
                <select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}>
                  {STAGES.filter(([key]) => !["hired", "withdrew"].includes(key) && (key !== "trial_task" || detail.job.trial_task)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                {stage === "not_moving_forward" && <ReasonPicker reasons={meta.close_reasons} value={reason} onChange={setReason} />}
                {meta.emailed_stages.includes(stage) && stage !== detail.application.stage && (
                  <label className="hr-check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email {(c?.full_name || "the candidate").split(" ")[0]} about this</label>
                )}
                <button type="button" className="primary-button" disabled={busy || stage === detail.application.stage || (stage === "not_moving_forward" && !reason.trim())}
                  onClick={() => void run(`/hr/applications/${applicationId}/stage`, { stage, reason: reason.trim() || null, notify: meta.emailed_stages.includes(stage) && notify })}>Move</button>
              </section>
            )}
            {detail.application.close_reason && <p className="muted">Reason: {detail.application.close_reason}</p>}
            <section><h3>Notes and activity</h3>
              <form className="hr-note" onSubmit={async (e) => { e.preventDefault(); if (await run(`/hr/applications/${applicationId}/notes`, { text: note })) setNote(""); }}>
                <textarea aria-label="Add a note" rows={2} maxLength={2000} placeholder="Add a note for the hiring team" value={note} onChange={(e) => setNote(e.target.value)} />
                <button type="submit" className="secondary-button" disabled={busy || !note.trim()}>Add note</button>
              </form>
              <ol className="hr-activity">
                {[...detail.events].reverse().map((event) => (
                  <li key={event.id}>
                    <span>{event.kind === "note" ? event.detail.text
                      : event.kind === "stage_changed" ? `Moved from ${STAGE_LABEL[event.detail.from] || event.detail.from} to ${STAGE_LABEL[event.detail.to] || event.detail.to}`
                      : event.kind === "applied" ? "Applied" : event.kind === "email_sent" ? (event.detail.template === "hr_received" ? "Emailed the status link" : `Emailed: ${STAGE_LABEL[(event.detail.template || "").replace("hr_stage_", "")] || "update"}`)
                      : event.kind === "withdrawn" ? "Withdrew" : event.kind === "cv_viewed" ? "CV opened" : event.kind}</span>
                    <small>{new Date(event.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </aside>
    </>
  );
}

// ---- HR access (owner) ------------------------------------------------------------------------------------------------
type AccessRow = { user_id: string; name: string; status: string; staff_role: string; job_title: string | null; hr_access: boolean };

function HrAccessPanel({ accessToken }: { accessToken: string }) {
  const [workers, setWorkers] = useState<AccessRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    apiRequest<{ workers: AccessRow[] }>("/hr/access", accessToken).then((r) => setWorkers(r.workers)).catch((reason) => setError(message(reason, "The team could not be loaded.")));
  }, [accessToken]);
  async function toggle(worker: AccessRow) {
    try {
      const result = await apiRequest<{ workers: AccessRow[] }>(`/hr/access/${worker.user_id}`, accessToken, { method: "PUT", body: JSON.stringify({ hr_access: !worker.hr_access }) });
      setWorkers(result.workers);
      setError("");
    } catch (reason) {
      setError(message(reason, "HR access could not be changed."));
    }
  }
  return (
    <div className="control-panel hr-access">
      <div className="panel-heading">
        <h2>HR access</h2>
        <p className="muted">People with HR access run hiring: jobs, candidates, interviews and offers. The CEO always has it.</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!workers ? <p className="muted">Loading…</p> : (
        <ul>
          {workers.map((worker) => (
            <li key={worker.user_id}>
              <span><strong>{worker.name}</strong><small>{[worker.job_title, worker.staff_role === "ceo" ? "CEO" : worker.staff_role === "assistant" ? "Assistant" : null, worker.status === "invited" ? "Invited" : null].filter(Boolean).join(" · ")}</small></span>
              {worker.staff_role === "ceo" ? <span className="status-pill is-good">Always</span> : (
                <label className="hr-switch">
                  <input type="checkbox" role="switch" checked={worker.hr_access} onChange={() => void toggle(worker)} aria-label={`HR access for ${worker.name}`} />
                  <span aria-hidden="true" />
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
