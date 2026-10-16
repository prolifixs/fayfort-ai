export type Business = { business_id: string; name: string };

export type Connection = {
  id: string;
  provider: string;
  display_name: string;
  status: string;
  credential_status: string;
  provider_account_id?: string | null;
  provider_username?: string | null;
  health_checked_at?: string | null;
  health_error_code?: string | null;
  safe_settings: Record<string, unknown>;
};

export type Automation = {
  id: string;
  name: string;
  trigger_type: string;
  action_type: string;
  action_config?: { response_text?: string };
  enabled: boolean;
  schedule_interval_seconds?: number | null;
  schedule_next_run_at?: string | null;
  schedule_attempts?: number;
  schedule_last_error_code?: string | null;
};

export type AutomationRun = {
  id: string;
  status: string;
  error_code?: string | null;
  created_at: string;
  result?: Record<string, unknown>;
};

export type WaitEstimate = {
  status: "estimated" | "unavailable";
  lower_minutes?: number;
  upper_minutes?: number;
  sample_size?: number;
  reason?: string;
};

export type Handoff = {
  id: string;
  conversation_id: string;
  requested_by: string;
  assigned_to?: string | null;
  status: string;
  reason: string;
  requested_at: string;
  updated_at?: string;
  queue_position?: number;
  wait_estimate?: WaitEstimate;
};

export type HandoffAgent = {
  user_id: string;
  status?: string;
  role?: string;
  handoff_availability?: "available" | "away" | "offline";
  handoff_available_until?: string | null;
  handoff_max_active?: number;
};

export type EventRecord = {
  id: number;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type WorkspaceProps = {
  accessToken: string;
  signedInEmail?: string;
  platformAdmin?: boolean;
  onSignOut?: () => void | Promise<void>;
  eventStreaming?: boolean;
};

export type HandoffEvent = {
  id: string;
  handoff_id: string;
  actor_id: string;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type ConversationRow = {
  id: string;
  customer_external_id?: string | null;
  customer_name?: string | null;
  customer_username?: string | null;
  channel?: string | null;
  platform?: string | null;
  status: string;
  summary?: string | null;
  last_message_at?: string | null;
  created_at: string;
  /** Open human takeover on this chat: requested, assigned or active. */
  handoff_status?: string | null;
};

export type CustomerRow = {
  id: string;
  channel: string;
  external_customer_id: string;
  profile: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CustomerConversationRow = Pick<
  ConversationRow,
  "id" | "customer_external_id" | "channel" | "platform" | "status" | "summary" | "last_message_at" | "created_at"
>;

export type RequestRow = {
  id: string;
  customer_id: string;
  conversation_id: string;
  related_request_id?: string | null;
  request_type: string;
  status: string;
  details: Record<string, unknown>;
  required_information: string[];
  missing_information: string[];
  created_at: string;
  updated_at: string;
};

export type CustomerRequestRow = Pick<
  RequestRow,
  | "id"
  | "conversation_id"
  | "request_type"
  | "status"
  | "details"
  | "required_information"
  | "missing_information"
  | "created_at"
  | "updated_at"
>;

export type CustomerDetail = {
  customer: CustomerRow;
  conversations: CustomerConversationRow[];
  requests: CustomerRequestRow[];
};

export type MessageRow = {
  id: string;
  sender_type: string;
  content: string;
  created_at: string;
  delivery?: { id: string; status: string; attempt_count: number; safe_error_code?: string | null } | null;
};

export type ConversationDetail = {
  customer: CustomerRow | null;
  requests: Array<
    Pick<
      RequestRow,
      | "id"
      | "request_type"
      | "status"
      | "details"
      | "required_information"
      | "missing_information"
      | "created_at"
      | "updated_at"
    >
  >;
};

export type DirectoryToolRow = {
  tool_id: string;
  family: string;
  description: string;
  verification_policy: string;
  active: boolean;
};

export type DirectorySearchResult = {
  tool_id: string;
  outcome: string;
  message: string;
  records?: Record<string, unknown>[];
  requires_human?: boolean;
  verification_state?: string;
  allowed_fields?: string[];
};

export type DirectoryProduct = {
  id: string;
  name: string;
  category_ref: string;
  description: string;
  availability_status: "available" | "sourcing" | "unavailable";
  active: boolean;
  media_url?: string | null;
  media_type?: "image" | "video" | null;
  media_source?: "url" | "instagram" | "upload" | null;
  media_storage_path?: string | null;
  created_at?: string;
  updated_at: string;
};

export type ProductCategory = { source_ref: string; category: string; product_type: string };

export type EntitlementRow = {
  id: string;
  tool_id: string;
  access_level: string;
  status: string;
  starts_at?: string | null;
  expires_at?: string | null;
  entitlement_source?: string;
  source_reference?: string;
};

export type VerificationQueueRow = {
  source_type: string;
  tool_id: string;
  record_id: string;
  verification_status: string;
  label: string;
};

export type VerificationDecisionRow = {
  id: string;
  tool_id: string;
  outcome: string;
  verification_state?: string;
  reason_code?: string;
  created_at: string;
};

export type VerificationReviewRow = {
  id: string;
  reviewer_user_id: string;
  source_table: string;
  record_id: string;
  tool_id: string;
  previous_status: string;
  verification_status: string;
  reason: string;
  created_at: string;
};

export type AnalyticsEvent = {
  id: number;
  event_type: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
};

export type AnalyticsResult = {
  days: number;
  sampled_events: number;
  summary_truncated: boolean;
  event_counts: Record<string, number>;
  events: AnalyticsEvent[];
  has_more: boolean;
  next_before_id: number | null;
};

export type AiUsageResult = {
  days: number;
  sampled_requests: number;
  summary_truncated: boolean;
  reported_usage_requests: number;
  unknown_usage_requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  source_messages: number;
  message_call_distribution: Record<string, number>;
  operations: Record<string, { calls: number; prompt_tokens: number; completion_tokens: number; total_tokens: number }>;
  models: Record<string, number>;
  providers: Record<string, number>;
  budget: { limit_usd: number; committed_usd: number; pending_usd: number; remaining_usd: number; month_start: string };
};

export type OperationalRecord = Record<string, unknown>;
