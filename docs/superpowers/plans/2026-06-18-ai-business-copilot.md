# AI Business Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a controlled natural-language business copilot that answers MCN operating questions from authorized role dashboard data without allowing raw SQL or business mutations.

**Architecture:** Add a deterministic business-copilot agent that classifies Chinese natural-language questions into a small intent set, extracts facts from the existing role-home dashboard DTO, and returns a structured answer with facts, findings, recommendations, caveats, and drilldowns. Register the agent as a read-only AI tool so every query goes through the existing invocation ledger, usage metering, masking, and audit path, then expose it through `POST /api/ai/business-copilot` and render a compact panel on the role homepage.

**Tech Stack:** TypeScript, Next.js App Router route handlers, existing AI tool layer, existing role dashboard loader, React reference UI, Vitest, React Testing Library.

---

## Scope

This plan implements Phase 1 from `docs/superpowers/specs/2026-06-18-ai-business-copilot-design.md`:

- Natural-language questions for MCN staff roles.
- Four deterministic intents: `executive_health`, `operations_priority`, `settlement_risk`, `evidence_quality`.
- `unsupported` fallback for questions outside the safe business scope.
- Facts sourced only from `RoleHomeDashboardDto`.
- Read-only AI tool invocation with existing AI ledger, usage, and audit.
- A role-home UI panel for asking and reading answers.

This plan does not implement arbitrary SQL, cross-organization BI, active automation, scheduled insight scans, or LLM-based intent routing.

## File Structure

- Create: `features/ai/business-copilot-agent.ts` - intent classification, fact extraction, safe answer construction, and validation.
- Create: `features/ai/business-copilot-agent.test.ts` - pure tests for each intent, role masking, unsupported questions, and no executable fields.
- Modify: `features/ai/ai-tool-layer.ts` - register `business_copilot_answer` as a read-only MCN staff tool.
- Modify: `features/ai/ai-tool-layer.test.ts` - cover tool registration, invocation ledger, audit, and SQL rejection behavior.
- Create: `app/api/ai/business-copilot/route.ts` - authenticated route that loads the role dashboard and calls the AI tool layer.
- Create: `app/api/ai/business-copilot/route.test.ts` - route tests for success, empty question, streamer denial, authentication, and dashboard loading.
- Modify: `components/reference-ui/ops-reference.jsx` - add `BusinessCopilotPanel` to `ScreenRoleHome`.
- Modify: `components/reference-ui/ops-reference.test.jsx` - UI tests for ask flow, facts rendering, unsupported state, and route drilldown.
- Modify: `docs/product-function-document.md` - document the new M10 AI business copilot API, safety boundary, and current shipped scope after implementation.

---

## Task 1: Business Copilot Agent

**Files:**

- Create: `features/ai/business-copilot-agent.ts`
- Create: `features/ai/business-copilot-agent.test.ts`

- [x] **Step 1: Write the failing agent tests**

