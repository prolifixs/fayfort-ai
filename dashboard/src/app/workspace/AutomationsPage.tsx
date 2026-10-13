import { apiRequest } from "../../lib/api";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Automation, AutomationRun } from "./types";

export function AutomationsPage({ accessToken, businessId }: { accessToken: string; businessId: string }) {
  const [items, setItems] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("manual_test");
  const [actionType, setActionType] = useState("record_test_run");
  const [responseText, setResponseText] = useState("");
  const [intervalHours, setIntervalHours] = useState(1);
  const [intentCondition, setIntentCondition] = useState("");
  const [languageCondition, setLanguageCondition] = useState("");
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<Record<string, AutomationRun[]>>({});
  const [runsFor, setRunsFor] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<{ automations: Automation[] }>(
        "/businesses/" + businessId + "/automations",
        accessToken,
      );
      setItems(data.automations);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Automations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, businessId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const conditions =
        trigger === "conversation_inbound"
          ? {
              ...(intentCondition ? { intent: intentCondition } : {}),
              ...(languageCondition ? { language: languageCondition } : {}),
            }
          : {};
      const body = {
        name,
        trigger_type: trigger,
        action_type: actionType,
        conditions,
        ...(actionType === "send_approved_reply" ? { response_text: responseText } : {}),
        schedule_interval_seconds: trigger === "scheduled_interval" ? intervalHours * 3600 : null,
      };
      await apiRequest("/businesses/" + businessId + "/automations", accessToken, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setName("");
      setIntentCondition("");
      setLanguageCondition("");
      setResponseText("");
      setActionType("record_test_run");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Automation could not be created.");
    } finally {
      setBusy(false);
    }
  }
  async function action(item: Automation, actionName: string) {
    setBusy(true);
    try {
      if (actionName === "enable" || actionName === "disable")
        await apiRequest("/businesses/" + businessId + "/automations/" + item.id, accessToken, {
          method: "PATCH",
          body: JSON.stringify({ enabled: actionName === "enable" }),
        });
      else
        await apiRequest("/businesses/" + businessId + "/automations/" + item.id + "/" + actionName, accessToken, {
          method: "POST",
          body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
        });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Automation action failed.");
    } finally {
      setBusy(false);
    }
  }
  async function showRuns(item: Automation) {
    setRunsFor(item.id);
    setError("");
    try {
      const data = await apiRequest<{ executions: AutomationRun[] }>(
        "/businesses/" + businessId + "/automations/" + item.id + "/executions",
        accessToken,
      );
      setRuns((current) => ({ ...current, [item.id]: data.executions }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Automation history could not be loaded.");
    }
  }
  return (
    <section className="control-panel" aria-label="Automation management">
      <div className="panel-heading">
        <div>
          <h2>Automation rules</h2>
          <p>
            Rules start disabled. Test rules only record runs. Approved replies are sent only for inbound Instagram
            messages when both the rule and the connection’s auto-reply setting are enabled.
          </p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form className="inline-form" onSubmit={create}>
        <label>
          Automation name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Inbound smoke check"
          />
        </label>
        <label>
          Trigger
          <select
            aria-label="Automation trigger"
            value={trigger}
            onChange={(e) => {
              setTrigger(e.target.value);
              setActionType("record_test_run");
            }}
          >
            <option value="manual_test">Manual test</option>
            <option value="conversation_inbound">New inbound conversation message</option>
            <option value="scheduled_interval">Scheduled interval</option>
          </select>
        </label>
        {trigger === "conversation_inbound" && (
          <>
            <label>
              Action
              <select aria-label="Automation action" value={actionType} onChange={(e) => setActionType(e.target.value)}>
                <option value="record_test_run">Record test run only</option>
                <option value="send_approved_reply">Send approved static reply</option>
              </select>
            </label>
            {actionType === "send_approved_reply" && (
              <label>
                Approved reply text
                <textarea
                  required
                  maxLength={1000}
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder="Write the exact reply to send for matching inbound messages."
                />
              </label>
            )}
            <label>
              Intent filter
              <select
                aria-label="Automation intent filter"
                value={intentCondition}
                onChange={(e) => setIntentCondition(e.target.value)}
              >
                <option value="">Any intent</option>
                {[
                  "product_sourcing",
                  "product_pricing",
                  "supplier_search",
                  "shipping",
                  "shipping_quote",
                  "order_status",
                  "quotation",
                  "payment",
                  "invoice",
                  "business_consultation",
                  "canton_fair",
                  "general_information",
                  "greeting",
                  "complaint",
                  "follow_up",
                  "human_handoff",
                  "unknown",
                ].map((intent) => (
                  <option key={intent} value={intent}>
                    {intent.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Language filter
              <input
                aria-label="Automation language filter"
                maxLength={35}
                value={languageCondition}
                onChange={(e) => setLanguageCondition(e.target.value)}
                placeholder="Any language (e.g. en or zh-Hant)"
              />
            </label>
          </>
        )}
        {trigger === "scheduled_interval" && (
          <label>
            Repeat every (hours)
            <input
              aria-label="Schedule interval in hours"
              type="number"
              min={1}
              max={168}
              step={1}
              value={intervalHours}
              onChange={(e) => setIntervalHours(Number(e.target.value))}
            />
          </label>
        )}
        <button className="primary-button" disabled={busy}>
          {actionType === "send_approved_reply" ? "Create disabled reply rule" : "Create disabled test rule"}
        </button>
      </form>
      {loading ? (
        <p>Loading automations…</p>
      ) : items.length === 0 ? (
        <p className="empty-copy">No automations yet. New rules start disabled.</p>
      ) : (
        <div className="record-list">
          {items.map((item) => (
            <div className="record" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <small>
                  {item.trigger_type} · {item.action_type} · {item.enabled ? "enabled" : "disabled"}
                </small>
                {item.action_type === "send_approved_reply" && (
                  <small>Approved text: {item.action_config?.response_text || "Not available"}</small>
                )}
                {item.trigger_type === "scheduled_interval" && item.enabled && item.schedule_next_run_at && (
                  <small>Next run: {new Date(item.schedule_next_run_at).toLocaleString()}</small>
                )}
                {item.schedule_last_error_code && (
                  <small>Retrying after a scheduler error (attempt {item.schedule_attempts || 1}).</small>
                )}
              </div>
              <div className="record-actions">
                {item.enabled ? (
                  <button disabled={busy} onClick={() => void action(item, "disable")}>
                    Disable
                  </button>
                ) : (
                  <button disabled={busy} onClick={() => void action(item, "enable")}>
                    Enable
                  </button>
                )}
                <button disabled={busy} onClick={() => void action(item, "dry-run")}>
                  Dry run
                </button>
                {item.enabled && item.trigger_type === "manual_test" && (
                  <button disabled={busy} onClick={() => void action(item, "execute")}>
                    Execute test
                  </button>
                )}
                <button disabled={busy} onClick={() => void showRuns(item)}>
                  View runs
                </button>
              </div>
              {runsFor === item.id && (
                <div className="record-list">
                  {(runs[item.id] || []).length === 0 ? (
                    <small>No executions recorded yet.</small>
                  ) : (
                    (runs[item.id] || []).map((run) => (
                      <small key={run.id}>
                        {run.status}
                        {run.error_code ? " - " + String(run.error_code).replaceAll("_", " ") : ""} -{" "}
                        {new Date(run.created_at).toLocaleString()}
                      </small>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="quiet-note">
        A reply rule cannot run from the manual test or schedule controls. Instagram must also have auto-replies
        explicitly enabled. Keep both off until the rule is reviewed.
      </p>
    </section>
  );
}
