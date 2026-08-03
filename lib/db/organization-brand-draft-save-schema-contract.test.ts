import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260801093000_organization_brand_draft_save_rpc.sql",
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function functionSql(): string {
  const start = sql.indexOf(
    "create or replace function public.save_organization_brand_draft(",
  );
  if (start < 0) {
    return "";
  }
  const end = sql.indexOf("\n$$;", start);
  return end < 0 ? sql.slice(start) : sql.slice(start, end + 4);
}

describe("organization brand atomic draft save schema", () => {
  it("defines a locked exact-owner security-definer RPC", () => {
    const fn = functionSql();

    expect(fn).not.toBe("");
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = ''");
    expect(fn).toContain("v_actor_user_id uuid := auth.uid()");
    expect(fn).toMatch(
      /v_actor_user_id is null[\s\S]*public\.current_user_role\(p_organization_id\)[\s\S]*'owner'/,
    );
    expect(fn).toMatch(
      /returns table \([\s\S]*organization_id uuid[\s\S]*base_version integer[\s\S]*draft_revision integer[\s\S]*content jsonb[\s\S]*updated_at timestamptz/,
    );
    expect(fn).toMatch(/p_expected_draft_revision integer/);
  });

  it("locks the organization and draft before comparing both CAS tokens", () => {
    const fn = functionSql();
    const lock = fn.indexOf("from public.organizations as organization");
    const versionCheck = fn.indexOf(
      "p_expected_version is distinct from v_organization.branding_version",
    );
    const draftLock = fn.indexOf(
      "from public.organization_brand_drafts as draft",
    );
    const revisionCheck = fn.indexOf(
      "p_expected_draft_revision is distinct from v_draft.draft_revision",
    );
    const write = fn.indexOf("update public.organization_brand_drafts");

    expect(lock).toBeGreaterThan(-1);
    expect(fn.slice(lock, versionCheck)).toContain("for update");
    expect(versionCheck).toBeGreaterThan(lock);
    expect(fn.slice(versionCheck, draftLock)).toContain(
      "brand_version_conflict",
    );
    expect(draftLock).toBeGreaterThan(versionCheck);
    expect(fn.slice(draftLock, revisionCheck)).toContain("for update");
    expect(revisionCheck).toBeGreaterThan(draftLock);
    expect(fn.slice(revisionCheck, write)).toContain("brand_draft_conflict");
    expect(write).toBeGreaterThan(revisionCheck);
    expect(fn).toMatch(
      /if not found then[\s\S]*p_expected_draft_revision is distinct from 0[\s\S]*brand_draft_conflict[\s\S]*v_next_draft_revision := 1/,
    );
    expect(fn).toMatch(/v_next_draft_revision := v_draft\.draft_revision \+ 1/);
  });

  it("validates and canonicalizes only the five source fields", () => {
    const fn = functionSql();

    expect(fn).toMatch(
      /p_expected_version is null[\s\S]*p_expected_version < 0[\s\S]*p_expected_draft_revision is null[\s\S]*p_expected_draft_revision < 0[\s\S]*brand_draft_invalid_expected_version/,
    );
    expect(fn).toMatch(/jsonb_typeof\(p_content\) is distinct from 'object'/);
    expect(fn).toMatch(
      /jsonb_object_keys\(p_content\)[\s\S]*'logotext'[\s\S]*'logostoragepath'[\s\S]*'brandname'[\s\S]*'brandtagline'[\s\S]*'primarycolor'/,
    );
    for (const field of [
      "logotext",
      "brandname",
      "brandtagline",
      "primarycolor",
    ]) {
      expect(fn).toMatch(
        new RegExp(
          `jsonb_typeof\\(p_content -> '${field}'\\) is distinct from 'string'`,
        ),
      );
    }
    expect(fn).toMatch(
      /jsonb_typeof\(p_content -> 'logostoragepath'\)[\s\S]*'string'[\s\S]*'null'/,
    );
    expect(fn).toMatch(
      /char_length\(v_logo_text\) not between 1 and 8[\s\S]*char_length\(v_brand_name\) not between 1 and 40[\s\S]*char_length\(v_brand_tagline\) > 80/,
    );
    expect(fn).toMatch(/v_primary_color !~ '\^#\[0-9a-f\]\{6\}\$'/);
    expect(fn).toMatch(
      /v_logo_storage_path !~\* format\([\s\S]*\^%s\/brand-logos\/[\s\S]*\\\.webp\$[\s\S]*p_organization_id::text/,
    );
    expect(fn).toMatch(
      /v_canonical_content := jsonb_build_object\([\s\S]*'logotext', v_logo_text[\s\S]*'logostoragepath', v_logo_storage_path[\s\S]*'brandname', v_brand_name[\s\S]*'brandtagline', v_brand_tagline[\s\S]*'primarycolor', v_primary_color/,
    );
  });

  it("binds organization, versions, and provenance to locked server values", () => {
    const fn = compact(functionSql());

    expect(fn).toContain("draft_revision = v_next_draft_revision");
    expect(fn).toContain("updated_by = v_actor_user_id");
    expect(fn).toContain(
      "update public.organization_brand_drafts as draft_to_update",
    );
    expect(fn).toContain(
      "where draft_to_update.organization_id = p_organization_id",
    );
    expect(fn).not.toMatch(/where organization_id = p_organization_id/u);
    expect(fn).toContain(
      "return query select p_organization_id, v_organization.branding_version, v_next_draft_revision, v_canonical_content, v_updated_at;",
    );
  });

  it("removes direct authenticated draft mutation and exposes only the RPC", () => {
    const compacted = compact(sql);

    expect(compacted).toContain(
      "revoke insert, update, delete on table public.organization_brand_drafts from authenticated;",
    );
    expect(compacted).toContain(
      "revoke all on function public.save_organization_brand_draft(uuid, integer, integer, jsonb) from public, anon, authenticated, service_role;",
    );
    expect(compacted).toContain(
      "grant execute on function public.save_organization_brand_draft(uuid, integer, integer, jsonb) to authenticated;",
    );
    expect(compacted).not.toMatch(
      /grant execute on function public\.save_organization_brand_draft\([^;]+\) to (?:public|anon|service_role)/u,
    );
  });
});
