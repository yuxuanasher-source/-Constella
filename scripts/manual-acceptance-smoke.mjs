import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createServerClient } from "@supabase/ssr";

const manualDocPath = "docs/manual-acceptance-test-cases.md";

const forbiddenDtoKeyPatterns = [
  /_/,
  /receivable/i,
  /gross/i,
  /margin/i,
  /cost/i,
  /vendorPrice/i,
  /vendorUnitPrice/i,
  /supplierPrice/i,
  /internalRisk/i,
  /settlementPrice/i,
];

const forbiddenSensitiveTextPatterns = [
  /主播结算价格/,
  /MCN\s*毛利/i,
  /毛利/,
  /供应商内部成本/,
  /内部风险/,
  /grossMargin/i,
  /vendorReceivable/i,
  /supplierCost/i,
  /costCents/i,
  /receivableCents/i,
  /settlementPrice/i,
];

export const AUTOMATED_CASES = [
  {
    id: "manual-doc-case-map",
    label: "manual acceptance document contains every automated case id",
    caseIds: ["E2E-001"],
  },
  {
    id: "role-scoped-report-queue",
    label: "ops report queue uses safe DTOs",
    caseIds: ["E2E-003", "M0-002", "M0-005", "M5-012"],
  },
  {
    id: "p1-evidence-golden-path",
    label: "P1 task to approved report to settlement pool",
    caseIds: ["E2E-001", "M4-004", "M5-003", "M5-011"],
  },
  {
    id: "p2-settlement-golden-path",
    label: "P2 batch generation, manual carry, lock, and reopen",
    caseIds: ["E2E-002", "M6-002", "M6-003", "M6-004", "M6-006"],
  },
  {
    id: "direct-access-guards",
    label: "role write and staff-only route guards reject direct API access",
    caseIds: ["E2E-004", "M0-003", "M0-004", "M6-008", "M8-004"],
  },
  {
    id: "streamer-safe-settlements",
    label: "streamer settlement payload stays payable-safe",
    caseIds: ["E2E-003", "M0-003", "M6-007"],
  },
  {
    id: "p3-audit-high-risk",
    label: "high-risk settlement actions are visible in audit center",
    caseIds: ["M7-001", "M7-002", "M7-003", "M7-004"],
  },
  {
    id: "p3-export-sanitization",
    label: "vendor delivery exports are field-whitelisted and streamer-denied",
    caseIds: ["M3-009", "M8-001", "M8-002", "M8-004"],
  },
  {
    id: "p3-notification-workflow",
    label: "notifications can move from unread to handled",
    caseIds: ["M9-001", "M9-003", "M9-004"],
  },
  {
    id: "p3-anomaly-scan",
    label: "operations can trigger anomaly scanning",
    caseIds: ["M4-006", "M9-005"],
  },
  {
    id: "p4-auto-review-shadow",
    label: "auto review shadow mode evaluates without active approval",
    caseIds: ["AUTO-001", "AUTO-002", "AUTO-003"],
  },
  {
    id: "p4-war-room-pricing",
    label: "war-room pricing calculator returns economics",
    caseIds: ["M10-001"],
  },
  {
    id: "p4-war-room-matching",
    label: "war-room matching returns streamer and supplier scores",
    caseIds: ["M10-002", "M10-003"],
  },
  {
    id: "p4-ai-diagnosis-safe",
    label: "streamer AI diagnosis strips organization finance fields",
    caseIds: ["M0-006", "M10-006", "M10-007"],
  },
];

