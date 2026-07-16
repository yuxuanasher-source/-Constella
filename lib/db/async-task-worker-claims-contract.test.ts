import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260714110000_async_task_worker_claims.sql",
  ),
  "utf8",
).toLowerCase();
const normalizedMigration = normalizeSql(migration);
const effectivePriorityExpression =
  "greatest(0, {{alias}}.priority - floor(extract(epoch from (p_now - {{alias}}.created_at)) / 1800)::integer) asc";

function normalizeSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/gu, " ").trim();
}

function extractFunction(functionName: string): string {
  const marker = `create or replace function public.${functionName}`;
  const start = migration.indexOf(marker);
  expect(start, `missing function ${functionName}`).toBeGreaterThanOrEqual(0);

  const bodyMarker = /\bas\s+\$\$/gu;
  bodyMarker.lastIndex = start;
  const bodyStartMatch = bodyMarker.exec(migration);
  expect(bodyStartMatch, `missing function body ${functionName}`).not.toBeNull();

  const bodyContentStart =
    (bodyStartMatch?.index ?? -1) + (bodyStartMatch?.[0].length ?? 0);
  const bodyEnd = migration.indexOf("$$;", bodyContentStart);
  expect(bodyEnd, `missing function terminator ${functionName}`).toBeGreaterThan(
    bodyContentStart,
  );

  return normalizeSql(migration.slice(bodyContentStart, bodyEnd));
}

function extractFunctionSignature(functionName: string): string {
  const marker = `create or replace function public.${functionName}`;
  const start = migration.indexOf(marker);
  expect(start, `missing function ${functionName}`).toBeGreaterThanOrEqual(0);
  const returnsIndex = migration.indexOf("returns", start);
  expect(returnsIndex, `missing returns ${functionName}`).toBeGreaterThan(start);
  return normalizeSql(migration.slice(start, returnsIndex));
}

function extractPreClaimCandidateSection(functionBody: string): string {
  const updateStart = functionBody.indexOf("update public.");
  expect(updateStart, "missing claim update").toBeGreaterThanOrEqual(0);
  return functionBody.slice(0, updateStart);
}

function expectLockBeforeActiveCount(functionBody: string): void {
  expect(functionBody).toMatch(/\bfor\s+[a-z_]+\s+in\s+with\s+ranked/u);
  expect(functionBody).not.toContain("with active_counts as");
  expect(functionBody).not.toContain("join active_counts");

  const advisoryLock = functionBody.indexOf("pg_try_advisory_xact_lock");
  expect(advisoryLock, "missing advisory lock").toBeGreaterThanOrEqual(0);

  const postLockBody = functionBody.slice(advisoryLock);
  const activeCount = postLockBody.indexOf("select count(*)::integer");
  expect(activeCount, "missing post-lock active count").toBeGreaterThanOrEqual(
    0,
  );

  const updateAfterActiveCount = postLockBody.indexOf(
    "update public.",
    activeCount,
  );
  expect(
    updateAfterActiveCount,
    "claim update must happen after post-lock active count",
  ).toBeGreaterThan(activeCount);
  expect(postLockBody).toContain("claimable_rank");
  expect(postLockBody).toContain("ranked.claimable_rank <= v_remaining");
  expect(postLockBody).toContain("limit 1 for update skip locked");
  expect(postLockBody).not.toContain(
    "ranked.claimable_rank = v_candidate.org_rank",
  );
  expect(postLockBody).not.toContain(
    "ranked.claimable_rank <= least(v_remaining, p_limit - v_claimed_count)",
  );
  expect(postLockBody).not.toContain("ranked.org_rank = v_candidate.org_rank");
}

function expectEffectivePriorityOrdering(
  functionBody: string,
  tableAlias: string,
): void {
  const effectivePriority = effectivePriorityExpression.replaceAll(
    "{{alias}}",
    tableAlias,
  );
  expect(functionBody).toContain(effectivePriority);
  expect(functionBody).toContain("effective_priority");
  expect(functionBody).toContain("effective_priority asc");
  expect(functionBody).not.toContain("priority desc");
}

function expectOverscannedCandidateLoop(functionBody: string): void {
  const preClaimCandidateSection = extractPreClaimCandidateSection(functionBody);
  expect(preClaimCandidateSection).not.toContain("limit p_limit");
  expect(preClaimCandidateSection).toContain(
    "limit least(greatest(p_limit * p_per_org_limit, 25), 1000)",
  );
}

