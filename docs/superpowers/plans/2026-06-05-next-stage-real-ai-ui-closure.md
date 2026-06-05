# Next Stage Real AI And UI Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-risk real-user gaps by wiring streamer AI diagnosis and screenshot evidence upload to live APIs, then harden AI fallback behavior, OCR production operations, and remaining secondary UI actions.

**Architecture:** Treat the current backend as the source of truth. UI actions must call existing route handlers instead of local simulated responses, all AI calls must flow through the existing gateway and ledgers, and OCR jobs must gain an operator-visible production run surface before active rollout. Each phase produces a testable slice and keeps P1-P5 regressions green.

**Tech Stack:** Next.js App Router, React reference UI components, TypeScript, Vitest, Testing Library, Supabase RLS, existing AI runtime modules under `features/ai`, existing upload route `/api/uploads/signed`, existing OCR job route `/api/ocr/jobs`.

---

## Current Evidence

- `pnpm type-check`, `pnpm lint`, `pnpm test`, and `pnpm build` passed on 2026-06-05.
- Full test count is now 414 passing tests, so the backend closure is materially stronger than the 2026-06-02 audit snapshot.
- The remaining highest-value gaps are not broad backend gaps. They are real-user wiring, graceful AI degradation, OCR operations, and secondary UI closure.

| Priority | Current state                                                                                           | User-visible risk                                                                | Target outcome                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| P0       | `/m/diagnosis` renders local AI chat only; report screenshot path is locally constructed.               | Manual acceptance cannot prove real AI diagnosis or private screenshot evidence. | Mobile streamer AI and report evidence both call live APIs and show failure states.                                 |
| P1       | `runAiGateway` fails immediately on structured schema mismatch.                                         | Real LLM JSON drift turns into a hard error instead of provider fallback.        | Schema mismatch is treated as a provider failure and tries the next eligible provider.                              |
| P2       | OCR job API exists with RLS and safe fields, but no production runner or operator confirmation surface. | OCR can be created and tested, but cannot be safely operated at volume.          | Queued jobs, retry ceilings, failed jobs, and needs-confirmation results are visible and actionable.                |
| P3       | M10/M11 improved, but mobile/desktop AI and some profile/desktop actions still have local behavior.     | The UI can look complete while selected workflows are still simulated.           | Remaining secondary buttons either call real APIs, navigate to live modules, or are explicitly marked out of scope. |

---

## File Structure

### P0: Streamer AI Diagnosis And Screenshot Upload

- Modify `components/reference-ui/streamer-mobile-reference.jsx`: add live AI diagnosis action, replace local AI timeout response, and create signed upload metadata before report submission.
- Modify `components/reference-ui/streamer-mobile-reference.test.jsx`: assert `/api/ai/diagnosis`, `/api/uploads/signed`, and `/api/live-tasks/:id/reports` calls.
- Read `app/api/ai/diagnosis/route.ts`: preserve response shape `{ result, agentOutput, validation }`.
- Read `app/api/uploads/signed/route.ts`: use `{ category, ownerId, fileName }` and consume `{ bucket, path, signedUrl, token }`.
- Read `app/api/uploads/signed-route.test.ts`: keep route-level contract unchanged.

### P1: AI Gateway Fallback Reliability

- Modify `features/ai/llm-gateway.ts`: continue to fallback providers after structured schema validation failure.
- Modify `features/ai/llm-gateway.test.ts`: add a structured fallback test where the primary provider returns invalid JSON shape and deterministic provider succeeds.
- Read `features/ai/providers/provider-smoke.test.ts`: keep env-gated real provider tests compatible.

### P2: OCR Job Production Operations

- Modify `features/ai/ocr-jobs.ts`: enforce retry ceiling and add safe queue selection helpers.
- Modify `features/ai/ocr-jobs.test.ts`: cover max attempts, queue ordering, failed provider behavior, and needs-confirmation persistence.
- Create `app/api/ocr/jobs/run/route.ts`: staff-only runner endpoint for one queued job or one requested job.
- Create `app/api/ocr/jobs/run/route.test.ts`: route contract for auth, role guard, safe response, provider-unconfigured behavior, and max-attempt refusal.
- Modify `components/reference-ui/ops-reference.jsx`: add an OCR operations panel under M10 or M11-adjacent AI operations.
- Modify `components/reference-ui/ops-reference.test.jsx`: assert operators can see queued, failed, and needs-confirmation jobs without raw provider JSON.

### P3: Secondary UI Closure

- Modify `components/reference-ui/streamer-desktop-reference.jsx`: wire desktop AI screen to `/api/ai/diagnosis` and reuse the mobile AI response formatting.
- Modify `components/reference-ui/streamer-desktop-reference.test.jsx`: assert desktop AI calls diagnosis API.
- Modify `components/reference-ui/streamer-mobile-reference.jsx`: route remaining profile actions to existing live panels or visible pending panels.
- Modify `components/reference-ui/ops-reference.jsx`: triage secondary M1/M2/M4/M5/M6 buttons to existing APIs, local filters, live navigation, or explicit pending copy.
- Modify `docs/reports/2026-06-03-ui-business-closure-gap-inventory.md`: update closure status after implementation.

