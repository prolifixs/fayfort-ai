import { fulfillmentNextStages, disputeNextStatuses, statusLabel } from "./types";
import type { OperationsState } from "./useOperationsCenter";

export function RequestContextPanel({
  ops,
  selected,
  requestContext,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
  requestContext: NonNullable<OperationsState["requestContext"]>;
}) {
  return (
    <section className="operations-detail-section operations-request-context">
      <h3>Member request context</h3>
      <strong>{requestContext.request_title}</strong>
      {requestContext.product_name_snapshot && <p>Catalog item: {requestContext.product_name_snapshot}</p>}
      {requestContext.request_description && <p>{requestContext.request_description}</p>}
      {requestContext.source_url && (
        <p>
          Source:{" "}
          <a href={requestContext.source_url} target="_blank" rel="noreferrer">
            Open member-provided link
          </a>
        </p>
      )}
      {requestContext.recurring_schedule && (
        <section className="operations-recurring-context">
          <h4>Recurring request schedule · {statusLabel(requestContext.recurring_schedule!.status)}</h4>
          <p>
            {requestContext.recurring_schedule!.cadence === "custom"
              ? `Every ${requestContext.recurring_schedule!.interval_count} ${requestContext.recurring_schedule!.interval_unit}`
              : statusLabel(requestContext.recurring_schedule!.cadence)}{" "}
            · {requestContext.recurring_schedule!.units_per_order}{" "}
            {requestContext.recurring_schedule!.units_per_order === 1 ? "unit" : "units"} per cycle ·{" "}
            {requestContext.recurring_schedule!.occurrences.length} of{" "}
            {requestContext.recurring_schedule!.occurrence_limit} requests created ·{" "}
            {requestContext.recurring_schedule!.time_zone}
          </p>
          {requestContext.recurring_schedule!.status === "active" && (
            <p>
              Next cycle {requestContext.recurring_schedule!.next_occurrence_number} due{" "}
              {new Date(requestContext.recurring_schedule!.next_due_at).toLocaleString(undefined, {
                timeZone: requestContext.recurring_schedule!.time_zone,
              })}
            </p>
          )}
          <ol>
            {requestContext.recurring_schedule!.occurrences.map((cycle) => (
              <li key={cycle.id}>
                Cycle {cycle.occurrence_number} · {statusLabel(cycle.status)} · due{" "}
                {new Date(cycle.due_at).toLocaleString(undefined, {
                  timeZone: requestContext.recurring_schedule!.time_zone,
                })}
                {cycle.quote_accepted_at && (
                  <span> · quote accepted {new Date(cycle.quote_accepted_at).toLocaleString()}</span>
                )}
              </li>
            ))}
          </ol>
          {requestContext.recurring_schedule!.events.length > 0 && (
            <details>
              <summary>Schedule history</summary>
              <ol>
                {requestContext.recurring_schedule!.events.map((event) => (
                  <li key={event.id}>
                    {statusLabel(event.event_type.replaceAll("_", " "))}
                    {event.occurrence_number ? ` · cycle ${event.occurrence_number}` : ""} ·{" "}
                    {new Date(event.created_at).toLocaleString()}
                  </li>
                ))}
              </ol>
            </details>
          )}
          <small>Each cycle opens a sourcing request. No purchase or charge is automatic.</small>
        </section>
      )}
      <ol className="operations-request-timeline">
        {requestContext.events.map((event) => (
          <li key={event.id}>
            <strong>{statusLabel(event.stage)}</strong>
            <small>{new Date(event.created_at).toLocaleString()}</small>
            {event.member_note && <p>{event.member_note}</p>}
            {event.stage === "shipped" && event.details?.tracking_number && (
              <p>
                Tracking number: <strong>{event.details.tracking_number}</strong>
                {event.details.carrier_name && ` · ${event.details.carrier_name}`}
                {event.details.tracking_url && (
                  <>
                    {" "}
                    ·{" "}
                    <a href={event.details.tracking_url} target="_blank" rel="noreferrer">
                      Carrier tracking
                    </a>
                  </>
                )}
              </p>
            )}
            {event.media?.map((media) => (
              <div className="request-evidence" key={media.id}>
                {media.content_type.startsWith("video/") ? (
                  <video src={media.url} controls preload="metadata" aria-label={media.original_filename} />
                ) : (
                  <a href={media.url} target="_blank" rel="noreferrer">
                    <img src={media.url} alt={media.original_filename} />
                  </a>
                )}
                <small>{media.original_filename}</small>
              </div>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DisputeCreateForm({
  ops,
  selected,
  requestContext,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
  requestContext: NonNullable<OperationsState["requestContext"]>;
}) {
  const {
    busy,
    disputeCategory,
    setDisputeCategory,
    disputeSummary,
    setDisputeSummary,
    disputeNextAction,
    setDisputeNextAction,
    disputeDueAt,
    setDisputeDueAt,
    createDispute,
  } = ops;
  return (
    <form className="operations-detail-section operations-dispute-create" onSubmit={createDispute}>
      <h3>Open a separate dispute case</h3>
      <p>
        This creates a Disputes queue item and keeps the member request timeline unchanged. Opening a case does not send
        a member notification.
      </p>
      <label>
        Issue category
        <select
          aria-label="Dispute category"
          value={disputeCategory}
          onChange={(event) => setDisputeCategory(event.target.value)}
        >
          <option value="wrong_item">Wrong item</option>
          <option value="item_condition">Item condition</option>
          <option value="missing_item">Missing item</option>
          <option value="delivery">Delivery</option>
          <option value="payment">Payment</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        Case summary
        <textarea
          aria-label="Dispute summary"
          required
          maxLength={2000}
          rows={3}
          value={disputeSummary}
          onChange={(event) => setDisputeSummary(event.target.value)}
          placeholder="Describe the issue and what needs review."
        />
      </label>
      <label>
        First action
        <input
          aria-label="Dispute next action"
          required
          maxLength={500}
          value={disputeNextAction}
          onChange={(event) => setDisputeNextAction(event.target.value)}
        />
      </label>
      <label>
        Due date (optional)
        <input
          aria-label="Dispute due date"
          type="datetime-local"
          value={disputeDueAt}
          onChange={(event) => setDisputeDueAt(event.target.value)}
        />
      </label>
      <button className="secondary-button" disabled={busy || !disputeSummary.trim()}>
        Open dispute case
      </button>
    </form>
  );
}

export function DisputeCasePanel({
  ops,
  selected,
  disputeCase,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
  disputeCase: NonNullable<OperationsState["disputeCase"]>;
}) {
  const {
    canManage,
    userId,
    busy,
    disputeStatus,
    setDisputeStatus,
    disputeResolution,
    setDisputeResolution,
    updateDispute,
  } = ops;
  return (
    <section className="operations-detail-section operations-dispute-case">
      <h3>Dispute case · {statusLabel(disputeCase.status)}</h3>
      <p>
        <strong>Category:</strong> {statusLabel(disputeCase.category)}
      </p>
      <p>{disputeCase.summary}</p>
      {disputeCase.resolution && (
        <p>
          <strong>Resolution:</strong> {disputeCase.resolution}
        </p>
      )}
      <small>
        Case version {disputeCase.version} · opened {new Date(disputeCase.created_at).toLocaleString()}
      </small>
      <h4>Case history</h4>
      <ol>
        {disputeCase.events.map((event) => (
          <li key={event.id}>
            <strong>{statusLabel(event.next_status)}</strong>
            <p>{event.note}</p>
            <small>{new Date(event.created_at).toLocaleString()}</small>
          </li>
        ))}
      </ol>
      {(canManage || (selected.assigned_worker_id === userId && selected.status === "claimed")) &&
        (disputeNextStatuses[disputeCase.status] || []).length > 0 && (
          <form onSubmit={updateDispute}>
            <label>
              Update case status
              <select
                aria-label="Dispute status"
                value={disputeStatus}
                onChange={(event) => setDisputeStatus(event.target.value)}
              >
                {[disputeCase.status, ...(disputeNextStatuses[disputeCase.status] || [])].map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            {["resolved", "closed"].includes(disputeStatus) && (
              <label>
                Resolution
                <textarea
                  aria-label="Dispute resolution"
                  required
                  maxLength={2000}
                  rows={3}
                  value={disputeResolution}
                  onChange={(event) => setDisputeResolution(event.target.value)}
                  placeholder="Record the outcome before closing the case."
                />
              </label>
            )}
            <button
              className="primary-button"
              disabled={
                busy ||
                disputeStatus === disputeCase.status ||
                (["resolved", "closed"].includes(disputeStatus) && !disputeResolution.trim())
              }
            >
              Save dispute update
            </button>
            <small>Case notes are staff-only. Keep the member updated through their existing conversation.</small>
          </form>
        )}
    </section>
  );
}

export function FulfillmentPanel({
  ops,
  selected,
  requestContext,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
  requestContext: NonNullable<OperationsState["requestContext"]>;
}) {
  const {
    busy,
    fulfillmentStage,
    setFulfillmentStage,
    fulfillmentNote,
    setFulfillmentNote,
    shipment,
    setShipment,
    warehouseEvidence,
    setWarehouseEvidence,
    saveFulfillmentMilestone,
    uploadWarehouseEvidence,
  } = ops;
  return (
    <section className="operations-detail-section operations-fulfillment-panel">
      <h3>Fulfillment milestones</h3>
      <p>
        Updates appear in the member’s request timeline. Purchase confirmation is recorded only after payment is
        complete.
      </p>
      {fulfillmentNextStages[requestContext.events.at(-1)?.stage || ""] ? (
        <form onSubmit={saveFulfillmentMilestone}>
          <label>
            Next request milestone
            <select
              aria-label="Next request milestone"
              value={fulfillmentStage}
              onChange={(event) => setFulfillmentStage(event.target.value)}
            >
              {(fulfillmentNextStages[requestContext.events.at(-1)?.stage || ""] || []).map((stage) => (
                <option key={stage} value={stage}>
                  {statusLabel(stage)}
                </option>
              ))}
            </select>
          </label>
          {fulfillmentStage === "shipped" && (
            <div className="operations-shipment-fields">
              <label>
                Carrier (optional)
                <input
                  maxLength={100}
                  value={shipment.carrier}
                  onChange={(event) => setShipment((current) => ({ ...current, carrier: event.target.value }))}
                />
              </label>
              <label>
                Tracking number (required)
                <input
                  required
                  maxLength={120}
                  value={shipment.number}
                  onChange={(event) => setShipment((current) => ({ ...current, number: event.target.value }))}
                />
              </label>
              <label>
                Tracking link (optional)
                <input
                  type="url"
                  pattern="https://.*"
                  placeholder="https://…"
                  value={shipment.url}
                  onChange={(event) => setShipment((current) => ({ ...current, url: event.target.value }))}
                />
              </label>
            </div>
          )}
          <label>
            Member update (optional)
            <textarea
              maxLength={1000}
              rows={2}
              value={fulfillmentNote}
              onChange={(event) => setFulfillmentNote(event.target.value)}
              placeholder="Factual update for the member"
            />
          </label>
          <button
            className="primary-button"
            disabled={busy || (fulfillmentStage === "shipped" && !shipment.number.trim())}
          >
            {busy ? "Saving…" : "Record member milestone"}
          </button>
        </form>
      ) : (
        <p className="operations-muted">The current request stage has no fulfillment action available here.</p>
      )}
      {requestContext.events.at(-1)?.stage === "item_in_warehouse" && (
        <div className="operations-warehouse-evidence">
          <label>
            Warehouse evidence (photo or video)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              onChange={(event) => setWarehouseEvidence(event.target.files?.[0] || null)}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !warehouseEvidence}
            onClick={() => void uploadWarehouseEvidence()}
          >
            {busy ? "Uploading…" : "Upload private evidence"}
          </button>
          <small>
            Private evidence is attached to this warehouse receipt and visible to the member on their request timeline.
          </small>
        </div>
      )}
    </section>
  );
}

export function SourcingCandidatesPanel({
  ops,
  selected,
  requestContext,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
  requestContext: NonNullable<OperationsState["requestContext"]>;
}) {
  const {
    canManage,
    userId,
    sourcingCandidates,
    candidateLoadError,
    candidateEditingId,
    setCandidateEditingId,
    candidateName,
    setCandidateName,
    candidateSupplier,
    setCandidateSupplier,
    candidateUrl,
    setCandidateUrl,
    candidatePrice,
    setCandidatePrice,
    candidateCurrency,
    setCandidateCurrency,
    candidateAvailability,
    setCandidateAvailability,
    candidateEvidence,
    setCandidateEvidence,
    busy,
    editSourcingCandidate,
    addSourcingCandidate,
  } = ops;
  return (
    <section className="operations-detail-section operations-request-context">
      <h3>Research candidates</h3>
      <p>Candidate links and evidence stay staff-only and are attached to this request.</p>
      {candidateLoadError && (
        <p className="operations-muted">
          Candidate storage is not available yet. The sourcing desk migration must be applied first.
        </p>
      )}
      {sourcingCandidates.length === 0 && !candidateLoadError ? (
        <p className="operations-muted">No candidates recorded for this request.</p>
      ) : (
        <ul className="operations-sourcing-candidates">
          {sourcingCandidates.map((candidate) => (
            <li key={candidate.id}>
              <strong>{candidate.product_name}</strong>
              {candidate.supplier_name && <span> · {candidate.supplier_name}</span>}
              <p>
                <a href={candidate.product_url} target="_blank" rel="noreferrer">
                  Open product
                </a>
                {candidate.price_amount !== null &&
                  ` · ${candidate.price_amount.toFixed(2)} ${candidate.currency || ""}`}
                {candidate.availability && ` · ${candidate.availability}`}
              </p>
              <p>{candidate.evidence_note}</p>
              <small>{new Date(candidate.created_at).toLocaleString()}</small>
              {(canManage || selected.assigned_worker_id === userId) && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => editSourcingCandidate(candidate)}
                >
                  Edit candidate
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(canManage || selected.assigned_worker_id === userId) && !candidateLoadError ? (
        <form className="operations-sourcing-candidate-form" onSubmit={addSourcingCandidate}>
          <h4>{candidateEditingId ? "Edit research candidate" : "Add research candidate"}</h4>
          <label>
            Product name
            <input
              required
              maxLength={240}
              value={candidateName}
              onChange={(event) => setCandidateName(event.target.value)}
            />
          </label>
          <label>
            Supplier (optional)
            <input
              maxLength={160}
              value={candidateSupplier}
              onChange={(event) => setCandidateSupplier(event.target.value)}
            />
          </label>
          <label>
            Product URL
            <input
              required
              type="url"
              maxLength={2000}
              value={candidateUrl}
              onChange={(event) => setCandidateUrl(event.target.value)}
              placeholder="https://…"
            />
          </label>
          <div>
            <label>
              Price (optional)
              <input
                type="number"
                min="0"
                step="0.01"
                value={candidatePrice}
                onChange={(event) => setCandidatePrice(event.target.value)}
              />
            </label>
            <label>
              Currency
              <select value={candidateCurrency} onChange={(event) => setCandidateCurrency(event.target.value)}>
                <option>USD</option>
                <option>EUR</option>
                <option>GBP</option>
                <option>CAD</option>
                <option>AUD</option>
              </select>
            </label>
          </div>
          <label>
            Availability (optional)
            <input
              maxLength={240}
              value={candidateAvailability}
              onChange={(event) => setCandidateAvailability(event.target.value)}
            />
          </label>
          <label>
            Evidence and notes
            <textarea
              required
              maxLength={2000}
              rows={3}
              value={candidateEvidence}
              onChange={(event) => setCandidateEvidence(event.target.value)}
              placeholder="Record what you verified, such as product details or shipping estimate."
            />
          </label>
          <button className="secondary-button" disabled={busy}>
            {candidateEditingId ? "Save candidate changes" : "Add research candidate"}
          </button>
          {candidateEditingId && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setCandidateEditingId(null);
                setCandidateName("");
                setCandidateSupplier("");
                setCandidateUrl("");
                setCandidatePrice("");
                setCandidateCurrency("USD");
                setCandidateAvailability("");
                setCandidateEvidence("");
              }}
            >
              Cancel edit
            </button>
          )}
        </form>
      ) : (
        !candidateLoadError && (
          <p className="operations-muted">Claim this sourcing request before recording research.</p>
        )
      )}
    </section>
  );
}

export function ShareOptionsForm({
  ops,
  selected,
  requestContext,
}: {
  ops: OperationsState;
  selected: NonNullable<OperationsState["selected"]>;
  requestContext: NonNullable<OperationsState["requestContext"]>;
}) {
  const {
    sourcingCandidates,
    shareCandidateIds,
    setShareCandidateIds,
    memberOptionNote,
    setMemberOptionNote,
    busy,
    shareSourcingOptions,
  } = ops;
  return (
    <form className="operations-detail-section operations-share-options" onSubmit={shareSourcingOptions}>
      <h3>Share options with member</h3>
      <p>
        Only selected product details and your member note are shown. Supplier names and research evidence stay
        staff-only.
      </p>
      <fieldset>
        <legend>Choose up to 10 candidates</legend>
        {sourcingCandidates.map((candidate) => (
          <label key={candidate.id}>
            <input
              type="checkbox"
              checked={shareCandidateIds.includes(candidate.id)}
              onChange={(event) =>
                setShareCandidateIds((current) =>
                  event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id),
                )
              }
            />
            <span>
              {candidate.product_name}
              {candidate.price_amount !== null
                ? ` · ${candidate.price_amount.toFixed(2)} ${candidate.currency || ""}`
                : ""}
            </span>
          </label>
        ))}
      </fieldset>
      <label>
        Note for member (optional)
        <textarea
          maxLength={1000}
          rows={2}
          value={memberOptionNote}
          onChange={(event) => setMemberOptionNote(event.target.value)}
          placeholder="What should the member know when comparing these options?"
        />
      </label>
      <button className="primary-button" disabled={busy || shareCandidateIds.length === 0}>
        Share selected options
      </button>
    </form>
  );
}
