-- AI 知识库 / RAG 语料（方案第 6 节 AI 作战室）。
-- 硬约束：语料仅用于解释 / 归因；数字必须用结构化数据兜底并附 source_ref；
-- 每条文档自带 source_ref（引用可追溯）。组织级 RLS：仅本组织 MCN 员工可读写。

create table public.knowledge_documents (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  doc_type        text not null,            -- retrospective | sop | settlement_rule | evidence_rule | profile_note | manual | playbook
  title           text not null,
  body            text not null,
  source_ref      text not null,            -- 引用追溯：文档来源 / 数据查询 ID
  tags            text[] not null default '{}',
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint knowledge_documents_doc_type_check check (
    doc_type in (
      'retrospective', 'sop', 'settlement_rule', 'evidence_rule',
      'profile_note', 'manual', 'playbook'
    )
  )
);

alter table public.knowledge_documents enable row level security;

create policy knowledge_documents_staff_access
on public.knowledge_documents for all
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));

create index knowledge_documents_org_type_idx
  on public.knowledge_documents (organization_id, doc_type, created_at desc);
create index knowledge_documents_tags_idx
  on public.knowledge_documents using gin (tags);

create trigger knowledge_documents_touch_updated_at
before update on public.knowledge_documents
for each row execute function public.touch_updated_at();
