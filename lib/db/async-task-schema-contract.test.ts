import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260714100000_async_task_runtime_foundation.sql",
  ),
  "utf8",
).toLowerCase();
const normalizedMigration = normalizeSql(migration);
const uncommentedNormalizedMigration = normalizeSql(stripSqlComments(migration));

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/gu, " ").trim();
}

function stripSqlComments(sql: string): string {
  let uncommented = "";
  let index = 0;
  let inSingleQuotedString = false;

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (inSingleQuotedString) {
      uncommented += current;
      if (current === "'" && next === "'") {
        uncommented += next;
        index += 2;
        continue;
      }
      if (current === "'") {
        inSingleQuotedString = false;
      }
      index += 1;
      continue;
    }

    if (current === "'") {
      inSingleQuotedString = true;
      uncommented += current;
      index += 1;
      continue;
    }

    if (current === "-" && next === "-") {
      index += 2;
      while (index < sql.length && !["\n", "\r"].includes(sql[index] ?? "")) {
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      const commentEnd = sql.indexOf("*/", index + 2);
      index = commentEnd === -1 ? sql.length : commentEnd + 2;
      continue;
    }

    uncommented += current;
    index += 1;
  }

  return uncommented;
}

function extractBackgroundJobsKnownTypeConstraintBodies(sql: string): string[] {
  const constraintPattern =
    /alter table public\.background_jobs\s+add constraint background_jobs_known_type\s+check\s*\(/gu;
  const bodies: string[] = [];

  while (constraintPattern.exec(sql) !== null) {
    const bodyStart = constraintPattern.lastIndex;
    const bodyEnd = findMatchingClosingParenthesis(sql, bodyStart - 1);
    expect(
      bodyEnd,
      "missing closing parenthesis for background_jobs_known_type check",
    ).toBeGreaterThan(bodyStart);
    bodies.push(sql.slice(bodyStart, bodyEnd));
    constraintPattern.lastIndex = bodyEnd + 1;
  }

  return bodies;
}

function findMatchingClosingParenthesis(sql: string, openIndex: number): number {
  let depth = 0;

  for (let index = openIndex; index < sql.length; index += 1) {
    if (sql[index] === "(") {
      depth += 1;
    } else if (sql[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractFunction(functionName: string): string {
  const marker = `create or replace function public.${functionName}`;
  const start = migration.indexOf(marker);
  expect(start, `missing function ${functionName}`).toBeGreaterThanOrEqual(0);
  const bodyMarker = /\bas\s+\$\$/gu;
  bodyMarker.lastIndex = start;
  const bodyStartMatch = bodyMarker.exec(migration);
  expect(bodyStartMatch, `missing function body ${functionName}`).not.toBeNull();
  const bodyStart = bodyStartMatch?.index ?? -1;
  const bodyContentStart = bodyStart + (bodyStartMatch?.[0].length ?? 0);
  const bodyEnd = migration.indexOf("$$;", bodyContentStart);
  expect(bodyEnd, `missing function terminator ${functionName}`).toBeGreaterThan(
    bodyContentStart,
  );
  return normalizeSql(migration.slice(bodyContentStart, bodyEnd));
}

function extractCreateTable(tableName: string): string {
  const marker = `create table if not exists public.${tableName}`;
  const start = migration.indexOf(marker);
  expect(start, `missing table ${tableName}`).toBeGreaterThanOrEqual(0);
  const openIndex = migration.indexOf("(", start);
  expect(openIndex, `missing table body ${tableName}`).toBeGreaterThan(start);
  const closeIndex = findMatchingClosingParenthesis(migration, openIndex);
  expect(closeIndex, `missing table terminator ${tableName}`).toBeGreaterThan(
    openIndex,
  );

  return normalizeSql(migration.slice(start, closeIndex + 1));
}

function extractDoBlockContaining(searchText: string): string {
  const target = searchText.toLowerCase();
  const targetIndex = migration.indexOf(target);
  expect(targetIndex, `missing guarded block target ${searchText}`).toBeGreaterThanOrEqual(
    0,
  );
  const start = migration.lastIndexOf("do $$", targetIndex);
  expect(start, `missing do block for ${searchText}`).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("end $$;", targetIndex);
  expect(end, `missing do block terminator for ${searchText}`).toBeGreaterThan(
    targetIndex,
  );
  return normalizeSql(migration.slice(start, end + "end $$;".length));
}

describe("async task runtime schema contract", () => {
  it("requires background_jobs_known_type values to come from uncommented constraint SQL", () => {
    const sampleSql = normalizeSql(stripSqlComments(`
      do $$
      begin
        -- add constraint background_jobs_known_type check (job_type in ('settlement.simulate_large_sample'))
        /*
          alter table public.background_jobs
            add constraint background_jobs_known_type check (
              job_type in ('comment.only')
            );
        */
        alter table public.background_jobs
          add constraint background_jobs_known_type check (
            job_type in ('ocr.extract_live_report', 'ai.replay', 'insight.scan')
          );
      end $$;
    `));

    const constraintBodies =
      extractBackgroundJobsKnownTypeConstraintBodies(sampleSql);

    expect(constraintBodies).toHaveLength(1);
    expect(constraintBodies[0]).toContain(
      "job_type in ('ocr.extract_live_report', 'ai.replay', 'insight.scan')",
    );
    expect(constraintBodies[0]).not.toContain("settlement.simulate_large_sample");
    expect(constraintBodies[0]).not.toContain("comment.only");
  });

  it("adds equivalent runtime metadata to OCR, recording AI, and settlement simulation tasks", () => {
    const backgroundJobsAlter = /alter table public\.background_jobs[\s\S]*?;/u;
    const recordingAiAlter =
      /alter table public\.recording_ai_analyses[\s\S]*?;/u;

    expect(migration).toMatch(backgroundJobsAlter);
    expect(migration).toMatch(recordingAiAlter);
    expect(migration).toContain("'settlement_simulation'");
    expect(normalizedMigration).not.toContain(
      "drop constraint if exists background_jobs_known_type",
    );

    const backgroundJobTypeConstraint = extractDoBlockContaining(
      "background_jobs_known_type",
    );
    expect(backgroundJobTypeConstraint).toContain("pg_constraint");
    expect(backgroundJobTypeConstraint).toContain("pg_get_constraintdef");
    expect(backgroundJobTypeConstraint).toContain(
      "conname = 'background_jobs_known_type'",
    );
    expect(backgroundJobTypeConstraint).toContain(
      "drop constraint background_jobs_known_type",
    );
    expect(backgroundJobTypeConstraint).toContain(
      "add constraint background_jobs_known_type",
    );
    const expectedBackgroundJobTypes = [
      "ocr.extract_live_report",
      "ai.replay",
      "insight.scan",
      "settlement.simulate_large_sample",
    ];
    const backgroundJobTypeConstraintBodies =
      extractBackgroundJobsKnownTypeConstraintBodies(
        uncommentedNormalizedMigration,
      );
    expect(backgroundJobTypeConstraintBodies.length).toBeGreaterThan(0);
    const backgroundJobTypeBodyWithExpectedValues =
      backgroundJobTypeConstraintBodies.find(
        (body) =>
          /job_type\s+in\s*\(/u.test(body) &&
          expectedBackgroundJobTypes.every((jobType) =>
            body.includes(`'${jobType}'`),
          ),
      );
    expect(
      backgroundJobTypeBodyWithExpectedValues,
      "background_jobs_known_type must include every expected job_type in a real uncommented check body",
    ).toBeDefined();

    for (const column of [
      "stage",
      "priority",
      "run_after",
      "lease_expires_at",
      "started_at",
      "idempotency_key",
      "error_code",
      "cancel_requested_at",
      "desired_state",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `alter table public\\.background_jobs[\\s\\S]*add column if not exists ${column}`,
          "u",
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `alter table public\\.recording_ai_analyses[\\s\\S]*add column if not exists ${column}`,
          "u",
        ),
      );
    }
  });

  it("creates runtime ledgers, worker state, schedule keys, controls, and service functions", () => {
    for (const table of [
      "async_task_events",
      "worker_instances",
      "scheduled_job_runs",
      "scheduled_job_run_items",
      "maintenance_execution_leases",
      "async_task_queue_controls",
      "provider_circuit_breakers",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
    }

    expect(migration).toContain("unique (job_key, scheduled_for)");
    expect(migration).toContain("scheduled_job_runs_incomplete_idx");
    expect(migration).toContain("primary key(run_id, organization_id)");
    expect(normalizedMigration).toContain("last_heartbeat_at timestamptz");
    expect(normalizedMigration).not.toMatch(/(^|[^a-z0-9_])heartbeat_at timestamptz/u);
    expect(normalizedMigration).toContain("lease_key text primary key");
    expect(normalizedMigration).toContain("lease_key = 'global'");

    const taskEvents = extractCreateTable("async_task_events");
    expect(taskEvents).toContain(
      "organization_id uuid not null references public.organizations(id) on delete cascade",
    );
    expect(taskEvents).not.toContain("on delete set null");

    const queueControls = extractCreateTable("async_task_queue_controls");
    expect(queueControls).toContain("task_type text not null");
    expect(queueControls).toContain(
      "task_type in ('ocr', 'recording_ai', 'settlement_simulation')",
    );

    const circuitBreakers = extractCreateTable("provider_circuit_breakers");
    for (const column of [
      "provider_key text primary key",
      "state text not null default 'closed'",
      "consecutive_failures integer not null default 0",
      "opened_until timestamptz",
      "probe_worker_id text",
      "probe_lease_expires_at timestamptz",
      "last_error_code text",
      "updated_at timestamptz not null default now()",
    ]) {
      expect(circuitBreakers).toContain(column);
    }
    expect(circuitBreakers).toContain("state in ('closed', 'open', 'half_open')");
    expect(circuitBreakers).toContain("consecutive_failures >= 0");
    for (const legacyColumn of [
      "status text",
      "opened_at timestamptz",
      "half_open_after timestamptz",
      "failure_count integer",
      "metadata jsonb",
    ]) {
      expect(circuitBreakers).not.toContain(legacyColumn);
    }

    const functionNames = [
      "ensure_scheduled_job_run",
      "claim_scheduled_job_run",
      "find_oldest_incomplete_scheduled_job_run",
      "claim_scheduled_job_run_items",
      "renew_scheduled_job_run_lease",
      "renew_scheduled_job_run_item_lease",
      "complete_scheduled_job_run_item",
      "finalize_scheduled_job_run",
      "finalize_scheduled_job_run_reconciled",
      "reconcile_expired_scheduled_job_work",
      "acquire_maintenance_execution_lease",
      "renew_maintenance_execution_lease",
      "release_maintenance_execution_lease",
    ];

    for (const functionName of functionNames) {
      expect(migration).toContain(
        `create or replace function public.${functionName}`,
      );
      expect(normalizedMigration).toContain(
        `revoke all on function public.${functionName}`,
      );
    }

    for (const functionName of functionNames.filter(
      (name) => name !== "finalize_scheduled_job_run_reconciled",
    )) {
      expect(normalizedMigration).toContain(
        `grant execute on function public.${functionName}`,
      );
      expect(normalizedMigration).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}[\\s\\S]* to service_role`,
          "u",
        ),
      );
    }
  });

  it("keeps runtime tables service-role write only with append-only task events", () => {
    expect(normalizedMigration).toContain(
      "grant select, insert on public.async_task_events to service_role",
    );
    expect(normalizedMigration).not.toContain(
      "grant select, insert, update on public.async_task_events",
    );
    expect(normalizedMigration).toContain(
      "grant usage, select on sequence public.async_task_events_id_seq to service_role",
    );

    for (const table of [
      "worker_instances",
      "scheduled_job_runs",
      "scheduled_job_run_items",
    ]) {
      expect(normalizedMigration).toContain(
        `revoke all on public.${table} from public, anon, authenticated`,
      );
      expect(normalizedMigration).toContain(
        `grant select, insert, update on public.${table} to service_role`,
      );
    }
  });

  it("limits queue controls to organization-scoped staff and manager access", () => {
    expect(normalizedMigration).toContain(
      "grant select, insert, update on public.async_task_queue_controls to authenticated",
    );
    expect(normalizedMigration).toContain(
      "public.is_org_member(organization_id) and public.is_mcn_staff(organization_id)",
    );
    expect(normalizedMigration).toContain(
      "public.current_user_role(organization_id) in ('owner', 'ops_manager')",
    );
    expect(normalizedMigration).not.toContain("organization_id is null");
  });

  it("guards scheduling logic with stale leases, row locks, attempt bounds, and idempotent snapshots", () => {
    const ensureRun = extractFunction("ensure_scheduled_job_run");
    expect(ensureRun).toContain("on conflict (job_key, scheduled_for) do nothing");
    expect(ensureRun).toContain("insert into public.scheduled_job_run_items");
    expect(ensureRun).toContain("on conflict (run_id, organization_id) do nothing");
    expect(ensureRun).not.toContain("lease_expires_at");

    const claimRun = extractFunction("claim_scheduled_job_run");
    expect(claimRun).toContain("for update");
    expect(claimRun).toContain("maintenance_execution_leases");
    expect(claimRun).toContain("lease_key = 'global'");
    expect(claimRun).toContain("claimed_by = p_worker_id");
    expect(claimRun).toContain("lease_expires_at > p_now");
    expect(claimRun).toContain("lease_expires_at <= p_now");
    expect(claimRun).toContain("attempt = attempt + 1");
    expect(claimRun).not.toContain(
      "v_run.claimed_by = p_worker_id and v_run.lease_expires_at > p_now",
    );

    const claimItems = extractFunction("claim_scheduled_job_run_items");
    expect(claimItems).toContain("from public.scheduled_job_runs");
    expect(claimItems).toContain("run.status = 'running'");
    expect(claimItems).toContain("run.claimed_by = p_worker_id");
    expect(claimItems).toContain("run.lease_expires_at > p_now");
    expect(claimItems).toContain("for update skip locked");
    expect(claimItems).toContain("item.attempt < item.max_attempts");
    expect(claimItems).toContain("lease_expires_at <= p_now");
    expect(claimItems).toContain("limit p_limit");

    const renewRunLease = extractFunction("renew_scheduled_job_run_lease");
    expect(renewRunLease).toContain("status = 'running'");
    expect(renewRunLease).toContain("claimed_by = p_worker_id");
    expect(renewRunLease).toContain("lease_expires_at > p_now");
    expect(renewRunLease).toContain(
      "select coalesce((select renewed from renewed_run), false)",
    );

    const renewItemLease = extractFunction("renew_scheduled_job_run_item_lease");
    expect(renewItemLease).toContain("from public.scheduled_job_runs run");
    expect(renewItemLease).toContain("run.status = 'running'");
    expect(renewItemLease).toContain("run.claimed_by = p_worker_id");
    expect(renewItemLease).toContain("run.lease_expires_at > p_now");
    expect(renewItemLease).toContain("item.status = 'running'");
    expect(renewItemLease).toContain("item.claimed_by = p_worker_id");
    expect(renewItemLease).toContain("item.lease_expires_at > p_now");
    expect(renewItemLease).toContain(
      "select coalesce((select renewed from renewed_item), false)",
    );

    const completeItem = extractFunction("complete_scheduled_job_run_item");
    expect(completeItem).toContain("from public.scheduled_job_runs run");
    expect(completeItem).toContain("run.status = 'running'");
    expect(completeItem).toContain("run.claimed_by = p_worker_id");
    expect(completeItem).toContain("run.lease_expires_at > p_now");
    expect(completeItem).toContain("item.status = 'running'");
    expect(completeItem).toContain("item.claimed_by = p_worker_id");
    expect(completeItem).toContain("item.lease_expires_at > p_now");
    expect(completeItem).toContain("p_status in ('succeeded', 'failed', 'skipped')");
    expect(completeItem).toContain(
      "select coalesce((select completed from completed_item), false)",
    );

    const reconcile = extractFunction("reconcile_expired_scheduled_job_work");
    expect(normalizedMigration).toContain(
      "create or replace function public.reconcile_expired_scheduled_job_work( p_now timestamptz default now(), p_limit integer default 100 ) returns table ( failed_item_ids text[], finalized_run_ids uuid[] )",
    );
    expect(reconcile).toContain("failed_item_ids");
    expect(reconcile).toContain("finalized_run_ids");
    expect(reconcile).not.toContain("returns integer");
    expect(reconcile).toContain("attempt >= max_attempts");
    expect(reconcile).toContain("worker_lease_exhausted");
    expect(reconcile).toContain("affected_runs");
    expect(reconcile).toContain("status in ('queued', 'running')");
    expect(reconcile).toContain("public.finalize_scheduled_job_run_reconciled");
    expect(reconcile).not.toContain("scheduled_job_runs.attempt <");
    expect(normalizedMigration).not.toMatch(
      /grant execute on function public\.finalize_scheduled_job_run_reconciled\s*\([^)]*\)\s*to service_role/u,
    );

    const finalizeRun = extractFunction("finalize_scheduled_job_run");
    expect(normalizedMigration).toContain(
      "create or replace function public.finalize_scheduled_job_run( p_run_id uuid, p_worker_id text",
    );
    expect(finalizeRun).toContain("status = 'running'");
    expect(finalizeRun).toContain("claimed_by = p_worker_id");
    expect(finalizeRun).toContain("lease_expires_at > p_now");
    expect(finalizeRun).toContain("status not in ('succeeded', 'failed', 'skipped')");

    const acquireMaintenanceLease = extractFunction(
      "acquire_maintenance_execution_lease",
    );
    expect(normalizedMigration).toContain(
      "create or replace function public.acquire_maintenance_execution_lease( p_worker_id text",
    );
    expect(acquireMaintenanceLease).toContain("'global'");
    expect(acquireMaintenanceLease).not.toContain("p_lease_key");
    expect(acquireMaintenanceLease).toContain("return coalesce(v_acquired, false)");

    const renewMaintenanceLease = extractFunction(
      "renew_maintenance_execution_lease",
    );
    expect(renewMaintenanceLease).toContain("lease_key = 'global'");
    expect(renewMaintenanceLease).not.toContain("p_lease_key");
    expect(renewMaintenanceLease).toContain(
      "select coalesce((select renewed from renewed_lease), false)",
    );

    const releaseMaintenanceLease = extractFunction(
      "release_maintenance_execution_lease",
    );
    expect(releaseMaintenanceLease).toContain("lease_key = 'global'");
    expect(releaseMaintenanceLease).not.toContain("p_lease_key");
    expect(releaseMaintenanceLease).toContain(
      "select coalesce((select released from released_lease), false)",
    );
  });
});
