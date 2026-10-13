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
  const { canManage, userId, memberReply, setMemberReply, busy, sendMemberReply } = ops;
  return (
    <section className="operations-detail-section operations-request-context">
      <h3>Member conversation</h3>
      <strong>{memberConversationContext.title}</strong>
      {memberConversationContext.linked_request_id && (
        <p>This conversation is linked to a sourcing request. Use the request timeline for fulfillment progress.</p>
      )}
      <ol className="operations-conversation-messages">
        {memberConversationContext.messages.map((message) => (
          <li key={message.id} className={`is-${message.sender_type}`}>
            <strong>
              {message.sender_type === "member"
                ? "Member"
                : message.sender_type === "worker"
                  ? "FayFort staff"
                  : "FayFort assistant"}
            </strong>
            <p>{message.content}</p>
            <small>{new Date(message.created_at).toLocaleString()}</small>
          </li>
        ))}
      </ol>
      {!memberConversationContext.linked_request_id && (canManage || selected.assigned_worker_id === userId) && (
        <form className="operations-member-reply" onSubmit={sendMemberReply}>
          <label htmlFor="operations-member-reply">Reply to member</label>
          <textarea
            id="operations-member-reply"
            maxLength={4000}
            rows={3}
            value={memberReply}
            onChange={(event) => setMemberReply(event.target.value)}
            placeholder="Write a staff reply…"
          />
          <button className="primary-button" disabled={busy || !memberReply.trim()}>
            {busy ? "Sending…" : "Send reply and wait for member"}
          </button>
          <small>This reply is saved in the member chat and audited in work history.</small>
        </form>
      )}
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
  const { userId, handoffContext, businessReply, setBusinessReply, busy, sendBusinessReply, returnToAutomation } = ops;
  return (
    <section className="operations-detail-section operations-request-context">
      <h3>Business conversation · {statusLabel(businessConversationContext.channel)}</h3>
      {businessConversationContext.summary && <p>{businessConversationContext.summary}</p>}
      <ol className="operations-conversation-messages">
        {businessConversationContext.messages.map((message) => (
          <li key={message.id} className={message.sender_type === "agent" ? "is-assistant" : "is-member"}>
            <strong>{statusLabel(message.sender_type)}</strong>
            <p>{message.content}</p>
            <small>{new Date(message.created_at).toLocaleString()}</small>
          </li>
        ))}
      </ol>
      {selected.assigned_worker_id === userId &&
      selected.status === "claimed" &&
      handoffContext?.status === "active" ? (
        <>
          <form className="operations-member-reply" onSubmit={sendBusinessReply}>
            <label htmlFor="operations-business-reply">Reply to customer</label>
            <textarea
              id="operations-business-reply"
              maxLength={4000}
              rows={3}
              value={businessReply}
              onChange={(event) => setBusinessReply(event.target.value)}
              placeholder="Write a business-channel reply…"
            />
            <button className="primary-button" disabled={busy || !businessReply.trim()}>
              {busy ? "Sending…" : "Send reply"}
            </button>
            <small>
              Saved to the business conversation and audited. Provider delivery status is reported after save.
            </small>
          </form>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void returnToAutomation()}>
            Return to automation
          </button>
        </>
      ) : (
        <small>Claim this handoff to reply or return it to automation.</small>
      )}
    </section>
  );
}
