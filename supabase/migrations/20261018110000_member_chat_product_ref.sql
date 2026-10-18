-- "Ask about this product" (docs/MEMBER_DASHBOARD_UX_PLAN.md §4): a member message can carry the product the member
-- was looking at. The chat shows it as a small card and the AI answers about that product.

alter table public.member_messages add column if not exists product_ref uuid
    references public.directory_products(id) on delete set null;

create index if not exists idx_member_messages_product_ref
    on public.member_messages (product_ref) where product_ref is not null;
