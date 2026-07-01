create table if not exists public.knowledge_document_chunks (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  knowledge_document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  chunk_index integer not null,
  doc_type text not null,
  title text not null,
  body text not null,
  source_ref text not null,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  project_id text,
  streamer_id text,
  live_task_id text,
  product text,
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (knowledge_document_id, chunk_index)
);

alter table public.knowledge_document_chunks enable row level security;

create policy knowledge_document_chunks_staff_access
on public.knowledge_document_chunks for all
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));

create index knowledge_document_chunks_org_filters_idx
  on public.knowledge_document_chunks (
    organization_id,
    doc_type,
    project_id,
    product,
    platform,
    updated_at desc
  );

create index knowledge_document_chunks_tags_idx
  on public.knowledge_document_chunks using gin (tags);

create trigger knowledge_document_chunks_touch_updated_at
before update on public.knowledge_document_chunks
for each row execute function public.touch_updated_at();
