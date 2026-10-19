-- Member themes can choose a text font (Theme Studio). "system" is FayFort's standard font stack; the others are
-- loaded from Google Fonts by the member app. Existing revisions keep the standard font.
alter table public.member_theme_revisions
    add column if not exists font_family text not null default 'system';
alter table public.member_theme_revisions drop constraint if exists member_theme_revisions_font_family_check;
alter table public.member_theme_revisions add constraint member_theme_revisions_font_family_check
    check (font_family in ('system', 'poppins', 'quicksand', 'nunito', 'montserrat', 'dm-sans', 'playfair', 'lora'));

comment on column public.member_theme_revisions.font_family is
    'Text font for the member app. Keep in step with app/accounts/member_themes.py THEME_FONTS.';
