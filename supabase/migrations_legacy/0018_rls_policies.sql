-- ============================================================
-- FayFort AI
-- Migration 0018: Row Level Security Policies
-- ============================================================

-- ============================================================
-- HELPER FUNCTION
-- ============================================================

create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.business_members bm
    where bm.business_id = target_business_id
      and bm.user_id = auth.uid()
  );
$$;


-- ============================================================
-- ENABLE RLS
-- ============================================================

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.social_accounts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.ai_responses enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.rules enable row level security;
alter table public.ai_usage enable row level security;
alter table public.human_handoffs enable row level security;
alter table public.webhook_events enable row level security;
alter table public.system_settings enable row level security;
alter table public.business_subscriptions enable row level security;
alter table public.usage_tracking enable row level security;
alter table public.rls_policies enable row level security;


-- ============================================================
-- BUSINESSES
-- ============================================================

create policy "business_members_can_view_business"
on public.businesses
for select
using (
  public.is_business_member(id)
);


create policy "business_members_can_update_business"
on public.businesses
for update
using (
  public.is_business_member(id)
)
with check (
  public.is_business_member(id)
);


-- ============================================================
-- BUSINESS MEMBERS
-- ============================================================

create policy "members_can_view_business_members"
on public.business_members
for select
using (
  public.is_business_member(business_id)
);


-- ============================================================
-- SOCIAL ACCOUNTS
-- ============================================================

create policy "members_can_manage_social_accounts"
on public.social_accounts
for all
using (
  public.is_business_member(business_id)
)
with check (
  public.is_business_member(business_id)
);


-- ============================================================
-- CONVERSATIONS
-- ============================================================

create policy "members_can_manage_conversations"
on public.conversations
for all
using (
  public.is_business_member(business_id)
)
with check (
  public.is_business_member(business_id)
);


-- ============================================================
-- MESSAGES
-- ============================================================

create policy "members_can_manage_messages"
on public.messages
for all
using (
  exists (
    select 1
    from public.conversations c
    where c.id = messages.conversation_id
      and public.is_business_member(c.business_id)
  )
)
with check (
  exists (
    select 1
    from public.conversations c
    where c.id = messages.conversation_id
      and public.is_business_member(c.business_id)
  )
);


-- ============================================================
-- AI RESPONSES
-- ============================================================

create policy "members_can_manage_ai_responses"
on public.ai_responses
for all
using (
  exists (
    select 1
    from public.conversations c
    where c.id = ai_responses.conversation_id
      and public.is_business_member(c.business_id)
  )
)
with check (
  exists (
    select 1
    from public.conversations c
    where c.id = ai_responses.conversation_id
      and public.is_business_member(c.business_id)
  )
);


-- ============================================================
-- KNOWLEDGE DOCUMENTS
-- ============================================================

create policy "members_can_manage_knowledge_documents"
on public.knowledge_documents
for all
using (
  public.is_business_member(business_id)
)
with check (
  public.is_business_member(business_id)
);


-- ============================================================
-- KNOWLEDGE CHUNKS
-- ============================================================

create policy "members_can_manage_knowledge_chunks"
on public.knowledge_chunks
for all
using (
  exists (
    select 1
    from public.knowledge_documents kd
    where kd.id = knowledge_chunks.document_id
      and public.is_business_member(kd.business_id)
  )
)
with check (
  exists (
    select 1
    from public.knowledge_documents kd
    where kd.id = knowledge_chunks.document_id
      and public.is_business_member(kd.business_id)
  )
);


-- ============================================================
-- RULES
-- ============================================================

create policy "members_can_manage_rules"
on public.rules
for all
using (
  public.is_business_member(business_id)
)
with check (
  public.is_business_member(business_id)
);


-- ============================================================
-- AI USAGE
-- ============================================================

create policy "members_can_view_ai_usage"
on public.ai_usage
for select
using (
  public.is_business_member(business_id)
);


-- ============================================================
-- HUMAN HANDOFFS
-- ============================================================

create policy "members_can_manage_human_handoffs"
on public.human_handoffs
for all
using (
  exists (
    select 1
    from public.conversations c
    where c.id = human_handoffs.conversation_id
      and public.is_business_member(c.business_id)
  )
)
with check (
  exists (
    select 1
    from public.conversations c
    where c.id = human_handoffs.conversation_id
      and public.is_business_member(c.business_id)
  )
);


-- ============================================================
-- WEBHOOK EVENTS
-- ============================================================

create policy "members_can_view_webhook_events"
on public.webhook_events
for select
using (
  public.is_business_member(business_id)
);


-- ============================================================
-- SYSTEM SETTINGS
-- ============================================================

create policy "members_can_manage_system_settings"
on public.system_settings
for all
using (
  public.is_business_member(business_id)
)
with check (
  public.is_business_member(business_id)
);


-- ============================================================
-- BUSINESS SUBSCRIPTIONS
-- ============================================================

create policy "members_can_view_business_subscription"
on public.business_subscriptions
for select
using (
  public.is_business_member(business_id)
);


-- ============================================================
-- USAGE TRACKING
-- ============================================================

create policy "members_can_view_usage_tracking"
on public.usage_tracking
for select
using (
  public.is_business_member(business_id)
);


-- ============================================================
-- RLS POLICY METADATA
-- ============================================================

create policy "members_can_view_rls_policies"
on public.rls_policies
for select
using (
  public.is_business_member(business_id)
);