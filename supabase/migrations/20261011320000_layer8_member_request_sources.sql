-- Member sourcing requests can originate from saved/catalog products, URLs,
-- free-text descriptions, or a private screenshot submitted by the member.

alter table public.member_purchase_requests
    add column if not exists source_type text not null default 'description',
    add column if not exists source_url text;

update public.member_purchase_requests
set source_type = 'catalog_product'
where product_id is not null and source_type = 'description';

alter table public.member_purchase_requests
    drop constraint if exists member_purchase_requests_source_type_check,
    add constraint member_purchase_requests_source_type_check check (
        source_type in ('saved_product', 'catalog_product', 'url', 'image', 'description')
    ),
    drop constraint if exists member_purchase_requests_source_url_check,
    add constraint member_purchase_requests_source_url_check check (
        (source_type = 'url' and source_url ~ '^https://[^[:space:]]+$')
        or (source_type <> 'url' and source_url is null)
    ),
    drop constraint if exists member_purchase_requests_source_product_check,
    add constraint member_purchase_requests_source_product_check check (
        (source_type in ('saved_product', 'catalog_product') and product_id is not null)
        or (source_type not in ('saved_product', 'catalog_product') and product_id is null)
    );

create table if not exists public.member_request_source_media (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.member_purchase_requests(id) on delete cascade,
    member_id uuid not null references auth.users(id) on delete cascade,
    storage_path text not null unique,
    content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
    byte_size bigint not null check (byte_size between 1 and 10485760),
    original_filename text not null check (length(original_filename) between 1 and 255),
    created_at timestamptz not null default now()
);

create index if not exists idx_member_request_source_media_request
    on public.member_request_source_media(request_id, created_at);

alter table public.member_request_source_media enable row level security;
revoke all on public.member_request_source_media from anon, authenticated;
grant all on public.member_request_source_media to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('member-request-source-images', 'member-request-source-images', false, 10485760,
    array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop function if exists public.create_member_purchase_request(uuid, text, text, uuid);
create or replace function public.create_member_purchase_request(
    p_member_id uuid,
    p_request_title text,
    p_request_description text default null,
    p_product_id uuid default null,
    p_source_type text default 'description',
    p_source_url text default null,
    p_source_image jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_request_id uuid;
    v_product_name text;
begin
    if auth.role() <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    if p_source_type not in ('saved_product', 'catalog_product', 'url', 'image', 'description') then
        raise exception 'invalid request source type';
    end if;
    if p_source_type in ('saved_product', 'catalog_product') then
        if p_product_id is null or p_source_url is not null or p_source_image is not null then
            raise exception 'catalog request source is incomplete';
        end if;
        select product.name into v_product_name
        from public.directory_products product
        where product.id = p_product_id and product.active = true;
        if not found then raise exception 'product is not available'; end if;
        if p_source_type = 'saved_product' and not exists (
            select 1 from public.member_saved_products saved
            where saved.member_id = p_member_id and saved.product_id = p_product_id
        ) then
            raise exception 'product is not saved by this member';
        end if;
    elsif p_source_type = 'url' then
        if p_product_id is not null or p_source_image is not null
            or p_source_url is null or p_source_url !~ '^https://[^[:space:]]+$' then
            raise exception 'valid https request source url is required';
        end if;
    elsif p_source_type = 'image' then
        if p_product_id is not null or p_source_url is not null or p_source_image is null
            or jsonb_typeof(p_source_image) <> 'object'
            or coalesce(p_source_image->>'storage_path', '') = ''
            or coalesce(p_source_image->>'content_type', '') not in ('image/jpeg', 'image/png', 'image/webp')
            or coalesce((p_source_image->>'byte_size')::bigint, 0) not between 1 and 10485760
            or length(coalesce(p_source_image->>'original_filename', '')) not between 1 and 255 then
            raise exception 'valid request source image metadata is required';
        end if;
    elsif p_product_id is not null or p_source_url is not null or p_source_image is not null then
        raise exception 'description request source cannot include a product, url, or image';
    end if;

    insert into public.member_purchase_requests (
        member_id, product_id, product_name_snapshot, request_title, request_description,
        source_type, source_url
    ) values (
        p_member_id, p_product_id, v_product_name, btrim(p_request_title),
        nullif(btrim(p_request_description), ''), p_source_type, p_source_url
    ) returning id into v_request_id;

    insert into public.member_request_events(request_id, sequence_no, stage, actor_user_id)
    values (v_request_id, 1, 'submitted', p_member_id);

    if p_source_type = 'image' then
        insert into public.member_request_source_media (
            request_id, member_id, storage_path, content_type, byte_size, original_filename
        ) values (
            v_request_id, p_member_id, p_source_image->>'storage_path',
            p_source_image->>'content_type', (p_source_image->>'byte_size')::bigint,
            p_source_image->>'original_filename'
        );
    end if;
    return v_request_id;
end;
$$;

drop function if exists public.create_member_request_from_chat(uuid, uuid, text, text, uuid);
create or replace function public.create_member_request_from_chat(
    p_member_id uuid,
    p_conversation_id uuid,
    p_request_title text,
    p_request_description text default null,
    p_product_id uuid default null,
    p_source_type text default 'description',
    p_source_url text default null,
    p_source_image jsonb default null
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
        p_member_id, p_request_title, p_request_description, p_product_id,
        p_source_type, p_source_url, p_source_image
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

revoke all on function public.create_member_purchase_request(uuid, text, text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_member_purchase_request(uuid, text, text, uuid, text, text, jsonb) to service_role;
revoke all on function public.create_member_request_from_chat(uuid, uuid, text, text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_member_request_from_chat(uuid, uuid, text, text, uuid, text, text, jsonb) to service_role;

comment on table public.member_request_source_media is
    'Private screenshots supplied by members as sourcing request input; separate from worker warehouse evidence and chat photo-review media.';
