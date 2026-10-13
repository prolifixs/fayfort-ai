-- Executable recurrence is limited to creating future sourcing requests.
-- This migration adds no scheduler installation, order creation, or payment call.

create table if not exists public.member_request_schedules (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references auth.users(id) on delete cascade,
    intent_id uuid not null unique references public.member_request_schedule_intents(id) on delete cascade,
    originating_request_id uuid not null unique references public.member_purchase_requests(id) on delete cascade,
    cadence text not null check (cadence in ('monthly', 'quarterly', 'yearly', 'custom')),
    interval_count integer not null check (interval_count between 1 and 365),
    interval_unit text not null check (interval_unit in ('days', 'weeks', 'months')),
    units_per_order integer not null check (units_per_order between 1 and 10000),
    occurrence_limit integer not null check (occurrence_limit between 1 and 12),
    time_zone text not null,
    anchor_local timestamp without time zone not null,
    anchor_occurrence_number integer not null default 2 check (anchor_occurrence_number between 2 and 12),
    next_occurrence_number integer not null default 2 check (next_occurrence_number between 2 and 13),
    next_due_at timestamptz not null,
    expires_at timestamptz not null,
    status text not null default 'active' check (status in ('active', 'paused', 'cancelled', 'completed')),
    version integer not null default 1 check (version > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint member_request_schedules_fixed_cadence check (
        (cadence = 'monthly' and interval_count = 1 and interval_unit = 'months')
        or (cadence = 'quarterly' and interval_count = 3 and interval_unit = 'months')
        or (cadence = 'yearly' and interval_count = 12 and interval_unit = 'months')
        or cadence = 'custom'
    )
);

create index if not exists idx_member_request_schedules_due
    on public.member_request_schedules(next_due_at, created_at)
    where status = 'active';

create table if not exists public.member_request_schedule_occurrences (
    id uuid primary key default gen_random_uuid(),
    schedule_id uuid not null references public.member_request_schedules(id) on delete cascade,
    occurrence_number integer not null check (occurrence_number between 1 and 12),
    request_id uuid unique references public.member_purchase_requests(id) on delete set null,
    quote_option_id uuid references public.operations_sourcing_member_options(id) on delete set null,
    accepted_quote_price numeric(14,2),
    accepted_quote_currency text check (accepted_quote_currency is null or accepted_quote_currency ~ '^[A-Z]{3}$'),
    quote_accepted_at timestamptz,
    due_at timestamptz not null,
    status text not null check (status in ('created', 'skipped')),
    created_at timestamptz not null default now(),
    unique(schedule_id, occurrence_number),
    check ((status = 'created' and request_id is not null) or (status = 'skipped' and request_id is null)),
    check ((quote_option_id is null and accepted_quote_price is null and accepted_quote_currency is null and quote_accepted_at is null)
        or (quote_option_id is not null and accepted_quote_price is not null and accepted_quote_currency is not null and quote_accepted_at is not null))
);

create index if not exists idx_member_request_schedule_occurrences_schedule
    on public.member_request_schedule_occurrences(schedule_id, occurrence_number);

-- A screenshot can be reused by future request cycles while remaining private.
alter table public.member_request_source_media
    drop constraint if exists member_request_source_media_storage_path_key;

create table if not exists public.member_request_schedule_events (
    id uuid primary key default gen_random_uuid(),
    schedule_id uuid not null references public.member_request_schedules(id) on delete cascade,
    sequence_no bigint not null check (sequence_no > 0),
    event_type text not null check (event_type in ('activated', 'paused', 'resumed', 'cancelled', 'occurrence_created', 'occurrence_skipped', 'quote_accepted', 'completed')),
    occurrence_number integer,
    details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
    actor_member_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    unique(schedule_id, sequence_no)
);

create or replace function public.prevent_member_request_schedule_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
    raise exception 'member request schedule events are append-only';
end;
$$;
drop trigger if exists member_request_schedule_events_append_only on public.member_request_schedule_events;
create trigger member_request_schedule_events_append_only
    before update or delete on public.member_request_schedule_events
    for each row execute function public.prevent_member_request_schedule_event_mutation();

alter table public.member_request_schedules enable row level security;
alter table public.member_request_schedule_occurrences enable row level security;
alter table public.member_request_schedule_events enable row level security;
revoke all on public.member_request_schedules, public.member_request_schedule_occurrences,
    public.member_request_schedule_events from anon, authenticated;
grant select on public.member_request_schedules, public.member_request_schedule_occurrences,
    public.member_request_schedule_events to authenticated;
grant all on public.member_request_schedules, public.member_request_schedule_occurrences,
    public.member_request_schedule_events to service_role;

drop policy if exists member_request_schedules_read_own on public.member_request_schedules;
create policy member_request_schedules_read_own on public.member_request_schedules
    for select to authenticated using (member_id = (select auth.uid()));
drop policy if exists member_request_schedule_occurrences_read_own on public.member_request_schedule_occurrences;
create policy member_request_schedule_occurrences_read_own on public.member_request_schedule_occurrences
    for select to authenticated using (exists (
        select 1 from public.member_request_schedules schedule
         where schedule.id = schedule_id and schedule.member_id = (select auth.uid())
    ));
drop policy if exists member_request_schedule_events_read_own on public.member_request_schedule_events;
create policy member_request_schedule_events_read_own on public.member_request_schedule_events
    for select to authenticated using (exists (
        select 1 from public.member_request_schedules schedule
         where schedule.id = schedule_id and schedule.member_id = (select auth.uid())
    ));

create or replace function public.append_member_request_schedule_event(
    p_schedule_id uuid, p_event_type text, p_occurrence_number integer default null,
    p_details jsonb default '{}'::jsonb, p_actor_member_id uuid default null
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_seq bigint;
begin
    select coalesce(max(sequence_no), 0) + 1 into v_seq
      from public.member_request_schedule_events where schedule_id = p_schedule_id;
    insert into public.member_request_schedule_events(
        schedule_id, sequence_no, event_type, occurrence_number, details, actor_member_id
    ) values (p_schedule_id, v_seq, p_event_type, p_occurrence_number, coalesce(p_details, '{}'::jsonb), p_actor_member_id);
    return v_seq;
end;
$$;

create or replace function public.activate_member_request_schedule(
    p_member_id uuid, p_intent_id uuid, p_time_zone text, p_first_repeat_at timestamptz,
    p_policy_version text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_intent public.member_request_schedule_intents%rowtype;
    v_request public.member_purchase_requests%rowtype;
    v_schedule public.member_request_schedules%rowtype;
    v_anchor timestamp without time zone;
    v_first timestamptz;
begin
    if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
    if p_policy_version <> 'mvp-v1' then raise exception 'policy_version_required'; end if;
    if p_first_repeat_at <= now() or p_first_repeat_at >= now() + interval '12 months' then
        raise exception 'first_repeat_out_of_range';
    end if;
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
        raise exception 'invalid_time_zone';
    end if;
    select * into v_intent from public.member_request_schedule_intents
     where id = p_intent_id and member_id = p_member_id for update;
    if not found then raise exception 'schedule_intent_not_found'; end if;
    select * into v_request from public.member_purchase_requests
     where id = v_intent.request_id and member_id = p_member_id;
    if not found then raise exception 'schedule_request_not_found'; end if;
    select * into v_schedule from public.member_request_schedules where intent_id = p_intent_id;
    if found then
        if v_schedule.time_zone <> p_time_zone or v_schedule.next_due_at <> p_first_repeat_at then
            raise exception 'schedule_already_activated';
        end if;
        return jsonb_build_object('schedule_id', v_schedule.id, 'status', v_schedule.status, 'version', v_schedule.version);
    end if;
    v_anchor := p_first_repeat_at at time zone p_time_zone;
    insert into public.member_request_schedules(
        member_id, intent_id, originating_request_id, cadence, interval_count, interval_unit,
        units_per_order, occurrence_limit, time_zone, anchor_local, next_due_at, expires_at, status
    ) values (
        p_member_id, p_intent_id, v_request.id, v_intent.cadence, v_intent.interval_count,
        v_intent.interval_unit, v_intent.units_per_order, least(v_intent.occurrence_count, 12),
        p_time_zone, v_anchor, p_first_repeat_at, now() + interval '12 months',
        case when v_intent.occurrence_count = 1 then 'completed' else 'active' end
    ) returning * into v_schedule;
    insert into public.member_request_schedule_occurrences(schedule_id, occurrence_number, request_id, due_at, status)
    values (v_schedule.id, 1, v_request.id, v_request.created_at, 'created');
    perform public.append_member_request_schedule_event(v_schedule.id, 'activated', 1,
        jsonb_build_object('policy_version', p_policy_version, 'time_zone', p_time_zone), p_member_id);
    if v_schedule.status = 'completed' then
        perform public.append_member_request_schedule_event(v_schedule.id, 'completed', 1, '{}'::jsonb, p_member_id);
    end if;
    return jsonb_build_object('schedule_id', v_schedule.id, 'status', v_schedule.status, 'version', v_schedule.version);
end;
$$;

create or replace function public.set_member_request_schedule_state(
    p_member_id uuid, p_schedule_id uuid, p_action text, p_expected_version integer,
    p_resume_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_schedule public.member_request_schedules%rowtype; v_new_status text;
begin
    if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
    select * into v_schedule from public.member_request_schedules
     where id = p_schedule_id and member_id = p_member_id for update;
    if not found then raise exception 'schedule_not_found'; end if;
    if v_schedule.version <> p_expected_version then raise exception 'schedule_version_conflict'; end if;
    if p_action = 'pause' and v_schedule.status = 'active' then v_new_status := 'paused';
    elsif p_action = 'resume' and v_schedule.status = 'paused' and p_resume_at > now()
          and p_resume_at <= now() + interval '12 months' then
        v_new_status := 'active';
        v_schedule.anchor_local := p_resume_at at time zone v_schedule.time_zone;
        v_schedule.next_due_at := p_resume_at;
    elsif p_action = 'cancel' and v_schedule.status in ('active', 'paused') then v_new_status := 'cancelled';
    else raise exception 'invalid_schedule_action';
    end if;
    update public.member_request_schedules set status = v_new_status,
        anchor_local = v_schedule.anchor_local,
        anchor_occurrence_number = case when p_action = 'resume' then v_schedule.next_occurrence_number else v_schedule.anchor_occurrence_number end,
        next_due_at = v_schedule.next_due_at,
        version = version + 1, updated_at = now()
     where id = p_schedule_id returning * into v_schedule;
    perform public.append_member_request_schedule_event(v_schedule.id,
        case p_action when 'pause' then 'paused' when 'resume' then 'resumed' else 'cancelled' end, null,
        case when p_action = 'resume' then jsonb_build_object('next_due_at', p_resume_at) else '{}'::jsonb end,
        p_member_id);
    return jsonb_build_object('schedule_id', v_schedule.id, 'status', v_schedule.status, 'version', v_schedule.version);
end;
$$;

create or replace function public.resolve_member_schedule_local_time(
    p_local timestamp without time zone, p_time_zone text
) returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare
    v_offset_minutes integer;
    v_local timestamp without time zone;
    v_utc timestamptz;
begin
    -- Search valid instants for this wall-clock value. If DST repeats an hour,
    -- choose the earlier instant. If DST skips it, advance to the first valid minute.
    for v_offset_minutes in 0..180 loop
        v_local := p_local + make_interval(mins => v_offset_minutes);
        select min(candidate) into v_utc
          from pg_catalog.generate_series(
                (v_local at time zone 'UTC') - interval '18 hours',
                (v_local at time zone 'UTC') + interval '18 hours',
                interval '15 minutes'
          ) candidate
         where timezone(p_time_zone, candidate) = v_local;
        if v_utc is not null then return v_utc; end if;
    end loop;
    raise exception 'local_time_not_resolvable';
end;
$$;

create or replace function public.accept_member_recurring_request_quote(
    p_member_id uuid, p_request_id uuid, p_option_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_occurrence public.member_request_schedule_occurrences%rowtype;
    v_option public.operations_sourcing_member_options%rowtype;
    v_stage text;
begin
    if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
    select occurrence.* into v_occurrence
      from public.member_request_schedule_occurrences occurrence
      join public.member_request_schedules schedule on schedule.id = occurrence.schedule_id
     where occurrence.request_id = p_request_id and schedule.member_id = p_member_id for update;
    if not found then raise exception 'recurring_occurrence_not_found'; end if;
    select event.stage into v_stage from public.member_request_events event
     where event.request_id = p_request_id order by event.sequence_no desc limit 1;
    if v_stage <> 'options_sent' then raise exception 'recurring_quote_not_available'; end if;
    select * into v_option from public.operations_sourcing_member_options option
     where option.id = p_option_id and option.request_id = p_request_id
       and option.status in ('offered', 'selected') for update;
    if not found or v_option.price_amount is null or v_option.currency is null then
        raise exception 'recurring_quote_missing_price';
    end if;
    perform public.select_member_sourcing_option(p_request_id, p_option_id, p_member_id);
    update public.member_request_schedule_occurrences set quote_option_id = p_option_id,
        accepted_quote_price = v_option.price_amount, accepted_quote_currency = v_option.currency,
        quote_accepted_at = now()
     where id = v_occurrence.id;
    perform public.append_member_request_schedule_event(v_occurrence.schedule_id, 'quote_accepted',
        v_occurrence.occurrence_number, jsonb_build_object(
            'request_id', p_request_id, 'option_id', p_option_id,
            'price', v_option.price_amount, 'currency', v_option.currency
        ), p_member_id);
    return jsonb_build_object('request_id', p_request_id, 'option_id', p_option_id,
        'accepted_price', v_option.price_amount, 'currency', v_option.currency, 'payment_status', 'not_paid');
end;
$$;

create or replace function public.require_recurring_quote_acceptance_before_purchase()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.stage = 'purchase_confirmed' and exists (
        select 1 from public.member_request_schedule_occurrences occurrence
         where occurrence.request_id = new.request_id and occurrence.status = 'created'
           and occurrence.quote_accepted_at is null
    ) then
        raise exception 'recurring_quote_not_accepted';
    end if;
    return new;
end;
$$;
drop trigger if exists member_request_recurring_quote_gate on public.member_request_events;
create trigger member_request_recurring_quote_gate
    before insert on public.member_request_events
    for each row execute function public.require_recurring_quote_acceptance_before_purchase();

create or replace function public.clear_member_recurring_quote_acceptance_on_requote()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if (new.product_name, new.product_url, new.price_amount, new.currency, new.availability, new.status)
       is distinct from (old.product_name, old.product_url, old.price_amount, old.currency, old.availability, old.status) then
        update public.member_request_schedule_occurrences set quote_option_id = null,
            accepted_quote_price = null, accepted_quote_currency = null, quote_accepted_at = null
         where quote_option_id = old.id;
    end if;
    return new;
end;
$$;
drop trigger if exists member_request_recurring_quote_reset on public.operations_sourcing_member_options;
create trigger member_request_recurring_quote_reset
    after update on public.operations_sourcing_member_options
    for each row execute function public.clear_member_recurring_quote_acceptance_on_requote();

create or replace function public.materialize_due_member_request_schedules(p_limit integer default 50)
returns integer language plpgsql security definer set search_path = '' as $$
declare
    v_schedule public.member_request_schedules%rowtype;
    v_origin public.member_purchase_requests%rowtype;
    v_request_id uuid;
    v_due_local timestamp without time zone;
    v_due_at timestamptz;
    v_step integer;
    v_created integer := 0;
    v_next_no integer;
begin
    if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
    if p_limit not between 1 and 200 then raise exception 'invalid_batch_size'; end if;
    for v_schedule in
        select * from public.member_request_schedules
         where status = 'active' and next_due_at <= now()
         order by next_due_at, id limit p_limit for update skip locked
    loop
        if now() >= v_schedule.expires_at or v_schedule.next_occurrence_number > v_schedule.occurrence_limit then
            update public.member_request_schedules set status = 'completed', version = version + 1, updated_at = now()
             where id = v_schedule.id;
            perform public.append_member_request_schedule_event(v_schedule.id, 'completed', null, '{}'::jsonb, null);
            continue;
        end if;
        v_due_local := v_schedule.anchor_local;
        v_step := v_schedule.next_occurrence_number - v_schedule.anchor_occurrence_number;
        if v_schedule.interval_unit = 'months' then
            v_due_local := v_due_local + make_interval(months => v_schedule.interval_count * v_step);
        elsif v_schedule.interval_unit = 'weeks' then
            v_due_local := v_due_local + make_interval(days => v_schedule.interval_count * v_step * 7);
        else
            v_due_local := v_due_local + make_interval(days => v_schedule.interval_count * v_step);
        end if;
        v_due_at := public.resolve_member_schedule_local_time(v_due_local, v_schedule.time_zone);
        if v_due_at > now() then
            update public.member_request_schedules set next_due_at = v_due_at, updated_at = now()
             where id = v_schedule.id;
            continue;
        end if;
        select * into v_origin from public.member_purchase_requests where id = v_schedule.originating_request_id;
        if not found then
            update public.member_request_schedules set status = 'cancelled', version = version + 1, updated_at = now()
             where id = v_schedule.id;
            perform public.append_member_request_schedule_event(v_schedule.id, 'cancelled', null,
                jsonb_build_object('reason', 'originating_request_missing'), null);
            continue;
        end if;
        insert into public.member_purchase_requests(
            member_id, product_id, product_name_snapshot, request_title, request_description,
            source_type, source_url
        ) values (
            v_origin.member_id, v_origin.product_id, v_origin.product_name_snapshot,
            v_origin.request_title, v_origin.request_description, v_origin.source_type, v_origin.source_url
        ) returning id into v_request_id;
        insert into public.member_request_events(request_id, sequence_no, stage, actor_user_id)
        values (v_request_id, 1, 'submitted', v_origin.member_id);
        if v_origin.source_type = 'image' then
            insert into public.member_request_source_media(
                request_id, member_id, storage_path, content_type, byte_size, original_filename
            ) select v_request_id, member_id, storage_path, content_type, byte_size, original_filename
                from public.member_request_source_media where request_id = v_origin.id;
        end if;
        insert into public.member_request_schedule_occurrences(schedule_id, occurrence_number, request_id, due_at, status)
        values (v_schedule.id, v_schedule.next_occurrence_number, v_request_id, v_due_at, 'created');
        perform public.append_member_request_schedule_event(v_schedule.id, 'occurrence_created',
            v_schedule.next_occurrence_number, jsonb_build_object('request_id', v_request_id), null);
        v_created := v_created + 1;
        v_next_no := v_schedule.next_occurrence_number + 1;
        while v_next_no <= v_schedule.occurrence_limit loop
            v_due_local := v_schedule.anchor_local;
            v_step := v_next_no - v_schedule.anchor_occurrence_number;
            if v_schedule.interval_unit = 'months' then
                v_due_local := v_due_local + make_interval(months => v_schedule.interval_count * v_step);
            elsif v_schedule.interval_unit = 'weeks' then
                v_due_local := v_due_local + make_interval(days => v_schedule.interval_count * v_step * 7);
            else
                v_due_local := v_due_local + make_interval(days => v_schedule.interval_count * v_step);
            end if;
            v_due_at := public.resolve_member_schedule_local_time(v_due_local, v_schedule.time_zone);
            exit when v_due_at > now();
            insert into public.member_request_schedule_occurrences(schedule_id, occurrence_number, request_id, due_at, status)
            values (v_schedule.id, v_next_no, null, v_due_at, 'skipped');
            perform public.append_member_request_schedule_event(v_schedule.id, 'occurrence_skipped',
                v_next_no, jsonb_build_object('reason', 'missed_cycle'), null);
            v_next_no := v_next_no + 1;
        end loop;
        if v_next_no > v_schedule.occurrence_limit or v_schedule.expires_at <= now() then
            update public.member_request_schedules set status = 'completed', next_occurrence_number = least(v_next_no, 13),
                version = version + 1, updated_at = now() where id = v_schedule.id;
            perform public.append_member_request_schedule_event(v_schedule.id, 'completed', null, '{}'::jsonb, null);
        else
            v_due_local := v_schedule.anchor_local;
            v_step := v_next_no - v_schedule.anchor_occurrence_number;
            if v_schedule.interval_unit = 'months' then
                v_due_local := v_due_local + make_interval(months => v_schedule.interval_count * v_step);
            elsif v_schedule.interval_unit = 'weeks' then
                v_due_local := v_due_local + make_interval(days => v_schedule.interval_count * v_step * 7);
            else
                v_due_local := v_due_local + make_interval(days => v_schedule.interval_count * v_step);
            end if;
            update public.member_request_schedules set next_occurrence_number = v_next_no,
                next_due_at = public.resolve_member_schedule_local_time(v_due_local, v_schedule.time_zone),
                version = version + 1, updated_at = now() where id = v_schedule.id;
        end if;
    end loop;
    return v_created;
end;
$$;

revoke all on function public.append_member_request_schedule_event(uuid, text, integer, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.prevent_member_request_schedule_event_mutation() from public, anon, authenticated;
revoke all on function public.resolve_member_schedule_local_time(timestamp without time zone, text) from public, anon, authenticated;
revoke all on function public.require_recurring_quote_acceptance_before_purchase() from public, anon, authenticated;
revoke all on function public.clear_member_recurring_quote_acceptance_on_requote() from public, anon, authenticated;
revoke all on function public.accept_member_recurring_request_quote(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.activate_member_request_schedule(uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.set_member_request_schedule_state(uuid, uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.materialize_due_member_request_schedules(integer) from public, anon, authenticated;
grant execute on function public.activate_member_request_schedule(uuid, uuid, text, timestamptz, text) to service_role;
grant execute on function public.set_member_request_schedule_state(uuid, uuid, text, integer, timestamptz) to service_role;
grant execute on function public.materialize_due_member_request_schedules(integer) to service_role;
grant execute on function public.accept_member_recurring_request_quote(uuid, uuid, uuid) to service_role;

comment on table public.member_request_schedules is
    'Member-approved schedules that create sourcing requests only. No order or charge is executed.';
comment on function public.materialize_due_member_request_schedules(integer) is
    'Service-only idempotent due-cycle materializer. Requires an external scheduler; creates requests and Operations items only.';
