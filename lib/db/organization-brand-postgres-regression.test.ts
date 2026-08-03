import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const container = process.env.ORGANIZATION_BRAND_DB_REGRESSION_CONTAINER;
const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260801093000_organization_brand_draft_save_rpc.sql",
  ),
  "utf8",
);
const ids = {
  organization: "f1200000-0000-4000-8000-000000000001",
  owner: "f1200000-0000-4000-8000-000000000011",
} as const;

describe.runIf(Boolean(container))(
  "organization brand PostgreSQL draft save regression",
  () => {
    it("updates the same draft from revision 1 to 2 and always rolls back fixtures", () => {
      const dbContainer = container ?? "";
      expect(dbContainer).toMatch(/^supabase_db_[a-z0-9_.-]+$/iu);
      expect(inspectContainer(dbContainer)).toBe(`/${dbContainer}|true`);
      expect(runSqlText(dbContainer, "select current_database();")).toBe(
        "postgres",
      );

      const execution = runSqlCapture(
        dbContainer,
        `begin;
         alter table public.organization_brand_drafts
           add column if not exists draft_revision integer not null default 0
           check (draft_revision >= 0);

         ${migration}

         insert into auth.users (id, email) values (
           '${ids.owner}'::uuid,
           'organization-brand-db-owner@example.invalid'
         );
         insert into public.profiles (id, email, full_name) values (
           '${ids.owner}'::uuid,
           'organization-brand-db-owner@example.invalid',
           'Organization Brand DB Owner'
         );
         insert into public.organizations (
           id, name, code, branding_version
         ) values (
           '${ids.organization}'::uuid,
           'Organization Brand DB Regression',
           'organization-brand-db-regression',
           3
         );
         insert into public.organization_members (
           organization_id, user_id, role, status
         ) values (
           '${ids.organization}'::uuid,
           '${ids.owner}'::uuid,
           'owner',
           'active'
         );

         set local role authenticated;
         set local "request.jwt.claim.sub" = '${ids.owner}';

         select
           draft_revision::text || '|' || (content ->> 'brandName')
         from public.save_organization_brand_draft(
           '${ids.organization}'::uuid,
           3,
           0,
           jsonb_build_object(
             'logoText', 'DB',
             'logoStoragePath', null,
             'brandName', 'First Draft',
             'brandTagline', 'Insert path',
             'primaryColor', '#123456'
           )
         );

         select
           draft_revision::text || '|' || (content ->> 'brandName')
         from public.save_organization_brand_draft(
           '${ids.organization}'::uuid,
           3,
           1,
           jsonb_build_object(
             'logoText', 'DB',
             'logoStoragePath', null,
             'brandName', 'Second Draft',
             'brandTagline', 'Update path',
             'primaryColor', '#654321'
           )
         );

         select
           draft_revision::text || '|' || (content ->> 'brandName')
         from public.organization_brand_drafts
         where organization_id = '${ids.organization}'::uuid;

         rollback;`,
      );
      const residue = runSqlCapture(dbContainer, residueSql());

      expect(residue.code, residue.stderr).toBe(0);
      expect(residue.stdout.trim()).toBe("0|0|0|0");
      expect(execution.code, execution.stderr).toBe(0);
      expect(execution.stdout.trim().split(/\r?\n/u)).toEqual([
        "1|First Draft",
        "2|Second Draft",
        "2|Second Draft",
      ]);
    });
  },
);

function residueSql(): string {
  return `select concat_ws(
    '|',
    (
      select count(*)
      from public.organization_brand_drafts
      where organization_id = '${ids.organization}'::uuid
    ),
    (
      select count(*)
      from public.organization_members
      where organization_id = '${ids.organization}'::uuid
    ),
    (
      select count(*)
      from public.organizations
      where id = '${ids.organization}'::uuid
    ),
    (
      select count(*)
      from auth.users
      where id = '${ids.owner}'::uuid
    )
  );`;
}

function inspectContainer(containerName: string): string {
  const result = spawnSync(
    "docker",
    ["inspect", "--format", "{{.Name}}|{{.State.Running}}", containerName],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  return (result.stdout ?? "").trim();
}

function runSqlText(containerName: string, sql: string): string {
  const result = runSqlCapture(containerName, sql);
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.trim();
}

function runSqlCapture(
  containerName: string,
  sql: string,
): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atq",
    ],
    { input: sql, encoding: "utf8", timeout: 30_000 },
  );
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
