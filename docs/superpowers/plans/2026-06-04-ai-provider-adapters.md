# AI Provider Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real OpenAI and Tencent Hunyuan LLM provider adapters behind the existing AI gateway while keeping CI deterministic without secrets.

**Architecture:** Providers remain protocol adapters only; business code continues to call `runAiGateway`. A provider registry builds OpenAI, Hunyuan, and deterministic providers from environment variables, and each real provider returns `degraded` without making network calls when credentials are absent. Structured output is parsed and validated by the gateway, with env-gated smoke tests for real upstream calls.

**Tech Stack:** TypeScript, Vitest, Next.js environment variables, native `fetch`, OpenAI Responses API, Tencent Hunyuan OpenAI-compatible chat completions API.

---

### Task 1: Provider Registry Contract

**Files:**
- Create: `features/ai/provider-registry.test.ts`
- Create: `features/ai/provider-registry.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";

import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "./provider-registry";

describe("provider registry", () => {
  it("returns deterministic provider only when no real provider is configured", () => {
    const providers = createConfiguredAiProviders({ env: {} });

    expect(providers.map((provider) => provider.name)).toEqual(["deterministic"]);
  });

  it("orders real providers before deterministic when credentials exist", () => {
    const providers = createConfiguredAiProviders({
      env: {
        OPENAI_API_KEY: "openai-key",
        HUNYUAN_API_KEY: "hunyuan-key",
        HUNYUAN_BASE_URL: "https://api.hunyuan.cloud.tencent.com",
      },
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      "openai",
      "hunyuan",
      "deterministic",
    ]);
  });

  it("resolves primary and shadow provider names from env", () => {
    expect(
      resolveAiProviderRouting({
        AI_PRIMARY_PROVIDER: "openai",
        AI_SHADOW_PROVIDER: "hunyuan",
      }),
    ).toEqual({ primaryProvider: "openai", shadowProvider: "hunyuan" });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm vitest run features/ai/provider-registry.test.ts`
Expected: FAIL because `provider-registry.ts` does not exist.

- [ ] **Step 3: Implement minimal registry**

```typescript
export function createConfiguredAiProviders({ env = process.env }: { env?: Record<string, string | undefined> } = {}): AiProvider[] {
  const providers: AiProvider[] = [];
  if (env.OPENAI_API_KEY) providers.push(createOpenAiProvider({ apiKey: env.OPENAI_API_KEY }));
  if (env.HUNYUAN_API_KEY && env.HUNYUAN_BASE_URL) {
    providers.push(createHunyuanProvider({ apiKey: env.HUNYUAN_API_KEY, baseUrl: env.HUNYUAN_BASE_URL }));
  }
  providers.push(createDeterministicProvider());
  return providers;
}
```

Also add `.env.example` keys: `OPENAI_API_KEY`, `OPENAI_MODEL`, `HUNYUAN_API_KEY`, `HUNYUAN_BASE_URL`, `HUNYUAN_MODEL`, `AI_PRIMARY_PROVIDER`, `AI_SHADOW_PROVIDER`.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm vitest run features/ai/provider-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .env.example features/ai/provider-registry.ts features/ai/provider-registry.test.ts
git commit -m "feat: add AI provider registry"
```

### Task 2: OpenAI Provider Adapter

**Files:**
- Create: `features/ai/providers/openai-provider.test.ts`
- Create: `features/ai/providers/openai-provider.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createOpenAiProvider } from "./openai-provider";

describe("OpenAI provider", () => {
  it("returns degraded without an API key and does not call fetch", async () => {
    const fetchMock = vi.fn();
    const provider = createOpenAiProvider({ apiKey: "", fetch: fetchMock });

    const result = await provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize" }],
    });

    expect(result).toMatchObject({
      status: "degraded",
      degradedReason: "provider_unconfigured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps Responses API text output into provider result", async () => {
    const provider = createOpenAiProvider({
      apiKey: "secret",
      fetch: vi.fn(async () => new Response(JSON.stringify({
        output_text: "brief ready",
        usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
      }))),
    });

    await expect(provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize" }],
    })).resolves.toMatchObject({
      status: "succeeded",
      text: "brief ready",
      usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
    });
  });

  it("parses structured JSON and never returns the API key in rawResponse", async () => {
    const provider = createOpenAiProvider({
      apiKey: "secret",
      fetch: vi.fn(async () => new Response(JSON.stringify({
        output_text: "{\"summary\":\"ok\"}",
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      }))),
    });

    const result = await provider.runStructured({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "json" }],
      responseSchema: z.object({ summary: z.string() }),
    });

    expect(result.structuredOutput).toEqual({ summary: "ok" });
    expect(JSON.stringify(result.rawResponse)).not.toContain("secret");
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm vitest run features/ai/providers/openai-provider.test.ts`
Expected: FAIL because `openai-provider.ts` does not exist.

- [ ] **Step 3: Implement minimal adapter**

Implement `createOpenAiProvider` with native `fetch`, endpoint `https://api.openai.com/v1/responses`, `Authorization: Bearer <key>`, model from `OPENAI_MODEL` or a conservative default, usage mapping, JSON parsing for structured output, no tool handler execution inside the provider, and sanitized raw response retention.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm vitest run features/ai/providers/openai-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ai/providers/openai-provider.ts features/ai/providers/openai-provider.test.ts
git commit -m "feat: add OpenAI provider adapter"
```

### Task 3: Hunyuan Provider Adapter

**Files:**
- Create: `features/ai/providers/hunyuan-provider.test.ts`
- Create: `features/ai/providers/hunyuan-provider.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it, vi } from "vitest";

