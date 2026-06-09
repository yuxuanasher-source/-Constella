# Real OCR Product Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Tencent OCR provider and OCR job APIs into a real end-to-end product flow: streamer uploads a report screenshot, OCR runs automatically, the streamer confirms or corrects the result, and ops reviews a report with OCR/manual differences preserved.

**Architecture:** Keep the existing `features/ai/providers/tencent-ocr-provider.ts`, `features/ai/ocr-jobs.ts`, and `/api/ocr/jobs` foundation. Add a storage-backed OCR image resolver so jobs can reference private Supabase object paths instead of long-lived base64 payloads. Add live-report OCR submission and confirmation services, then wire the streamer mobile report page to the new flow while retaining the existing manual fallback.

**Tech Stack:** Next.js route handlers, React reference UI, TypeScript strict mode, Supabase private storage, Supabase RLS, Vitest, Tencent Cloud OCR `GeneralBasicOCR`, existing usage/audit ledgers.

---

## File Structure

- Modify: `features/ai/ocr-jobs.ts`
  - Extend OCR job payload with `imageBucket` and `imagePath`.
  - Allow `runOcrJobOnce` to resolve image input via an injected resolver.
- Create: `features/ai/ocr-image-source.ts`
  - Convert private Supabase storage objects into Tencent OCR input.
- Create: `features/ai/ocr-image-source.test.ts`
  - Test base64, URL, private object download, and missing image behavior.
- Modify: `app/api/ocr/jobs/run/route.ts`
  - Use the storage resolver when running OCR jobs manually from ops.
- Create: `app/api/internal/ocr/run/route.ts`
  - Token-protected runner endpoint for cron/server automation.
- Create: `app/api/internal/ocr/run/route.test.ts`
  - Verify token auth, no raw image leakage, and provider-unconfigured handling.
- Modify: `features/live-operations/live-operations-service.ts`
  - Add screenshot-for-OCR submission and OCR confirmation service functions.
- Modify: `features/live-operations/live-operations-repository.ts`
  - Ensure existing report updates can store OCR-confirmed durations/viewers.
- Modify: `features/live-operations/live-operations-service.test.ts`
  - Add service-level tests for `ocr_ing`, `pending_confirm`, and `pending_review`.
- Create: `app/api/live-tasks/[taskId]/ocr/route.ts`
  - Streamer/staff creates a report screenshot OCR job from an uploaded image path.
- Create: `app/api/live-tasks/[taskId]/ocr/route.test.ts`
  - Verify access, report creation, job creation, and safe response.
- Create: `app/api/live-reports/[reportId]/ocr/route.ts`
  - Fetch safe OCR state and confirm corrected result for a report.
- Create: `app/api/live-reports/[reportId]/ocr/route.test.ts`
  - Verify streamer/staff access and confirmation transitions.
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
  - Replace direct manual submit with upload -> OCR -> confirm -> submit review flow.
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
  - Cover success, low confidence/manual correction, provider failure/manual fallback.
- Modify: `components/reference-ui/ops-reference.jsx`
  - Keep existing OCR operations; optionally show linked report/task identifiers.
- Modify: `components/reference-ui/ops-reference.test.jsx`
  - Extend OCR job smoke to cover storage-backed jobs and safe output.
- Modify: `.env.example`
  - Add runner token and clarify Tencent OCR variables.
- Modify: `docs/product-usage-tutorial.md`
  - Replace "真实 OCR 接入后" wording with the actual operation path after implementation.

---

### Task 0: Baseline And Current-State Guard

**Files:**

- Read: `features/ai/ocr-jobs.ts`
- Read: `features/ai/providers/tencent-ocr-provider.ts`
- Read: `app/api/ocr/jobs/run/route.ts`
- Read: `features/live-operations/live-operations-service.ts`
- Read: `components/reference-ui/streamer-mobile-reference.jsx`

- [ ] **Step 1: Check worktree status**

Run:

```powershell
git status --short --branch
```

Expected: note existing unrelated user changes. Do not revert unrelated files.

- [ ] **Step 2: Run the current OCR tests**

Run:

```powershell
pnpm exec vitest run features/ai/providers/tencent-ocr-provider.test.ts features/ai/ocr-jobs.test.ts app/api/ocr/jobs/route.test.ts app/api/ocr/jobs/[jobId]/route.test.ts app/api/ocr/jobs/run/route.test.ts
```

Expected: PASS. If this fails, fix only OCR baseline breakage before continuing.

- [ ] **Step 3: Run the current live-report tests**

Run:

```powershell
pnpm exec vitest run features/live-operations/live-operations-service.test.ts app/api/live-tasks/[taskId]/reports/route.test.ts components/reference-ui/streamer-mobile-reference.test.jsx
```

Expected: PASS. If `app/api/live-tasks/[taskId]/reports/route.test.ts` does not exist, record that the route currently lacks direct route tests and continue with service/component tests.

---

### Task 1: Storage-Backed OCR Image Resolver

**Files:**

- Create: `features/ai/ocr-image-source.ts`
- Create: `features/ai/ocr-image-source.test.ts`
- Modify: `features/ai/ocr-jobs.ts`
- Test: `features/ai/ocr-jobs.test.ts`

