import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const container = process.env.ORGANIZATION_BRAND_DB_REGRESSION_CONTAINER;
const draftSaveMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260801093000_organization_brand_draft_save_rpc.sql",
  ),
  "utf8",
);
const legacyShareCreateMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260730123000_admission_share_create_rpc.sql",
  ),
  "utf8",
);
const shareSnapshotMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260801100000_admission_share_brand_snapshot_rpc.sql",
  ),
  "utf8",
);
const legacyShareCreateMarker =
  "create or replace function public.create_admission_share_board(";
const legacyShareCreateStart = legacyShareCreateMigration.indexOf(
  legacyShareCreateMarker,
);
if (legacyShareCreateStart < 0) {
  throw new Error("Legacy admission share create RPC is missing");
}
const legacyShareCreateRpc = legacyShareCreateMigration.slice(
  legacyShareCreateStart,
);
const ids = {
  organization: "f1200000-0000-4000-8000-000000000001",
  owner: "f1200000-0000-4000-8000-000000000011",
  project: "f1200000-0000-4000-8000-000000000021",
  streamer: "f1200000-0000-4000-8000-000000000031",
  application: "f1200000-0000-4000-8000-000000000041",
  recording: "f1200000-0000-4000-8000-000000000051",
  invalidCreator: "f1200000-0000-4000-8000-000000000099",
} as const;