Create `features/ai/business-copilot-agent.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  classifyBusinessCopilotIntent,
  runBusinessCopilotAgent,
} from "./business-copilot-agent";
import type { RoleHomeDashboardDto } from "@/features/dashboards/role-home";

const ownerDashboard: RoleHomeDashboardDto = {
  profile: {
    role: "owner",
    title: "经营总览看板",
    subtitle: "关注收入、毛利、履约和高风险动作",
    scopeLabel: "全组织",
  },
  kpis: [
    { key: "activeProjects", label: "进行中项目", value: 3 },
    {
      key: "vendorReceivable",
      label: "本月厂家应收",
      value: 120000,
      unit: "元",
    },
    { key: "estimatedGross", label: "预估毛利", value: 36000, unit: "元" },
    { key: "grossMarginRate", label: "毛利率", value: 30, unit: "%" },
    { key: "highRiskItems", label: "高风险事项", value: 2 },
  ],
  queue: [
    {
      key: "project-alpha",
      title: "Alpha Launch",
      subtitle: "项目执行中",
      tone: "blue",
      target: { route: "project", id: "project-alpha" },
    },
  ],
  risks: [
    {
      key: "reopenedBatches",
      title: "结算批次重开",
      subtitle: "需要负责人关注",
      tone: "red",
      target: { route: "settle", id: "batch-1" },
    },
  ],
  drilldowns: [
    {
      key: "audit",
      title: "查看审计",
      subtitle: "高风险动作记录",
      tone: "neutral",
      target: { route: "audit" },
    },
  ],
  generatedAt: "2026-06-18T04:00:00.000Z",
};

const financeDashboard: RoleHomeDashboardDto = {
  profile: {
    role: "finance",
    title: "结算安全看板",
    subtitle: "关注可结算金额和证据风险",
    scopeLabel: "授权项目",
  },
  kpis: [
    {
      key: "settlementPoolAmount",
      label: "可结算池金额",
      value: 88000,
      unit: "元",
    },
    { key: "settlementPoolCount", label: "可结算报数", value: 14 },
    { key: "draftBatches", label: "待生成批次", value: 2 },
    {
      key: "weakEvidenceAmount",
      label: "弱证据金额",
      value: 12000,
      unit: "元",
    },
    { key: "reopenedBatches", label: "重开批次", value: 1 },
  ],
  queue: [],
  risks: [
    {
      key: "weakEvidence",
      title: "弱证据金额偏高",
      subtitle: "先复核黄红证据",
      tone: "amber",
      target: { route: "settle" },
    },
  ],
  drilldowns: [],
  generatedAt: "2026-06-18T04:00:00.000Z",
};

describe("business copilot agent", () => {
  it("classifies common Chinese business questions deterministically", () => {
    expect(classifyBusinessCopilotIntent("这个月经营健康吗")).toBe(
      "executive_health",
    );
    expect(classifyBusinessCopilotIntent("今天团队先处理什么")).toBe(
      "operations_priority",
    );
    expect(classifyBusinessCopilotIntent("哪些金额可以安全结算")).toBe(
      "settlement_risk",
    );
    expect(classifyBusinessCopilotIntent("哪些截图证据需要复核")).toBe(
      "evidence_quality",
    );
    expect(classifyBusinessCopilotIntent("帮我写一首歌")).toBe("unsupported");
  });

  it("answers owner executive health questions with sourced dashboard facts", () => {
    const result = runBusinessCopilotAgent({
      question: "这个月经营健康吗",
      dashboard: ownerDashboard,
    });

    expect(result).toMatchObject({
      intent: "executive_health",
      answer: "经营健康判断已基于当前角色看板生成。",
      generatedAt: "2026-06-18T04:00:00.000Z",
    });
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "本月厂家应收",
          value: 120000,
          sourceTool: "role_home_dashboard",
          sourceId: "kpi:vendorReceivable",
        }),
        expect.objectContaining({
          label: "毛利率",
          value: 30,
          sourceId: "kpi:grossMarginRate",
        }),
      ]),
    );
    expect(result.findings[0]?.evidence).toEqual(
      expect.arrayContaining([
        { sourceTool: "role_home_dashboard", sourceId: "kpi:grossMarginRate" },
      ]),
    );
    expect(result.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requiresHumanApproval: true }),
      ]),
    );
  });

  it("answers finance settlement risk without owner-only financial keys", () => {
    const result = runBusinessCopilotAgent({
      question: "弱证据金额有多少",
      dashboard: financeDashboard,
    });
    const serialized = JSON.stringify(result);

    expect(result.intent).toBe("settlement_risk");
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: "kpi:weakEvidenceAmount" }),
        expect.objectContaining({ sourceId: "kpi:settlementPoolAmount" }),
      ]),
    );
    expect(serialized).not.toContain("vendorReceivable");
    expect(serialized).not.toContain("estimatedGross");
    expect(serialized).not.toContain("supplierCost");
    expect(serialized).not.toContain("internalRisk");
  });

  it("does not run SQL-looking questions and returns unsupported safely", () => {
    const result = runBusinessCopilotAgent({
      question: "select * from settlement_batches",
      dashboard: ownerDashboard,
    });

    expect(result.intent).toBe("unsupported");
    expect(result.facts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("sql");
  });
});
```

- [x] **Step 2: Run the failing test**

Run:

```bash
pnpm vitest run features/ai/business-copilot-agent.test.ts
```

Expected: FAIL because `features/ai/business-copilot-agent.ts` does not exist.

- [x] **Step 3: Implement the agent**

Create `features/ai/business-copilot-agent.ts`:

```ts
import type {
  DashboardQueueItem,
  RoleHomeDashboardDto,
} from "@/features/dashboards/role-home";

export type BusinessCopilotIntent =
  | "executive_health"
  | "operations_priority"
  | "settlement_risk"
  | "evidence_quality"
  | "unsupported";

export type BusinessCopilotFact = {
  label: string;
  value: number | string;
  unit?: string;
  sourceTool: "role_home_dashboard";
  sourceId: string;
};

export type BusinessCopilotAnswer = {
  question: string;
  intent: BusinessCopilotIntent;
  answer: string;
  facts: BusinessCopilotFact[];
  findings: Array<{
    summary: string;
    evidence: Array<{ sourceTool: "role_home_dashboard"; sourceId: string }>;
  }>;
  recommendations: Array<{
    proposal: string;
    requiresHumanApproval: true;
    target?: DashboardQueueItem["target"];
  }>;
  drilldowns: Array<{
    label: string;
    target: DashboardQueueItem["target"];
  }>;
  caveats: string[];
  generatedAt: string;
};

export function classifyBusinessCopilotIntent(
  question: string,
): BusinessCopilotIntent {
  const normalized = question.trim().toLowerCase();

  if (!normalized || looksLikeRawSql(normalized)) return "unsupported";
  if (
    /(结算|金额|财务|批次|应付|弱证据|重开|settlement|finance)/i.test(
      normalized,
    )
  ) {
    return "settlement_risk";
  }
  if (/(ocr|截图|证据|黄|红|复核|时长|evidence|screenshot)/i.test(normalized)) {
    return "evidence_quality";
  }
  if (/(今天|优先|待办|卡住|排班|报数|异常|处理|priority)/i.test(normalized)) {
    return "operations_priority";
  }
  if (
    /(健康|毛利|利润|收入|风险|老板|经营|margin|revenue|profit)/i.test(
      normalized,
    )
  ) {
    return "executive_health";
  }

  return "unsupported";
}

export function runBusinessCopilotAgent(input: {
  question: string;
  dashboard: RoleHomeDashboardDto;
}): BusinessCopilotAnswer {
  const intent = classifyBusinessCopilotIntent(input.question);
  const base = {
    question: input.question.trim(),
    intent,
    generatedAt: input.dashboard.generatedAt,
  };

  if (intent === "unsupported") {
    return {
      ...base,
      answer: "这个问题不在当前经营问答的安全范围内。",
      facts: [],
      findings: [],
      recommendations: [
        {
          proposal: "请改问经营健康、今日优先级、结算风险或证据质量。",
          requiresHumanApproval: true,
        },
      ],
      drilldowns: [],
      caveats: ["经营问答不会执行 SQL、跨组织查询或生产写动作。"],
    };
  }

  const facts = factsForIntent(intent, input.dashboard);
  const drilldowns = collectDrilldowns(input.dashboard);

  return {
    ...base,
    answer: answerForIntent(intent),
    facts,
    findings: facts.length
      ? [
          {
            summary: findingForIntent(intent),
            evidence: facts.map((fact) => ({
              sourceTool: fact.sourceTool,
              sourceId: fact.sourceId,
            })),
          },
        ]
      : [],
    recommendations: recommendationsForIntent(intent, input.dashboard),
    drilldowns,
    caveats: caveatsForDashboard(input.dashboard),
  };
}

function looksLikeRawSql(value: string) {
  return /\b(select|insert|update|delete|drop|alter|truncate)\b/i.test(value);
}

function factsForIntent(
  intent: BusinessCopilotIntent,
  dashboard: RoleHomeDashboardDto,
): BusinessCopilotFact[] {
  const keysByIntent: Record<
    Exclude<BusinessCopilotIntent, "unsupported">,
    string[]
  > = {
    executive_health: [
      "activeProjects",
      "vendorReceivable",
      "estimatedGross",
      "grossMarginRate",
      "highRiskItems",
    ],
    operations_priority: [
      "myTodayTasks",
      "notStartedTasks",
      "pendingReports",
      "streamerReminders",
      "activeProjects",
      "pendingReports",
      "anomalyTasks",
    ],
    settlement_risk: [
      "settlementPoolAmount",
      "settlementPoolCount",
      "draftBatches",
      "weakEvidenceAmount",
      "reopenedBatches",
    ],
    evidence_quality: [
      "pendingReports",
      "weakEvidenceAmount",
      "highRiskItems",
      "reopenedBatches",
    ],
  };

  const allowedKeys = new Set(keysByIntent[intent]);

  return dashboard.kpis
    .filter((kpi) => allowedKeys.has(kpi.key))
    .map((kpi) => ({
      label: kpi.label,
      value: kpi.value,
      unit: kpi.unit,
      sourceTool: "role_home_dashboard" as const,
      sourceId: `kpi:${kpi.key}`,
    }));
}

function answerForIntent(
  intent: Exclude<BusinessCopilotIntent, "unsupported">,
) {
  const answers = {
    executive_health: "经营健康判断已基于当前角色看板生成。",
    operations_priority: "今日优先级已基于当前待办和风险队列生成。",
    settlement_risk: "结算风险已基于当前结算安全看板生成。",
    evidence_quality: "证据质量判断已基于当前报数和结算风险生成。",
  };
  return answers[intent];
}

function findingForIntent(
  intent: Exclude<BusinessCopilotIntent, "unsupported">,
) {
  const findings = {
    executive_health: "需要同时关注经营结果和高风险事项。",
    operations_priority: "优先处理会阻塞交付和报数闭环的事项。",
    settlement_risk: "结算前应先复核弱证据和重开批次。",
    evidence_quality: "证据不足会影响审核可信度和结算安全。",
  };
  return findings[intent];
}

function recommendationsForIntent(
  intent: Exclude<BusinessCopilotIntent, "unsupported">,
  dashboard: RoleHomeDashboardDto,
) {
  const primaryTarget =
    dashboard.risks[0]?.target ??
    dashboard.queue[0]?.target ??
    dashboard.drilldowns[0]?.target;
  const proposalByIntent = {
    executive_health: "先打开风险最高的项目或审计记录复核。",
    operations_priority: "先处理优先队列顶部事项，再进入对应模块。",
    settlement_risk: "先复核弱证据和重开批次，再推进结算动作。",
    evidence_quality: "先核对截图、系统时长和人工复核原因。",
  };

  return [
    {
      proposal: proposalByIntent[intent],
      requiresHumanApproval: true as const,
      ...(primaryTarget ? { target: primaryTarget } : {}),
    },
  ];
}

function collectDrilldowns(dashboard: RoleHomeDashboardDto) {
  return [...dashboard.risks, ...dashboard.queue, ...dashboard.drilldowns]
    .filter((item) => item.target?.route)
    .slice(0, 5)
    .map((item) => ({ label: item.title, target: item.target }));
}

function caveatsForDashboard(dashboard: RoleHomeDashboardDto) {
  const caveats = [
    `数据范围：${dashboard.profile.scopeLabel}`,
    "回答仅基于当前角色可见的经营看板事实。",
  ];

  if (dashboard.emptyState) {
    caveats.push(dashboard.emptyState.hint);
  }

  return caveats;
}
```

