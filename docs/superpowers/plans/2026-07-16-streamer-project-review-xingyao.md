# Streamer Project Xingyao Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first backend slice for streamer-project review: richer OCR metric extraction, persisted OCR metric candidates, streamer-project profile aggregation, and a read-only Xingyao AI tool.

**Architecture:** Keep the first implementation backend-only and deterministic. Extend the existing OCR parser/job path to extract candidate operational metrics without auto-confirming them, then add a pure streamer-project profile builder that aggregates schedule/live-report/recording rows into a source-backed review DTO. Register a read-only AI tool that summarizes a preloaded profile while preserving human-confirmed boundaries.

**Tech Stack:** TypeScript, Vitest, Next.js App Router conventions, existing AI tool layer, existing OCR jobs and live/recording domain types.

---

## Scope And Sequencing

This plan implements the smallest useful backend slice of the design. It does not add UI, new database tables, automatic scheduling changes, automatic report review, or automatic recording review.

The first shippable path is:

```text
Tencent OCR text/items
-> parse candidate live evidence and operational metrics
-> persist candidates inside OCR raw_result/job result
-> build streamer-project profile from existing task/report/recording rows
-> expose deterministic Xingyao AI tool for profile summary
```

## File Structure

Modify:

- `features/ai/ocr-template-parser.ts`  
  Extend `parseLiveReportOcrText` to return date/time candidates and operational metric candidates.
- `features/ai/ocr-template-parser.test.ts`  
  Add tests for start/end time, PCU, ACU, split label/value metrics, and low-confidence candidate behavior.
- `features/ai/ocr-jobs.ts`  
  Store parsed `metricCandidates`, `extractedStartedAt`, `extractedEndedAt`, and `extractedDate` in `ocr_results.raw_result` and background job `result`. Do not write PCU/ACU directly to `live_reports`.
- `features/ai/ocr-jobs.test.ts`  
  Verify OCR jobs persist metric candidates without auto-confirming them.
- `features/ai/ai-tool-layer.ts`  
  Register read-only `streamer_project_review` tool using the profile builder.

Create:

- `features/streamers/streamer-project-review.ts`  
  Pure aggregation for streamer + project profile, including participation period, fulfillment, live metrics, recording stats, caveats, facts, and recommendations.
- `features/streamers/streamer-project-review.test.ts`  
  TDD coverage for schedule-driven period, effective days, recording adoption/rejection reasons, live metrics, and missing-data caveats.

## Task 1: Extend OCR Metric Parsing

**Files:**

- Modify: `features/ai/ocr-template-parser.ts`
- Test: `features/ai/ocr-template-parser.test.ts`

- [ ] **Step 1: Write failing parser tests**

Add tests to `features/ai/ocr-template-parser.test.ts`:

```ts
it("extracts date, start/end time, PCU and ACU from a single-stream recap", () => {
  expect(
    parseLiveReportOcrText([
      "直播日期 2026-07-16",
      "开播时间 09:29",
      "下播时间 12:30",
      "场观 2,488",
      "PCU 320",
      "ACU 86",
    ]),
  ).toMatchObject({
    status: "trusted",
    extractedDate: "2026-07-16",
    extractedStartedAt: "09:29",
    extractedEndedAt: "12:30",
    extractedDuration: 181,
    extractedViewers: 2488,
    metricCandidates: expect.arrayContaining([
      expect.objectContaining({ key: "pcu", value: 320 }),
      expect.objectContaining({ key: "acu", value: 86 }),
      expect.objectContaining({ key: "viewers", value: 2488 }),
    ]),
  });
});

it("pairs stacked operational metric labels with nearby values", () => {
  expect(
    parseLiveReportOcrText(["峰值在线", "平均在线", "1,280", "430"], {
      items: [
        { text: "峰值在线", x: 100, y: 100, width: 80, height: 20 },
        { text: "平均在线", x: 240, y: 100, width: 80, height: 20 },
        { text: "1,280", x: 100, y: 130, width: 60, height: 24 },
        { text: "430", x: 240, y: 130, width: 50, height: 24 },
      ],
    }),
  ).toMatchObject({
    metricCandidates: expect.arrayContaining([
      expect.objectContaining({ key: "pcu", value: 1280 }),
      expect.objectContaining({ key: "acu", value: 430 }),
    ]),
  });
});
```

