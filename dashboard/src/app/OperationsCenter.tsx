import { OperationsNotifications } from "./OperationsNotifications";
import { departmentLabel, statusLabel } from "./operations/types";
import { useOperationsCenter } from "./operations/useOperationsCenter";
import {
  WorkforcePanel,
  ReportsPanel,
  AutomationActivity,
  QueueFilters,
  SourcingBatchForm,
  WorkList,
} from "./operations/OverviewPanels";
import {
  RequestContextPanel,
  DisputeCreateForm,
  DisputeCasePanel,
  FulfillmentPanel,
  SourcingCandidatesPanel,
  ShareOptionsForm,
} from "./operations/RequestPanels";
import { MemberConversationPanel, HandoffPanel, BusinessConversationPanel } from "./operations/ConversationPanels";
import { WorkActionForm, TransferForm, WorkHistory, ChecklistPanel, NotesPanel } from "./operations/WorkPanels";

export function OperationsCenterPage() {
  const ops = useOperationsCenter();
  const {
    token,
    authLoading,
    departmentsForUser,
    canManage,
    userId,
    items,
    selected,
    requestContext,
    disputeCase,
    memberConversationContext,
    businessConversationContext,
    handoffContext,
    sourcingBatches,
    sourcingCandidates,
    busy,
    error,
    notice,
    setNotice,
    processingDueSchedules,
    refresh,
    processDueSchedules,
  } = ops;
  return (
    <main className="operations-center-page">
      <header className="operations-center-header">
        <a className="operations-back" href="/">
          ← Control Center
        </a>
        <div>
          <small>FAYFORT STAFF WORKSPACE</small>
          <h1>Operations Center</h1>
          <p>One queue for accountable work across conversations, sourcing, and fulfillment.</p>
        </div>
        <div className="operations-header-actions">
          {token && <OperationsNotifications accessToken={token} />}
          {canManage && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void processDueSchedules()}
              disabled={processingDueSchedules}
            >
              {processingDueSchedules ? "Processing due requests…" : "Process due recurring requests"}
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setNotice("");
              if (token) void refresh(token);
            }}
            disabled={busy}
          >
            Refresh
          </button>
        </div>
      </header>
      {authLoading ? (
        <p role="status">Checking your FayFort staff sign-in…</p>
      ) : !token ? (
        <section className="operations-empty">
          <h2>Staff sign-in required</h2>
          <p>Sign in with an active FayFort worker or platform administrator account.</p>
          <a href="/">Open Control Center sign-in</a>
        </section>
      ) : error && items.length === 0 ? (
        <section className="operations-empty">
          <h2>Operations Center unavailable</h2>
          <p role="alert">{error}</p>
          <a href="/">Return to Control Center</a>
        </section>
      ) : (
        <>
          {canManage && <WorkforcePanel ops={ops} />}
          {canManage && <ReportsPanel ops={ops} />}
          {canManage && <AutomationActivity ops={ops} />}
          <QueueFilters ops={ops} />
          {(error || notice) && (
            <p className={error ? "form-error" : "operations-notice"} role={error ? "alert" : "status"}>
              {error || notice}
            </p>
          )}
          {items.some((item) => item.department === "sourcing") && <SourcingBatchForm ops={ops} />}
          {sourcingBatches.length > 0 && (
            <section className="operations-sourcing-batches">
              <strong>Recent sourcing batches</strong>
              {sourcingBatches.slice(0, 5).map((batch) => (
                <p key={batch.id}>
                  {batch.title} · {batch.items.length} requests · {statusLabel(batch.status)}
                </p>
              ))}
            </section>
          )}
          <div className="operations-center-grid">
            <WorkList ops={ops} />
            <section className="operations-work-detail" aria-label="Selected work details">
              {!selected ? (
                <div className="operations-empty">
                  <h2>Select a work item</h2>
                  <p>Open a queue item to update its next action, checklist, or internal notes.</p>
                </div>
              ) : (
                <>
                  <div className="operations-section-title">
                    <div>
                      <small>
                        {departmentLabel[selected.department]} · {selected.work_type.replaceAll("_", " ")}
                      </small>
                      <h2>{selected.summary}</h2>
                    </div>
                    <span className={`operations-status status-${selected.status}`}>
                      {statusLabel(selected.status)}
                    </span>
                  </div>
                  <p className="operations-source">
                    {selected.member_request_id
                      ? `Member request ${selected.member_request_id}`
                      : selected.work_type === "dispute_case"
                        ? "Dispute case linked to a member request"
                        : selected.member_conversation_id
                          ? `Member conversation ${selected.member_conversation_id}`
                          : selected.handoff_id
                            ? `Human handoff ${selected.handoff_id}`
                            : selected.business_conversation_id
                              ? `Business conversation ${selected.business_conversation_id}`
                              : "Source record"}
                  </p>
                  {requestContext && (
                    <RequestContextPanel ops={ops} selected={selected} requestContext={requestContext} />
                  )}
                  {requestContext &&
                    selected.member_request_id &&
                    !selected.dispute_case_id &&
                    (canManage || selected.assigned_worker_id === userId) &&
                    (canManage || departmentsForUser.includes("disputes")) && (
                      <DisputeCreateForm ops={ops} selected={selected} requestContext={requestContext} />
                    )}
                  {disputeCase && <DisputeCasePanel ops={ops} selected={selected} disputeCase={disputeCase} />}
                  {requestContext &&
                    selected.member_request_id &&
                    selected.department === "fulfillment" &&
                    selected.status === "claimed" &&
                    selected.assigned_worker_id === userId && (
                      <FulfillmentPanel ops={ops} selected={selected} requestContext={requestContext} />
                    )}
                  {requestContext && selected.department === "sourcing" && (
                    <SourcingCandidatesPanel ops={ops} selected={selected} requestContext={requestContext} />
                  )}
                  {requestContext &&
                    selected.department === "sourcing" &&
                    (canManage || selected.assigned_worker_id === userId) &&
                    sourcingCandidates.length > 0 && (
                      <ShareOptionsForm ops={ops} selected={selected} requestContext={requestContext} />
                    )}
                  {memberConversationContext && (
                    <MemberConversationPanel
                      ops={ops}
                      selected={selected}
                      memberConversationContext={memberConversationContext}
                    />
                  )}
                  {handoffContext && <HandoffPanel ops={ops} selected={selected} handoffContext={handoffContext} />}
                  {businessConversationContext && (
                    <BusinessConversationPanel
                      ops={ops}
                      selected={selected}
                      businessConversationContext={businessConversationContext}
                    />
                  )}
                  {selected.member_conversation_id &&
                    !memberConversationContext &&
                    !canManage &&
                    selected.assigned_worker_id !== userId && (
                      <p className="operations-muted">Claim this work item to open its private member conversation.</p>
                    )}
                  {selected.business_id && (businessConversationContext?.id || selected.business_conversation_id) && (
                    <p>
                      <a
                        className="secondary-button"
                        href={`/?operationsBusiness=${encodeURIComponent(selected.business_id)}&operationsConversation=${encodeURIComponent(businessConversationContext?.id || selected.business_conversation_id || "")}`}
                      >
                        Open source conversation
                      </a>
                    </p>
                  )}
                  {!selected.handoff_id && (canManage || selected.assigned_worker_id === userId) ? (
                    <WorkActionForm ops={ops} selected={selected} />
                  ) : !selected.handoff_id ? (
                    <p className="operations-muted">Claim this work item before changing its status or next action.</p>
                  ) : null}
                  {!selected.handoff_id &&
                    (canManage ||
                      (selected.assigned_worker_id === userId &&
                        departmentsForUser.some((department) => department !== selected.department))) && (
                      <TransferForm ops={ops} selected={selected} />
                    )}
                  <WorkHistory ops={ops} selected={selected} />
                  <ChecklistPanel ops={ops} selected={selected} />
                  <NotesPanel ops={ops} selected={selected} />
                </>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