- [ ] **Step 1: Write resolver tests**

Add `features/ai/ocr-image-source.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { resolveOcrImageInput } from "./ocr-image-source";

describe("resolveOcrImageInput", () => {
  it("keeps inline base64 input", async () => {
    await expect(
      resolveOcrImageInput({
        client: {} as never,
        payload: { liveReportId: "report-1", imageBase64: "ZmFrZQ==" },
        defaultBucket: "evidence-private",
      }),
    ).resolves.toEqual({ imageBase64: "ZmFrZQ==" });
  });

  it("keeps image URL input", async () => {
    await expect(
      resolveOcrImageInput({
        client: {} as never,
        payload: {
          liveReportId: "report-1",
          imageUrl: "https://example.com/a.png",
        },
        defaultBucket: "evidence-private",
      }),
    ).resolves.toEqual({ imageUrl: "https://example.com/a.png" });
  });

  it("downloads private storage object and converts it to base64", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const download = vi.fn(async () => ({ data: blob, error: null }));
    const from = vi.fn(() => ({ download }));

    const result = await resolveOcrImageInput({
      client: { storage: { from } } as never,
      payload: {
        liveReportId: "report-1",
        imageBucket: "evidence-private",
        imagePath: "org/report-screenshots/task-1/end.png",
      },
      defaultBucket: "fallback-bucket",
    });

    expect(from).toHaveBeenCalledWith("evidence-private");
    expect(download).toHaveBeenCalledWith(
      "org/report-screenshots/task-1/end.png",
    );
    expect(result).toEqual({ imageBase64: "AQID" });
  });

  it("requires at least one image source", async () => {
    await expect(
      resolveOcrImageInput({
        client: {} as never,
        payload: { liveReportId: "report-1" },
        defaultBucket: "evidence-private",
      }),
    ).rejects.toThrow("OCR job requires imageBase64, imageUrl, or imagePath");
  });
});
```

- [ ] **Step 2: Run resolver tests RED**

Run:

```powershell
pnpm exec vitest run features/ai/ocr-image-source.test.ts
```

Expected: FAIL because `features/ai/ocr-image-source.ts` does not exist.

- [ ] **Step 3: Implement resolver**

Create `features/ai/ocr-image-source.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { OcrJobPayload } from "./ocr-jobs";
import type { TencentOcrInput } from "./providers/tencent-ocr-provider";

export async function resolveOcrImageInput({
  client,
  payload,
  defaultBucket,
}: {
  client: Pick<SupabaseClient, "storage">;
  payload: Pick<
    OcrJobPayload,
    "imageBase64" | "imageUrl" | "imageBucket" | "imagePath" | "liveReportId"
  >;
  defaultBucket: string;
}): Promise<TencentOcrInput> {
  if (payload.imageBase64) {
    return { imageBase64: payload.imageBase64 };
  }

  if (payload.imageUrl) {
    return { imageUrl: payload.imageUrl };
  }

  if (!payload.imagePath) {
    throw new Error("OCR job requires imageBase64, imageUrl, or imagePath");
  }

  const bucket = payload.imageBucket || defaultBucket;
  const { data, error } = await client.storage
    .from(bucket)
    .download(payload.imagePath);
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("OCR image object was not found");
  }

  const bytes = Buffer.from(await data.arrayBuffer());
  return { imageBase64: bytes.toString("base64") };
}
```

- [ ] **Step 4: Extend `OcrJobPayload` and validation**

Modify `features/ai/ocr-jobs.ts`:

```ts
export type OcrJobPayload = {
  liveReportId: string;
  screenshotId?: string;
  imageBase64?: string;
  imageUrl?: string;
  imageBucket?: string;
  imagePath?: string;
  expectedDuration?: number;
};
```

Change create validation:

```ts
if (!input.imageBase64 && !input.imageUrl && !input.imagePath) {
  throw new Error("OCR job requires imageBase64, imageUrl, or imagePath");
}
```

Persist the new fields in `payload`:

```ts
const payload: OcrJobPayload = {
  liveReportId: input.liveReportId,
  screenshotId: input.screenshotId,
  imageBase64: input.imageBase64,
  imageUrl: input.imageUrl,
  imageBucket: input.imageBucket,
  imagePath: input.imagePath,
  expectedDuration: input.expectedDuration,
};
```

- [ ] **Step 5: Inject image resolver into job execution**

Modify `runOcrJobOnce` signature in `features/ai/ocr-jobs.ts`:

```ts
imageResolver = defaultOcrImageResolver,
```

and add the parameter type:

```ts
imageResolver?: (payload: OcrJobPayload) => Promise<TencentOcrInput>;
```

Replace direct provider input construction:

```ts
const providerResult = await provider.runGeneralBasicOcr(
  await imageResolver(job.payload),
);
```

Add default resolver near helpers:

```ts
async function defaultOcrImageResolver(
  payload: OcrJobPayload,
): Promise<TencentOcrInput> {
  if (payload.imageUrl) return { imageUrl: payload.imageUrl };
  if (payload.imageBase64) return { imageBase64: payload.imageBase64 };
  throw new Error("OCR job requires imageBase64, imageUrl, or imagePath");
}
```