function expectClaimableRankingSeparateFromActiveRows(
  functionBody: string,
): void {
  const advisoryLock = functionBody.indexOf("pg_try_advisory_xact_lock");
  expect(advisoryLock, "missing advisory lock").toBeGreaterThanOrEqual(0);
  const postLockBody = functionBody.slice(advisoryLock);
  const claimableRank = postLockBody.indexOf("claimable_rank");
  expect(claimableRank, "missing post-lock claimable ranking").toBeGreaterThan(
    0,
  );
  const postClaimableRank = postLockBody.slice(claimableRank);
  expect(postClaimableRank).not.toContain("is_claimable");
  expect(postClaimableRank).toContain("status = 'queued' or (");
  expect(postClaimableRank).toContain("lease_expires_at <= p_now");
  expect(postClaimableRank).not.toContain("or bj.status = 'running'");
  expect(postClaimableRank).not.toContain("or analysis.status = 'running'");
}

function expectTerminalIdempotencyRequiresEventOwnership(
  functionBody: string,
): void {
  const terminalStatusCheck =
    "v_existing_status in ('succeeded', 'failed', 'cancelled', 'needs_confirmation')";
  const firstTerminalCheck = functionBody.indexOf(terminalStatusCheck);
  expect(firstTerminalCheck, "missing terminal status check").toBeGreaterThanOrEqual(
    0,
  );
  expect(functionBody).not.toContain("return v_existing_status = p_status");
  expect(functionBody).toContain("v_event public.async_task_events%rowtype");
  expect(functionBody).toContain("select event.* into v_event from public.async_task_events event");
  expect(functionBody).toContain("event.task_type = p_task_type");
  expect(functionBody).toContain("event.task_id = p_task_id");
  expect(functionBody).toContain("event.status = p_status");
  expect(functionBody).toContain("event.attempt = v_attempt");
  expect(functionBody).toContain("event.worker_id = p_worker_id");
  expect(functionBody).toContain("return v_event");
  expect(functionBody).toContain("returning * into v_event");
}

