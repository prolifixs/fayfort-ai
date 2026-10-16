-- Operations flow (docs/OPERATIONS_CENTER_PLAN.md): archive, work items for shop orders, group buys, giveaways,
-- photo reviews and billing issues, members answering "your input is needed", and payments that always move a
-- sourcing request on to Fulfillment.

-- 1. Work items may come from a non-request source, recorded in metadata as source_kind + source_id.
alter table public.operations_work_items
    drop constraint if exists operations_work_items_single_source,
    add constraint operations_work_items_single_source check (
        num_nonnulls(member_request_id, member_conversation_id, business_conversation_id, handoff_id, dispute_case_id) = 1
        or (
            num_nonnulls(member_request_id, member_conversation_id, business_conversation_id, handoff_id, dispute_case_id) = 0
            -- coalesce: a NULL here would make the whole check pass
            and coalesce(jsonb_typeof(metadata->'source_kind') = 'string', false)
            and coalesce(jsonb_typeof(metadata->'source_id') = 'string', false)
        )
    );
create unique index if not exists idx_operations_work_unique_metadata_source
    on public.operations_work_items((metadata->>'source_kind'), (metadata->>'source_id'))
    where metadata ? 'source_kind';
create index if not exists idx_operations_work_archive
    on public.operations_work_items(completed_at desc)
    where status in ('completed', 'cancelled');

-- 2. A member can answer "your input is needed": the request goes back to sourcing and the work item to the queue.
create or replace function public.member_answer_request_input(p_request_id uuid, p_member_id uuid, p_message text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_stage text;
    v_sequence bigint;
begin
    if length(btrim(coalesce(p_message, ''))) not between 1 and 2000 then
        raise exception 'answer must be 1 to 2000 characters';
    end if;
    perform 1 from public.member_purchase_requests
     where id = p_request_id and member_id = p_member_id for update;
    if not found then raise exception 'request not found'; end if;
    select event.stage, event.sequence_no into v_stage, v_sequence
      from public.member_request_events event
     where event.request_id = p_request_id
     order by event.sequence_no desc limit 1;
    if v_stage is distinct from 'needs_member_input' then
        raise exception 'request is not waiting for member input';
    end if;
    v_sequence := coalesce(v_sequence, 0) + 1;
    insert into public.member_request_events(request_id, sequence_no, stage, member_note, actor_user_id, details)
    values (p_request_id, v_sequence, 'sourcing', 'Member answered: ' || btrim(p_message), p_member_id, '{}'::jsonb);
    update public.member_purchase_requests set updated_at = now() where id = p_request_id;
    update public.operations_work_items
       set next_action = left('The member answered: ' || btrim(p_message), 500), updated_at = now()
     where member_request_id = p_request_id;
    return v_sequence;
end;
$$;
revoke all on function public.member_answer_request_input(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.member_answer_request_input(uuid, uuid, text) to service_role;

-- Staff can also resume sourcing after asking for details (needs_member_input -> sourcing).
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

-- 3. A paid order invoice confirms the purchase from any open sourcing stage, not only sourcing/options sent
--    (group-buy invoices arrive while each buyer's own request is still early).
create or replace function public.record_commerce_invoice_paid(p_invoice_id uuid, p_shopify_order_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_invoice public.commerce_invoices%rowtype;
    v_stage text;
    v_sequence bigint;
begin
    select * into v_invoice from public.commerce_invoices where id = p_invoice_id for update;
    if not found then raise exception 'invoice not found'; end if;
    if v_invoice.status = 'paid' then return 'already_paid'; end if;
    update public.commerce_invoices
       set status = 'paid', paid_at = now(), shopify_order_id = coalesce(p_shopify_order_id, shopify_order_id), error = null
     where id = p_invoice_id;
    if v_invoice.request_id is null or v_invoice.kind <> 'order' then return 'paid'; end if;
    perform 1 from public.member_purchase_requests where id = v_invoice.request_id for update;
    select event.stage, event.sequence_no into v_stage, v_sequence
      from public.member_request_events event
     where event.request_id = v_invoice.request_id
     order by event.sequence_no desc limit 1;
    if v_stage in ('submitted', 'under_review', 'sourcing', 'needs_member_input', 'options_sent') then
        insert into public.member_request_events(request_id, sequence_no, stage, member_note, actor_user_id, details)
        values (v_invoice.request_id, coalesce(v_sequence, 0) + 1, 'purchase_confirmed',
                'Payment received through your FayFort invoice.', null, '{}'::jsonb);
        update public.member_purchase_requests set updated_at = now() where id = v_invoice.request_id;
        return 'paid_and_confirmed';
    end if;
    return 'paid';
end;
$$;
revoke all on function public.record_commerce_invoice_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.record_commerce_invoice_paid(uuid, text) to service_role;

comment on index public.idx_operations_work_unique_metadata_source is
    'One work item per outside source (shop order, group buy, giveaway, photo review, billing issue, failed invoice).';
