-- L8 member profile photos are private objects managed by the verified-member API.
alter table public.member_profiles
    add column if not exists member_photo_path text;

alter table public.member_profiles
    drop constraint if exists member_profiles_photo_path_check,
    add constraint member_profiles_photo_path_check check (
        member_photo_path is null or member_photo_path like user_id::text || '/%'
    );

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('member-profile-photos', 'member-profile-photos', false, 5242880,
    array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on column public.member_profiles.member_photo_path is
    'Private member profile photo object path. Reads, upload, and deletion are mediated by the verified-member API.';
