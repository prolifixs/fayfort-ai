-- Keep unpublished theme labels private while an existing published revision remains live.
alter table public.member_themes
    add column draft_display_name text,
    add column draft_description text,
    add constraint member_themes_draft_display_name_shape check (
        draft_display_name is null or length(btrim(draft_display_name)) between 1 and 80
    ),
    add constraint member_themes_draft_description_shape check (
        draft_description is null or length(draft_description) <= 300
    );

update public.member_themes
set draft_display_name = display_name,
    draft_description = description
where theme_id <> 'base' and status = 'draft';

comment on column public.member_themes.draft_display_name is
    'Unpublished theme name; only copied to display_name when this revision is published.';
comment on column public.member_themes.draft_description is
    'Unpublished theme description; only copied to description when this revision is published.';
