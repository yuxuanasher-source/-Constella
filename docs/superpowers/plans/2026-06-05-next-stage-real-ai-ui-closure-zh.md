# 下一阶段真实 AI 与 UI 闭环实施计划

> **给执行智能体的要求：** 执行本文档时，必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项推进。所有步骤都使用 checkbox（`- [ ]`）记录进度。

**目标：** 先补齐最影响真实验收的主播端 AI 诊断与报数截图证据上传，再加固 AI fallback、OCR 生产运行面和剩余二级 UI 操作。

**架构原则：** 现有后端能力作为事实源。前端按钮必须调用现有 route handler，不再用本地模拟响应；所有 AI 调用必须经过既有 gateway、ledger 和审计链路；OCR job 在 active 使用前必须具备运营可见、可重试、可人工确认的生产运行面。每个阶段都必须独立可验收，并保持 P1-P5 回归测试通过。

**技术栈：** Next.js App Router、React reference UI、TypeScript、Vitest、Testing Library、Supabase RLS、`features/ai` AI runtime、`/api/uploads/signed` 私有上传签名、`/api/ocr/jobs` OCR job API。

---

## 当前证据

- 2026-06-05 已跑过 `pnpm type-check`、`pnpm lint`、`pnpm test`、`pnpm build`，全部通过。
- 当前全量测试为 414 个通过测试，覆盖度明显高于 2026-06-02 审计报告里的 180 个测试。
- 当前下一阶段的主要风险不是“后端没建”，而是：真实用户路径仍有本地模拟、AI 降级不够柔性、OCR 缺运营面、部分 UI 二级动作仍未闭合。

| 优先级 | 当前状态                                                               | 用户可见风险                                       | 目标结果                                                                 |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| P0     | `/m/diagnosis` 只是本地 AI 聊天；报数截图路径本地拼接。                | 手工验收无法证明真实 AI 诊断和私有截图证据链。     | 主播端 AI 和报数截图都调用真实 API，并有失败态。                         |
| P1     | `runAiGateway` 遇到结构化输出 schema 不匹配会立即失败。                | 真实 LLM JSON 漂移会直接变成故障，而不是自动切备。 | schema mismatch 被视为 provider 失败，继续尝试下一个 provider。          |
| P2     | OCR job API、RLS 和安全字段已经具备，但缺 runner、重试上限、确认面板。 | OCR 能创建和测试，但无法安全规模化运营。           | 队列、失败、重试、待确认结果可见且可操作。                               |
| P3     | M10/M11 已明显推进，但移动端/桌面端 AI 与部分二级动作仍有本地行为。    | UI 看起来完整，但部分点击不走真实业务链路。        | 剩余二级按钮要么接真 API，要么导航到现有模块，要么明确标记为不在本阶段。 |

---

## 文件结构

### P0：主播端 AI 诊断与报数截图接真

- 修改 `components/reference-ui/streamer-mobile-reference.jsx`：新增真实 AI 诊断 action，替换本地 `setTimeout` AI 回复；报数提交前请求 signed upload metadata。
- 修改 `components/reference-ui/streamer-mobile-reference.test.jsx`：断言 `/api/ai/diagnosis`、`/api/uploads/signed` 和 `/api/live-tasks/:id/reports` 的调用顺序与 payload。
- 读取 `app/api/ai/diagnosis/route.ts`：保持 `{ result, agentOutput, validation }` 响应兼容。
- 读取 `app/api/uploads/signed/route.ts`：请求 `{ category, ownerId, fileName }`，消费 `{ bucket, path, signedUrl, token }`。
- 读取 `app/api/uploads/signed-route.test.ts`：保持 route contract 不变。

### P1：AI Gateway 灰度可靠性

