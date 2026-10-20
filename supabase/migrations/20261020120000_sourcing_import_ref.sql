-- Sourcing items imported from FayFort's own social posts: one product per post, safe to re-run.
alter table public.directory_products add column if not exists import_ref text;

create unique index if not exists directory_products_import_ref_key
    on public.directory_products (import_ref)
    where import_ref is not null;
