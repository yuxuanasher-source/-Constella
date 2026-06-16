# Role-Based Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the first staff MVP of the role-based dashboard so `owner`, `ops_manager`, `operator_business`, and `finance` land on role-specific metrics, queues, risks, and drilldowns backed by one shared metric foundation.

**Architecture:** Add a focused `features/dashboards` domain module that aggregates existing project, admission, live task, report, settlement, notification, and audit DTOs into shared metric facts, then projects those facts into role-specific dashboard DTOs. Expose the DTO through `GET /api/dashboards/role-home`, hydrate `/console` with the same server loader, and render a role-aware home surface inside the existing `OpsReferenceApp` without rewriting the whole reference UI.

**Tech Stack:** Next.js App Router route handlers, React reference UI, TypeScript domain functions, Supabase-backed query modules, Vitest, React Testing Library.

---

## Scope

This plan implements the staff dashboard MVP only:

- `owner`: executive operating view.
- `ops_manager`: project delivery command view.
- `operator_business`: personal action queue.
- `finance`: settlement safety view.

This plan does not implement:

- Streamer mobile dashboard redesign.
- Collaboration MCN dashboard.
- External vendor/customer dashboard.
- New database tables, materialized views, billing gates, payment, or BI chart builder.

## File Structure

- Create: `features/dashboards/role-home.ts` 鈥?pure types, metric aggregation, role projection, field masking, empty-state helpers.
- Create: `features/dashboards/role-home.test.ts` 鈥?pure unit tests for metrics, role projection, masking, and empty states.
- Create: `features/dashboards/role-home-loader.ts` 鈥?server-side loader that calls existing query modules and builds the dashboard DTO.
- Create: `features/dashboards/role-home-loader.test.ts` 鈥?mocks existing query modules and verifies role/org scoping.
- Create: `app/api/dashboards/role-home/route.ts` 鈥?authenticated route returning `{ dashboard }`.
- Create: `app/api/dashboards/role-home/route.test.ts` 鈥?auth, error, and loader contract tests.
- Modify: `app/(ops)/console/page.tsx` 鈥?server-hydrate the dashboard and pass it to the reference UI.
- Modify: `app/(ops)/console/page.test.tsx` 鈥?assert role dashboard hydration and existing auth behavior.
- Modify: `components/reference-ui/ops-reference.jsx` 鈥?accept `dashboardHome`, store it in context, and render role home content on the warroom route.
- Modify: `components/reference-ui/ops-reference.test.jsx` 鈥?UI coverage for owner, ops manager, operator, finance, empty state, and hidden finance fields.
- Modify: `docs/product-function-document.md` only if implementation changes the documented API path or shipped scope.

---

## Task 1: Domain Types And Role Projection

**Files:**

- Create: `features/dashboards/role-home.ts`
- Create: `features/dashboards/role-home.test.ts`

- [x] **Step 1: Write the failing role projection tests**

Create `features/dashboards/role-home.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildRoleHomeDashboard, type DashboardSourceData } from "./role-home";

const source: DashboardSourceData = {
  now: "2026-06-16T09:30:00.000Z",
  projects: [
    {
      id: "project-1",
      name: "Alpha",
      status: "active",
      leadOps: "Alice",
      metrics: {
        plannedHours: 100,
        doneHours: 40,
        receivable: 100000,
        payable: 70000,
        gross: 30000,
        margin: 30,
        reportedPending: 2,
        anomalies: 1,
        audience: 12000,
      },
      streamers: { active: 3, candidate: 1, pendingReview: 2 },
      risk: "high",
    },
  ],
  tasks: [
    {
      id: "task-1",
      project: "project-1",
      projectName: "Alpha",
      streamerName: "Streamer A",
      status: "pending_live",
      plannedStartAt: "2026-06-16T08:00:00.000Z",
      plannedEndAt: "2026-06-16T10:00:00.000Z",
      anomaly: true,
    },
  ],
  reports: [
    {
      id: "report-1",
      project: "Alpha",
      streamer: "Streamer A",
      status: "pending_review",
      source: "OCR",
      duration: 120,
      audience: 1000,
    },
  ],
  settlementPool: [
    {
      id: "pool-1",
      projectName: "Alpha",
      streamerName: "Streamer A",
      expectedAmount: 8000,
      evidenceLevel: "yellow",
      timeSource: "screenshot",
    },
  ],
  batches: [
    {
      id: "batch-1",
      status: "reopened",
      projectName: "Alpha",
      totalAmount: 8000,
      itemCount: 1,
    },
  ],
  notifications: [
    {
      id: "notice-1",
      title: "Settlement batch reopened",
      type: "high_risk",
      status: "unread",
      isHighRisk: true,
      objectType: "settlement_batch",
      objectId: "batch-1",
      createdAt: "2026-06-16T09:00:00.000Z",
    },
  ],
  auditEntries: [],
};

describe("role home dashboard", () => {
  it("projects owner metrics into an executive dashboard", () => {
    const dashboard = buildRoleHomeDashboard({
      role: "owner",
      userId: "user-owner",
      organizationId: "org-1",
      source,
    });

    expect(dashboard.profile).toMatchObject({
      role: "owner",
      title: "缁忚惀鎬昏鐪嬫澘",
    });
    expect(dashboard.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "activeProjects", value: 1 }),
        expect.objectContaining({ key: "grossMarginRate", value: 30 }),
        expect.objectContaining({ key: "highRiskItems", value: 1 }),
      ]),
    );
    expect(dashboard.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "lowMarginProjects" }),
      ]),
    );
  });

  it("projects finance metrics without exposing owner-only project margin rows", () => {
    const dashboard = buildRoleHomeDashboard({
      role: "finance",
      userId: "user-finance",
      organizationId: "org-1",
      source,
    });

    expect(dashboard.profile.title).toBe("缁撶畻瀹夊叏鐪嬫澘");
    expect(dashboard.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "settlementPoolAmount", value: 8000 }),
        expect.objectContaining({ key: "weakEvidenceAmount", value: 8000 }),
      ]),
    );
    expect(JSON.stringify(dashboard)).not.toContain("gross");
    expect(JSON.stringify(dashboard)).not.toContain("marginRate");
  });

  it("projects operator metrics as a personal action queue", () => {
    const dashboard = buildRoleHomeDashboard({
      role: "operator_business",
      userId: "user-operator",
      organizationId: "org-1",
      source,
    });

    expect(dashboard.profile.title).toBe("鎴戠殑浠婃棩寰呭姙");
    expect(dashboard.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "myTodayTasks", value: 1 }),
        expect.objectContaining({ key: "pendingReports", value: 1 }),
      ]),
    );
    expect(JSON.stringify(dashboard)).not.toContain("100000");
    expect(JSON.stringify(dashboard)).not.toContain("30000");
  });

  it("returns explicit empty states for an empty source", () => {
    const dashboard = buildRoleHomeDashboard({
      role: "ops_manager",
      userId: "user-ops",
      organizationId: "org-1",
      source: {
        now: "2026-06-16T09:30:00.000Z",
        projects: [],
        tasks: [],
        reports: [],
        settlementPool: [],
        batches: [],
        notifications: [],
        auditEntries: [],
      },
    });

    expect(dashboard.profile.title).toBe("椤圭洰鎺ㄨ繘鐪嬫澘");
    expect(dashboard.emptyState).toMatchObject({
      title: "鏆傛棤闇€瑕佸鐞嗙殑椤圭洰缁忚惀鏁版嵁",
    });
  });
});
```

