-- Member-owned discovery chat and separate per-member AI usage controls.
-- Chat content is isolated from business conversations and usage ledgers.

create table if not exists public.member_conversations (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    title text not null default 'New chat' check (char_length(title) between 1 and 120),
    linked_request_id uuid references public.member_purchase_requests(id) on delete set null,
    retention_hold boolean not null default false,
    retention_hold_reason text,
    last_activity_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_member_conversations_owner_activity
    on public.member_conversations (member_id, last_activity_at desc);
create index if not exists idx_member_conversations_retention
    on public.member_conversations (last_activity_at)
    where retention_hold = false;

create table if not exists public.member_messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.member_conversations(id) on delete cascade,
    sender_type text not null check (sender_type in ('member', 'assistant')),
    content text not null check (char_length(content) between 1 and 8000),
    related_product_ids uuid[] not null default '{}',
    created_at timestamptz not null default now()
);
create index if not exists idx_member_messages_conversation_created
    on public.member_messages (conversation_id, created_at);

create or replace function public.touch_member_conversation_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.member_conversations
       set last_activity_at = now(), updated_at = now()
     where id = new.conversation_id;
    return new;
end;
$$;
drop trigger if exists member_messages_touch_conversation on public.member_messages;
create trigger member_messages_touch_conversation
    after insert on public.member_messages
    for each row execute function public.touch_member_conversation_activity();

