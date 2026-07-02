import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260702130000_knowledge_search_trgm.sql",
  ),
  "utf8",
).toLowerCase();

describe("knowledge search trgm schema contract", () => {
  it("enables pg_trgm in the extensions schema", () => {
    expect(migration).toContain(
      "create extension if not exists pg_trgm with schema extensions",
    );
  });

  it("adds trigram gin indexes on the retrieved text columns", () => {
    for (const [index, table, column] of [
      ["knowledge_documents_title_trgm_idx", "knowledge_documents", "title"],
      ["knowledge_documents_body_trgm_idx", "knowledge_documents", "body"],
      [
        "knowledge_document_chunks_title_trgm_idx",
        "knowledge_document_chunks",
        "title",
      ],
      [
        "knowledge_document_chunks_body_trgm_idx",
        "knowledge_document_chunks",
        "body",
      ],
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `create index if not exists ${index}\\s+on public\\.${table} using gin \\(${column} extensions\\.gin_trgm_ops\\)`,
        ),
      );
    }
  });

  it("defines pushdown rpc functions as security invoker (RLS preserved)", () => {
    expect(migration).toContain(
      "create or replace function public.search_knowledge_document_chunks",
    );
    expect(migration).toContain(
      "create or replace function public.search_knowledge_documents",
    );
    expect(migration).not.toContain("security definer");
    expect(migration.match(/security invoker/g)).toHaveLength(2);
    expect(migration.match(/set search_path = public/g)).toHaveLength(2);
  });

  it("keeps candidate matching org-scoped, wildcard-escaped and bounded", () => {
    // 组织隔离过滤在函数体内显式存在（RLS 之上再加一层）。
    expect(
      migration.match(/organization_id = p_organization_id/g),
    ).toHaveLength(2);
    // 查询词做 like 转义，\ % _ 不被当作通配符。
    expect(migration).toContain(
      "replace(replace(replace(t.term, '\\', '\\\\'), '%', '\\%'), '_', '\\_')",
    );
    // 候选排序与旧路径一致（updated_at desc），上限夹在 1..200。
    expect(migration).toMatch(/order by c\.updated_at desc, c\.id/);
    expect(migration).toMatch(/order by d\.updated_at desc, d\.id/);
    expect(
      migration.match(/limit least\(greatest\(coalesce\(p_limit, 50\), 1\), 200\)/g),
    ).toHaveLength(2);
  });

  it("matches terms against title, body and tags like the js ranker", () => {
    // 命中判定必须覆盖 title / body / tags 三处子串（与 rankKnowledgePassages 对齐）。
    expect(migration.match(/title ilike p\.pattern/g)).toHaveLength(2);
    expect(migration.match(/body ilike p\.pattern/g)).toHaveLength(2);
    expect(migration.match(/from unnest\(c\.tags\)/g)).toHaveLength(1);
    expect(migration.match(/from unnest\(d\.tags\)/g)).toHaveLength(1);
  });

  it("avoids the fts parser that cannot tokenize chinese", () => {
    expect(migration).not.toContain("to_tsvector");
    expect(migration).not.toContain("tsquery");
  });
});
