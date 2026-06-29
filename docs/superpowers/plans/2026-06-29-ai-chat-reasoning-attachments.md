# AI Chat Reasoning Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fast/deep chat modes and up to five user-uploaded attachments that the AI assistant can read while preserving grounded business-data analysis.

**Architecture:** Extend the existing dashboard chat path instead of creating a second chat system. The UI sends `mode` and sanitized attachment payloads to `/api/ai/chat`; the route validates limits, builds attachment context, and forwards the request through the provider gateway. OpenAI receives Responses API reasoning options and multimodal/file content, while other providers receive extracted attachment text in the prompt.

**Tech Stack:** Next.js App Router, React, Vitest, existing AI gateway/providers, OpenAI Responses API-compatible request payloads.

---

### Task 1: Provider Contract For Reasoning And Attachments

**Files:**
- Modify: `features/ai/contracts.ts`
- Modify: `features/ai/providers/openai-provider.ts`
- Test: `features/ai/providers/openai-provider.test.ts`

- [ ] **Step 1: Write failing provider tests**

Add tests asserting that `runText` accepts a deep reasoning request with one file attachment and sends:

```ts
expect(requestBody.reasoning).toEqual({ effort: "high", summary: "auto" });
expect(requestBody.input.at(-1).content).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ type: "input_text" }),
    expect.objectContaining({ type: "input_file", filename: "finance.csv" }),
  ]),
);
```

- [ ] **Step 2: Verify provider tests fail**

Run: `corepack pnpm test features/ai/providers/openai-provider.test.ts --testNamePattern "reasoning"`

Expected: FAIL because contracts do not define chat modes, reasoning config, or attachments.

- [ ] **Step 3: Implement minimal contract and OpenAI mapping**

Add `AiChatMode`, `AiAttachment`, `AiReasoningConfig`, and optional `mode`, `attachments`, `reasoning` to `AiTextInput`. Update `toResponsesInput` to map message text plus attachments into Responses API content arrays. Only OpenAI gets `reasoning` in the request body.

- [ ] **Step 4: Verify provider tests pass**

Run: `corepack pnpm test features/ai/providers/openai-provider.test.ts`

Expected: PASS.

### Task 2: Chat API Mode And Attachment Validation

**Files:**
- Modify: `app/api/ai/chat/route.ts`
- Test: `app/api/ai/chat/route.test.ts`

- [ ] **Step 1: Write failing API tests**

Add tests for:

```ts
expect(runAiGatewayMock).toHaveBeenCalledWith(
  expect.objectContaining({
    request: expect.objectContaining({
      mode: "deep",
      reasoning: { effort: "high", summary: "auto" },
      attachments: [expect.objectContaining({ name: "finance.csv" })],
    }),
  }),
);
```

Also add a rejection test for six attachments returning status `400`.

- [ ] **Step 2: Verify API tests fail**

Run: `corepack pnpm test app/api/ai/chat/route.test.ts --testNamePattern "deep|attachments"`

Expected: FAIL because `/api/ai/chat` ignores `mode` and `attachments`.

- [ ] **Step 3: Implement route validation**

Accept `mode?: "fast" | "deep"` and `attachments?: []`. Limit attachments to five, limit text/base64 payload size, keep only allowed MIME families, add an attachment context system prompt, and pass normalized attachments/reasoning into the gateway. Record `chatMode` and `attachmentCount` in invocation metadata.

- [ ] **Step 4: Verify API tests pass**

Run: `corepack pnpm test app/api/ai/chat/route.test.ts`

Expected: PASS.

### Task 3: Dashboard Chat UI Mode Switch And Attachment Picker

**Files:**
- Modify: `components/dashboard/overview-board.jsx`
- Test: `components/dashboard/overview-board.test.jsx`

- [ ] **Step 1: Write failing UI tests**

Add tests that click `深度思考`, attach up to five files, send a message, and assert the `/api/ai/chat` body includes:

```js
expect(payload.mode).toBe("deep");
expect(payload.attachments).toHaveLength(5);
```

Add a sixth-file test that renders an error and does not append the extra file.

- [ ] **Step 2: Verify UI tests fail**

Run: `corepack pnpm test components/dashboard/overview-board.test.jsx --testNamePattern "深度思考|attachments"`

Expected: FAIL because the UI has no mode switch or attachment picker.

- [ ] **Step 3: Implement minimal UI**

Add a segmented control for fast/deep mode, a hidden file input, an attachment button, a compact attachment list with remove buttons, and upload-limit feedback. Convert selected files to base64/data payloads client-side and clear attachments after a successful send.

- [ ] **Step 4: Verify UI tests pass**

Run: `corepack pnpm test components/dashboard/overview-board.test.jsx --testNamePattern "AI panel"`

Expected: PASS.

### Task 4: Final Verification

**Files:**
- All files changed above.

- [ ] **Step 1: Run scoped tests**

Run:

```bash
corepack pnpm test features/ai/providers/openai-provider.test.ts app/api/ai/chat/route.test.ts components/dashboard/overview-board.test.jsx
```

Expected: PASS.

- [ ] **Step 2: Run quality gates**

Run:

```bash
git diff --check
corepack pnpm type-check
corepack pnpm lint
corepack pnpm build
```

Expected: PASS. The known Babel deopt note for the large reference UI file is acceptable if lint exits 0.