- [x] **Step 4: Run the agent test again**

Run:

```bash
pnpm vitest run features/ai/business-copilot-agent.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add features/ai/business-copilot-agent.ts features/ai/business-copilot-agent.test.ts
git commit -m "feat: add business copilot agent"
```

---

## Task 2: AI Tool Registration

**Files:**

- Modify: `features/ai/ai-tool-layer.ts`
- Modify: `features/ai/ai-tool-layer.test.ts`

- [x] **Step 1: Write failing tool-layer tests**

Append these assertions to `features/ai/ai-tool-layer.test.ts`:

```ts
it("registers the business copilot as a read-only MCN staff tool", () => {
  expect(listRegisteredAiTools()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "business_copilot_answer",
        readOnly: true,
        scopes: expect.arrayContaining(["mcn_staff"]),
        inputSchema: expect.objectContaining({
          type: "object",
          required: ["question", "dashboard"],
        }),
      }),
    ]),
  );
});

it("runs business copilot through the audited AI tool path", async () => {
  const { client, inserts } = createClient();

  const result = await runAiToolQuery({
    client,
    actor: {
      userId: "user-owner",
      name: "Owner",
      role: "owner",
      organizationId: "org-1",
    },
    toolName: "business_copilot_answer",
    input: {
      question: "这个月经营健康吗",
      dashboard: {
        profile: {
          role: "owner",
          title: "经营总览看板",
          subtitle: "关注收入、毛利、履约和高风险动作",
          scopeLabel: "全组织",
        },
        kpis: [
          { key: "grossMarginRate", label: "毛利率", value: 30, unit: "%" },
        ],
        queue: [],
        risks: [],
        drilldowns: [],
        generatedAt: "2026-06-18T04:00:00.000Z",
      },
    },
  });

  expect(result).toMatchObject({
    toolName: "business_copilot_answer",
    mode: "deterministic",
    output: {
      intent: "executive_health",
      facts: expect.arrayContaining([
        expect.objectContaining({ sourceId: "kpi:grossMarginRate" }),
      ]),
    },
  });
  expect(inserts.ai_invocations).toEqual([
    expect.objectContaining({
      object_id: "business_copilot_answer",
      status: "succeeded",
    }),
  ]);
  expect(inserts.ai_tool_invocations).toEqual([
    expect.objectContaining({
      tool_name: "business_copilot_answer",
      read_only: true,
      allowed: true,
      status: "succeeded",
    }),
  ]);
  expect(inserts.audit_logs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        module: "ai",
        object_type: "ai_query",
        object_name: "business_copilot_answer",
      }),
    ]),
  );
});
```