describe.runIf(Boolean(container))(
  "organization brand PostgreSQL regression",
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

         ${draftSaveMigration}

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

    it("keeps legacy and branded share-create payloads callable without bypassing guards", () => {
      const dbContainer = container ?? "";
      expect(dbContainer).toMatch(/^supabase_db_[a-z0-9_.-]+$/iu);
      expect(inspectContainer(dbContainer)).toBe(`/${dbContainer}|true`);
      const inventoryBefore = runSqlText(
        dbContainer,
        shareCreateInventorySql(),
      );

      const execution = runSqlCapture(
        dbContainer,
        `begin;

         ${legacyShareCreateRpc}

         ${shareSnapshotMigration}

         select concat_ws(
           '|',
           p.pronargs,
           array_to_string(p.proargnames[1:p.pronargs], ','),
           p.prorettype::regtype,
           p.proretset,
           p.prosecdef,
           p.pronargdefaults,
           has_function_privilege('authenticated', p.oid, 'execute'),
           has_function_privilege('anon', p.oid, 'execute')
         )
         from pg_catalog.pg_proc as p
         join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'create_admission_share_board'
         order by p.pronargs;

         insert into auth.users (id, email) values (
           '${ids.owner}'::uuid,
           'organization-brand-share-owner@example.invalid'
         );
         insert into public.profiles (id, email, full_name) values (
           '${ids.owner}'::uuid,
           'organization-brand-share-owner@example.invalid',
           'Organization Brand Share Owner'
         );
         insert into public.organizations (
           id, name, code, branding, branding_version
         ) values (
           '${ids.organization}'::uuid,
           'Organization Brand Share Regression',
           'organization-brand-share-regression',
           jsonb_build_object(
             'schemaVersion', 1,
             'logoText', 'CB',
             'brandName', 'Compatibility Brand',
             'brandTagline', 'Trusted legacy shares',
             'primaryColor', '#123ABC',
             'publishedAt', '2026-08-02T00:00:00.000Z'
           ),
           7
         );
         insert into public.organization_members (
           organization_id, user_id, role, status
         ) values (
           '${ids.organization}'::uuid,
           '${ids.owner}'::uuid,
           'owner',
           'active'
         );
         insert into public.projects (
           id, organization_id, code, name, status, created_by
         ) values (
           '${ids.project}'::uuid,
           '${ids.organization}'::uuid,
           'brand-share-compat',
           'Brand Share Compatibility',
           'active',
           '${ids.owner}'::uuid
         );
         insert into public.streamers (
           id, organization_id, display_name, created_by
         ) values (
           '${ids.streamer}'::uuid,
           '${ids.organization}'::uuid,
           'Brand Share Streamer',
           '${ids.owner}'::uuid
         );
         insert into public.project_applications (
           id, organization_id, project_id, streamer_id, source, status
         ) values (
           '${ids.application}'::uuid,
           '${ids.organization}'::uuid,
           '${ids.project}'::uuid,
           '${ids.streamer}'::uuid,
           'direct_invite',
           'recording_approved'
         );
         insert into public.recording_submissions (
           id, organization_id, application_id, project_id, streamer_id,
           version, storage_path, status, mcn_review_decision,
           mcn_reviewed_by, mcn_reviewed_at
         ) values (
           '${ids.recording}'::uuid,
           '${ids.organization}'::uuid,
           '${ids.application}'::uuid,
           '${ids.project}'::uuid,
           '${ids.streamer}'::uuid,
           1,
           '${ids.organization}/${ids.recording}.webm',
           'approved',
           'approved',
           '${ids.owner}'::uuid,
           clock_timestamp()
         );

         set local role authenticated;
         set local "request.jwt.claim.sub" = '${ids.owner}';

         do $compatibility_guard$
         begin
           perform public.create_admission_share_board(
             p_organization_id => '${ids.organization}'::uuid,
             p_project_id => '${ids.project}'::uuid,
             p_title => 'Rejected legacy payload',
             p_purpose => '',
             p_mode => 'preview',
             p_token_hash => 'rejected-legacy-token',
             p_access_code_hash => null,
             p_expires_at => clock_timestamp() + interval '7 days',
             p_allow_external_fallback => true,
             p_created_by => '${ids.invalidCreator}'::uuid,
             p_items => jsonb_build_array(jsonb_build_object(
               'application_id', '${ids.application}',
               'recording_submission_id', '${ids.recording}',
               'recording_version', 1,
               'sort_order', 0
             ))
           );
           raise exception 'legacy_share_auth_guard_was_bypassed';
         exception
           when insufficient_privilege then null;
         end;
         $compatibility_guard$;

         select concat_ws(
           '|',
           'legacy',
           legacy.title,
           legacy.brand_snapshot->>'schemaVersion',
           legacy.brand_snapshot->>'version',
           legacy.brand_snapshot->>'brandName',
           legacy.brand_snapshot->>'primaryColor',
           legacy.brand_version,
           legacy.contact_card_id is null,
           legacy.contact_card_snapshot is null
         )
         from public.create_admission_share_board(
           p_organization_id => '${ids.organization}'::uuid,
           p_project_id => '${ids.project}'::uuid,
           p_title => 'Legacy payload',
           p_purpose => '',
           p_mode => 'preview',
           p_token_hash => 'legacy-token',
           p_access_code_hash => null,
           p_expires_at => clock_timestamp() + interval '7 days',
           p_allow_external_fallback => true,
           p_created_by => '${ids.owner}'::uuid,
           p_items => jsonb_build_array(jsonb_build_object(
             'application_id', '${ids.application}',
             'recording_submission_id', '${ids.recording}',
             'recording_version', 1,
             'sort_order', 0
           ))
         ) as legacy;

         select concat_ws(
           '|',
           'branded',
           branded.board->>'title',
           branded.snapshot->'brandSnapshot'->>'schemaVersion',
           branded.snapshot->'brandSnapshot'->>'version',
           branded.snapshot->'brandSnapshot'->>'brandName',
           branded.snapshot->'brandSnapshot'->>'primaryColor',
           branded.snapshot->>'brandVersion',
           branded.snapshot->'contactCardId' = 'null'::jsonb
         )
         from public.create_admission_share_board(
           p_organization_id => '${ids.organization}'::uuid,
           p_project_id => '${ids.project}'::uuid,
           p_title => 'Branded payload',
           p_purpose => '',
           p_mode => 'preview',
           p_token_hash => 'branded-token',
           p_access_code_hash => null,
           p_expires_at => clock_timestamp() + interval '7 days',
           p_allow_external_fallback => true,
           p_created_by => '${ids.owner}'::uuid,
           p_items => jsonb_build_array(jsonb_build_object(
             'application_id', '${ids.application}',
             'recording_submission_id', '${ids.recording}',
             'recording_version', 1,
             'sort_order', 0
           )),
           p_contact_card_id => null
         ) as branded;

         select concat_ws(
           '|',
           count(*) filter (where event_type = 'created'),
           count(distinct share_board_id) filter (where event_type = 'created'),
           (select count(*) from public.project_recording_share_items
            where project_id = '${ids.project}'::uuid)
         )
         from public.project_recording_share_events
         where project_id = '${ids.project}'::uuid;

         rollback;`,
      );
      const residue = runSqlCapture(dbContainer, shareResidueSql());
      const inventoryAfter = runSqlText(dbContainer, shareCreateInventorySql());

      expect(execution.code, execution.stderr).toBe(0);
      expect(execution.stdout.trim().split(/\r?\n/u)).toEqual([
        "11|p_organization_id,p_project_id,p_title,p_purpose,p_mode,p_token_hash,p_access_code_hash,p_expires_at,p_allow_external_fallback,p_created_by,p_items|project_recording_share_boards|f|f|0|t|f",
        "12|p_organization_id,p_project_id,p_title,p_purpose,p_mode,p_token_hash,p_access_code_hash,p_expires_at,p_allow_external_fallback,p_created_by,p_items,p_contact_card_id|record|t|t|0|t|f",
        "legacy|Legacy payload|1|7|Compatibility Brand|#123ABC|7|t|t",
        "branded|Branded payload|1|7|Compatibility Brand|#123ABC|7|t",
        "2|2|2",
      ]);
      expect(residue.code, residue.stderr).toBe(0);
      expect(residue.stdout.trim()).toBe("0|0|0|0|0|0|0|0");
      expect(inventoryAfter).toBe(inventoryBefore);
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

function shareCreateInventorySql(): string {
  return `select coalesce(string_agg(
    p.oid::regprocedure::text || '|' || p.prosecdef::text || '|' ||
      p.prorettype::regtype::text || '|' || p.proretset::text,
    E'\\n' order by p.pronargs
  ), '')
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_admission_share_board';`;
}

function shareResidueSql(): string {
  return `select concat_ws(
    '|',
    (select count(*) from public.project_recording_share_events
      where project_id = '${ids.project}'::uuid),
    (select count(*) from public.project_recording_share_items
      where project_id = '${ids.project}'::uuid),
    (select count(*) from public.project_recording_share_boards
      where project_id = '${ids.project}'::uuid),
    (select count(*) from public.recording_submissions
      where id = '${ids.recording}'::uuid),
    (select count(*) from public.project_applications
      where id = '${ids.application}'::uuid),
    (select count(*) from public.streamers
      where id = '${ids.streamer}'::uuid),
    (select count(*) from public.projects
      where id = '${ids.project}'::uuid),
    (select count(*) from public.organizations
      where id = '${ids.organization}'::uuid)
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
