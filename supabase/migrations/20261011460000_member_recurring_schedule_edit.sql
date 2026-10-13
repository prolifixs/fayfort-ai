-- Permit members to edit the next cycle's date and/or quantity while keeping
-- the immutable schedule event history and the scheduler's row-lock contract.

alter table public.member_request_schedule_events
    drop constraint if exists member_request_schedule_events_event_type_check;
alter table public.member_request_schedule_events
    add constraint member_request_schedule_events_event_type_check check (event_type in (
        'activated', 'paused', 'resumed', 'cancelled', 'occurrence_created',
        'occurrence_skipped', 'quote_accepted', 'completed', 'schedule_edited'
    ));

create or replace function public.edit_member_request_schedule(
    p_member_id uuid,
    p_schedule_id uuid,
    p_expected_version integer,
    p_units_per_order integer default null,
    p_next_due_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_schedule public.member_request_schedules%rowtype;
    v_old_units integer;
    v_old_due_at timestamptz;
begin
    if auth.role() <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    if p_units_per_order is null and p_next_due_at is null then
        raise exception 'invalid_schedule_edit';
    end if;
    if p_units_per_order is not null and p_units_per_order not between 1 and 10000 then
        raise exception 'invalid_schedule_edit';
    end if;

    select * into v_schedule from public.member_request_schedules
     where id = p_schedule_id and member_id = p_member_id for update;
    if not found then raise exception 'schedule_not_found'; end if;
    if v_schedule.version <> p_expected_version then raise exception 'schedule_version_conflict'; end if;
    if v_schedule.status not in ('active', 'paused') then raise exception 'invalid_schedule_edit'; end if;
    if v_schedule.next_due_at <= now() then raise exception 'schedule_due_or_processing'; end if;
    if p_next_due_at is not null and (p_next_due_at <= now() or p_next_due_at >= v_schedule.expires_at) then
        raise exception 'invalid_schedule_edit';
    end if;

    v_old_units := v_schedule.units_per_order;
    v_old_due_at := v_schedule.next_due_at;
    update public.member_request_schedules set
        units_per_order = coalesce(p_units_per_order, units_per_order),
        anchor_local = case when p_next_due_at is null then anchor_local else p_next_due_at at time zone time_zone end,
        anchor_occurrence_number = case when p_next_due_at is null then anchor_occurrence_number else next_occurrence_number end,
        next_due_at = coalesce(p_next_due_at, next_due_at),
        version = version + 1,
        updated_at = now()
     where id = p_schedule_id returning * into v_schedule;

    perform public.append_member_request_schedule_event(v_schedule.id, 'schedule_edited',
        v_schedule.next_occurrence_number,
        jsonb_build_object(
            'previous_units_per_order', v_old_units,
            'units_per_order', v_schedule.units_per_order,
            'previous_next_due_at', v_old_due_at,
            'next_due_at', v_schedule.next_due_at,
            'time_zone', v_schedule.time_zone
        ), p_member_id);
    return jsonb_build_object(
        'schedule_id', v_schedule.id, 'status', v_schedule.status,
        'version', v_schedule.version, 'units_per_order', v_schedule.units_per_order,
        'next_due_at', v_schedule.next_due_at, 'next_occurrence_number', v_schedule.next_occurrence_number
    );
end;
$$;

revoke all on function public.edit_member_request_schedule(uuid, uuid, integer, integer, timestamptz)
    from public, anon, authenticated;
grant execute on function public.edit_member_request_schedule(uuid, uuid, integer, integer, timestamptz)
    to service_role;
comment on function public.edit_member_request_schedule(uuid, uuid, integer, integer, timestamptz) is
    'Member-scoped, version-checked edit of next recurring cycle date/units; writes an append-only schedule_edited event. No order or payment is created.';
