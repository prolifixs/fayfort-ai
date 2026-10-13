import { apiRequest } from "../../lib/api";
import { useCallback, useEffect, useState } from "react";
import type { VerificationDecisionRow, VerificationQueueRow, VerificationReviewRow } from "./types";

export function VerificationPage({ accessToken, businessId }: { accessToken: string; businessId: string }) {
  const [queue, setQueue] = useState<VerificationQueueRow[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [decisions, setDecisions] = useState<VerificationDecisionRow[]>([]);
  const [reviews, setReviews] = useState<VerificationReviewRow[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<{
        review_queue: VerificationQueueRow[];
        decisions: VerificationDecisionRow[];
        reviews: VerificationReviewRow[];
        can_review: boolean;
      }>(`/businesses/${businessId}/verification`, accessToken);
      setCanManage(data.can_review);
      setQueue(data.review_queue);
      setDecisions(data.decisions);
      setReviews(data.reviews || []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, businessId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function review(item: VerificationQueueRow) {
    setBusy(item.record_id);
    setError("");
    try {
      await apiRequest(`/businesses/${businessId}/verification/${item.source_type}/${item.record_id}`, accessToken, {
        method: "POST",
        body: JSON.stringify({
          verification_status: statuses[item.record_id] || "verified",
          reason: reasons[item.record_id]?.trim() || "Reviewed against the source record.",
        }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review could not be saved.");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="control-panel" aria-label="Directory verification review">
      <div className="panel-heading">
        <div>
          <h2>Directory verification</h2>
          <p>
            Review individual imported records. Your choice and reason are stored in an audit trail and affect which
            tool results can be returned.
          </p>
        </div>
        <button onClick={() => void refresh()} disabled={loading}>
          Refresh
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!canManage && (
        <p className="quiet-note">
          Only a FayFort platform administrator can change the shared directory verification status.
        </p>
      )}
      {loading ? (
        <p>Loading review queue�</p>
      ) : queue.length === 0 ? (
        <p className="empty-copy">No unverified or conflicting directory records are waiting for review.</p>
      ) : (
        <div className="record-list">
          {queue.map((item) => (
            <div className="record verification-record" key={`${item.source_type}-${item.record_id}`}>
              <div>
                <strong>{item.label || item.record_id}</strong>
                <small>
                  {item.tool_id} � {item.source_type.replaceAll("_", " ")} � Current status: {item.verification_status}
                </small>
                {canManage && (
                  <div className="record-actions">
                    <select
                      aria-label={`Verification decision for ${item.record_id}`}
                      value={statuses[item.record_id] || "verified"}
                      onChange={(e) => setStatuses((previous) => ({ ...previous, [item.record_id]: e.target.value }))}
                    >
                      <option value="verified">Verified</option>
                      <option value="unverified">Unverified</option>
                      <option value="conflicting">Conflicting</option>
                      <option value="unknown">Unknown</option>
                    </select>
                    <input
                      aria-label={`Review reason for ${item.record_id}`}
                      minLength={8}
                      maxLength={500}
                      value={reasons[item.record_id] || ""}
                      onChange={(e) => setReasons((previous) => ({ ...previous, [item.record_id]: e.target.value }))}
                      placeholder="Why is this status supported?"
                    />
                    <button
                      disabled={busy === item.record_id || (reasons[item.record_id] || "").trim().length < 8}
                      onClick={() => void review(item)}
                    >
                      {busy === item.record_id ? "Saving�" : "Save review"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <h3 className="section-title">Recent reviews</h3>
      {reviews.length === 0 ? (
        <p className="empty-copy">No verification reviews recorded for this business.</p>
      ) : (
        <div className="record-list">
          {reviews.map((item) => (
            <div className="record" key={item.id}>
              <div>
                <strong>
                  {item.tool_id} � {item.previous_status} � {item.verification_status}
                </strong>
                <small>
                  {item.source_table} � {item.record_id} � Reviewer {item.reviewer_user_id} �{" "}
                  {new Date(item.created_at).toLocaleString()}
                </small>
                <small>{item.reason}</small>
              </div>
            </div>
          ))}
        </div>
      )}
      <h3 className="section-title">Recent access decisions</h3>
      {decisions.length === 0 ? (
        <p className="empty-copy">No directory access decisions recorded yet.</p>
      ) : (
        <div className="record-list">
          {decisions.map((item) => (
            <div className="record" key={item.id}>
              <div>
                <strong>
                  {item.tool_id} � {item.outcome}
                </strong>
                <small>
                  Verification: {item.verification_state || "not required"} � {item.reason_code || "�"} �{" "}
                  {new Date(item.created_at).toLocaleString()}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
