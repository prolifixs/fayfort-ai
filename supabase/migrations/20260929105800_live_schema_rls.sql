-- FayFort: security and indexes for the live schema baseline.
-- Provides the membership helper used by Layer 4 and Layer 5 policies.

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

create index if not exists idx_conversation_intents_active
    on public.conversation_intents(conversation_id, created_at desc)
    where intent_status = 'active';
create index if not exists idx_conversation_intents_source_message_id
    on public.conversation_intents(source_message_id);
create index if not exists idx_conversation_actions_pending
    on public.conversation_actions(conversation_id, created_at desc)
    where status = 'pending';

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.conversation_intents enable row level security;
alter table public.conversation_actions enable row level security;

drop policy if exists "business_members_can_view_business" on public.businesses;
create policy "business_members_can_view_business"
on public.businesses
for select
using (public.is_business_member(id));

drop policy if exists "business_members_can_update_business" on public.businesses;
create policy "business_members_can_update_business"
on public.businesses
for update
using (public.is_business_member(id))
with check (public.is_business_member(id));

drop policy if exists "members_can_view_business_members" on public.business_members;
create policy "members_can_view_business_members"
on public.business_members
for select
using (public.is_business_member(business_id));

drop policy if exists "members_can_manage_conversations" on public.conversations;
create policy "members_can_manage_conversations"
on public.conversations
for all
using (public.is_business_member(business_id))
with check (public.is_business_member(business_id));

drop policy if exists "members_can_manage_messages" on public.messages;
create policy "members_can_manage_messages"
on public.messages
for all
using (
  exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and public.is_business_member(c.business_id)
  )
)
with check (
  exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and public.is_business_member(c.business_id)
  )
);

drop policy if exists "members_can_manage_knowledge_documents" on public.knowledge_documents;
create policy "members_can_manage_knowledge_documents"
on public.knowledge_documents
for all
using (public.is_business_member(business_id))
with check (public.is_business_member(business_id));

drop policy if exists "members_can_manage_knowledge_chunks" on public.knowledge_chunks;
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

drop policy if exists "members_can_manage_conversation_intents" on public.conversation_intents;
create policy "members_can_manage_conversation_intents"
on public.conversation_intents
for all
using (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_intents.conversation_id
      and public.is_business_member(c.business_id)
  )
)
with check (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_intents.conversation_id
      and public.is_business_member(c.business_id)
  )
);

drop policy if exists "members_can_manage_conversation_actions" on public.conversation_actions;
create policy "members_can_manage_conversation_actions"
on public.conversation_actions
for all
using (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_actions.conversation_id
      and public.is_business_member(c.business_id)
  )
)
with check (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_actions.conversation_id
      and public.is_business_member(c.business_id)
  )
);
