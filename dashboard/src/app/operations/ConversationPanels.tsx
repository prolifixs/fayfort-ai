import { StaffChatThread, fromBusinessMessage, fromMemberMessage } from "../staff/StaffChatThread";
import { statusLabel } from "./types";
import type { OperationsState } from "./useOperationsCenter";

export function MemberConversationPanel({
  ops,
  selected,
  memberConversationContext,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
  memberConversationContext: NonNullable<OperationsState["memberConversationContext"]>;
}) {
  const { canManage, userId, memberReply, setMemberReply, busy, sendMemberReply, setChatTakeover } = ops;
  const mayAct = canManage || selected.assigned_worker_id === userId;
  const takenOver = Boolean(memberConversationContext.staff_takeover_at);
  return (
    <section className="operations-detail-section operations-request-context">
      <h3>Member chat</h3>
      <strong>{memberConversationContext.title}</strong>
      {!memberConversationContext.linked_request_id && (
        <div className={`ops-takeover${takenOver ? " is-human" : ""}`} role="status">
          <span>
            {takenOver ? (
              <>
                <strong>You have this chat.</strong> The AI is paused. It takes over again if nobody from the team writes for 30
                minutes, or when you hand it back.
              </>
            ) : (
              <>
                <strong>The AI is answering this member.</strong> Take it over to chat yourself; the AI stays quiet while you do.
              </>
            )}
          </span>
          {mayAct &&
            (takenOver ? (
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void setChatTakeover(false)}>
                Hand back to the AI
              </button>
            ) : (
              <button type="button" className="primary-button" disabled={busy} onClick={() => void setChatTakeover(true)}>
                Take over from the AI
              </button>
            ))}
        </div>
      )}
      {memberConversationContext.linked_request_id && (
        <p>This conversation is linked to a sourcing request. Use the request timeline for fulfillment progress.</p>
      )}
      <StaffChatThread
        label="Member conversation messages"
        messages={memberConversationContext.messages.map(fromMemberMessage)}
        composer={
          !memberConversationContext.linked_request_id && (canManage || selected.assigned_worker_id === userId)
            ? {
                id: "operations-member-reply",
                label: "Reply to member",
                value: memberReply,
                onChange: setMemberReply,
                onSubmit: sendMemberReply,
                busy,
                placeholder: "Write a staff reply…",
                sendLabel: "Send reply",
                note: "Saved in the member's chat and the work history. Sending takes the chat over, so the AI stays quiet; the item then waits for the member.",
              }
            : null
        }
      />
    </section>
  );
}

export function HandoffPanel({
  ops,
  selected,
  handoffContext,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
  handoffContext: NonNullable<OperationsState["handoffContext"]>;
}) {
  return (
    <section className="operations-detail-section operations-request-context">
      <h3>Business handoff</h3>
      <strong>{statusLabel(handoffContext.status)}</strong>
      <p>
        Requested {new Date(handoffContext.requested_at).toLocaleString()} · Updated{" "}
        {new Date(handoffContext.updated_at).toLocaleString()}
      </p>
      {handoffContext.reason && (
        <p>
          <strong>Escalation reason:</strong> {handoffContext.reason}
        </p>
      )}
      {handoffContext.closed_at && <p>Closed {new Date(handoffContext.closed_at).toLocaleString()}</p>}
    </section>
  );
}

export function BusinessConversationPanel({
  ops,
  selected,
  businessConversationContext,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
  businessConversationContext: NonNullable<OperationsState["businessConversationContext"]>;
}) {
  const { userId, canManage, handoffContext, businessReply, setBusinessReply, busy, sendBusinessReply, returnToAutomation } = ops;
  const canReply =
    selected.assigned_worker_id === userId && selected.status === "claimed" && handoffContext?.status === "active";
  return (
    <section className="operations-detail-section operations-request-context">
      <h3>Customer chat · {statusLabel(businessConversationContext.channel)}</h3>
      {businessConversationContext.summary && <p>{businessConversationContext.summary}</p>}
      <StaffChatThread
        label="Business conversation messages"
        messages={businessConversationContext.messages.map((message) => fromBusinessMessage(message))}
        composer={
          canReply
            ? {
                id: "operations-business-reply",
                label: "Reply to customer",
                value: businessReply,
                onChange: setBusinessReply,
                onSubmit: sendBusinessReply,
                busy,
                placeholder: "Write a reply to the customer…",
                note: "Saved to the conversation and audited. Delivery status is reported after it's sent.",
              }
            : null
        }
        footer={
          canReply ? (
            <div className="staff-thread-footer">
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void returnToAutomation()}>
                Return to automation
              </button>
            </div>
          ) : (
            <p className="staff-thread-footer">
              {canManage
                ? "Replies and Return to automation belong to the FayFort worker who claims this handoff. Sign in with a worker account to claim it from Available."
                : "Claim this handoff to reply or return it to automation."}
            </p>
          )
        }
      />
    </section>
  );
}