---

## Scope Boundaries

In scope:

- Real mobile streamer AI diagnosis API calls.
- Private signed upload metadata for report screenshots.
- AI gateway fallback on structured schema mismatch.
- OCR production run and confirmation surface.
- Secondary UI closure for existing modules.
- Tests and acceptance documentation.

Out of scope:

- New external credentials beyond existing env-gated provider configuration.
- Real payment, invoice, tax, SSO, vendor portal, or private deployment.
- Full account-security management such as password reset, 2FA enrollment, and device revocation.
- Production deployment or destructive database reset.

Hard stops:

- Stop before irreversible data deletion.
- Stop before introducing a new external service credential.
- Stop before enabling active auto-review by default.
- Stop before changing RLS policies in a way that broadens streamer or finance access.

---

### Task 0: Baseline And Branch Safety

**Files:**

- Read: `package.json`
- Read: `components/reference-ui/streamer-mobile-reference.test.jsx`
- Read: `features/ai/llm-gateway.test.ts`
- Read: `features/ai/ocr-jobs.test.ts`

- [ ] **Step 1: Confirm worktree state**

Run:

```bash
git status --short --branch
```

Expected: current branch is `codex/full-project-ui` or an isolated implementation branch. No unrelated dirty files are present.

- [ ] **Step 2: Run baseline gates**

Run:

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected: all pass before edits begin. If a command fails, capture the first failing test or compiler error and do not start P0 until the baseline failure is understood.

- [ ] **Step 3: Record baseline evidence in the implementation PR**

Use this exact evidence block in the PR or final implementation note:

```markdown
Baseline before next-stage work:

- `pnpm type-check`: pass
- `pnpm lint`: pass
- `pnpm test`: pass
- `pnpm build`: pass
```

Expected: future reviewers can tell whether a failure was introduced by this phase or inherited.

---

### Task 1: P0 Mobile AI Diagnosis API Binding

**Files:**

- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Read: `app/api/ai/diagnosis/route.ts`
- Read: `features/ai/streamer-diagnosis-agent.ts`

- [ ] **Step 1: Add failing UI smoke for mobile diagnosis**

Add this test to `components/reference-ui/streamer-mobile-reference.test.jsx`:

```jsx
describe("StreamerMobileReferenceApp AI diagnosis smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("calls the streamer diagnosis API and renders the agent answer", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url) === "/api/ai/diagnosis") {
        return {
          ok: true,
          json: async () => ({
            result: {
              answer: "建议今晚先缩短开场铺垫，并在前 10 分钟提高互动密度。",
            },
            agentOutput: {
              summary: "开场互动不足",
              recommendations: [
                {
                  title: "提高前 10 分钟互动",
                  rationale: "近场数据低于个人均值",
                },
              ],
            },
            validation: { valid: true, errors: [] },
          }),
        };
      }

      return {
        ok: false,
        json: async () => ({ error: `unexpected request ${url}` }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StreamerMobileReferenceApp initialRoute="ai" />);

    fireEvent.change(screen.getByPlaceholderText("描述你遇到的卡点…"), {
      target: { value: "昨天进房下滑，开场留不住人" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/diagnosis",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      question: "昨天进房下滑，开场留不住人",
      source: "streamer_mobile",
    });
    expect(
      await screen.findByText(
        "建议今晚先缩短开场铺垫，并在前 10 分钟提高互动密度。",
      ),
    ).toBeInTheDocument();
  });
});
```

