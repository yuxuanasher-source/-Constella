# Ops Console UX Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `/console` on `codex/full-project-ui` so the first screen is a role-aware "today's actions and risk queue", while keeping an obvious AI layer that always shows sources, confidence, and manual-confirmation boundaries.

**Architecture:** Keep the current `OpsReferenceApp` and role-home data contracts. Add an explicit `home` route for the role dashboard, demote the legacy war room into a secondary route, add AI trust metadata to the business copilot answer, and introduce small reusable UI primitives for action queues, AI trust display, and high-risk action preflight. Avoid broad decomposition of `components/reference-ui/ops-reference.jsx` in this slice; stabilize the user experience first, then split the large file in a later refactor.

**Tech Stack:** Next.js App Router, React 19 reference UI, TypeScript AI/dashboard modules, Vitest, React Testing Library, bundled Impeccable detector.

---

## Scope

This plan implements the approved direction from the UX critique:

- A. Make the first screen a "今日待办 / 风险队列" action layer instead of the broad war room.
- B. Address P1 and P2 together: first-screen IA, AI trust scaffolding, war-room overload, finance/export/OCR action preflight, responsive and a11y hardening.
- B. Keep a visible AI feel, but every AI answer must expose source, confidence, and human-confirmation requirements.

This plan does not implement:

- New database tables.
- New backend permission model.
- A full split of `components/reference-ui/ops-reference.jsx`.
- A visual redesign of every console module.
- Auth/Supabase local environment repair for the `/console` browser redirect.

## Current Evidence

- Correct worktree: `C:\Users\admin\Documents\版本2\.claude\worktrees\forum-market`.
- Current route entry: `app/(ops)/console/page.tsx` passes `initialRoute="warroom"`.
- Current role home renderer: `components/reference-ui/ops-reference.jsx`, `ScreenRoleHome`.
- Current legacy fallback: `components/reference-ui/ops-reference.jsx`, `ScreenWarRoom`.
- Current AI role-home panel: `BusinessCopilotPanel` and `BusinessCopilotResult`.
- Current high-risk areas: `OcrOperationsPanel`, `ScreenSettlement`, `ScreenExport`, and governed export calls through `createGovernedExport`.
- Critique snapshot: `.impeccable/critique/2026-06-28T05-35-51Z__app-ops-console-page-tsx.md`.

## File Structure

- Modify: `app/(ops)/console/page.tsx` - make the explicit initial route `home`, preserve dashboard load errors as UI state instead of silently falling into the legacy war room.
- Modify: `app/(ops)/console/page.test.tsx` - assert the new route contract and dashboard-unavailable state.
- Modify: `features/ai/business-copilot-agent.ts` - add confidence, source summary, and manual-confirmation metadata to the structured AI answer.
- Modify: `features/ai/business-copilot-agent.test.ts` - cover source, confidence, and manual-confirmation metadata.
- Modify: `app/api/ai/business-copilot/route.test.ts` - keep route output expectations aligned with the new AI answer shape.
- Modify: `components/reference-ui/ops-reference.jsx` - add `home` route rendering, first-screen action queue, AI trust strip/result, high-risk action preflight, tab a11y, responsive grids, and detector cleanup.
- Modify: `components/reference-ui/ops-reference.test.jsx` - UI tests for home route, ordering, AI trust output, preflight copy, tab semantics, and legacy war-room demotion.
- Modify: `DESIGN.md` - document any retained tonal color or mono-font exception, or remove undocumented values from touched UI.
- Modify if needed: `docs/product-function-document.md` - update `/console` behavior and AI trust boundary after implementation.

---

## Task 1: Make `/console` Land On An Explicit Home Route

**Files:**