- 修改 `features/ai/llm-gateway.ts`：结构化输出 schema 校验失败时继续 fallback provider。
- 修改 `features/ai/llm-gateway.test.ts`：新增 primary provider 返回 schema-invalid 输出、deterministic provider 成功兜底的测试。
- 读取 `features/ai/providers/provider-smoke.test.ts`：保持 env-gated real provider smoke 兼容。

### P2：OCR Job 生产运行面

- 修改 `features/ai/ocr-jobs.ts`：增加 retry ceiling 和安全队列选择 helper。
- 修改 `features/ai/ocr-jobs.test.ts`：覆盖最大重试次数、队列顺序、provider 失败、`needs_confirmation` 持久化。
- 新建 `app/api/ocr/jobs/run/route.ts`：staff-only runner endpoint，可运行下一条 queued job 或指定 job。
- 新建 `app/api/ocr/jobs/run/route.test.ts`：覆盖鉴权、角色边界、安全返回、provider unconfigured、max-attempt refusal。
- 修改 `components/reference-ui/ops-reference.jsx`：在 M10 或 AI operations 相关区域增加 OCR 运营面板。
- 修改 `components/reference-ui/ops-reference.test.jsx`：断言运营可见 queued、failed、needs-confirmation jobs，但不暴露 raw provider JSON。

### P3：剩余二级 UI 闭环

- 修改 `components/reference-ui/streamer-desktop-reference.jsx`：桌面端 AI 诊断也调用 `/api/ai/diagnosis`，复用移动端响应格式。
- 修改 `components/reference-ui/streamer-desktop-reference.test.jsx`：断言桌面 AI 调用诊断 API。
- 修改 `components/reference-ui/streamer-mobile-reference.jsx`：剩余 profile actions 导航到现有 live panel 或展示明确 pending panel。
- 修改 `components/reference-ui/ops-reference.jsx`：M1/M2/M4/M5/M6 二级按钮分类为真实 API、本地过滤、现有模块导航或明确待立项。
- 修改 `docs/reports/2026-06-03-ui-business-closure-gap-inventory.md`：实施后更新闭环状态。

---

## 范围边界

本阶段包含：

- 主播端移动 AI 诊断真实 API 调用。
- 报数截图使用私有 signed upload path。
- AI gateway 在结构化 schema mismatch 后继续 fallback。
- OCR job 的生产运行入口、重试上限和运营可视化。
- 现有模块内的二级 UI 操作闭环。
- 测试与验收报告。

本阶段不包含：

- 新增外部服务凭据。
- 真实支付、发票、税务、SSO、厂商门户、私有化部署。
- 密码重置、2FA 绑定、登录设备管理等完整账号安全体系。
- 生产部署或破坏性数据库重置。

硬闸门：

- 遇到不可逆数据删除，停止。
- 需要新增外部服务 credential，停止。
- 需要默认开启 active auto-review，停止。
- 需要放宽 streamer 或 finance 的 RLS 权限，停止。

---

### Task 0：基线与分支安全

**文件：**

- 读取：`package.json`
- 读取：`components/reference-ui/streamer-mobile-reference.test.jsx`
- 读取：`features/ai/llm-gateway.test.ts`
- 读取：`features/ai/ocr-jobs.test.ts`

- [ ] **Step 1：确认工作区状态**

运行：

```bash
git status --short --branch
```

期望：当前分支是 `codex/full-project-ui` 或独立实施分支；没有无关 dirty files。

- [ ] **Step 2：运行基线闸门**

运行：

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

期望：全部通过。若失败，先记录第一个失败测试或编译错误；在理解失败来源前不要开始 P0。

- [ ] **Step 3：记录基线证据**

在 PR 或最终实施说明中使用：

```markdown
实施前基线：

- `pnpm type-check`: pass
- `pnpm lint`: pass
- `pnpm test`: pass
- `pnpm build`: pass
```

期望：后续 reviewer 能判断失败是本阶段引入还是历史遗留。

---

### Task 1：P0 移动端 AI 诊断 API 绑定

**文件：**