- [ ] **Step 6: Add `ocr-jobs` regression tests**

In `features/ai/ocr-jobs.test.ts`, add:

```ts
it("runs OCR with an injected storage image resolver", async () => {
  const { client } = createClient({
    jobs: [
      {
        id: "job-storage",
        organizationId: "org-1",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        maxAttempts: 3,
        payload: {
          liveReportId: "report-storage",
          imageBucket: "evidence-private",
          imagePath: "org/report-screenshots/task/end.png",
          expectedDuration: 80,
        },
      },
    ],
  });
  const provider = {
    runGeneralBasicOcr: vi.fn(async () => ({
      status: "succeeded" as const,
      textLines: ["直播时长 80分钟", "观看人数 320"],
      confidence: 96,
      requestId: "request-storage",
      rawResponse: {},
    })),
  };

  const result = await runOcrJobOnce({
    client,
    actor,
    jobId: "job-storage",
    provider,
    imageResolver: vi.fn(async () => ({ imageBase64: "AQID" })),
  });

  expect(result.status).toBe("succeeded");
  expect(provider.runGeneralBasicOcr).toHaveBeenCalledWith({
    imageBase64: "AQID",
  });
});
```

- [ ] **Step 7: Run Task 1 tests GREEN**

Run:

```powershell
pnpm exec vitest run features/ai/ocr-image-source.test.ts features/ai/ocr-jobs.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

Run:

```powershell
git add features/ai/ocr-image-source.ts features/ai/ocr-image-source.test.ts features/ai/ocr-jobs.ts features/ai/ocr-jobs.test.ts
git commit -m "feat: support storage-backed OCR images"
```

---

### Task 2: OCR Runner Wiring

**Files:**

- Modify: `app/api/ocr/jobs/run/route.ts`
- Create: `app/api/internal/ocr/run/route.ts`
- Create: `app/api/internal/ocr/run/route.test.ts`
- Modify: `.env.example`
- Test: `app/api/ocr/jobs/run/route.test.ts`

- [ ] **Step 1: Wire manual runner to storage resolver**

Modify `app/api/ocr/jobs/run/route.ts`:

```ts
import { resolveOcrImageInput } from "@/features/ai/ocr-image-source";
```

In `runOcrJobOnce`, pass:

```ts
imageResolver: (payload) =>
  resolveOcrImageInput({
    client: supabase,
    payload,
    defaultBucket: process.env.SUPABASE_PRIVATE_BUCKET ?? "evidence-private",
  }),
```

- [ ] **Step 2: Add manual runner test for `imagePath` safety**

In `app/api/ocr/jobs/run/route.test.ts`, update the happy-path fixture payload:

```ts
payload: {
  liveReportId: "report-1",
  screenshotId: "screenshot-1",
  imageBucket: "evidence-private",
  imagePath: "org/report-screenshots/task-1/end.png",
},
```

Keep the assertion:

```ts
expect(JSON.stringify(body)).not.toContain("org/report-screenshots");
```

Expected: route response does not expose raw storage paths or image content.

- [ ] **Step 3: Add runner env docs**

Modify `.env.example`:

```env
OCR_RUNNER_TOKEN=
OCR_RUNNER_ORGANIZATION_ID=
OCR_RUNNER_USER_ID=
OCR_RUNNER_USER_NAME=OCR Runner
```

- [ ] **Step 4: Create internal runner route tests**

Create `app/api/internal/ocr/run/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { claimRunnableOcrJobs, runOcrJobOnce } from "@/features/ai/ocr-jobs";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ocr-jobs", () => ({
  claimRunnableOcrJobs: vi.fn(),
  runOcrJobOnce: vi.fn(),
}));

vi.mock("@/features/ai/providers/tencent-ocr-provider", () => ({
  createTencentOcrProvider: vi.fn(() => ({ runGeneralBasicOcr: vi.fn() })),
  readTencentOcrConfigFromEnv: vi.fn(() => ({})),
}));

vi.mock("@/features/ai/ocr-image-source", () => ({
  resolveOcrImageInput: vi.fn(async () => ({ imageBase64: "AQID" })),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

describe("/api/internal/ocr/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OCR_RUNNER_TOKEN = "runner-token";
    process.env.OCR_RUNNER_ORGANIZATION_ID = "org-1";
    process.env.OCR_RUNNER_USER_ID = "user-runner";
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn(),
      storage: { from: vi.fn() },
    } as never);
  });

  it("rejects missing runner token", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });

  it("runs claimed jobs with a system runner actor", async () => {
    vi.mocked(claimRunnableOcrJobs).mockResolvedValue([
      {
        id: "job-1",
        organizationId: "org-1",
        jobType: "ocr.extract_live_report",
        status: "running",
        attempt: 0,
        payload: { liveReportId: "report-1", imagePath: "private/path.png" },
      },
    ]);
    vi.mocked(runOcrJobOnce).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "succeeded",
      attempt: 1,
      payload: { liveReportId: "report-1", imagePath: "private/path.png" },
    });

    const response = await POST(
      new Request("http://localhost/api/internal/ocr/run", {
        method: "POST",
        headers: { authorization: "Bearer runner-token" },
        body: JSON.stringify({ limit: 1 }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobs).toEqual([
      { id: "job-1", status: "succeeded", attempt: 1 },
    ]);
    expect(JSON.stringify(body)).not.toContain("private/path.png");
  });
});
```

- [ ] **Step 5: Implement internal runner route**

Create `app/api/internal/ocr/run/route.ts`:

```ts
import { NextResponse } from "next/server";