- [ ] **Step 2: Verify parser tests fail**

Run:

```bash
corepack pnpm test features/ai/ocr-template-parser.test.ts --testNamePattern "PCU|stacked operational"
```

Expected: FAIL because `extractedDate`, `extractedStartedAt`, `extractedEndedAt`, and `metricCandidates` are not returned yet.

- [ ] **Step 3: Implement parser extension**

Update `features/ai/ocr-template-parser.ts` by adding fields to `LiveReportOcrParseResult`:

```ts
  extractedDate: string | null;
  extractedStartedAt: string | null;
  extractedEndedAt: string | null;
  metricCandidates: LiveReportOcrMetricCandidate[];
```

Add `LiveReportOcrMetricCandidate`:

```ts
export type LiveReportOcrMetricKey =
  | "viewers"
  | "pcu"
  | "acu"
  | "exposure"
  | "clicks"
  | "interactions"
  | "comments"
  | "likes"
  | "shares"
  | "follows"
  | "gmv";

export type LiveReportOcrMetricCandidate = {
  key: LiveReportOcrMetricKey;
  label: string;
  value: number;
  sourceText: string;
  confidence: number;
  x?: number;
  y?: number;
};
```

Implement helpers:

```ts
function extractDate(lines: string[]): string | null
function extractTimeEvidence(lines: string[]): { startedAt: string | null; endedAt: string | null; duration: number | null }
function extractMetricCandidates(lines: string[], items?: OcrTextItem[]): LiveReportOcrMetricCandidate[]
```

Use existing duration parsing as the fallback. Deduplicate candidates by `key`, preferring the first positive value with the strongest source text.

- [ ] **Step 4: Verify parser tests pass**

Run:

```bash
corepack pnpm test features/ai/ocr-template-parser.test.ts
```

Expected: PASS.

## Task 2: Persist OCR Candidate Metrics Without Auto-Confirming Them

**Files:**

- Modify: `features/ai/ocr-jobs.ts`
- Test: `features/ai/ocr-jobs.test.ts`

- [ ] **Step 1: Write failing OCR job test**

Add a test to `features/ai/ocr-jobs.test.ts`:

```ts
it("stores operational metric candidates in raw OCR result without writing them to live reports", async () => {
  const { client, updates } = createClient({
    jobs: [
      {
        id: "job-metrics",
        organizationId: "org-1",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        aiInvocationId: "invocation-metrics",
        payload: {
          liveReportId: "report-metrics",
          imageBase64: "ZmFrZQ==",
          expectedDuration: 181,
        },
      },
    ],
  });

  await runOcrJobOnce({
    client,
    actor,
    jobId: "job-metrics",
    provider: {
      runGeneralBasicOcr: vi.fn(async () => ({
        status: "succeeded" as const,
        textLines: [
          "直播日期 2026-07-16",
          "开播时间 09:29",
          "下播时间 12:30",
          "场观 2,488",
          "PCU 320",
          "ACU 86",
        ],
        textItems: [],
        confidence: 96,
        requestId: "request-metrics",
        rawResponse: { Response: { RequestId: "request-metrics" } },
      })),
    },
  });

  expect(updates.ocr_results).toEqual([
    expect.objectContaining({
      payload: expect.objectContaining({
        raw_result: expect.objectContaining({
          extractedDate: "2026-07-16",
          extractedStartedAt: "09:29",
          extractedEndedAt: "12:30",
          metricCandidates: expect.arrayContaining([
            expect.objectContaining({ key: "pcu", value: 320 }),
            expect.objectContaining({ key: "acu", value: 86 }),
          ]),
        }),
      }),
    }),
  ]);
  expect(updates.live_reports.at(-1)?.payload).not.toHaveProperty("pcu");
  expect(updates.live_reports.at(-1)?.payload).not.toHaveProperty("acu");
});
```

