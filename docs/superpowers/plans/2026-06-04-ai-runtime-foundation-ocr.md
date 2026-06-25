# AI Runtime Foundation OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the AI-0 baseline, add the AI-1 runtime ledger/contracts, and ship a real Tencent Cloud OCR job/provider path with env-gated external smoke coverage.

**Architecture:** Keep existing war-room and rule endpoints intact. Add narrow AI runtime modules under `features/ai/`, a dedicated OCR job state machine, one additive Supabase migration, and route contracts for `/api/ocr/jobs`. All external calls enter through provider wrappers and write invocation, tool, audit, and usage records.

**Tech Stack:** Next.js route handlers, TypeScript strict mode, Vitest, Supabase SQL migrations, Zod, Node `crypto`, global `fetch`, Tencent Cloud API 3.0 TC3-HMAC-SHA256 signing.

---

## File Structure

- Create `supabase/migrations/20260604103000_ai_runtime_foundation.sql`: additive AI/OCR runtime tables, indexes, RLS, and policies.
- Create `lib/db/ai-schema-contract.test.ts`: schema contract for new tables, RLS, status columns, and metric linkage.
- Modify `package.json`: add `test:ai-system`.
- Create `features/ai/contracts.ts`: public `AiTool`, `AiProvider`, gateway, OCR, ledger, and `AgentOutput` contracts.
- Create `features/ai/agent-output-contract.ts` and `.test.ts`: grounding validation helpers for future orchestrators.
- Create `features/ai/llm-gateway.ts`, `features/ai/providers/deterministic-provider.ts`, and `features/ai/llm-gateway.test.ts`: provider matrix, fallback/degraded routing, structured schema validation.
- Create `features/ai/invocation-ledger.ts` and `.test.ts`: AI invocation persistence, audit, and `ai` usage metering.
- Create `features/ai/tool-ledger.ts` and `.test.ts`: tool invocation persistence and masking summaries.
- Modify `features/ai/ai-tool-layer.ts` and `.test.ts`: replace placeholder definitions with read-only `AiTool<I, O>`, preserve existing tool behavior, and include invocation/tool ledger IDs.
- Create `features/ai/ocr-template-parser.ts` and `.test.ts`: deterministic extraction of duration/viewer facts from OCR text lines.
- Create `features/ai/providers/tencent-ocr-provider.ts` and `.test.ts`: signed Tencent `GeneralBasicOCR` client and env-gated real smoke test.
- Create `features/ai/ocr-jobs.ts` and `.test.ts`: job creation, retry, provider execution, result persistence, needs-confirmation decisions, `ocr` usage metering.
- Create `app/api/ocr/jobs/route.ts` and `.test.ts`: create/list jobs with auth and MCN staff guards.
- Create `app/api/ocr/jobs/[jobId]/route.ts` and `.test.ts`: get/retry one job with auth and MCN staff guards.

---

### Task 0: AI-0 Baseline Gate

**Files:**

- Read: `package.json`
- Read: `pnpm-lock.yaml`

- [ ] **Step 1: Install dependencies in the isolated worktree**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit 0, `node_modules` exists inside `.worktrees/ai-runtime-foundation`.

- [ ] **Step 2: Run lint baseline**

Run:

```bash
pnpm lint
```

Expected: exit 0. If it fails, capture the first lint error block and continue only if unrelated to AI/OCR implementation.

- [ ] **Step 3: Run type baseline**

Run:

```bash
pnpm type-check
```

Expected: exit 0. If it fails, capture the first TypeScript error block and continue only if unrelated to AI/OCR implementation.

- [ ] **Step 4: Run test baseline**

Run:

```bash
pnpm test
```

Expected: exit 0. If it fails, capture failed suites/tests and continue only if unrelated to AI/OCR implementation.

- [ ] **Step 5: Run build baseline**

Run:

```bash
pnpm build
```

Expected: exit 0. If it fails, capture the first build error block and continue only if unrelated to AI/OCR implementation.

- [ ] **Step 6: Commit AI-0 evidence if only dependency metadata changed**

Run:

```bash
git status --short
```

