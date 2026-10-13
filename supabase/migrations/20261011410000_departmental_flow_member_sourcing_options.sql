-- Member-safe snapshots of sourcing candidates and explicit member selection.
-- Supplier identities and staff evidence remain in operations_sourcing_candidates.

create table if not exists public.operations_sourcing_member_options (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.member_purchase_requests(id) on delete cascade,
    work_item_id uuid not null references public.operations_work_items(id) on delete cascade,
    candidate_id uuid not null references public.operations_sourcing_candidates(id) on delete cascade,
    product_name text not null check (length(btrim(product_name)) between 1 and 240),
    product_url text not null check (length(product_url) between 8 and 2000 and product_url ~ '^https?://'),
    price_amount numeric(14,2) check (price_amount is null or price_amount >= 0),
    currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
    availability text check (availability is null or length(availability) <= 240),
    member_note text check (member_note is null or length(member_note) <= 1000),
    status text not null default 'offered' check (status in ('offered', 'selected', 'declined', 'withdrawn')),
    shared_by uuid not null references auth.users(id),
    selected_at timestamptz,
    created_at timestamptz not null default now(),
    unique (request_id, candidate_id),
    constraint operations_sourcing_member_option_selection_state check (
        (status = 'selected' and selected_at is not null) or (status <> 'selected' and selected_at is null)
    )
);
create index if not exists idx_operations_sourcing_member_options_request
    on public.operations_sourcing_member_options(request_id, created_at desc);

alter table public.operations_sourcing_member_options enable row level security;
revoke all on public.operations_sourcing_member_options from public, anon, authenticated;
grant all on public.operations_sourcing_member_options to service_role;

create or replace function public.share_operations_sourcing_options(
    p_request_id uuid, p_work_item_id uuid, p_candidate_ids uuid[], p_actor_id uuid, p_member_note text default null
) returns setof public.operations_sourcing_member_options
language plpgsql security definer set search_path = '' as $$
declare
    v_request public.member_purchase_requests%rowtype;
    v_stage text;
    v_sequence bigint;
    v_count integer;
begin
    if p_actor_id is null or coalesce(cardinality(p_candidate_ids), 0) not between 1 and 10
       or (p_member_note is not null and length(p_member_note) > 1000) then
        raise exception 'invalid sourcing option input';
    end if;
    if (select count(distinct candidate_id) from unnest(p_candidate_ids) as ids(candidate_id)) <> cardinality(p_candidate_ids) then
        raise exception 'duplicate sourcing candidate';
    end if;
    select * into v_request from public.member_purchase_requests where id = p_request_id for update;
    if not found then raise exception 'request not found'; end if;
    if not exists (select 1 from public.operations_work_items work
        where work.id = p_work_item_id and work.member_request_id = p_request_id and work.department = 'sourcing') then
        raise exception 'sourcing work item mismatch';
    end if;
    select event.stage, event.sequence_no into v_stage, v_sequence
    from public.member_request_events event where event.request_id = p_request_id
    order by event.sequence_no desc limit 1;
    if v_stage not in ('sourcing', 'needs_member_input', 'options_sent') then
        raise exception 'request is not ready for sourcing options';
    end if;
    select count(*) into v_count from public.operations_sourcing_candidates candidate
    where candidate.id = any(p_candidate_ids) and candidate.work_item_id = p_work_item_id
      and candidate.member_request_id = p_request_id;
    if v_count <> cardinality(p_candidate_ids) then raise exception 'candidate does not belong to this request'; end if;
    insert into public.operations_sourcing_member_options(
        request_id, work_item_id, candidate_id, product_name, product_url, price_amount, currency,
        availability, member_note, shared_by
    )
    select p_request_id, p_work_item_id, candidate.id, candidate.product_name, candidate.product_url,
        candidate.price_amount, candidate.currency, candidate.availability, nullif(btrim(p_member_note), ''), p_actor_id
    from public.operations_sourcing_candidates candidate
    where candidate.id = any(p_candidate_ids)
    on conflict (request_id, candidate_id) do update set
        product_name = excluded.product_name, product_url = excluded.product_url,
        price_amount = excluded.price_amount, currency = excluded.currency,
        availability = excluded.availability, member_note = excluded.member_note,
        status = 'offered', selected_at = null, shared_by = excluded.shared_by, created_at = now();
    if v_stage <> 'options_sent' then
        v_sequence := coalesce(v_sequence, 0) + 1;
        insert into public.member_request_events(request_id, sequence_no, stage, member_note, actor_user_id)
        values (p_request_id, v_sequence, 'options_sent', nullif(btrim(p_member_note), ''), p_actor_id);
        update public.member_purchase_requests set updated_at = now() where id = p_request_id;
    end if;
    return query select option.* from public.operations_sourcing_member_options option
        where option.request_id = p_request_id and option.candidate_id = any(p_candidate_ids)
        order by option.created_at;
end;
$$;

create or replace function public.select_member_sourcing_option(p_request_id uuid, p_option_id uuid, p_member_id uuid)
returns public.operations_sourcing_member_options
language plpgsql security definer set search_path = '' as $$
declare v_option public.operations_sourcing_member_options%rowtype;
begin
    perform 1 from public.member_purchase_requests request
    where request.id = p_request_id and request.member_id = p_member_id for update;
    if not found then raise exception 'request not found'; end if;
    select * into v_option from public.operations_sourcing_member_options option
    where option.id = p_option_id and option.request_id = p_request_id and option.status in ('offered', 'selected') for update;
    if not found then raise exception 'option is not available'; end if;
    update public.operations_sourcing_member_options set status = 'declined', selected_at = null
    where request_id = p_request_id and status = 'selected' and id <> p_option_id;
    update public.operations_sourcing_member_options set status = 'selected', selected_at = now()
    where id = p_option_id returning * into v_option;
    return v_option;
end;
$$;

revoke all on function public.share_operations_sourcing_options(uuid, uuid, uuid[], uuid, text) from public, anon, authenticated;
revoke all on function public.select_member_sourcing_option(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.share_operations_sourcing_options(uuid, uuid, uuid[], uuid, text) to service_role;
grant execute on function public.select_member_sourcing_option(uuid, uuid, uuid) to service_role;

comment on table public.operations_sourcing_member_options is
    'Member-visible snapshots of selected sourcing candidates. Supplier identity and staff evidence stay private.';
