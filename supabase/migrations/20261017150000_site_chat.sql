-- FayFort AI chat help on www.fayfort.com (docs/PUBLIC_SITE_REBUILD_PLAN.md, website chat).
-- Visitors chat without an account. Each browser holds a random visitor token; only its SHA-256 is stored here.
-- When a visitor joins free (or signs in), a short-lived claim code carries the conversation into their member chat.
-- Only the API (service_role) reads or writes these tables.

create table if not exists public.site_chat_settings (
    id smallint primary key default 1 check (id = 1),
    enabled boolean not null default true,
    visitor_daily_limit integer not null default 20 check (visitor_daily_limit between 1 and 200),
    network_daily_limit integer not null default 60 check (network_daily_limit between 1 and 1000),
    daily_reply_cap integer not null default 400 check (daily_reply_cap between 1 and 20000),
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);
insert into public.site_chat_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.site_chat_conversations (
    id uuid primary key default gen_random_uuid(),
    visitor_token_hash text not null unique check (visitor_token_hash ~ '^[0-9a-f]{64}$'),
    network_hash text check (network_hash is null or network_hash ~ '^[0-9a-f]{64}$'),
    first_page text check (first_page is null or length(first_page) <= 200),
    message_count integer not null default 0,
    claim_code_hash text unique check (claim_code_hash is null or claim_code_hash ~ '^[0-9a-f]{64}$'),
    claim_expires_at timestamptz,
    claimed_member_id uuid references auth.users(id) on delete set null,
    member_conversation_id uuid references public.member_conversations(id) on delete set null,
    claimed_at timestamptz,
    created_at timestamptz not null default now(),
    last_activity_at timestamptz not null default now()
);
create index if not exists idx_site_chat_conversations_activity on public.site_chat_conversations(last_activity_at desc);
create index if not exists idx_site_chat_conversations_network on public.site_chat_conversations(network_hash, last_activity_at);

create table if not exists public.site_chat_messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.site_chat_conversations(id) on delete cascade,
    sender_type text not null check (sender_type in ('visitor', 'assistant')),
    content text not null check (length(content) between 1 and 8000),
    actions text[] not null default '{}',
    prompt_tokens integer,
    completion_tokens integer,
    created_at timestamptz not null default now()
);
create index if not exists idx_site_chat_messages_conversation on public.site_chat_messages(conversation_id, created_at);
create index if not exists idx_site_chat_messages_day on public.site_chat_messages(sender_type, created_at);

alter table public.site_chat_settings enable row level security;
alter table public.site_chat_conversations enable row level security;
alter table public.site_chat_messages enable row level security;
revoke all on table public.site_chat_settings, public.site_chat_conversations, public.site_chat_messages
    from public, anon, authenticated;
grant select, insert, update, delete on table public.site_chat_settings, public.site_chat_conversations,
    public.site_chat_messages to service_role;

-- Carries a website conversation into a new member chat, once. Copies the messages in order and marks the
-- website conversation as claimed. Returns the member conversation id, or null when the code is unknown,
-- expired or already used.
create or replace function public.claim_site_chat(p_member_id uuid, p_claim_code_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_site public.site_chat_conversations;
    v_member_conversation uuid;
    v_first text;
begin
    select * into v_site from public.site_chat_conversations
     where claim_code_hash = p_claim_code_hash
     for update;
    if not found then
        return null;
    end if;
    if v_site.claimed_member_id is not null then
        -- Same member opening the link again: give back the chat already made.
        return case when v_site.claimed_member_id = p_member_id then v_site.member_conversation_id else null end;
    end if;
    if v_site.claim_expires_at is null or v_site.claim_expires_at < now() then
        return null;
    end if;
    if not exists (select 1 from public.site_chat_messages where conversation_id = v_site.id) then
        return null;
    end if;

    select content into v_first from public.site_chat_messages
     where conversation_id = v_site.id and sender_type = 'visitor'
     order by created_at limit 1;

    insert into public.member_conversations (member_id, title, last_activity_at)
    values (p_member_id, left('From fayfort.com: ' || coalesce(v_first, 'website chat'), 120), now())
    returning id into v_member_conversation;

    insert into public.member_messages (conversation_id, sender_type, content, created_at)
    select v_member_conversation,
           case when m.sender_type = 'visitor' then 'member' else 'assistant' end,
           m.content,
           m.created_at
      from public.site_chat_messages m
     where m.conversation_id = v_site.id
     order by m.created_at;

    update public.site_chat_conversations
       set claimed_member_id = p_member_id,
           member_conversation_id = v_member_conversation,
           claimed_at = now(),
           claim_expires_at = null
     where id = v_site.id;
    return v_member_conversation;
end;
$$;

revoke all on function public.claim_site_chat(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_site_chat(uuid, text) to service_role;
