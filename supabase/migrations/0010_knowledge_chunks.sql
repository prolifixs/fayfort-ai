-- FayFort AI
-- Migration 0010: Knowledge Chunks

create table if not exists public.knowledge_chunks (
    id uuid primary key default gen_random_uuid(),

    document_id uuid not null
        references public.knowledge_documents(id)
        on delete cascade,

    chunk_index integer not null,

    content text not null,

    metadata jsonb not null default '{}'::jsonb,

    token_count integer,

    embedding vector(1536),

    created_at timestamptz not null default now()
);

create index if not exists idx_knowledge_chunks_document_id
    on public.knowledge_chunks(document_id);

create index if not exists idx_knowledge_chunks_chunk_index
    on public.knowledge_chunks(document_id, chunk_index);