- Modify: `app/(ops)/console/page.tsx`
- Modify: `app/(ops)/console/page.test.tsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [x] **Step 1: Write the failing console route contract tests**

In `app/(ops)/console/page.test.tsx`, update the mocked `OpsReferenceApp` prop shape:

```tsx
default: vi.fn(
  (props: {
    initialRoute?: string;
    currentUser?: { name?: string };
    dashboardHome?: { profile?: { title?: string } } | null;
    dashboardHomeError?: string | null;
  }) => (
    <div data-testid="ops-reference-app">
      <span>{props.initialRoute ?? "missing-route"}</span>
      <span>{props.currentUser?.name ?? "missing-user"}</span>
      <span>
        {props.dashboardHome?.profile?.title ?? "missing-dashboard"}
      </span>
      <span>{props.dashboardHomeError ?? "missing-dashboard-error"}</span>
    </div>
  ),
),
```

Change the happy-path expectation:

```tsx
expect(OpsReferenceApp).toHaveBeenCalledWith(
  expect.objectContaining({
    initialRoute: "home",
    dashboardHome: expect.objectContaining({
      profile: expect.objectContaining({ title: "项目推进看板" }),
    }),
    dashboardHomeError: null,
  }),
  undefined,
);
```

Change the loader-failure test name and expectations:

```tsx
it("passes a role-dashboard unavailable state instead of silently selecting war room", async () => {
  const supabase = {};
  const dashboardError = new Error("dashboard unavailable");
  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});
  vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
  vi.mocked(getAuthContext).mockResolvedValue({
    userId: "user-ops",
    email: "alice@example.test",
    name: "Alice Ops",
    organizationId: "org-1",
    organizationName: "Demo Org",
    role: "ops_manager",
  });
  vi.mocked(loadRoleHomeDashboard).mockRejectedValue(dashboardError);

  try {
    render(await ConsolePage());

    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent("home");
    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
      "角色看板暂不可用",
    );
    expect(OpsReferenceApp).toHaveBeenCalledWith(
      expect.objectContaining({
        initialRoute: "home",
        dashboardHome: null,
        dashboardHomeError: "角色看板暂不可用",
      }),
      undefined,
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to load role dashboard",
      dashboardError,
    );
  } finally {
    consoleErrorSpy.mockRestore();
  }
});
```

Run:

```bash
pnpm vitest run app/(ops)/console/page.test.tsx
```

Expected: FAIL because `initialRoute` is still `warroom` and `dashboardHomeError` is not passed.

- [x] **Step 2: Implement route-level dashboard error state**

Modify `app/(ops)/console/page.tsx`:

```tsx
export default async function ConsolePage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  let dashboardHome = null;
  let dashboardHomeError: string | null = null;

  try {
    dashboardHome = await loadRoleHomeDashboard({ supabase, auth });
  } catch (error) {
    dashboardHomeError = "角色看板暂不可用";
    console.error("Failed to load role dashboard", error);
  }

  return (
    <OpsReferenceApp
      initialRoute="home"
      dashboardHome={dashboardHome}
      dashboardHomeError={dashboardHomeError}
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettingsFromAuth(auth)}
    />
  );
}
```

- [x] **Step 3: Add failing UI tests for the new home route**

In `components/reference-ui/ops-reference.test.jsx`, add these tests inside `describe("OpsReferenceApp role dashboard contract", ...)`:

```jsx
it("renders the role action home on the explicit home route", () => {
  render(
    <OpsReferenceApp
      initialRoute="home"
      dashboardHome={{
        profile: {
          role: "ops_manager",
          title: "项目推进看板",
          subtitle: "关注招募、录屏、排班、报数和异常卡点",
          scopeLabel: "授权项目",
        },
        kpis: [],
        queue: [
          {
            key: "task:1",
            title: "补齐今晚排班",
            subtitle: "Alpha 项目 · 2 个主播未确认",
            tone: "amber",
            target: { route: "tasks", id: "task-1" },
          },
        ],
        risks: [
          {
            key: "risk:1",
            title: "弱证据报数待复核",
            subtitle: "Beta 项目 · OCR 与人工确认不一致",
            tone: "red",
            target: { route: "reports", id: "report-1" },
          },
        ],
        drilldowns: [],
        generatedAt: "2026-06-28T05:00:00.000Z",
      }}
    />,
  );

  expect(screen.getByText("今日必须处理")).toBeInTheDocument();
  expect(screen.getByText("补齐今晚排班")).toBeInTheDocument();
  expect(screen.getByText("弱证据报数待复核")).toBeInTheDocument();
  expect(screen.queryByText("智能项目作战台")).not.toBeInTheDocument();
});

it("shows an honest unavailable state when the role dashboard fails to load", () => {
  render(
    <OpsReferenceApp
      initialRoute="home"
      dashboardHomeError="角色看板暂不可用"
    />,
  );

  expect(screen.getByText("角色看板暂不可用")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "进入作战台" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("智能项目作战台")).not.toBeInTheDocument();
});

it("keeps the legacy war room available as a secondary route", () => {
  render(<OpsReferenceApp initialRoute="warroom" />);

  expect(screen.getByText("智能项目作战台")).toBeInTheDocument();
});
```

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "home route|unavailable|legacy war room"
```

Expected: FAIL because `home` is not a rendered route yet.

- [x] **Step 4: Implement `home` route plumbing**

In `components/reference-ui/ops-reference.jsx`, extend the live data context default:

```jsx
dashboardHome: null,
dashboardHomeError: null,
```

Add a hook near `useOpsDashboardHome`:

```jsx
function useOpsDashboardHomeError() {
  const { dashboardHomeError } = React.useContext(OpsLiveDataContext);
  return typeof dashboardHomeError === "string" && dashboardHomeError.trim()
    ? dashboardHomeError
    : null;
}
```

Add `dashboardHomeError` to `OpsReferenceInner` props, state, effect, provider value, `OpsReferenceApp` props, and forwarding:

```jsx
const [dashboardHomeErrorState, setDashboardHomeErrorState] = React.useState(
  dashboardHomeError ?? null,
);

React.useEffect(() => {
  setDashboardHomeErrorState(dashboardHomeError ?? null);
}, [dashboardHomeError]);
```

Render provider value:

```jsx
dashboardHome: dashboardHomeState,
dashboardHomeError: dashboardHomeErrorState,
```