import { resolveOcrImageInput } from "@/features/ai/ocr-image-source";
import { claimRunnableOcrJobs, runOcrJobOnce } from "@/features/ai/ocr-jobs";
import {
  createTencentOcrProvider,
  readTencentOcrConfigFromEnv,
} from "@/features/ai/providers/tencent-ocr-provider";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

export async function POST(request: Request) {
  const expected = process.env.OCR_RUNNER_TOKEN;
  const actual = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!expected || actual !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin client is unavailable" },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { limit?: unknown };
  const organizationId = process.env.OCR_RUNNER_ORGANIZATION_ID;
  const userId = process.env.OCR_RUNNER_USER_ID;
  if (!organizationId || !userId) {
    return NextResponse.json(
      { error: "OCR runner organization and user are not configured" },
      { status: 500 },
    );
  }

  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit)
      ? Math.max(1, Math.min(Math.trunc(body.limit), 10))
      : 5;
  const actor = {
    userId,
    name: process.env.OCR_RUNNER_USER_NAME || "OCR Runner",
    role: "ops_manager" as const,
    organizationId,
  };
  const provider = createTencentOcrProvider(
    readTencentOcrConfigFromEnv(process.env),
  );
  const jobs = await claimRunnableOcrJobs({
    client: supabase as never,
    organizationId,
    runnerId: userId,
    limit,
  });

  const completed = [];
  const failures = [];
  for (const job of jobs) {
    try {
      const result = await runOcrJobOnce({
        client: supabase as never,
        actor,
        jobId: job.id,
        provider,
        runnerId: userId,
        imageResolver: (payload) =>
          resolveOcrImageInput({
            client: supabase,
            payload,
            defaultBucket:
              process.env.SUPABASE_PRIVATE_BUCKET ?? "evidence-private",
          }),
      });
      completed.push({
        id: result.id,
        status: result.status,
        attempt: result.attempt,
      });
    } catch (error) {
      failures.push({
        jobId: job.id,
        error:
          error instanceof Error
            ? error.message.slice(0, 160)
            : "OCR runner failed",
      });
    }
  }

  return NextResponse.json({ jobs: completed, failures });
}
```

- [ ] **Step 6: Run Task 2 tests GREEN**

Run:

```powershell
pnpm exec vitest run app/api/ocr/jobs/run/route.test.ts app/api/internal/ocr/run/route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```powershell
git add .env.example app/api/ocr/jobs/run/route.ts app/api/ocr/jobs/run/route.test.ts app/api/internal/ocr/run
git commit -m "feat: add OCR runner endpoint"
```

---

### Task 3: Live Report OCR Submission Service

**Files:**

- Modify: `features/live-operations/live-operations-service.ts`
- Modify: `features/live-operations/live-operations-service.test.ts`

- [ ] **Step 1: Add failing service test for OCR submission**

In `features/live-operations/live-operations-service.test.ts`, add a test with a fake repo proving:

```ts
const result = await submitLiveReportScreenshotForOcr({
  repo,
  audit,
  notify,
  actor: streamerActor,
  taskId: "task-1",
  input: {
    screenshotStoragePath: "org/report-screenshots/task-1/end.png",
    screenshotFileHash: "hash-1",
    imageBucket: "evidence-private",
  },
  createOcrJob: vi.fn(async () => ({
    id: "ocr-job-1",
    organizationId: "org-1",
    jobType: "ocr.extract_live_report",
    status: "queued",
    attempt: 0,
    payload: {
      liveReportId: "report-1",
      imagePath: "org/report-screenshots/task-1/end.png",
    },
  })),
});

expect(result.report.status).toBe("ocr_ing");
expect(result.job.id).toBe("ocr-job-1");
expect(repo.createLiveReport).toHaveBeenCalledWith(
  expect.objectContaining({
    status: "ocr_ing",
    settlementDuration: 80,
    timeSource: "system",
    evidenceLevel: "yellow",
    riskFlags: expect.arrayContaining([
      "missing_screenshot_duration",
      "ocr_pending",
    ]),
  }),
);
```

- [ ] **Step 2: Run service test RED**

Run:

```powershell
pnpm exec vitest run features/live-operations/live-operations-service.test.ts -t "OCR"
```

Expected: FAIL because `submitLiveReportScreenshotForOcr` does not exist.

- [ ] **Step 3: Implement `submitLiveReportScreenshotForOcr`**

Add to `features/live-operations/live-operations-service.ts`:

