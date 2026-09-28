-- FayFort AI
-- Migration 0018: Row Level Security Policies
--
-- Multi-tenant security:
-- Authenticated users can only access data belonging
-- to businesses they are members of.

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
-- BUSINESSES
-- ============================================================

alter table public.businesses enable row level security;

drop policy if exists "business_members_can_view_business" on public.businesses;

create policy "business_members_can_view_business"
on public.businesses
for select
to authenticated
using (
    public.is_business_member(id)
);


-- ============================================================
-- BUSINESS MEMBERS
-- ============================================================

alter table public.business_members enable row level security;

drop policy if exists "users_can_view_business_memberships"
on public.business_members;

create policy "users_can_view_business_memberships"
on public.business_members
for select
to authenticated
using (
    user_id = auth.uid()
    or public.is_business_member(business_id)
);


-- ============================================================
-- SOCIAL ACCOUNTS
-- ============================================================

alter table public.social_accounts enable row level security;

drop policy if exists "business_members_can_access_social_accounts"
on public.social_accounts;

create policy "business_members_can_access_social_accounts"
on public.social_accounts
for all
to authenticated
using (
    public.is_business_member(business_id)
)
with check (
    public.is_business_member(business_id)
);


-- ============================================================
-- CONVERSATIONS
-- ============================================================

alter table public.conversations enable row level security;

drop policy if exists "business_members_can_access_conversations"
on public.conversations;

create policy "business_members_can_access_conversations"
on public.conversations
for all
to authenticated
using (
    public.is_business_member(business_id)
)
with check (
    public.is_business_member(business_id)
);


-- ============================================================
-- MESSAGES
-- ============================================================

alter table public.messages enable row level security;

drop policy if exists "business_members_can_access_messages"
on public.messages;

create policy "business_members_can_access_messages"
on public.messages
for all
to authenticated
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

alter table public.ai_responses enable row level security;

drop policy if exists "business_members_can_access_ai_responses"
on public.ai_responses;

create policy "business_members_can_access_ai_responses"
on public.ai_responses
for all
to authenticated
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

alter table public.knowledge_documents enable row level security;

drop policy if exists "business_members_can_access_knowledge_documents"
on public.knowledge_documents;

create policy "business_members_can_access_knowledge_documents"
on public.knowledge_documents
for all
to authenticated
using (
    public.is_business_member(business_id)
)
with check (
    public.is_business_member(business_id)
);


-- ============================================================
-- KNOWLEDGE CHUNKS
-- ============================================================

alter table public.knowledge_chunks enable row level security;

drop policy if exists "business_members_can_access_knowledge_chunks"
on public.knowledge_chunks;

create policy "business_members_can_access_knowledge_chunks"
on public.knowledge_chunks
for all
to authenticated
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

alter table public.rules enable row level security;

drop policy if exists "business_members_can_access_rules"
on public.rules;

create policy "business_members_can_access_rules"
on public.rules
for all
to authenticated
using (
    public.is_business_member(business_id)
)
with check (
    public.is_business_member(business_id)
);


-- ============================================================
-- HUMAN HANDOFFS
-- ============================================================

alter table public.human_handoffs enable row level security;

drop policy if exists "business_members_can_access_handoffs"
on public.human_handoffs;

create policy "business_members_can_access_handoffs"
on public.human_handoffs
for all
to authenticated
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

alter table public.webhook_events enable row level security;

drop policy if exists "business_members_can_access_webhook_events"
on public.webhook_events;

create policy "business_members_can_access_webhook_events"
on public.webhook_events
for all
to authenticated
using (
    public.is_business_member(business_id)
)
with check (
    public.is_business_member(business_id)
);


-- ============================================================
-- SYSTEM LOGS
-- ============================================================

alter table public.system_logs enable row level security;

drop policy if exists "business_members_can_access_system_logs"
on public.system_logs;

create policy "business_members_can_access_system_logs"
on public.system_logs
for select
to authenticated
using (
    public.is_business_member(business_id)
);


-- ============================================================
-- BUSINESS SETTINGS
-- ============================================================

alter table public.business_settings enable row level security;

drop policy if exists "business_members_can_access_business_settings"
on public.business_settings;

create policy "business_members_can_access_business_settings"
on public.business_settings
for all
to authenticated
using (
    public.is_business_member(business_id)
)
with check (
    public.is_business_member(business_id)
);


-- ============================================================
-- BUSINESS SUBSCRIPTIONS
-- ============================================================

alter table public.business_subscriptions enable row level security;

drop policy if exists "business_members_can_access_subscriptions"
on public.business_subscriptions;

create policy "business_members_can_access_subscriptions"
on public.business_subscriptions
for select
to authenticated
using (
    public.is_business_member(business_id)
);


-- ============================================================
-- USAGE TRACKING
-- ============================================================

alter table public.usage_tracking enable row level security;

drop policy if exists "business_members_can_access_usage_tracking"
on public.usage_tracking;

create policy "business_members_can_access_usage_tracking"
on public.usage_tracking
for select
to authenticated
using (
    public.is_business_member(business_id)
);


-- ============================================================
-- AI USAGE
-- ============================================================

alter table public.ai_usage enable row level security;

drop policy if exists "business_members_can_access_ai_usage"
on public.ai_usage;

create policy "business_members_can_access_ai_usage"
on public.ai_usage
for select
to authenticated
using (
    public.is_business_member(business_id)
);


-- ============================================================
-- SUBSCRIPTION PLANS
-- ============================================================
--
-- subscription_plans is global reference data.
-- It does not belong to an individual business.
-- Therefore we intentionally do NOT enable tenant RLS here.