import { FormEvent, useCallback, useEffect, useState } from "react";
import { ApiRequestError, apiRequest } from "../../lib/api";
import { supabaseClient } from "../../lib/supabase";
import {
  type Department,
  type WorkItem,
  type WorkNote,
  type MentionWorker,
  type ChecklistItem,
  type RequestContext,
  type SourcingCandidate,
  type SourcingBatch,
  type MemberConversationContext,
  type BusinessConversationContext,
  type HandoffContext,
  type DisputeCase,
  type SourceContext,
  type FlowContext,
  type RequestPayments,
  type WorkEvent,
  type WorkforceWorker,
  type Workforce,
  type AutomationHealth,
  type OperationsReport,
  departments,
  fulfillmentNextStages,
} from "./types";

/** Explains what happened to a staff reply on a business conversation after it was saved. */
export function businessReplyNotice(status: string, errorCode?: string | null): string {
  if (status === "sent") return "Reply sent to the customer.";
  if (status === "recorded_not_delivered")
    return "Reply saved to the conversation. This channel has no provider delivery, so nothing was sent to the customer.";
  if (errorCode === "outbound_disabled")
    return "Reply saved but not sent: outbound delivery is turned off for this connection.";
  if (errorCode === "response_window_expired")
    return "Reply saved but not sent: Messenger only allows replies within 24 hours of the customer's last message.";
  if (errorCode === "connection_unavailable")
    return "Reply saved but not sent: the channel connection is not available.";
  if (status === "unknown")
    return "Reply saved, but delivery could not be confirmed. Check the delivery record before sending again.";
  return `Reply saved. Delivery status: ${status.replaceAll("_", " ")}${errorCode ? ` (${errorCode.replaceAll("_", " ")})` : ""}.`;
}