```ts
export async function submitLiveReportScreenshotForOcr({
  repo,
  audit,
  notify,
  actor,
  taskId,
  input,
  createOcrJob,
}: {
  repo: LiveOperationsRepository;
  audit: LiveOperationsAuditWriter;
  notify: LiveOperationsNotifier;
  actor: LiveOperationsActor;
  taskId: string;
  input: {
    screenshotStoragePath: string;
    screenshotFileHash: string;
    imageBucket?: string;
  };
  createOcrJob: (input: {
    liveReportId: string;
    screenshotId?: string;
    imageBucket?: string;
    imagePath: string;
    expectedDuration?: number;
  }) => Promise<{ id: string; status: string }>;
}): Promise<{ report: LiveReportRecord; job: { id: string; status: string } }> {
  const task = await requireLiveTask(repo, taskId);
  assertCanOperateTask(actor, task);
  if (!["pending_report", "report_rejected"].includes(task.status)) {
    throw new Error(
      "OCR reports can only be submitted from pending report tasks",
    );
  }
  if (!task.systemDuration || task.systemDuration <= 0) {
    throw new Error("OCR report requires a recorded system duration");
  }

  const evidence = resolveReportEvidence({
    systemDuration: task.systemDuration,
    screenshotDuration: null,
    claimedDuration: null,
  });
  const report = await repo.createLiveReport({
    organizationId: actor.organizationId,
    liveTaskId: task.id,
    projectId: requireProjectId(task),
    streamerId: task.streamerId,
    status: "ocr_ing",
    systemDuration: task.systemDuration,
    screenshotDuration: null,
    claimedDuration: null,
    settlementDuration: evidence.settlementDuration,
    timeSource: evidence.timeSource,
    evidenceLevel: evidence.evidenceLevel,
    divergencePct: evidence.divergencePct,
    viewers: null,
    riskFlags: [...evidence.riskFlags, "ocr_pending"],
    createdBy: actor.userId,
  });

  await repo.createReportScreenshot({
    organizationId: actor.organizationId,
    liveReportId: report.id,
    projectId: report.projectId,
    streamerId: report.streamerId,
    storagePath: input.screenshotStoragePath,
    fileHash: input.screenshotFileHash,
    uploadedBy: actor.userId,
    metadata: { imageBucket: input.imageBucket },
  });

  assertLiveTaskTransition(task.status, "report_pending_review");
  await repo.updateLiveTask(task.id, { status: "report_pending_review" });

  const job = await createOcrJob({
    liveReportId: report.id,
    imageBucket: input.imageBucket,
    imagePath: input.screenshotStoragePath,
    expectedDuration: task.systemDuration,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "live_report",
    objectType: "live_report",
    objectId: report.id,
    projectId: report.projectId,
    streamerId: report.streamerId,
    after: { status: "ocr_ing", ocrJobId: job.id },
    changedFields: ["status", "ocr_job"],
  });

  await notify({
    organizationId: actor.organizationId,
    recipientRole: "operator_business",
    type: "review",
    title: "Live report OCR queued",
    content: `${task.title} has a screenshot waiting for OCR.`,
    objectType: "live_report",
    objectId: report.id,
    source: "live_report.ocr.submit",
  });

  return { report, job };
}
```

- [ ] **Step 4: Run service tests GREEN**

Run:

```powershell
pnpm exec vitest run features/live-operations/live-operations-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add features/live-operations/live-operations-service.ts features/live-operations/live-operations-service.test.ts
git commit -m "feat: queue OCR from live report screenshots"
```

---

### Task 4: Live Report OCR Confirmation Service

**Files:**

- Modify: `features/live-operations/live-operations-service.ts`
- Modify: `features/live-operations/live-operations-service.test.ts`

- [ ] **Step 1: Add failing confirmation test**

In `features/live-operations/live-operations-service.test.ts`, add:

```ts
const result = await confirmLiveReportOcrResult({
  repo,
  audit,
  notify,
  actor: streamerActor,
  reportId: "report-1",
  input: {
    ocrDuration: 78,
    ocrViewers: 300,
    confirmedDuration: 80,
    confirmedViewers: 320,
  },
});

expect(result.status).toBe("pending_review");
expect(repo.updateLiveReport).toHaveBeenCalledWith(
  "report-1",
  expect.objectContaining({
    status: "pending_review",
    screenshotDuration: 78,
    claimedDuration: 80,
    viewers: 320,
    riskFlags: expect.arrayContaining(["duration_divergence"]),
  }),
);
```

- [ ] **Step 2: Run confirmation test RED**

Run:

```powershell
pnpm exec vitest run features/live-operations/live-operations-service.test.ts -t "confirmLiveReportOcrResult"
```

Expected: FAIL because `confirmLiveReportOcrResult` does not exist.

- [ ] **Step 3: Implement `confirmLiveReportOcrResult`**

Add to `features/live-operations/live-operations-service.ts`:

