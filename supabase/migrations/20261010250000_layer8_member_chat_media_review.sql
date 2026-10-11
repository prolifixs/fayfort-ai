-- L8-04.2: private member photo review queue, separate from business chats/requests.
create table if not exists public.member_chat_reviews (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.member_conversations(id) on delete cascade,
    member_id uuid not null references auth.users(id) on delete cascade,
    assigned_worker_id uuid references auth.users(id) on delete set null,
    status text not null default 'pending_assignment'
        check (status in ('pending_assignment', 'assigned', 'under_review', 'reviewed')),
    consented_at timestamptz not null default now(),
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_member_chat_reviews_queue
    on public.member_chat_reviews(status, created_at);
create index if not exists idx_member_chat_reviews_worker
    on public.member_chat_reviews(assigned_worker_id, status, created_at);

create table if not exists public.member_chat_review_media (
    id uuid primary key default gen_random_uuid(),
    review_id uuid not null references public.member_chat_reviews(id) on delete cascade,
    storage_path text not null unique,
    content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
    byte_size bigint not null check (byte_size between 1 and 10485760),
    original_filename text not null check (length(original_filename) between 1 and 255),
    expires_at timestamptz not null default (now() + interval '30 days'),
    created_at timestamptz not null default now()
);

create index if not exists idx_member_chat_review_media_expiry
    on public.member_chat_review_media(expires_at);

alter table public.member_chat_reviews enable row level security;
alter table public.member_chat_review_media enable row level security;
revoke all on public.member_chat_reviews, public.member_chat_review_media from anon, authenticated;
grant all on public.member_chat_reviews, public.member_chat_review_media to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('member-chat-review-media', 'member-chat-review-media', false, 10485760,
    array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on table public.member_chat_reviews is
    'Separate human review queue for member chat media. Admin assigns active FayFort workers; API enforces access.';
comment on table public.member_chat_review_media is
    'Private, short-lived member-submitted product discovery photos. No model analysis or durable image storage.';