Expected: this fails because `StreamerAI.send` currently uses `setTimeout` with local text and never calls `/api/ai/diagnosis`.

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx -t "AI diagnosis"
```

Expected: FAIL with a fetch expectation failure.

- [ ] **Step 3: Replace local AI timeout with a live action**

In `components/reference-ui/streamer-mobile-reference.jsx`, update `StreamerAI.send` to be async and call a context action.

Use this shape:

```jsx
function StreamerAI({ go }) {
  const { actions } = React.useContext(StreamerLiveDataContext);
  const [thread, setThread] = React.useState(AI_THREAD);
  const [input, setInput] = React.useState("");
  const [typing, setTyping] = React.useState(false);
  const endRef = React.useRef(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread, typing]);

  const send = async (text) => {
    const question = String(text || "").trim();
    if (!question) return;

    setThread((prev) => [
      ...prev,
      { role: "me", text: question, time: nowHM() },
    ]);
    setInput("");
    setTyping(true);

    try {
      const answer = await actions.askDiagnosis?.(question);
      setThread((prev) => [
        ...prev,
        {
          role: "ai",
          text:
            answer ||
            "诊断已完成，但本次没有返回可展示建议。请补充直播时间、产品和卡点现象后再试。",
          time: nowHM(),
        },
      ]);
    } catch (error) {
      setThread((prev) => [
        ...prev,
        {
          role: "ai",
          text:
            error instanceof Error
              ? error.message
              : "诊断服务暂时不可用，请稍后重试。",
          time: nowHM(),
        },
      ]);
    } finally {
      setTyping(false);
    }
  };

  // existing JSX stays unchanged
}
```

Expected: prompt chips and manual send now go through the same live action.

- [ ] **Step 4: Add `askDiagnosis` to mobile actions**

In the `actions` object inside `StreamerMobileReferenceApp`, add:

```jsx
askDiagnosis: async (question) => {
  const body = await fetchJson(
    "/api/ai/diagnosis",
    "AI diagnosis failed",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        source: "streamer_mobile",
      }),
    },
  );

  return formatDiagnosisAnswer(body);
},
```

Add this helper near the existing normalization helpers:

```jsx
function formatDiagnosisAnswer(body) {
  const directAnswer = body?.result?.answer;
  if (typeof directAnswer === "string" && directAnswer.trim()) {
    return directAnswer;
  }

  const summary = body?.agentOutput?.summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary;
  }

  const firstRecommendation = body?.agentOutput?.recommendations?.[0];
  if (firstRecommendation?.title && firstRecommendation?.rationale) {
    return `${firstRecommendation.title}：${firstRecommendation.rationale}`;
  }

  return "";
}
```

Expected: the UI can display backward-compatible `result.answer` and future `agentOutput` shapes.

- [ ] **Step 5: Run mobile AI diagnosis test**

Run:

```bash
pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx -t "AI diagnosis"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add components/reference-ui/streamer-mobile-reference.jsx components/reference-ui/streamer-mobile-reference.test.jsx
git commit -m "feat: wire mobile streamer AI diagnosis"
```

Expected: one focused commit.

---

### Task 2: P0 Report Screenshot Signed Upload Metadata

**Files:**

- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Read: `app/api/uploads/signed/route.ts`
- Read: `features/storage/private-upload.ts`
- Read: `app/api/live-tasks/[taskId]/reports/route.ts`

- [ ] **Step 1: Update the report smoke test to require signed upload**

In `components/reference-ui/streamer-mobile-reference.test.jsx`, update the existing `"starts, stops, and submits a live report from the streamer task flow"` fetch mock so `/api/uploads/signed` returns signed metadata:

```jsx
if (requestUrl === "/api/uploads/signed") {
  return {
    ok: true,
    json: async () => ({
      bucket: "evidence-private",
      path: "org-1/report-screenshots/live-task-ui-smoke-1/manual-submit.png",
      signedUrl:
        "https://upload.local/org-1/report-screenshots/live-task-ui-smoke-1/manual-submit.png",
      token: "token-1",
    }),
  };
}
```

Then change the expected calls after `"确认无误，提交审核"`:

```jsx
await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
expect(fetchMock).toHaveBeenNthCalledWith(
  5,
  "/api/uploads/signed",
  expect.objectContaining({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "report-screenshots",
      ownerId: "live-task-ui-smoke-1",
      fileName: "manual-submit.png",
    }),
  }),
);
expect(fetchMock).toHaveBeenNthCalledWith(
  6,
  "/api/live-tasks/live-task-ui-smoke-1/reports",
  expect.objectContaining({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      screenshotStoragePath:
        "org-1/report-screenshots/live-task-ui-smoke-1/manual-submit.png",
      screenshotFileHash: "manual-live-task-ui-smoke-1-1780000000000",
      screenshotDuration: 240,
      claimedDuration: 240,
      viewers: 11240,
    }),
  }),
);
expect(fetchMock).toHaveBeenNthCalledWith(
  7,
  "/api/streamer/live-tasks",
  undefined,
);
```

Expected: this fails because the component currently sends the local path directly.

- [ ] **Step 2: Run the failing report test**

Run:

```bash
pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx -t "starts, stops, and submits"
```

Expected: FAIL because `/api/uploads/signed` is not called.

- [ ] **Step 3: Add signed upload request before report submit**

In `submitReport`, request signed metadata first:

```jsx
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
  await refreshTasks();
},
```

Expected: report submission now depends on a private signed upload path.

- [ ] **Step 4: Run signed upload route and mobile smoke tests**

Run:

```bash
pnpm vitest run app/api/uploads/signed-route.test.ts components/reference-ui/streamer-mobile-reference.test.jsx -t "starts, stops, and submits"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add components/reference-ui/streamer-mobile-reference.jsx components/reference-ui/streamer-mobile-reference.test.jsx
git commit -m "feat: use signed report screenshot evidence paths"
```

Expected: one focused commit.

---

### Task 3: P1 Gateway Fallback On Structured Schema Failure

**Files:**

- Modify: `features/ai/llm-gateway.test.ts`
- Modify: `features/ai/llm-gateway.ts`

- [ ] **Step 1: Add failing structured fallback test**

Add this test to `features/ai/llm-gateway.test.ts`:

```ts
it("falls back when the primary structured provider returns schema-invalid output", async () => {
  const invalidStructuredProvider: AiProvider = {
    name: "openai",
    capabilities: ["structured"],
    async runText() {
      throw new Error("not used");
    },
    async runStructured() {
      return {
        status: "succeeded",
        structuredOutput: { summary: 123 },
        usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
        latencyMs: 20,
        costCents: 1,
      };
    },
    async runWithTools() {
      throw new Error("not used");
    },
    estimateCost() {
      return { costCents: 1 };
    },
  };

  const result = await runAiGateway({
    providers: [
      invalidStructuredProvider,
      createDeterministicProvider({
        structuredOutput: { summary: "fallback summary" },
      }),
    ],
    primaryProvider: "openai",
    request: {
      kind: "structured",
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize" }],
      responseSchema: z.object({ summary: z.string() }),
    },
  });

  expect(result).toMatchObject({
    status: "succeeded",
    providerName: "deterministic",
    fallbackUsed: true,
    degradedReason: "primary_failed",
    structuredOutput: { summary: "fallback summary" },
  });
});
```

Expected: this fails because the gateway currently returns `schema_validation_failed` immediately.

- [ ] **Step 2: Run the failing gateway test**

Run:

```bash
pnpm vitest run features/ai/llm-gateway.test.ts -t "schema-invalid"
```

Expected: FAIL.

- [ ] **Step 3: Treat schema mismatch as a candidate failure**

In `features/ai/llm-gateway.ts`, change the structured validation branch from immediate return to failure accumulation and continue:

```ts
if (request.kind === "structured") {
  const validation = validateStructuredOutput(
    request.responseSchema,
    providerResult.structuredOutput,
  );
  if (!validation.valid) {
    failures.push(
      `${provider.name} schema validation failed: ${validation.errorSummary}`,
    );
    continue;
  }
}
```

Expected: the next provider is tried after schema mismatch.

- [ ] **Step 4: Preserve all-provider failure detail**

Ensure the final failure still returns:

```ts
return {
  status: "failed",
  providerName: candidates[0]?.name,
  fallbackUsed: candidates.length > 1,
  degradedReason: "all_providers_failed",
  errorSummary: failures.join("; "),
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  latencyMs: 0,
  costCents: 0,
};
```

Expected: if every provider fails schema validation or upstream execution, the caller gets one failure summary with all provider errors.

- [ ] **Step 5: Run gateway and provider smoke tests**

Run:

```bash
pnpm vitest run features/ai/llm-gateway.test.ts features/ai/providers/provider-smoke.test.ts
```

Expected: PASS. Env-gated smoke tests skip when provider credentials are absent.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add features/ai/llm-gateway.ts features/ai/llm-gateway.test.ts
git commit -m "feat: fallback on structured AI schema mismatch"
```