```ts
export async function confirmLiveReportOcrResult({
  repo,
  audit,
  notify,
  actor,
  reportId,
  input,
}: {
  repo: LiveOperationsRepository;
  audit: LiveOperationsAuditWriter;
  notify: LiveOperationsNotifier;
  actor: LiveOperationsActor;
  reportId: string;
  input: {
    ocrDuration?: number | null;
    ocrViewers?: number | null;
    confirmedDuration: number;
    confirmedViewers?: number | null;
    note?: string;
  };
}): Promise<LiveReportRecord> {
  const before = await requireLiveReport(repo, reportId);
  assertSameOrganization(actor, before.organizationId);
  if (actor.role === "streamer" && actor.streamerId !== before.streamerId) {
    throw new Error("Streamers can only confirm their own reports");
  }
  if (!["ocr_ing", "pending_confirm", "need_more"].includes(before.status)) {
    throw new Error("Only OCR pending reports can be confirmed");
  }

  const screenshotDuration = input.ocrDuration ?? input.confirmedDuration;
  const evidence = resolveReportEvidence({
    systemDuration: before.systemDuration,
    screenshotDuration,
    claimedDuration: input.confirmedDuration,
  });
  const confirmed = await repo.updateLiveReport(reportId, {
    status: "pending_review",
    screenshotDuration,
    claimedDuration: input.confirmedDuration,
    settlementDuration: evidence.settlementDuration,
    timeSource: evidence.timeSource,
    evidenceLevel: evidence.evidenceLevel,
    divergencePct: evidence.divergencePct,
    viewers: input.confirmedViewers ?? input.ocrViewers ?? before.viewers,
    riskFlags: evidence.riskFlags,
  });

  await repo.createReportChangeLog({
    organizationId: actor.organizationId,
    liveReportId: reportId,
    changedBy: actor.userId,
    before: before as unknown as Record<string, unknown>,
    after: confirmed as unknown as Record<string, unknown>,
    changedFields: [
      "status",
      "screenshot_duration",
      "claimed_duration",
      "viewers",
      "risk_flags",
    ],
    reason: input.note,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "live_report",
    objectType: "live_report",
    objectId: reportId,
    projectId: before.projectId,
    streamerId: before.streamerId,
    before: before as unknown as Record<string, unknown>,
    after: confirmed as unknown as Record<string, unknown>,
    changedFields: [
      "status",
      "screenshot_duration",
      "claimed_duration",
      "viewers",
    ],
    reason: input.note,
  });

  await notify({
    organizationId: actor.organizationId,
    recipientRole: "operator_business",
    type: "review",
    title: "Live report pending review",
    content: "A streamer confirmed OCR report values.",
    objectType: "live_report",
    objectId: reportId,
    source: "live_report.ocr.confirm",
  });

  return confirmed;
}
```

- [ ] **Step 4: Run confirmation tests GREEN**

Run:

```powershell
pnpm exec vitest run features/live-operations/live-operations-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```powershell
git add features/live-operations/live-operations-service.ts features/live-operations/live-operations-service.test.ts
git commit -m "feat: confirm OCR report values"
```

---

### Task 5: OCR Product APIs

**Files:**

- Create: `app/api/live-tasks/[taskId]/ocr/route.ts`
- Create: `app/api/live-tasks/[taskId]/ocr/route.test.ts`
- Create: `app/api/live-reports/[reportId]/ocr/route.ts`
- Create: `app/api/live-reports/[reportId]/ocr/route.test.ts`

- [ ] **Step 1: Create task OCR route tests**

Create `app/api/live-tasks/[taskId]/ocr/route.test.ts` with tests for:

```ts
expect(response.status).toBe(201);
expect(body).toMatchObject({
  report: { id: "report-1", status: "ocr_ing" },
  job: { id: "ocr-job-1", status: "queued" },
});
expect(JSON.stringify(body)).not.toContain("imageBase64");
```

Also test:

```ts
expect(streamerFromOtherAccountResponse.status).toBe(403);
expect(missingScreenshotResponse.status).toBe(400);
```

- [ ] **Step 2: Implement task OCR route**

Create `app/api/live-tasks/[taskId]/ocr/route.ts`:

```ts
import { NextResponse } from "next/server";

import { createOcrJob } from "@/features/ai/ocr-jobs";
import {
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
  optionalString,
  readJsonBody,
  requiredString,
} from "@/features/live-operations/live-operations-route-utils";
import { submitLiveReportScreenshotForOcr } from "@/features/live-operations/live-operations-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await readJsonBody(request);
    const context = await getLiveOperationsRouteContext();
    const result = await submitLiveReportScreenshotForOcr({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: await actorFromContext(context, true),
      taskId,
      input: {
        screenshotStoragePath: requiredString(body, "screenshotStoragePath"),
        screenshotFileHash: requiredString(body, "screenshotFileHash"),
        imageBucket: optionalString(body, "imageBucket"),
      },
      createOcrJob: (input) =>
        createOcrJob({
          client: context.supabase as never,
          actor: context.auth,
          input: {
            liveReportId: input.liveReportId,
            screenshotId: input.screenshotId,
            imageBucket: input.imageBucket,
            imagePath: input.imagePath,
            expectedDuration: input.expectedDuration,
          },
        }),
    });

    return NextResponse.json(
      {
        report: result.report,
        job: { id: result.job.id, status: result.job.status },
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
```

- [ ] **Step 3: Create report OCR route tests**

Create `app/api/live-reports/[reportId]/ocr/route.test.ts` with tests for:

```ts
expect(confirmResponse.status).toBe(200);
expect(body.report).toMatchObject({
  id: "report-1",
  status: "pending_review",
  screenshotDuration: 78,
  claimedDuration: 80,
  viewers: 320,
});
```

And access denial:

```ts
expect(otherStreamerResponse.status).toBe(403);
```

- [ ] **Step 4: Implement report OCR route**

Create `app/api/live-reports/[reportId]/ocr/route.ts`:

```ts
import { NextResponse } from "next/server";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
  optionalNumber,
  optionalString,
  readJsonBody,
} from "@/features/live-operations/live-operations-route-utils";
import { confirmLiveReportOcrResult } from "@/features/live-operations/live-operations-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  try {
    const { reportId } = await params;
    const body = await readJsonBody(request);
    const context = await getLiveOperationsRouteContext();
    const confirmedDuration = optionalNumber(body, "confirmedDuration");
    if (confirmedDuration === undefined) {
      return NextResponse.json(
        { error: "confirmedDuration is required" },
        { status: 400 },
      );
    }

    const report = await confirmLiveReportOcrResult({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: await actorFromContext(context, true),
      reportId,
      input: {
        ocrDuration: optionalNumber(body, "ocrDuration"),
        ocrViewers: optionalNumber(body, "ocrViewers"),
        confirmedDuration,
        confirmedViewers: optionalNumber(body, "confirmedViewers"),
        note: optionalString(body, "note"),
      },
    });

    return NextResponse.json({ report });
  } catch (error) {
    return jsonError(error);
  }
}
```

- [ ] **Step 5: Run Task 5 tests GREEN**

Run:

```powershell
pnpm exec vitest run app/api/live-tasks/[taskId]/ocr/route.test.ts app/api/live-reports/[reportId]/ocr/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```powershell
git add app/api/live-tasks/[taskId]/ocr app/api/live-reports/[reportId]/ocr
git commit -m "feat: expose live report OCR APIs"
```