function expectServiceRoleOnlyExecute(
  functionName: string,
  argsSignature: string,
): void {
  expect(normalizedMigration).toContain(
    `revoke all on function public.${functionName}(${argsSignature}) from public, anon, authenticated`,
  );
  expect(normalizedMigration).toContain(
    `grant execute on function public.${functionName}(${argsSignature}) to service_role`,
  );
  expect(normalizedMigration).not.toMatch(
    new RegExp(
      `grant execute on function public\\.${functionName}\\(${escapeRegExp(
        argsSignature,
      )}\\) to (public|anon|authenticated)`,
      "u",
    ),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

describe("async task worker claim RPC contract", () => {
  it("creates service-role-only fair claim RPCs without organization pinning", () => {
    const claimContracts = [
      {
        functionName: "claim_async_ocr_jobs",
        taskType: "ocr",
        jobType: "ocr.extract_live_report",
        stage: "resolving_image",
        returns: "returns setof public.background_jobs",
        lockColumns: ["locked_at = p_now", "locked_by = p_worker_id"],
        defaultLimit: "p_limit integer default 3",
        tableAlias: "bj",
      },
      {
        functionName: "claim_async_recording_ai",
        taskType: "recording_ai",
        stage: "extracting_audio",
        returns: "returns setof public.recording_ai_analyses",
        lockColumns: ["claimed_at = p_now", "claimed_by = p_worker_id"],
        defaultLimit: "p_limit integer default 1",
        tableAlias: "analysis",
      },
      {
        functionName: "claim_async_settlement_simulations",
        taskType: "settlement_simulation",
        jobType: "settlement.simulate_large_sample",
        stage: "validating_snapshot",
        returns: "returns setof public.background_jobs",
        lockColumns: ["locked_at = p_now", "locked_by = p_worker_id"],
        defaultLimit: "p_limit integer default 1",
        tableAlias: "bj",
      },
    ] as const;

    for (const contract of claimContracts) {
      expect(normalizedMigration).toContain(
        `create or replace function public.${contract.functionName}(`,
      );
      expect(normalizedMigration).toContain(contract.returns);

      const signature = extractFunctionSignature(contract.functionName);
      expect(signature).toContain("p_worker_id text");
      expect(signature).toContain(contract.defaultLimit);
      expect(signature).toContain("p_lease_seconds integer default");
      expect(signature).toContain("p_per_org_limit integer default");
      expect(signature).toContain("p_now timestamptz default now()");
      expect(signature).not.toContain("p_organization_id");

      const body = extractFunction(contract.functionName);
      expect(body).toContain("if p_limit is null or p_limit < 1 or p_limit >");
      expect(body).toContain(
        "if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds >",
      );
      expect(body).toContain(
        "if p_per_org_limit is null or p_per_org_limit < 1 or p_per_org_limit >",
      );
      expect(body).toMatch(/row_number\(\) over \(\s*partition by/u);
      expect(body).toContain("for update skip locked");
      expect(body).toContain("pg_try_advisory_xact_lock");
      expect(body).toContain("lease_expires_at > p_now");
      expect(body).toContain("lease_expires_at = p_now + make_interval");
      expect(body).toContain("attempt =");
      expect(body).toMatch(/attempt < [a-z_]+\.max_attempts/u);
      expect(body).toContain("active_count");
      expect(body).toContain("p_per_org_limit");
      expect(body).toMatch(/desired_state[^']*'running'\) <> 'paused'/u);
      expect(body).toContain(`task_type = '${contract.taskType}'`);
      expect(body).toContain(`stage = '${contract.stage}'`);
      if (contract.taskType === "recording_ai") {
        expect(body).not.toContain("cancel_requested_at is null");
      } else {
        expect(body).toContain("cancel_requested_at is null");
      }
      expect(body).toContain("ranked.org_rank asc");
      expect(body).toContain("run_after asc");
      expectLockBeforeActiveCount(body);
      expectEffectivePriorityOrdering(body, contract.tableAlias);
      expectOverscannedCandidateLoop(body);
      expectClaimableRankingSeparateFromActiveRows(body);

      const preClaimCandidateSection = extractPreClaimCandidateSection(body);
      expect(preClaimCandidateSection).toContain(
        `${contract.tableAlias}.status = 'queued'`,
      );
      expect(preClaimCandidateSection).toContain(
        `${contract.tableAlias}.status = 'running'`,
      );
      expect(preClaimCandidateSection).toContain(
        `${contract.tableAlias}.lease_expires_at is null`,
      );
      expect(preClaimCandidateSection).toContain(
        `${contract.tableAlias}.lease_expires_at <= p_now`,
      );
      expect(preClaimCandidateSection).not.toContain(
        `where bj.stage = '${contract.stage}'`,
      );
      expect(preClaimCandidateSection).not.toContain(
        `and bj.stage = '${contract.stage}'`,
      );
      expect(preClaimCandidateSection).not.toContain(
        `where analysis.stage = '${contract.stage}'`,
      );
      expect(preClaimCandidateSection).not.toContain(
        `and analysis.stage = '${contract.stage}'`,
      );

      if ("jobType" in contract) {
        expect(body).toContain(`job_type = '${contract.jobType}'`);
      }
      for (const lockColumn of contract.lockColumns) {
        expect(body).toContain(lockColumn);
      }
    }

    expectServiceRoleOnlyExecute(
      "claim_async_ocr_jobs",
      "text, integer, integer, integer, timestamptz",
    );
    expectServiceRoleOnlyExecute(
      "claim_async_recording_ai",
      "text, integer, integer, integer, timestamptz",
    );
    expectServiceRoleOnlyExecute(
      "claim_async_settlement_simulations",
      "text, integer, integer, integer, timestamptz",
    );
  });

  it("adds a service-role lease renewal RPC for active worker-owned tasks", () => {
    expect(normalizedMigration).toContain(
      "create or replace function public.renew_async_task_lease(",
    );
    expect(normalizedMigration).toContain("returns boolean");

    const body = extractFunction("renew_async_task_lease");
    expect(body).toMatch(
      /p_task_type (not )?in \('ocr', 'recording_ai', 'settlement_simulation'\)/u,
    );
    expect(body).toContain("p_lease_seconds is null or p_lease_seconds < 1");
    expect(body).toContain("status = 'running'");
    expect(body).toContain("lease_expires_at > p_now");
    expect(body).toContain("lease_expires_at = p_now + make_interval");
    expect(body).toContain("locked_by = p_worker_id");
    expect(body).toContain("claimed_by = p_worker_id");
    expect(body).toContain("select coalesce(");

    expectServiceRoleOnlyExecute(
      "renew_async_task_lease",
      "text, uuid, text, integer, timestamptz",
    );
  });

  it("finalizes terminal task state and writes terminal events atomically", () => {
    expect(normalizedMigration).toContain(
      "create or replace function public.finalize_async_task(",
    );
    expect(normalizedMigration).toContain("returns public.async_task_events");

    const body = extractFunction("finalize_async_task");
    expect(body).toMatch(
      /p_status (not )?in \('succeeded', 'failed', 'cancelled', 'needs_confirmation'\)/u,
    );
    expect(body).toContain("for update");
    expect(body).toContain("status = p_status");
    expect(body).toContain("completed_at = p_now");
    expect(body).toContain("lease_expires_at = null");
    expect(body).toContain("locked_by = p_worker_id");
    expect(body).toContain("result = case when p_metadata ? 'result'");
    expect(body).toContain("claimed_by = p_worker_id");
    expect(body).toContain("p_metadata ? 'recordingresult'");
    expect(body).toContain("provider_name = case");
    expect(body).toContain("insert into public.recording_ai_segments");
    expect(body).toContain("jsonb_to_recordset");
    expect(body).toContain("lease_expires_at > p_now");
    expect(body).toContain("status in ('succeeded', 'failed', 'cancelled', 'needs_confirmation')");
    expect(body).toContain("return v_event");
    expect(body).toContain("return null");
    expectTerminalIdempotencyRequiresEventOwnership(body);
    expect(body).toContain("insert into public.async_task_events");
    expect(body).toContain("organization_id");
    expect(body).toContain("task_type");
    expect(body).toContain("task_id");
    expect(body).toContain("status");
    expect(body).toContain("worker_id");
    expect(body).toContain("error_code");
    expect(body).toContain("metadata");
    expect(body).toContain("returning * into v_event");

    const firstUpdate = body.indexOf("update public.");
    const recordingUpdate = body.indexOf("update public.recording_ai_analyses");
    const segmentInsert = body.indexOf("insert into public.recording_ai_segments");
    const eventInsert = body.indexOf("insert into public.async_task_events");
    const eventInsertSection = body.slice(eventInsert);
    expect(firstUpdate).toBeGreaterThanOrEqual(0);
    expect(recordingUpdate).toBeGreaterThanOrEqual(0);
    expect(segmentInsert).toBeGreaterThan(recordingUpdate);
    expect(eventInsert).toBeGreaterThan(segmentInsert);
    expect(eventInsert).toBeGreaterThan(firstUpdate);
    expect(eventInsertSection).not.toContain("on conflict do nothing");

    expectServiceRoleOnlyExecute(
      "finalize_async_task",
      "text, uuid, text, text, text, jsonb, timestamptz",
    );
  });

  it("reconciles only final-attempt expired running work and leaves retryable stale tasks claimable", () => {
    expect(normalizedMigration).toContain(
      "create or replace function public.reconcile_expired_async_tasks(",
    );
    expect(normalizedMigration).toContain("returns table");

    const signature = extractFunctionSignature("reconcile_expired_async_tasks");
    expect(signature).toContain("p_limit integer default 100");

    const body = extractFunction("reconcile_expired_async_tasks");
    expect(body).toContain("status = 'running'");
    expect(body).toContain("lease_expires_at <= p_now");
    expect(body).toMatch(/attempt >= [a-z_]+\.max_attempts/u);
    expect(body).toContain("for update skip locked");
    expect(body).toContain("job_type = 'ocr.extract_live_report'");
    expect(body).toContain("'ocr'::text as task_type");
    expect(body).toContain("'recording_ai'::text as task_type");
    expect(body).toContain("job_type = 'settlement.simulate_large_sample'");
    expect(body).toContain("'settlement_simulation'::text as task_type");
    expect(body).toContain("worker_lease_exhausted");
    expect(body).toContain("insert into public.async_task_events");
    expect(body).toContain("on conflict do nothing");
    expect(body).not.toContain("attempt < max_attempts");
    expect(body).not.toContain("set status = 'queued'");

    expectServiceRoleOnlyExecute(
      "reconcile_expired_async_tasks",
      "timestamptz, integer",
    );
  });
});