Run: `pnpm vitest run features/dashboards/role-home.test.ts`

Expected: FAIL with module not found for `./role-home`.

- [x] **Step 2: Implement role-home types and projections**

Create `features/dashboards/role-home.ts`:

```ts
import type { AppRole } from "@/lib/rbac/roles";

type DashboardStaffRole = Extract<
  AppRole,
  "owner" | "ops_manager" | "operator_business" | "finance"
>;

export type DashboardProjectInput = {
  id: string;
  name: string;
  status: string;
  leadOps?: string | null;
  ownerId?: string | null;
  metrics?: {
    plannedHours?: number;
    doneHours?: number;
    audience?: number;
    reportedPending?: number;
    anomalies?: number;
    receivable?: number;
    payable?: number;
    gross?: number;
    margin?: number;
  };
  streamers?: {
    active?: number;
    candidate?: number;
    pendingReview?: number;
  };
  risk?: "low" | "medium" | "high";
};

export type DashboardTaskInput = {
  id: string;
  project?: string | null;
  projectName?: string | null;
  streamerName?: string | null;
  status: string;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  anomaly?: boolean;
};

export type DashboardReportInput = {
  id: string;
  project?: string | null;
  streamer?: string | null;
  status: string;
  source?: string;
  duration?: number;
  audience?: number;
};

export type DashboardSettlementPoolInput = {
  id: string;
  projectName?: string | null;
  streamerName?: string | null;
  expectedAmount?: number;
  evidenceLevel?: "green" | "yellow" | "red" | null;
  timeSource?: string | null;
};

export type DashboardBatchInput = {
  id: string;
  status: string;
  projectName?: string | null;
  totalAmount?: number;
  itemCount?: number;
};

export type DashboardNotificationInput = {
  id: string;
  title: string;
  type: string;
  status: string;
  isHighRisk?: boolean;
  objectType?: string | null;
  objectId?: string | null;
  createdAt?: string | null;
};

export type DashboardSourceData = {
  now: string;
  projects: DashboardProjectInput[];
  tasks: DashboardTaskInput[];
  reports: DashboardReportInput[];
  settlementPool: DashboardSettlementPoolInput[];
  batches: DashboardBatchInput[];
  notifications: DashboardNotificationInput[];
  auditEntries: DashboardNotificationInput[];
};

export type DashboardKpi = {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  tone?: "neutral" | "blue" | "green" | "amber" | "red" | "violet";
  hint?: string;
};

export type DashboardQueueItem = {
  key: string;
  title: string;
  subtitle: string;
  tone: "neutral" | "blue" | "green" | "amber" | "red" | "violet";
  target: DashboardTarget;
};

export type DashboardTarget = {
  route: "projects" | "project" | "tasks" | "reports" | "settle" | "audit" | "notifications";
  id?: string;
};

export type RoleHomeDashboardDto = {
  profile: {
    role: DashboardStaffRole;
    title: string;
    subtitle: string;
    scopeLabel: string;
  };
  kpis: DashboardKpi[];
  queue: DashboardQueueItem[];
  risks: DashboardQueueItem[];
  drilldowns: DashboardQueueItem[];
  emptyState?: {
    title: string;
    hint: string;
  };
  generatedAt: string;
};

export function buildRoleHomeDashboard(input: {
  role: DashboardStaffRole;
  userId: string;
  organizationId: string;
  source: DashboardSourceData;
}): RoleHomeDashboardDto {
  const facts = collectFacts(input.source);
  const dashboard = projectFactsForRole(input.role, facts, input.source.now);

  return withEmptyState(dashboard);
}

function collectFacts(source: DashboardSourceData) {
  const activeProjects = source.projects.filter((project) =>
    ["recruiting", "pending_start", "active", "paused", "settling"].includes(
      project.status,
    ),
  );
  const totalReceivable = sumBy(source.projects, (project) => project.metrics?.receivable);
  const totalGross = sumBy(source.projects, (project) => project.metrics?.gross);
  const grossMarginRate =
    totalReceivable > 0 ? Number(((totalGross / totalReceivable) * 100).toFixed(1)) : 0;
  const lowMarginProjects = source.projects.filter(
    (project) =>
      typeof project.metrics?.margin === "number" && project.metrics.margin < 20,
  );
  const pendingReports = source.reports.filter((report) =>
    ["pending_review", "pending_adjudication"].includes(report.status),
  );
  const anomalyTasks = source.tasks.filter(
    (task) => task.anomaly || task.status === "abnormal",
  );
  const weakSettlementPool = source.settlementPool.filter(
    (item) => item.evidenceLevel === "yellow" || item.evidenceLevel === "red",
  );
  const highRiskNotices = source.notifications.filter(
    (item) => item.isHighRisk || item.type === "high_risk",
  );

  return {
    activeProjects,
    totalReceivable,
    totalGross,
    grossMarginRate,
    lowMarginProjects,
    pendingReports,
    anomalyTasks,
    weakSettlementPool,
    highRiskNotices,
    settlementPoolAmount: sumBy(source.settlementPool, (item) => item.expectedAmount),
    weakEvidenceAmount: sumBy(weakSettlementPool, (item) => item.expectedAmount),
    draftBatchCount: source.batches.filter((batch) => batch.status === "draft").length,
    reopenedBatchCount: source.batches.filter((batch) => batch.status === "reopened").length,
    recordingPendingCount: sumBy(source.projects, (project) => project.streamers?.pendingReview),
    streamerGapProjectCount: source.projects.filter(
      (project) => (project.streamers?.candidate ?? 0) > 0,
    ).length,
  };
}

function projectFactsForRole(
  role: DashboardStaffRole,
  facts: ReturnType<typeof collectFacts>,
  generatedAt: string,
): RoleHomeDashboardDto {
  if (role === "finance") {
    return financeDashboard(role, facts, generatedAt);
  }

  if (role === "operator_business") {
    return operatorDashboard(role, facts, generatedAt);
  }

  if (role === "ops_manager") {
    return opsManagerDashboard(role, facts, generatedAt);
  }

  return ownerDashboard(role, facts, generatedAt);
}

function ownerDashboard(
  role: DashboardStaffRole,
  facts: ReturnType<typeof collectFacts>,
  generatedAt: string,
): RoleHomeDashboardDto {
  return {
    profile: {
      role,
      title: "缁忚惀鎬昏鐪嬫澘",
      subtitle: "鍏虫敞鏀跺叆銆佹瘺鍒┿€佸饱绾﹀拰楂橀闄╁姩浣?,
      scopeLabel: "鍏ㄧ粍缁?,
    },
    kpis: [
      kpi("activeProjects", "杩涜涓」鐩?, facts.activeProjects.length, "涓?),
      kpi("vendorReceivable", "鏈湀鍘傚搴旀敹", facts.totalReceivable, "鍏?),
      kpi("estimatedGross", "棰勪及姣涘埄", facts.totalGross, "鍏?),
      kpi("grossMarginRate", "棰勪及姣涘埄鐜?, facts.grossMarginRate, "%"),
      kpi("highRiskItems", "楂橀闄╀簨椤?, facts.highRiskNotices.length, "椤?, "red"),
    ],
    queue: projectQueue(facts.activeProjects, "project"),
    risks: [
      riskItem(
        "lowMarginProjects",
        "浣庢瘺鍒╅」鐩?,
        `${facts.lowMarginProjects.length} 涓」鐩瘺鍒╃巼浣庝簬 20%`,
        "projects",
      ),
      riskItem(
        "reopenedBatches",
        "閲嶅紑鎵规",
        `${facts.reopenedBatchCount} 涓粨绠楁壒娆¤閲嶅紑`,
        "settle",
      ),
    ],
    drilldowns: highRiskQueue(facts.highRiskNotices),
    generatedAt,
  };
}

function opsManagerDashboard(
  role: DashboardStaffRole,
  facts: ReturnType<typeof collectFacts>,
  generatedAt: string,
): RoleHomeDashboardDto {
  return {
    profile: {
      role,
      title: "椤圭洰鎺ㄨ繘鐪嬫澘",
      subtitle: "鍏虫敞鎷涘嫙銆佸綍灞忋€佹帓鐝€佹姤鏁板拰寮傚父鍗＄偣",
      scopeLabel: "鎺堟潈椤圭洰",
    },
    kpis: [
      kpi("activeProjects", "鎷涘嫙/鎵ц椤圭洰", facts.activeProjects.length, "涓?),
      kpi("streamerGapProjects", "涓绘挱缂哄彛椤圭洰", facts.streamerGapProjectCount, "涓?),
      kpi("recordingsPending", "褰曞睆寰呭", facts.recordingPendingCount, "鏉?),
      kpi("pendingReports", "寰呭鏍告姤鏁?, facts.pendingReports.length, "鏉?),
      kpi("anomalyTasks", "寮傚父浠诲姟", facts.anomalyTasks.length, "椤?, "red"),
    ],
    queue: projectQueue(facts.activeProjects, "tasks"),
    risks: anomalyQueue(facts.anomalyTasks),
    drilldowns: reportQueue(facts.pendingReports),
    generatedAt,
  };
}

function operatorDashboard(
  role: DashboardStaffRole,
  facts: ReturnType<typeof collectFacts>,
  generatedAt: string,
): RoleHomeDashboardDto {
  return {
    profile: {
      role,
      title: "鎴戠殑浠婃棩寰呭姙",
      subtitle: "鍏虫敞鑷繁璐熻矗椤圭洰鐨勪换鍔°€佹姤鏁板拰涓绘挱鎻愰啋",
      scopeLabel: "鎴戠殑椤圭洰",
    },
    kpis: [
      kpi("myTodayTasks", "鎴戠殑浠婃棩浠诲姟", facts.activeProjects.length, "椤?),
      kpi("notStartedTasks", "鏈紑鎾?, facts.anomalyTasks.length, "椤?, "red"),
      kpi("pendingReports", "寰呭鏍告姤鏁?, facts.pendingReports.length, "鏉?),
      kpi("streamerReminders", "闇€鑱旂郴涓绘挱", facts.anomalyTasks.length, "浜?),
    ],
    queue: anomalyQueue(facts.anomalyTasks),
    risks: reportQueue(facts.pendingReports),
    drilldowns: projectQueue(facts.activeProjects, "project"),
    generatedAt,
  };
}

function financeDashboard(
  role: DashboardStaffRole,
  facts: ReturnType<typeof collectFacts>,
  generatedAt: string,
): RoleHomeDashboardDto {
  return {
    profile: {
      role,
      title: "缁撶畻瀹夊叏鐪嬫澘",
      subtitle: "鍏虫敞鍙粨绠楁睜銆佸急璇佹嵁銆佷汉宸ユ壙杞藉拰鎵规鐘舵€?,
      scopeLabel: "璐㈠姟鎺堟潈鑼冨洿",
    },
    kpis: [
      kpi("settlementPoolAmount", "鍙粨绠楁睜閲戦", facts.settlementPoolAmount, "鍏?),
      kpi("settlementPoolCount", "鍙粨绠楁姤鏁?, facts.weakSettlementPool.length, "鏉?),
      kpi("draftBatches", "寰呯敓鎴愭壒娆?, facts.draftBatchCount, "涓?),
      kpi("weakEvidenceAmount", "寮辫瘉鎹噾棰?, facts.weakEvidenceAmount, "鍏?, "amber"),
      kpi("reopenedBatches", "閲嶅紑鎵规", facts.reopenedBatchCount, "涓?, "red"),
    ],
    queue: [
      riskItem(
        "settlementPool",
        "鍙粨绠楁睜棰勮",
        `${facts.weakSettlementPool.length} 鏉″急璇佹嵁鎶ユ暟闇€瑕佸鏍竊,
        "settle",
      ),
    ],
    risks: [
      riskItem(
        "weakEvidence",
        "寮辫瘉鎹噾棰?,
        `楼${facts.weakEvidenceAmount.toLocaleString("zh-CN")}`,
        "settle",
      ),
    ],
    drilldowns: [],
    generatedAt,
  };
}