Add the `home` crumb:

```jsx
case "home":
  return ["工作台", "今日待办"];
```

Normalize nav selection:

```jsx
const navKey =
  route === "project" ? "projects" : route === "home" ? "warroom" : route;
```

Render the new route before war room:

```jsx
{
  route === "home" && <ScreenConsoleHome go={go} />;
}
{
  route === "warroom" && <ScreenWarRoom go={go} />;
}
```

Add `ScreenConsoleHome` and unavailable state above `ScreenWarRoom`:

```jsx
function ScreenConsoleHome({ go }) {
  const dashboardHome = useOpsDashboardHome();
  const dashboardHomeError = useOpsDashboardHomeError();

  if (dashboardHome) {
    return <ScreenRoleHome dashboard={dashboardHome} go={go} />;
  }

  return (
    <ScreenRoleHomeUnavailable
      message={dashboardHomeError || "角色看板暂不可用"}
      onOpenWarRoom={() => go("warroom")}
    />
  );
}

function ScreenRoleHomeUnavailable({ message, onOpenWarRoom }) {
  return (
    <>
      <PageHeader
        title="今日待办"
        subtitle="角色看板没有加载成功，暂时无法判断今天的优先级。"
        status={<Badge tone="red">需要处理</Badge>}
        actions={
          <>
            <Button
              kind="default"
              onClick={() => globalThis.location?.reload?.()}
            >
              重新加载
            </Button>
            <Button kind="primary" onClick={onOpenWarRoom}>
              进入作战台
            </Button>
          </>
        }
      />
      <div style={{ padding: 20 }}>
        <EmptyHint
          title={message}
          hint="系统没有静默切换到另一套首页，避免把缺失的角色数据误读为正常经营状态。"
        />
      </div>
    </>
  );
}
```

- [x] **Step 5: Remove the role-home shortcut from `ScreenWarRoom`**

Delete this branch from `ScreenWarRoom`:

```jsx
if (dashboardHome) {
  return <ScreenRoleHome dashboard={dashboardHome} go={go} />;
}
```

Also remove `const dashboardHome = useOpsDashboardHome();` from `ScreenWarRoom`.

- [x] **Step 6: Run the route and UI tests**

Run:

```bash
pnpm vitest run app/(ops)/console/page.test.tsx components/reference-ui/ops-reference.test.jsx -t "console route|role dashboard contract|home route|unavailable|legacy war room"
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add app/(ops)/console/page.tsx app/(ops)/console/page.test.tsx components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: make console home an explicit action queue"
```

---

## Task 2: Reframe Role Home Around Today's Actions And Risks

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [x] **Step 1: Write failing ordering and copy tests**

Add this test to the role-dashboard describe block:

```jsx
it("puts today's action queue before AI and secondary entries", () => {
  render(
    <OpsReferenceApp
      initialRoute="home"
      dashboardHome={{
        profile: {
          role: "owner",
          title: "经营总览看板",
          subtitle: "关注收入、毛利、履约和高风险动作",
          scopeLabel: "全组织",
        },
        kpis: [
          { key: "activeProjects", label: "进行中项目", value: 3, unit: "个" },
        ],
        queue: [
          {
            key: "project:1",
            title: "推进 Alpha 项目",
            subtitle: "执行中 · Alice",
            tone: "blue",
            target: { route: "project", id: "project-1" },
          },
        ],
        risks: [
          {
            key: "settle:1",
            title: "复核重开批次",
            subtitle: "财务授权范围 · 1 个批次",
            tone: "red",
            target: { route: "settle", id: "batch-1" },
          },
        ],
        drilldowns: [
          {
            key: "audit:1",
            title: "查看审计",
            subtitle: "高风险操作日志",
            tone: "neutral",
            target: { route: "audit" },
          },
        ],
        generatedAt: "2026-06-28T05:00:00.000Z",
      }}
    />,
  );

  const actionQueue = screen.getByText("今日必须处理");
  const aiPanel = screen.getByText("AI 经营助理");
  expect(
    actionQueue.compareDocumentPosition(aiPanel) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByText("推进 Alpha 项目")).toBeInTheDocument();
  expect(screen.getByText("复核重开批次")).toBeInTheDocument();
});
```

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "today's action queue"
```

Expected: FAIL because the current UI renders KPI, AI, then separate queue/risk sections.

- [x] **Step 2: Add action queue helper functions**

Insert these helpers near the role-home helpers:

```jsx
function roleHomePrimaryActions(dashboard) {
  const queue = Array.isArray(dashboard.queue) ? dashboard.queue : [];
  const risks = Array.isArray(dashboard.risks) ? dashboard.risks : [];
  return [
    ...risks.map((item) => ({ ...item, groupLabel: "风险" })),
    ...queue.map((item) => ({ ...item, groupLabel: "待办" })),
  ].slice(0, 6);
}