- [ ] **Step 2: Verify OCR job test fails**

Run:

```bash
corepack pnpm test features/ai/ocr-jobs.test.ts --testNamePattern "operational metric candidates"
```

Expected: FAIL because OCR job raw result does not yet include the new candidate fields.

- [ ] **Step 3: Persist candidate fields**

In `runOcrJobOnce`, add the parser fields into `raw_result`:

```ts
raw_result: {
  textLines: providerResult.textLines,
  requestId: providerResult.requestId,
  parseReasons: reasons,
  extractedDate: parsed.extractedDate,
  extractedStartedAt: parsed.extractedStartedAt,
  extractedEndedAt: parsed.extractedEndedAt,
  metricCandidates: parsed.metricCandidates,
},
```

Add the same fields to the job `result` object. Do not update `live_reports` with PCU/ACU or other operational metric columns.

- [ ] **Step 4: Verify OCR job tests pass**

Run:

```bash
corepack pnpm test features/ai/ocr-jobs.test.ts
```

Expected: PASS.

## Task 3: Add Streamer Project Review Profile Builder

**Files:**

- Create: `features/streamers/streamer-project-review.ts`
- Test: `features/streamers/streamer-project-review.test.ts`

- [ ] **Step 1: Write failing profile tests**

Create `features/streamers/streamer-project-review.test.ts` with tests that call:

```ts
buildStreamerProjectReviewProfile({
  streamer: { id: "streamer-1", displayName: "阿星" },
  project: { id: "project-1", name: "传奇复古", productType: "legend" },
  tasks: [
    { id: "task-1", plannedStartAt: "2026-07-01T10:00:00.000Z", plannedEndAt: "2026-07-01T12:00:00.000Z", status: "completed", systemDuration: 120 },
    { id: "task-2", plannedStartAt: "2026-07-03T10:00:00.000Z", plannedEndAt: "2026-07-03T12:00:00.000Z", status: "completed", systemDuration: 110 },
    { id: "task-3", plannedStartAt: "2026-07-05T10:00:00.000Z", plannedEndAt: "2026-07-05T12:00:00.000Z", status: "cancelled", systemDuration: 0 },
  ],
  reports: [
    { id: "report-1", taskId: "task-1", status: "approved", settlementDuration: 120, viewers: 2400, pcu: 320, acu: 90, evidenceLevel: "green", riskFlags: [] },
    { id: "report-2", taskId: "task-2", status: "pending_review", settlementDuration: 110, viewers: 1800, pcu: 260, acu: 70, evidenceLevel: "yellow", riskFlags: ["duration_divergence"] },
  ],
  recordings: [
    { id: "rec-1", status: "approved", adopted: true, rejectionReasons: [], durationSeconds: 1800 },
    { id: "rec-2", status: "rejected", adopted: false, rejectionReasons: ["画面不清", "讲解节奏差"], durationSeconds: 900 },
  ],
});
```

Assert:

```ts
expect(profile.participation.naturalDays).toBe(5);
expect(profile.participation.effectiveLiveDays).toBe(2);
expect(profile.participation.scheduleCompletionRateBps).toBe(6667);
expect(profile.liveMetrics.totalViewers).toBe(4200);
expect(profile.liveMetrics.averagePcu).toBe(290);
expect(profile.liveMetrics.averageAcu).toBe(80);
expect(profile.recordings.adoptionRateBps).toBe(5000);
expect(profile.recordings.topRejectionReasons[0]).toEqual({ reason: "画面不清", count: 1 });
expect(profile.facts).toEqual(expect.arrayContaining([
  expect.objectContaining({ sourceTool: "streamer_project_profile", sourceId: "task-1" }),
]));
```