---

### Task 6: Streamer Mobile OCR Flow

**Files:**

- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`

- [ ] **Step 1: Add component tests for the new flow**

In `components/reference-ui/streamer-mobile-reference.test.jsx`, add a smoke test that clicks report submission and expects:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "/api/uploads/signed",
  expect.objectContaining({ method: "POST" }),
);
expect(fetchMock).toHaveBeenCalledWith(
  "/api/live-tasks/task-1/ocr",
  expect.objectContaining({ method: "POST" }),
);
expect(fetchMock).toHaveBeenCalledWith(
  "/api/live-reports/report-1/ocr",
  expect.objectContaining({ method: "POST" }),
);
```

Add a second test where `/api/live-tasks/task-1/ocr` returns `provider_unconfigured`; expect the manual fallback submit to still call:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "/api/live-tasks/task-1/reports",
  expect.objectContaining({ method: "POST" }),
);
```

- [ ] **Step 2: Split `submitReport` into OCR and fallback paths**

In `components/reference-ui/streamer-mobile-reference.jsx`, change the action implementation from direct `/reports` only to:

```js
submitReport: async (id, input) => {
  const durationHours = Number(input.durationHours || 0);
  const audience = Number(input.audience || 0);
  const signed = await fetchJson(
    "/api/uploads/signed",
    "create report screenshot upload failed",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "report-screenshots",
        ownerId: id,
        fileName: "manual-submit.png",
      }),
    },
  );

  try {
    const queued = await fetchJson(
      `/api/live-tasks/${id}/ocr`,
      "create OCR report failed",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenshotStoragePath: signed.path,
          screenshotFileHash: `manual-${id}-${Date.now()}`,
          imageBucket: signed.bucket,
        }),
      },
    );

    await fetchJson(
      `/api/live-reports/${queued.report.id}/ocr`,
      "confirm OCR report failed",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ocrDuration: queued.job?.result?.extractedDuration,
          ocrViewers: queued.job?.result?.extractedViewers,
          confirmedDuration: Math.round(durationHours * 60),
          confirmedViewers: audience,
          note: input.note,
        }),
      },
    );
  } catch (error) {
    await fetchJson(
      `/api/live-tasks/${id}/reports`,
      "submit report failed",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenshotStoragePath: signed.path,
          screenshotFileHash: `manual-${id}-${Date.now()}`,
          screenshotDuration: Math.round(durationHours * 60),
          claimedDuration: Math.round(durationHours * 60),
          viewers: audience,
        }),
      },
    );
  }

  await refreshTasks();
},
```

- [ ] **Step 3: Run component tests GREEN**

Run:

```powershell
pnpm exec vitest run components/reference-ui/streamer-mobile-reference.test.jsx
```

Expected: PASS.

- [ ] **Step 4: Commit Task 6**

Run:

```powershell
git add components/reference-ui/streamer-mobile-reference.jsx components/reference-ui/streamer-mobile-reference.test.jsx
git commit -m "feat: wire streamer report OCR flow"
```

---

### Task 7: Ops Visibility And Docs

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `docs/product-usage-tutorial.md`

- [ ] **Step 1: Keep OCR panel safe**

In `components/reference-ui/ops-reference.test.jsx`, extend the OCR smoke assertion:

```ts
expect(
  JSON.stringify(screen.queryByText("org/report-screenshots")),
).not.toContain("org/report-screenshots");
expect(screen.getByText("ocr-job-1")).toBeInTheDocument();
```

- [ ] **Step 2: Show linked report and retry status only**

In `components/reference-ui/ops-reference.jsx`, keep the current `/api/ocr/jobs` calls and ensure the table only renders:

```js
job.id;
job.status;
job.attempt;
job.maxAttempts;
job.liveReportId;
job.screenshotId;
job.errorCode;
job.errorMessage;
job.result?.extractedDuration;
job.result?.extractedViewers;
```

Do not render:

```js
job.payload?.imageBase64;
job.payload?.imagePath;
job.rawResponse;
```

- [ ] **Step 3: Update user tutorial wording**

In `docs/product-usage-tutorial.md`, replace the section titled `### 8.4 当前只差真实 OCR 接入时怎么用` with a live-flow section:

```markdown
### 8.4 OCR 失败时怎么用

如果截图上传后没有自动识别结果，主播仍然可以手动填写直播时长和场观后提交。运营可以在“真实 OCR 作业”里查看失败原因、手动重试，或改走人工核对截图流程。不要让结算无限等待 OCR 队列。
```

- [ ] **Step 4: Run UI/doc checks**

Run:

```powershell
pnpm exec vitest run components/reference-ui/ops-reference.test.jsx components/reference-ui/streamer-mobile-reference.test.jsx
pnpm format:check
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

Run:

```powershell
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx docs/product-usage-tutorial.md
git commit -m "docs: document real OCR operations"
```

---

### Task 8: End-To-End Verification And Release Gates

**Files:**

- Read: `package.json`
- Read: `.env.example`
- Read: `docs/product-usage-tutorial.md`

- [ ] **Step 1: Run targeted OCR and live-report tests**

Run:

```powershell
pnpm exec vitest run features/ai/ocr-image-source.test.ts features/ai/providers/tencent-ocr-provider.test.ts features/ai/ocr-jobs.test.ts app/api/ocr/jobs/run/route.test.ts app/api/internal/ocr/run/route.test.ts app/api/live-tasks/[taskId]/ocr/route.test.ts app/api/live-reports/[reportId]/ocr/route.test.ts features/live-operations/live-operations-service.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run product UI tests**

Run:

```powershell
pnpm exec vitest run components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/ops-reference.test.jsx
```

Expected: PASS.

- [ ] **Step 3: Run the repo verification chain**

Run:

```powershell
pnpm format:check
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected: all PASS. If `pnpm build` emits the known `components/reference-ui/ops-reference.jsx` Babel deopt warning only, record it as expected and continue.

- [ ] **Step 4: Run env-gated real Tencent OCR smoke**

With real Tencent env configured:

```powershell
pnpm exec vitest run features/ai/providers/tencent-ocr-provider.test.ts -t "real Tencent OCR"
```

Expected with real env: PASS and output does not contain `TENCENT_SECRET_KEY`.
Expected without real env: test is SKIP.

- [ ] **Step 5: Manual acceptance**

Use a local/staging account:

```text
1. Ops creates a project and live task.
2. Streamer starts and stops the task.
3. Streamer uploads a report screenshot.
4. `/api/live-tasks/{taskId}/ocr` returns a report id and OCR job id.
5. Runner calls `/api/internal/ocr/run`.
6. OCR job becomes `succeeded` or `needs_confirmation`.
7. Streamer confirms/corrects values.
8. Report appears in ops review as `pending_review`.
9. Ops approves report.
10. Report enters settlement pool.
```

Expected: OCR raw image/base64/path is never visible in streamer or ops JSON responses.

- [ ] **Step 6: Final commit or PR**

Run:

```powershell
git status --short
git log --oneline -5
```

Expected: only intentional OCR commits are present. Prepare PR summary:

```markdown
## Summary

- wired storage-backed OCR image resolution for Tencent OCR jobs
- added automatic report screenshot OCR submission and confirmation APIs
- added token-protected OCR runner endpoint and streamer mobile OCR flow

## Verification

- pnpm format:check
- pnpm type-check
- pnpm lint
- pnpm test
- pnpm build
```

---

## Rollout Checklist

- [ ] Tencent Cloud OCR service enabled.
- [ ] `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, and `TENCENT_OCR_REGION` configured in staging.
- [ ] `SUPABASE_PRIVATE_BUCKET` exists and is private.
- [ ] `OCR_RUNNER_TOKEN`, `OCR_RUNNER_ORGANIZATION_ID`, and `OCR_RUNNER_USER_ID` configured.
- [ ] Cron calls `POST /api/internal/ocr/run` every 1 minute with `Authorization: Bearer <OCR_RUNNER_TOKEN>`.
- [ ] Alerts/logs monitor `provider_unconfigured`, `provider_failed`, and jobs stuck in `running` longer than the lock timeout.
- [ ] Ops has a documented fallback: retry OCR, mark needs review, or process report manually.

## Self-Review

- Spec coverage: The plan covers provider configuration, private image loading, automatic job creation, runner execution, streamer confirmation, ops visibility, docs, and verification.
- Placeholder scan: No `TBD`, `TODO`, or undefined "handle later" steps remain.
- Type consistency: The new payload fields are consistently named `imageBucket` and `imagePath`; report confirmation uses `confirmedDuration`, `confirmedViewers`, `ocrDuration`, and `ocrViewers`; runner configuration uses `OCR_RUNNER_*`.
