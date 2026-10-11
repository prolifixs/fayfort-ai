-- L8-04.3: let an assigned active worker reply in the member-owned chat.
-- Worker identity is retained for audit; member APIs never project actor_user_id.

alter table public.member_messages
    add column if not exists actor_user_id uuid references auth.users(id) on delete set null;

alter table public.member_messages
    drop constraint if exists member_messages_sender_type_check;

alter table public.member_messages
    add constraint member_messages_sender_type_check
    check (sender_type in ('member', 'assistant', 'worker'));

comment on column public.member_messages.actor_user_id is
    'Verified FayFort worker identity for human replies; omitted from member-facing projections.';
