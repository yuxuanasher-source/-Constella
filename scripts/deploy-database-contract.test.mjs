import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_DEPLOY_DB_TESTS === "1";
const container =
  process.env.DEPLOY_DB_TEST_CONTAINER ?? "supabase_db_jingying-cabin";
const postgrestContainer =
  process.env.DEPLOY_POSTGREST_TEST_CONTAINER ?? "supabase_rest_jingying-cabin";
const repoRoot = process.cwd();
const deployScript = join(repoRoot, "scripts/deploy.sh");
const bashBin = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  "bash",
].find((candidate) => candidate === "bash" || existsSync(candidate));

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
}

function docker(args, input) {
  return run("docker", args, input === undefined ? {} : { input });
}

function runAsync(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function shellPath(path) {
  const normalized = path.replace(/\\/g, "/");
  if (process.platform !== "win32") return normalized;
  return `/${normalized[0].toLowerCase()}${normalized.slice(2)}`;
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function psql(database, sql) {
  return docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      database,
      "-Atq",
    ],
    sql,
  );
}

function postgrestAdmin(path) {
  return run(
    "docker",
    [
      "exec",
      container,
      "curl",
      "--fail",
      "--silent",
      "--show-error",
      "--connect-timeout",
      "2",
      "--max-time",
      "5",
      `http://${postgrestContainer}:3001/${path}`,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
}

function schemaCacheGeneration(metrics) {
  const match = metrics
    .split(/\r?\n/)
    .filter((line) => line.startsWith("pgrst_schema_cache_loads_total{"))
    .find((line) => /status="SUCCESS"/.test(line))
    ?.match(/\s([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)$/);
  return match ? Number(match[1]) : Number.NaN;
}

(enabled ? describe : describe.skip)("atomic deploy database contract", () => {
  it("proves a real PostgREST admin cache reload and target-specific schema probe", async () => {
    const suffix = `${process.pid}_${Date.now()}`;
    const probe = `codex_postgrest_contract_${suffix}`;
    let created = false;

    expect(probe).toMatch(/^codex_postgrest_contract_[0-9_]+$/);
    try {
      for (const name of [container, postgrestContainer]) {
        const inspect = docker(["inspect", name]);
        expect(inspect.status, inspect.stderr).toBe(0);
      }

      const ready = postgrestAdmin("ready");
      expect(ready.status, ready.stderr).toBe(0);
      const beforeMetrics = postgrestAdmin("metrics");
      expect(beforeMetrics.status, beforeMetrics.stderr).toBe(0);
      const before = schemaCacheGeneration(beforeMetrics.stdout);
      expect(Number.isFinite(before)).toBe(true);

      const create = psql(
        "postgres",
        `
            create view public.${probe} as
              select '${probe}'::text as release_sha;
            revoke all on public.${probe} from public;
            revoke all on public.${probe}
              from anon, authenticated, service_role;
            notify pgrst, 'reload schema';
            select
              not has_table_privilege('anon', 'public.${probe}', 'SELECT'),
              not has_table_privilege(
                'authenticated',
                'public.${probe}',
                'SELECT'
              ),
              not has_table_privilege(
                'service_role',
                'public.${probe}',
                'SELECT'
              );
          `,
      );
      expect(create.status, create.stderr).toBe(0);
      expect(create.stdout.trim()).toBe("t|t|t");
      created = true;

      let observed = false;
      let lastObservation = {};
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        const currentReady = postgrestAdmin("ready");
        const metrics = postgrestAdmin("metrics");
        const cache = postgrestAdmin("schema_cache");
        lastObservation = {
          readyStatus: currentReady.status,
          metricsStatus: metrics.status,
          cacheStatus: cache.status,
          generation: schemaCacheGeneration(metrics.stdout),
          before,
          cacheContainsProbe: cache.stdout.includes(probe),
          readyError: currentReady.stderr,
          metricsError: metrics.stderr,
          cacheError: cache.stderr,
        };
        if (
          currentReady.status === 0 &&
          metrics.status === 0 &&
          cache.status === 0 &&
          schemaCacheGeneration(metrics.stdout) > before &&
          cache.stdout.includes(probe)
        ) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(observed, JSON.stringify(lastObservation)).toBe(true);
    } finally {
      if (created) {
        const cleanup = psql(
          "postgres",
          `
              drop view if exists public.${probe};
              notify pgrst, 'reload schema';
            `,
        );
        expect(cleanup.status, cleanup.stderr).toBe(0);
      }
    }
  }, 45_000);

  it("serializes concurrent migration attempts into a private, unforgeable ledger", async () => {
    const suffix = `${process.pid}_${Date.now()}`;
    const database = `codex_atomic_${suffix}`;
    const sandbox = mkdtempSync(join(tmpdir(), "atomic-db-contract-"));
    const migration = join(
      sandbox,
      "20260731115959_atomic_deploy_contract_probe.sql",
    );
    const manifest = join(sandbox, "migrations.manifest");
    const generationCalls = join(sandbox, "schema-generation-calls.log");
    const targetSha = "f".repeat(40);
    let created = false;

    expect(database).toMatch(/^codex_atomic_[0-9_]+$/);
    try {
      const inspect = docker(["inspect", container]);
      expect(inspect.status, inspect.stderr).toBe(0);

      const create = docker([
        "exec",
        container,
        "createdb",
        "-U",
        "postgres",
        "--template=template0",
        database,
      ]);
      expect(create.status, create.stderr).toBe(0);
      created = true;

      const initialized = psql(
        database,
        `
          create schema supabase_migrations authorization postgres;
          create table supabase_migrations.schema_migrations (
            version text primary key,
            statements text[],
            name text
          );
        `,
      );
      expect(initialized.status, initialized.stderr).toBe(0);

      writeFileSync(
        migration,
        [
          "-- deploy: expand",
          "create table public.atomic_deploy_contract_probe (",
          "  id bigint primary key",
          ");",
          "",
        ].join("\n"),
      );
      writeFileSync(
        manifest,
        Buffer.concat([Buffer.from(shellPath(migration)), Buffer.from([0])]),
      );
      writeFileSync(generationCalls, "");

      const deploymentArgs = [
        "-c",
        [
          "set -Eeuo pipefail",
          `export DB_CONTAINER=${shellQuote(container)}`,
          `export DB_NAME=${shellQuote(database)}`,
          "export POSTGREST_READY_URL=http://127.0.0.1:1/ready",
          "export POSTGREST_METRICS_URL=http://127.0.0.1:1/metrics",
          "export POSTGREST_SCHEMA_CACHE_URL=http://127.0.0.1:1/schema_cache",
          `export NODE_EXE=${shellQuote(shellPath(process.execPath))}`,
          `export GENERATION_CALLS=${shellQuote(shellPath(generationCalls))}`,
          `source ${shellQuote(shellPath(deployScript))}`,
          `release_dir=${shellQuote(shellPath(repoRoot))}`,
          `TARGET_SHA=${targetSha}`,
          'node() { "$NODE_EXE" "$@"; }',
          "read_postgrest_schema_cache_generation() { printf '41'; }",
          "wait_for_postgrest_schema_cache() {",
          "  [[ \"$1\" == '41' ]]",
          `  [[ "$2" == 'deploy_schema_probe_${targetSha}' ]]`,
          '  printf \'%s\\n\' "$$" >> "$GENERATION_CALLS"',
          "}",
          `migration_manifest=${shellQuote(shellPath(manifest))}`,
          "acquire_database_deploy_lease",
          "preflight_migration_ledgers",
          "apply_migrations",
          "release_database_deploy_lease",
        ].join("\n"),
      ];
      const deployments = await Promise.all([
        runAsync(bashBin, deploymentArgs),
        runAsync(bashBin, deploymentArgs),
      ]);
      for (const deployment of deployments) {
        expect(deployment.status, deployment.stderr).toBe(0);
      }
      expect(
        deployments
          .map(({ stdout }) => stdout)
          .join("\n")
          .match(/Migrations complete \(1 newly applied\)/g),
      ).toHaveLength(1);
      expect(
        deployments
          .map(({ stdout }) => stdout)
          .join("\n")
          .match(/Migrations complete \(0 newly applied\)/g),
      ).toHaveLength(1);
      expect(
        readFileSync(generationCalls, "utf8").trim().split(/\r?\n/),
      ).toHaveLength(2);

      const state = psql(
        database,
        `
          select
            to_regclass('public.atomic_deploy_contract_probe') is not null,
            to_regclass('public.deploy_migrations') is null,
            (
              select count(*) = 2
              from deploy_internal.schema_migrations
            ),
            (
              select count(*) = 1
              from supabase_migrations.schema_migrations
              where version = '20260731115959'
            ),
            to_regclass(
              'public.deploy_schema_probe_${targetSha}'
            ) is not null,
            (
              select c.relrowsecurity and c.relforcerowsecurity
              from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'deploy_internal'
                and c.relname = 'schema_migrations'
            ),
            not has_schema_privilege('anon', 'deploy_internal', 'USAGE'),
            not has_table_privilege(
              'anon',
              'deploy_internal.schema_migrations',
              'SELECT,INSERT,UPDATE,DELETE'
            );
        `,
      );
      expect(state.status, state.stderr).toBe(0);
      expect(state.stdout.trim()).toBe("t|t|t|t|t|t|t|t");

      const forged = psql(
        database,
        `
          set role anon;
          insert into deploy_internal.schema_migrations(filename, version)
          values ('forged.sql', 'forged');
        `,
      );
      expect(forged.status).not.toBe(0);
      expect(forged.stderr).toMatch(/permission denied|row-level security/i);

      writeFileSync(
        migration,
        [
          "-- deploy: expand",
          "create table public.atomic_deploy_contract_probe (",
          "  id bigint primary key,",
          "  drifted text",
          ");",
          "",
        ].join("\n"),
      );
      const driftRejected = run(bashBin, [
        "-c",
        [
          "set -Eeuo pipefail",
          `export DB_CONTAINER=${shellQuote(container)}`,
          `export DB_NAME=${shellQuote(database)}`,
          "export POSTGREST_READY_URL=http://127.0.0.1:1/ready",
          "export POSTGREST_METRICS_URL=http://127.0.0.1:1/metrics",
          "export POSTGREST_SCHEMA_CACHE_URL=http://127.0.0.1:1/schema_cache",
          `source ${shellQuote(shellPath(deployScript))}`,
          `release_dir=${shellQuote(shellPath(repoRoot))}`,
          `migration_manifest=${shellQuote(shellPath(manifest))}`,
          "preflight_migration_ledgers",
        ].join("\n"),
      ]);
      expect(driftRejected.status).not.toBe(0);
      expect(driftRejected.stderr).toMatch(/content hash drifted/i);

      expect(
        psql(
          database,
          "create table public.deploy_migrations(filename text primary key, version text unique);",
        ).status,
      ).toBe(0);
      const legacyRejected = run(bashBin, [
        "-c",
        [
          "set -Eeuo pipefail",
          `export DB_CONTAINER=${shellQuote(container)}`,
          `export DB_NAME=${shellQuote(database)}`,
          `source ${shellQuote(shellPath(deployScript))}`,
          `release_dir=${shellQuote(shellPath(repoRoot))}`,
          `migration_manifest=${shellQuote(shellPath(manifest))}`,
          "preflight_migration_ledgers",
        ].join("\n"),
      ]);
      expect(legacyRejected.status).not.toBe(0);
      expect(legacyRejected.stderr).toMatch(/legacy public deploy ledger/i);
    } finally {
      if (created) {
        expect(database).toMatch(/^codex_atomic_[0-9_]+$/);
        docker([
          "exec",
          container,
          "dropdb",
          "-U",
          "postgres",
          "--force",
          database,
        ]);
      }
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 45_000);

  it("commits telemetry backfill batches separately and resumes after interruption", () => {
    const suffix = `${process.pid}_${Date.now()}`;
    const database = `codex_telemetry_backfill_${suffix}`;
    let created = false;

    expect(database).toMatch(/^codex_telemetry_backfill_[0-9_]+$/);
    try {
      const create = docker([
        "exec",
        container,
        "createdb",
        "-U",
        "postgres",
        "--template=template0",
        database,
      ]);
      expect(create.status, create.stderr).toBe(0);
      created = true;

      const initialized = psql(
        database,
        `
          create schema supabase_migrations authorization postgres;
          create table supabase_migrations.schema_migrations (
            version text primary key,
            statements text[],
            name text
          );
          insert into supabase_migrations.schema_migrations(version, name)
          values ('20260803120500', 'ai_turn_stage_telemetry_backfill');
          create table public.ai_chat_turns (
            id uuid primary key,
            created_at timestamptz not null,
            updated_at timestamptz not null,
            accepted_at timestamptz,
            session_action text
          );
          alter table public.ai_chat_turns
            add constraint ai_chat_turns_session_action_check check (
              session_action is null
              or session_action in ('resumed', 'rebuilt')
            ) not valid;
          create function public.touch_updated_at()
          returns trigger language plpgsql as $$
          begin
            new.updated_at := statement_timestamp();
            return new;
          end
          $$;
          create function public.preserve_telemetry_updated_at()
          returns trigger language plpgsql as $$
          begin
            new.updated_at := old.updated_at;
            return new;
          end
          $$;
          create trigger ai_chat_turns_touch_updated_at
          before update on public.ai_chat_turns
          for each row execute function public.touch_updated_at();
          create trigger zz_ai_chat_turns_preserve_updated_at_for_telemetry
          before update of accepted_at on public.ai_chat_turns
          for each row execute function public.preserve_telemetry_updated_at();
          insert into public.ai_chat_turns (
            id, created_at, updated_at, accepted_at
          )
          select
            (
              '00000000-0000-4000-8000-'
              || lpad(value::text, 12, '0')
            )::uuid,
            '2026-01-01T00:00:00Z'::timestamptz
              + value * interval '1 second',
            '2025-01-01T00:00:00Z'::timestamptz,
            null
          from generate_series(1, 1201) value;
        `,
      );
      expect(initialized.status, initialized.stderr).toBe(0);

      const interrupted = run(bashBin, [
        "-c",
        [
          "set -Eeuo pipefail",
          `export DB_CONTAINER=${shellQuote(container)}`,
          `export DB_NAME=${shellQuote(database)}`,
          `source ${shellQuote(shellPath(deployScript))}`,
          "emit_internal_ledger_security_sql | db -Atq",
          "DB_LEASE_ACTIVE=1",
          "lease_checks=0",
          "assert_database_deploy_lease() {",
          "  lease_checks=$((lease_checks + 1))",
          "  (( lease_checks < 2 ))",
          "}",
          "run_ai_turn_stage_telemetry_backfill",
        ].join("\n"),
      ]);
      expect(interrupted.status).not.toBe(0);
      expect(interrupted.stderr).toMatch(/database deploy lease/i);

      const partial = psql(
        database,
        `
          select
            count(*) filter (where accepted_at is not null),
            count(*) filter (where accepted_at is null),
            not (
              select convalidated
              from pg_constraint
              where conrelid = 'public.ai_chat_turns'::regclass
                and conname = 'ai_chat_turns_session_action_check'
            ),
            (
              select cursor_uuid is not null and completed_at is null
              from deploy_internal.backfill_progress
              where task_name = 'ai_turn_stage_telemetry_accepted_at_v1'
                and migration_version = '20260803120500'
            ),
            bool_and(updated_at = '2025-01-01T00:00:00Z'::timestamptz)
          from public.ai_chat_turns;
        `,
      );
      expect(partial.status, partial.stderr).toBe(0);
      expect(partial.stdout.trim()).toBe("500|701|t|t|t");

      const resume = run(bashBin, [
        "-c",
        [
          "set -Eeuo pipefail",
          `export DB_CONTAINER=${shellQuote(container)}`,
          `export DB_NAME=${shellQuote(database)}`,
          `source ${shellQuote(shellPath(deployScript))}`,
          "DB_LEASE_ACTIVE=1",
          "assert_database_deploy_lease() { :; }",
          "run_ai_turn_stage_telemetry_backfill",
        ].join("\n"),
      ]);
      expect(resume.status, resume.stderr).toBe(0);

      const complete = psql(
        database,
        `
          with versions as (
            select xmin::text, count(*) as batch_size
            from public.ai_chat_turns
            group by xmin::text
          )
          select
            (select count(*) from public.ai_chat_turns where accepted_at is null),
            (
              select convalidated
              from pg_constraint
              where conrelid = 'public.ai_chat_turns'::regclass
                and conname = 'ai_chat_turns_session_action_check'
            ),
            (select count(*) from versions),
            (select max(batch_size) from versions),
            (
              select completed_at is not null
              from deploy_internal.backfill_progress
              where task_name = 'ai_turn_stage_telemetry_accepted_at_v1'
                and migration_version = '20260803120500'
            ),
            (
              select bool_and(accepted_at = created_at)
                and bool_and(updated_at = '2025-01-01T00:00:00Z'::timestamptz)
              from public.ai_chat_turns
            );
        `,
      );
      expect(complete.status, complete.stderr).toBe(0);
      expect(complete.stdout.trim()).toBe("0|t|3|500|t|t");

      const beforeRepeat = psql(
        database,
        `select md5(string_agg(id::text || ':' || xmin::text, ',' order by id))
         from public.ai_chat_turns;`,
      );
      expect(beforeRepeat.status, beforeRepeat.stderr).toBe(0);
      const repeat = run(bashBin, [
        "-c",
        [
          "set -Eeuo pipefail",
          `export DB_CONTAINER=${shellQuote(container)}`,
          `export DB_NAME=${shellQuote(database)}`,
          `source ${shellQuote(shellPath(deployScript))}`,
          "DB_LEASE_ACTIVE=1",
          "assert_database_deploy_lease() { :; }",
          "run_ai_turn_stage_telemetry_backfill",
        ].join("\n"),
      ]);
      expect(repeat.status, repeat.stderr).toBe(0);
      const afterRepeat = psql(
        database,
        `select md5(string_agg(id::text || ':' || xmin::text, ',' order by id))
         from public.ai_chat_turns;`,
      );
      expect(afterRepeat.status, afterRepeat.stderr).toBe(0);
      expect(afterRepeat.stdout.trim()).toBe(beforeRepeat.stdout.trim());
    } finally {
      if (created) {
        expect(database).toMatch(/^codex_telemetry_backfill_[0-9_]+$/);
        docker([
          "exec",
          container,
          "dropdb",
          "-U",
          "postgres",
          "--force",
          database,
        ]);
      }
    }
  }, 45_000);
});
