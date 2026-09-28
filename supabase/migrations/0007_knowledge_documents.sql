-- FayFort AI
-- Migration 0007: Knowledge Documents

create table if not exists public.knowledge_documents (
    id uuid primary key default gen_random_uuid(),

    title text not null,
    source text,
    content text not null,
    metadata jsonb not null default '{}'::jsonb,

    status text not null default 'active',

    created_at timestamp not null default now(),
    updated_at timestamp not null default now()
);

create index if not exists idx_knowledge_documents_status
    on public.knowledge_documents(status);

create index if not exists idx_knowledge_documents_source
    on public.knowledge_documents(source);