create or replace function public.link_member_chat_request(
    p_member_id uuid,
    p_conversation_id uuid,
    p_request_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_chat public.member_conversations%rowtype;
begin
    if auth.role() <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    select * into v_chat from public.member_conversations
     where id = p_conversation_id and member_id = p_member_id for update;
    if not found then raise exception 'member_chat_not_found' using errcode = 'P0002'; end if;
    if not exists (select 1 from public.member_purchase_requests
                   where id = p_request_id and member_id = p_member_id) then
        raise exception 'member_request_not_found' using errcode = 'P0002';
    end if;
    if v_chat.linked_request_id is not null or v_chat.retention_hold then
        raise exception 'member_chat_already_linked' using errcode = '23505';
    end if;
    update public.member_conversations
       set linked_request_id = p_request_id,
           retention_hold = true,
           retention_hold_reason = 'member_purchase_request_submitted',
           updated_at = now()
     where id = p_conversation_id;
end;
$$;
revoke all on function public.touch_member_conversation_activity() from public, anon, authenticated;
revoke all on function public.link_member_chat_request(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_member_chat_request(uuid, uuid, uuid) to service_role;

create or replace function public.create_member_request_from_chat(
    p_member_id uuid,
    p_conversation_id uuid,
    p_request_title text,
    p_request_description text default null,
    p_product_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_chat public.member_conversations%rowtype;
    v_request_id uuid;
begin
    if auth.role() <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    select * into v_chat from public.member_conversations
     where id = p_conversation_id and member_id = p_member_id for update;
    if not found then raise exception 'member_chat_not_found' using errcode = 'P0002'; end if;
    if v_chat.linked_request_id is not null or v_chat.retention_hold then
        raise exception 'member_chat_already_linked' using errcode = '23505';
    end if;
    v_request_id := public.create_member_purchase_request(
        p_member_id, p_request_title, p_request_description, p_product_id
    );
    update public.member_conversations
       set linked_request_id = v_request_id,
           retention_hold = true,
           retention_hold_reason = 'member_purchase_request_submitted',
           updated_at = now()
     where id = p_conversation_id;
    return v_request_id;
end;
$$;
revoke all on function public.create_member_request_from_chat(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_member_request_from_chat(uuid, uuid, text, text, uuid) to service_role;

create table if not exists public.member_ai_usage_reservations (
    request_id uuid primary key,
    member_id uuid not null references auth.users(id) on delete cascade,
    model text not null,
    provider text not null,
    input_price_micro_usd_per_million bigint not null check (input_price_micro_usd_per_million >= 0),
    output_price_micro_usd_per_million bigint not null check (output_price_micro_usd_per_million >= 0),
    max_input_tokens bigint not null check (max_input_tokens >= 0),
    max_output_tokens bigint not null check (max_output_tokens >= 0),
    reserved_micro_usd bigint not null check (reserved_micro_usd >= 0),
    actual_micro_usd bigint,
    reservation_status text not null check (reservation_status in ('reserved', 'settled', 'uncertain', 'released')),
    created_at timestamptz not null default now(),
    settled_at timestamptz,
    constraint member_ai_actual_nonnegative check (actual_micro_usd is null or actual_micro_usd >= 0)
);
create index if not exists idx_member_ai_usage_owner_created
    on public.member_ai_usage_reservations (member_id, created_at desc);

alter table public.member_conversations enable row level security;
alter table public.member_messages enable row level security;
alter table public.member_ai_usage_reservations enable row level security;
revoke all on table public.member_conversations, public.member_messages,
    public.member_ai_usage_reservations from anon, authenticated;
grant select, insert, update, delete on table public.member_conversations, public.member_messages to service_role;
grant select, insert, update on table public.member_ai_usage_reservations to service_role;

create or replace function public.reserve_member_ai_turn(
    p_request_id uuid,
    p_member_id uuid,
    p_model text,
    p_provider text,
    p_input_price_micro_usd_per_million bigint,
    p_output_price_micro_usd_per_million bigint,
    p_max_input_tokens bigint,
    p_max_output_tokens bigint,
    p_reserved_micro_usd bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_limit bigint := 5000000;
    v_month_start timestamptz := date_trunc('month', timezone('UTC', now())) at time zone 'UTC';
    v_committed bigint;
    v_turn_count bigint;
    v_first_turn timestamptz;
begin
    if auth.role() <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    if p_model = '' or p_provider = '' or p_reserved_micro_usd < 0
       or p_input_price_micro_usd_per_million < 0 or p_output_price_micro_usd_per_million < 0
       or p_max_input_tokens < 0 or p_max_output_tokens < 0 then
        raise exception 'invalid_member_ai_reservation' using errcode = '22023';
    end if;

    perform 1 from public.member_profiles where user_id = p_member_id for update;
    if not found then
        raise exception 'member_profile_not_found' using errcode = 'P0002';
    end if;

    select count(*), min(created_at) into v_turn_count, v_first_turn
      from public.member_ai_usage_reservations
     where member_id = p_member_id
       and created_at > now() - interval '1 hour'
       and reservation_status <> 'released';
    if v_turn_count >= 20 then
        return jsonb_build_object('allowed', false, 'reason', 'rate_limit',
            'retry_at', v_first_turn + interval '1 hour');
    end if;

    select coalesce(sum(case when reservation_status = 'settled' then actual_micro_usd
                             else reserved_micro_usd end), 0)::bigint
      into v_committed
      from public.member_ai_usage_reservations
     where member_id = p_member_id and created_at >= v_month_start
       and reservation_status <> 'released';
    if v_committed + p_reserved_micro_usd > v_limit then
        return jsonb_build_object('allowed', false, 'reason', 'monthly_budget_exceeded',
            'limit_micro_usd', v_limit, 'committed_micro_usd', v_committed);
    end if;

    insert into public.member_ai_usage_reservations (
        request_id, member_id, model, provider, input_price_micro_usd_per_million,
        output_price_micro_usd_per_million, max_input_tokens, max_output_tokens,
        reserved_micro_usd, reservation_status
    ) values (
        p_request_id, p_member_id, p_model, p_provider, p_input_price_micro_usd_per_million,
        p_output_price_micro_usd_per_million, p_max_input_tokens, p_max_output_tokens,
        p_reserved_micro_usd, 'reserved'
    );
    return jsonb_build_object('allowed', true, 'request_id', p_request_id,
        'limit_micro_usd', v_limit, 'committed_micro_usd', v_committed,
        'remaining_micro_usd', greatest(v_limit - v_committed - p_reserved_micro_usd, 0));
end;
$$;

create or replace function public.settle_member_ai_turn(
    p_request_id uuid,
    p_actual_micro_usd bigint,
    p_reservation_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.role() <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    if p_reservation_status not in ('settled', 'uncertain', 'released')
       or (p_reservation_status = 'settled' and (p_actual_micro_usd is null or p_actual_micro_usd < 0))
       or (p_reservation_status in ('uncertain', 'released') and p_actual_micro_usd is not null) then
        raise exception 'invalid_member_ai_settlement' using errcode = '22023';
    end if;
    update public.member_ai_usage_reservations
       set reservation_status = p_reservation_status,
           actual_micro_usd = p_actual_micro_usd,
           settled_at = now()
     where request_id = p_request_id and reservation_status = 'reserved';
    if not found then
        raise exception 'member_ai_reservation_not_found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.prune_expired_member_conversations(p_before timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_deleted bigint;
begin
    if auth.role() <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    delete from public.member_conversations
     where retention_hold = false
       and linked_request_id is null
       and last_activity_at < p_before;
    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$$;

revoke all on function public.reserve_member_ai_turn(uuid, uuid, text, text, bigint, bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.settle_member_ai_turn(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.prune_expired_member_conversations(timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_member_ai_turn(uuid, uuid, text, text, bigint, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.settle_member_ai_turn(uuid, bigint, text) to service_role;
grant execute on function public.prune_expired_member_conversations(timestamptz) to service_role;

comment on table public.member_conversations is
    'Member-owned AI discovery conversations, separate from Layer 7 business conversations.';
comment on table public.member_ai_usage_reservations is
    'Separate per-member AI rate and spend ledger; never stores prompt or response content.';