function kpi(
  key: string,
  label: string,
  value: number | string,
  unit?: string,
  tone: DashboardKpi["tone"] = "neutral",
): DashboardKpi {
  return { key, label, value, unit, tone };
}

function projectQueue(projects: DashboardProjectInput[], route: DashboardTarget["route"]) {
  return projects.slice(0, 5).map((project) => ({
    key: `project:${project.id}`,
    title: project.name,
    subtitle: project.leadOps ? `${project.status} 路 ${project.leadOps}` : project.status,
    tone: project.risk === "high" ? "red" : "neutral",
    target: { route, id: project.id },
  })) satisfies DashboardQueueItem[];
}

function reportQueue(reports: DashboardReportInput[]) {
  return reports.slice(0, 5).map((report) => ({
    key: `report:${report.id}`,
    title: report.project || "鏈煡椤圭洰",
    subtitle: `${report.streamer || "鏈煡涓绘挱"} 路 ${report.status}`,
    tone: report.status === "pending_adjudication" ? "violet" : "blue",
    target: { route: "reports", id: report.id },
  })) satisfies DashboardQueueItem[];
}

function anomalyQueue(tasks: DashboardTaskInput[]) {
  return tasks.slice(0, 5).map((task) => ({
    key: `task:${task.id}`,
    title: task.projectName || task.project || "鏈煡椤圭洰",
    subtitle: `${task.streamerName || "鏈煡涓绘挱"} 路 ${task.status}`,
    tone: "red",
    target: { route: "tasks", id: task.id },
  })) satisfies DashboardQueueItem[];
}

