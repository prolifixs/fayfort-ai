import { MemberRecurringScheduleList } from "../MemberRecurringScheduleList";
import { apiRequest } from "../../lib/api";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  type MemberRequestRow,
  RequestSourceSummary,
  requestProgressIndex,
  requestProgressStages,
  requestStageDescriptions,
  requestStageIcons,
  requestStageLabels,
} from "../requests/requestShared";
import type { MemberCatalog, MemberCatalogProduct } from "./memberShared";
import { depositNote, useMemberPlan } from "./membershipApi";

/** Stages before payment: the member can still cancel. */
const CANCELLABLE = ["submitted", "under_review", "sourcing", "needs_member_input", "options_sent"];

export function MemberRequestsPanel({ accessToken }: { accessToken: string }) {
  const [requests, setRequests] = useState<MemberRequestRow[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState<"description" | "saved_product" | "catalog_product" | "url" | "image">(
    "description",
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [productId, setProductId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [catalogProducts, setCatalogProducts] = useState<MemberCatalogProduct[]>([]);
  const [savedProducts, setSavedProducts] = useState<MemberCatalogProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [optionBusy, setOptionBusy] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerBusy, setAnswerBusy] = useState("");
  const [error, setError] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState<"monthly" | "quarterly" | "yearly" | "custom">("monthly");
  const [customInterval, setCustomInterval] = useState(1);
  const [customUnit, setCustomUnit] = useState<"days" | "weeks" | "months">("months");
  const [unitsPerOrder, setUnitsPerOrder] = useState(1);
  const [occurrences, setOccurrences] = useState(3);
  const [timeZone, setTimeZone] = useState("");
  const [firstRepeatLocal, setFirstRepeatLocal] = useState("");
  const [policyAcknowledged, setPolicyAcknowledged] = useState(false);
  const [pendingRecurringIntentId, setPendingRecurringIntentId] = useState("");
  const [recurringIdempotencyKey, setRecurringIdempotencyKey] = useState(() => crypto.randomUUID());
  const [notice, setNotice] = useState("");
  const [budget, setBudget] = useState("");
  const { plan } = useMemberPlan(accessToken);
  const budgetValue = Number(budget);
  const expectedTotal = budget.trim() && Number.isFinite(budgetValue) && budgetValue > 0 ? budgetValue : null;
  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ requests: MemberRequestRow[] }>("/members/requests", accessToken);
      setRequests(result.requests || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Requests could not be loaded.");
    }
  }, [accessToken]);
  const loadProductChoices = useCallback(async () => {
    setProductsLoading(true);
    try {
      const [all, saved] = await Promise.all([
        apiRequest<MemberCatalog>("/members/products", accessToken),
        apiRequest<MemberCatalog>("/members/products?saved_only=true", accessToken),
      ]);
      setCatalogProducts(all.products || []);
      setSavedProducts(saved.products || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Product choices could not be loaded.");
    } finally {
      setProductsLoading(false);
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadProductChoices();
  }, [loadProductChoices]);
  useEffect(() => {
    if (!requests.length || !window.location.hash.startsWith("#request-")) return;
    const targetId = decodeURIComponent(window.location.hash.slice(1));
    window.requestAnimationFrame(() =>
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, [requests]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (recurring) {
        if (!policyAcknowledged) throw new Error("Confirm the recurring-request terms before continuing.");
        if (!timeZone || !firstRepeatLocal) throw new Error("Choose the schedule time zone and first repeat time.");
        let intentId = pendingRecurringIntentId;
        if (!intentId) {
          const recurrencePayload = {
            cadence: recurrence,
            interval_count: recurrence === "custom" ? customInterval : undefined,
            interval_unit: recurrence === "custom" ? customUnit : undefined,
            units_per_order: unitsPerOrder,
            occurrence_count: occurrences,
          };
          let intent: { schedule_intent_id: string };
          if (sourceType === "image") {
            if (!file) throw new Error("Choose a product screenshot first.");
            if (file.size > 10 * 1024 * 1024) throw new Error("Screenshots must be 10 MiB or smaller.");
            const params = new URLSearchParams({
              request_title: title.trim(),
              filename: file.name,
              recurrence: JSON.stringify(recurrencePayload),
              idempotency_key: recurringIdempotencyKey,
            });
            if (description.trim()) params.set("request_description", description.trim());
            intent = await apiRequest(`/members/requests/recurring-intent/image?${params}`, accessToken, {
              method: "POST",
              body: file,
              headers: { "Content-Type": file.type },
            });
          } else {
            intent = await apiRequest<{ schedule_intent_id: string }>(
              "/members/requests/recurring-intent",
              accessToken,
              {
                method: "POST",
                body: JSON.stringify({
                  request_title: title.trim(),
                  request_description: description.trim() || null,
                  source_type: sourceType,
                  source_url: sourceType === "url" ? sourceUrl.trim() : null,
                  product_id: sourceType === "saved_product" || sourceType === "catalog_product" ? productId : null,
                  recurrence: recurrencePayload,
                  idempotency_key: recurringIdempotencyKey,
                }),
              },
            );
          }
          intentId = intent.schedule_intent_id;
          setPendingRecurringIntentId(intentId);
        }
        await apiRequest(`/members/requests/recurring-intents/${intentId}/activate`, accessToken, {
          method: "POST",
          body: JSON.stringify({
            time_zone: timeZone,
            first_repeat_local: firstRepeatLocal,
            acknowledge_mvp_policy: true,
          }),
        });
        setNotice(
          "Recurring sourcing schedule created. Each cycle needs a fresh quote; no order or charge is automatic.",
        );
        window.dispatchEvent(new Event("member-recurring-schedules-refresh"));
        setPendingRecurringIntentId("");
        setRecurringIdempotencyKey(crypto.randomUUID());
        setPolicyAcknowledged(false);
        setRecurring(false);
      } else if (sourceType === "image") {
        if (!file) throw new Error("Choose a product screenshot first.");
        if (file.size > 10 * 1024 * 1024) throw new Error("Screenshots must be 10 MiB or smaller.");
        const params = new URLSearchParams({ request_title: title.trim(), filename: file.name });
        if (description.trim()) params.set("request_description", description.trim());
        if (expectedTotal) params.set("expected_total", String(expectedTotal));
        await apiRequest(`/members/requests/image?${params}`, accessToken, {
          method: "POST",
          body: file,
          headers: { "Content-Type": file.type },
        });
      } else {
        await apiRequest("/members/requests", accessToken, {
          method: "POST",
          body: JSON.stringify({
            request_title: title.trim(),
            request_description: description.trim() || null,
            source_type: sourceType,
            source_url: sourceType === "url" ? sourceUrl.trim() : null,
            product_id: sourceType === "saved_product" || sourceType === "catalog_product" ? productId : null,
            expected_total: expectedTotal,
          }),
        });
      }
      setTitle("");
      setDescription("");
      setBudget("");
      setSourceUrl("");
      setProductId("");
      setFile(null);
      setSourceType("description");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your request could not be submitted.");
    } finally {
      setBusy(false);
    }
  }
  async function selectSourcingOption(requestId: string, optionId: string) {
    setOptionBusy(optionId);
    setError("");
    try {
      await apiRequest(`/members/requests/${requestId}/sourcing-option`, accessToken, {
        method: "POST",
        body: JSON.stringify({ option_id: optionId }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The option could not be selected.");
    } finally {
      setOptionBusy("");
    }
  }
  const [cancelling, setCancelling] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  /** The member cancels a request that isn't paid yet. Any unpaid invoice for it stops working. */
  async function cancelRequest(requestId: string) {
    setCancelBusy(true);
    setError("");
    try {
      await apiRequest(`/members/requests/${requestId}/cancel`, accessToken, {
        method: "POST",
        body: JSON.stringify({ reason: cancelReason.trim() || null }),
      });
      setCancelling("");
      setCancelReason("");
      setNotice("Your request was cancelled. Any unpaid invoice for it no longer works.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your request could not be cancelled.");
    } finally {
      setCancelBusy(false);
    }
  }
  /** "Your input is needed": the member answers here and sourcing carries on. */
  async function answerRequest(event: FormEvent, requestId: string) {
    event.preventDefault();
    const message = (answers[requestId] || "").trim();
    if (!message) return;
    setAnswerBusy(requestId);
    setError("");
    try {
      await apiRequest(`/members/requests/${requestId}/answer`, accessToken, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      setAnswers((current) => ({ ...current, [requestId]: "" }));
      setNotice("Thanks — your answer was sent. FayFort carries on sourcing.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your answer could not be sent.");
      await load();
    } finally {
      setAnswerBusy("");
    }
  }
  return (
    <section className="member-requests-panel" id="requests" aria-label="Purchasing and sourcing requests">
      <h2>Your requests</h2>
      <p>Track sourcing, warehouse receipt, shipping, and delivery progress. FayFort staff update each milestone.</p>
      <form className="member-product-filters member-request-create" onSubmit={submit}>
        <label>
          What are you looking for?
          <input
            aria-label="Request title"
            required
            maxLength={160}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Product or sourcing request"
          />
        </label>
        <fieldset className="member-request-source-options">
          <legend>How would you like to share it?</legend>
          {(
            [
              ["description", "Describe it"],
              ["saved_product", "Saved product"],
              ["catalog_product", "Site catalog"],
              ["url", "Product link"],
              ["image", "Screenshot"],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="request-source"
                value={value}
                checked={sourceType === value}
                onChange={() => {
                  setSourceType(value);
                  setFile(null);
                  setSourceUrl("");
                  setProductId("");
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {(sourceType === "saved_product" || sourceType === "catalog_product") && (
          <label>
            {sourceType === "saved_product" ? "Choose a saved product" : "Choose a catalog product"}
            <select
              aria-label={sourceType === "saved_product" ? "Saved product" : "Catalog product"}
              required
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              disabled={productsLoading}
            >
              <option value="">{productsLoading ? "Loading products…" : "Choose a product"}</option>
              {(sourceType === "saved_product" ? savedProducts : catalogProducts).map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
            {!productsLoading && sourceType === "saved_product" && savedProducts.length === 0 && (
              <small>You have no saved products yet. Choose Site catalog to browse all products.</small>
            )}
          </label>
        )}
        {sourceType === "url" && (
          <label>
            Product or social-media link
            <input
              type="url"
              aria-label="Product or social-media link"
              required
              maxLength={2000}
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://www.instagram.com/…"
            />
          </label>
        )}
        {sourceType === "image" && (
          <label>
            Product screenshot
            <input
              type="file"
              aria-label="Product screenshot"
              required
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <small>JPEG, PNG, or WebP · up to 10 MiB. Only FayFort request staff can view it.</small>
          </label>
        )}
        <fieldset className="member-recurring-controls">
          <legend>Purchase schedule</legend>
          <label className="member-recurring-toggle">
            <input
              aria-label="Make this a recurring purchase"
              type="checkbox"
              checked={recurring}
              onChange={(event) => setRecurring(event.target.checked)}
            />
            Make this a recurring purchase
          </label>
          {recurring && (
            <>
              <label>
                Repeat interval
                <select
                  aria-label="Repeat interval"
                  value={recurrence}
                  onChange={(event) => setRecurrence(event.target.value as typeof recurrence)}
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {recurrence === "custom" && (
                <div className="member-recurring-custom">
                  <label>
                    Every
                    <input
                      aria-label="Custom interval count"
                      type="number"
                      min={1}
                      max={365}
                      value={customInterval}
                      onChange={(event) =>
                        setCustomInterval(Math.max(1, Math.min(365, Number(event.target.value) || 1)))
                      }
                    />
                  </label>
                  <label>
                    Unit
                    <select
                      aria-label="Custom interval unit"
                      value={customUnit}
                      onChange={(event) => setCustomUnit(event.target.value as typeof customUnit)}
                    >
                      <option value="days">Days</option>
                      <option value="weeks">Weeks</option>
                      <option value="months">Months</option>
                    </select>
                  </label>
                </div>
              )}
              <label>
                Units per order
                <input
                  aria-label="Units per order"
                  type="number"
                  min={1}
                  max={10000}
                  value={unitsPerOrder}
                  onChange={(event) => setUnitsPerOrder(Math.max(1, Math.min(10000, Number(event.target.value) || 1)))}
                />
              </label>
              <label>
                Total cycles, including this request
                <input
                  aria-label="Total cycles"
                  type="number"
                  min={1}
                  max={12}
                  value={occurrences}
                  onChange={(event) => setOccurrences(Math.max(1, Math.min(12, Number(event.target.value) || 1)))}
                />
              </label>
              <p className="member-recurring-summary" aria-live="polite">
                Preview:{" "}
                {recurrence === "custom"
                  ? `Every ${customInterval} ${customUnit}`
                  : ({ monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" } as const)[recurrence]}{" "}
                · {unitsPerOrder} {unitsPerOrder === 1 ? "unit" : "units"} per order · {occurrences} total cycles
              </p>
              <label>
                Schedule time zone
                <select
                  aria-label="Schedule time zone"
                  required
                  value={timeZone}
                  onChange={(event) => setTimeZone(event.target.value)}
                >
                  <option value="">Choose a time zone</option>
                  {[
                    "UTC",
                    "America/Los_Angeles",
                    "America/Denver",
                    "America/Chicago",
                    "America/New_York",
                    "America/Toronto",
                    "Africa/Lagos",
                    "Africa/Cairo",
                    "Africa/Johannesburg",
                    "Europe/London",
                    "Europe/Paris",
                    "Asia/Dubai",
                    "Asia/Kolkata",
                    "Asia/Singapore",
                    "Asia/Manila",
                    "Asia/Seoul",
                    "Asia/Tokyo",
                    "America/Vancouver",
                    "America/Phoenix",
                    "America/Sao_Paulo",
                    "Australia/Sydney",
                    "Pacific/Auckland",
                  ].map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                First repeat date and time
                <input
                  aria-label="First repeat date and time"
                  type="datetime-local"
                  required
                  value={firstRepeatLocal}
                  onChange={(event) => setFirstRepeatLocal(event.target.value)}
                />
              </label>
              <p className="member-recurring-notice" role="status">
                Each cycle creates a sourcing request and needs a fresh quote. Quote selection does not trigger payment
                or purchase. No automatic order or charge.
              </p>
              <label className="member-recurring-toggle">
                <input
                  aria-label="Acknowledge recurring request terms"
                  type="checkbox"
                  checked={policyAcknowledged}
                  onChange={(event) => setPolicyAcknowledged(event.target.checked)}
                />
                I understand and approve these recurring request terms.
              </label>
              {pendingRecurringIntentId && (
                <p role="status">
                  The first request is saved. Finish activating its schedule below; retrying uses the same idempotency
                  key.
                </p>
              )}
            </>
          )}
        </fieldset>
        <label>
          Details (optional)
          <textarea
            aria-label="Request details"
            maxLength={2000}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Quantity, specifications, color, size, or destination"
          />
        </label>
        {!recurring && (
          <label>
            Expected budget in USD (optional)
            <input
              aria-label="Expected budget"
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="e.g. 300"
            />
            <small className="member-deposit-note">{depositNote(plan, expectedTotal)}</small>
          </label>
        )}
        <button
          className="primary-button"
          disabled={
            busy ||
            (productsLoading && (sourceType === "saved_product" || sourceType === "catalog_product")) ||
            !title.trim() ||
            (sourceType === "url" && !sourceUrl.trim()) ||
            ((sourceType === "saved_product" || sourceType === "catalog_product") && !productId) ||
            (sourceType === "image" && !file) ||
            (recurring && (!policyAcknowledged || !timeZone || !firstRepeatLocal))
          }
        >
          {busy ? "Saving…" : recurring ? "Create recurring request schedule" : "Submit request"}
        </button>
      </form>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="member-recurring-summary">
          {notice}
        </p>
      )}
      <MemberRecurringScheduleList accessToken={accessToken} />
      {requests.length === 0 ? (
        <p className="empty-copy">No requests yet.</p>
      ) : (
        <div className="member-request-list">
          {requests.map((request) => {
            const latest = request.events.at(-1);
            const stage = latest?.stage || "submitted";
            const progress = requestProgressIndex(stage);
            return (
              <article key={request.id} id={`request-${request.id}`} className="member-request-card">
                <div className="member-request-current">
                  <small>Current status</small>
                  <strong>{requestStageLabels[stage] || stage.replaceAll("_", " ")}</strong>
                  <p>
                    {latest
                      ? `Updated ${new Date(latest.created_at).toLocaleString()}`
                      : `Submitted ${new Date(request.created_at).toLocaleString()}`}
                  </p>
                </div>
                {stage !== "cancelled" && stage !== "delivered" && (
                  <div className="member-request-eta" aria-label={`Estimated delivery for ${request.request_title}`}>
                    {request.eta_at ? (
                      <>
                        <small>Estimated delivery</small>
                        <strong>
                          {new Date(request.eta_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                        </strong>
                        {request.eta_reason && <small>Updated: {request.eta_reason}</small>}
                      </>
                    ) : (
                      <small>We'll give you an estimated delivery date once we've reviewed your request (within 24 hours).</small>
                    )}
                  </div>
                )}
                <ol className="member-request-progress" aria-label={`Progress for ${request.request_title}`}>
                  {requestProgressStages.map((step, index) => (
                    <li
                      key={step}
                      className={index < progress ? "complete" : index === progress ? "current" : "upcoming"}
                      aria-current={index === progress ? "step" : undefined}
                    >
                      <span className="member-request-step-icon" aria-hidden="true">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d={requestStageIcons[step]} />
                        </svg>
                      </span>
                      <div>
                        <strong>{requestStageLabels[step]}</strong>
                        <small>{requestStageDescriptions[step]}</small>
                      </div>
                    </li>
                  ))}
                </ol>
                {stage === "needs_member_input" && (
                  <form
                    className="member-request-answer"
                    aria-label={`Answer FayFort about ${request.request_title}`}
                    onSubmit={(event) => void answerRequest(event, request.id)}
                  >
                    <strong>FayFort needs a detail from you</strong>
                    {latest?.member_note && <p className="member-request-question">“{latest.member_note}”</p>}
                    <label>
                      Your answer
                      <textarea
                        aria-label="Your answer"
                        required
                        maxLength={2000}
                        rows={3}
                        value={answers[request.id] || ""}
                        onChange={(event) => setAnswers((current) => ({ ...current, [request.id]: event.target.value }))}
                        placeholder="Size, colour, quantity, budget…"
                      />
                    </label>
                    <button className="primary-button" disabled={answerBusy === request.id || !(answers[request.id] || "").trim()}>
                      {answerBusy === request.id ? "Sending…" : "Send answer"}
                    </button>
                  </form>
                )}
                {CANCELLABLE.includes(stage) &&
                  (cancelling === request.id ? (
                    <div className="member-request-cancel" role="group" aria-label={`Cancel ${request.request_title}`}>
                      <strong>Cancel this request?</strong>
                      <p>We'll stop sourcing it. Any invoice you haven't paid yet stops working. This can't be undone.</p>
                      <label>
                        Reason (optional)
                        <input
                          maxLength={500}
                          value={cancelReason}
                          onChange={(event) => setCancelReason(event.target.value)}
                          placeholder="For example: I found it elsewhere"
                        />
                      </label>
                      <div className="member-request-cancel-actions">
                        <button type="button" className="danger-button" disabled={cancelBusy} onClick={() => void cancelRequest(request.id)}>
                          {cancelBusy ? "Cancelling…" : "Yes, cancel request"}
                        </button>
                        <button type="button" className="secondary-button" disabled={cancelBusy} onClick={() => setCancelling("")}>
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="link-danger"
                      onClick={() => {
                        setCancelling(request.id);
                        setCancelReason("");
                      }}
                    >
                      Cancel request
                    </button>
                  ))}
                {stage === "purchase_confirmed" && (
                  <p className="member-request-paid-note">
                    Payment is confirmed. The next request milestone will show warehouse receipt.
                  </p>
                )}
                <h3>{request.request_title}</h3>
                <RequestSourceSummary
                  sourceType={request.source_type}
                  sourceUrl={request.source_url}
                  sourceMedia={request.source_media}
                  productName={request.product_name_snapshot}
                />
                {request.request_description && <p>{request.request_description}</p>}
                {Boolean(request.sourcing_options?.length) && (
                  <section className="member-sourcing-options" aria-label="Sourcing options">
                    <h4>Options from FayFort</h4>
                    <p>
                      Review the available products and select the one you prefer. Selection does not confirm a purchase
                      or payment.
                    </p>
                    <div>
                      {request.sourcing_options!.map((option) => (
                        <article
                          key={option.id}
                          className={
                            option.status === "selected"
                              ? "member-sourcing-option is-selected"
                              : "member-sourcing-option"
                          }
                        >
                          <div>
                            <strong>{option.product_name}</strong>
                            {option.status === "selected" && (
                              <span className="member-option-selected">Your selection</span>
                            )}
                          </div>
                          <p>
                            <a href={option.product_url} target="_blank" rel="noreferrer">
                              View product
                            </a>
                            {option.price_amount !== null && (
                              <>
                                {" "}
                                · {Number(option.price_amount).toFixed(2)} {option.currency || ""}
                              </>
                            )}
                            {option.availability && <> · {option.availability}</>}
                          </p>
                          {option.member_note && <p>{option.member_note}</p>}
                          {option.status !== "selected" && (
                            <button
                              className="secondary-button"
                              type="button"
                              disabled={Boolean(optionBusy)}
                              onClick={() => void selectSourcingOption(request.id, option.id)}
                            >
                              {optionBusy === option.id ? "Saving…" : "Choose this option"}
                            </button>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                )}
                <ol className="member-request-timeline" aria-label={`Update history for ${request.request_title}`}>
                  {request.events.map((item) => (
                    <li key={item.id}>
                      <strong>{requestStageLabels[item.stage] || item.stage.replaceAll("_", " ")}</strong>
                      {item.member_note && <p>{item.member_note}</p>}
                      {item.stage === "shipped" && item.details?.tracking_number && (
                        <p className="member-shipment-details">
                          Tracking number: <strong>{item.details.tracking_number}</strong>
                          {item.details.carrier_name && <> · {item.details.carrier_name}</>}
                          {item.details.tracking_url && (
                            <>
                              {" "}
                              ·{" "}
                              <a href={item.details.tracking_url} target="_blank" rel="noreferrer">
                                Track shipment with carrier
                              </a>
                            </>
                          )}
                        </p>
                      )}
                      {item.media?.map((media) => (
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
                      <time>{new Date(item.created_at).toLocaleString()}</time>
                    </li>
                  ))}
                </ol>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
