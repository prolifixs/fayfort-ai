-- Two published themes with patterns (owner request, 2026-10-20): Ankara and Ghana Must Go. Standard/Pro.
-- Colours pass the member theme contrast rules (app/accounts/member_themes.py). Safe to run again.
insert into public.member_themes (theme_id, display_name, description, draft_display_name, draft_description, status,
                                  requires_paid, is_builtin, draft_revision, published_revision)
values
    ('ankara', 'Ankara', 'Warm cream and orange with a Kente-style Ankara pattern.', 'Ankara',
     'Warm cream and orange with a Kente-style Ankara pattern.', 'published', true, false, 1, 1),
    ('ghana-must-go', 'Ghana Must Go', 'Crisp white, black and red with the Ghana Must Go plaid.', 'Ghana Must Go',
     'Crisp white, black and red with the Ghana Must Go plaid.', 'published', true, false, 1, 1)
on conflict (theme_id) do nothing;

insert into public.member_theme_revisions (theme_id, revision, palette_preset, wrapper_style, colors, font_family, pattern,
                                           pattern_strength)
values
    ('ankara', 1, 'ankara', 'soft',
     '{"page_background":"#FFF8EE","surface":"#FBEBD6","text":"#2A1A12","muted_text":"#6B4A33","accent":"#C2410C","accent_foreground":"#FFFFFF","border":"#8A6A55","focus":"#1E3FB8"}'::jsonb,
     'montserrat', 'ankara', 'bold'),
    ('ghana-must-go', 1, 'ghana-must-go', 'soft',
     '{"page_background":"#FFFFFF","surface":"#F5F3F0","text":"#141414","muted_text":"#55514E","accent":"#C8102E","accent_foreground":"#FFFFFF","border":"#6E6A66","focus":"#141414"}'::jsonb,
     'dm-sans', 'ghana-must-go', 'bold')
on conflict do nothing;