function highRiskQueue(items: DashboardNotificationInput[]) {
  return items.slice(0, 5).map((item) => ({
    key: `notice:${item.id}`,
    title: item.title,
    subtitle: item.type,
    tone: "red",
    target: {
      route: item.objectType === "settlement_batch" ? "settle" : "audit",
      id: item.objectId || item.id,
    },
  })) satisfies DashboardQueueItem[];
}

function riskItem(
  key: string,
  title: string,
  subtitle: string,
  route: DashboardTarget["route"],
): DashboardQueueItem {
  return {
    key,
    title,
    subtitle,
    tone: "amber",
    target: { route },
  };
}

function sumBy<T>(items: T[], getter: (item: T) => number | null | undefined) {
  return items.reduce((sum, item) => sum + (getter(item) ?? 0), 0);
}

function withEmptyState(dashboard: RoleHomeDashboardDto): RoleHomeDashboardDto {
  const hasContent =
    dashboard.kpis.some((item) => Number(item.value) > 0) ||
    dashboard.queue.length > 0 ||
    dashboard.risks.length > 0 ||
    dashboard.drilldowns.length > 0;

  if (hasContent) {
    return dashboard;
  }

  return {
    ...dashboard,
    emptyState: {
      title: "鏆傛棤闇€瑕佸鐞嗙殑椤圭洰缁忚惀鏁版嵁",
      hint: "鏈夐」鐩€佷换鍔°€佹姤鏁版垨缁撶畻璁板綍鍚庯紝杩欓噷浼氭樉绀哄搴旂湅鏉裤€?,
    },
  };
}
```

- [x] **Step 3: Run unit tests**

Run: `pnpm vitest run features/dashboards/role-home.test.ts`

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add features/dashboards/role-home.ts features/dashboards/role-home.test.ts
git commit -m "feat: add role home dashboard projection"
```

---

## Task 2: Server Loader From Existing Query Modules

**Files:**

- Create: `features/dashboards/role-home-loader.ts`
- Create: `features/dashboards/role-home-loader.test.ts`

- [x] **Step 1: Write the failing loader test**

