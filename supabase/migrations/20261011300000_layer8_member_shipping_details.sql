-- Member-managed contact and shipping destination details.
-- These fields are read and written through the verified member API only;
-- authenticated clients receive no additional direct table-update privileges.

alter table public.member_profiles
    add column if not exists shipping_phone text,
    add column if not exists shipping_address_line1 text,
    add column if not exists shipping_address_line2 text,
    add column if not exists shipping_city text,
    add column if not exists shipping_region text,
    add column if not exists shipping_postal_code text,
    add column if not exists shipping_country text;

alter table public.member_profiles
    drop constraint if exists member_profiles_shipping_phone_check,
    add constraint member_profiles_shipping_phone_check check (
        shipping_phone is null
        or (
            shipping_phone ~ '^[+0-9(). -]+$'
            and length(regexp_replace(shipping_phone, '\D', '', 'g')) between 7 and 15
        )
    ),
    drop constraint if exists member_profiles_shipping_address_check,
    add constraint member_profiles_shipping_address_check check (
        (shipping_address_line1 is null
         and shipping_address_line2 is null
         and shipping_city is null
         and shipping_region is null
         and shipping_postal_code is null
         and shipping_country is null)
        or (nullif(btrim(shipping_address_line1), '') is not null
            and nullif(btrim(shipping_city), '') is not null
            and nullif(btrim(shipping_country), '') is not null)
    );

comment on column public.member_profiles.shipping_phone is
    'Optional member-provided phone number for shipping coordination.';
comment on column public.member_profiles.shipping_address_line1 is
    'Optional member-provided shipping address line 1; visible only to the owning member API unless separately used for a request.';
comment on column public.member_profiles.shipping_address_line2 is
    'Optional member-provided shipping address line 2.';
comment on column public.member_profiles.shipping_city is
    'Optional member-provided shipping city or town.';
comment on column public.member_profiles.shipping_region is
    'Optional member-provided state, province, or region.';
comment on column public.member_profiles.shipping_postal_code is
    'Optional member-provided postal or ZIP code.';
comment on column public.member_profiles.shipping_country is
    'Optional member-provided shipping country.';