Expected: one focused commit.

---

### Task 4: P2 OCR Retry Ceiling And Queue Helpers

**Files:**

- Modify: `features/ai/ocr-jobs.test.ts`
- Modify: `features/ai/ocr-jobs.ts`

- [ ] **Step 1: Add failing OCR max-attempt test**

Add to `features/ai/ocr-jobs.test.ts`:

```ts
it("refuses retry when an OCR job reaches max attempts", async () => {
  const { client } = createClient({
    jobs: [
      {
        id: "job-max",
        organizationId: "org-1",
        jobType: "ocr.extract_live_report",
        status: "failed",
        attempt: 3,
        aiInvocationId: "invocation-max",
        payload: { liveReportId: "report-max", imageBase64: "ZmFrZQ==" },
        maxAttempts: 3,
      },
    ],
  });

  await expect(
    retryOcrJob({ client, actor, jobId: "job-max" }),
  ).rejects.toThrow("OCR job reached max retry attempts");
});
```

Extend the local `OcrJobRecord` fixture type in the test helper if needed:

```ts
maxAttempts?: number;
```

Expected: FAIL because `retryOcrJob` increments attempts without a ceiling.

- [ ] **Step 2: Add failing queue selection test**

Add to `features/ai/ocr-jobs.test.ts`:

```ts
it("lists runnable OCR jobs in queue order", async () => {
  const { client } = createClient({
    jobs: [
      {
        id: "job-new",
        organizationId: "org-1",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        payload: { liveReportId: "report-new", imageBase64: "ZmFrZQ==" },
      },
      {
        id: "job-failed",
        organizationId: "org-1",
        jobType: "ocr.extract_live_report",
        status: "failed",
        attempt: 1,
        payload: { liveReportId: "report-failed", imageBase64: "ZmFrZQ==" },
      },
    ],
  });

  await expect(
    listRunnableOcrJobs({
      client,
      organizationId: "org-1",
      limit: 10,
    }),
  ).resolves.toEqual([
    expect.objectContaining({ id: "job-new", status: "queued" }),
  ]);
});
```

Expected: FAIL because `listRunnableOcrJobs` does not exist.

- [ ] **Step 3: Implement `maxAttempts` on OCR job records**

In `features/ai/ocr-jobs.ts`, extend `OcrJobRecord`:

```ts
export type OcrJobRecord = {
  id: string;
  organizationId: string;
  jobType: "ocr.extract_live_report";
  status: OcrJobStatus;
  attempt: number;
  maxAttempts: number;
  aiInvocationId?: string;
  payload: OcrJobPayload;
};
```