Create `features/dashboards/role-home-loader.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listNotificationCenterItems } from "@/features/notifications/notification-center-queries";
import { listProjects } from "@/features/projects/project-queries";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";
import {
  listOpsSettlementBatches,
  listOpsSettlementPool,
} from "@/features/settlements/settlement-queries";
import {
  listOpsLiveReportQueue,
  listOpsLiveTaskQueue,
} from "@/features/live-operations/live-operations-queries";

import { loadRoleHomeDashboard } from "./role-home-loader";

vi.mock("@/features/projects/project-queries", () => ({
  listProjects: vi.fn(),
}));

vi.mock("@/features/projects/project-ui-dto", () => ({
  toProjectCardDtos: vi.fn(),
}));

vi.mock("@/features/live-operations/live-operations-queries", () => ({
  listOpsLiveTaskQueue: vi.fn(),
  listOpsLiveReportQueue: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-queries", () => ({
  listOpsSettlementPool: vi.fn(),
  listOpsSettlementBatches: vi.fn(),
}));

vi.mock("@/features/notifications/notification-center-queries", () => ({
  listNotificationCenterItems: vi.fn(),
}));

describe("loadRoleHomeDashboard", () => {
  const supabase = {};
  const auth = {
    userId: "user-1",
    email: "owner@example.test",
    name: "Owner",
    organizationId: "org-1",
    organizationName: "Org",
    role: "owner" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(toProjectCardDtos).mockReturnValue([]);
    vi.mocked(listOpsLiveTaskQueue).mockResolvedValue([]);
    vi.mocked(listOpsLiveReportQueue).mockResolvedValue([]);
    vi.mocked(listOpsSettlementPool).mockResolvedValue([]);
    vi.mocked(listOpsSettlementBatches).mockResolvedValue([]);
    vi.mocked(listNotificationCenterItems).mockResolvedValue([]);
  });

  it("loads dashboard source data scoped to the authenticated organization", async () => {
    const dashboard = await loadRoleHomeDashboard({
      supabase: supabase as never,
      auth,
      now: "2026-06-16T09:30:00.000Z",
    });

    expect(dashboard.profile.role).toBe("owner");
    expect(listOpsLiveTaskQueue).toHaveBeenCalledWith(supabase, "org-1");
    expect(listOpsLiveReportQueue).toHaveBeenCalledWith(supabase, "org-1");
    expect(listOpsSettlementPool).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
      projectId: null,
      batchType: "payable",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    expect(listNotificationCenterItems).toHaveBeenCalledWith(
      supabase,
      {
        userId: "user-1",
        role: "owner",
        organizationId: "org-1",
      },
      { limit: 20 },
    );
  });

  it("rejects streamer accounts because this loader is staff-only", async () => {
    await expect(
      loadRoleHomeDashboard({
        supabase: supabase as never,
        auth: { ...auth, role: "streamer" },
        now: "2026-06-16T09:30:00.000Z",
      }),
    ).rejects.toThrow(/Only MCN staff/);
  });
});
```

Run: `pnpm vitest run features/dashboards/role-home-loader.test.ts`

Expected: FAIL with module not found for `./role-home-loader`.

- [x] **Step 2: Implement the loader**

Create `features/dashboards/role-home-loader.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthContext } from "@/lib/auth/context";
import { isMcnStaff } from "@/lib/rbac/roles";
import {
  listOpsLiveReportQueue,
  listOpsLiveTaskQueue,
} from "@/features/live-operations/live-operations-queries";
import { listNotificationCenterItems } from "@/features/notifications/notification-center-queries";
import { listProjects } from "@/features/projects/project-queries";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";
import {
  listOpsSettlementBatches,
  listOpsSettlementPool,
} from "@/features/settlements/settlement-queries";

import {
  buildRoleHomeDashboard,
  type DashboardBatchInput,
  type DashboardReportInput,
  type DashboardSettlementPoolInput,
  type DashboardTaskInput,
  type RoleHomeDashboardDto,
} from "./role-home";

type StaffDashboardRole = RoleHomeDashboardDto["profile"]["role"];

export async function loadRoleHomeDashboard(input: {
  supabase: SupabaseClient;
  auth: AuthContext;
  now?: string;
}): Promise<RoleHomeDashboardDto> {
  if (!isMcnStaff(input.auth.role)) {
    throw new Error("Only MCN staff can view the role dashboard");
  }

  const now = input.now ?? new Date().toISOString();
  const period = currentMonthPeriod(now);
  const actor = {
    userId: input.auth.userId,
    role: input.auth.role,
    organizationId: input.auth.organizationId,
  };

  const [
    projectRows,
    taskRows,
    reportRows,
    settlementPool,
    batches,
    notifications,
  ] = await Promise.all([
    listProjects(input.supabase),
    listOpsLiveTaskQueue(input.supabase, input.auth.organizationId),
    listOpsLiveReportQueue(input.supabase, input.auth.organizationId),
    listOpsSettlementPool(input.supabase, {
      organizationId: input.auth.organizationId,
      projectId: null,
      batchType: "payable",
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    }),
    listOpsSettlementBatches(input.supabase, input.auth.organizationId),
    listNotificationCenterItems(input.supabase, actor, { limit: 20 }),
  ]);

  return buildRoleHomeDashboard({
    role: input.auth.role as StaffDashboardRole,
    userId: input.auth.userId,
    organizationId: input.auth.organizationId,
    source: {
      now,
      projects: toProjectCardDtos(projectRows),
      tasks: taskRows.map(toDashboardTask),
      reports: reportRows.map(toDashboardReport),
      settlementPool: settlementPool.map(toDashboardSettlementPoolItem),
      batches: batches.map(toDashboardBatch),
      notifications,
      auditEntries: [],
    },
  });
}

function currentMonthPeriod(now: string) {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));

  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

function toDashboardTask(task: {
  id: string;
  projectId?: string | null;
  projectName: string;
  streamerName: string;
  status: string;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
}): DashboardTaskInput {
  return {
    id: task.id,
    project: task.projectId,
    projectName: task.projectName,
    streamerName: task.streamerName,
    status: task.status,
    plannedStartAt: task.plannedStartAt,
    plannedEndAt: task.plannedEndAt,
    anomaly: task.status === "abnormal",
  };
}

function toDashboardReport(report: {
  id: string;
  projectName: string;
  streamerName: string;
  status: string;
  timeSource?: string | null;
  settlementDuration?: number | null;
  viewers?: number | null;
}): DashboardReportInput {
  return {
    id: report.id,
    project: report.projectName,
    streamer: report.streamerName,
    status: report.status,
    source: report.timeSource === "system" ? "system" : "OCR",
    duration: report.settlementDuration ?? 0,
    audience: report.viewers ?? 0,
  };
}

function toDashboardSettlementPoolItem(item: {
  id: string;
  projectName: string;
  streamerName: string;
  expectedAmount: number;
  evidenceLevel: "green" | "yellow" | "red" | null;
  timeSource: string | null;
}): DashboardSettlementPoolInput {
  return {
    id: item.id,
    projectName: item.projectName,
    streamerName: item.streamerName,
    expectedAmount: item.expectedAmount,
    evidenceLevel: item.evidenceLevel,
    timeSource: item.timeSource,
  };
}

function toDashboardBatch(batch: {
  id: string;
  status: string;
  projectName: string;
  totalAmount: number;
  itemCount: number;
}): DashboardBatchInput {
  return {
    id: batch.id,
    status: batch.status,
    projectName: batch.projectName,
    totalAmount: batch.totalAmount,
    itemCount: batch.itemCount,
  };
}
```