- 修改：`components/reference-ui/streamer-mobile-reference.test.jsx`
- 修改：`components/reference-ui/streamer-mobile-reference.jsx`
- 读取：`app/api/ai/diagnosis/route.ts`
- 读取：`features/ai/streamer-diagnosis-agent.ts`

- [ ] **Step 1：新增失败的移动端 AI smoke 测试**

在 `components/reference-ui/streamer-mobile-reference.test.jsx` 中新增：

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

期望：失败，因为当前 `StreamerAI.send` 使用本地 `setTimeout`，不会调用 `/api/ai/diagnosis`。

- [ ] **Step 2：运行失败测试**

运行：

```bash
pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx -t "AI diagnosis"
```

期望：FAIL，失败点是 fetch 调用没有发生。

- [ ] **Step 3：替换本地 AI timeout**

在 `components/reference-ui/streamer-mobile-reference.jsx` 中，将 `StreamerAI.send` 改成 async，并调用 context action：

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

  // 现有 JSX 保持不变
}
```

期望：prompt chip 和手动发送都走真实 action。

- [ ] **Step 4：在 mobile actions 中加入 `askDiagnosis`**

在 `StreamerMobileReferenceApp` 的 `actions` 对象里新增：

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

在 normalization helpers 附近新增：

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

期望：兼容旧 `result.answer` 和新 `agentOutput`。

- [ ] **Step 5：运行移动端 AI 诊断测试**

运行：

```bash
pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx -t "AI diagnosis"
```

期望：PASS。

- [ ] **Step 6：提交 Task 1**

运行：

```bash
git add components/reference-ui/streamer-mobile-reference.jsx components/reference-ui/streamer-mobile-reference.test.jsx
git commit -m "feat: wire mobile streamer AI diagnosis"
```

期望：生成一个聚焦提交。

---

### Task 2：P0 报数截图使用 Signed Upload 路径

**文件：**

- 修改：`components/reference-ui/streamer-mobile-reference.test.jsx`
- 修改：`components/reference-ui/streamer-mobile-reference.jsx`
- 读取：`app/api/uploads/signed/route.ts`
- 读取：`features/storage/private-upload.ts`
- 读取：`app/api/live-tasks/[taskId]/reports/route.ts`

- [ ] **Step 1：更新 report smoke，强制要求 signed upload**

在现有 `"starts, stops, and submits a live report from the streamer task flow"` 测试中，为 `/api/uploads/signed` 增加 mock：

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

把点击 `"确认无误，提交审核"` 后的期望改为：

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

期望：失败，因为当前组件直接发送本地拼接 path。

- [ ] **Step 2：运行失败测试**

运行：

```bash
pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx -t "starts, stops, and submits"
```

期望：FAIL，因为 `/api/uploads/signed` 没有被调用。

- [ ] **Step 3：提交报数前请求 signed upload metadata**

将 `submitReport` 改为：

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

期望：报数截图证据使用私有 signed path。

- [ ] **Step 4：运行 signed upload route 与 mobile smoke**

运行：

```bash
pnpm vitest run app/api/uploads/signed-route.test.ts components/reference-ui/streamer-mobile-reference.test.jsx -t "starts, stops, and submits"
```

期望：PASS。

- [ ] **Step 5：提交 Task 2**

运行：

```bash
git add components/reference-ui/streamer-mobile-reference.jsx components/reference-ui/streamer-mobile-reference.test.jsx
git commit -m "feat: use signed report screenshot evidence paths"
```

期望：生成一个聚焦提交。

---

### Task 3：P1 结构化 Schema 失败后继续 Fallback

**文件：**

- 修改：`features/ai/llm-gateway.test.ts`
- 修改：`features/ai/llm-gateway.ts`

- [ ] **Step 1：新增失败的 structured fallback 测试**

在 `features/ai/llm-gateway.test.ts` 新增：

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

期望：失败，因为 gateway 当前会立即返回 `schema_validation_failed`。

- [ ] **Step 2：运行失败测试**

运行：

```bash
pnpm vitest run features/ai/llm-gateway.test.ts -t "schema-invalid"
```

期望：FAIL。

- [ ] **Step 3：把 schema mismatch 当作候选 provider 失败**

在 `features/ai/llm-gateway.ts` 中，把结构化校验分支从立即 return 改成记录失败并继续：

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

期望：primary provider schema mismatch 后会尝试下一个 provider。

- [ ] **Step 4：保留全 provider 失败摘要**

确保最终失败仍返回：

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

期望：所有 provider 都失败时，调用方能看到聚合错误摘要。

- [ ] **Step 5：运行 gateway 与 provider smoke**

运行：

```bash
pnpm vitest run features/ai/llm-gateway.test.ts features/ai/providers/provider-smoke.test.ts
```

期望：PASS；没有真实 provider env 时，smoke 自动 skip。

- [ ] **Step 6：提交 Task 3**

运行：

```bash
git add features/ai/llm-gateway.ts features/ai/llm-gateway.test.ts
git commit -m "feat: fallback on structured AI schema mismatch"
```

期望：生成一个聚焦提交。

---

### Task 4：P2 OCR 重试上限与队列 Helper

**文件：**

- 修改：`features/ai/ocr-jobs.test.ts`
- 修改：`features/ai/ocr-jobs.ts`

- [ ] **Step 1：新增最大重试次数失败测试**

在 `features/ai/ocr-jobs.test.ts` 新增：

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

如测试 helper 需要，扩展 fixture 类型：

```ts
maxAttempts?: number;
```

期望：失败，因为当前 `retryOcrJob` 没有重试上限。

- [ ] **Step 2：新增队列选择失败测试**

在 `features/ai/ocr-jobs.test.ts` 新增：

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

期望：失败，因为 `listRunnableOcrJobs` 还不存在。

- [ ] **Step 3：给 OCR job record 增加 `maxAttempts`**

在 `features/ai/ocr-jobs.ts` 中扩展 `OcrJobRecord`：

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

在 `toOcrJobRecord` 中映射：

```ts
maxAttempts: Number(row.max_attempts ?? row.maxAttempts ?? 3),
```

期望：现有调用方能拿到重试上限。

- [ ] **Step 4：强制重试上限**

在 `retryOcrJob` 读取 job 后加入：

```ts
if (job.attempt >= job.maxAttempts) {
  throw new Error("OCR job reached max retry attempts");
}
```

期望：达到上限的 job 不再被重新入队。

- [ ] **Step 5：新增队列 helper**

从 `features/ai/ocr-jobs.ts` 导出：

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

期望：production runner 可以只选 queued OCR jobs，不暴露其他 background jobs。

- [ ] **Step 6：运行 OCR job 测试**

运行：

```bash
pnpm vitest run features/ai/ocr-jobs.test.ts
```

期望：PASS。

- [ ] **Step 7：提交 Task 4**

运行：

```bash
git add features/ai/ocr-jobs.ts features/ai/ocr-jobs.test.ts
git commit -m "feat: harden OCR job retry queue"
```

期望：生成一个聚焦提交。

---

### Task 5：P2 OCR Job Runner API

**文件：**

- 新建：`app/api/ocr/jobs/run/route.test.ts`
- 新建：`app/api/ocr/jobs/run/route.ts`
- 修改：`features/ai/ocr-jobs.ts`

- [ ] **Step 1：编写 runner route 测试**

新建 `app/api/ocr/jobs/run/route.test.ts`：

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

期望：失败，因为 route 还不存在。

- [ ] **Step 2：实现 runner route**

新建 `app/api/ocr/jobs/run/route.ts`：

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

期望：route 只返回安全 metadata，不包含 `imageBase64`、`imageUrl`、`rawResponse`、provider text lines 或完整 OCR raw result。

- [ ] **Step 3：运行 runner route 测试**

运行：

```bash
pnpm vitest run app/api/ocr/jobs/run/route.test.ts
```

期望：PASS。

- [ ] **Step 4：运行 OCR route 回归**

运行：

```bash
pnpm vitest run app/api/ocr/jobs/route.test.ts app/api/ocr/jobs/[jobId]/route.test.ts app/api/ocr/jobs/run/route.test.ts features/ai/ocr-jobs.test.ts
```

期望：PASS。

- [ ] **Step 5：提交 Task 5**

运行：

```bash
git add app/api/ocr/jobs/run features/ai/ocr-jobs.ts features/ai/ocr-jobs.test.ts
git commit -m "feat: add staff OCR job runner"
```

期望：生成一个聚焦提交。

---

### Task 6：P2 OCR 运营面板

**文件：**

- 修改：`components/reference-ui/ops-reference.test.jsx`
- 修改：`components/reference-ui/ops-reference.jsx`

- [ ] **Step 1：新增 OCR operations smoke**

在 `components/reference-ui/ops-reference.test.jsx` 新增：

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

期望：失败，因为当前没有 OCR operations panel。

- [ ] **Step 2：增加 OCR jobs state 和 actions**

在 `OpsReferenceApp` 内增加 state：

```jsx
const [ocrJobsState, setOcrJobsState] = React.useState(null);
```

增加 actions：

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

期望：OCR 面板可以刷新和运行 jobs。

- [ ] **Step 3：在 War Room 增加 OCR operations UI**

在 `ScreenWarRoom` 增加 `OCR 作业` 按钮，并渲染 `OcrOperationsPanel`：

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

注意：样式沿用现有 reference UI；表格不能渲染 `imageBase64`、`imageUrl`、`rawResponse`、provider text lines 或完整 OCR raw result。

- [ ] **Step 4：运行 OCR operations smoke**

运行：

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "OCR operations"
```

