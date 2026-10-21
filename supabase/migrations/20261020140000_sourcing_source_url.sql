-- Sourcing items added from a shop product link (owner request, 2026-10-20): the link is kept on the listing and
-- the published item (for staff, and to stop the same link being listed twice).
alter table public.store_listings add column if not exists source_url text;
alter table public.directory_products add column if not exists source_url text;
create index if not exists directory_products_source_url_idx on public.directory_products (source_url) where source_url is not null;
create index if not exists store_listings_source_url_idx on public.store_listings (source_url) where source_url is not null;