- [x] **Step 2: Run the failing tool-layer test**

Run:

```bash
pnpm vitest run features/ai/ai-tool-layer.test.ts
```

Expected: FAIL because `business_copilot_answer` is not registered.

- [x] **Step 3: Register the tool**

Modify `features/ai/ai-tool-layer.ts`:

```ts
import { runBusinessCopilotAgent } from "./business-copilot-agent";
```

Add this entry inside `registeredTools`:

```ts
  business_copilot_answer: {
    name: "business_copilot_answer",
    description:
      "Answers natural-language business questions from an authorized role dashboard DTO.",
    inputSchema: {
      type: "object",
      required: ["question", "dashboard"],
      properties: {
        question: { type: "string" },
        dashboard: { type: "object" },
      },
    },
    scopes: ["mcn_staff"],
    masking: { input: ["dashboard"], output: [], streamerForbiddenKeys },
    readOnly: true,
    handler(input) {
      return {
        answer: "经营问答已生成",
        output: runBusinessCopilotAgent({
          question: stringValue(input.question, ""),
          dashboard: objectValue(input.dashboard) as never,
        }),
      };
    },
  },
```

Keep the existing unregistered-tool rejection test unchanged so `sql.query` continues to throw `"AI tool is not registered"`.

- [x] **Step 4: Run the tool-layer test again**

Run:

```bash
pnpm vitest run features/ai/ai-tool-layer.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add features/ai/ai-tool-layer.ts features/ai/ai-tool-layer.test.ts
git commit -m "feat: register business copilot AI tool"
```

---

## Task 3: Business Copilot API Route

**Files:**

- Create: `app/api/ai/business-copilot/route.ts`
- Create: `app/api/ai/business-copilot/route.test.ts`

- [x] **Step 1: Write failing route tests**

Create `app/api/ai/business-copilot/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { runAiToolQuery } from "@/features/ai/ai-tool-layer";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/ai/ai-tool-layer", () => ({
  runAiToolQuery: vi.fn(),
}));

vi.mock("@/features/dashboards/role-home-loader", () => ({
  loadRoleHomeDashboard: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-owner",
  email: "owner@example.test",
  name: "Owner",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "owner" as const,
};

const dashboard = {
  profile: {
    role: "owner",
    title: "经营总览看板",
    subtitle: "关注收入、毛利、履约和高风险动作",
    scopeLabel: "全组织",
  },
  kpis: [{ key: "grossMarginRate", label: "毛利率", value: 30, unit: "%" }],
  queue: [],
  risks: [],
  drilldowns: [],
  generatedAt: "2026-06-18T04:00:00.000Z",
};

describe("AI business copilot route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(loadRoleHomeDashboard).mockResolvedValue(dashboard as never);
    vi.mocked(runAiToolQuery).mockResolvedValue({
      toolName: "business_copilot_answer",
      invocationId: "ai-invocation-1",
      mode: "deterministic",
      answer: "经营问答已生成",
      output: {
        question: "这个月经营健康吗",
        intent: "executive_health",
        answer: "经营健康判断已基于当前角色看板生成。",
        facts: [
          { label: "毛利率", value: 30, sourceId: "kpi:grossMarginRate" },
        ],
        findings: [],
        recommendations: [],
        drilldowns: [],
        caveats: [],
        generatedAt: "2026-06-18T04:00:00.000Z",
      },
    } as never);
  });

  it("loads the authorized role dashboard and returns an audited copilot answer", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/business-copilot", {
        method: "POST",
        body: JSON.stringify({ question: "这个月经营健康吗" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      result: {
        toolName: "business_copilot_answer",
        output: {
          intent: "executive_health",
          facts: expect.arrayContaining([
            expect.objectContaining({ sourceId: "kpi:grossMarginRate" }),
          ]),
        },
      },
      dashboardProfile: {
        role: "owner",
        scopeLabel: "全组织",
      },
    });
    expect(loadRoleHomeDashboard).toHaveBeenCalledWith({
      supabase: { client: "supabase" },
      auth,
    });
    expect(runAiToolQuery).toHaveBeenCalledWith({
      client: { client: "supabase" },
      actor: {
        userId: "user-owner",
        name: "Owner",
        role: "owner",
        organizationId: "org-1",
      },
      toolName: "business_copilot_answer",
      input: {
        question: "这个月经营健康吗",
        dashboard,
      },
    });
  });

  it("rejects empty questions", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/business-copilot", {
        method: "POST",
        body: JSON.stringify({ question: "   " }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Business copilot question is required",
    });
    expect(loadRoleHomeDashboard).not.toHaveBeenCalled();
  });

  it("blocks streamers from internal business copilot", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "streamer" });

    const response = await POST(
      new Request("http://localhost/api/ai/business-copilot", {
        method: "POST",
        body: JSON.stringify({ question: "经营健康吗" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(loadRoleHomeDashboard).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/ai/business-copilot", {
        method: "POST",
        body: JSON.stringify({ question: "经营健康吗" }),
      }),
    );

    expect(response.status).toBe(401);
  });
});
```

