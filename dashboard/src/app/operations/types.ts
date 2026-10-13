export type Department = "conversation_intake" | "sourcing" | "fulfillment" | "disputes" | "member_support";
export type WorkStatus = "open" | "claimed" | "waiting" | "blocked" | "completed" | "cancelled";
export type WorkItem = {
  id: string;
  department: Department;
  work_type: string;
  status: WorkStatus;
  priority: string;
  summary: string;
  next_action: string;
  waiting_on: string | null;
  waiting_reason: string | null;
  due_at: string | null;
  assigned_worker_id: string | null;
  assigned_automation_key: string | null;
  claimed_until: string | null;
  version: number;
  member_request_id: string | null;
  member_conversation_id: string | null;
  business_id: string | null;
  business_conversation_id: string | null;
  handoff_id: string | null;
  dispute_case_id?: string | null;
  created_at: string;
};
export type WorkNote = { id: string; author_id: string; note: string; created_at: string };
export type MentionWorker = { user_id: string; email: string; label: string };
export type ChecklistItem = {
  id: string;
  title: string;
  position: number;
  completed_at: string | null;
  created_at: string;
};
export type RequestMedia = {
  id: string;
  url: string;
  content_type: string;
  original_filename: string;
  created_at: string;
};
export type RequestContext = {
  id: string;
  product_name_snapshot: string | null;
  request_title: string;
  request_description: string | null;
  source_type: string | null;
  source_url: string | null;
  created_at: string;
  updated_at: string;
  events: {
    id: string;
    sequence_no: number;
    stage: string;
    member_note: string | null;
    details: Record<string, string>;
    media: RequestMedia[];
    created_at: string;
  }[];
  recurring_schedule?: {
    id: string;
    cadence: string;
    interval_count: number;
    interval_unit: string;
    units_per_order: number;
    occurrence_limit: number;
    time_zone: string;
    next_occurrence_number: number;
    next_due_at: string;
    expires_at: string;
    status: string;
    occurrences: {
      id: string;
      occurrence_number: number;
      request_id: string | null;
      due_at: string;
      status: string;
      quote_accepted_at: string | null;
    }[];
    events: {
      id: string;
      sequence_no: number;
      event_type: string;
      occurrence_number: number | null;
      details: Record<string, unknown>;
      created_at: string;
    }[];
    current_occurrence: { schedule_id: string; occurrence_number: number; due_at: string; status: string } | null;
  } | null;
};
export type SourcingCandidate = {
  id: string;
  product_name: string;
  supplier_name: string | null;
  product_url: string;
  price_amount: number | null;
  currency: string | null;
  availability: string | null;
  evidence_note: string;
  created_at: string;
};
export type SourcingBatch = {
  id: string;
  title: string;
  status: string;
  items: { work_item_id: string; member_request_id: string }[];
};
export type MemberConversationContext = {
  id: string;
  title: string;
  linked_request_id: string | null;
  retention_hold: boolean;
  messages: {
    id: string;
    sender_type: "member" | "assistant" | "worker";
    content: string;
    related_product_ids: string[];
    created_at: string;
  }[];
};
export type BusinessConversationContext = {
  id: string;
  business_id: string;
  channel: string;
  status: string;
  created_at: string;
  last_message_at: string;
  summary: string | null;
  messages: { id: string; sender_type: string; content: string; created_at: string }[];
};
export type HandoffContext = {
  id: string;
  conversation_id: string;
  status: string;
  reason: string | null;
  requested_at: string;
  updated_at: string;
  closed_at: string | null;
};
export type DisputeCase = {
  id: string;
  member_request_id: string;
  category: string;
  summary: string;
  status: string;
  resolution: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  events: {
    id: string;
    sequence_no: number;
    actor_id: string;
    previous_status: string | null;
    next_status: string;
    note: string;
    created_at: string;
  }[];
};
export type SourceContext = {
  source_type: string;
  request?: RequestContext | null;
  conversation?: MemberConversationContext | BusinessConversationContext | null;
  handoff?: HandoffContext | null;
  dispute_case?: DisputeCase | null;
};
export type WorkEvent = {
  id: string;
  sequence_no: number;
  event_type: string;
  actor_type: string;
  previous_department: string | null;
  next_department: string | null;
  previous_status: string | null;
  next_status: string | null;
  reason: string | null;
  created_at: string;
};
export type WorkforceWorker = {
  user_id: string;
  status: string;
  handoff_availability: string;
  handoff_available_until: string | null;
  handoff_max_active: number;
  online: boolean;
  last_seen_at: string | null;
  departments: Department[];
  active_work_count: number;
  current_work: { id: string; summary: string; department: Department; status: WorkStatus; priority: string }[];
};
export type Workforce = {
  workers: WorkforceWorker[];
  summary: {
    active_workers: number;
    online_workers: number;
    active_work_items: number;
    automation_owned_work_items: number;
    automation_work: {
      id: string;
      summary: string;
      department: Department;
      status: WorkStatus;
      priority: string;
      assigned_automation_key: string;
    }[];
  };
  online_window_seconds: number;
};
export type AutomationHealth = {
  summary: { recent_runs: number; failed_runs: number; enabled_schedules: number; schedule_issues: number };
  recent_runs: {
    id: string;
    automation_name: string;
    business_ref: string;
    status: string;
    error_code: string | null;
    triggered_by: string;
    created_at: string;
    completed_at: string | null;
  }[];
  schedule_issues: {
    id: string;
    name: string;
    business_ref: string;
    next_run_at: string | null;
    attempts: number;
    last_error_code: string | null;
  }[];
};
export type OperationsReport = {
  generated_at: string;
  period_days: number;
  work: {
    total: number;
    active: number;
    due_overdue: number;
    by_department: Record<string, Record<string, number>>;
    aging: Record<string, number>;
  };
  sourcing: {
    requests_by_latest_stage: Record<string, number>;
    candidates_added: number;
    member_options_shared: number;
    member_options_selected: number;
  };
  disputes: { opened_in_period: number; active: number; by_status: Record<string, number> };
  automation: {
    runs_in_period: number;
    failed_in_period: number;
    enabled_schedules: number;
    schedules_with_issues: number;
  };
  reconciliation: {
    actionable_requests_missing_work: number;
    terminal_requests_with_active_work: number;
    active_disputes_missing_work: number;
    expired_claims: number;
  };
  data_limit_reached: boolean;
};
export const departments: Department[] = [
  "conversation_intake",
  "sourcing",
  "fulfillment",
  "disputes",
  "member_support",
];
export const departmentLabel: Record<Department, string> = {
  conversation_intake: "Conversation intake",
  sourcing: "Sourcing",
  fulfillment: "Fulfillment",
  disputes: "Disputes",
  member_support: "Member support",
};
export const statuses: WorkStatus[] = ["open", "claimed", "waiting", "blocked", "completed", "cancelled"];
export const fulfillmentNextStages: Record<string, string[]> = {
  purchase_confirmed: ["item_in_warehouse"],
  item_in_warehouse: ["shipped"],
  shipped: ["in_transit"],
  in_transit: ["out_for_delivery", "delivered"],
  out_for_delivery: ["delivered"],
};
export const disputeNextStatuses: Record<string, string[]> = {
  open: ["investigating", "awaiting_member", "awaiting_supplier", "resolved", "closed"],
  investigating: ["awaiting_member", "awaiting_supplier", "resolved", "closed"],
  awaiting_member: ["investigating", "resolved", "closed"],
  awaiting_supplier: ["investigating", "resolved", "closed"],
  resolved: ["closed"],
  closed: [],
};
export const statusLabel = (value: string) =>
  value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
