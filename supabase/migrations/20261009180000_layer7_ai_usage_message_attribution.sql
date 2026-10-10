alter table public.ai_usage_events
    add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
    add column if not exists source_message_id uuid references public.messages(id) on delete set null;

create index if not exists idx_ai_usage_events_business_message
    on public.ai_usage_events (business_id, source_message_id)
    where source_message_id is not null;