期望：PASS。

- [ ] **Step 5：提交 Task 6**

运行：

```bash
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: surface OCR operations queue"
```

期望：生成一个聚焦提交。

---

### Task 7：P3 桌面端 AI 诊断 API 绑定

**文件：**

- 修改：`components/reference-ui/streamer-desktop-reference.test.jsx`
- 修改：`components/reference-ui/streamer-desktop-reference.jsx`

- [ ] **Step 1：新增桌面 AI smoke**

在 `components/reference-ui/streamer-desktop-reference.test.jsx` 新增：

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

期望：失败，因为桌面端 AI 当前还是本地 timeout 文案。

- [ ] **Step 2：实现桌面 `askDiagnosis` action**

在 `StreamerDesktopReferenceApp` 中新增与移动端等价的 action：

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

期望：桌面和移动端使用一致的响应格式。

- [ ] **Step 3：替换桌面本地 AI timeout**

修改 `components/reference-ui/streamer-desktop-reference.jsx` 中 `ScreenAI.send`，调用 `actions.askDiagnosis`，不再使用本地 `setTimeout` 回复。

期望：桌面 AI 也变成 live API-backed。

- [ ] **Step 4：运行桌面 AI 测试**

运行：

```bash
pnpm vitest run components/reference-ui/streamer-desktop-reference.test.jsx -t "AI diagnosis"
```

