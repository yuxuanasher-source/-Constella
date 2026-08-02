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
      /returns table \([\s\S]*organization_id uuid[\s\S]*base_version integer[\s\S]*content jsonb[\s\S]*updated_at timestamptz/,
    );
  });

  it("locks the organization before comparing the expected version and upserting", () => {
    const fn = functionSql();
    const lock = fn.indexOf("from public.organizations as organization");
    const versionCheck = fn.indexOf(
      "p_expected_version is distinct from v_organization.branding_version",
    );
    const upsert = fn.indexOf("insert into public.organization_brand_drafts");

    expect(lock).toBeGreaterThan(-1);
    expect(fn.slice(lock, versionCheck)).toContain("for update");
    expect(versionCheck).toBeGreaterThan(lock);
    expect(fn.slice(versionCheck, upsert)).toContain("brand_version_conflict");
    expect(upsert).toBeGreaterThan(versionCheck);
    expect(fn.slice(upsert)).toContain(
      "on conflict on constraint organization_brand_drafts_pkey",
    );
    expect(fn.slice(upsert)).toContain("base_version = excluded.base_version");
  });

  it("validates and canonicalizes only the five source fields", () => {
    const fn = functionSql();

    expect(fn).toMatch(
      /p_expected_version is null[\s\S]*p_expected_version < 0[\s\S]*brand_draft_invalid_expected_version/,
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

  it("binds organization, version, and provenance to locked server values", () => {
    const fn = compact(functionSql());

    expect(fn).toContain(
      "values ( p_organization_id, v_organization.branding_version, v_canonical_content, v_actor_user_id, v_updated_at )",
    );
    expect(fn).toContain("updated_by = excluded.updated_by");
    expect(fn).toContain("updated_at = excluded.updated_at");
    expect(fn).toContain(
      "returning saved_draft.updated_at into v_updated_at; return query",
    );
    expect(fn).toContain(
      "return query select p_organization_id, v_organization.branding_version, v_canonical_content, v_updated_at;",
    );
  });

  it("removes direct authenticated draft mutation and exposes only the RPC", () => {
    const compacted = compact(sql);

    expect(compacted).toContain(
      "revoke insert, update, delete on table public.organization_brand_drafts from authenticated;",
    );
    expect(compacted).toContain(
      "revoke all on function public.save_organization_brand_draft(uuid, integer, jsonb) from public, anon, authenticated, service_role;",
    );
    expect(compacted).toContain(
      "grant execute on function public.save_organization_brand_draft(uuid, integer, jsonb) to authenticated;",
    );
    expect(compacted).not.toMatch(
      /grant execute on function public\.save_organization_brand_draft\([^;]+\) to (?:public|anon|service_role)/u,
    );
  });
});