import { createHunyuanProvider } from "./hunyuan-provider";

describe("Hunyuan provider", () => {
  it("returns degraded when key or base URL is missing", async () => {
    const fetchMock = vi.fn();
    const provider = createHunyuanProvider({ apiKey: "", baseUrl: "", fetch: fetchMock });

    const result = await provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize in Chinese" }],
    });

    expect(result).toMatchObject({
      status: "degraded",
      degradedReason: "provider_unconfigured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps OpenAI-compatible chat completions output into provider result", async () => {
    const provider = createHunyuanProvider({
      apiKey: "secret",
      baseUrl: "https://api.hunyuan.cloud.tencent.com",
      fetch: vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: "brief ready" } }],
        usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
      }))),
    });

    await expect(provider.runText({
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize in Chinese" }],
    })).resolves.toMatchObject({
      status: "succeeded",
      text: "brief ready",
      usage: { promptTokens: 9, completionTokens: 4, totalTokens: 13 },
    });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm vitest run features/ai/providers/hunyuan-provider.test.ts`
Expected: FAIL because `hunyuan-provider.ts` does not exist.

- [ ] **Step 3: Implement minimal adapter**

Implement `createHunyuanProvider` with native `fetch`, base URL normalization, `POST /v1/chat/completions`, `Authorization: Bearer <key>`, model from `HUNYUAN_MODEL` or a documented default, usage mapping, structured JSON parsing, and `tools` degraded because Hunyuan is not the primary tool-calling route in this stage.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm vitest run features/ai/providers/hunyuan-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ai/providers/hunyuan-provider.ts features/ai/providers/hunyuan-provider.test.ts
git commit -m "feat: add Hunyuan provider adapter"
```

### Task 4: Gateway Config Entry And Smoke Tests

**Files:**
- Modify: `features/ai/llm-gateway.test.ts`
- Create: `features/ai/providers/provider-smoke.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
it("can run from environment-backed providers through the gateway", async () => {
  const result = await runAiGateway({
    providers: createConfiguredAiProviders({ env: {} }),
    primaryProvider: resolveAiProviderRouting({}).primaryProvider,
    request: {
      kind: "text",
      promptKey: "ops.brief",
      promptVersion: 1,
      messages: [{ role: "user", content: "summarize" }],
    },
  });

  expect(result.providerName).toBe("deterministic");
  expect(result.status).toBe("succeeded");
});
```

Smoke tests must use `it.skipIf(!process.env.OPENAI_API_KEY)` and `it.skipIf(!process.env.HUNYUAN_API_KEY || !process.env.HUNYUAN_BASE_URL)` so CI without secrets remains green.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm vitest run features/ai/llm-gateway.test.ts features/ai/providers/provider-smoke.test.ts`
Expected: FAIL until registry imports and smoke file exist.

- [ ] **Step 3: Implement gateway usage and smoke tests**

Add tests only for public gateway usage. Do not add any business API that imports provider adapters directly.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm vitest run features/ai/llm-gateway.test.ts features/ai/providers/provider-smoke.test.ts`
Expected: PASS with smoke tests skipped unless secrets are set.

- [ ] **Step 5: Commit**

```bash
git add features/ai/llm-gateway.test.ts features/ai/providers/provider-smoke.test.ts
git commit -m "test: add env gated LLM provider smoke tests"
```

### Task 5: Regression Gate And Push

**Files:**
- No production files unless verification finds a scoped defect.

- [ ] **Step 1: Run AI test suite**

Run: `pnpm test:ai-system`
Expected: PASS; env-gated smoke tests are skipped without real secrets.

- [ ] **Step 2: Run focused regressions**

Run: `pnpm test:p4-flywheel`
Expected: PASS.

Run: `pnpm test:p5-commercialization`
Expected: PASS.

- [ ] **Step 3: Run full quality gate**

Run: `pnpm lint && pnpm type-check && pnpm test && pnpm build`
Expected: PASS.

- [ ] **Step 4: Push stacked branch**

Run: `git push -u origin codex/ai-provider-adapters`
Expected: branch pushed for a stacked PR on top of `codex/ai-runtime-foundation`.

---

## Self-Review

- Spec coverage: OpenAI and Hunyuan are real provider adapters behind `runAiGateway`; deterministic stays as mock CI fallback; smoke tests are env-gated; no business API directly calls providers.
- Placeholder scan: No future-only placeholders; AG-1 remains intentionally out of scope for this plan.
- Type consistency: Uses existing `AiProvider`, `AiGatewayRequest`, `AiProviderName`, and `runAiGateway` names from AI-1.
