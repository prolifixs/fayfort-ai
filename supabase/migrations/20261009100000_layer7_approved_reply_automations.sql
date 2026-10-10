-- Approved static replies share the existing AI-message and provider-delivery path.
-- Rules remain disabled by default; the server validates trigger/action pairing.
alter table public.business_automations
    add column if not exists action_config jsonb not null default '{}'::jsonb;

alter table public.business_automations
    drop constraint if exists business_automations_action_type_check;

alter table public.business_automations
    add constraint business_automations_action_type_check
    check (action_type in ('record_test_run', 'send_approved_reply'));

alter table public.business_automations
    add constraint business_automations_approved_reply_scope_check
    check (
        action_type <> 'send_approved_reply'
        or (
            trigger_type = 'conversation_inbound'
            and coalesce(jsonb_typeof(action_config), '') = 'object'
            and coalesce(jsonb_typeof(action_config->'response_text'), '') = 'string'
            and coalesce(length(trim(action_config->>'response_text')), 0) between 1 and 1000
        )
    );

alter table public.business_automations
    add constraint business_automations_test_action_config_check
    check (
        action_type <> 'record_test_run'
        or action_config = '{}'::jsonb
    );

comment on column public.business_automations.action_config is
    'Non-secret action configuration. Approved reply text is sent only through the existing opted-in channel delivery path.';
