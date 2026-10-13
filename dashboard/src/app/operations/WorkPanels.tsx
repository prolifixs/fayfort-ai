import { type Department, departments, departmentLabel, statuses, statusLabel } from "./types";
import type { OperationsState } from "./useOperationsCenter";

export function WorkActionForm({
  ops,
  selected,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
}) {
  const {
    action,
    setAction,
    nextAction,
    setNextAction,
    waitingOn,
    setWaitingOn,
    waitingReason,
    setWaitingReason,
    busy,
    saveStatus,
  } = ops;
  return (
    <form className="operations-action-form" onSubmit={saveStatus}>
      <label>
        Status
        <select aria-label="Work status" value={action} onChange={(event) => setAction(event.target.value)}>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Next action
        <input
          aria-label="Next action"
          maxLength={500}
          required
          value={nextAction}
          onChange={(event) => setNextAction(event.target.value)}
        />
      </label>
      {action === "waiting" && (
        <>
          <label>
            Waiting on
            <select aria-label="Waiting on" value={waitingOn} onChange={(event) => setWaitingOn(event.target.value)}>
              {["member", "supplier", "payment", "carrier", "automation", "internal"].map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Waiting reason
            <input
              aria-label="Waiting reason"
              minLength={3}
              maxLength={1000}
              required
              value={waitingReason}
              onChange={(event) => setWaitingReason(event.target.value)}
            />
          </label>
        </>
      )}
      <button className="primary-button" disabled={busy || !nextAction.trim()}>
        {busy ? "Saving…" : "Save work update"}
      </button>
    </form>
  );
}

export function TransferForm({
  ops,
  selected,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
}) {
  const {
    departmentsForUser,
    canManage,
    transferDepartment,
    setTransferDepartment,
    transferReason,
    setTransferReason,
    busy,
    transfer,
  } = ops;
  return (
    <form className="operations-transfer-form" onSubmit={transfer}>
      <h3>Transfer department</h3>
      <div>
        <label>
          Send to
          <select
            aria-label="Transfer department"
            value={transferDepartment}
            onChange={(event) => setTransferDepartment(event.target.value as Department)}
          >
            {(canManage ? departments : departmentsForUser)
              .filter(
                (department) =>
                  department !== selected.department &&
                  !(selected.department === "fulfillment" && department === "sourcing"),
              )
              .map((department) => (
                <option key={department} value={department}>
                  {departmentLabel[department]}
                </option>
              ))}
          </select>
        </label>
        <label>
          Transfer reason
          <input
            aria-label="Transfer reason"
            minLength={3}
            maxLength={1000}
            required
            value={transferReason}
            onChange={(event) => setTransferReason(event.target.value)}
          />
        </label>
      </div>
      <button className="secondary-button" disabled={busy || !transferReason.trim()}>
        Transfer and release current owner
      </button>
    </form>
  );
}

export function WorkHistory({
  ops,
  selected,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
}) {
  const { workEvents } = ops;
  return (
    <section className="operations-detail-section">
      <h3>Work history</h3>
      {workEvents.length === 0 ? (
        <p className="operations-muted">No work events recorded yet.</p>
      ) : (
        <ol className="operations-work-history">
          {workEvents.map((event) => (
            <li key={event.id}>
              <strong>{statusLabel(event.event_type.replaceAll("_", " "))}</strong>
              <span>
                {event.previous_status && event.next_status
                  ? `${statusLabel(event.previous_status)} → ${statusLabel(event.next_status)}`
                  : event.next_department &&
                      event.previous_department &&
                      event.next_department !== event.previous_department
                    ? `${departmentLabel[event.previous_department as Department] || event.previous_department} → ${departmentLabel[event.next_department as Department] || event.next_department}`
                    : `By ${statusLabel(event.actor_type)}`}
              </span>
              {event.reason && <p>{event.reason}</p>}
              <small>{new Date(event.created_at).toLocaleString()}</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ChecklistPanel({
  ops,
  selected,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
}) {
  const { checklist, checkTitle, setCheckTitle, busy, addChecklist, toggleChecklist } = ops;
  return (
    <section className="operations-detail-section">
      <div className="operations-section-title">
        <h3>Checklist</h3>
        <span>
          {checklist.filter((item) => item.completed_at).length}/{checklist.length} done
        </span>
      </div>
      <form className="operations-inline-add" onSubmit={addChecklist}>
        <input
          aria-label="New checklist item"
          maxLength={240}
          required
          value={checkTitle}
          onChange={(event) => setCheckTitle(event.target.value)}
          placeholder="Add a task"
        />
        <button type="submit" disabled={busy || !checkTitle.trim()}>
          Add
        </button>
      </form>
      {checklist.length === 0 ? (
        <p className="operations-muted">No checklist items yet.</p>
      ) : (
        <ul className="operations-checklist">
          {checklist.map((item) => (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(item.completed_at)}
                  onChange={() => void toggleChecklist(item)}
                  disabled={busy}
                />
                <span className={item.completed_at ? "is-done" : ""}>{item.title}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function NotesPanel({
  ops,
  selected,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
}) {
  const { notes, mentionOptionsError, note, setNote, busy, addNote, mentionMatch, mentionSuggestions, insertMention } =
    ops;
  return (
    <section className="operations-detail-section">
      <h3>Internal notes</h3>
      <form className="operations-note-form" onSubmit={addNote}>
        <div className="operations-note-composer">
          <textarea
            aria-label="Internal note"
            maxLength={4000}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Staff-only context for the next person… Type @ to mention a coworker."
          />
          {mentionMatch && (
            <div
              className="operations-mention-suggestions"
              role={mentionSuggestions.length ? "listbox" : "status"}
              aria-label="Active coworker mentions"
            >
              {mentionSuggestions.length ? (
                mentionSuggestions.map((worker) => (
                  <button
                    key={worker.user_id}
                    type="button"
                    role="option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertMention(worker)}
                  >
                    <strong>{worker.label}</strong>
                    <small>@{worker.email}</small>
                  </button>
                ))
              ) : (
                <p>
                  {mentionOptionsError
                    ? `Coworker suggestions unavailable: ${mentionOptionsError}`
                    : "No other active coworker with access to this work item is available to mention."}
                </p>
              )}
            </div>
          )}
        </div>
        <small>
          Use @email to notify an active FayFort coworker with access to this item. Mentions in private staff notes
          only.
        </small>
        <button className="secondary-button" disabled={busy || !note.trim()}>
          Add internal note
        </button>
      </form>
      {notes.length === 0 ? (
        <p className="operations-muted">No internal notes yet. Notes are staff-only.</p>
      ) : (
        <ol className="operations-notes">
          {notes.map((item) => (
            <li key={item.id}>
              <p>{item.note}</p>
              <small>{new Date(item.created_at).toLocaleString()} · Staff note</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