期望：PASS。

- [ ] **Step 5：提交 Task 7**

运行：

```bash
git add components/reference-ui/streamer-desktop-reference.jsx components/reference-ui/streamer-desktop-reference.test.jsx
git commit -m "feat: wire desktop streamer AI diagnosis"
```

期望：生成一个聚焦提交。

---

### Task 8：P3 二级按钮闭环审计

**文件：**

- 修改：`components/reference-ui/ops-reference.test.jsx`
- 修改：`components/reference-ui/ops-reference.jsx`
- 修改：`components/reference-ui/streamer-mobile-reference.test.jsx`
- 修改：`components/reference-ui/streamer-mobile-reference.jsx`
- 修改：`components/reference-ui/streamer-desktop-reference.test.jsx`
- 修改：`components/reference-ui/streamer-desktop-reference.jsx`
- 修改：`docs/reports/2026-06-03-ui-business-closure-gap-inventory.md`

- [ ] **Step 1：生成当前 no-op handler 清单**

运行：

```bash
rg -n "onClick=\\{\\(\\) => \\{\\}\\}|setTimeout\\(|暂未接入|本地|local responses|manual-submit\\.png|MY_TASKS|MY_VIDEOS" components app docs/reports
```

期望：每个命中项被归为下面四类之一：

- 导航到现有中心
- 本地状态过滤
- 真实 API action
- 明确不在本阶段，并有可见 pending copy