const caseHandlers = {
  "manual-doc-case-map": async ({ manualCaseIds }) => {
    for (const testCase of AUTOMATED_CASES) {
      for (const caseId of testCase.caseIds) {
        if (!manualCaseIds.has(caseId)) {
          throw new Error(`${caseId} is not present in ${manualDocPath}`);
        }
      }
    }
  },

  "role-scoped-report-queue": async ({ cookies, requestJson }) => {
    const body = await requestJson("/api/live-reports", {
      cookie: cookies.ops,
    });

    assertArray(body.reports, "reports");
    assertNonEmpty(body.reports, "reports");
    assertNoForbiddenKeys(body.reports, "M5 report queue");
    assertNoForbiddenText(JSON.stringify(body.reports), "M5 report queue");
    assertNoForbiddenText(
      JSON.stringify(collectObjectKeys(body.reports)),
      "M5 keys",
    );
  },

  "p1-evidence-golden-path": async ({
    cookies,
    requestJson,
    flow,
    smokeConfig,
  }) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const plannedStartAt = "2026-06-02T12:00:00.000Z";
    const plannedEndAt = "2026-06-02T14:00:00.000Z";
    const taskBody = await requestJson("/api/live-tasks", {
      cookie: cookies.ops,
      method: "POST",
      expectedStatus: 201,
      body: {
        projectId: smokeConfig.projectId,
        streamerId: smokeConfig.streamerId,
        title: `Manual Acceptance P1 Golden Task ${suffix}`,
        plannedStartAt,
        plannedEndAt,
        plannedDuration: 120,
        note: "manual acceptance smoke",
      },
    });
    assertObject(taskBody.task, "created live task");
    assertEqual(taskBody.task.status, "pending_live", "created task status");

    const taskId = taskBody.task.id;
    const startBody = await requestJson(`/api/live-tasks/${taskId}/start`, {
      cookie: cookies.streamer,
      method: "POST",
      body: { now: plannedStartAt },
    });
    assertEqual(startBody.task.status, "live", "started task status");

    const stopBody = await requestJson(`/api/live-tasks/${taskId}/stop`, {
      cookie: cookies.streamer,
      method: "POST",
      body: { now: plannedEndAt },
    });
    assertEqual(stopBody.task.status, "pending_report", "stopped task status");
    assertEqual(stopBody.task.systemDuration, 120, "system duration");

    const reportBody = await requestJson(`/api/live-tasks/${taskId}/reports`, {
      cookie: cookies.streamer,
      method: "POST",
      expectedStatus: 201,
      body: {
        screenshotStoragePath: `manual-acceptance/${taskId}/end-screen.png`,
        screenshotFileHash: `manual-acceptance-${taskId}-${suffix}`,
        screenshotDuration: 119,
        claimedDuration: 119,
        viewers: 1200,
      },
    });
    assertObject(reportBody.report, "submitted report");
    assertEqual(
      reportBody.report.status,
      "pending_review",
      "submitted report status",
    );
    assertEqual(
      reportBody.report.timeSource,
      "system",
      "submitted report time source",
    );
    assertEqual(
      reportBody.report.evidenceLevel,
      "green",
      "submitted report evidence level",
    );

    const reportId = reportBody.report.id;
    flow.reportId = reportId;
    const reviewBody = await requestJson(
      `/api/live-reports/${reportId}/review`,
      {
        cookie: cookies.ops,
        method: "PATCH",
        body: {
          decision: "approve",
          includeInTaskResult: true,
          enterSettlementPool: true,
          reviewNotes: "manual acceptance smoke approval",
        },
      },
    );
    assertEqual(reviewBody.report.status, "approved", "approved report status");
    assertEqual(
      reviewBody.report.enterSettlementPool,
      true,
      "approved report settlement-pool flag",
    );

    const poolBody = await requestJson(
      `/api/settlement-pool?projectId=${smokeConfig.projectId}&periodStart=2026-01-01&periodEnd=2026-12-31`,
      { cookie: cookies.ops },
    );
    assertArray(poolBody.reports, "P1 settlement pool reports");
    const poolReport = poolBody.reports.find((item) => item.id === reportId);
    assertObject(poolReport, "approved report in settlement pool");
    assertEqual(
      poolReport.evidenceLevel,
      "green",
      "approved report pool evidence",
    );
  },

  "p2-settlement-golden-path": async ({
    cookies,
    requestJson,
    flow,
    smokeConfig,
  }) => {
    if (!flow.reportId) {
      throw new Error("P1 flow report id is required for P2 flow smoke");
    }

    const batchBody = await requestJson("/api/settlement-batches", {
      cookie: cookies.ops,
      method: "POST",
      expectedStatus: 201,
      body: {
        projectId: smokeConfig.projectId,
        batchType: "payable",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      },
    });
    assertObject(batchBody.batch, "generated settlement batch");
    assertArray(batchBody.items, "generated settlement items");
    assertNonEmpty(batchBody.items, "generated settlement items");
    assertEqual(batchBody.batch.status, "generated", "generated batch status");
    assertPositiveNumber(
      batchBody.batch.computedAmount,
      "generated batch computed amount",
    );

    const generatedReportItem = batchBody.items.find(
      (item) => item.liveReportId === flow.reportId,
    );
    assertObject(generatedReportItem, "P1 report settlement item");
    assertEqual(
      generatedReportItem.itemType,
      "live_report",
      "P1 report settlement item type",
    );

    const batchId = batchBody.batch.id;
    flow.batchId = batchId;
    const manualBody = await requestJson(
      `/api/settlement-batches/${batchId}/manual-items`,
      {
        cookie: cookies.ops,
        method: "POST",
        expectedStatus: 201,
        body: {
          itemType: "gift",
          projectId: smokeConfig.projectId,
          streamerId: smokeConfig.streamerId,
          manualAmount: 88,
          evidenceLevel: "red",
          reason: "manual acceptance smoke manual carry",
          note: "CPA/CPS/gift values are manually carried, not computed",
        },
      },
    );
    assertObject(manualBody.item, "manual settlement item");
    assertEqual(manualBody.item.itemType, "gift", "manual item type");
    assertEqual(
      manualBody.item.computedAmount,
      0,
      "manual item computed amount",
    );
    assertEqual(manualBody.item.manualAmount, 88, "manual item carried amount");

    const lockedBody = await requestJson(
      `/api/settlement-batches/${batchId}/lock`,
      {
        cookie: cookies.ops,
        method: "POST",
        body: { reason: "manual acceptance smoke lock" },
      },
    );
    assertEqual(lockedBody.batch.status, "locked", "locked batch status");
    assertEqual(
      lockedBody.batch.lockReason,
      "manual acceptance smoke lock",
      "locked batch reason",
    );

    const reopenedBody = await requestJson(
      `/api/settlement-batches/${batchId}/reopen`,
      {
        cookie: cookies.owner,
        method: "POST",
        body: { reason: "manual acceptance smoke reopen" },
      },
    );
    assertEqual(reopenedBody.batch.status, "reopened", "reopened batch status");
    assertEqual(
      reopenedBody.batch.reopenReason,
      "manual acceptance smoke reopen",
      "reopened batch reason",
    );
  },

  "direct-access-guards": async ({
    cookies,
    requestJson,
    flow,
    smokeConfig,
  }) => {
    if (!flow.batchId) {
      throw new Error("P2 flow batch id is required for direct access smoke");
    }

    const financeMutation = await requestJson("/api/settlement-batches", {
      cookie: cookies.finance,
      method: "POST",
      expectedStatus: 403,
      body: {
        projectId: smokeConfig.projectId,
        batchType: "payable",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      },
    });
    assertEqual(
      financeMutation.error,
      "Current role cannot manage settlement batches",
      "finance mutation error",
    );

    const streamerBatchRead = await requestJson(
      `/api/settlement-batches/${flow.batchId}`,
      {
        cookie: cookies.streamer,
        expectedStatus: 403,
      },
    );
    assertEqual(
      streamerBatchRead.error,
      "Only MCN staff can view settlement batches",
      "streamer batch read error",
    );

    const streamerExport = await requestJson("/api/exports", {
      cookie: cookies.streamer,
      method: "POST",
      expectedStatus: 403,
      body: {
        kind: "vendor_delivery",
        rows: [],
      },
    });
    assertEqual(
      streamerExport.error,
      "Only MCN staff can create exports",
      "streamer export error",
    );
  },

  "streamer-safe-settlements": async ({ cookies, requestJson }) => {
    const body = await requestJson("/api/streamer/settlements", {
      cookie: cookies.streamer,
    });

    assertObject(body.earnings, "streamer earnings");
    assertArray(body.earnings.items, "streamer earnings items");
    assertNonEmpty(body.earnings.items, "streamer earnings items");
    assertNoForbiddenKeys(body.earnings, "streamer settlement earnings");
    assertNoForbiddenText(
      JSON.stringify(body.earnings),
      "streamer settlement earnings",
    );
  },

  "p3-audit-high-risk": async ({ cookies, requestJson, flow }) => {
    if (!flow.batchId) {
      throw new Error("P2 flow batch id is required for P3 audit smoke");
    }

    const body = await requestJson(
      "/api/audit-logs?module=settlement&highRiskOnly=1&limit=20",
      { cookie: cookies.owner },
    );

    assertArray(body.entries, "audit entries");
    assertNonEmpty(body.entries, "audit entries");
    assertNoForbiddenKeys(body.entries, "audit center entries");

    const batchEntries = body.entries.filter(
      (entry) => entry.objectId === flow.batchId,
    );
    assertNonEmpty(batchEntries, "P2 batch audit entries");
    assertObject(
      batchEntries.find((entry) => entry.action === "lock"),
      "P2 batch lock audit entry",
    );
    assertObject(
      batchEntries.find((entry) => entry.action === "reopen"),
      "P2 batch reopen audit entry",
    );
    for (const entry of batchEntries) {
      assertEqual(entry.module, "settlement", "audit entry module");
      assertEqual(entry.isHighRisk, true, "audit entry high risk flag");
      if (!entry.reason) {
        throw new Error(`${entry.id} must include a high-risk reason`);
      }
    }
  },

  "p3-export-sanitization": async ({ cookies, requestJson }) => {
    const body = await requestJson("/api/exports", {
      cookie: cookies.owner,
      method: "POST",
      body: {
        kind: "vendor_delivery",
        rows: [
          {
            projectName: "New Game Launch Week",
            streamerName: "Streamer One",
            settlementDuration: 120,
            evidenceLevel: "green",
            streamerSettlementPrice: "主播结算价格",
            grossMarginCents: 999999,
            supplierCostCents: 88888,
            internalRiskNote: "内部风险",
          },
        ],
      },
    });

    assertObject(body.export, "governed export");
    assertEqual(body.export.kind, "vendor_delivery", "export kind");
    assertEqual(body.export.rowCount, 1, "export row count");
    assertNoForbiddenText(body.export.content, "vendor delivery export");
  },

  "p3-notification-workflow": async ({ cookies, requestJson }) => {
    const body = await requestJson("/api/notifications", {
      cookie: cookies.owner,
    });
    assertArray(body.items, "notification items");
    assertNonEmpty(body.items, "notification items");

    const highRiskRoleNotification = body.items.find(
      (item) => item.isHighRisk || item.title.includes("Settlement batch"),
    );
    assertObject(highRiskRoleNotification, "owner high-risk role notification");

    const notification = selectMutableNotification(body.items);
    const readBody = await requestJson(
      `/api/notifications/${notification.id}`,
      {
        cookie: cookies.owner,
        method: "PATCH",
        body: { action: "read" },
      },
    );
    assertEqual(
      readBody.notification.status,
      "read",
      "notification read status",
    );

    const handledBody = await requestJson(
      `/api/notifications/${notification.id}`,
      {
        cookie: cookies.owner,
        method: "PATCH",
        body: { action: "handled" },
      },
    );
    assertEqual(
      handledBody.notification.status,
      "handled",
      "notification handled status",
    );
  },

  "p3-anomaly-scan": async ({ cookies, requestJson }) => {
    const body = await requestJson("/api/anomalies/scan", {
      cookie: cookies.ops,
      method: "POST",
    });

    assertObject(body.result, "anomaly scan result");
    assertNumber(body.result.detectedCount, "anomaly detected count");
    assertNumber(body.result.sentCount, "anomaly sent count");
  },

  "p4-auto-review-shadow": async ({ cookies, requestJson, flow }) => {
    if (!flow.reportId) {
      throw new Error("P1 flow report id is required for auto review smoke");
    }

    const body = await requestJson("/api/auto-review/evaluate", {
      cookie: cookies.ops,
      method: "POST",
      body: {
        report: {
          id: flow.reportId,
          status: "pending_review",
          evidenceLevel: "green",
          timeSource: "system",
          settlementDuration: 120,
          systemDuration: 120,
          screenshotDuration: 121,
          riskFlags: [],
          taskHasAnomaly: false,
          durationOverridden: false,
          projectSensitivity: "normal",
          streamerTrust: "trusted",
          plannedDuration: 120,
        },
        rule: {
          id: "manual-acceptance-shadow-rule",
          mode: "shadow",
          maxDurationDeviationPct: 10,
          maxDurationDeviationMinutes: 15,
          dailyHardLimitMinutes: 480,
        },
      },
    });

    assertEqual(
      body.result.decision,
      "auto_pass_candidate",
      "auto review shadow decision",
    );
    assertEqual(body.result.mode, "shadow", "auto review shadow mode");
  },

  "p4-war-room-pricing": async ({ cookies, requestJson }) => {
    const body = await requestJson("/api/war-room/pricing", {
      cookie: cookies.owner,
      method: "POST",
      body: {
        vendorSettlementMethod: "cpt",
        streamerCount: 5,
        estimatedMinutesPerStreamer: 1200,
        vendorHourlyRateCents: 12000,
        streamerHourlyCostCents: 7000,
        supplierCostCents: 200000,
        platformFeeBps: 0,
        manualAdjustmentCents: 0,
        targetMarginBps: 2000,
      },
    });

    assertObject(body.pricing, "war-room pricing");
    assertEqual(
      body.pricing.expectedReceivableCents,
      1200000,
      "expected receivable",
    );
    assertEqual(body.pricing.streamerPayableCents, 700000, "streamer payable");
    assertPositiveNumber(body.pricing.grossMarginCents, "pricing gross margin");

    const streamerDenied = await requestJson("/api/war-room/pricing", {
      cookie: cookies.streamer,
      method: "POST",
      expectedStatus: 403,
      body: {
        vendorSettlementMethod: "cpt",
        streamerCount: 1,
        estimatedMinutesPerStreamer: 60,
      },
    });
    assertEqual(
      streamerDenied.error,
      "Only MCN staff can calculate quote economics",
      "streamer pricing denial",
    );
  },

  "p4-war-room-matching": async ({ cookies, requestJson }) => {
    const body = await requestJson("/api/war-room/matching", {
      cookie: cookies.owner,
      method: "POST",
      body: {
        project: {
          category: "moba",
          platform: "douyin",
          preferredStyles: ["high_interaction", "teaching"],
          requiredMinutes: 900,
        },
        candidates: [
          {
            id: "streamer-a",
            name: "Ava",
            categories: ["moba", "fps"],
            platforms: ["douyin"],
            styles: ["high_interaction"],
            completionRateBps: 9200,
            screeningPassRateBps: 8800,
            roiBps: 14000,
            grossMarginContributionCents: 180000,
            riskTags: [],
            availableMinutes: 1200,
            referenceProjects: [
              { id: "project-a", name: "Spring Launch", result: "95%" },
            ],
          },
          {
            id: "streamer-b",
            name: "Bo",
            categories: ["slg"],
            platforms: ["kuaishou"],
            styles: ["variety"],
            completionRateBps: 5600,
            screeningPassRateBps: 4300,
            roiBps: 3000,
            grossMarginContributionCents: -20000,
            riskTags: ["recent_anomaly"],
            availableMinutes: 300,
            referenceProjects: [],
          },
        ],
        suppliers: [
          {
            id: "supplier-a",
            name: "Galaxy Guild",
            screeningPassRateBps: 9000,
            completionRateBps: 8500,
            marginContributionCents: 1500000,
            anomalyRateBps: 500,
            blacklistRateBps: 0,
            isBlacklisted: false,
          },
        ],
      },
    });

    assertArray(body.matches, "war-room matches");
    assertArray(body.suppliers, "supplier scores");
    assertNonEmpty(body.matches, "war-room matches");
    assertNonEmpty(body.suppliers, "supplier scores");
    assertPositiveNumber(body.matches[0].score, "best streamer score");
    assertPositiveNumber(body.suppliers[0].score, "supplier score");
  },

  "p4-ai-diagnosis-safe": async ({ cookies, requestJson }) => {
    const body = await requestJson("/api/ai/diagnosis", {
      cookie: cookies.streamer,
      method: "POST",
      body: {
        task: { title: "Evening push", game: "moba" },
        report: {
          totalViews: 300,
          grossMarginCents: 50000,
          supplierCostCents: 20000,
          vendorReceivableCents: 80000,
        },
        feedback: ["互动断层"],
      },
    });

    assertObject(body.result, "AI diagnosis result");
    assertArray(body.result.output.scriptSuggestions, "AI script suggestions");
    assertNonEmpty(
      body.result.output.scriptSuggestions,
      "AI script suggestions",
    );
    assertNoForbiddenText(JSON.stringify(body.result), "AI diagnosis result");
    assertNoForbiddenKeys(
      body.result.output.sourceSnapshot,
      "AI source snapshot",
    );
  },
};