- [x] **Step 3: Run loader tests**

Run: `pnpm vitest run features/dashboards/role-home-loader.test.ts`

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add features/dashboards/role-home-loader.ts features/dashboards/role-home-loader.test.ts
git commit -m "feat: load role home dashboard data"
```

---

## Task 3: Role Home API Route

**Files:**

- Create: `app/api/dashboards/role-home/route.ts`
- Create: `app/api/dashboards/role-home/route.test.ts`

- [x] **Step 1: Write the failing route test**

Create `app/api/dashboards/role-home/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/dashboards/role-home-loader", () => ({
  loadRoleHomeDashboard: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

describe("role home dashboard route", () => {
  const supabase = {};
  const auth = {
    userId: "user-owner",
    email: "owner@example.test",
    name: "Owner",
    organizationId: "org-1",
    organizationName: "Org",
    role: "owner" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(loadRoleHomeDashboard).mockResolvedValue({
      profile: {
        role: "owner",
        title: "缁忚惀鎬昏鐪嬫澘",
        subtitle: "鍏虫敞鏀跺叆銆佹瘺鍒┿€佸饱绾﹀拰楂橀闄╁姩浣?,
        scopeLabel: "鍏ㄧ粍缁?,
      },
      kpis: [],
      queue: [],
      risks: [],
      drilldowns: [],
      generatedAt: "2026-06-16T09:30:00.000Z",
    });
  });

  it("returns the authenticated role dashboard", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dashboard.profile.title).toBe("缁忚惀鎬昏鐪嬫澘");
    expect(loadRoleHomeDashboard).toHaveBeenCalledWith({
      supabase,
      auth,
    });
  });

  it("returns 401 without auth", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(401);
  });
});
```

Run: `pnpm vitest run app/api/dashboards/role-home/route.test.ts`

Expected: FAIL with module not found for `./route`.

- [x] **Step 2: Implement the route**

Create `app/api/dashboards/role-home/route.ts`:

```ts
import { NextResponse } from "next/server";

import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;

    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dashboard = await loadRoleHomeDashboard({ supabase, auth });

    return NextResponse.json({ dashboard });
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

- [x] **Step 3: Run route tests**

Run: `pnpm vitest run app/api/dashboards/role-home/route.test.ts`

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add app/api/dashboards/role-home/route.ts app/api/dashboards/role-home/route.test.ts
git commit -m "feat: expose role home dashboard API"
```

---

## Task 4: Console Page Server Hydration

**Files:**

- Modify: `app/(ops)/console/page.tsx`
- Modify: `app/(ops)/console/page.test.tsx`

- [x] **Step 1: Write the failing console hydration test**

In `app/(ops)/console/page.test.tsx`, update the `OpsReferenceApp` mock type and add a dashboard assertion:

```ts
vi.mock("@/components/reference-ui/ops-reference", () => ({
  default: vi.fn((props: { currentUser?: { name?: string }; dashboardHome?: { profile?: { title?: string } } }) => (
    <div data-testid="ops-reference-app">
      {props.currentUser?.name ?? "missing-user"}
      <span>{props.dashboardHome?.profile?.title ?? "missing-dashboard"}</span>
    </div>
  )),
}));
```

Add the loader mock:

```ts
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";

vi.mock("@/features/dashboards/role-home-loader", () => ({
  loadRoleHomeDashboard: vi.fn(),
}));
```

In `beforeEach`, set:

```ts
vi.mocked(loadRoleHomeDashboard).mockResolvedValue({
  profile: {
    role: "ops_manager",
    title: "椤圭洰鎺ㄨ繘鐪嬫澘",
    subtitle: "鍏虫敞鎷涘嫙銆佸綍灞忋€佹帓鐝€佹姤鏁板拰寮傚父鍗＄偣",
    scopeLabel: "鎺堟潈椤圭洰",
  },
  kpis: [],
  queue: [],
  risks: [],
  drilldowns: [],
  generatedAt: "2026-06-16T09:30:00.000Z",
});
```

Extend the existing happy-path expectation:

```ts
expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
  "椤圭洰鎺ㄨ繘鐪嬫澘",
);
expect(loadRoleHomeDashboard).toHaveBeenCalledWith({
  supabase,
  auth: expect.objectContaining({
    userId: "user-ops",
    role: "ops_manager",
  }),
});
expect(OpsReferenceApp).toHaveBeenCalledWith(
  expect.objectContaining({
    initialRoute: "warroom",
    dashboardHome: expect.objectContaining({
      profile: expect.objectContaining({ title: "椤圭洰鎺ㄨ繘鐪嬫澘" }),
    }),
  }),
  undefined,
);
```

Run: `pnpm vitest run app/(ops)/console/page.test.tsx`

Expected: FAIL because `ConsolePage` does not load or pass `dashboardHome`.

- [x] **Step 2: Hydrate the dashboard in the console page**

Modify `app/(ops)/console/page.tsx`:

```tsx
import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";

import {
  currentUserFromAuth,
  organizationSettingsFromAuth,
  requireConsoleStaffAuth,
} from "./console-auth";

export default async function ConsolePage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  const dashboardHome = await loadRoleHomeDashboard({ supabase, auth });

  return (
    <OpsReferenceApp
      initialRoute="warroom"
      dashboardHome={dashboardHome}
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettingsFromAuth(auth)}
    />
  );
}
```

- [x] **Step 3: Run console page tests**

Run: `pnpm vitest run app/(ops)/console/page.test.tsx`

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add app/(ops)/console/page.tsx app/(ops)/console/page.test.tsx
git commit -m "feat: hydrate console role dashboard"
```

---

## Task 5: Reference UI Role Home Renderer

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [x] **Step 1: Write the failing UI tests**

Add tests to `components/reference-ui/ops-reference.test.jsx`:

```jsx
it("renders owner role dashboard cards on the warroom route", () => {
  render(
    <OpsReferenceApp
      initialRoute="warroom"
      currentUser={{ id: "owner-1", name: "Owner", role: "owner" }}
      dashboardHome={{
        profile: {
          role: "owner",
          title: "缁忚惀鎬昏鐪嬫澘",
          subtitle: "鍏虫敞鏀跺叆銆佹瘺鍒┿€佸饱绾﹀拰楂橀闄╁姩浣?,
          scopeLabel: "鍏ㄧ粍缁?,
        },
        kpis: [
          { key: "activeProjects", label: "杩涜涓」鐩?, value: 3, unit: "涓? },
          { key: "grossMarginRate", label: "棰勪及姣涘埄鐜?, value: 31.2, unit: "%" },
        ],
        queue: [
          {
            key: "project:1",
            title: "Alpha",
            subtitle: "active 路 Alice",
            tone: "neutral",
            target: { route: "project", id: "project-1" },
          },
        ],
        risks: [],
        drilldowns: [],
        generatedAt: "2026-06-16T09:30:00.000Z",
      }}
    />,
  );

  expect(screen.getByText("缁忚惀鎬昏鐪嬫澘")).toBeInTheDocument();
  expect(screen.getByText("杩涜涓」鐩?)).toBeInTheDocument();
  expect(screen.getByText("棰勪及姣涘埄鐜?)).toBeInTheDocument();
  expect(screen.getByText("Alpha")).toBeInTheDocument();
});

it("renders finance dashboard without owner margin cards", () => {
  render(
    <OpsReferenceApp
      initialRoute="warroom"
      currentUser={{ id: "finance-1", name: "Finance", role: "finance" }}
      dashboardHome={{
        profile: {
          role: "finance",
          title: "缁撶畻瀹夊叏鐪嬫澘",
          subtitle: "鍏虫敞鍙粨绠楁睜銆佸急璇佹嵁銆佷汉宸ユ壙杞藉拰鎵规鐘舵€?,
          scopeLabel: "璐㈠姟鎺堟潈鑼冨洿",
        },
        kpis: [
          { key: "settlementPoolAmount", label: "鍙粨绠楁睜閲戦", value: 8000, unit: "鍏? },
          { key: "weakEvidenceAmount", label: "寮辫瘉鎹噾棰?, value: 1200, unit: "鍏? },
        ],
        queue: [],
        risks: [],
        drilldowns: [],
        generatedAt: "2026-06-16T09:30:00.000Z",
      }}
    />,
  );

  expect(screen.getByText("缁撶畻瀹夊叏鐪嬫澘")).toBeInTheDocument();
  expect(screen.getByText("鍙粨绠楁睜閲戦")).toBeInTheDocument();
  expect(screen.queryByText("棰勪及姣涘埄鐜?)).not.toBeInTheDocument();
});
```

Run: `pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "role dashboard"`

Expected: FAIL because `dashboardHome` is ignored.

- [x] **Step 2: Add dashboardHome to context and props**

In `components/reference-ui/ops-reference.jsx`, extend the context default:

```jsx
const OpsLiveDataContext = React.createContext({
  projects: null,
  streamers: null,
  applications: null,
  tasks: null,
  reports: null,
  batches: null,
  batchDetails: null,
  settlementPool: null,
  collaborationProjects: null,
  settlementScope: null,
  auditEntries: null,
  ocrJobs: null,
  notificationItems: null,
  organizationMembers: null,
  organizationMemberPermissions: null,
  organizationSettings: DEFAULT_ORGANIZATION_SETTINGS,
  billingStatus: null,
  dashboardHome: null,
  currentUser: DEFAULT_CURRENT_USER,
  actions: {},
});
```

Add a hook near `useOpsBillingStatus`:

```jsx
function useOpsDashboardHome() {
  const { dashboardHome } = React.useContext(OpsLiveDataContext);
  return dashboardHome && typeof dashboardHome === "object"
    ? dashboardHome
    : null;
}
```

Add `dashboardHome` to `OpsReferenceInner` parameters, provider value, JSDoc, and `OpsReferenceApp` forwarding.

- [x] **Step 3: Render role home before the existing warroom fallback**

In `ScreenWarRoom`, add:

```jsx
const dashboardHome = useOpsDashboardHome();

if (dashboardHome) {
  return <ScreenRoleHome dashboard={dashboardHome} go={go} />;
}
```

Add this component before `ScreenWarRoom`:

```jsx
function ScreenRoleHome({ dashboard, go }) {
  const generatedAt = dashboard.generatedAt
    ? new Date(dashboard.generatedAt).toLocaleString("zh-CN")
    : "";

  return (
    <>
      <PageHeader
        title={dashboard.profile?.title || "瑙掕壊鐪嬫澘"}
        subtitle={dashboard.profile?.subtitle || "鎸夊綋鍓嶈处鍙峰睍绀虹粡钀ラ噸鐐?}
        status={
          <span className="badge neutral">
            {dashboard.profile?.scopeLabel || "鎺堟潈鑼冨洿"}
          </span>
        }
      />
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        {dashboard.emptyState ? (
          <EmptyHint
            title={dashboard.emptyState.title}
            hint={dashboard.emptyState.hint}
          />
        ) : null}
        <RoleHomeKpis items={dashboard.kpis || []} />
        <RoleHomeSection title="浼樺厛澶勭悊" items={dashboard.queue || []} go={go} />
        <RoleHomeSection title="椋庨櫓鎻愰啋" items={dashboard.risks || []} go={go} />
        <RoleHomeSection title="甯哥敤鍏ュ彛" items={dashboard.drilldowns || []} go={go} />
        {generatedAt ? (
          <div style={{ color: "var(--ink-500)", fontSize: 12 }}>
            鏁版嵁鏇存柊鏃堕棿锛歿generatedAt}
          </div>
        ) : null}
      </div>
    </>
  );
}

function RoleHomeKpis({ items }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 12,
      }}
    >
      {items.map((item) => (
        <Card key={item.key}>
          <Metric
            label={item.label}
            value={String(item.value)}
            unit={item.unit}
            hint={item.hint}
          />
        </Card>
      ))}
    </div>
  );
}

function RoleHomeSection({ title, items, go }) {
  if (!items.length) {
    return null;
  }

  return (
    <Card padded={false}>
      <div style={{ padding: 16, borderBottom: "1px solid var(--line)" }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
      </div>
      <div style={{ display: "grid", gap: 0 }}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => go(item.target?.route || "warroom")}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 16px",
              border: 0,
              borderBottom: "1px solid var(--line)",
              background: "#fff",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span>
              <b>{item.title}</b>
              <br />
              <span style={{ color: "var(--ink-500)", fontSize: 12 }}>
                {item.subtitle}
              </span>
            </span>
            <Badge tone={item.tone || "neutral"}>{item.target?.route || "鏌ョ湅"}</Badge>
          </button>
        ))}
      </div>
    </Card>
  );
}
```