In `toOcrJobRecord`, map `max_attempts`:

```ts
maxAttempts: Number(row.max_attempts ?? row.maxAttempts ?? 3),
```

Expected: existing callers now see retry ceiling metadata.

- [ ] **Step 4: Enforce retry ceiling**

At the start of `retryOcrJob`, after loading the job:

```ts
if (job.attempt >= job.maxAttempts) {
  throw new Error("OCR job reached max retry attempts");
}
```

Expected: maxed jobs cannot be requeued.

- [ ] **Step 5: Add queue helper**

Export this helper from `features/ai/ocr-jobs.ts`:

```ts
export async function listRunnableOcrJobs({
  client,
  organizationId,
  limit = 20,
}: {
  client: {
    from(table: "background_jobs"): {
      select(columns: string): {
        eq(
          column: string,
          value: string,
        ): {
          in(
            column: string,
            values: string[],
          ): {
            order(
              column: string,
              options: { ascending: boolean },
            ): {
              limit(
                count: number,
              ): PromiseLike<{ data: OcrJobRow[] | null; error: Error | null }>;
            };
          };
        };
      };
    };
  };
  organizationId: string;
  limit?: number;
}): Promise<OcrJobRecord[]> {
  const { data, error } = await client
    .from("background_jobs")
    .select("*")
    .eq("organization_id", organizationId)
    .in("status", ["queued"])
    .order("run_after", { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? [])
    .filter(
      (job) => (job.job_type ?? job.jobType) === "ocr.extract_live_report",
    )
    .map(toOcrJobRecord);
}
```

Expected: production runner can select queued OCR jobs without exposing unrelated background jobs.

- [ ] **Step 6: Run OCR job tests**

Run:

```bash
pnpm vitest run features/ai/ocr-jobs.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add features/ai/ocr-jobs.ts features/ai/ocr-jobs.test.ts
git commit -m "feat: harden OCR job retry queue"
```

Expected: one focused commit.

---

### Task 5: P2 OCR Job Runner API

**Files:**

- Create: `app/api/ocr/jobs/run/route.test.ts`
- Create: `app/api/ocr/jobs/run/route.ts`
- Modify: `features/ai/ocr-jobs.ts`

- [ ] **Step 1: Write runner route tests**

Create `app/api/ocr/jobs/run/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { listRunnableOcrJobs, runOcrJobOnce } from "@/features/ai/ocr-jobs";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ocr-jobs", () => ({
  listRunnableOcrJobs: vi.fn(),
  runOcrJobOnce: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@example.com",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Org One",
  role: "ops_manager" as const,
};

describe("/api/ocr/jobs/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      from: vi.fn(),
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("runs the next queued OCR job and returns safe fields", async () => {
    vi.mocked(listRunnableOcrJobs).mockResolvedValue([
      {
        id: "job-1",
        organizationId: "org-1",
        jobType: "ocr.extract_live_report",
        status: "queued",
        attempt: 0,
        maxAttempts: 3,
        payload: { liveReportId: "report-1", imageBase64: "raw-image" },
      },
    ]);
    vi.mocked(runOcrJobOnce).mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      jobType: "ocr.extract_live_report",
      status: "needs_confirmation",
      attempt: 1,
      maxAttempts: 3,
      aiInvocationId: "invocation-1",
      payload: { liveReportId: "report-1", imageBase64: "raw-image" },
    });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/run", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      job: {
        id: "job-1",
        status: "needs_confirmation",
        attempt: 1,
        maxAttempts: 3,
        aiInvocationId: "invocation-1",
        liveReportId: "report-1",
        screenshotId: undefined,
      },
    });
  });

  it("blocks streamers from running OCR jobs", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "streamer" });

    const response = await POST(
      new Request("http://localhost/api/ocr/jobs/run", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
    expect(runOcrJobOnce).not.toHaveBeenCalled();
  });
});
```

Expected: FAIL because the route does not exist.

- [ ] **Step 2: Implement runner route**

Create `app/api/ocr/jobs/run/route.ts`:

```ts
import { NextResponse } from "next/server";

import {
  getOcrJob,
  listRunnableOcrJobs,
  runOcrJobOnce,
} from "@/features/ai/ocr-jobs";
import {
  createTencentOcrProvider,
  readTencentOcrConfigFromEnv,
} from "@/features/ai/providers/tencent-ocr-provider";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can run OCR jobs" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      jobId?: string;
    };
    const job = body.jobId
      ? await getOcrJob({ client: supabase as never, jobId: body.jobId })
      : (
          await listRunnableOcrJobs({
            client: supabase as never,
            organizationId: auth.organizationId,
            limit: 1,
          })
        )[0];

    if (!job || job.organizationId !== auth.organizationId) {
      return NextResponse.json({ error: "OCR job not found" }, { status: 404 });
    }

    const provider = createTencentOcrProvider(
      readTencentOcrConfigFromEnv(process.env),
    );
    const result = await runOcrJobOnce({
      client: supabase as never,
      actor: auth,
      jobId: job.id,
      provider,
    });

    return NextResponse.json({ job: toSafeJob(result) });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }

    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

function toSafeJob(job: {
  id: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  aiInvocationId?: string;
  payload: { liveReportId?: string; screenshotId?: string };
}) {
  return {
    id: job.id,
    status: job.status,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    aiInvocationId: job.aiInvocationId,
    liveReportId: job.payload.liveReportId,
    screenshotId: job.payload.screenshotId,
  };
}
```

