-- Deadlines and delivery estimates (ETA), and members cancelling their own requests.
--
-- * Every new work item gets a deadline: 24 hours unless one was set. Cards in the Operations Center change
--   colour as the deadline gets closer and turn red with the time overdue once it passes.
-- * A member request needs a delivery estimate (eta_at) before it can move to Sourcing. The estimate is the
--   request's work-item deadline and the member sees it. Changing an estimate needs a reason; every change is kept.
-- * A member can cancel a request until it is paid. Unpaid invoices for it are cancelled (the API also deletes the
--   Shopify draft order so the link can't be paid).

-- 1. Delivery estimate on the request, plus its history.
alter table public.member_purchase_requests
    add column if not exists eta_at timestamptz,
    add column if not exists eta_reason text check (eta_reason is null or length(eta_reason) <= 500),
    add column if not exists eta_updated_at timestamptz;

create table if not exists public.member_request_eta_changes (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.member_purchase_requests(id) on delete cascade,
    previous_eta_at timestamptz,
    eta_at timestamptz not null,
    reason text check (reason is null or length(reason) <= 500),
    changed_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);
create index if not exists idx_member_request_eta_changes_request
    on public.member_request_eta_changes(request_id, created_at);
alter table public.member_request_eta_changes enable row level security;
revoke all on public.member_request_eta_changes from anon, authenticated;

-- 2. Every work item has a deadline: 24 hours from when it opens unless one was given.
create or replace function public.operations_default_due_at()
returns trigger language plpgsql set search_path = '' as $$
begin
    if new.due_at is null then
        new.due_at := coalesce(new.created_at, now()) + interval '24 hours';
    end if;
    return new;
end;
$$;
drop trigger if exists operations_work_default_due on public.operations_work_items;
create trigger operations_work_default_due
    before insert on public.operations_work_items
    for each row execute function public.operations_default_due_at();

update public.operations_work_items work
   set due_at = coalesce(request.eta_at, work.created_at + interval '24 hours')
  from (select id, eta_at from public.member_purchase_requests) request
 where work.due_at is null and work.status in ('open', 'claimed', 'waiting', 'blocked')
   and work.member_request_id = request.id;
update public.operations_work_items
   set due_at = created_at + interval '24 hours'
 where due_at is null and status in ('open', 'claimed', 'waiting', 'blocked');

-- 3. Set or change a work item's deadline. For a member request this is the delivery estimate the member sees.
--    The API checks who may do this (an administrator, or the worker who claimed the item).
create or replace function public.set_operations_work_due(
    p_work_item_id uuid,
    p_actor_id uuid,
    p_actor_type text,
    p_due_at timestamptz,
    p_reason text default null
) returns public.operations_work_items
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_item public.operations_work_items%rowtype;
    v_request public.member_purchase_requests%rowtype;
    v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
    v_first_estimate boolean := false;
    v_sequence bigint;
begin
    if p_actor_type not in ('worker', 'platform_admin') then raise exception 'invalid actor'; end if;
    if p_due_at is null or p_due_at <= now() then raise exception 'deadline must be in the future'; end if;
    if p_due_at > now() + interval '365 days' then raise exception 'deadline is too far away'; end if;
    if v_reason is not null and length(v_reason) > 500 then raise exception 'reason is too long'; end if;
    select * into v_item from public.operations_work_items where id = p_work_item_id for update;
    if not found then raise exception 'work item not found'; end if;
    if v_item.status in ('completed', 'cancelled') then raise exception 'work item is finished'; end if;

    if v_item.member_request_id is not null then
        select * into v_request from public.member_purchase_requests where id = v_item.member_request_id for update;
        v_first_estimate := v_request.eta_at is null;
    end if;
    if not v_first_estimate and length(coalesce(v_reason, '')) < 3 then
        raise exception 'a reason is required to change the deadline';
    end if;

    if v_item.member_request_id is not null then
        insert into public.member_request_eta_changes(request_id, previous_eta_at, eta_at, reason, changed_by)
        values (v_request.id, v_request.eta_at, p_due_at, v_reason, p_actor_id);
        update public.member_purchase_requests
           set eta_at = p_due_at, eta_reason = case when v_first_estimate then null else v_reason end,
               eta_updated_at = now(), updated_at = now()
         where id = v_request.id;
    end if;

    update public.operations_work_items
       set due_at = p_due_at, version = version + 1, updated_at = now()
     where id = v_item.id
    returning * into v_item;

    select coalesce(max(sequence_no), 0) + 1 into v_sequence
      from public.operations_work_events where work_item_id = v_item.id;
    insert into public.operations_work_events(work_item_id, sequence_no, event_type, actor_type, actor_user_id,
        previous_department, next_department, previous_status, next_status, reason, details)
    values (v_item.id, v_sequence, 'due_date_changed', p_actor_type, p_actor_id,
        v_item.department, v_item.department, v_item.status, v_item.status,
        coalesce(v_reason, case when v_first_estimate then 'Delivery estimate set.' else 'Deadline changed.' end),
        jsonb_build_object('due_at', p_due_at, 'member_request', v_item.member_request_id is not null));
    return v_item;
end;
$$;
revoke all on function public.set_operations_work_due(uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.set_operations_work_due(uuid, uuid, text, timestamptz, text) to service_role;

-- 4. Sourcing needs a delivery estimate first.
create or replace function public.append_member_request_milestone(
    p_request_id uuid,
    p_worker_id uuid,
    p_stage text,
    p_member_note text default null,
    p_details jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_request public.member_purchase_requests%rowtype;
    v_previous_stage text;
    v_sequence bigint;
    v_allowed boolean := false;
    v_operations_claimed boolean := false;
begin
    select * into v_request from public.member_purchase_requests
    where id = p_request_id for update;
    if not found then raise exception 'request not found'; end if;

    select exists (
        select 1 from public.operations_work_items work
        where work.member_request_id = p_request_id
          and work.assigned_worker_id = p_worker_id
          and work.status = 'claimed'
          and work.claimed_until > now()
          and work.department in ('sourcing', 'fulfillment')
    ) into v_operations_claimed;
    if (v_request.assigned_worker_id is distinct from p_worker_id and not v_operations_claimed)
       or not exists (
            select 1 from public.fayfort_workers worker
            where worker.user_id = p_worker_id and worker.status = 'active'
       ) then
        raise exception 'worker is not assigned to this request';
    end if;

    select event.stage, event.sequence_no into v_previous_stage, v_sequence
    from public.member_request_events event
    where event.request_id = p_request_id
    order by event.sequence_no desc limit 1;

    v_allowed := case v_previous_stage
        when 'submitted' then p_stage in ('under_review', 'cancelled')
        when 'under_review' then p_stage in ('sourcing', 'needs_member_input', 'cancelled')
        when 'sourcing' then p_stage in ('needs_member_input', 'options_sent', 'purchase_confirmed', 'item_in_warehouse', 'cancelled')
        when 'needs_member_input' then p_stage in ('sourcing', 'options_sent', 'cancelled')
        when 'options_sent' then p_stage in ('purchase_confirmed', 'cancelled')
        when 'purchase_confirmed' then p_stage in ('item_in_warehouse', 'cancelled')
        when 'item_in_warehouse' then p_stage in ('shipped', 'cancelled')
        when 'shipped' then p_stage in ('in_transit', 'out_for_delivery', 'delivered')
        when 'in_transit' then p_stage in ('out_for_delivery', 'delivered')
        when 'out_for_delivery' then p_stage = 'delivered'
        else false
    end;
    if not v_allowed then raise exception 'invalid request stage transition'; end if;
    if p_stage in ('sourcing', 'options_sent') and v_request.eta_at is null then
        raise exception 'set a delivery estimate before sourcing';
    end if;

    if p_stage = 'shipped' then
        if jsonb_typeof(p_details) <> 'object'
            or jsonb_typeof(p_details->'tracking_number') <> 'string'
            or length(btrim(p_details->>'tracking_number')) not between 1 and 120
            or (p_details->>'tracking_url' is not null and p_details->>'tracking_url' !~ '^https://[^[:space:]]+$')
            or (p_details->>'carrier_name' is not null and length(p_details->>'carrier_name') > 100)
            or p_details - 'carrier_name' - 'tracking_number' - 'tracking_url' <> '{}'::jsonb then
            raise exception 'shipped milestone requires a tracking number and valid shipment details';
        end if;
    elsif p_details <> '{}'::jsonb then
        raise exception 'details are only accepted for shipped milestones';
    end if;

    v_sequence := coalesce(v_sequence, 0) + 1;
    insert into public.member_request_events(request_id, sequence_no, stage, member_note, actor_user_id, details)
    values (p_request_id, v_sequence, p_stage, nullif(btrim(p_member_note), ''), p_worker_id, coalesce(p_details, '{}'::jsonb));
    update public.member_purchase_requests set updated_at = now() where id = p_request_id;
    return v_sequence;
end;
$$;
revoke all on function public.append_member_request_milestone(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.append_member_request_milestone(uuid, uuid, text, text, jsonb) to service_role;

-- A member's answer goes back to Sourcing when an estimate exists, otherwise back to review.
create or replace function public.member_answer_request_input(p_request_id uuid, p_member_id uuid, p_message text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_stage text;
    v_sequence bigint;
    v_eta timestamptz;
    v_next text;
begin
    if length(btrim(coalesce(p_message, ''))) not between 1 and 2000 then
        raise exception 'answer must be 1 to 2000 characters';
    end if;
    select eta_at into v_eta from public.member_purchase_requests
     where id = p_request_id and member_id = p_member_id for update;
    if not found then raise exception 'request not found'; end if;
    select event.stage, event.sequence_no into v_stage, v_sequence
      from public.member_request_events event
     where event.request_id = p_request_id
     order by event.sequence_no desc limit 1;
    if v_stage is distinct from 'needs_member_input' then
        raise exception 'request is not waiting for member input';
    end if;
    v_next := case when v_eta is null then 'under_review' else 'sourcing' end;
    v_sequence := coalesce(v_sequence, 0) + 1;
    insert into public.member_request_events(request_id, sequence_no, stage, member_note, actor_user_id, details)
    values (p_request_id, v_sequence, v_next, left('Member answered: ' || btrim(p_message), 1000), p_member_id, '{}'::jsonb);
    update public.member_purchase_requests set updated_at = now() where id = p_request_id;
    update public.operations_work_items
       set next_action = left('The member answered: ' || btrim(p_message), 500), updated_at = now()
     where member_request_id = p_request_id;
    return v_sequence;
end;
$$;
revoke all on function public.member_answer_request_input(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.member_answer_request_input(uuid, uuid, text) to service_role;

-- 5. A member cancels their own request before it is paid.
create or replace function public.member_cancel_request(p_request_id uuid, p_member_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_stage text;
    v_sequence bigint;
    v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
    v_drafts text[];
begin
    if v_reason is not null and length(v_reason) > 500 then raise exception 'reason is too long'; end if;
    perform 1 from public.member_purchase_requests
     where id = p_request_id and member_id = p_member_id for update;
    if not found then raise exception 'request not found'; end if;
    select event.stage, event.sequence_no into v_stage, v_sequence
      from public.member_request_events event
     where event.request_id = p_request_id
     order by event.sequence_no desc limit 1;
    if coalesce(v_stage, 'submitted') not in ('submitted', 'under_review', 'sourcing', 'needs_member_input', 'options_sent') then
        raise exception 'request can no longer be cancelled';
    end if;
    if exists (select 1 from public.commerce_invoices where request_id = p_request_id and status = 'paid') then
        raise exception 'request has a payment';
    end if;
    with cancelled as (
        update public.commerce_invoices
           set status = 'cancelled', error = 'The member cancelled the request.'
         where request_id = p_request_id and status in ('draft', 'sent')
     returning shopify_draft_order_id
    )
    select coalesce(array_agg(shopify_draft_order_id) filter (where shopify_draft_order_id is not null), '{}')
      into v_drafts from cancelled;
    v_sequence := coalesce(v_sequence, 0) + 1;
    insert into public.member_request_events(request_id, sequence_no, stage, member_note, actor_user_id, details)
    values (p_request_id, v_sequence, 'cancelled',
            left('You cancelled this request.' || coalesce(' Reason: ' || v_reason, ''), 1000), p_member_id, '{}'::jsonb);
    update public.member_purchase_requests set updated_at = now() where id = p_request_id;
    return jsonb_build_object('sequence_no', v_sequence, 'draft_order_ids', to_jsonb(v_drafts));
end;
$$;
revoke all on function public.member_cancel_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.member_cancel_request(uuid, uuid, text) to service_role;
