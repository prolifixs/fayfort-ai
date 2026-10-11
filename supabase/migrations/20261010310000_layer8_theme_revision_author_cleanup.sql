-- Allow Auth-user deletion to clear only the nullable revision author pointer.
-- Theme revision content and identity remain immutable.

create or replace function public.prevent_member_theme_revision_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'UPDATE'
        and old.created_by is not null
        and new.created_by is null
        and row(new.theme_id, new.revision, new.palette_preset, new.wrapper_style, new.colors, new.created_at)
            is not distinct from
            row(old.theme_id, old.revision, old.palette_preset, old.wrapper_style, old.colors, old.created_at) then
        return new;
    end if;
    raise exception 'Theme revisions are immutable; create a new revision';
end;
$$;