- [x] **Step 2: Run the failing route test**

Run:

```bash
pnpm vitest run app/api/ai/business-copilot/route.test.ts
```

Expected: FAIL because the route does not exist.

- [x] **Step 3: Implement the route**

Create `app/api/ai/business-copilot/route.ts`:

```ts
import { NextResponse } from "next/server";

import { runAiToolQuery } from "@/features/ai/ai-tool-layer";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can run business copilot" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as { question?: unknown };
    const question =
      typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json(
        { error: "Business copilot question is required" },
        { status: 400 },
      );
    }

    const dashboard = await loadRoleHomeDashboard({ supabase, auth });
    const result = await runAiToolQuery({
      client: supabase,
      actor: {
        userId: auth.userId,
        name: auth.name,
        role: auth.role,
        organizationId: auth.organizationId,
      },
      toolName: "business_copilot_answer",
      input: { question, dashboard },
    });

    return NextResponse.json({
      result,
      dashboardProfile: dashboard.profile,
    });
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
```

- [x] **Step 4: Run route and AI tests**

Run:

```bash
pnpm vitest run app/api/ai/business-copilot/route.test.ts features/ai/business-copilot-agent.test.ts features/ai/ai-tool-layer.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/api/ai/business-copilot/route.ts app/api/ai/business-copilot/route.test.ts
git commit -m "feat: expose business copilot API"
```

---

## Task 4: Role Homepage UI Panel

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [x] **Step 1: Write failing UI tests**

Add tests to `components/reference-ui/ops-reference.test.jsx`:

```jsx
it("lets staff ask business questions from the role dashboard", async () => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      result: {
        output: {
          intent: "executive_health",
          answer: "经营健康判断已基于当前角色看板生成。",
          facts: [
            {
              label: "毛利率",
              value: 30,
              unit: "%",
              sourceId: "kpi:grossMarginRate",
            },
          ],
          recommendations: [
            {
              proposal: "先打开风险最高的项目或审计记录复核。",
              requiresHumanApproval: true,
              target: { route: "audit" },
            },
          ],
          drilldowns: [{ label: "查看审计", target: { route: "audit" } }],
          caveats: ["数据范围：全组织"],
        },
      },
    }),
  }));

  render(
    <OpsReferenceApp
      initialRoute="warroom"
      currentUser={{ id: "owner-1", name: "Owner", role: "owner" }}
      dashboardHome={{
        profile: {
          role: "owner",
          title: "经营总览看板",
          subtitle: "关注收入、毛利、履约和高风险动作",
          scopeLabel: "全组织",
        },
        kpis: [],
        queue: [],
        risks: [],
        drilldowns: [],
        generatedAt: "2026-06-18T04:00:00.000Z",
      }}
    />,
  );

  fireEvent.change(screen.getByLabelText("经营问答问题"), {
    target: { value: "这个月经营健康吗" },
  });
  fireEvent.click(screen.getByRole("button", { name: "询问经营数据" }));

  await screen.findByText("经营健康判断已基于当前角色看板生成。");
  expect(screen.getByText("毛利率")).toBeInTheDocument();
  expect(screen.getByText("30%")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    "/api/ai/business-copilot",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ question: "这个月经营健康吗" }),
    }),
  );
});

it("renders unsupported business copilot answers without crashing", async () => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      result: {
        output: {
          intent: "unsupported",
          answer: "这个问题不在当前经营问答的安全范围内。",
          facts: [],
          recommendations: [
            {
              proposal: "请改问经营健康、今日优先级、结算风险或证据质量。",
              requiresHumanApproval: true,
            },
          ],
          drilldowns: [],
          caveats: ["经营问答不会执行 SQL、跨组织查询或生产写动作。"],
        },
      },
    }),
  }));

  render(
    <OpsReferenceApp
      initialRoute="warroom"
      currentUser={{ id: "owner-1", name: "Owner", role: "owner" }}
      dashboardHome={{
        profile: {
          role: "owner",
          title: "经营总览看板",
          subtitle: "关注收入、毛利、履约和高风险动作",
          scopeLabel: "全组织",
        },
        kpis: [],
        queue: [],
        risks: [],
        drilldowns: [],
        generatedAt: "2026-06-18T04:00:00.000Z",
      }}
    />,
  );

  fireEvent.change(screen.getByLabelText("经营问答问题"), {
    target: { value: "select * from settlement_batches" },
  });
  fireEvent.click(screen.getByRole("button", { name: "询问经营数据" }));

  await screen.findByText("这个问题不在当前经营问答的安全范围内。");
  expect(
    screen.getByText("经营问答不会执行 SQL、跨组织查询或生产写动作。"),
  ).toBeInTheDocument();
});
```

