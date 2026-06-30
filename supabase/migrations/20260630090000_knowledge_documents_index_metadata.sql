alter table public.knowledge_documents
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists knowledge_documents_org_source_ref_unique_idx
  on public.knowledge_documents (organization_id, source_ref);