- [ ] **Step 2：给已闭合项目加回归断言**

更新现有 UI smoke，确保这些已闭合点不会回退：

```jsx
expect(
  screen.queryByText("ScreenWarRoom still uses static calculations"),
).not.toBeInTheDocument();
expect(
  screen.queryByText("M11 route has no visible screen"),
).not.toBeInTheDocument();
```

同时保留已有测试覆盖：

- M10 pricing、matching、project review 调用。
- M11 billing status 与 refresh。
- 移动端 profile rows 导航到录屏与结算 panel。
- 桌面端 task/profile/recording API refresh。

期望：未来重构不会重新引入 2026-06-03 的缺口。

- [ ] **Step 3：把产品范围依赖动作变成明确 pending panel**

对于账号隐私、平台绑定、密码、2FA、设备管理等需要单独账号体系切片的控制，渲染明确 pending panel，不允许空点击。

使用这种提示模式：

```jsx
showToast("账号安全设置需要独立账号体系切片，本阶段不启用。");
```

期望：UI 不再静默无动作。

- [ ] **Step 4：更新缺口盘点状态**

在 `docs/reports/2026-06-03-ui-business-closure-gap-inventory.md` 新增：

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

期望：历史报告可追溯，当前状态明确。

- [ ] **Step 5：运行 UI smoke**

运行：

```bash
pnpm test:ui-smoke
pnpm vitest run components/reference-ui/ops-reference.test.jsx components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx
```

期望：PASS。

- [ ] **Step 6：提交 Task 8**

运行：

```bash
git add components/reference-ui docs/reports/2026-06-03-ui-business-closure-gap-inventory.md
git commit -m "docs: close next-stage UI gap inventory"
```

期望：生成一个聚焦提交。

---

### Task 9：全量回归与验收报告

**文件：**

- 新建：`docs/reports/2026-06-05-next-stage-real-ai-ui-closure-report.md`
- 读取：`docs/manual-acceptance-test-cases.md`

- [ ] **Step 1：运行下一阶段聚焦测试**

运行：

```bash
pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx components/reference-ui/ops-reference.test.jsx
pnpm vitest run features/ai/llm-gateway.test.ts features/ai/ocr-jobs.test.ts
pnpm vitest run app/api/uploads/signed-route.test.ts app/api/ai/diagnosis/route.test.ts app/api/ocr/jobs/route.test.ts app/api/ocr/jobs/[jobId]/route.test.ts app/api/ocr/jobs/run/route.test.ts
```

期望：PASS。

- [ ] **Step 2：运行阶段回归套件**

运行：

```bash
pnpm test:ai-system
pnpm test:p4-flywheel
pnpm test:p5-commercialization
pnpm test:golden
pnpm test:ui-smoke
```

期望：PASS。

- [ ] **Step 3：运行仓库闸门**

运行：

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

期望：PASS。

- [ ] **Step 4：编写验收报告**

新建 `docs/reports/2026-06-05-next-stage-real-ai-ui-closure-report.md`：

