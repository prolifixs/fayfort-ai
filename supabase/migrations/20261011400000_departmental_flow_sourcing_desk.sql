-- Staff-only sourcing batches and per-request candidate evidence.
-- Batches group work; they never replace individual work ownership or request history.

create table if not exists public.operations_sourcing_batches (
    id uuid primary key default gen_random_uuid(),
    title text not null check (length(btrim(title)) between 1 and 120),
    status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.operations_sourcing_batch_items (
    batch_id uuid not null references public.operations_sourcing_batches(id) on delete cascade,
    work_item_id uuid not null references public.operations_work_items(id) on delete cascade,
    member_request_id uuid not null references public.member_purchase_requests(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (batch_id, work_item_id),
    unique (work_item_id)
);
create index if not exists idx_operations_sourcing_batch_items_batch
    on public.operations_sourcing_batch_items(batch_id, created_at);

create table if not exists public.operations_sourcing_candidates (
    id uuid primary key default gen_random_uuid(),
    work_item_id uuid not null references public.operations_work_items(id) on delete cascade,
    member_request_id uuid not null references public.member_purchase_requests(id) on delete cascade,
    product_name text not null check (length(btrim(product_name)) between 1 and 240),
    supplier_name text check (supplier_name is null or length(btrim(supplier_name)) <= 160),
    product_url text not null check (length(product_url) between 8 and 2000 and product_url ~ '^https?://'),
    price_amount numeric(14,2) check (price_amount is null or price_amount >= 0),
    currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
    availability text check (availability is null or length(availability) <= 240),
    evidence_note text not null check (length(btrim(evidence_note)) between 1 and 2000),
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now()
);
create index if not exists idx_operations_sourcing_candidates_request
    on public.operations_sourcing_candidates(member_request_id, created_at desc);

create table if not exists public.operations_sourcing_audit (
    id uuid primary key default gen_random_uuid(),
    action text not null check (action in ('batch_created', 'candidate_added')),
    batch_id uuid references public.operations_sourcing_batches(id) on delete set null,
    work_item_id uuid references public.operations_work_items(id) on delete set null,
    member_request_id uuid references public.member_purchase_requests(id) on delete set null,
    candidate_id uuid references public.operations_sourcing_candidates(id) on delete set null,
    actor_id uuid references auth.users(id) on delete set null,
    details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
    created_at timestamptz not null default now()
);
create index if not exists idx_operations_sourcing_audit_work
    on public.operations_sourcing_audit(work_item_id, created_at desc);
create or replace function public.prevent_operations_sourcing_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
    raise exception 'sourcing audit is append-only';
end;
$$;
drop trigger if exists operations_sourcing_audit_append_only on public.operations_sourcing_audit;
create trigger operations_sourcing_audit_append_only
    before update or delete on public.operations_sourcing_audit
    for each row execute function public.prevent_operations_sourcing_audit_mutation();
revoke all on function public.prevent_operations_sourcing_audit_mutation() from public, anon, authenticated;

alter table public.operations_sourcing_batches enable row level security;
alter table public.operations_sourcing_batch_items enable row level security;
alter table public.operations_sourcing_candidates enable row level security;
alter table public.operations_sourcing_audit enable row level security;
revoke all on public.operations_sourcing_batches, public.operations_sourcing_batch_items,
    public.operations_sourcing_candidates, public.operations_sourcing_audit from public, anon, authenticated;
grant select, insert, update, delete on public.operations_sourcing_batches,
    public.operations_sourcing_batch_items, public.operations_sourcing_candidates,
    public.operations_sourcing_audit to service_role;

create or replace function public.create_operations_sourcing_batch(
    p_actor_id uuid, p_title text, p_work_item_ids uuid[], p_is_admin boolean
) returns public.operations_sourcing_batches
language plpgsql security definer set search_path = '' as $$
declare
    v_batch public.operations_sourcing_batches%rowtype;
    v_item public.operations_work_items%rowtype;
    v_ids uuid[];
    v_item_id uuid;
begin
    if p_actor_id is null or length(btrim(coalesce(p_title, ''))) not between 1 and 120
       or coalesce(cardinality(p_work_item_ids), 0) not between 1 and 50 then
        raise exception 'invalid batch input';
    end if;
    select array_agg(distinct ids.item_id) into v_ids from unnest(p_work_item_ids) as ids(item_id);
    if cardinality(v_ids) <> cardinality(p_work_item_ids) then raise exception 'duplicate work item'; end if;
    if not p_is_admin and not exists (
        select 1 from public.fayfort_workers worker
        join public.operations_worker_departments department on department.worker_id = worker.user_id
        where worker.user_id = p_actor_id and worker.status = 'active'
          and department.department = 'sourcing' and department.can_claim
    ) then raise exception 'worker is not eligible for sourcing'; end if;
    insert into public.operations_sourcing_batches(title, created_by)
    values (btrim(p_title), p_actor_id) returning * into v_batch;
    foreach v_item_id in array v_ids loop
        select * into v_item from public.operations_work_items where id = v_item_id for update;
        if not found or v_item.department <> 'sourcing' or v_item.member_request_id is null
           or v_item.status in ('completed', 'cancelled') then raise exception 'ineligible sourcing work item'; end if;
        if not p_is_admin and v_item.assigned_worker_id is not null
           and v_item.assigned_worker_id <> p_actor_id then raise exception 'item belongs to another worker'; end if;
        insert into public.operations_sourcing_batch_items(batch_id, work_item_id, member_request_id)
        values (v_batch.id, v_item.id, v_item.member_request_id);
        insert into public.operations_sourcing_audit(action, batch_id, work_item_id, member_request_id, actor_id, details)
        values ('batch_created', v_batch.id, v_item.id, v_item.member_request_id, p_actor_id,
                jsonb_build_object('title', v_batch.title));
    end loop;
    return v_batch;
end;
$$;

create or replace function public.validate_operations_sourcing_candidate()
returns trigger language plpgsql set search_path = '' as $$
begin
    if not exists (select 1 from public.operations_work_items work
                   where work.id = new.work_item_id and work.member_request_id = new.member_request_id
                     and work.department = 'sourcing') then
        raise exception 'candidate must belong to the sourcing work item and its request';
    end if;
    return new;
end;
$$;
drop trigger if exists operations_sourcing_candidate_validate on public.operations_sourcing_candidates;
create trigger operations_sourcing_candidate_validate before insert on public.operations_sourcing_candidates
    for each row execute function public.validate_operations_sourcing_candidate();
revoke all on function public.validate_operations_sourcing_candidate() from public, anon, authenticated;
revoke all on function public.create_operations_sourcing_batch(uuid, text, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.create_operations_sourcing_batch(uuid, text, uuid[], boolean) to service_role;

create or replace function public.audit_operations_sourcing_candidate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into public.operations_sourcing_audit(action, work_item_id, member_request_id, candidate_id, actor_id,
        details)
    values ('candidate_added', new.work_item_id, new.member_request_id, new.id, new.created_by,
        jsonb_build_object('product_name', new.product_name, 'supplier_name', new.supplier_name,
                           'product_url', new.product_url));
    return new;
end;
$$;
drop trigger if exists operations_sourcing_candidate_audit on public.operations_sourcing_candidates;
create trigger operations_sourcing_candidate_audit after insert on public.operations_sourcing_candidates
    for each row execute function public.audit_operations_sourcing_candidate();
revoke all on function public.audit_operations_sourcing_candidate() from public, anon, authenticated;
