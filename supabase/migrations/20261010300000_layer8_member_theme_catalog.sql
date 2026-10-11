-- L8-T T-01: member theme catalog and immutable design revisions.
-- No billing is implied. The built-in FayFort base theme is protected and
-- existing member theme preferences must reference a known stable catalog key.

create table public.member_themes (
    theme_id text primary key
        check (theme_id = 'base' or theme_id ~ '^[a-z][a-z0-9-]{1,79}$'),
    display_name text not null
        check (length(btrim(display_name)) between 1 and 80),
    description text
        check (description is null or length(description) <= 300),
    status text not null default 'draft'
        check (status in ('draft', 'published', 'archived')),
    requires_paid boolean not null default true,
    is_builtin boolean not null default false,
    draft_revision integer,
    published_revision integer,
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint member_themes_base_protected_shape check (
        (theme_id = 'base' and is_builtin and display_name = 'FayFort base'
            and status = 'published' and not requires_paid
            and draft_revision is null and published_revision is null)
        or
        (theme_id <> 'base' and not is_builtin and requires_paid)
    )
);

create unique index member_themes_display_name_lower_uq
    on public.member_themes (lower(display_name));

create table public.member_theme_revisions (
    theme_id text not null references public.member_themes(theme_id) on delete restrict
        check (theme_id <> 'base'),
    revision integer not null check (revision > 0),
    palette_preset text not null
        check (palette_preset ~ '^[a-z][a-z0-9-]{0,39}$'),
    wrapper_style text not null
        check (wrapper_style in ('clean', 'soft', 'framed')),
    colors jsonb not null
        check (jsonb_typeof(colors) = 'object'
            and colors ?& array['page_background','surface','text','muted_text','accent','accent_foreground','border','focus']
            and (colors - array['page_background','surface','text','muted_text','accent','accent_foreground','border','focus']) = '{}'::jsonb
            and (colors ->> 'page_background') ~ '^#[0-9A-Fa-f]{6}$'
            and (colors ->> 'surface') ~ '^#[0-9A-Fa-f]{6}$'
            and (colors ->> 'text') ~ '^#[0-9A-Fa-f]{6}$'
            and (colors ->> 'muted_text') ~ '^#[0-9A-Fa-f]{6}$'
            and (colors ->> 'accent') ~ '^#[0-9A-Fa-f]{6}$'
            and (colors ->> 'accent_foreground') ~ '^#[0-9A-Fa-f]{6}$'
            and (colors ->> 'border') ~ '^#[0-9A-Fa-f]{6}$'
            and (colors ->> 'focus') ~ '^#[0-9A-Fa-f]{6}$'),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    primary key (theme_id, revision)
);

alter table public.member_themes
    add constraint member_themes_draft_revision_fk
        foreign key (theme_id, draft_revision)
        references public.member_theme_revisions(theme_id, revision)
        on delete restrict,
    add constraint member_themes_published_revision_fk
        foreign key (theme_id, published_revision)
        references public.member_theme_revisions(theme_id, revision)
        on delete restrict,
    add constraint member_themes_revision_shape check (
        (theme_id = 'base' and draft_revision is null and published_revision is null)
        or
        (theme_id <> 'base' and status = 'draft' and published_revision is null)
        or
        (theme_id <> 'base' and status in ('published', 'archived') and published_revision is not null)
    );

insert into public.member_themes
    (theme_id, display_name, description, status, requires_paid, is_builtin)
values
    ('base', 'FayFort base', 'The standard FayFort member appearance.', 'published', false, true);

do $$
begin
    if exists (
        select 1 from public.member_profiles p
        left join public.member_themes t on t.theme_id = p.selected_theme
        where t.theme_id is null
    ) then
        raise exception 'Cannot add member theme catalog: member_profiles contains an unknown selected_theme';
    end if;
end;
$$;

alter table public.member_profiles
    add constraint member_profiles_selected_theme_fk
        foreign key (selected_theme)
        references public.member_themes(theme_id)
        on update restrict on delete restrict;

create or replace function public.protect_fayfort_base_theme()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'DELETE' and old.theme_id = 'base' then
        raise exception 'FayFort base theme cannot be deleted';
    end if;
    if tg_op = 'UPDATE' and old.theme_id = 'base' and new is distinct from old then
        raise exception 'FayFort base theme is protected';
    end if;
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

create trigger member_themes_protect_base
    before update or delete on public.member_themes
    for each row execute function public.protect_fayfort_base_theme();

create or replace function public.prevent_member_theme_revision_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    raise exception 'Theme revisions are immutable; create a new revision';
end;
$$;

create trigger member_theme_revisions_immutable
    before update or delete on public.member_theme_revisions
    for each row execute function public.prevent_member_theme_revision_mutation();

alter table public.member_themes enable row level security;
alter table public.member_theme_revisions enable row level security;

revoke all on public.member_themes, public.member_theme_revisions from public, anon, authenticated;
grant select, insert, update, delete on public.member_themes, public.member_theme_revisions to service_role;

comment on table public.member_themes is
    'Stable member-theme catalog identities. Draft/publish/archive operations are server-admin controlled; base is immutable.';
comment on table public.member_theme_revisions is
    'Immutable theme design snapshots. Editing creates a new revision; WCAG contrast is validated by the service before persistence.';
comment on column public.member_profiles.selected_theme is
    'Stable member-theme catalog identity. Theme entitlements are checked by the server; base remains available to all members.';