- [x] **Step 2: Run the failing UI tests**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx
```

Expected: FAIL because the role home screen has no business copilot panel.

- [x] **Step 3: Add the UI panel**

Modify `ScreenRoleHome` in `components/reference-ui/ops-reference.jsx`:

```jsx
        <RoleHomeKpis items={dashboard.kpis || []} />
        <BusinessCopilotPanel role={dashboard.profile?.role} />
        <RoleHomeSection title="优先处理" items={dashboard.queue || []} go={go} />
```

Add this component near the role-home helpers:

```jsx
function BusinessCopilotPanel({ role }) {
  const [question, setQuestion] = React.useState("");
  const [result, setResult] = React.useState(null);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const suggestions = businessCopilotSuggestions(role);

  const ask = async (nextQuestion = question) => {
    const trimmed = String(nextQuestion || "").trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const body = await postWarRoomJson(
        "/api/ai/business-copilot",
        { question: trimmed },
        "business copilot failed",
      );
      setResult(body.result?.output || null);
      setQuestion(trimmed);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "经营问答失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="问经营数据">
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            aria-label="经营问答问题"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") ask();
            }}
            style={{
              flex: 1,
              height: 34,
              border: "1px solid var(--line-strong)",
              borderRadius: 6,
              padding: "0 10px",
              fontSize: 13,
            }}
          />
          <Button kind="primary" onClick={() => ask()} disabled={busy}>
            {busy ? "分析中" : "询问经营数据"}
          </Button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {suggestions.map((item) => (
            <Button
              key={item}
              size="sm"
              kind="default"
              onClick={() => ask(item)}
            >
              {item}
            </Button>
          ))}
        </div>
        {message ? (
          <div
            aria-live="polite"
            style={{ color: "var(--danger-600)", fontSize: 12 }}
          >
            {message}
          </div>
        ) : null}
        {result ? <BusinessCopilotResult result={result} /> : null}
      </div>
    </Card>
  );
}