Expected: no package metadata changes from install. If only intentional plan docs exist, commit them separately.

---

### Task 1: Runtime Schema Contracts

**Files:**

- Create: `lib/db/ai-schema-contract.test.ts`
- Create: `supabase/migrations/20260604103000_ai_runtime_foundation.sql`
- Modify: `package.json`

- [ ] **Step 1: Write the failing schema contract**

Create `lib/db/ai-schema-contract.test.ts` with assertions for the additive migration:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const allMigrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(join(migrationsDir, file), "utf8").toLowerCase())
  .join("\n");

describe("AI runtime schema contract", () => {
  it("creates organization-scoped AI runtime tables", () => {
    for (const table of [
      "ai_invocations",
      "ai_tool_invocations",
      "background_jobs",
      "prompts",
      "streamer_metrics",
      "supplier_scores",
      "scoring_weights",
      "recommendation_outcomes",
      "project_reviews",
      "ai_diagnoses",
      "ai_script_versions",
    ]) {
      expect(allMigrations).toContain(`create table public.${table}`);
      expect(allMigrations).toMatch(
        new RegExp(
          `create table public\\.${table} \\([\\s\\S]*?organization_id uuid not null references public\\.organizations\\(id\\)`,
        ),
      );
      expect(allMigrations).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("links OCR jobs and results to the AI invocation ledger", () => {
    expect(allMigrations).toContain("job_type text not null");
    expect(allMigrations).toContain("ocr.extract_live_report");
    expect(allMigrations).toContain(
      "ai_invocation_id uuid references public.ai_invocations(id)",
    );
    expect(allMigrations).toContain(
      "alter table public.ocr_results add column if not exists ai_invocation_id",
    );
    expect(allMigrations).toContain(
      "alter table public.ocr_results add column if not exists background_job_id",
    );
    expect(allMigrations).toContain(
      "alter table public.ocr_results add column if not exists raw_response",
    );
  });

  it("uses integer-safe AI costs and token counters", () => {
    expect(allMigrations).toContain("prompt_tokens integer not null default 0");
    expect(allMigrations).toContain(
      "completion_tokens integer not null default 0",
    );
    expect(allMigrations).toContain("cost_cents integer not null default 0");
    expect(allMigrations).not.toContain(" double precision");
    expect(allMigrations).not.toContain(" real");
  });
});
```

- [ ] **Step 2: Run the schema test and verify RED**

Run:

```bash
pnpm vitest run lib/db/ai-schema-contract.test.ts
```

Expected: FAIL because `ai_invocations` and related tables are missing.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/20260604103000_ai_runtime_foundation.sql` with additive `create type if not exists` compatible enum-safe statements, `create table public.ai_invocations`, `ai_tool_invocations`, `background_jobs`, `prompts`, `streamer_metrics`, `supplier_scores`, `scoring_weights`, `recommendation_outcomes`, `project_reviews`, `ai_diagnoses`, `ai_script_versions`, indexes, RLS, and additive `alter table public.ocr_results add column if not exists ...` statements.

- [ ] **Step 4: Add the AI system test script**

Modify `package.json`:

```json
"test:ai-system": "vitest run lib/db/ai-schema-contract.test.ts features/ai app/api/ai app/api/ocr"
```

- [ ] **Step 5: Run schema test GREEN**

Run:

```bash
pnpm vitest run lib/db/ai-schema-contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add package.json lib/db/ai-schema-contract.test.ts supabase/migrations/20260604103000_ai_runtime_foundation.sql
git commit -m "feat: add AI runtime schema foundation"
```

---

### Task 2: AI Contracts, Gateway, and Grounding Guards

**Files:**

- Create: `features/ai/contracts.ts`
- Create: `features/ai/agent-output-contract.ts`
- Create: `features/ai/agent-output-contract.test.ts`
- Create: `features/ai/llm-gateway.ts`
- Create: `features/ai/providers/deterministic-provider.ts`
- Create: `features/ai/llm-gateway.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests proving:

```ts
expect(validateAgentOutput(validOutput).valid).toBe(true);
expect(validateAgentOutput(outputWithUncitedFinding).valid).toBe(false);
expect(validateAgentOutput(outputWithActionRecommendation).valid).toBe(false);
```

Add gateway tests proving fallback and degraded behavior:

```ts
await expect(runAiGateway({ providers: [], request })).resolves.toMatchObject({
  status: "degraded",
  degradedReason: "provider_unconfigured",
});
```

- [ ] **Step 2: Run tests RED**

Run:

```bash
pnpm vitest run features/ai/agent-output-contract.test.ts features/ai/llm-gateway.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement contracts and deterministic provider**

Implement `AiTool<I, O>`, `AiProvider`, `AgentOutput`, `runAiGateway`, and `createDeterministicProvider`.

- [ ] **Step 4: Run tests GREEN**

Run:

```bash
pnpm vitest run features/ai/agent-output-contract.test.ts features/ai/llm-gateway.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add features/ai/contracts.ts features/ai/agent-output-contract.ts features/ai/agent-output-contract.test.ts features/ai/llm-gateway.ts features/ai/providers/deterministic-provider.ts features/ai/llm-gateway.test.ts
git commit -m "feat: add AI provider gateway contracts"
```

---

### Task 3: Invocation and Tool Ledgers

**Files:**

- Create: `features/ai/invocation-ledger.ts`
- Create: `features/ai/invocation-ledger.test.ts`
- Create: `features/ai/tool-ledger.ts`
- Create: `features/ai/tool-ledger.test.ts`
- Modify: `features/ai/ai-tool-layer.ts`
- Modify: `features/ai/ai-tool-layer.test.ts`

- [ ] **Step 1: Write failing ledger and tool contract tests**

Add tests proving invocation rows insert into `ai_invocations`, usage rows insert into `usage_events` with metric `ai`, tool rows insert into `ai_tool_invocations`, and every registered tool has `readOnly: true`.

- [ ] **Step 2: Run tests RED**

Run:

```bash
pnpm vitest run features/ai/invocation-ledger.test.ts features/ai/tool-ledger.test.ts features/ai/ai-tool-layer.test.ts
```

Expected: FAIL because ledger modules and new result fields are missing.

- [ ] **Step 3: Implement ledgers and migrate tool registry**

Change `AiToolResult.mode` from `"placeholder"` to `"deterministic"`, return `invocationId`, keep `toolName`, `answer`, and `output`, and preserve current RBAC/masking behavior.

- [ ] **Step 4: Run tests GREEN**

Run:

```bash
pnpm vitest run features/ai/invocation-ledger.test.ts features/ai/tool-ledger.test.ts features/ai/ai-tool-layer.test.ts app/api/ai/diagnosis/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add features/ai/invocation-ledger.ts features/ai/invocation-ledger.test.ts features/ai/tool-ledger.ts features/ai/tool-ledger.test.ts features/ai/ai-tool-layer.ts features/ai/ai-tool-layer.test.ts app/api/ai/diagnosis/route.test.ts
git commit -m "feat: record AI tool invocations"
```

---

### Task 4: Tencent OCR Provider and OCR Job Pipeline

**Files:**

- Create: `features/ai/ocr-template-parser.ts`
- Create: `features/ai/ocr-template-parser.test.ts`
- Create: `features/ai/providers/tencent-ocr-provider.ts`
- Create: `features/ai/providers/tencent-ocr-provider.test.ts`
- Create: `features/ai/ocr-jobs.ts`
- Create: `features/ai/ocr-jobs.test.ts`

- [ ] **Step 1: Write OCR parser tests**

Tests cover:

```ts
expect(
  parseLiveReportOcrText(["直播时长 1小时20分钟", "观看人数 320"]),
).toMatchObject({
  extractedDuration: 80,
  extractedViewers: 320,
  status: "trusted",
});
expect(
  parseLiveReportOcrText(["时长 20分钟"], { expectedDuration: 120 }),
).toMatchObject({
  status: "needs_confirmation",
});
```

- [ ] **Step 2: Run parser RED**

Run:

```bash
pnpm vitest run features/ai/ocr-template-parser.test.ts
```

Expected: FAIL because parser module is missing.

- [ ] **Step 3: Implement parser**

Implement duration parsing for hours/minutes and viewer parsing for common labels. Return `trusted`, `needs_confirmation`, or `failed` with reasons.

- [ ] **Step 4: Write provider and job tests**

Provider tests verify TC3 headers for `GeneralBasicOCR` and unconfigured credentials. Job tests verify pending job creation, success persistence, low-confidence `needs_confirmation`, retry attempt increment, and `ocr` usage event creation.

- [ ] **Step 5: Run provider/job RED**

Run:

```bash
pnpm vitest run features/ai/providers/tencent-ocr-provider.test.ts features/ai/ocr-jobs.test.ts
```

Expected: FAIL because provider and job modules are missing.

- [ ] **Step 6: Implement provider and job runner**

Implement signed POST to `https://ocr.tencentcloudapi.com/` with headers `Authorization`, `Content-Type`, `Host`, `X-TC-Action`, `X-TC-Timestamp`, `X-TC-Version`, and optional `X-TC-Region`. Implement `createOcrJob`, `getOcrJob`, `retryOcrJob`, and `runOcrJobOnce`.

- [ ] **Step 7: Run OCR unit tests GREEN**

Run:

```bash
pnpm vitest run features/ai/ocr-template-parser.test.ts features/ai/providers/tencent-ocr-provider.test.ts features/ai/ocr-jobs.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run env-gated real OCR smoke**

Run:

```bash
pnpm vitest run features/ai/providers/tencent-ocr-provider.test.ts -t "real Tencent OCR"
```

Expected with no Tencent env: SKIP. Expected with env: PASS and no raw secret output.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add features/ai/ocr-template-parser.ts features/ai/ocr-template-parser.test.ts features/ai/providers/tencent-ocr-provider.ts features/ai/providers/tencent-ocr-provider.test.ts features/ai/ocr-jobs.ts features/ai/ocr-jobs.test.ts
git commit -m "feat: add Tencent OCR job pipeline"
```

---

### Task 5: OCR Job API and Regression Gates

**Files:**

- Create: `app/api/ocr/jobs/route.ts`
- Create: `app/api/ocr/jobs/route.test.ts`
- Create: `app/api/ocr/jobs/[jobId]/route.ts`
- Create: `app/api/ocr/jobs/[jobId]/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Tests cover unauthenticated 401, streamer 403, MCN staff create/list/get/retry, and provider-unconfigured degraded response.

- [ ] **Step 2: Run route RED**

Run:

```bash
pnpm vitest run app/api/ocr/jobs/route.test.ts app/api/ocr/jobs/[jobId]/route.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement routes**

Use `createSupabaseServerClient`, `getAuthContext`, `isMcnStaff`, `createOcrJob`, `getOcrJob`, and `retryOcrJob`. Do not expose raw provider JSON in route responses.

- [ ] **Step 4: Run route GREEN**

Run:

```bash
pnpm vitest run app/api/ocr/jobs/route.test.ts app/api/ocr/jobs/[jobId]/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run phase regression tests**

Run:

```bash
pnpm test:ai-system
pnpm test:p4-flywheel
pnpm test:p5-commercialization
pnpm test:golden
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

Expected: all pass, or failures documented with exact command and failure summary.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add app/api/ocr/jobs package.json
git commit -m "feat: expose OCR job APIs"
```

---

## Self-Review

- Spec coverage: AI-0 baseline is Task 0; AI-1 schema is Task 1; public contracts and grounding are Task 2; tool ledger and read-only tool registry are Task 3; real Tencent OCR is Task 4; OCR API is Task 5; regression gates are Task 5.
- Placeholder scan: no `TBD`, `TODO`, or `implement later` steps. The plan uses exact paths and commands.
- Type consistency: `AiTool`, `AiProvider`, `AgentOutput`, `runAiGateway`, and OCR job functions are named consistently across tests and implementation steps.
- Scope guard: OpenAI/Hunyuan real adapters are not implemented in this phase; the gateway contract is ready for them, while the explicit real external provider in this implementation is Tencent OCR.
