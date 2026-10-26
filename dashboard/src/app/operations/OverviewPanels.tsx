import { useEffect } from "react";
import { departments, departmentLabel, statuses, statusLabel } from "./types";
import type { OperationsState } from "./useOperationsCenter";
import { GUIDES, guideKeyFor, queueStepLabel } from "./playbooks";
import { useNow, workClock } from "./clock";

export function WorkforcePanel({ ops }: { ops: OperationsState }) {
  const {
    workforce,
    workforceError,
    automationHealth,
    automationHealthError,
    departmentDrafts,
    busy,
    run,
    toggleDepartment,
    saveWorkerDepartments,
  } = ops;
  return (
    <section className="operations-workforce" aria-label="Workforce overview">
      <div className="operations-section-title">
        <div>
          <small>LIVE STAFF AND AUTOMATION OVERVIEW</small>
          <h2>Workforce</h2>
        </div>
        <span>Online = activity in last 90 seconds</span>
      </div>
      {workforceError ? (
        <p className="operations-muted">
          Workforce roster is waiting on its private presence-table migration. The queue below is available.{" "}
          <small>{workforceError}</small>
        </p>
      ) : !workforce ? (
        <p className="operations-muted">Loading workforce status…</p>
      ) : (
        <>
          <div className="operations-workforce-metrics">
            <div>
              <strong>
                {workforce.summary.online_workers}/{workforce.summary.active_workers}
              </strong>
              <small>Workers online</small>
            </div>
            <div>
              <strong>{workforce.summary.active_work_items}</strong>
              <small>Open work items</small>
            </div>
            <div>
              <strong>{workforce.summary.automation_owned_work_items}</strong>
              <small>Automation-owned</small>
            </div>
          </div>
          <div className="operations-workforce-grid">
            {workforce.workers.map((worker) => (
              <article key={worker.user_id} className="operations-worker-card">
                <div className="operations-worker-title">
                  <strong>{worker.user_id.slice(0, 8)}</strong>
                  <span className={worker.online ? "operations-presence is-online" : "operations-presence"}>
                    {worker.online ? "Online" : "Offline"}
                  </span>
                </div>
                <small>
                  {worker.status} · Shift {statusLabel(worker.handoff_availability)} · Capacity{" "}
                  {worker.handoff_max_active}
                </small>
                <div>
                  <strong>{worker.active_work_count} active assignments</strong>
                  {worker.current_work.map((work) => (
                    <p key={work.id}>
                      {work.summary} <span>({statusLabel(work.status)})</span>
                    </p>
                  ))}
                </div>
                <fieldset className="operations-worker-departments" disabled={busy || worker.status !== "active"}>
                  <legend>Department access</legend>
                  {departments.map((department) => (
                    <label key={department}>
                      <input
                        type="checkbox"
                        checked={(departmentDrafts[worker.user_id] || []).includes(department)}
                        onChange={(event) => toggleDepartment(worker.user_id, department, event.target.checked)}
                      />
                      {departmentLabel[department]}
                    </label>
                  ))}
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || worker.status !== "active"}
                    onClick={() => void saveWorkerDepartments(worker)}
                  >
                    Save access
                  </button>
                  <small>Workers can view and claim work in enabled departments. Changes are audited.</small>
                </fieldset>
              </article>
            ))}
          </div>
          {workforce.summary.automation_work.length > 0 && (
            <div className="operations-automation-summary">
              <h3>Automation-owned work</h3>
              {workforce.summary.automation_work.map((work) => (
                <p key={work.id}>
                  <strong>{work.assigned_automation_key}</strong> · {work.summary} · {statusLabel(work.status)}
                </p>
              ))}
            </div>
          )}
          <section className="operations-automation-health" aria-label="Automation run health">
            <div className="operations-section-title">
              <h3>Automation run health</h3>
              <small>Read-only · latest 50 recorded runs</small>
            </div>
            {automationHealthError ? (
              <p className="operations-muted">{automationHealthError}</p>
            ) : !automationHealth ? (
              <p className="operations-muted">Loading automation health…</p>
            ) : (
              <>
                <div className="operations-workforce-metrics">
                  <div>
                    <strong>{automationHealth.summary.enabled_schedules}</strong>
                    <small>Enabled schedules</small>
                  </div>
                  <div>
                    <strong>{automationHealth.summary.failed_runs}</strong>
                    <small>Failed in latest 50 runs</small>
                  </div>
                  <div>
                    <strong>{automationHealth.summary.schedule_issues}</strong>
                    <small>Schedules with retry/error state</small>
                  </div>
                </div>
                {automationHealth.schedule_issues.length > 0 && (
                  <div>
                    <h4>Schedule issues</h4>
                    {automationHealth.schedule_issues.map((item) => (
                      <p key={item.id}>
                        <strong>{item.name}</strong> · Business {item.business_ref} · {item.attempts} retries
                        {item.last_error_code ? ` · ${item.last_error_code}` : ""}
                        {item.next_run_at ? ` · Next ${new Date(item.next_run_at).toLocaleString()}` : " · No next run"}
                      </p>
                    ))}
                  </div>
                )}
                <h4>Recent runs</h4>
                {automationHealth.recent_runs.length === 0 ? (
                  <p className="operations-muted">No recorded automation runs.</p>
                ) : (
                  <ul>
                    {automationHealth.recent_runs.map((run) => (
                      <li key={run.id}>
                        <strong>{run.automation_name}</strong> · Business {run.business_ref} · {statusLabel(run.status)}{" "}
                        · {new Date(run.created_at).toLocaleString()}
                        {run.error_code ? ` · ${run.error_code}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </>
      )}
    </section>
  );
}

export function ReportsPanel({ ops }: { ops: OperationsState }) {
  const { report, reportDays, setReportDays, reportError, reportLoading, setReportReload } = ops;
  return (
    <section className="operations-reports" aria-label="Operations reports and reconciliation">
      <div className="operations-section-title">
        <div>
          <small>READ-ONLY OPERATIONS SNAPSHOT</small>
          <h2>Reports &amp; reconciliation</h2>
        </div>
        <div className="operations-report-controls">
          <label>
            Period
            <select
              aria-label="Report period"
              value={reportDays}
              onChange={(event) => setReportDays(Number(event.target.value) as 7 | 30 | 90)}
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setReportReload((value) => value + 1)}
            disabled={reportLoading}
          >
            {reportLoading ? "Refreshing…" : "Refresh report"}
          </button>
        </div>
      </div>
      {reportError ? (
        <p className="form-error" role="alert">
          {reportError}
        </p>
      ) : !report ? (
        <p className="operations-muted" role="status">
          {reportLoading ? "Loading operational reports…" : "No report data yet."}
        </p>
      ) : (
        <>
          <div className="operations-report-metrics">
            <article>
              <strong>{report.work.active}</strong>
              <span>Active work</span>
            </article>
            <article>
              <strong>{report.work.due_overdue}</strong>
              <span>Due or overdue</span>
            </article>
            <article>
              <strong>{report.disputes.active}</strong>
              <span>Active disputes</span>
            </article>
            <article>
              <strong>{report.automation.failed_in_period}</strong>
              <span>Failed runs · {report.period_days}d</span>
            </article>
          </div>
          <div className="operations-report-grid">
            <section>
              <h3>Work by department</h3>
              <ul>
                {departments.map((department) => {
                  const counts = report.work.by_department[department] || {};
                  return (
                    <li key={department}>
                      <strong>{departmentLabel[department]}</strong>
                      <span>
                        {Object.entries(counts)
                          .map(([status, count]) => `${statusLabel(status)} ${count}`)
                          .join(" · ") || "No work"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <h3>Active work age</h3>
              <ul>
                {Object.entries(report.work.aging).map(([bucket, count]) => (
                  <li key={bucket}>
                    <span>{statusLabel(bucket.replaceAll("_", " "))}</span>
                    <strong>{count}</strong>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3>Sourcing outcomes</h3>
              <ul>
                {Object.entries(report.sourcing.requests_by_latest_stage).map(([stage, count]) => (
                  <li key={stage}>
                    <span>{statusLabel(stage)}</span>
                    <strong>{count}</strong>
                  </li>
                ))}
                <li>
                  <span>Candidates added · {report.period_days}d</span>
                  <strong>{report.sourcing.candidates_added}</strong>
                </li>
                <li>
                  <span>Options shared / selected · {report.period_days}d</span>
                  <strong>
                    {report.sourcing.member_options_shared} / {report.sourcing.member_options_selected}
                  </strong>
                </li>
              </ul>
              <h3>Disputes &amp; automation</h3>
              <ul>
                {Object.entries(report.disputes.by_status).map(([status, count]) => (
                  <li key={status}>
                    <span>Disputes · {statusLabel(status)}</span>
                    <strong>{count}</strong>
                  </li>
                ))}
                <li>
                  <span>Automation runs · {report.period_days}d</span>
                  <strong>{report.automation.runs_in_period}</strong>
                </li>
                <li>
                  <span>Schedules with issues</span>
                  <strong>{report.automation.schedules_with_issues}</strong>
                </li>
              </ul>
            </section>
          </div>
          <div className="operations-reconciliation">
            <h3>Consistency checks</h3>
            <p>
              Read-only checks only. Findings are listed for staff review; this panel never changes queue or request
              data.
            </p>
            <ul>
              {[
                ["Actionable requests without work", report.reconciliation.actionable_requests_missing_work],
                [
                  "Delivered/cancelled requests with active work",
                  report.reconciliation.terminal_requests_with_active_work,
                ],
                ["Active disputes without work", report.reconciliation.active_disputes_missing_work],
                ["Expired claim leases", report.reconciliation.expired_claims],
              ].map(([label, count]) => (
                <li key={String(label)}>
                  <span>{label}</span>
                  <strong className={count ? "has-findings" : "is-clear"}>
                    {count ? `${count} · review` : "0 · clear"}
                  </strong>
                </li>
              ))}
            </ul>
            {report.data_limit_reached && (
              <small role="status">Report reached its {"20,000"} record cap. Treat totals as a lower bound.</small>
            )}
            <small>
              Generated {new Date(report.generated_at).toLocaleString()} · {report.work.total} work items scanned
            </small>
          </div>
        </>
      )}
    </section>
  );
}

export function AutomationActivity({ ops }: { ops: OperationsState }) {
  const { automationHealth, automationHealthError, automationDialogOpen, setAutomationDialogOpen, run } = ops;
  return (
    <div className="operations-automation-launcher">
      <button
        type="button"
        className="operations-automation-icon"
        aria-label="Open automation activity"
        aria-haspopup="dialog"
        aria-expanded={automationDialogOpen}
        aria-controls="operations-automation-dialog"
        onClick={() => setAutomationDialogOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v2m-6 7H4m16 0h-2M7 8l-1.4-1.4M17 8l1.4-1.4M7 19h10a2 2 0 0 0 2-2v-4a7 7 0 0 0-14 0v4a2 2 0 0 0 2 2Zm1-7h.01M16 12h.01M9 16h6" />
        </svg>
        <span>Automation</span>
        {automationHealth?.summary.schedule_issues || automationHealth?.summary.failed_runs ? (
          <b aria-label="Automation issues">!</b>
        ) : null}
      </button>
      {automationDialogOpen && (
        <div
          className="operations-automation-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAutomationDialogOpen(false);
          }}
        >
          <section
            id="operations-automation-dialog"
            className="operations-automation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="operations-automation-title"
          >
            <header>
              <div>
                <small>READ-ONLY · LATEST 50 RUNS</small>
                <h2 id="operations-automation-title">Automation activity</h2>
              </div>
              <button
                type="button"
                className="operations-automation-close"
                aria-label="Close automation activity"
                autoFocus
                onClick={() => setAutomationDialogOpen(false)}
              >
                ×
              </button>
            </header>
            {automationHealthError ? (
              <p role="alert" className="operations-muted">
                {automationHealthError}
              </p>
            ) : !automationHealth ? (
              <p role="status" className="operations-muted">
                Loading automation health…
              </p>
            ) : (
              <>
                <div className="operations-workforce-metrics">
                  <div>
                    <strong>{automationHealth.summary.enabled_schedules}</strong>
                    <small>Enabled schedules</small>
                  </div>
                  <div>
                    <strong>{automationHealth.summary.failed_runs}</strong>
                    <small>Failed runs</small>
                  </div>
                  <div>
                    <strong>{automationHealth.summary.schedule_issues}</strong>
                    <small>Schedule issues</small>
                  </div>
                </div>
                {automationHealth.schedule_issues.length > 0 && (
                  <section>
                    <h3>Schedule issues</h3>
                    <ul>
                      {automationHealth.schedule_issues.map((item) => (
                        <li key={item.id}>
                          <strong>{item.name}</strong>
                          <span>
                            Business {item.business_ref} · {item.attempts} retries
                            {item.last_error_code ? ` · ${item.last_error_code}` : ""}
                          </span>
                          <small>
                            {item.next_run_at
                              ? `Next run ${new Date(item.next_run_at).toLocaleString()}`
                              : "No next run scheduled"}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <section>
                  <h3>Recent runs</h3>
                  {automationHealth.recent_runs.length === 0 ? (
                    <p className="operations-muted">No recorded automation runs.</p>
                  ) : (
                    <ul>
                      {automationHealth.recent_runs.map((run) => (
                        <li key={run.id}>
                          <strong>
                            {run.automation_name} · {statusLabel(run.status)}
                          </strong>
                          <span>
                            Business {run.business_ref} · {new Date(run.created_at).toLocaleString()}
                          </span>
                          {run.error_code && <small>Error: {run.error_code}</small>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export function QueueFilters({ ops }: { ops: OperationsState }) {
  const {
    canManage,
    scope,
    setScope,
    filterDepartment,
    setFilterDepartment,
    filterStatus,
    setFilterStatus,
    visibleDepartments,
    sourcingBatches,
  } = ops;
  const scopes: [typeof scope, string][] = [
    ["mine", "My work"],
    ["available", "Available"],
    ...(canManage ? ([["all", "All work"]] as [typeof scope, string][]) : []),
  ];
  return (
    <nav className="ops-toolbar" aria-label="Operations queue filters">
      <div className="ops-segmented" role="group" aria-label="Queue scope">
        {scopes.map(([value, label]) => (
          <button key={value} type="button" className="ops-seg" aria-pressed={scope === value} onClick={() => setScope(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className="ops-toolbar-filters">
        <label className="ops-select">
          <span>Department</span>
          <select aria-label="Filter department" value={filterDepartment} onChange={(event) => setFilterDepartment(event.target.value)}>
            <option value="">All</option>
            {visibleDepartments.map((department) => (
              <option key={department} value={department}>
                {departmentLabel[department]}
              </option>
            ))}
          </select>
        </label>
        <label className="ops-select">
          <span>Status</span>
          <select aria-label="Filter status" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
            <option value="">All</option>
            {statuses
              .filter((status) => status !== "completed" && status !== "cancelled")
              .map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
          </select>
        </label>
        {sourcingBatches.length > 0 && (
          <details className="ops-batches">
            <summary>Sourcing batches · {sourcingBatches.length}</summary>
            <ul>
              {sourcingBatches.slice(0, 8).map((batch) => (
                <li key={batch.id}>
                  <strong>{batch.title}</strong>
                  <small>
                    {batch.items.length} requests · {statusLabel(batch.status)}
                  </small>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </nav>
  );
}

/** Appears once requests are ticked: name the batch and create it. A batch is several members asking for the same
 * item: research once, share the same options with all of them; each request keeps its own member, chat and invoice. */
export function SourcingBatchForm({ ops }: { ops: OperationsState }) {
  const { batchTitle, setBatchTitle, batchWorkIds, setBatchWorkIds, busy, createSourcingBatch } = ops;
  return (
    <form className="ops-batch-bar" onSubmit={createSourcingBatch} aria-label="Group sourcing requests">
      <strong>
        {batchWorkIds.length} request{batchWorkIds.length === 1 ? "" : "s"} for the same item
      </strong>
      <small className="ops-batch-help">
        A batch lets you research once and share the same options with every member in it. Each request keeps its own
        member, chat and invoice.
      </small>
      <label className="ops-select">
        <span>Batch name</span>
        <input
          required
          maxLength={120}
          value={batchTitle}
          onChange={(event) => setBatchTitle(event.target.value)}
          placeholder="For example: October outerwear"
        />
      </label>
      <button className="primary-button" disabled={busy || batchWorkIds.length === 0}>
        Make a batch
      </button>
      <button type="button" className="ops-link-button" onClick={() => setBatchWorkIds([])}>
        Clear selection
      </button>
    </form>
  );
}

export function WorkList({ ops }: { ops: OperationsState }) {
  const {
    canManage,
    userId,
    scope,
    items,
    selected,
    setSelected,
    recentId,
    sourcingBatches,
    batchWorkIds,
    setBatchWorkIds,
    busy,
    claim,
    listView,
  } = ops;
  const archive = listView === "archive";
  const now = useNow();
  // Back on the list (phones and tablets), bring the card you were just on into view.
  useEffect(() => {
    if (selected || !recentId || window.innerWidth >= 1024) return;
    document.querySelector(`[data-work-id="${recentId}"]`)?.scrollIntoView?.({ block: "center" });
  }, [selected, recentId]);
  // Live work: the closest deadline first, so overdue and nearly-due work sits at the top of each department.
  const dueTime = (item: (typeof items)[number]) => (item.due_at ? new Date(item.due_at).getTime() : Number.MAX_SAFE_INTEGER);
  const groups = departments
    .map((department) => {
      const rows = items.filter((item) => item.department === department);
      return { department, rows: archive ? rows : [...rows].sort((a, b) => dueTime(a) - dueTime(b)) };
    })
    .filter((group) => group.rows.length > 0);
  const heading = archive
    ? "Finished work"
    : scope === "mine"
      ? "My work"
      : scope === "available"
        ? "Available work"
        : "All operations work";
  return (
    <section className="operations-work-list" aria-label="Operations work items">
      <div className="operations-section-title">
        <h2>{heading}</h2>
        <span>{items.length} shown</span>
      </div>
      {items.length === 0 ? (
        <p className="operations-empty-copy">
          {archive
            ? "Nothing finished matches this search."
            : scope === "mine"
              ? "You have nothing claimed. Look in Available to pick up work."
              : "Nothing waiting here. New requests, chats, shop orders and group buys appear automatically."}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.department} className="ops-queue-group" aria-label={`${departmentLabel[group.department]} work`}>
            <h3 className="ops-queue-group-title">
              {departmentLabel[group.department]} <span>{group.rows.length}</span>
            </h3>
            {group.rows.map((item) => {
              const inBatch = sourcingBatches.some((batch) => batch.items.some((member) => member.work_item_id === item.id));
              const guide = GUIDES[guideKeyFor(item)];
              const clock = archive ? null : workClock(item, now);
              const timed = clock && clock.state !== "none";
              const isOpen = selected?.id === item.id;
              const isRecent = !selected && recentId === item.id;
              return (
                <article
                  className={`operations-work-card priority-${item.priority}${isOpen ? " is-selected" : ""}${isRecent ? " is-recent" : ""}${
                    timed ? ` has-clock clock-${clock.tone}` : ""
                  }`}
                  style={timed ? ({ "--clock-hue": String(clock.hue) } as import("react").CSSProperties) : undefined}
                  key={item.id}
                  data-work-id={item.id}
                  aria-current={isOpen ? "true" : undefined}
                >
                  {(isOpen || isRecent) && (
                    <span className="ops-viewing-chip">{isOpen ? "Viewing" : "Last opened"}</span>
                  )}
                  {!archive && item.department === "sourcing" && item.work_type === "member_request" && (
                    <label className="operations-batch-select">
                      <input
                        type="checkbox"
                        aria-label={`Source ${item.summary} together with others`}
                        checked={batchWorkIds.includes(item.id)}
                        onChange={(event) =>
                          setBatchWorkIds((current) =>
                            event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id),
                          )
                        }
                        disabled={inBatch}
                      />
                      <span>{inBatch ? "In a batch" : "Same item as others? Tick to batch"}</span>
                    </label>
                  )}
                  <button type="button" className="operations-work-select" onClick={() => setSelected(item)}>
                    <span className="operations-work-card-top">
                      <strong>{item.summary}</strong>
                      <span className={`operations-status status-${item.status}`}>{statusLabel(item.status)}</span>
                    </span>
                    <small className="ops-card-kind">
                      {guide?.title || item.work_type.replaceAll("_", " ")}
                      {item.priority === "urgent" || item.priority === "high" ? ` · ${item.priority} priority` : ""}
                    </small>
                    <span className="ops-card-step">{queueStepLabel(item, userId, canManage)}</span>
                    {timed ? (
                      <span className="ops-clock" title={`Due ${clock.dueLabel}`}>
                        <span className="ops-clock-bar" aria-hidden="true">
                          <span style={{ width: `${Math.round(clock.progress * 100)}%` }} />
                        </span>
                        <span className="ops-clock-text">
                          <strong>{clock.label}</strong>
                          <small>
                            {clock.state === "overdue" ? "was due" : "due"} {clock.dueLabel}
                          </small>
                        </span>
                      </span>
                    ) : (
                      <small>
                        {archive && item.completed_at
                          ? `Finished ${new Date(item.completed_at).toLocaleString()}`
                          : `Created ${new Date(item.created_at).toLocaleString()}`}
                      </small>
                    )}
                  </button>
                  {!archive &&
                    (scope === "available" || canManage) &&
                    (item.status === "open" || (item.status === "claimed" && item.assigned_worker_id !== userId)) && (
                      <button
                        type="button"
                        className="primary-button operations-claim"
                        disabled={busy}
                        onClick={() => void claim(item)}
                      >
                        {item.assigned_worker_id && item.assigned_worker_id !== userId ? "Take over expired claim" : item.assigned_worker_id === userId ? "Renew claim" : "Claim"}
                      </button>
                    )}
                </article>
              );
            })}
          </section>
        ))
      )}
    </section>
  );
}