Expected: route returns safe metadata only. It must not include `imageBase64`, `imageUrl`, `rawResponse`, or provider text lines.

- [ ] **Step 3: Run runner route tests**

Run:

```bash
pnpm vitest run app/api/ocr/jobs/run/route.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run OCR route regression**

Run:

```bash
pnpm vitest run app/api/ocr/jobs/route.test.ts app/api/ocr/jobs/[jobId]/route.test.ts app/api/ocr/jobs/run/route.test.ts features/ai/ocr-jobs.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add app/api/ocr/jobs/run features/ai/ocr-jobs.ts features/ai/ocr-jobs.test.ts
git commit -m "feat: add staff OCR job runner"
```

Expected: one focused commit.

---

### Task 6: P2 OCR Operations Panel

**Files:**

- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `components/reference-ui/ops-reference.jsx`

- [ ] **Step 1: Add OCR operations smoke test**

Add to `components/reference-ui/ops-reference.test.jsx`:

```jsx
describe("OpsReferenceApp OCR operations smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists OCR jobs and runs the next queued job without exposing raw provider data", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url) === "/api/ocr/jobs") {
        return {
          ok: true,
          json: async () => ({
            jobs: [
              {
                id: "ocr-job-1",
                status: "queued",
                attempt: 0,
                maxAttempts: 3,
                aiInvocationId: "invocation-1",
                liveReportId: "report-1",
                screenshotId: "screenshot-1",
              },
            ],
          }),
        };
      }

      if (String(url) === "/api/ocr/jobs/run" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            job: {
              id: "ocr-job-1",
              status: "needs_confirmation",
              attempt: 1,
              maxAttempts: 3,
              aiInvocationId: "invocation-1",
              liveReportId: "report-1",
              screenshotId: "screenshot-1",
            },
          }),
        };
      }

      return {
        ok: false,
        json: async () => ({ error: `unexpected request ${url}` }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsReferenceApp initialRoute="warroom" />);

    fireEvent.click(screen.getByRole("button", { name: "OCR 作业" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/ocr/jobs", undefined),
    );
    expect(screen.getByText("ocr-job-1")).toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
    expect(screen.queryByText("rawResponse")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "运行下一条 OCR" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ocr/jobs/run",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      ),
    );
    expect(await screen.findByText("needs_confirmation")).toBeInTheDocument();
  });
});
```

Expected: FAIL because no OCR operations panel exists.

- [ ] **Step 2: Add OCR jobs state and actions**

Inside `OpsReferenceApp`, add state:

```jsx
const [ocrJobsState, setOcrJobsState] = React.useState(null);
```

Add actions:

```jsx
const refreshOcrJobs = async () => {
  const body = await fetchJson("/api/ocr/jobs", "refresh OCR jobs failed");
  if (Array.isArray(body.jobs)) {
    setOcrJobsState(body.jobs);
  }
  return body.jobs;
};