function roleHomeSecondaryEntries(dashboard) {
  return Array.isArray(dashboard.drilldowns)
    ? dashboard.drilldowns.slice(0, 6)
    : [];
}
```

- [x] **Step 3: Replace the separate first-screen sections**

Inside `ScreenRoleHome`, compute:

```jsx
const primaryActions = roleHomePrimaryActions(dashboard);
const secondaryEntries = roleHomeSecondaryEntries(dashboard);
```

Change the content order to:

```jsx
<RoleHomeActionQueue title="今日必须处理" items={primaryActions} go={go} />
<RoleHomeKpis items={dashboard.kpis || []} />
<BusinessCopilotPanel
  role={dashboard.profile?.role}
  scopeLabel={dashboard.profile?.scopeLabel}
  generatedAt={dashboard.generatedAt}
/>
<RoleHomeSection title="常用入口" items={secondaryEntries} go={go} />
```

Add `RoleHomeActionQueue`:

```jsx
function RoleHomeActionQueue({ title, items, go }) {
  if (!items.length) {
    return (
      <Card>
        <div style={{ display: "grid", gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          <div style={{ color: "var(--ink-500)", fontSize: 13 }}>
            当前没有必须马上处理的经营事项。
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card padded={false}>
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
        <Badge tone="neutral">{items.length} 项</Badge>
      </div>
      <div style={{ display: "grid" }}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => go(item.target?.route || "warroom", item.target?.id)}
            aria-label={`处理${item.groupLabel || "事项"}：${item.title}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: 12,
              padding: "13px 16px",
              border: 0,
              borderBottom: "1px solid var(--line)",
              background: "#fff",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Badge tone={item.tone || "neutral"}>
                  {item.groupLabel || "待办"}
                </Badge>
                <b>{item.title}</b>
              </span>
              <span
                style={{
                  display: "block",
                  color: "var(--ink-500)",
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                {item.subtitle}
              </span>
            </span>
            <Icon.ChevronRight size={16} stroke="var(--ink-300)" />
          </button>
        ))}
      </div>
    </Card>
  );
}
```

- [x] **Step 4: Make `RoleHomeSection` use the target id**

Change its click handler from:

```jsx
onClick={() => go(item.target?.route || "warroom")}
```

to:

```jsx
onClick={() => go(item.target?.route || "warroom", item.target?.id)}
```

- [x] **Step 5: Run role-home tests**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "role dashboard contract|today's action queue"
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: prioritize console actions and risks"
```

---

## Task 3: Add AI Source, Confidence, And Manual Confirmation

**Files:**

- Modify: `features/ai/business-copilot-agent.ts`
- Modify: `features/ai/business-copilot-agent.test.ts`
- Modify: `app/api/ai/business-copilot/route.test.ts`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [x] **Step 1: Write failing AI agent metadata tests**

In `features/ai/business-copilot-agent.test.ts`, extend the owner answer test:

```ts
expect(result.sourceSummary).toEqual({
  sourceTool: "role_home_dashboard",
  scopeLabel: "全组织",
  generatedAt: "2026-06-18T04:00:00.000Z",
  readableAreas: ["kpis", "queue", "risks", "drilldowns"],
});
expect(result.confidence).toEqual(
  expect.objectContaining({
    level: "medium",
    label: "中等置信度",
  }),
);
expect(result.requiresHumanConfirmation).toBe(true);
```

Extend the unsupported test:

```ts
expect(result.confidence.level).toBe("low");
expect(result.requiresHumanConfirmation).toBe(true);
expect(result.sourceSummary.sourceTool).toBe("role_home_dashboard");
```

Run:

```bash
pnpm vitest run features/ai/business-copilot-agent.test.ts
```

Expected: FAIL because the fields do not exist.

- [x] **Step 2: Add AI metadata types and builders**

In `features/ai/business-copilot-agent.ts`, extend `BusinessCopilotAnswer`:

```ts
sourceSummary: {
  sourceTool: "role_home_dashboard";
  scopeLabel: string;
  generatedAt: string;
  readableAreas: Array<"kpis" | "queue" | "risks" | "drilldowns">;
}
confidence: {
  level: "low" | "medium" | "high";
  label: string;
  reason: string;
}
requiresHumanConfirmation: true;
```

Add helpers:

```ts
function sourceSummaryForDashboard(dashboard: RoleHomeDashboardDto) {
  return {
    sourceTool: "role_home_dashboard" as const,
    scopeLabel: dashboard.profile.scopeLabel,
    generatedAt: dashboard.generatedAt,
    readableAreas: ["kpis", "queue", "risks", "drilldowns"] as const,
  };
}

function confidenceForAnswer(input: {
  intent: BusinessCopilotIntent;
  facts: BusinessCopilotFact[];
}) {
  if (input.intent === "unsupported" || input.facts.length === 0) {
    return {
      level: "low" as const,
      label: "低置信度",
      reason: "问题不在当前经营问答范围内，或没有可引用的角色看板事实。",
    };
  }

  if (input.facts.length >= 3) {
    return {
      level: "high" as const,
      label: "高置信度",
      reason: "回答引用了三项以上当前角色看板事实。",
    };
  }

  return {
    level: "medium" as const,
    label: "中等置信度",
    reason: "回答引用了当前角色看板事实，但仍需要人工确认业务后果。",
  };
}
```

In both supported and unsupported return objects, include:

```ts
sourceSummary: sourceSummaryForDashboard(input.dashboard),
confidence: confidenceForAnswer({ intent, facts }),
requiresHumanConfirmation: true,
```

For unsupported answers, pass `facts: []` into `confidenceForAnswer`.

- [x] **Step 3: Update route test expectations**

In `app/api/ai/business-copilot/route.test.ts`, add:

```ts
expect(body.result.output).toEqual(
  expect.objectContaining({
    sourceSummary: expect.objectContaining({
      sourceTool: "role_home_dashboard",
    }),
    confidence: expect.objectContaining({
      level: expect.any(String),
      label: expect.any(String),
    }),
    requiresHumanConfirmation: true,
  }),
);
```

Run:

```bash
pnpm vitest run app/api/ai/business-copilot/route.test.ts features/ai/business-copilot-agent.test.ts
```

Expected: PASS.

- [x] **Step 4: Write failing UI tests for AI trust display**

In `components/reference-ui/ops-reference.test.jsx`, update the business-copilot mock response in the existing "lets staff ask business questions" test:

```jsx
sourceSummary: {
  sourceTool: "role_home_dashboard",
  scopeLabel: "全组织",
  generatedAt: "2026-06-18T04:00:00.000Z",
  readableAreas: ["kpis", "queue", "risks", "drilldowns"],
},
confidence: {
  level: "medium",
  label: "中等置信度",
  reason: "回答引用了当前角色看板事实，但仍需要人工确认业务后果。",
},
requiresHumanConfirmation: true,
```

Then add assertions:

```jsx
expect(screen.getByText("来源：角色看板")).toBeInTheDocument();
expect(screen.getByText("范围：全组织")).toBeInTheDocument();
expect(screen.getByText("置信度：中等置信度")).toBeInTheDocument();
expect(screen.getByText("需人工确认")).toBeInTheDocument();
expect(screen.getByText("kpi:grossMarginRate")).toBeInTheDocument();
```

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "business questions"
```

Expected: FAIL because UI does not render the trust fields.

- [x] **Step 5: Rename and enrich the AI panel**

Change `BusinessCopilotPanel` signature:

```jsx
function BusinessCopilotPanel({ role, scopeLabel, generatedAt }) {
```

Change the card title:

```jsx
<Card title="AI 经营助理">
```

Add a visible trust strip above the input:

```jsx
<AiTrustStrip
  sourceLabel="角色看板"
  scopeLabel={scopeLabel || "当前授权范围"}
  generatedAt={generatedAt}
  confidenceLabel="回答后显示"
  requiresHumanConfirmation
/>
```

Add component:

```jsx
function AiTrustStrip({
  sourceLabel,
  scopeLabel,
  generatedAt,
  confidenceLabel,
  requiresHumanConfirmation,
}) {
  const generatedLabel = generatedAt
    ? new Date(generatedAt).toLocaleString("zh-CN")
    : "等待生成";

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
        padding: "8px 10px",
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "var(--blue-50)",
        color: "var(--ink-700)",
        fontSize: 12,
      }}
    >
      <Badge tone="violet">AI</Badge>
      <span>来源：{sourceLabel}</span>
      <span>范围：{scopeLabel}</span>
      <span>更新时间：{generatedLabel}</span>
      <span>置信度：{confidenceLabel}</span>
      {requiresHumanConfirmation ? (
        <Badge tone="amber">需人工确认</Badge>
      ) : null}
    </div>
  );
}
```

In `BusinessCopilotResult`, render source and confidence before facts:

```jsx
{
  result.sourceSummary || result.confidence ? (
    <AiTrustStrip
      sourceLabel={
        result.sourceSummary?.sourceTool === "role_home_dashboard"
          ? "角色看板"
          : result.sourceSummary?.sourceTool || "经营数据"
      }
      scopeLabel={result.sourceSummary?.scopeLabel || "当前授权范围"}
      generatedAt={result.sourceSummary?.generatedAt || result.generatedAt}
      confidenceLabel={result.confidence?.label || "未标注"}
      requiresHumanConfirmation={result.requiresHumanConfirmation !== false}
    />
  ) : null;
}
```

Render source ids in facts:

```jsx
<span style={{ color: "var(--ink-400)", fontSize: 11 }}>{fact.sourceId}</span>
```

- [x] **Step 6: Run AI tests**

Run:

```bash
pnpm vitest run features/ai/business-copilot-agent.test.ts app/api/ai/business-copilot/route.test.ts components/reference-ui/ops-reference.test.jsx -t "business copilot|business questions|unsupported"
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add features/ai/business-copilot-agent.ts features/ai/business-copilot-agent.test.ts app/api/ai/business-copilot/route.test.ts components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: show sourced AI confidence in console"
```

---

## Task 4: Add Preflight Copy For Risky Console Actions

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [x] **Step 1: Write failing tests for settlement and export preflight**

Add tests to existing settlement/export describe blocks:

```jsx
it("shows settlement export scope and audit destination before exporting batches", () => {
  render(
    <OpsReferenceApp
      initialRoute="settle"
      liveBatches={[
        {
          id: "batch-1",
          batchNo: "SET-001",
          status: "draft",
          projectName: "Alpha",
          payableAmount: 8000,
          itemCount: 2,
        },
      ]}
      liveSettlementPool={[]}
      settlementScope={{
        projectId: "project-alpha",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        poolCount: 2,
      }}
    />,
  );

  expect(screen.getByText("高风险动作预检")).toBeInTheDocument();
  expect(
    screen.getByText("范围：project-alpha · 2026-06-01 → 2026-06-30"),
  ).toBeInTheDocument();
  expect(screen.getByText("审计：操作日志会记录导出动作")).toBeInTheDocument();
});

it("shows governed export scope before creating an export", () => {
  render(<OpsReferenceApp initialRoute="export" />);

  expect(screen.getByText("高风险动作预检")).toBeInTheDocument();
  expect(screen.getByText("动作：生成受治理导出")).toBeInTheDocument();
  expect(screen.getByText("权限：当前经营后台账号")).toBeInTheDocument();
});
```

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "preflight|governed export scope"
```

Expected: FAIL because no preflight component exists.

- [x] **Step 2: Add reusable preflight component**

Add near shared UI helpers:

```jsx
function RiskActionPreflight({
  action,
  scope,
  records,
  fields,
  permission,
  audit,
  recovery,
}) {
  const items = [
    ["动作", action],
    ["范围", scope],
    ["记录", records],
    ["字段", fields],
    ["权限", permission],
    ["审计", audit],
    ["恢复", recovery],
  ].filter(([, value]) => value);

  return (
    <div
      style={{
        display: "grid",
        gap: 6,
        padding: 12,
        border: "1px solid var(--warn-200, var(--line-strong))",
        borderRadius: 8,
        background: "var(--warn-50)",
        color: "var(--ink-700)",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon.AlertTriangle size={14} stroke="var(--warn-600)" />
        <b>高风险动作预检</b>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {items.map(([label, value]) => (
          <div key={label}>
            {label}：{value}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [x] **Step 3: Render preflight in `ScreenSettlement`**

Near the settlement batch actions, render:

```jsx
<RiskActionPreflight
  action="结算批次导出 / 锁定 / 重开"
  scope={
    settlementScope
      ? `${settlementScope.projectId || "全部授权项目"} · ${settlementScope.periodStart || "未限定"} → ${settlementScope.periodEnd || "未限定"}`
      : "当前授权结算范围"
  }
  records={`${settlementPoolCount} 条可结算记录`}
  fields="项目、主播、时长、证据等级、应付金额"
  permission="当前财务授权范围"
  audit="操作日志会记录导出动作"
  recovery="锁定或重开后从批次详情继续处理，不在本页直接收付款。"
/>
```

- [x] **Step 4: Render preflight in `ScreenExport`**

Near the export generation controls, render:

```jsx
<RiskActionPreflight
  action="生成受治理导出"
  scope={EXPORT_KIND_LABELS[kind] || "当前导出类型"}
  records={`${Array.isArray(rows) ? rows.length : 0} 条预览记录`}
  fields="仅包含当前导出类型允许字段"
  permission="当前经营后台账号"
  audit="导出中心和操作日志会记录本次动作"
  recovery="生成失败不会修改业务数据，可调整范围后重新生成。"
/>
```

Use the existing `ScreenExport` variables directly: `kind` is the selected export type, `exportKinds` contains the display labels, `projectId` is the vendor-delivery project selector, and `result` holds the generated export metadata. The preflight should compute the label with `exportKinds.find((item) => item.key === kind)?.label || kind`, use `projectId || "当前选择"` for vendor-delivery scope, and show `result?.rowCount ?? 0` only after generation; before generation, show `0 条预览记录` because the current implementation loads vendor-delivery rows inside `submit`.

- [x] **Step 5: Render OCR confirmation preflight**

In `OcrOperationsPanel`, before the job table, render:

```jsx
<RiskActionPreflight
  action="OCR 结果人工确认"
  scope={statusFilter === "all" ? "全部 OCR 作业" : statusFilter}
  records={`${filteredJobs.length} 条当前筛选作业`}
  fields="直播日期、时长、观看人数、账号、识别状态"
  permission="当前运营审核权限"
  audit="确认动作会进入报数审核与操作日志"
  recovery="确认前可修正字段；确认后需要走报数复核流程。"
/>
```

- [x] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "preflight|OCR operations|export center|settlement"
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: add preflight context for risky console actions"
```

---

## Task 5: Remove The Most Visible Impeccable Detector Hits

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `DESIGN.md`

- [x] **Step 1: Write a focused regression test for the task block**

Add a test near schedule/task tests:

```jsx
it("renders day task blocks without side-stripe accent borders", () => {
  render(<OpsReferenceApp initialRoute="tasks" liveTasks={taskLiveTasks} />);

  const taskButton = screen.getByRole("button", { name: /Fixture Project/ });
  expect(taskButton).not.toHaveStyle({
    borderLeft: expect.stringContaining("3px"),
  });
});
```

If `taskLiveTasks` is not available in that test scope, create one local task with `projectId`, `projectName`, `streamerName`, `plannedStartAt`, `plannedEndAt`, and `status: "pending_live"`.

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "side-stripe"
```

Expected: FAIL while `DayTaskBlock` uses `borderLeft: 3px`.

- [x] **Step 2: Replace `DayTaskBlock` side stripe**

In `DayTaskBlock`, replace:

```jsx
borderLeft: `3px solid ${c.bar}`,
```

with:

```jsx
border: `1px solid ${c.border || "var(--line)"}`,
boxShadow: task.anomaly ? "inset 0 0 0 1px var(--danger-600)" : "none",
```

Ensure each color object used by `DayTaskBlock` has a `border` value using CSS variables:

```jsx
border: "var(--line-strong)";
```

or:

```jsx
border: "var(--danger-600)";
```

- [x] **Step 3: Remove the decorative AI gradient from war room**

In `ScreenWarRoom`, replace the status badge background:

```jsx
background: "linear-gradient(135deg, #EFEBFF, #DCE6FF)",
```

with:

```jsx
background: "var(--violet-50)",
border: "1px solid var(--line)",
```

Change the label from:

```jsx
AI 增强 · 基础版
```

to:

```jsx
AI 辅助 · 需确认
```

- [x] **Step 4: Decide the mono-font drift**

Search:

```bash
rg -n "IBM Plex Mono|fontFamily" components/reference-ui/ops-reference.jsx DESIGN.md
```

If the mono font is used only for a decorative label, replace it with:

```jsx
fontFamily: "var(--font-sans-app), PingFang SC, Microsoft YaHei, Arial, sans-serif",
letterSpacing: 0,
```

If it is used for true code-like identifiers, document it in `DESIGN.md`:

```md
monospace:
fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
use: "Only for machine identifiers, API keys, audit object ids, and compact technical counters."
```

- [x] **Step 5: Run detector on touched UI**

Run:

```bash
node "C:\Users\admin\Documents\版本2\.agents\skills\impeccable\scripts\detect.mjs" --json "components/reference-ui/ops-reference.jsx"
```

Expected: no `side-tab` finding. Any remaining `design-system-color` findings must either be outside touched areas or documented in `DESIGN.md`.

- [x] **Step 6: Run UI test and detector again**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "side-stripe|war room|role dashboard contract"
node "C:\Users\admin\Documents\版本2\.agents\skills\impeccable\scripts\detect.mjs" --json "components/reference-ui/ops-reference.jsx"
```

Expected: tests PASS; detector output has no `side-tab` and no new gradient/AI badge hit in the edited region.

- [x] **Step 7: Commit**

```bash
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx DESIGN.md
git commit -m "style: align console UI with design register"
```

---

## Task 6: Harden Tabs And Responsive Layout

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [x] **Step 1: Write failing tab semantics tests**

Add a test near shared UI tests:

```jsx
it("renders console tabs with tablist and selected tab semantics", () => {
  render(<OpsReferenceApp initialRoute="warroom" />);

  expect(screen.getByRole("tablist")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "执行总览" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.click(screen.getByRole("tab", { name: "报价 & 测算" }));
  expect(screen.getByRole("tab", { name: "报价 & 测算" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
```

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "tablist"
```

Expected: FAIL because `Tabs` renders plain buttons without tab roles.

- [x] **Step 2: Add tab roles and keyboard navigation**

Update `Tabs`:

```jsx
function Tabs({ items, value, onChange, size = "md" }) {
  const fs = size === "lg" ? 14 : 13;
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.key === value),
  );
  const move = (delta) => {
    const next = items[(activeIndex + delta + items.length) % items.length];
    if (next) onChange?.(next.key);
  };

  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 0,
        overflowX: "auto",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange?.(it.key)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
            }}
            style={{
              padding: "10px 14px",
              background: "transparent",
              border: "none",
              borderBottom: active
                ? "2px solid var(--blue-600)"
                : "2px solid transparent",
              marginBottom: -1,
              cursor: "pointer",
              color: active ? "var(--blue-700)" : "var(--ink-500)",
              fontWeight: active ? 600 : 500,
              fontSize: fs,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
            }}
          >
            {it.label}
            {it.count != null && (
              <span
                style={{
                  background: active ? "var(--blue-50)" : "var(--bg-soft)",
                  color: active ? "var(--blue-700)" : "var(--ink-400)",
                  borderRadius: 999,
                  padding: "0 6px",
                  fontSize: 11,
                  fontWeight: 500,
                  minWidth: 18,
                  textAlign: "center",
                }}
              >
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [x] **Step 3: Replace fixed war-room metric grid**

In `ScreenWarRoom`, replace:

```jsx
gridTemplateColumns: "repeat(5, 1fr)",
```

with:

```jsx
gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
```

For two-column war-room layouts using `1.4fr 1fr`, use:

```jsx
gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
```

For four-column grids using `repeat(4, minmax(0, 1fr))`, use:

```jsx
gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
```

- [x] **Step 4: Run focused UI smoke**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "tablist|war room smoke|role dashboard contract"
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "fix: harden console tabs and responsive grids"
```

---

## Task 7: Product Documentation And Critique Snapshot Follow-Up

**Files:**

- Modify: `docs/product-function-document.md`
- Modify: `.impeccable/critique/ignore.md` only if a detector finding is intentionally accepted.

- [x] **Step 1: Update product docs for the new console first screen**

In `docs/product-function-document.md`, add or update the `/console` section with:

```md
`/console` 默认进入角色化今日待办与风险队列。角色看板加载失败时，页面会明确提示“角色看板暂不可用”，并提供重新加载和进入旧作战台的手动入口，不会静默把用户切到另一套首页。
```

Add AI trust boundary:

```md
AI 经营助理的回答必须显示来源、授权范围、数据更新时间、置信度和“需人工确认”。AI 只给出经营建议和跳转入口，不直接执行发布、审核、结算、导出或权限变更。
```

Add high-risk action note:

```md
结算、导出、OCR 人工确认等高风险动作在执行前显示动作范围、记录数量、字段范围、权限依据、审计去向和恢复路径。
```

- [x] **Step 2: Run markdown check**

Run:

```bash
pnpm exec prettier --check docs/product-function-document.md docs/superpowers/plans/2026-06-28-ops-console-ux-hardening.md
```

Expected: PASS. If it fails, run:

```bash
pnpm exec prettier --write docs/product-function-document.md docs/superpowers/plans/2026-06-28-ops-console-ux-hardening.md
```

Then rerun the check command.

- [x] **Step 3: Decide detector ignore only for intentional exceptions**

If the detector still flags an intentional documented mono font or tonal ramp, create `.impeccable/critique/ignore.md` with entries like:

```md
# Impeccable Detector Ignore

- `design-system-font` at `components/reference-ui/ops-reference.jsx:<line>` is accepted only for machine identifiers documented in `DESIGN.md`.
```

Do not ignore `side-tab`.

- [x] **Step 4: Commit docs**

```bash
git add docs/product-function-document.md docs/superpowers/plans/2026-06-28-ops-console-ux-hardening.md .impeccable/critique/ignore.md
git commit -m "docs: plan console ux hardening"
```

If `.impeccable/critique/ignore.md` is not created, omit it from `git add`.

---

## Task 8: Final Verification

**Files:**

- No planned source edits.

- [ ] **Step 1: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm vitest run app/(ops)/console/page.test.tsx features/ai/business-copilot-agent.test.ts app/api/ai/business-copilot/route.test.ts components/reference-ui/ops-reference.test.jsx
```

Expected: PASS.

- [ ] **Step 3: Run UI smoke**

Run:

```bash
pnpm test:ui-smoke
```

Expected: PASS.

- [ ] **Step 4: Run static checks**

Run:

```bash
pnpm type-check
pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Run Impeccable detector**

Run:

```bash
node "C:\Users\admin\Documents\版本2\.agents\skills\impeccable\scripts\detect.mjs" --json "app/(ops)/console/page.tsx" "components/reference-ui/ops-reference.jsx"
```

Expected:

- `app/(ops)/console/page.tsx` has no findings.
- `components/reference-ui/ops-reference.jsx` has no `side-tab`.
- Remaining `design-system-color` or `design-system-font` findings are either outside edited areas or explicitly documented.

- [ ] **Step 6: Run full repo test if time allows**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 7: Commit verification fixes only if needed**

If verification requires small fixes, stage only files touched by this plan:

```bash
git add app/(ops)/console/page.tsx app/(ops)/console/page.test.tsx features/ai/business-copilot-agent.ts features/ai/business-copilot-agent.test.ts app/api/ai/business-copilot/route.test.ts components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx DESIGN.md docs/product-function-document.md docs/superpowers/plans/2026-06-28-ops-console-ux-hardening.md
git commit -m "fix: complete console ux hardening verification"
```

If no files changed during verification, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage: The plan covers the approved first-screen action hierarchy, P1 issues, P2 risk-preflight issues, visible AI with source/confidence/manual confirmation, detector cleanup, and responsive/a11y hardening.
- Scope boundary: The plan keeps data contracts and broad module structure intact, and does not attempt a full reference UI decomposition.
- Test coverage: Route tests cover `home`; UI tests cover first-screen ordering, fallback, AI trust, risky action preflight, tabs, and legacy war-room availability; AI tests cover source/confidence/manual confirmation.
- Type consistency: AI answer fields are named consistently as `sourceSummary`, `confidence`, and `requiresHumanConfirmation` in agent, route, and UI.
- Product register: The first screen is task-first, dense, restrained, and explicit about risk; AI remains visible but subordinate to the work.
