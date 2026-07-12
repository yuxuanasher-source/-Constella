import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCustomSettlementEvidenceSnapshot } from "../../features/settlements/custom-rule-route-context";

const upgradeContainer =
  process.env.CUSTOM_SETTLEMENT_RUNTIME_UPGRADE_REGRESSION_CONTAINER;
const pnpmEntrypoint =
  process.env.npm_execpath ??
  (process.platform === "win32" && process.env.APPDATA
    ? join(
        process.env.APPDATA,
        "npm",
        "node_modules",
        "pnpm",
        "bin",
        "pnpm.cjs",
      )
    : null);

function safeCommandOutput(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "[redacted-database-url]")
    .slice(-4_000);
}

function runSupabase(args: string[]): void {
  const command = pnpmEntrypoint ? process.execPath : "pnpm";
  const commandArgs = pnpmEntrypoint
    ? [pnpmEntrypoint, "exec", "supabase", ...args]
    : ["exec", "supabase", ...args];
  const result = spawnSync(
    command,
    commandArgs,
    {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    timeout: 120_000,
    windowsHide: true,
    },
  );
  expect(
    result.status,
    safeCommandOutput(`${result.stdout ?? ""}\n${result.stderr ?? ""}`),
  ).toBe(0);
}

function runSqlCapture(
  container: string,
  sql: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input: sql,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function runSql(container: string, sql: string): string {
  const result = runSqlCapture(container, sql);
  expect(result.status, safeCommandOutput(result.stderr)).toBe(0);
  return result.stdout.trim();
}

function snapshotSignatures(container: string): string[] {
  const output = runSql(
    container,
    `
      select pg_catalog.oidvectortypes(proc.proargtypes)
      from pg_catalog.pg_proc as proc
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = proc.pronamespace
      where namespace.nspname = 'public'
        and proc.proname = 'read_custom_settlement_evidence_snapshot'
      order by 1;
    `,
  );
  return output ? output.split(/\r?\n/gu) : [];
}

describe.runIf(Boolean(upgradeContainer))(
  "custom settlement runtime forward migration upgrade",
  () => {
    it("replaces the recorded six-argument RPC and preserves hardened evidence", async () => {
      const container = upgradeContainer ?? "";
      const actorId = "8c110000-0000-4000-8000-000000000001";
      const organizationId = "8c120000-0000-4000-8000-000000000001";
      const projectId = "8c130000-0000-4000-8000-000000000001";
      const selectedBatchId = "8c140000-0000-4000-8000-000000000001";
      const emptyBatchId = "8c140000-0000-4000-8000-000000000002";
      const itemId = "8c150000-0000-4000-8000-000000000001";
      const selectedCostId = "8c160000-0000-4000-8000-000000000001";
      const emptyBatchCostId = "8c160000-0000-4000-8000-000000000002";
      const cleanupSql = `
        delete from public.project_cost_items
        where organization_id = '${organizationId}'::uuid;
        delete from public.settlement_batch_items
        where organization_id = '${organizationId}'::uuid;
        delete from public.settlement_batches
        where organization_id = '${organizationId}'::uuid;
        delete from public.projects
        where organization_id = '${organizationId}'::uuid;
        delete from public.organization_members
        where organization_id = '${organizationId}'::uuid;
        delete from public.organizations
        where id = '${organizationId}'::uuid;
        delete from public.profiles where id = '${actorId}'::uuid;
        delete from auth.users where id = '${actorId}'::uuid;
        select pg_catalog.set_config('request.jwt.claim.sub', '', false);
      `;

      try {
        runSupabase([
          "db",
          "reset",
          "--version",
          "20260711115000",
          "--no-seed",
        ]);
        expect(
          runSql(
            container,
            `select version from supabase_migrations.schema_migrations order by version desc limit 1;`,
          ),
        ).toBe("20260711115000");
        expect(snapshotSignatures(container)).toEqual([
          "uuid, uuid, text, date, date, integer",
        ]);

        runSupabase(["migration", "up", "--local"]);
        const upgradedLedger = runSql(
          container,
          `
            select version
            from supabase_migrations.schema_migrations
            where version in ('20260711115500', '20260711115600')
            order by version;
          `,
        ).split(/\r?\n/gu);
        expect(upgradedLedger).toEqual(["20260711115500", "20260711115600"]);
        expect(snapshotSignatures(container)).toEqual([
          "uuid, uuid, text, date, date, text, text, text, integer, integer",
        ]);
        const oldCall = runSqlCapture(
          container,
          `
            select public.read_custom_settlement_evidence_snapshot(
              extensions.gen_random_uuid(), extensions.gen_random_uuid(),
              'payable', current_date, current_date, 100
            );
          `,
        );
        expect(oldCall.status).not.toBe(0);
        expect(oldCall.stderr.toLowerCase()).toContain("does not exist");

        const privileges = JSON.parse(
          runSql(
            container,
            `
              select pg_catalog.jsonb_build_object(
                'authenticated', pg_catalog.has_function_privilege(
                  'authenticated', proc.oid, 'execute'
                ),
                'anon', pg_catalog.has_function_privilege(
                  'anon', proc.oid, 'execute'
                ),
                'service_role', pg_catalog.has_function_privilege(
                  'service_role', proc.oid, 'execute'
                )
              )
              from pg_catalog.pg_proc as proc
              join pg_catalog.pg_namespace as namespace
                on namespace.oid = proc.pronamespace
              where namespace.nspname = 'public'
                and proc.proname = 'read_custom_settlement_evidence_snapshot';
            `,
          ),
        ) as {
          authenticated: boolean;
          anon: boolean;
          service_role: boolean;
        };
        expect(privileges).toEqual({
          authenticated: true,
          anon: false,
          service_role: false,
        });

        runSql(
          container,
          `
            insert into auth.users (id, email) values
              ('${actorId}'::uuid, 'task8-upgrade-owner@example.invalid');
            insert into public.profiles (id, email, full_name) values
              (
                '${actorId}'::uuid,
                'task8-upgrade-owner@example.invalid',
                'Task8 Upgrade Owner'
              );
            insert into public.organizations (id, name, code) values
              (
                '${organizationId}'::uuid,
                'Task8 Upgrade Runtime',
                'task8-upgrade-runtime'
              );
            insert into public.organization_members (
              organization_id, user_id, role, status
            ) values (
              '${organizationId}'::uuid,
              '${actorId}'::uuid,
              'owner',
              'active'
            );
            insert into public.projects (
              id, organization_id, code, name, created_by, owner_id
            ) values (
              '${projectId}'::uuid,
              '${organizationId}'::uuid,
              'task8-upgrade-source',
              'Task8 Upgrade Source',
              '${actorId}'::uuid,
              '${actorId}'::uuid
            );
            insert into public.settlement_batches (
              id, organization_id, project_id, batch_type, status,
              period_start, period_end, computed_amount, locked_at,
              created_by, title
            ) values
              (
                '${selectedBatchId}'::uuid,
                '${organizationId}'::uuid,
                '${projectId}'::uuid,
                'payable', 'locked', '2026-07-01'::date,
                '2026-07-31'::date, 100.00,
                '2026-08-01T00:00:00Z'::timestamptz,
                '${actorId}'::uuid, 'Selected batch'
              ),
              (
                '${emptyBatchId}'::uuid,
                '${organizationId}'::uuid,
                '${projectId}'::uuid,
                'payable', 'locked', '2026-07-02'::date,
                '2026-07-30'::date, 0.00,
                '2026-08-01T00:00:00Z'::timestamptz,
                '${actorId}'::uuid, 'Empty overlap'
              );
            insert into public.settlement_batch_items (
              id, organization_id, settlement_batch_id, project_id,
              streamer_id, live_report_id, item_type, computed_amount,
              evidence_level
            ) values (
              '${itemId}'::uuid,
              '${organizationId}'::uuid,
              '${selectedBatchId}'::uuid,
              '${projectId}'::uuid,
              null, null, 'manual', 100.00, 'green'
            );
            insert into public.project_cost_items (
              id, organization_id, project_id, streamer_id, live_report_id,
              settlement_batch_id, item_type, amount_cents, direction,
              evidence_level, source, reason, status, created_by, created_at
            ) values
              (
                '${selectedCostId}'::uuid,
                '${organizationId}'::uuid,
                '${projectId}'::uuid,
                null, null, '${selectedBatchId}'::uuid,
                'manual', 123, 'cost', 'green', 'manual',
                'Selected item batch cost', 'confirmed', '${actorId}'::uuid,
                '2026-07-03T00:00:00Z'::timestamptz
              ),
              (
                '${emptyBatchCostId}'::uuid,
                '${organizationId}'::uuid,
                '${projectId}'::uuid,
                null, null, '${emptyBatchId}'::uuid,
                'manual', 456, 'cost', 'green', 'manual',
                'Empty overlap batch cost', 'confirmed', '${actorId}'::uuid,
                '2026-07-03T00:00:00Z'::timestamptz
              );
          `,
        );
        const snapshotText = runSql(
          container,
          `
            select pg_catalog.set_config(
              'request.jwt.claim.sub', '${actorId}', false
            );
            select public.read_custom_settlement_evidence_snapshot(
              '${organizationId}'::uuid,
              '${projectId}'::uuid,
              'payable',
              '2026-07-01'::date,
              '2026-07-31'::date,
              'Asia/Shanghai',
              'contract_default',
              'project_period',
              10000,
              500
            );
          `,
        );
        const snapshotLine = snapshotText
          .split(/\r?\n/gu)
          .find((line) => line.trim().startsWith("{"));
        expect(snapshotLine).toBeDefined();
        const snapshot = JSON.parse(snapshotLine ?? "null") as {
          captured_at: string;
          record_count: number;
          project_cost_items: Array<{ amount_cents: string }>;
        };
        expect(
          parseCustomSettlementEvidenceSnapshot(
            snapshot,
            {
              organizationId,
              actorId,
              projectId,
              scope: "payable",
              periodStart: "2026-07-01",
              periodEnd: "2026-07-31",
              businessTimezone: "Asia/Shanghai",
              businessTimezoneSource: "contract_default",
              executionGrain: "project_period",
              periodStartInclusive: "2026-06-30T16:00:00.000Z",
              periodEndExclusive: "2026-07-31T16:00:00.000Z",
            },
            () => new Date(snapshot.captured_at),
          ),
        ).toBeDefined();
        expect(snapshot.record_count).toBe(1);
        expect(
          snapshot.project_cost_items.map((cost) => cost.amount_cents),
        ).toEqual(["123"]);

        runSql(container, cleanupSql);
        expect(
          runSql(
            container,
            `
              select pg_catalog.count(*)
              from public.organizations
              where id = '${organizationId}'::uuid;
            `,
          ),
        ).toBe("0");
      } finally {
        runSupabase(["db", "reset"]);
      }
    }, 180_000);
  },
);
