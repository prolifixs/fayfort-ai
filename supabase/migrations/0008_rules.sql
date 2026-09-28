-- FayFort AI
-- Migration 0008: Rules
-- Stores AI behavior and escalation rules.

create table if not exists public.rules (
    id uuid primary key default gen_random_uuid(),

    name text not null,
    description text,

    rule_type text not null,
    priority integer not null default 100,

    conditions jsonb not null default '{}'::jsonb,
    actions jsonb not null default '{}'::jsonb,

    status text not null default 'active',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- INDEXES

create index if not exists idx_rules_type
    on public.rules(rule_type);

create index if not exists idx_rules_priority
    on public.rules(priority);

create index if not exists idx_rules_status
    on public.rules(status);