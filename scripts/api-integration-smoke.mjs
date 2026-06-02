import { existsSync, readFileSync } from "node:fs";

import { createServerClient } from "@supabase/ssr";

const projectId = "99999999-9999-9999-9999-999999999999";
const streamerId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const seededBatchId = "95959595-9595-4959-9595-959595959595";
const password = "Password123!";

const forbiddenDtoKeyPatterns = [
  /_/,
  /receivable/i,
  /gross/i,
  /cost/i,
  /vendorPrice/i,
  /vendorUnitPrice/i,
  /supplierPrice/i,
];

const env = loadEnv();
const appUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const ownerCookie = await signIn("owner@jy-demo.local");
const opsCookie = await signIn("ops@jy-demo.local");
const financeCookie = await signIn("finance@jy-demo.local");
const streamerCookie = await signIn("streamer@jy-demo.local");
const p1Flow = {};

await check("ops can read the M5 report queue over HTTP", async () => {
  const body = await requestJson("/api/live-reports", {
    cookie: opsCookie,
  });

  assertArray(body.reports, "reports");
  assertNonEmpty(body.reports, "reports");
  assertPublicDtoShape(body.reports, "reports");
  assertNotContains(JSON.stringify(body.reports), /amount/i, "reports");
});

await check(
  "P1 authenticated flow creates task, captures timing, submits report, and approves into settlement pool",
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const plannedStartAt = "2026-06-02T12:00:00.000Z";
    const plannedEndAt = "2026-06-02T14:00:00.000Z";
    const taskBody = await requestJson("/api/live-tasks", {
      cookie: opsCookie,
      method: "POST",
      expectedStatus: 201,
      body: {
        projectId,
        streamerId,
        title: `API Smoke P1 Golden Task ${suffix}`,
        plannedStartAt,
        plannedEndAt,
        plannedDuration: 120,
        note: "api integration smoke",
      },
    });
    assertObject(taskBody.task, "created live task");
    assertEqual(taskBody.task.status, "pending_live", "created task status");

    const taskId = taskBody.task.id;
    const startBody = await requestJson(`/api/live-tasks/${taskId}/start`, {
      cookie: streamerCookie,
      method: "POST",
      body: { now: plannedStartAt },
    });
    assertEqual(startBody.task.status, "live", "started task status");

    const stopBody = await requestJson(`/api/live-tasks/${taskId}/stop`, {
      cookie: streamerCookie,
      method: "POST",
      body: { now: plannedEndAt },
    });
    assertEqual(stopBody.task.status, "pending_report", "stopped task status");
    assertEqual(stopBody.task.systemDuration, 120, "system duration");

    const reportBody = await requestJson(`/api/live-tasks/${taskId}/reports`, {
      cookie: streamerCookie,
      method: "POST",
      expectedStatus: 201,
      body: {
        screenshotStoragePath: `api-smoke/${taskId}/end-screen.png`,
        screenshotFileHash: `api-smoke-${taskId}-${suffix}`,
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
    p1Flow.reportId = reportId;
    const reviewBody = await requestJson(
      `/api/live-reports/${reportId}/review`,
      {
        cookie: opsCookie,
        method: "PATCH",
        body: {
          decision: "approve",
          includeInTaskResult: true,
          enterSettlementPool: true,
          reviewNotes: "api integration smoke approval",
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
      `/api/settlement-pool?projectId=${projectId}&periodStart=2026-01-01&periodEnd=2026-12-31`,
      { cookie: opsCookie },
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
);

await check("ops can read the M6 settlement pool over HTTP", async () => {
  const body = await requestJson(
    `/api/settlement-pool?projectId=${projectId}&periodStart=2026-01-01&periodEnd=2026-12-31`,
    { cookie: opsCookie },
  );

  assertArray(body.reports, "settlement pool reports");
  assertNonEmpty(body.reports, "settlement pool reports");
  assertPublicDtoShape(body.reports, "settlement pool reports");
});

await check(
  "ops can read M6 settlement batches and details over HTTP",
  async () => {
    const listBody = await requestJson("/api/settlement-batches", {
      cookie: opsCookie,
    });
    assertArray(listBody.batches, "settlement batches");
    assertNonEmpty(listBody.batches, "settlement batches");
    assertPublicDtoShape(listBody.batches, "settlement batches");

    const detailBody = await requestJson(
      `/api/settlement-batches/${seededBatchId}`,
      { cookie: opsCookie },
    );
    assertObject(detailBody.batch, "settlement batch detail");
    assertArray(detailBody.items, "settlement batch detail items");
    assertNonEmpty(detailBody.items, "settlement batch detail items");
    assertPublicDtoShape(detailBody, "settlement batch detail");
  },
);

await check(
  "P2 authenticated flow generates batch, adds manual carry amount, locks, and owner reopens",
  async () => {
    if (!p1Flow.reportId) {
      throw new Error("P1 flow report id is required for P2 flow smoke");
    }

    const batchBody = await requestJson("/api/settlement-batches", {
      cookie: opsCookie,
      method: "POST",
      expectedStatus: 201,
      body: {
        projectId,
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
      (item) => item.liveReportId === p1Flow.reportId,
    );
    assertObject(generatedReportItem, "P1 report settlement item");
    assertEqual(
      generatedReportItem.itemType,
      "live_report",
      "P1 report settlement item type",
    );

    const batchId = batchBody.batch.id;
    const manualBody = await requestJson(
      `/api/settlement-batches/${batchId}/manual-items`,
      {
        cookie: opsCookie,
        method: "POST",
        expectedStatus: 201,
        body: {
          itemType: "gift",
          projectId,
          streamerId,
          manualAmount: 88,
          evidenceLevel: "red",
          reason: "api integration smoke manual carry",
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
        cookie: opsCookie,
        method: "POST",
        body: { reason: "api integration smoke lock" },
      },
    );
    assertEqual(lockedBody.batch.status, "locked", "locked batch status");
    assertEqual(
      lockedBody.batch.lockReason,
      "api integration smoke lock",
      "locked batch reason",
    );

    const reopenedBody = await requestJson(
      `/api/settlement-batches/${batchId}/reopen`,
      {
        cookie: ownerCookie,
        method: "POST",
        body: { reason: "api integration smoke reopen" },
      },
    );
    assertEqual(reopenedBody.batch.status, "reopened", "reopened batch status");
    assertEqual(
      reopenedBody.batch.reopenReason,
      "api integration smoke reopen",
      "reopened batch reason",
    );
  },
);

await check(
  "streamer can read payable-safe settlements over HTTP",
  async () => {
    const body = await requestJson("/api/streamer/settlements", {
      cookie: streamerCookie,
    });

    assertObject(body.earnings, "streamer earnings");
    assertArray(body.earnings.items, "streamer earnings items");
    assertNonEmpty(body.earnings.items, "streamer earnings items");
    assertPublicDtoShape(body.earnings, "streamer earnings");
  },
);

await check(
  "finance receives 403 for M6 settlement mutations over HTTP",
  async () => {
    const body = await requestJson("/api/settlement-batches", {
      cookie: financeCookie,
      method: "POST",
      expectedStatus: 403,
      body: {
        projectId,
        batchType: "payable",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      },
    });

    assertEqual(
      body.error,
      "Current role cannot manage settlement batches",
      "finance mutation error",
    );
  },
);

console.log("api integration smoke passed");

async function signIn(email) {
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

async function requestJson(path, options) {
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
}

async function check(label, fn) {
  await fn();
  console.log(`ok - ${label}`);
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

function requireEnv(key) {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required for API integration smoke`);
  }

  return value;
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

function assertPositiveNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number, got ${value}`);
  }
}

function assertNotContains(value, pattern, label) {
  if (pattern.test(value)) {
    throw new Error(`${label} must not contain ${pattern}`);
  }
}

function assertPublicDtoShape(value, label) {
  for (const key of collectObjectKeys(value)) {
    for (const pattern of forbiddenDtoKeyPatterns) {
      if (pattern.test(key)) {
        throw new Error(`${label} contains forbidden DTO key "${key}"`);
      }
    }
  }
}

function collectObjectKeys(value) {
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
