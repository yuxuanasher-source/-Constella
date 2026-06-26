-- 直播复盘知识库
--
-- 经营端在「排班与任务 → 任务详情」可打开直播复盘面板，以 Markdown 编写复盘，
-- 保存后沉淀到组织级知识库（live_review_documents）。AI 复盘助手读取本表，
-- 汇聚复发问题 / 可复制打法 / 行动项，反哺到后续复盘。
--
-- 多租户 + RLS：仅经营人员（is_mcn_staff）可读写本组织的复盘文档。

create table public.live_review_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  live_task_id uuid references public.live_tasks(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  streamer_id uuid references public.streamers(id) on delete set null,
  title text not null,
  content_md text not null,
  product text,
  platform text,
  tags text[] not null default '{}'::text[],
  author_id uuid references public.profiles(id),
  author_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_review_documents_title_not_blank check (length(btrim(title)) > 0),
  constraint live_review_documents_content_not_blank check (length(btrim(content_md)) > 0)
);

create index live_review_documents_org_created_idx
  on public.live_review_documents (organization_id, created_at desc);
create index live_review_documents_project_idx
  on public.live_review_documents (organization_id, project_id);
create index live_review_documents_streamer_idx
  on public.live_review_documents (organization_id, streamer_id);

create trigger live_review_documents_touch_updated_at
before update on public.live_review_documents
for each row execute function public.touch_updated_at();

alter table public.live_review_documents enable row level security;

create policy live_review_documents_staff_access
on public.live_review_documents for all
using (public.is_mcn_staff(organization_id))
with check (public.is_mcn_staff(organization_id));
