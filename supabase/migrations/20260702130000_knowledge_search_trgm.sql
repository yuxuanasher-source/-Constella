-- 知识检索候选集下推（pg_trgm）。
--
-- 现状：knowledge-repository 先按组织拉最近 200 条全文候选，再在 JS 里确定性打分。
-- 语料以中文为主，Postgres 默认 FTS parser 无法分词，因此不走全文检索方案，
-- 改用 pg_trgm 子串索引 + ilike：数据库只回传「命中查询词（title/body/tags 任一
-- 子串命中）」的前 N 条，JS 仅对小候选集精排，相关性语义与旧实现一致。
--
-- 两个 RPC 都以调用方身份执行：沿用表上 is_mcn_staff 的组织级 RLS，不放大权限。
-- live_review_documents 不在文本检索路径上（listLiveReviewDocuments 只做等值过滤
-- + 时间排序），故不建 trgm 索引。

create extension if not exists pg_trgm with schema extensions;

-- trgm GIN 索引：支撑 title/body 的 ilike 子串匹配（中文按 trigram 切分，无需分词器）。
create index if not exists knowledge_documents_title_trgm_idx
  on public.knowledge_documents using gin (title extensions.gin_trgm_ops);
create index if not exists knowledge_documents_body_trgm_idx
  on public.knowledge_documents using gin (body extensions.gin_trgm_ops);
create index if not exists knowledge_document_chunks_title_trgm_idx
  on public.knowledge_document_chunks using gin (title extensions.gin_trgm_ops);
create index if not exists knowledge_document_chunks_body_trgm_idx
  on public.knowledge_document_chunks using gin (body extensions.gin_trgm_ops);

-- 命中语义与 JS 精排的 score > 0 判定完全对齐：任一查询词是 title / body / 任一 tag
-- 的子串（大小写不敏感）即视为候选；% _ \ 做 like 转义，避免查询词被当作通配符。
-- 排序沿用旧路径的 updated_at desc（附 id 保证确定性），上限夹在 1..200。
create or replace function public.search_knowledge_document_chunks(
  p_organization_id uuid,
  p_terms text[],
  p_limit integer default 50,
  p_doc_types text[] default null,
  p_project_id text default null,
  p_streamer_id text default null,
  p_product text default null,
  p_platform text default null,
  p_tags text[] default null,
  p_updated_after timestamptz default null
)
returns table (
  id uuid,
  knowledge_document_id uuid,
  doc_type text,
  title text,
  body text,
  source_ref text,
  tags text[],
  project_id text,
  streamer_id text,
  live_task_id text,
  product text,
  platform text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with patterns as (
    select distinct
      '%'
        || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_')
        || '%' as pattern
    from unnest(coalesce(p_terms, '{}'::text[])) as t(term)
    where btrim(t.term) <> ''
  )
  select
    c.id,
    c.knowledge_document_id,
    c.doc_type,
    c.title,
    c.body,
    c.source_ref,
    c.tags,
    c.project_id,
    c.streamer_id,
    c.live_task_id,
    c.product,
    c.platform,
    c.updated_at
  from public.knowledge_document_chunks as c
  where c.organization_id = p_organization_id
    and (p_doc_types is null or c.doc_type = any (p_doc_types))
    and (p_project_id is null or c.project_id = p_project_id)
    and (p_streamer_id is null or c.streamer_id = p_streamer_id)
    and (p_product is null or c.product = p_product)
    and (p_platform is null or c.platform = p_platform)
    and (p_tags is null or c.tags @> p_tags)
    and (p_updated_after is null or c.updated_at >= p_updated_after)
    and exists (
      select 1
      from patterns as p
      where c.title ilike p.pattern
         or c.body ilike p.pattern
         or exists (
           select 1
           from unnest(c.tags) as ct(tag)
           where ct.tag ilike p.pattern
         )
    )
  order by c.updated_at desc, c.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

create or replace function public.search_knowledge_documents(
  p_organization_id uuid,
  p_terms text[],
  p_limit integer default 50,
  p_doc_types text[] default null,
  p_tags text[] default null,
  p_updated_after timestamptz default null
)
returns table (
  id uuid,
  doc_type text,
  title text,
  body text,
  source_ref text,
  tags text[],
  metadata jsonb,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with patterns as (
    select distinct
      '%'
        || replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_')
        || '%' as pattern
    from unnest(coalesce(p_terms, '{}'::text[])) as t(term)
    where btrim(t.term) <> ''
  )
  select
    d.id,
    d.doc_type,
    d.title,
    d.body,
    d.source_ref,
    d.tags,
    d.metadata,
    d.updated_at
  from public.knowledge_documents as d
  where d.organization_id = p_organization_id
    and (p_doc_types is null or d.doc_type = any (p_doc_types))
    and (p_tags is null or d.tags @> p_tags)
    and (p_updated_after is null or d.updated_at >= p_updated_after)
    and exists (
      select 1
      from patterns as p
      where d.title ilike p.pattern
         or d.body ilike p.pattern
         or exists (
           select 1
           from unnest(d.tags) as dt(tag)
           where dt.tag ilike p.pattern
         )
    )
  order by d.updated_at desc, d.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

grant execute on function public.search_knowledge_document_chunks(
  uuid, text[], integer, text[], text, text, text, text, text[], timestamptz
) to authenticated, service_role;
grant execute on function public.search_knowledge_documents(
  uuid, text[], integer, text[], text[], timestamptz
) to authenticated, service_role;