export function useOperationsCenter() {
  const [token, setToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [departmentsForUser, setDepartmentsForUser] = useState<Department[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [userId, setUserId] = useState("");
  const [scope, setScope] = useState<"mine" | "available" | "all">("mine");
  const [filterDepartment, setFilterDepartment] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [items, setItems] = useState<WorkItem[]>([]);
  const [listView, setListView] = useState<"active" | "archive">("active");
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveDays, setArchiveDays] = useState<30 | 90 | 0>(30);
  const [requestEta, setRequestEta] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [flowContext, setFlowContext] = useState<FlowContext | null>(null);
  const [payments, setPayments] = useState<RequestPayments | null>(null);
  const [requestStage, setRequestStage] = useState("");
  const [requestStageNote, setRequestStageNote] = useState("");
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [notes, setNotes] = useState<WorkNote[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [workEvents, setWorkEvents] = useState<WorkEvent[]>([]);
  const [requestContext, setRequestContext] = useState<RequestContext | null>(null);
  const [disputeCase, setDisputeCase] = useState<DisputeCase | null>(null);
  const [memberConversationContext, setMemberConversationContext] = useState<MemberConversationContext | null>(null);
  const [businessConversationContext, setBusinessConversationContext] = useState<BusinessConversationContext | null>(
    null,
  );
  const [handoffContext, setHandoffContext] = useState<HandoffContext | null>(null);
  const [mentionWorkers, setMentionWorkers] = useState<MentionWorker[]>([]);
  const [mentionOptionsError, setMentionOptionsError] = useState("");
  const [workforce, setWorkforce] = useState<Workforce | null>(null);
  const [workforceError, setWorkforceError] = useState("");
  const [automationHealth, setAutomationHealth] = useState<AutomationHealth | null>(null);
  const [automationHealthError, setAutomationHealthError] = useState("");
  const [automationDialogOpen, setAutomationDialogOpen] = useState(false);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [report, setReport] = useState<OperationsReport | null>(null);
  const [reportDays, setReportDays] = useState<7 | 30 | 90>(30);
  const [reportError, setReportError] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportReload, setReportReload] = useState(0);
  const [departmentDrafts, setDepartmentDrafts] = useState<Record<string, Department[]>>({});
  const [sourcingBatches, setSourcingBatches] = useState<SourcingBatch[]>([]);
  const [batchTitle, setBatchTitle] = useState("");
  const [batchWorkIds, setBatchWorkIds] = useState<string[]>([]);
  const [sourcingCandidates, setSourcingCandidates] = useState<SourcingCandidate[]>([]);
  const [candidateLoadError, setCandidateLoadError] = useState("");
  const [candidateEditingId, setCandidateEditingId] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState("");
  const [candidateSupplier, setCandidateSupplier] = useState("");
  const [candidateUrl, setCandidateUrl] = useState("");
  const [candidatePrice, setCandidatePrice] = useState("");
  const [candidateCurrency, setCandidateCurrency] = useState("USD");
  const [candidateAvailability, setCandidateAvailability] = useState("");
  const [candidateEvidence, setCandidateEvidence] = useState("");
  const [shareCandidateIds, setShareCandidateIds] = useState<string[]>([]);
  const [memberOptionNote, setMemberOptionNote] = useState("");
  const [note, setNote] = useState("");
  const [checkTitle, setCheckTitle] = useState("");
  const [memberReply, setMemberReply] = useState("");
  const [businessReply, setBusinessReply] = useState("");
  const [action, setAction] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [waitingOn, setWaitingOn] = useState("member");
  const [waitingReason, setWaitingReason] = useState("");
  const [transferDepartment, setTransferDepartment] = useState<Department>("sourcing");
  const [transferReason, setTransferReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [processingDueSchedules, setProcessingDueSchedules] = useState(false);
  const [fulfillmentStage, setFulfillmentStage] = useState("");
  const [fulfillmentNote, setFulfillmentNote] = useState("");
  const [shipment, setShipment] = useState({ carrier: "", number: "", url: "" });
  const [warehouseEvidence, setWarehouseEvidence] = useState<File | null>(null);
  const [disputeCategory, setDisputeCategory] = useState("other");
  const [disputeSummary, setDisputeSummary] = useState("");
  const [disputeNextAction, setDisputeNextAction] = useState(
    "Investigate the member's concern and record the next action.",
  );
  const [disputeDueAt, setDisputeDueAt] = useState("");
  const [disputeStatus, setDisputeStatus] = useState("investigating");
  const [disputeResolution, setDisputeResolution] = useState("");
  useEffect(() => {
    let alive = true;
    const client = supabaseClient;
    if (!client) {
      setAuthLoading(false);
      setError("FayFort sign-in is not configured on this site.");
      return;
    }
    client.auth.getSession().then(({ data }) => {
      if (alive) {
        setToken(data.session?.access_token || null);
        setAuthLoading(false);
      }
    });
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (alive) setToken(session?.access_token || null);
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadItems = useCallback(
    async (accessToken: string) => {
      const query = new URLSearchParams({ scope, view: listView });
      if (filterDepartment) query.set("department", filterDepartment);
      if (filterStatus && listView === "active") query.set("status", filterStatus);
      if (listView === "archive") {
        query.set("days", String(archiveDays));
        if (archiveQuery.trim()) query.set("q", archiveQuery.trim());
      }
      const result = await apiRequest<{ work_items: WorkItem[]; has_more?: boolean }>(
        `/operations/work-items?${query}`,
        accessToken,
      );
      setItems(result.work_items || []);
      setHasMore(Boolean(result.has_more));
      setSelected((current) => (result.work_items || []).find((item) => item.id === current?.id) || null);
    },
    [scope, filterDepartment, filterStatus, listView, archiveDays, archiveQuery],
  );
  const loadDetails = useCallback(
    async (accessToken: string, item: WorkItem) => {
      setRequestContext(null);
      setMemberConversationContext(null);
      setBusinessConversationContext(null);
      setHandoffContext(null);
      setFlowContext(null);
      setPayments(null);
      setWorkEvents([]);
      const [noteRows, checkRows, eventRows] = await Promise.all([
        apiRequest<{ notes: WorkNote[] }>(`/operations/work-items/${item.id}/notes`, accessToken),
        apiRequest<{ items: ChecklistItem[] }>(`/operations/work-items/${item.id}/checklist`, accessToken),
        apiRequest<{ events: WorkEvent[] }>(`/operations/work-items/${item.id}/events`, accessToken),
      ]);
      let mentionRows: { workers: MentionWorker[] } = { workers: [] };
      setMentionOptionsError("");
      try {
        mentionRows = await apiRequest<{ workers: MentionWorker[] }>(
          `/operations/work-items/${item.id}/mention-options`,
          accessToken,
        );
      } catch (reason) {
        setMentionOptionsError(reason instanceof Error ? reason.message : "Coworker suggestions are unavailable.");
      }
      let sourceContext: SourceContext | null = null;
      if (
        item.member_request_id ||
        item.work_type === "dispute_case" ||
        (item.member_conversation_id && (canManage || item.assigned_worker_id === userId)) ||
        item.handoff_id ||
        item.metadata?.source_kind
      ) {
        sourceContext = await apiRequest<SourceContext>(
          `/operations/work-items/${item.id}/source-context`,
          accessToken,
        );
      }
      let candidateRows: { candidates: SourcingCandidate[] } = { candidates: [] };
      let candidateError = "";
      if (item.department === "sourcing" && item.member_request_id) {
        try {
          candidateRows = await apiRequest<{ candidates: SourcingCandidate[] }>(
            `/operations/work-items/${item.id}/sourcing-candidates`,
            accessToken,
          );
        } catch (reason) {
          candidateError = reason instanceof Error ? reason.message : "Research candidate storage is not available.";
        }
      }
      let paymentRows: RequestPayments | null = null;
      if (item.member_request_id && item.department === "sourcing") {
        try {
          paymentRows = await apiRequest<RequestPayments>(`/operations/work-items/${item.id}/payments`, accessToken);
        } catch {
          paymentRows = null;
        }
      }
      const conversation = sourceContext?.conversation;
      const req = sourceContext?.request || null;
      const caseRow = sourceContext?.dispute_case || null;
      setNotes(noteRows.notes || []);
      setChecklist(checkRows.items || []);
      setWorkEvents(eventRows.events || []);
      setMentionWorkers(mentionRows.workers || []);
      setRequestContext(req);
      setDisputeCase(caseRow);
      setDisputeStatus(caseRow?.status || "investigating");
      setDisputeResolution(caseRow?.resolution || "");
      const currentStage = req?.events.at(-1)?.stage || "";
      setFulfillmentStage((fulfillmentNextStages[currentStage] || [])[0] || "");
      setFulfillmentNote("");
      setShipment({ carrier: "", number: "", url: "" });
      setWarehouseEvidence(null);
      setSourcingCandidates(candidateRows.candidates || []);
      setCandidateLoadError(candidateError);
      setMemberConversationContext(conversation && "title" in conversation ? conversation : null);
      setBusinessConversationContext(conversation && "business_id" in conversation ? conversation : null);
      setHandoffContext(sourceContext?.handoff || null);
      setFlowContext(sourceContext?.flow || null);
      setPayments(paymentRows);
      setRequestStage("");
      setRequestStageNote("");
      setAction(item.status);
      setNextAction(item.next_action);
      setWaitingOn(item.waiting_on || "member");
      setWaitingReason(item.waiting_reason || "");
      setTransferDepartment(
        (canManage ? departments : departmentsForUser).find((department) => department !== item.department) ||
          item.department,
      );
      setTransferReason("");
    },
    [canManage, departmentsForUser, userId],
  );
  const refresh = useCallback(
    async (accessToken: string) => {
      setError("");
      try {
        const me = await apiRequest<{ user_id: string; departments: Department[]; can_manage: boolean }>(
          "/operations/me/departments",
          accessToken,
        );
        setUserId(me.user_id);
        setDepartmentsForUser(me.departments || []);
        setCanManage(me.can_manage);
        setIdentityLoaded(true);
        await loadItems(accessToken);
        if (me.can_manage || (me.departments || []).includes("sourcing")) {
          try {
            const batches = await apiRequest<{ batches: SourcingBatch[] }>("/operations/sourcing/batches", accessToken);
            setSourcingBatches(batches.batches || []);
          } catch {
            setSourcingBatches([]);
          }
        } else setSourcingBatches([]);
        if (me.can_manage) {
          try {
            const roster = await apiRequest<Workforce>("/operations/workforce", accessToken);
            setWorkforce(roster);
            setDepartmentDrafts(
              Object.fromEntries(roster.workers.map((worker) => [worker.user_id, worker.departments])),
            );
            setWorkforceError("");
          } catch (reason) {
            setWorkforce(null);
            setWorkforceError(reason instanceof Error ? reason.message : "Workforce presence is not yet available.");
          }
          try {
            setAutomationHealth(await apiRequest<AutomationHealth>("/operations/automation-health", accessToken));
            setAutomationHealthError("");
          } catch (reason) {
            setAutomationHealth(null);
            setAutomationHealthError(
              reason instanceof Error ? reason.message : "Automation health is not yet available.",
            );
          }
        } else {
          setWorkforce(null);
          setWorkforceError("");
          setAutomationHealth(null);
          setAutomationHealthError("");
        }
      } catch (reason) {
        setError(
          reason instanceof ApiRequestError && reason.status === 403
            ? "Operations Center access requires an active FayFort worker or platform administrator."
            : reason instanceof Error
              ? reason.message
              : "The operations queue could not be loaded.",
        );
      }
    },
    [loadItems],
  );
  async function processDueSchedules() {
    if (!token || !canManage) return;
    setProcessingDueSchedules(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ created_requests: number; orders_created: number; charges_created: number }>(
        "/platform/recurring-schedules/process-due",
        token,
        { method: "POST" },
      );
      setNotice(
        `Recurring schedules processed: ${result.created_requests} request(s) created. ${result.orders_created} orders and ${result.charges_created} charges created.`,
      );
      await refresh(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Due recurring requests could not be processed.");
    } finally {
      setProcessingDueSchedules(false);
    }
  }
  useEffect(() => {
    if (token) void refresh(token);
    else if (!authLoading) setError("Sign in with your FayFort worker account to open Operations Center.");
  }, [token, authLoading, refresh]);
  useEffect(() => {
    let alive = true;
    if (!token || !canManage) return;
    setReportLoading(true);
    setReportError("");
    apiRequest<OperationsReport>(`/operations/reports?days=${reportDays}`, token)
      .then((value) => {
        if (alive) setReport(value);
      })
      .catch((reason) => {
        if (alive) {
          setReport(null);
          setReportError(reason instanceof Error ? reason.message : "Operations report could not be loaded.");
        }
      })
      .finally(() => {
        if (alive) setReportLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, canManage, reportDays, reportReload]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("workItem");
    if (id) {
      const item = items.find((candidate) => candidate.id === id);
      if (item) setSelected(item);
    }
    if (params.has("automationRun")) setAutomationDialogOpen(true);
  }, [items]);
  useEffect(() => {
    let current = true;
    if (token && selected)
      void loadDetails(token, selected).catch((reason) => {
        if (current) setError(reason instanceof Error ? reason.message : "Work details could not be loaded.");
      });
    else {
      setNotes([]);
      setChecklist([]);
      setWorkEvents([]);
      setRequestContext(null);
      setDisputeCase(null);
      setMemberConversationContext(null);
      setBusinessConversationContext(null);
      setHandoffContext(null);
      setFlowContext(null);
      setPayments(null);
    }
    return () => {
      current = false;
    };
  }, [token, selected?.id, selected?.assigned_worker_id, loadDetails]);
  useEffect(() => {
    if (!token || !identityLoaded || canManage) return;
    let alive = true;
    const heartbeat = () => {
      void apiRequest("/operations/presence", token, { method: "POST" }).catch(() => undefined);
    };
    heartbeat();
    const timer = window.setInterval(() => {
      if (alive) heartbeat();
    }, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [token, identityLoaded, canManage]);
  useEffect(() => {
    if (!automationDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAutomationDialogOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [automationDialogOpen]);

  async function run(actionFn: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await actionFn();
      setNotice(success);
      if (token) await refresh(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The operation could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function claim(item: WorkItem) {
    if (!token) return;
    await run(async () => {
      await apiRequest(`/operations/work-items/${item.id}/claim`, token, { method: "POST" });
    }, "Work claimed for 15 minutes.");
  }
  async function saveStatus(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected) return;
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          expected_version: selected.version,
          status: action,
          next_action: nextAction,
          waiting_on: action === "waiting" ? waitingOn : null,
          waiting_reason: action === "waiting" ? waitingReason : null,
          due_at: selected.due_at,
          reason: waitingReason || null,
        }),
      });
    }, "Work status saved.");
  }
  async function sendMemberReply(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected || !memberReply.trim()) return;
    const content = memberReply.trim();
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/member-reply`, token, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setMemberReply("");
    }, "Reply sent. The conversation is waiting for the member.");
  }
  async function sendBusinessReply(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected || !businessReply.trim()) return;
    const content = businessReply.trim();
    let outcome: { delivery_status?: string | null; delivery_error_code?: string | null } = {};
    await run(async () => {
      outcome = await apiRequest<{ delivery_status: string; delivery_error_code?: string | null }>(
        `/operations/work-items/${selected.id}/business-reply`,
        token,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      setBusinessReply("");
    }, "Business reply saved.");
    if (outcome.delivery_status) setNotice(businessReplyNotice(outcome.delivery_status, outcome.delivery_error_code));
  }
  async function returnToAutomation() {
    if (!token || !selected) return;
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/return-to-automation`, token, { method: "POST" });
    }, "Handoff returned to automation and closed in staff work.");
  }
  async function transfer(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected) return;
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/transfer`, token, {
        method: "POST",
        body: JSON.stringify({
          expected_version: selected.version,
          department: transferDepartment,
          next_action: nextAction,
          reason: transferReason,
        }),
      });
    }, "Work transferred with its audit reason.");
  }
  async function createDispute(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected || !requestContext || !disputeSummary.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ dispute_case: DisputeCase; work_item: WorkItem }>(
        `/operations/work-items/${selected.id}/dispute-cases`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            category: disputeCategory,
            summary: disputeSummary.trim(),
            next_action: disputeNextAction.trim(),
            due_at: disputeDueAt ? new Date(disputeDueAt).toISOString() : null,
          }),
        },
      );
      setDisputeSummary("");
      setFilterStatus("");
      setScope(canManage ? "all" : "available");
      setFilterDepartment("disputes");
      setItems((current) => [result.work_item, ...current.filter((item) => item.id !== result.work_item.id)]);
      setSelected(result.work_item);
      setNotice("Separate dispute case opened in the Disputes queue. The request timeline is unchanged.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The dispute case could not be opened.");
    } finally {
      setBusy(false);
    }
  }
  async function updateDispute(event: FormEvent) {
    event.preventDefault();
    if (!token || !disputeCase) return;
    if (["resolved", "closed"].includes(disputeStatus) && !disputeResolution.trim()) {
      setError("Add a resolution before resolving or closing the case.");
      return;
    }
    await run(async () => {
      await apiRequest(`/operations/dispute-cases/${disputeCase.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          expected_version: disputeCase.version,
          status: disputeStatus,
          resolution: disputeResolution.trim() || null,
        }),
      });
      if (selected) await loadDetails(token, selected);
    }, "Dispute case updated and audited.");
  }
  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected) return;
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/notes`, token, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      setNote("");
    }, "Internal note added. Mentioned active coworkers will be notified.");
  }
  const mentionMatch = note.match(/@([^\s@]*)$/);
  const mentionQuery = mentionMatch?.[1]?.toLowerCase();
  const mentionSuggestions = mentionMatch
    ? mentionWorkers
        .filter(
          (worker) =>
            worker.email.includes(mentionQuery || "") || worker.label.toLowerCase().includes(mentionQuery || ""),
        )
        .slice(0, 6)
    : [];
  function insertMention(worker: MentionWorker) {
    if (!mentionMatch) return;
    setNote((current) => current.replace(/@([^\s@]*)$/, `@${worker.email} `));
  }
  function editSourcingCandidate(candidate: SourcingCandidate) {
    setCandidateEditingId(candidate.id);
    setCandidateName(candidate.product_name);
    setCandidateSupplier(candidate.supplier_name || "");
    setCandidateUrl(candidate.product_url);
    setCandidatePrice(candidate.price_amount === null ? "" : String(candidate.price_amount));
    setCandidateCurrency(candidate.currency || "USD");
    setCandidateAvailability(candidate.availability || "");
    setCandidateEvidence(candidate.evidence_note);
  }
  async function addSourcingCandidate(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected) return;
    await run(
      async () => {
        const payload = {
          product_name: candidateName,
          supplier_name: candidateSupplier || null,
          product_url: candidateUrl,
          price_amount: candidatePrice ? Number(candidatePrice) : null,
          currency: candidatePrice ? candidateCurrency : null,
          availability: candidateAvailability || null,
          evidence_note: candidateEvidence,
        };
        const editingId = candidateEditingId;
        const result = await apiRequest<{ candidate: SourcingCandidate }>(
          editingId
            ? `/operations/work-items/${selected.id}/sourcing-candidates/${editingId}`
            : `/operations/work-items/${selected.id}/sourcing-candidates`,
          token,
          { method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload) },
        );
        if (result.candidate)
          setSourcingCandidates((current) =>
            editingId
              ? current.map((candidate) => (candidate.id === editingId ? result.candidate : candidate))
              : [result.candidate, ...current],
          );
        setCandidateEditingId(null);
        setCandidateName("");
        setCandidateSupplier("");
        setCandidateUrl("");
        setCandidatePrice("");
        setCandidateCurrency("USD");
        setCandidateAvailability("");
        setCandidateEvidence("");
      },
      candidateEditingId
        ? "Research candidate updated. Re-share it to send the revised quote."
        : "Research candidate recorded for this request.",
    );
  }
  async function saveFulfillmentMilestone(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected?.member_request_id || !fulfillmentStage) return;
    if (fulfillmentStage === "shipped" && !shipment.number.trim()) {
      setError("A tracking number is required before shipping.");
      return;
    }
    const stage = fulfillmentStage;
    await run(async () => {
      await apiRequest(`/workers/requests/${selected.member_request_id}/events`, token, {
        method: "POST",
        body: JSON.stringify({
          stage,
          member_note: fulfillmentNote.trim() || null,
          ...(stage === "shipped"
            ? {
                carrier_name: shipment.carrier || null,
                tracking_number: shipment.number,
                tracking_url: shipment.url || null,
              }
            : {}),
        }),
      });
      setFulfillmentNote("");
      setShipment({ carrier: "", number: "", url: "" });
      setFulfillmentStage("");
      await loadDetails(token, selected);
    }, "Member request milestone recorded.");
  }
  async function uploadWarehouseEvidence() {
    if (!token || !selected?.member_request_id || !warehouseEvidence) return;
    const file = warehouseEvidence;
    await run(async () => {
      if (file.size > 100 * 1024 * 1024) throw new Error("Evidence files must be 100 MiB or smaller.");
      await apiRequest(
        `/workers/requests/${selected.member_request_id}/evidence?filename=${encodeURIComponent(file.name)}`,
        token,
        { method: "POST", body: file, headers: { "Content-Type": file.type } },
      );
      setWarehouseEvidence(null);
      await loadDetails(token, selected);
    }, "Warehouse evidence uploaded.");
  }
  async function shareSourcingOptions(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected || shareCandidateIds.length === 0) return;
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/sourcing-options`, token, {
        method: "POST",
        body: JSON.stringify({ candidate_ids: shareCandidateIds, member_note: memberOptionNote.trim() || null }),
      });
      setShareCandidateIds([]);
      setMemberOptionNote("");
      await loadDetails(token, selected);
    }, "Selected product options shared with the member; request timeline updated.");
  }
  async function createSourcingBatch(event: FormEvent) {
    event.preventDefault();
    if (!token || !batchTitle.trim() || !batchWorkIds.length) return;
    await run(async () => {
      await apiRequest("/operations/sourcing/batches", token, {
        method: "POST",
        body: JSON.stringify({ title: batchTitle.trim(), work_item_ids: batchWorkIds }),
      });
      setBatchTitle("");
      setBatchWorkIds([]);
    }, "Sourcing batch created. Each request keeps its individual owner and progress.");
  }
  async function addChecklist(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected) return;
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/checklist`, token, {
        method: "POST",
        body: JSON.stringify({ title: checkTitle, position: checklist.length }),
      });
      setCheckTitle("");
    }, "Checklist item added.");
  }
  async function toggleChecklist(item: ChecklistItem) {
    if (!token || !selected) return;
    await run(async () => {
      await apiRequest(
        `/operations/work-items/${selected.id}/checklist/${item.id}?completed=${item.completed_at ? "false" : "true"}`,
        token,
        { method: "PATCH" },
      );
    }, "Checklist updated.");
  }
  /** Sourcing stages staff move by hand (under review, sourcing, needs member input, cancelled). */
  async function recordRequestStage(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected?.member_request_id || !requestStage) return;
    const stage = requestStage;
    if (stage === "needs_member_input" && !requestStageNote.trim()) {
      setError("Write the question for the member. They answer it from their dashboard.");
      return;
    }
    const needsEta = ["sourcing", "options_sent"].includes(stage) && !requestContext?.eta_at;
    if (needsEta && !requestEta) {
      setError("Set the delivery estimate (ETA) first. The member sees it on their request.");
      return;
    }
    await run(async () => {
      if (needsEta) {
        await apiRequest(`/operations/work-items/${selected.id}/due`, token, {
          method: "POST",
          body: JSON.stringify({ due_at: new Date(requestEta).toISOString() }),
        });
        setRequestEta("");
      }
      await apiRequest(`/workers/requests/${selected.member_request_id}/events`, token, {
        method: "POST",
        body: JSON.stringify({ stage, member_note: requestStageNote.trim() || null }),
      });
      setRequestStage("");
      setRequestStageNote("");
      await loadDetails(token, selected);
    }, stage === "needs_member_input" ? "Question sent. The member answers from their dashboard." : "Request stage updated. The member sees it on their timeline.");
  }
  /** Set or change the deadline. On a member request this is the delivery estimate the member sees. */
  async function setDeadline(dueLocal: string, reason: string) {
    if (!token || !selected || !dueLocal) return;
    const isRequest = Boolean(selected.member_request_id);
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/due`, token, {
        method: "POST",
        body: JSON.stringify({ due_at: new Date(dueLocal).toISOString(), reason: reason.trim() || null }),
      });
      await loadDetails(token, selected);
    }, isRequest ? "Delivery estimate saved. The member sees the new date and your reason." : "Deadline saved.");
  }
  async function sendDeposit(expectedTotal: number, currency: string) {
    if (!token || !selected) return;
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/deposit-invoice`, token, {
        method: "POST",
        body: JSON.stringify({ expected_total: expectedTotal, currency }),
      });
      await loadDetails(token, selected);
    }, "Deposit invoice sent. The member pays from the email or their dashboard.");
  }
  async function sendInvoice() {
    if (!token || !selected) return;
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/invoice`, token, { method: "POST" });
      await loadDetails(token, selected);
    }, "Invoice sent. Payment moves the request to Fulfillment by itself.");
  }
  async function setGroupPrice(price: number, currency: string) {
    if (!token || !selected) return;
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/group-price`, token, {
        method: "POST",
        body: JSON.stringify({ price, currency }),
      });
      await loadDetails(token, selected);
    }, "Group price saved.");
  }
  async function sendGroupInvoices() {
    if (!token || !selected) return;
    let outcome: { sent: number; failed: unknown[]; skipped: number } | null = null;
    await run(async () => {
      outcome = await apiRequest<{ sent: number; failed: unknown[]; skipped: number }>(
        `/operations/work-items/${selected.id}/group-invoices`,
        token,
        { method: "POST" },
      );
      await loadDetails(token, selected);
    }, "Group invoices sent.");
    const result = outcome as { sent: number; failed: unknown[]; skipped: number } | null;
    if (result)
      setNotice(
        `Group invoices: ${result.sent} sent${result.skipped ? `, ${result.skipped} already invoiced` : ""}${result.failed.length ? `, ${result.failed.length} failed — see the history` : ""}.`,
      );
  }
  async function sendFlowMessage(event: FormEvent) {
    event.preventDefault();
    if (!token || !selected || !memberReply.trim()) return;
    const content = memberReply.trim();
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/member-message`, token, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setMemberReply("");
      await loadDetails(token, selected);
    }, "Message sent to the member's chat. They get a notification.");
  }
  async function drawGiveaway() {
    if (!token || !selected) return;
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/giveaway-draw`, token, { method: "POST" });
    }, "Winners drawn and emailed. This work item is finished.");
  }
  async function reopenWork(reason: string) {
    if (!token || !selected) return;
    await run(async () => {
      await apiRequest(`/operations/work-items/${selected.id}/reopen`, token, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setSelected(null);
    }, "Reopened. It is back in the queue.");
  }
  function toggleDepartment(workerId: string, department: Department, enabled: boolean) {
    setDepartmentDrafts((current) => {
      const next = new Set(current[workerId] || []);
      if (enabled) next.add(department);
      else next.delete(department);
      return { ...current, [workerId]: departments.filter((value) => next.has(value)) };
    });
  }
  async function saveWorkerDepartments(worker: WorkforceWorker) {
    if (!token) return;
    const selectedDepartments = departmentDrafts[worker.user_id] || [];
    await run(async () => {
      await apiRequest(`/operations/workers/${worker.user_id}/departments`, token, {
        method: "PUT",
        body: JSON.stringify({ departments: selectedDepartments }),
      });
    }, "Worker department access saved.");
  }

  const visibleDepartments = canManage ? departments : departmentsForUser;
  return {
    token,
    setToken,
    authLoading,
    setAuthLoading,
    departmentsForUser,
    setDepartmentsForUser,
    canManage,
    setCanManage,
    userId,
    setUserId,
    scope,
    setScope,
    filterDepartment,
    setFilterDepartment,
    filterStatus,
    setFilterStatus,
    items,
    setItems,
    listView,
    setListView,
    archiveQuery,
    setArchiveQuery,
    archiveDays,
    setArchiveDays,
    hasMore,
    flowContext,
    payments,
    requestStage,
    setRequestStage,
    requestStageNote,
    setRequestStageNote,
    recordRequestStage,
    requestEta,
    setRequestEta,
    setDeadline,
    sendDeposit,
    sendInvoice,
    setGroupPrice,
    sendGroupInvoices,
    drawGiveaway,
    reopenWork,
    sendFlowMessage,
    selected,
    setSelected,
    notes,
    setNotes,
    checklist,
    setChecklist,
    workEvents,
    setWorkEvents,
    requestContext,
    setRequestContext,
    disputeCase,
    setDisputeCase,
    memberConversationContext,
    setMemberConversationContext,
    businessConversationContext,
    setBusinessConversationContext,
    handoffContext,
    setHandoffContext,
    mentionWorkers,
    setMentionWorkers,
    mentionOptionsError,
    setMentionOptionsError,
    workforce,
    setWorkforce,
    workforceError,
    setWorkforceError,
    automationHealth,
    setAutomationHealth,
    automationHealthError,
    setAutomationHealthError,
    automationDialogOpen,
    setAutomationDialogOpen,
    identityLoaded,
    setIdentityLoaded,
    report,
    setReport,
    reportDays,
    setReportDays,
    reportError,
    setReportError,
    reportLoading,
    setReportLoading,
    reportReload,
    setReportReload,
    departmentDrafts,
    setDepartmentDrafts,
    sourcingBatches,
    setSourcingBatches,
    batchTitle,
    setBatchTitle,
    batchWorkIds,
    setBatchWorkIds,
    sourcingCandidates,
    setSourcingCandidates,
    candidateLoadError,
    setCandidateLoadError,
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
    shareCandidateIds,
    setShareCandidateIds,
    memberOptionNote,
    setMemberOptionNote,
    note,
    setNote,
    checkTitle,
    setCheckTitle,
    memberReply,
    setMemberReply,
    businessReply,
    setBusinessReply,
    action,
    setAction,
    nextAction,
    setNextAction,
    waitingOn,
    setWaitingOn,
    waitingReason,
    setWaitingReason,
    transferDepartment,
    setTransferDepartment,
    transferReason,
    setTransferReason,
    busy,
    setBusy,
    error,
    setError,
    notice,
    setNotice,
    processingDueSchedules,
    setProcessingDueSchedules,
    fulfillmentStage,
    setFulfillmentStage,
    fulfillmentNote,
    setFulfillmentNote,
    shipment,
    setShipment,
    warehouseEvidence,
    setWarehouseEvidence,
    disputeCategory,
    setDisputeCategory,
    disputeSummary,
    setDisputeSummary,
    disputeNextAction,
    setDisputeNextAction,
    disputeDueAt,
    setDisputeDueAt,
    disputeStatus,
    setDisputeStatus,
    disputeResolution,
    setDisputeResolution,
    loadItems,
    loadDetails,
    refresh,
    processDueSchedules,
    run,
    claim,
    saveStatus,
    sendMemberReply,
    sendBusinessReply,
    returnToAutomation,
    transfer,
    createDispute,
    updateDispute,
    addNote,
    mentionMatch,
    mentionQuery,
    mentionSuggestions,
    insertMention,
    editSourcingCandidate,
    addSourcingCandidate,
    saveFulfillmentMilestone,
    uploadWarehouseEvidence,
    shareSourcingOptions,
    createSourcingBatch,
    addChecklist,
    toggleChecklist,
    toggleDepartment,
    saveWorkerDepartments,
    visibleDepartments,
  };
}

export type OperationsState = ReturnType<typeof useOperationsCenter>;