```markdown
# 下一阶段真实 AI 与 UI 闭环验收报告

日期：2026-06-05

## 结论

通过。主播 AI 诊断、报数截图证据、AI gateway fallback、OCR operations 和二级 UI 闭环均已接入真实 API，并有回归测试覆盖。

## 已闭合缺口

- `/m/diagnosis` 调用 `/api/ai/diagnosis` 并渲染真实 agent 输出。
- 主播报数截图提交先请求 `/api/uploads/signed`，再创建 live report。
- `runAiGateway` 在结构化 schema mismatch 后继续 fallback provider。
- OCR jobs 具备重试上限、staff runner route 和运营面板。
- 桌面端 AI 诊断调用 `/api/ai/diagnosis`。
- 剩余二级控制已分类为真实动作、live navigation、本地过滤或明确 pending panel。

## 验证

- `pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx components/reference-ui/ops-reference.test.jsx`：pass
- `pnpm vitest run features/ai/llm-gateway.test.ts features/ai/ocr-jobs.test.ts`：pass
- `pnpm test:ai-system`：pass
- `pnpm test:p4-flywheel`：pass
- `pnpm test:p5-commercialization`：pass
- `pnpm test:golden`：pass
- `pnpm test:ui-smoke`：pass
- `pnpm lint`：pass
- `pnpm type-check`：pass
- `pnpm test`：pass
- `pnpm build`：pass

## 剩余范围

- 真实外部 provider 凭据仍保持 env-gated。
- active auto-review 仍受 rollout metrics 和显式 active request 闸门约束。
- 完整账号安全设置仍是独立 auth/profile 切片。
```

期望：最终报告把代码改动与用户可见闭环对应起来。

- [ ] **Step 5：提交验收报告**

运行：

```bash
git add docs/reports/2026-06-05-next-stage-real-ai-ui-closure-report.md
git commit -m "docs: report next-stage real AI UI closure"
```

期望：生成一个聚焦 docs 提交。

---

## 验收矩阵

| 区域             | 验收命令                                                                                                     | 必须证明                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 移动 AI          | `pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx -t "AI diagnosis"`               | `/api/ai/diagnosis` 被调用，真实 answer 渲染。      |
| 移动证据         | `pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx -t "starts, stops, and submits"` | `/api/uploads/signed` 在 report creation 之前调用。 |
| Gateway fallback | `pnpm vitest run features/ai/llm-gateway.test.ts`                                                            | primary provider schema-invalid 后 fallback 成功。  |
| OCR job ops      | `pnpm vitest run features/ai/ocr-jobs.test.ts app/api/ocr/jobs/run/route.test.ts`                            | retry ceiling 和 runner route 有覆盖。              |
| OCR 面板         | `pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "OCR operations"`                         | staff-visible queue 只展示安全字段。                |
| 桌面 AI          | `pnpm vitest run components/reference-ui/streamer-desktop-reference.test.jsx -t "AI diagnosis"`              | 桌面 AI 调用 diagnosis API。                        |
| 全项目           | `pnpm lint && pnpm type-check && pnpm test && pnpm build`                                                    | 仓库全绿。                                          |

---

## 推荐上线顺序

1. P0 移动端 AI 诊断与截图上传。
2. P1 gateway fallback 可靠性。
3. P2 OCR queue 和 staff runner。
4. P2 OCR operations panel。
5. P3 桌面端 AI 与二级按钮闭环。
6. 最终回归与验收报告。

理由：P0 直接闭合最影响手工验收的真实用户路径；P1 保护所有真实 provider 使用；P2 让 OCR 可运营；P3 在高风险路径接真后清掉剩余 UI 歧义。

---

## 自检

- 需求覆盖：P0、P1、P2、P3 都映射到了具体任务、文件、命令和验收结果。
- 占位扫描：没有需要后补的实现标记。
- 类型一致性：route 名、函数名、测试路径均匹配当前代码表面。
- 风险姿态：active auto-review、新 credential、破坏性数据库操作和完整账号安全范围仍排除在外。
