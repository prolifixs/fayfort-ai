-- Staff-managed catalog media only. Member-captured search images remain a separate
-- private-storage and retention decision under FR-005.
alter table public.directory_products
    drop constraint if exists directory_products_media_type_check,
    drop constraint if exists directory_products_media_source_check,
    drop constraint if exists directory_products_media_fields_check;

alter table public.directory_products
    add column if not exists media_url text,
    add column if not exists media_type text,
    add column if not exists media_source text,
    add column if not exists media_storage_path text;

alter table public.directory_products
    add constraint directory_products_media_type_check
        check (media_type is null or media_type in ('image', 'video')),
    add constraint directory_products_media_source_check
        check (media_source is null or media_source in ('url', 'instagram', 'upload')),
    add constraint directory_products_media_fields_check
        check (
            (media_url is null and media_type is null and media_source is null and media_storage_path is null)
            or
            (media_url ~ '^https://' and media_type is not null and media_source is not null
                and ((media_source = 'upload' and media_storage_path is not null)
                    or (media_source <> 'upload' and media_storage_path is null)))
        );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'product-media',
    'product-media',
    true,
    104857600,
    array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Platform admins upload product media" on storage.objects;
create policy "Platform admins upload product media"
on storage.objects for insert to authenticated
with check (
    bucket_id = 'product-media'
    and (
        (auth.jwt() -> 'app_metadata' ->> 'platform_admin') = 'true'
        or coalesce(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'platform_admin'
    )
);

drop policy if exists "Platform admins replace product media" on storage.objects;
create policy "Platform admins replace product media"
on storage.objects for update to authenticated
using (
    bucket_id = 'product-media'
    and (
        (auth.jwt() -> 'app_metadata' ->> 'platform_admin') = 'true'
        or coalesce(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'platform_admin'
    )
)
with check (
    bucket_id = 'product-media'
    and (
        (auth.jwt() -> 'app_metadata' ->> 'platform_admin') = 'true'
        or coalesce(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'platform_admin'
    )
);

drop policy if exists "Platform admins delete product media" on storage.objects;
create policy "Platform admins delete product media"
on storage.objects for delete to authenticated
using (
    bucket_id = 'product-media'
    and (
        (auth.jwt() -> 'app_metadata' ->> 'platform_admin') = 'true'
        or coalesce(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? 'platform_admin'
    )
);

comment on column public.directory_products.media_url is
    'HTTPS direct media URL, public Instagram embed URL, or public Supabase Storage URL for staff-managed catalog display.';
