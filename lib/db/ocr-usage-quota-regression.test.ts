import { spawn, spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const container = process.env.OCR_USAGE_DB_REGRESSION_CONTAINER;

describe.runIf(Boolean(container))("OCR usage quota PostgreSQL regression", () => {
  it("keeps quota counters read-only for authenticated clients", () => {
    const dbContainer = container ?? "";

    expect(
      runSqlText(
        dbContainer,
        `select
          has_table_privilege('authenticated', 'public.usage_monthly_counters', 'INSERT')::text || '|' ||
          has_table_privilege('authenticated', 'public.usage_monthly_counters', 'UPDATE')::text || '|' ||
          has_table_privilege('authenticated', 'public.usage_monthly_counters', 'DELETE')::text || '|' ||
          has_table_privilege('authenticated', 'public.usage_monthly_counters', 'SELECT')::text;`,
      ),
    ).toBe("false|false|false|true");
  });

  it("serializes allowance, leaves no rejected artifacts, and isolates organizations", async () => {
    const dbContainer = container ?? "";
    const ids = {
      user: "b1000000-0000-4000-8000-000000000001",
      plan: "b1000000-0000-4000-8000-000000000002",
      orgA: "b1000000-0000-4000-8000-000000000003",
      orgB: "b1000000-0000-4000-8000-000000000004",
      orgC: "b1000000-0000-4000-8000-000000000005",
      projectA: "b1000000-0000-4000-8000-000000000006",
      projectB: "b1000000-0000-4000-8000-000000000007",
      projectC: "b1000000-0000-4000-8000-000000000008",
      streamerA: "b1000000-0000-4000-8000-000000000009",
      streamerB: "b1000000-0000-4000-8000-000000000010",
      streamerC: "b1000000-0000-4000-8000-000000000011",
      taskA1: "b1000000-0000-4000-8000-000000000012",
      taskA2: "b1000000-0000-4000-8000-000000000013",
      taskB: "b1000000-0000-4000-8000-000000000014",
      taskC: "b1000000-0000-4000-8000-000000000015",
      reportA1: "b1000000-0000-4000-8000-000000000016",
      reportA2: "b1000000-0000-4000-8000-000000000017",
      reportB: "b1000000-0000-4000-8000-000000000018",
      reportC: "b1000000-0000-4000-8000-000000000019",
      jobA1: "b1000000-0000-4000-8000-000000000020",
      jobA2: "b1000000-0000-4000-8000-000000000021",
      jobB: "b1000000-0000-4000-8000-000000000022",
      jobC: "b1000000-0000-4000-8000-000000000023",
      invocationA1: "b1000000-0000-4000-8000-000000000024",
      invocationA2: "b1000000-0000-4000-8000-000000000025",
      invocationB: "b1000000-0000-4000-8000-000000000026",
      invocationC: "b1000000-0000-4000-8000-000000000027",
    } as const;
    const cleanupSql = `
      delete from public.organizations
      where id in ('${ids.orgA}', '${ids.orgB}', '${ids.orgC}');
      delete from public.billing_plans where id = '${ids.plan}'::uuid;
      delete from public.profiles where id = '${ids.user}'::uuid;
      delete from auth.users where id = '${ids.user}'::uuid;
    `;
    const setupSql = `
      ${cleanupSql}
      insert into auth.users (id, email)
      values ('${ids.user}'::uuid, 'ocr-quota-regression@example.invalid');
      insert into public.profiles (id, email, full_name)
      values (
        '${ids.user}'::uuid,
        'ocr-quota-regression@example.invalid',
        'OCR Quota Regression'
      );
      insert into public.billing_plans (
        id, code, tier, name, included_ocr
      ) values (
        '${ids.plan}'::uuid, 'ocr-quota-regression', 'pro',
        'OCR Quota Regression', 1
      );
      insert into public.organizations (id, name, code) values
        ('${ids.orgA}'::uuid, 'OCR Quota A', 'ocr-quota-a'),
        ('${ids.orgB}'::uuid, 'OCR Quota B', 'ocr-quota-b'),
        ('${ids.orgC}'::uuid, 'OCR Quota C', 'ocr-quota-c');
      insert into public.organization_subscriptions (
        organization_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end
      ) values
        ('${ids.orgA}'::uuid, '${ids.plan}'::uuid, 'active', 'monthly', '2026-07-01', '2026-07-31'),
        ('${ids.orgB}'::uuid, '${ids.plan}'::uuid, 'active', 'monthly', '2026-07-01', '2026-07-31')
      on conflict (organization_id) do update
      set plan_id = excluded.plan_id,
          status = excluded.status,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end;
      delete from public.organization_subscriptions
      where organization_id = '${ids.orgC}'::uuid;
      insert into public.organization_members (
        organization_id, user_id, role, status
      ) values
        ('${ids.orgA}'::uuid, '${ids.user}'::uuid, 'owner', 'active'),
        ('${ids.orgB}'::uuid, '${ids.user}'::uuid, 'owner', 'active'),
        ('${ids.orgC}'::uuid, '${ids.user}'::uuid, 'owner', 'active');
      insert into public.projects (
        id, organization_id, code, name, created_by
      ) values
        ('${ids.projectA}'::uuid, '${ids.orgA}'::uuid, 'ocr-a', 'OCR A', '${ids.user}'::uuid),
        ('${ids.projectB}'::uuid, '${ids.orgB}'::uuid, 'ocr-b', 'OCR B', '${ids.user}'::uuid),
        ('${ids.projectC}'::uuid, '${ids.orgC}'::uuid, 'ocr-c', 'OCR C', '${ids.user}'::uuid);
      insert into public.streamers (
        id, organization_id, user_id, display_name, created_by
      ) values
        ('${ids.streamerA}'::uuid, '${ids.orgA}'::uuid, '${ids.user}'::uuid, 'OCR A', '${ids.user}'::uuid),
        ('${ids.streamerB}'::uuid, '${ids.orgB}'::uuid, '${ids.user}'::uuid, 'OCR B', '${ids.user}'::uuid),
        ('${ids.streamerC}'::uuid, '${ids.orgC}'::uuid, '${ids.user}'::uuid, 'OCR C', '${ids.user}'::uuid);
      insert into public.live_tasks (
        id, organization_id, project_id, streamer_id, title, status, created_by
      ) values
        ('${ids.taskA1}'::uuid, '${ids.orgA}'::uuid, '${ids.projectA}'::uuid, '${ids.streamerA}'::uuid, 'OCR A1', 'pending_report', '${ids.user}'::uuid),
        ('${ids.taskA2}'::uuid, '${ids.orgA}'::uuid, '${ids.projectA}'::uuid, '${ids.streamerA}'::uuid, 'OCR A2', 'pending_report', '${ids.user}'::uuid),
        ('${ids.taskB}'::uuid, '${ids.orgB}'::uuid, '${ids.projectB}'::uuid, '${ids.streamerB}'::uuid, 'OCR B', 'pending_report', '${ids.user}'::uuid),
        ('${ids.taskC}'::uuid, '${ids.orgC}'::uuid, '${ids.projectC}'::uuid, '${ids.streamerC}'::uuid, 'OCR C', 'pending_report', '${ids.user}'::uuid);
      insert into public.live_reports (
        id, organization_id, live_task_id, project_id, streamer_id, status,
        created_by
      ) values
        ('${ids.reportA1}'::uuid, '${ids.orgA}'::uuid, '${ids.taskA1}'::uuid, '${ids.projectA}'::uuid, '${ids.streamerA}'::uuid, 'ocr_ing', '${ids.user}'::uuid),
        ('${ids.reportA2}'::uuid, '${ids.orgA}'::uuid, '${ids.taskA2}'::uuid, '${ids.projectA}'::uuid, '${ids.streamerA}'::uuid, 'ocr_ing', '${ids.user}'::uuid),
        ('${ids.reportB}'::uuid, '${ids.orgB}'::uuid, '${ids.taskB}'::uuid, '${ids.projectB}'::uuid, '${ids.streamerB}'::uuid, 'ocr_ing', '${ids.user}'::uuid),
        ('${ids.reportC}'::uuid, '${ids.orgC}'::uuid, '${ids.taskC}'::uuid, '${ids.projectC}'::uuid, '${ids.streamerC}'::uuid, 'ocr_ing', '${ids.user}'::uuid);
    `;

    runSql(dbContainer, setupSql);
    try {
      expect(
        runSqlText(
          dbContainer,
          `select subscription.status::text || '|' || plan.included_ocr::text || '|' ||
             subscription.current_period_start::text || '|' ||
             subscription.current_period_end::text
           from public.organization_subscriptions as subscription
           join public.billing_plans as plan on plan.id = subscription.plan_id
           where subscription.organization_id = '${ids.orgA}'::uuid;`,
        ),
      ).toBe("active|1|2026-07-01|2026-07-31");
      const attempts = await Promise.all([
        runSqlAsync(
          dbContainer,
          enqueueSql(ids.jobA1, ids.invocationA1, ids.orgA, ids.reportA1, ids.user),
        ),
        runSqlAsync(
          dbContainer,
          enqueueSql(ids.jobA2, ids.invocationA2, ids.orgA, ids.reportA2, ids.user),
        ),
      ]);
      const succeeded = attempts.filter((result) => result.code === 0);
      const rejected = attempts.filter((result) => result.code !== 0);

      expect(succeeded, JSON.stringify(attempts)).toHaveLength(1);
      expect(rejected, JSON.stringify(attempts)).toHaveLength(1);
      expect(rejected[0]?.stderr).toContain("P0001");
      expect(rejected[0]?.stderr).toContain("OCR_USAGE_LIMIT_REACHED");
      expect(
        runSqlText(
          dbContainer,
          `select
            (select used_quantity from public.usage_monthly_counters
             where organization_id = '${ids.orgA}'::uuid and metric = 'ocr'
               and period_month = '2026-07-01')::text || '|' ||
            (select count(*) from public.usage_reservations
             where organization_id = '${ids.orgA}'::uuid and status = 'reserved')::text || '|' ||
            (select count(*) from public.background_jobs
             where organization_id = '${ids.orgA}'::uuid)::text || '|' ||
            (select count(*) from public.ai_invocations
             where organization_id = '${ids.orgA}'::uuid)::text || '|' ||
            (select count(*) from public.ocr_results
             where organization_id = '${ids.orgA}'::uuid)::text;`,
        ),
      ).toBe("1|1|1|1|1");

      const succeededWithFirstJob = attempts[0]?.code === 0;
      runSql(
        dbContainer,
        succeededWithFirstJob
          ? enqueueSql(ids.jobA1, ids.invocationA1, ids.orgA, ids.reportA1, ids.user)
          : enqueueSql(ids.jobA2, ids.invocationA2, ids.orgA, ids.reportA2, ids.user),
      );
      expect(
        runSqlText(
          dbContainer,
          `select used_quantity::text || '|' ||
             (select count(*) from public.usage_reservations
              where organization_id = '${ids.orgA}'::uuid)::text
           from public.usage_monthly_counters
           where organization_id = '${ids.orgA}'::uuid and metric = 'ocr'
             and period_month = '2026-07-01';`,
        ),
      ).toBe("1|1");

      runSql(
        dbContainer,
        enqueueSql(ids.jobB, ids.invocationB, ids.orgB, ids.reportB, ids.user),
      );
      expect(
        runSqlText(
          dbContainer,
          `select used_quantity from public.usage_monthly_counters
           where organization_id = '${ids.orgB}'::uuid and metric = 'ocr'
             and period_month = '2026-07-01';`,
        ),
      ).toBe("1");
      runSql(
        dbContainer,
        serviceRoleSql(
          `select public.release_usage_reservation('${ids.jobB}'::uuid, 'image_source_failed');
           select public.release_usage_reservation('${ids.jobB}'::uuid, 'image_source_failed');
           select public.reserve_usage_reservation('${ids.jobB}'::uuid);
           select public.reserve_usage_reservation('${ids.jobB}'::uuid);`,
        ),
      );
      expect(
        runSqlText(
          dbContainer,
          `select reservation.status || '|' || counter.used_quantity::text
           from public.usage_reservations as reservation
           join public.usage_monthly_counters as counter
             on counter.organization_id = reservation.organization_id
            and counter.metric = reservation.metric
            and counter.period_month = reservation.period_month
           where reservation.id = '${ids.jobB}'::uuid;`,
        ),
      ).toBe("reserved|1");

      const missingSubscription = runSqlCapture(
        dbContainer,
        enqueueSql(ids.jobC, ids.invocationC, ids.orgC, ids.reportC, ids.user),
      );
      expect(missingSubscription.code).not.toBe(0);
      expect(missingSubscription.stderr).toContain("OCR_USAGE_LIMIT_REACHED");
      expect(
        runSqlText(
          dbContainer,
          `select
            (select count(*) from public.usage_reservations where id = '${ids.jobC}'::uuid)::text || '|' ||
            (select count(*) from public.background_jobs where id = '${ids.jobC}'::uuid)::text || '|' ||
            (select count(*) from public.ai_invocations where id = '${ids.invocationC}'::uuid)::text || '|' ||
            (select count(*) from public.ocr_results where background_job_id = '${ids.jobC}'::uuid)::text;`,
        ),
      ).toBe("0|0|0|0");
    } finally {
      runSql(dbContainer, cleanupSql);
    }
  }, 20_000);

  it("makes consume/release idempotent and prevents consumed release", () => {
    const dbContainer = container ?? "";
    const jobId = "b2000000-0000-4000-8000-000000000001";
    const releasedJobId = "b2000000-0000-4000-8000-000000000003";
    const orgId = "b2000000-0000-4000-8000-000000000002";
    const cleanupSql = `delete from public.organizations where id = '${orgId}'::uuid;`;
    runSql(
      dbContainer,
      `${cleanupSql}
       insert into public.organizations (id, name, code)
       values ('${orgId}'::uuid, 'OCR Reservation RPC', 'ocr-reservation-rpc');
       insert into public.usage_monthly_counters (
         organization_id, metric, period_month, used_quantity,
         included_quantity, addon_quantity
       ) values ('${orgId}'::uuid, 'ocr', '2026-07-01', 2, 2, 0);
       insert into public.usage_reservations (
         id, organization_id, metric, quantity, period_month, source,
         object_type, object_id, status
       ) values
         (
           '${jobId}'::uuid, '${orgId}'::uuid, 'ocr', 1, '2026-07-01',
           'ocr_job', 'background_job', '${jobId}', 'reserved'
         ),
         (
           '${releasedJobId}'::uuid, '${orgId}'::uuid, 'ocr', 1, '2026-07-01',
           'ocr_job', 'background_job', '${releasedJobId}', 'reserved'
         );`,
    );
    try {
      runSql(
        dbContainer,
        serviceRoleSql(
          `select public.consume_usage_reservation('${jobId}'::uuid, '{"attempt":1}'::jsonb);
           select public.consume_usage_reservation('${jobId}'::uuid, '{"attempt":1}'::jsonb);`,
        ),
      );
      expect(
        runSqlText(
          dbContainer,
          `select status || '|' ||
             (select count(*) from public.usage_events where id = '${jobId}'::uuid)::text || '|' ||
             (select used_quantity from public.usage_monthly_counters
              where organization_id = '${orgId}'::uuid and metric = 'ocr'
                and period_month = '2026-07-01')::text
           from public.usage_reservations where id = '${jobId}'::uuid;`,
        ),
      ).toBe("consumed|1|2");

      runSql(
        dbContainer,
        serviceRoleSql(
          `select public.release_usage_reservation('${releasedJobId}'::uuid, 'image_source_failed');
           select public.release_usage_reservation('${releasedJobId}'::uuid, 'image_source_failed');`,
        ),
      );
      expect(
        runSqlText(
          dbContainer,
          `select status || '|' ||
             (select count(*) from public.usage_events where id = '${releasedJobId}'::uuid)::text || '|' ||
             (select used_quantity from public.usage_monthly_counters
              where organization_id = '${orgId}'::uuid and metric = 'ocr'
                and period_month = '2026-07-01')::text
           from public.usage_reservations where id = '${releasedJobId}'::uuid;`,
        ),
      ).toBe("released|0|1");

      const consumedRelease = runSqlCapture(
        dbContainer,
        serviceRoleSql(
          `select public.release_usage_reservation('${jobId}'::uuid, 'should_not_release');`,
        ),
      );
      expect(consumedRelease.code).not.toBe(0);
      expect(consumedRelease.stderr).toContain(
        "USAGE_RESERVATION_ALREADY_CONSUMED",
      );
    } finally {
      runSql(dbContainer, cleanupSql);
    }
  });
});

function enqueueSql(
  jobId: string,
  invocationId: string,
  organizationId: string,
  liveReportId: string,
  actorUserId: string,
) {
  return serviceRoleSql(`
    select public.enqueue_ocr_job(
      '${jobId}'::uuid,
      '${invocationId}'::uuid,
      '${organizationId}'::uuid,
      '${liveReportId}'::uuid,
      null,
      '${actorUserId}'::uuid,
      'OCR Quota Regression',
      'owner'::public.app_role,
      jsonb_build_object(
        'liveReportId', '${liveReportId}',
        'imageBase64', 'ZmFrZQ=='
      ),
      '2026-07-31T12:00:00Z'::timestamptz
    );
  `);
}

function serviceRoleSql(sql: string) {
  return `
    begin;
    select set_config('request.jwt.claim.role', 'service_role', true);
    ${sql}
    commit;
  `;
}

function runSql(containerName: string, sql: string) {
  const result = runSqlCapture(containerName, sql);
  expect(result.code, result.stderr).toBe(0);
}

function runSqlText(containerName: string, sql: string) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=verbose",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  return result.stdout.trim();
}

function runSqlCapture(containerName: string, sql: string) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=verbose",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );
  return {
    code: result.status,
    stderr: result.stderr || result.error?.message || "",
    stdout: result.stdout,
  };
}

function runSqlAsync(containerName: string, sql: string) {
  return new Promise<{ code: number | null; stderr: string; stdout: string }>(
    (resolve) => {
      const child = spawn(
        "docker",
        [
          "exec",
          containerName,
          "psql",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-X",
          "-qAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "VERBOSITY=verbose",
          "-c",
          sql,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      child.on("close", (code) => resolve({ code, stderr, stdout }));
    },
  );
}