- [x] **Step 4: Run UI tests**

Run: `pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "role dashboard"`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: render role-based dashboard home"
```

---

## Task 6: Role Masking Regression Coverage

**Files:**

- Modify: `features/dashboards/role-home.test.ts`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [x] **Step 1: Add explicit forbidden-field tests**

In `features/dashboards/role-home.test.ts`, add:

```ts
it("does not serialize forbidden financial fields for operator and finance projections", () => {
  for (const role of ["operator_business", "finance"] as const) {
    const dashboard = buildRoleHomeDashboard({
      role,
      userId: `user-${role}`,
      organizationId: "org-1",
      source,
    });
    const json = JSON.stringify(dashboard);

    expect(json).not.toContain("vendorReceivable");
    expect(json).not.toContain("estimatedGross");
    expect(json).not.toContain("supplierCost");
    expect(json).not.toContain("internalRisk");
  }
});
```

Run: `pnpm vitest run features/dashboards/role-home.test.ts -t "forbidden"`

Expected: PASS if earlier projections are safe; FAIL if any forbidden card leaks.

- [x] **Step 2: Add UI hidden-text regression**

In `components/reference-ui/ops-reference.test.jsx`, add a case for operator:

```jsx
it("does not render executive finance labels for operator dashboard", () => {
  render(
    <OpsReferenceApp
      initialRoute="warroom"
      currentUser={{ id: "operator-1", name: "Operator", role: "operator_business" }}
      dashboardHome={{
        profile: {
          role: "operator_business",
          title: "鎴戠殑浠婃棩寰呭姙",
          subtitle: "鍏虫敞鑷繁璐熻矗椤圭洰鐨勪换鍔°€佹姤鏁板拰涓绘挱鎻愰啋",
          scopeLabel: "鎴戠殑椤圭洰",
        },
        kpis: [
          { key: "myTodayTasks", label: "鎴戠殑浠婃棩浠诲姟", value: 4, unit: "椤? },
          { key: "pendingReports", label: "寰呭鏍告姤鏁?, value: 2, unit: "鏉? },
        ],
        queue: [],
        risks: [],
        drilldowns: [],
        generatedAt: "2026-06-16T09:30:00.000Z",
      }}
    />,
  );

  expect(screen.getByText("鎴戠殑浠婃棩寰呭姙")).toBeInTheDocument();
  expect(screen.queryByText("鏈湀鍘傚搴旀敹")).not.toBeInTheDocument();
  expect(screen.queryByText("棰勪及姣涘埄")).not.toBeInTheDocument();
});
```

Run: `pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "operator dashboard"`

Expected: PASS.

- [x] **Step 3: Run focused dashboard suite**

Run:

```bash
pnpm vitest run features/dashboards components/reference-ui/ops-reference.test.jsx app/api/dashboards/role-home/route.test.ts app/(ops)/console/page.test.tsx
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add features/dashboards/role-home.test.ts components/reference-ui/ops-reference.test.jsx
git commit -m "test: cover role dashboard masking"
```

---

## Task 7: Product Document Sync And Route Contract Note

**Files:**

- Modify: `docs/product-function-document.md`
- Modify if route maps require it after implementation: `features/ui-route-contracts/module-route-map.ts`

- [x] **Step 1: Verify the product document matches the implemented route**

Run:

```bash
rg -n "/api/dashboards/role-home|瑙掕壊鍖栭粯璁ょ湅鏉縷M10 瑙掕壊鍖栫湅鏉? docs/product-function-document.md
```

Expected: lines exist for the role dashboard product section, API table, and testing coverage table.

- [x] **Step 2: Keep module route map unchanged unless tests require a route-key update**

Run:

```bash
pnpm vitest run features/ui-route-contracts
```

Expected: PASS. If it fails because the warroom route metadata needs a label update, change only the warroom module copy in `features/ui-route-contracts/module-route-map.ts` and rerun the same command.

- [x] **Step 3: Commit documentation or route-copy updates**

```bash
git add docs/product-function-document.md features/ui-route-contracts/module-route-map.ts
git commit -m "docs: sync role dashboard product surface"
```

If `features/ui-route-contracts/module-route-map.ts` is unchanged, omit it from `git add`.

---

## Task 8: Full Verification

**Files:**

- No source edits expected.

- [x] **Step 1: Run whitespace check**

Run: `git diff --check`

Expected: no output.

- [x] **Step 2: Run focused test suite**

Run:

```bash
pnpm vitest run features/dashboards app/api/dashboards/role-home/route.test.ts app/(ops)/console/page.test.tsx components/reference-ui/ops-reference.test.jsx
```

Expected: PASS.

- [x] **Step 3: Run repo verification chain**

Run:

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected: all commands exit 0. The known Babel deopt note for `components/reference-ui/ops-reference.jsx` can appear during lint/build if the command still exits 0.

- [x] **Step 4: Final commit if verification required fixes**

If Step 1-3 required small fixes, commit only those files:

```bash
git add features/dashboards app/api/dashboards app/(ops)/console components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx docs/product-function-document.md
git commit -m "fix: complete role dashboard verification"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage: staff roles, shared metric foundation, service-side masking, API, `/console` default homepage, UI, empty states, and tests are covered by Tasks 1-8.
- Scope boundary: streamer, collaboration MCN, and vendor/customer dashboards remain outside this MVP and are documented as separate surfaces.
- Type consistency: all role names use existing `AppRole` values: `owner`, `ops_manager`, `operator_business`, `finance`, `streamer`.
- Data safety: finance and operator projections do not serialize owner-only revenue or margin cards unless future permission policy explicitly allows it.
- Verification: focused tests plus `type-check`, `lint`, `test`, and `build` are included.