export async function runManualAcceptanceSmoke() {
  const manualCaseIds = extractManualCaseIds(
    readFileSync(manualDocPath, "utf8"),
  );
  const env = loadEnv();
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const supabaseUrl = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = requireEnv(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const smokeConfig = loadSmokeConfig(env);
  const requestJson = createRequestJson(appUrl);

  const cookies = {
    owner: await signIn({
      email: smokeConfig.userEmails.owner,
      supabaseUrl,
      supabaseAnonKey,
      password: smokeConfig.userPassword,
    }),
    ops: await signIn({
      email: smokeConfig.userEmails.ops,
      supabaseUrl,
      supabaseAnonKey,
      password: smokeConfig.userPassword,
    }),
    finance: await signIn({
      email: smokeConfig.userEmails.finance,
      supabaseUrl,
      supabaseAnonKey,
      password: smokeConfig.userPassword,
    }),
    streamer: await signIn({
      email: smokeConfig.userEmails.streamer,
      supabaseUrl,
      supabaseAnonKey,
      password: smokeConfig.userPassword,
    }),
  };
  const flow = {};
  const context = {
    cookies,
    flow,
    manualCaseIds,
    requestJson,
    smokeConfig,
  };

  for (const testCase of AUTOMATED_CASES) {
    const handler = caseHandlers[testCase.id];
    if (!handler) {
      throw new Error(`No handler registered for ${testCase.id}`);
    }
    await check(testCase, () => handler(context));
  }

  console.log("manual acceptance smoke passed");
}

async function signIn({ email, supabaseUrl, supabaseAnonKey, password }) {
  const jar = new Map();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({
          name,
          value,
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          if (value) {
            jar.set(name, value);
          } else {
            jar.delete(name);
          }
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    throw new Error(`Could not sign in ${email}: ${error.message}`);
  }

  const cookie = Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (!cookie) {
    throw new Error(`No Supabase SSR cookie was created for ${email}`);
  }

  return cookie;
}

function createRequestJson(appUrl) {
  return async function requestJson(path, options) {
    const response = await fetch(`${appUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Cookie: options.cookie,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const body = await response.json().catch(() => ({}));
    const expectedStatus = options.expectedStatus ?? 200;

    if (response.status !== expectedStatus) {
      throw new Error(
        `${path} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(
          body,
        )}`,
      );
    }

    return body;
  };
}

async function check(testCase, fn) {
  await fn();
  console.log(
    `ok - ${testCase.id} (${testCase.caseIds.join(", ")}): ${testCase.label}`,
  );
}

function loadEnv() {
  const loaded = { ...process.env };
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) {
      continue;
    }

    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || loaded[match[1]]) {
        continue;
      }

      loaded[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }

  return loaded;
}

function requireEnv(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required for manual acceptance smoke`);
  }

  return value;
}

function loadSmokeConfig(env) {
  return {
    projectId: requireEnv(env, "SMOKE_PROJECT_ID"),
    streamerId: requireEnv(env, "SMOKE_STREAMER_ID"),
    userPassword: requireEnv(env, "SMOKE_USER_PASSWORD"),
    userEmails: {
      owner: requireEnv(env, "SMOKE_OWNER_EMAIL"),
      ops: requireEnv(env, "SMOKE_OPS_EMAIL"),
      finance: requireEnv(env, "SMOKE_FINANCE_EMAIL"),
      streamer: requireEnv(env, "SMOKE_STREAMER_EMAIL"),
    },
  };
}

export function extractManualCaseIds(markdown) {
  return new Set(
    Array.from(
      markdown.matchAll(
        /^\|\s*((?:E2E|M0|M1|M2|M3|M4|M5|AUTO|M6|M7|M8|M9|M10|P5)-\d{3})\s*\|/gm,
      ),
      (match) => match[1],
    ),
  );
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
}

function assertNonEmpty(value, label) {
  if (!value.length) {
    throw new Error(`${label} must not be empty`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

function assertNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number, got ${value}`);
  }
}

function assertPositiveNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number, got ${value}`);
  }
}

export function assertNoForbiddenText(value, label) {
  for (const pattern of forbiddenSensitiveTextPatterns) {
    if (pattern.test(value)) {
      throw new Error(`${label} must not contain sensitive text ${pattern}`);
    }
  }
}

export function assertNoForbiddenKeys(value, label) {
  for (const key of collectObjectKeys(value)) {
    for (const pattern of forbiddenDtoKeyPatterns) {
      if (pattern.test(key)) {
        throw new Error(`${label} contains forbidden DTO key "${key}"`);
      }
    }
  }
}

export function selectMutableNotification(items) {
  const notification = items.find((item) => item.objectType === "organization");

  if (!notification) {
    throw new Error(
      "No user-addressed notification was found for status transition smoke",
    );
  }

  return notification;
}

export function collectObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.flatMap(collectObjectKeys);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => [
    key,
    ...collectObjectKeys(nestedValue),
  ]);
}

function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }

  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMainModule()) {
  runManualAcceptanceSmoke().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