const runNextOcrJob = async () => {
  const body = await fetchJson("/api/ocr/jobs/run", "run OCR job failed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (body.job) {
    setOcrJobsState((current) => [
      body.job,
      ...(Array.isArray(current)
        ? current.filter((item) => item.id !== body.job.id)
        : []),
    ]);
  }
  return body.job;
};
```

Expected: OCR panel can refresh and run jobs.

- [ ] **Step 3: Add OCR operations UI under War Room**

Add a button labeled `OCR 作业` in `ScreenWarRoom` and render an `OcrOperationsPanel` with:

```jsx
function OcrOperationsPanel({ jobs = [], onRefresh, onRunNext }) {
  return (
    <section>
      <div>
        <button onClick={onRefresh}>刷新 OCR 作业</button>
        <button onClick={onRunNext}>运行下一条 OCR</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>Status</th>
            <th>Attempt</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>{job.id}</td>
              <td>{job.status}</td>
              <td>
                {job.attempt}/{job.maxAttempts ?? 3}
              </td>
              <td>{job.liveReportId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

Keep styling consistent with the existing reference UI. The table must not render `imageBase64`, `imageUrl`, `rawResponse`, provider text lines, or full OCR raw result.

- [ ] **Step 4: Run OCR operations smoke**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "OCR operations"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

Run:

```bash
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: surface OCR operations queue"
```

Expected: one focused commit.

---

### Task 7: P3 Desktop AI Diagnosis API Binding

**Files:**

- Modify: `components/reference-ui/streamer-desktop-reference.test.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.jsx`

- [ ] **Step 1: Add desktop AI smoke test**

Add to `components/reference-ui/streamer-desktop-reference.test.jsx`:

```jsx
describe("StreamerDesktopReferenceApp AI diagnosis smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("calls the streamer diagnosis API from desktop AI", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url) === "/api/ai/diagnosis") {
        return {
          ok: true,
          json: async () => ({
            result: { answer: "桌面诊断建议：先复盘最近三场互动峰值。" },
            validation: { valid: true, errors: [] },
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ tasks: [], recordings: [], profile: null }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StreamerDesktopReferenceApp initialRoute="ai" />);

    fireEvent.change(screen.getByPlaceholderText("描述你的直播卡点…"), {
      target: { value: "最近桌面端复盘发现互动下降" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/diagnosis",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      question: "最近桌面端复盘发现互动下降",
      source: "streamer_desktop",
    });
    expect(
      await screen.findByText("桌面诊断建议：先复盘最近三场互动峰值。"),
    ).toBeInTheDocument();
  });
});
```

Expected: FAIL because desktop AI currently uses local timeout text.

- [ ] **Step 2: Implement desktop `askDiagnosis` action**

In `StreamerDesktopReferenceApp`, add an action equivalent to mobile:

```jsx
askDiagnosis: async (question) => {
  const body = await fetchJson(
    "/api/ai/diagnosis",
    "AI diagnosis failed",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        source: "streamer_desktop",
      }),
    },
  );

  return formatDiagnosisAnswer(body);
},
```

Expected: desktop and mobile share response formatting semantics.

- [ ] **Step 3: Replace desktop local AI timeout**

Update `ScreenAI.send` in `components/reference-ui/streamer-desktop-reference.jsx` to call `actions.askDiagnosis` instead of `setTimeout`.

Expected: desktop AI becomes live API-backed.

- [ ] **Step 4: Run desktop AI test**

Run:

```bash
pnpm vitest run components/reference-ui/streamer-desktop-reference.test.jsx -t "AI diagnosis"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

Run:

```bash
git add components/reference-ui/streamer-desktop-reference.jsx components/reference-ui/streamer-desktop-reference.test.jsx
git commit -m "feat: wire desktop streamer AI diagnosis"
```

Expected: one focused commit.

---

### Task 8: P3 Secondary Button Closure Audit Pass

**Files:**

- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.test.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.jsx`
- Modify: `docs/reports/2026-06-03-ui-business-closure-gap-inventory.md`

- [ ] **Step 1: Generate current no-op handler inventory**

Run:

```bash
rg -n "onClick=\\{\\(\\) => \\{\\}\\}|setTimeout\\(|暂未接入|本地|local responses|manual-submit\\.png|MY_TASKS|MY_VIDEOS" components app docs/reports
```

Expected: every hit is classified as one of these four categories:

- route-to-existing-center
- local-state filter
- real API action
- explicitly out of scope with visible pending copy

- [ ] **Step 2: Add regression assertions for known closed items**

Update existing UI smoke tests to assert these already-closed items remain closed:

```jsx
expect(
  screen.queryByText("ScreenWarRoom still uses static calculations"),
).not.toBeInTheDocument();
expect(
  screen.queryByText("M11 route has no visible screen"),
).not.toBeInTheDocument();
```

Also keep existing tests that cover:

- M10 pricing, matching, and project review calls.
- M11 billing status and refresh.
- Mobile profile rows navigating to recording and settlement panels.
- Desktop task/profile/recording API refresh.

Expected: future refactors cannot silently reintroduce the 2026-06-03 gaps.

- [ ] **Step 3: Convert actionable pending UI to explicit pending panels**

For product-scope-dependent controls such as account privacy, platform binding, password, 2FA, and device management, render visible pending panels instead of empty handlers.

Use this copy pattern:

```jsx
showToast("账号安全设置需要独立账号体系切片，本阶段不启用。");
```

Expected: the UI never silently does nothing.

- [ ] **Step 4: Update gap inventory status**

Update `docs/reports/2026-06-03-ui-business-closure-gap-inventory.md` with a new section:

```markdown
## 2026-06-05 Next Stage Update

| Area                              | Previous gap               | New status                   | Evidence                                                                        |
| --------------------------------- | -------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| Streamer mobile `/m/diagnosis`    | Local AI response          | Live API-bound               | `components/reference-ui/streamer-mobile-reference.test.jsx` AI diagnosis smoke |
| Streamer mobile report screenshot | Local path                 | Signed private path          | report smoke calls `/api/uploads/signed` before report submit                   |
| AI gateway                        | Schema mismatch hard-fails | Provider fallback            | `features/ai/llm-gateway.test.ts` structured fallback test                      |
| OCR operations                    | API-only                   | Staff runner and queue panel | OCR job runner route and ops smoke                                              |
| Streamer desktop AI               | Local AI response          | Live API-bound               | desktop AI diagnosis smoke                                                      |
```

Expected: historical report remains traceable and current status is explicit.

- [ ] **Step 5: Run UI smoke tests**

Run:

```bash
pnpm test:ui-smoke
pnpm vitest run components/reference-ui/ops-reference.test.jsx components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

Run:

```bash
git add components/reference-ui docs/reports/2026-06-03-ui-business-closure-gap-inventory.md
git commit -m "docs: close next-stage UI gap inventory"
```

Expected: one focused commit with UI closure and report update.

---

### Task 9: Full Regression And Acceptance Report

**Files:**

- Create: `docs/reports/2026-06-05-next-stage-real-ai-ui-closure-report.md`
- Read: `docs/manual-acceptance-test-cases.md`

- [ ] **Step 1: Run focused next-stage suites**

Run:

```bash
pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx components/reference-ui/ops-reference.test.jsx
pnpm vitest run features/ai/llm-gateway.test.ts features/ai/ocr-jobs.test.ts
pnpm vitest run app/api/uploads/signed-route.test.ts app/api/ai/diagnosis/route.test.ts app/api/ocr/jobs/route.test.ts app/api/ocr/jobs/[jobId]/route.test.ts app/api/ocr/jobs/run/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run phase regression suites**

Run:

```bash
pnpm test:ai-system
pnpm test:p4-flywheel
pnpm test:p5-commercialization
pnpm test:golden
pnpm test:ui-smoke
```

Expected: PASS.

- [ ] **Step 3: Run repository gates**

Run:

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Write acceptance report**

Create `docs/reports/2026-06-05-next-stage-real-ai-ui-closure-report.md`:

```markdown
# Next Stage Real AI And UI Closure Acceptance Report

Date: 2026-06-05

## Conclusion

Pass. Streamer AI diagnosis, report screenshot evidence, AI gateway fallback, OCR operations, and secondary UI closure are now API-backed and regression-covered.

## Closed Gaps

- `/m/diagnosis` calls `/api/ai/diagnosis` and renders live agent output.
- Streamer report screenshot submission requests `/api/uploads/signed` before creating a live report.
- `runAiGateway` falls back after structured schema mismatch.
- OCR jobs have retry ceilings, a staff runner route, and an operations panel.
- Desktop AI diagnosis calls `/api/ai/diagnosis`.
- Remaining secondary controls are either real actions, live navigation, local filters, or visible pending panels.

## Verification

- `pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx components/reference-ui/ops-reference.test.jsx`: pass
- `pnpm vitest run features/ai/llm-gateway.test.ts features/ai/ocr-jobs.test.ts`: pass
- `pnpm test:ai-system`: pass
- `pnpm test:p4-flywheel`: pass
- `pnpm test:p5-commercialization`: pass
- `pnpm test:golden`: pass
- `pnpm test:ui-smoke`: pass
- `pnpm lint`: pass
- `pnpm type-check`: pass
- `pnpm test`: pass
- `pnpm build`: pass

## Remaining Scope

- Real external credentials remain env-gated.
- Active auto-review remains gated by rollout metrics and explicit active request.
- Full account-security settings remain a separate auth/profile slice.
```

Expected: final report ties code changes to user-visible closure.

- [ ] **Step 5: Commit acceptance report**

Run:

```bash
git add docs/reports/2026-06-05-next-stage-real-ai-ui-closure-report.md
git commit -m "docs: report next-stage real AI UI closure"
```

Expected: one focused docs commit.

---

## Acceptance Matrix

| Area             | Acceptance command                                                                                           | Must prove                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Mobile AI        | `pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx -t "AI diagnosis"`               | `/api/ai/diagnosis` is called and live answer renders. |
| Mobile evidence  | `pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx -t "starts, stops, and submits"` | `/api/uploads/signed` precedes report creation.        |
| Gateway fallback | `pnpm vitest run features/ai/llm-gateway.test.ts`                                                            | Schema-invalid primary provider falls back.            |
| OCR job ops      | `pnpm vitest run features/ai/ocr-jobs.test.ts app/api/ocr/jobs/run/route.test.ts`                            | Retry ceilings and runner route are covered.           |
| OCR panel        | `pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "OCR operations"`                         | Staff-visible queue has safe fields only.              |
| Desktop AI       | `pnpm vitest run components/reference-ui/streamer-desktop-reference.test.jsx -t "AI diagnosis"`              | Desktop AI calls diagnosis API.                        |
| Full project     | `pnpm lint && pnpm type-check && pnpm test && pnpm build`                                                    | Repository remains green.                              |

---

## Rollout Recommendation

Ship in this order:

1. P0 mobile diagnosis and screenshot upload.
2. P1 gateway fallback reliability.
3. P2 OCR queue and staff runner.
4. P2 OCR operations panel.
5. P3 desktop AI and secondary button closure.
6. Final regression and acceptance report.

Reason: P0 closes the most visible manual acceptance gap; P1 protects all real provider usage; P2 makes OCR operable; P3 removes remaining UI ambiguity after the high-risk paths are real.

---

## Self-Review

- Spec coverage: P0, P1, P2, and P3 are each mapped to concrete tasks, files, commands, and acceptance outcomes.
- Placeholder scan: no deferred implementation markers are required.
- Type consistency: route names, function names, and test file paths match the current codebase surfaces.
- Risk posture: active auto-review, new credentials, destructive database changes, and full account-security scope remain excluded.