- [ ] **Step 2: Verify profile tests fail**

Run:

```bash
corepack pnpm test features/streamers/streamer-project-review.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement profile builder**

Create `features/streamers/streamer-project-review.ts` with:

```ts
export function buildStreamerProjectReviewProfile(input: StreamerProjectReviewInput): StreamerProjectReviewProfile
```

Calculate:

- natural days from first planned start date through last planned end/start date, inclusive.
- effective live days from completed tasks or reports with positive settlement duration/system duration.
- schedule completion rate from effective live days divided by scheduled task count.
- total and average live metrics from reports.
- recording submit/pass/adoption/rejection rates.
- top rejection reasons sorted by count descending then reason ascending.
- facts and caveats with stable `sourceTool` and `sourceId`.

- [ ] **Step 4: Verify profile tests pass**

Run:

```bash
corepack pnpm test features/streamers/streamer-project-review.test.ts
```

Expected: PASS.

## Task 4: Register Read-Only Xingyao Streamer Project Review Tool

**Files:**

- Modify: `features/ai/ai-tool-layer.ts`
- Test: `features/ai/ai-tool-layer.test.ts`

- [ ] **Step 1: Write failing AI tool test**

Add a test that calls `runAiToolQuery` with `toolName: "streamer_project_review"` and input `{ profileInput }`, then asserts:

```ts
expect(result.output.profile.participation.effectiveLiveDays).toBe(2);
expect(result.output.agentOutput.facts).toEqual(expect.arrayContaining([
  expect.objectContaining({ sourceTool: "streamer_project_profile" }),
]));
expect(insertedToolInvocation.read_only).toBe(true);
```

- [ ] **Step 2: Verify AI tool test fails**

Run:

```bash
corepack pnpm test features/ai/ai-tool-layer.test.ts --testNamePattern "streamer_project_review"
```

Expected: FAIL because the tool is not registered.

- [ ] **Step 3: Register tool**

Import `buildStreamerProjectReviewProfile` and register:

```ts
streamer_project_review: {
  name: "streamer_project_review",
  description: "Builds a read-only streamer-project review profile from authorized preloaded schedule, live report, and recording data.",
  inputSchema: { type: "object", required: ["profileInput"] },
  scopes: ["mcn_staff"],
  masking: { input: ["profileInput"], output: [], streamerForbiddenKeys },
  readOnly: true,
  tier: "L1_PERCEIVE",
  handler(input) {
    const profile = buildStreamerProjectReviewProfile(
      objectValue(input.profileInput) as unknown as StreamerProjectReviewInput,
    );
    return {
      answer: `${profile.streamer.displayName} 在 ${profile.project.name} 的项目复盘档案已生成。`,
      output: {
        profile,
        agentOutput: {
          facts: profile.facts,
          findings: profile.findings,
          caveats: profile.caveats,
          recommendations: profile.recommendations,
        },
      },
    };
  },
}
```

- [ ] **Step 4: Verify AI tool tests pass**

Run:

```bash
corepack pnpm test features/ai/ai-tool-layer.test.ts
```

Expected: PASS.

## Task 5: Final Verification

**Files:**

- All files changed above.

- [ ] **Step 1: Run scoped test suite**

Run:

```bash
corepack pnpm test features/ai/ocr-template-parser.test.ts features/ai/ocr-jobs.test.ts features/streamers/streamer-project-review.test.ts features/ai/ai-tool-layer.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run quality checks**

Run:

```bash
git diff --check
corepack pnpm type-check
```

Expected: PASS.

- [ ] **Step 3: Review dirty-worktree scope**

Run:

```bash
git status --short
```

Expected: only planned files are newly changed by this implementation, plus pre-existing unrelated war-room and untracked files.
