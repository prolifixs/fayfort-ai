-- Records a member's recurring-request intent without creating executable schedules.
-- Commercial rules, scheduler claims, orders, and billing are deliberately out of scope.

create table if not exists public.member_request_schedule_intents (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null unique references public.member_purchase_requests(id) on delete cascade,
    member_id uuid not null references auth.users(id) on delete cascade,
    idempotency_key uuid not null,
    request_fingerprint text not null check (length(request_fingerprint) = 32),
    cadence text not null check (cadence in ('monthly', 'quarterly', 'yearly', 'custom')),
    interval_count integer not null check (interval_count between 1 and 365),
    interval_unit text not null check (interval_unit in ('days', 'weeks', 'months')),
    units_per_order integer not null check (units_per_order between 1 and 10000),
    occurrence_count integer not null check (occurrence_count between 1 and 120),
    status text not null default 'awaiting_policy'
        check (status = 'awaiting_policy'),
    created_at timestamptz not null default now(),
    constraint member_request_schedule_intents_fixed_cadence_check check (
        (cadence = 'monthly' and interval_count = 1 and interval_unit = 'months')
        or (cadence = 'quarterly' and interval_count = 3 and interval_unit = 'months')
        or (cadence = 'yearly' and interval_count = 12 and interval_unit = 'months')
        or (cadence = 'custom')
    ),
    constraint member_request_schedule_intents_member_idempotency_key
        unique (member_id, idempotency_key)
);

create index if not exists idx_member_request_schedule_intents_member_created
    on public.member_request_schedule_intents(member_id, created_at desc);

alter table public.member_request_schedule_intents enable row level security;
revoke all on public.member_request_schedule_intents from anon, authenticated;
grant select on public.member_request_schedule_intents to authenticated;
grant all on public.member_request_schedule_intents to service_role;

drop policy if exists member_request_schedule_intents_read_own
    on public.member_request_schedule_intents;
create policy member_request_schedule_intents_read_own
    on public.member_request_schedule_intents for select to authenticated
    using (member_id = (select auth.uid()));

create or replace function public.create_member_recurring_request_intent(
    p_member_id uuid,
    p_request_title text,
    p_request_description text default null,
    p_product_id uuid default null,
    p_source_type text default 'description',
    p_source_url text default null,
    p_source_image jsonb default null,
    p_conversation_id uuid default null,
    p_recurrence jsonb default '{}'::jsonb,
    p_idempotency_key uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_request_id uuid;
    v_schedule_intent_id uuid;
    v_cadence text;
    v_interval_count integer;
    v_interval_unit text;
    v_units_per_order integer;
    v_occurrence_count integer;
    v_request_fingerprint text;
begin
    if auth.role() <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    if p_idempotency_key is null then
        raise exception 'idempotency_key_required';
    end if;
    if jsonb_typeof(p_recurrence) <> 'object'
       or coalesce(p_recurrence->>'cadence', '') not in ('monthly', 'quarterly', 'yearly', 'custom')
       or coalesce(p_recurrence->>'interval_count', '') !~ '^[0-9]{1,3}$'
       or coalesce(p_recurrence->>'units_per_order', '') !~ '^[0-9]{1,5}$'
       or coalesce(p_recurrence->>'occurrence_count', '') !~ '^[0-9]{1,3}$' then
        raise exception 'invalid_recurrence_intent';
    end if;

    v_cadence := p_recurrence->>'cadence';
    v_interval_count := (p_recurrence->>'interval_count')::integer;
    v_interval_unit := p_recurrence->>'interval_unit';
    v_units_per_order := (p_recurrence->>'units_per_order')::integer;
    v_occurrence_count := (p_recurrence->>'occurrence_count')::integer;
    if v_interval_count not between 1 and 365
       or v_units_per_order not between 1 and 10000
       or v_occurrence_count not between 1 and 120
       or coalesce(v_interval_unit, '') not in ('days', 'weeks', 'months')
       or (v_cadence = 'monthly' and (v_interval_count <> 1 or v_interval_unit <> 'months'))
       or (v_cadence = 'quarterly' and (v_interval_count <> 3 or v_interval_unit <> 'months'))
       or (v_cadence = 'yearly' and (v_interval_count <> 12 or v_interval_unit <> 'months')) then
        raise exception 'invalid_recurrence_intent';
    end if;

    v_request_fingerprint := md5(jsonb_build_object(
        'request_title', btrim(p_request_title),
        'request_description', nullif(btrim(p_request_description), ''),
        'product_id', p_product_id,
        'source_type', p_source_type,
        'source_url', p_source_url,
        'source_image', p_source_image,
        'conversation_id', p_conversation_id,
        'recurrence', p_recurrence
    )::text);
    perform pg_advisory_xact_lock(hashtextextended(p_member_id::text || p_idempotency_key::text, 0));
    select id, request_id into v_schedule_intent_id, v_request_id
      from public.member_request_schedule_intents
     where member_id = p_member_id and idempotency_key = p_idempotency_key;
    if found then
        if (select request_fingerprint from public.member_request_schedule_intents
             where id = v_schedule_intent_id) <> v_request_fingerprint then
            raise exception 'idempotency_key_reused';
        end if;
        return jsonb_build_object(
            'request_id', v_request_id,
            'schedule_intent_id', v_schedule_intent_id,
            'status', 'awaiting_policy'
        );
    end if;

    if p_conversation_id is not null then
        v_request_id := public.create_member_request_from_chat(
            p_member_id, p_conversation_id, p_request_title, p_request_description,
            p_product_id, p_source_type, p_source_url, p_source_image
        );
    else
        v_request_id := public.create_member_purchase_request(
            p_member_id, p_request_title, p_request_description, p_product_id,
            p_source_type, p_source_url, p_source_image
        );
    end if;

    insert into public.member_request_schedule_intents (
        request_id, member_id, idempotency_key, request_fingerprint,
        cadence, interval_count, interval_unit,
        units_per_order, occurrence_count
    ) values (
        v_request_id, p_member_id, p_idempotency_key, v_request_fingerprint,
        v_cadence, v_interval_count, v_interval_unit,
        v_units_per_order, v_occurrence_count
    ) returning id into v_schedule_intent_id;

    return jsonb_build_object(
        'request_id', v_request_id,
        'schedule_intent_id', v_schedule_intent_id,
        'status', 'awaiting_policy'
    );
end;
$$;

revoke all on function public.create_member_recurring_request_intent(
    uuid, text, text, uuid, text, text, jsonb, uuid, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.create_member_recurring_request_intent(
    uuid, text, text, uuid, text, text, jsonb, uuid, jsonb, uuid
) to service_role;

comment on table public.member_request_schedule_intents is
    'Non-executable member recurrence preferences. No scheduler, order, or payment may consume awaiting_policy rows.';
