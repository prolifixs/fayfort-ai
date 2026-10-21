-- Member themes can carry a cultural pattern (Ankara, Ghana Must Go) shown in a few calm places of the member app.
alter table public.member_theme_revisions
    add column if not exists pattern text not null default 'none',
    add column if not exists pattern_strength text not null default 'subtle';
alter table public.member_theme_revisions drop constraint if exists member_theme_revisions_pattern_check;
alter table public.member_theme_revisions add constraint member_theme_revisions_pattern_check
    check (pattern in ('none', 'ankara', 'ghana-must-go'));
alter table public.member_theme_revisions drop constraint if exists member_theme_revisions_pattern_strength_check;
alter table public.member_theme_revisions add constraint member_theme_revisions_pattern_strength_check
    check (pattern_strength in ('subtle', 'bold'));

comment on column public.member_theme_revisions.pattern is
    'Theme pattern. Keep in step with app/accounts/member_themes.py THEME_PATTERNS.';
