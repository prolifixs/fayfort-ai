import { FormEvent, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../lib/api";
import { departmentLabel, departments, type Department } from "../operations/types";

/**
 * Control Center → FayFort Workers → Add staff (docs/BOOKINGS_AND_EXECUTIVE_PLAN.md §8).
 * Existing account: search, pick, choose role and departments, send the invitation link.
 * New person: an email that has no account yet gets the usual invitation (an existing email is switched to the
 * existing-account invitation by the API).
 */
export type StaffRole = "staff" | "assistant" | "ceo";
export const ROLE_LABEL: Record<StaffRole, string> = {
  staff: "Staff",
  assistant: "Personal assistant to the CEO",
  ceo: "CEO",
};
export const ROLE_HELP: Record<StaffRole, string> = {
  staff: "Works in the departments you pick.",
  assistant: "Manages the CEO's calendar and bookings, plus any departments you pick.",
  ceo: "Sees a clean Today page with her schedule and what's happening. Only one CEO.",
};

type Candidate = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  username: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  eligible: boolean;
  reason: string | null;
};

type Mode = "existing" | "new";

export function RolePicker({
  value,
  onChange,
  idPrefix,
}: {
  value: StaffRole;
  onChange: (role: StaffRole) => void;
  idPrefix: string;
}) {
  return (
    <fieldset className="staff-role-picker">
      <legend>Role</legend>
      {(Object.keys(ROLE_LABEL) as StaffRole[]).map((role) => (
        <label key={role} htmlFor={`${idPrefix}-${role}`} className={value === role ? "is-selected" : ""}>
          <input
            id={`${idPrefix}-${role}`}
            type="radio"
            name={`${idPrefix}-role`}
            value={role}
            checked={value === role}
            onChange={() => onChange(role)}
          />
          <span>
            <strong>{ROLE_LABEL[role]}</strong>
            <small>{ROLE_HELP[role]}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function DepartmentPicker({ value, onChange }: { value: Department[]; onChange: (next: Department[]) => void }) {
  return (
    <fieldset className="staff-department-picker">
      <legend>Departments (what they can work on in Operations)</legend>
      <div>
        {departments.map((department) => (
          <label key={department}>
            <input
              type="checkbox"
              checked={value.includes(department)}
              onChange={(event) =>
                onChange(event.target.checked ? [...value, department] : value.filter((item) => item !== department))
              }
            />{" "}
            {departmentLabel[department]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AddStaffPanel({ accessToken, onInvited }: { accessToken: string; onInvited?: () => void }) {
  const [mode, setMode] = useState<Mode>("existing");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState<Department[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const searchId = useRef(0);

  useEffect(() => {
    const needle = query.trim();
    if (mode !== "existing" || needle.length < 3) {
      setResults(null);
      return;
    }
    const id = ++searchId.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const found = await apiRequest<{ accounts: Candidate[] }>(
          `/platform/staff/candidates?q=${encodeURIComponent(needle)}`,
          accessToken,
        );
        if (id === searchId.current) {
          setResults(found.accounts || []);
          setError("");
        }
      } catch (reason) {
        if (id === searchId.current) setError(reason instanceof Error ? reason.message : "Accounts could not be searched.");
      } finally {
        if (id === searchId.current) setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, mode, accessToken]);

  function reset() {
    setPicked(null);
    setEmail("");
    setQuery("");
    setResults(null);
    setRole("staff");
    setTitle("");
    setChosen([]);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setDone("");
    try {
      const target = mode === "existing" ? { user_id: picked?.user_id } : { email: email.trim() };
      const result = await apiRequest<{ invitation: { email: string; kind: string } }>(
        "/platform/staff/invitations",
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({ ...target, staff_role: role, job_title: title.trim() || null, departments: chosen }),
        },
      );
      const who = result.invitation.email;
      setDone(
        result.invitation.kind === "existing_account"
          ? `Invitation sent to ${who}. They open the link, sign in with their usual account and press Accept. The link works for 7 days.`
          : `Invitation sent to ${who}. They set a password from the email, then they're on the team.`,
      );
      reset();
      onInvited?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The invitation could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  const ready = mode === "existing" ? Boolean(picked) : email.includes("@");

  return (
    <section className="control-panel add-staff" aria-labelledby="add-staff-title">
      <div className="panel-heading">
        <div>
          <h2 id="add-staff-title">Add staff</h2>
          <p>Make someone who already has a FayFort account staff, or invite a new person by email.</p>
        </div>
      </div>
      <div className="team-tabs" role="tablist" aria-label="Who to add">
        {(
          [
            ["existing", "Existing account"],
            ["new", "New person"],
          ] as [Mode, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            className={mode === key ? "is-active" : ""}
            onClick={() => {
              setMode(key);
              setError("");
              setDone("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form onSubmit={(event) => void send(event)} className="add-staff-form">
        {mode === "existing" ? (
          picked ? (
            <div className="add-staff-picked">
              <span>
                <strong>{picked.display_name || picked.username || picked.email}</strong>
                <small>{picked.email}</small>
              </span>
              <button type="button" className="text-button" onClick={() => setPicked(null)}>
                Change
              </button>
            </div>
          ) : (
            <div className="add-staff-search">
              <label htmlFor="add-staff-query">Find an account</label>
              <input
                id="add-staff-query"
                type="search"
                autoComplete="off"
                placeholder="Email, name or username (3+ letters)"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {searching && <small role="status">Searching…</small>}
              {results && results.length === 0 && !searching && <p className="empty-copy">No accounts match.</p>}
              {results && results.length > 0 && (
                <ul className="add-staff-results" aria-label="Matching accounts">
                  {results.map((account) => (
                    <li key={account.user_id}>
                      <button
                        type="button"
                        disabled={!account.eligible}
                        onClick={() => setPicked(account)}
                        aria-label={`Choose ${account.email}`}
                      >
                        <span>
                          <strong>{account.display_name || account.username || account.email}</strong>
                          <small>
                            {account.email}
                            {account.username ? ` · @${account.username}` : ""}
                          </small>
                        </span>
                        <em>{account.eligible ? "Choose" : account.reason}</em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        ) : (
          <label htmlFor="add-staff-email" className="add-staff-field">
            Email
            <input
              id="add-staff-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        )}

        {(mode === "new" || picked) && (
          <>
            <RolePicker value={role} onChange={setRole} idPrefix="add-staff" />
            <label htmlFor="add-staff-title-input" className="add-staff-field">
              Job title (optional)
              <input
                id="add-staff-title-input"
                maxLength={80}
                placeholder={role === "ceo" ? "Founder & CEO" : role === "assistant" ? "Personal assistant" : "Sourcing agent"}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <DepartmentPicker value={chosen} onChange={setChosen} />
            <button className="primary-button" disabled={busy || !ready}>
              {busy ? "Sending…" : "Send invitation"}
            </button>
          </>
        )}
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {done && <p role="status">{done}</p>}
    </section>
  );
}

/** Role and job title on a worker's profile. */
export function RoleEditor({
  accessToken,
  workerId,
  role,
  jobTitle,
  onSaved,
}: {
  accessToken: string;
  workerId: string;
  role: StaffRole;
  jobTitle: string | null;
  onSaved: (role: StaffRole, title: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<StaffRole>(role);
  const [title, setTitle] = useState(jobTitle || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setNext(role);
    setTitle(jobTitle || "");
  }, [role, jobTitle]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ worker: { staff_role: StaffRole; job_title: string | null } }>(
        `/platform/workers/${workerId}/role`,
        accessToken,
        { method: "PUT", body: JSON.stringify({ staff_role: next, job_title: title.trim() || null }) },
      );
      onSaved(result.worker.staff_role, result.worker.job_title);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The role could not be changed.");
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
        Change role
      </button>
    );
  return (
    <form className="worker-confirm role-editor" onSubmit={(event) => void save(event)} aria-label="Change role">
      <RolePicker value={next} onChange={setNext} idPrefix={`role-${workerId}`} />
      <label htmlFor={`role-title-${workerId}`}>Job title (optional)</label>
      <input id={`role-title-${workerId}`} maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button className="primary-button" disabled={busy}>
          {busy ? "Saving…" : "Save role"}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