function BusinessCopilotResult({ result }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13, color: "var(--ink-800)", lineHeight: 1.6 }}>
        {result.answer}
      </div>
      {Array.isArray(result.facts) && result.facts.length ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {result.facts.map((fact) => (
            <Badge key={fact.sourceId || fact.label} tone="blue">
              {fact.label} {String(fact.value)}
              {fact.unit || ""}
            </Badge>
          ))}
        </div>
      ) : null}
      {Array.isArray(result.recommendations) &&
      result.recommendations.length ? (
        <div style={{ display: "grid", gap: 6 }}>
          {result.recommendations.map((item, index) => (
            <div
              key={`${item.proposal}-${index}`}
              style={{ fontSize: 12, color: "var(--ink-600)" }}
            >
              {item.proposal}
            </div>
          ))}
        </div>
      ) : null}
      {Array.isArray(result.caveats) && result.caveats.length ? (
        <div style={{ display: "grid", gap: 4 }}>
          {result.caveats.map((item) => (
            <div key={item} style={{ fontSize: 11.5, color: "var(--ink-400)" }}>
              {item}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function businessCopilotSuggestions(role) {
  if (role === "finance") {
    return ["哪些金额可以安全结算", "弱证据金额有多少", "哪些批次重开过"];
  }
  if (role === "operator_business") {
    return ["我今天有哪些待办", "哪些报数待审", "哪些主播要补证据"];
  }
  if (role === "ops_manager") {
    return ["今天团队先处理什么", "哪些项目卡住了", "有哪些异常任务"];
  }
  return ["这个月经营健康吗", "毛利异常在哪里", "哪些项目最需要关注"];
}
```

- [x] **Step 4: Run the UI tests again**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: add business copilot to role homepage"
```

---

## Task 5: Product Documentation

**Files:**

- Modify: `docs/product-function-document.md`

- [x] **Step 1: Update the product surface**

In `docs/product-function-document.md`, add a short subsection under the M10 / AI area:

```md
### AI 经营问答 Copilot

`/console` 角色化首页支持 MCN 员工用自然语言追问经营数据。系统不会让 AI 直接写 SQL，而是把问题归类为经营健康、今日优先级、结算风险或证据质量，再通过只读白名单工具读取当前角色可见的经营看板事实。

回答包含结论、事实来源、风险判断、人工处理建议和模块跳转。所有问答都会写入 AI 调用账本、AI 工具调用账本、用量和审计日志。AI 只给建议，不直接执行发布、审核、结算、导出或权限变更。
```

In API section `10.7 作战台、自动审核、AI`, add:

```md
| `/api/ai/business-copilot` | POST | AI 经营问答 |
```

In the AI/database or boundary section, add:

```md
- AI 经营问答只经 `business_copilot_answer` 只读工具读取角色化看板事实，不接受 raw SQL、表名或任意字段投影。
```

- [x] **Step 2: Run markdown format check for changed docs**

Run:

```bash
pnpm exec prettier --check docs/product-function-document.md docs/superpowers/specs/2026-06-18-ai-business-copilot-design.md docs/superpowers/plans/2026-06-18-ai-business-copilot.md
```

Expected: PASS. If it fails, run:

```bash
pnpm exec prettier --write docs/product-function-document.md docs/superpowers/specs/2026-06-18-ai-business-copilot-design.md docs/superpowers/plans/2026-06-18-ai-business-copilot.md
```

Then rerun the check command.

- [x] **Step 3: Commit**

```bash
git add docs/product-function-document.md
git commit -m "docs: document business copilot product surface"
```

---

## Task 6: Regression Verification

**Files:**

- No new files.

- [x] **Step 1: Run focused AI and API tests**

Run:

```bash
pnpm vitest run features/ai/business-copilot-agent.test.ts features/ai/ai-tool-layer.test.ts app/api/ai/business-copilot/route.test.ts
```

Expected: PASS.

- [x] **Step 2: Run UI coverage for the role homepage**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx app/(ops)/console/page.test.tsx
```

Expected: PASS.

- [x] **Step 3: Run the AI system suite**

Run:

```bash
pnpm test:ai-system
```

Expected: PASS.

- [x] **Step 4: Run broader static checks**

Run:

```bash
pnpm type-check
pnpm lint
```

Expected: PASS.

- [x] **Step 5: Run full tests if time allows before PR**

Run:

```bash
pnpm test
```

Expected: PASS.

- [x] **Step 6: Commit verification note if docs changed during verification**

If verification changes only generated formatting in docs, commit narrowly:

```bash
git add docs/product-function-document.md docs/superpowers/specs/2026-06-18-ai-business-copilot-design.md docs/superpowers/plans/2026-06-18-ai-business-copilot.md
git commit -m "docs: format business copilot documentation"
```

If verification makes no file changes, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers the approved MVP from the design doc: natural-language question input, deterministic intent routing, role-dashboard fact source, read-only AI tool, audited API route, role homepage UI, product documentation, and verification.
- Security coverage: The plan blocks streamers, rejects raw SQL-looking prompts, never registers arbitrary tools, keeps answer data scoped to `RoleHomeDashboardDto`, and uses the existing `runAiToolQuery` ledger path.
- Test coverage: Pure agent tests cover classification and masking; tool-layer tests cover registration and audit path; route tests cover auth and validation; UI tests cover ask and unsupported flows; final verification runs AI, API, UI, type, lint, and full tests.
- Type consistency: `BusinessCopilotIntent`, `BusinessCopilotAnswer`, `BusinessCopilotFact`, `RoleHomeDashboardDto`, `runBusinessCopilotAgent`, and `business_copilot_answer` use the same names throughout.

Plan complete and saved to `docs/superpowers/plans/2026-06-18-ai-business-copilot.md`.
