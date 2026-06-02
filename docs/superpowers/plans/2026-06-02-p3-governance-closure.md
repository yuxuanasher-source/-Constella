# P3 Governance Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前只有 UI 或半接入的治理层补成可验证闭环：审计中心、通知待办、异常扫描、导出中心、厂家交付包。

**Architecture:** 沿用现有 P1/P2 范式：每个功能先写服务/查询层测试，再接 Route Handler，再把现有参考 UI 的视觉壳接入真实 DTO。所有写操作继续经过 `lib/audit/writeAuditLog`，所有跨角色输出都在服务端 DTO 层脱敏，前端只负责展示和交互。

**Tech Stack:** Next.js App Router, React, TypeScript strict, Supabase Postgres with RLS, Vitest, Testing Library, existing reference UI components.

---

## Current Baseline

- P1/P2 主链路已经有真实后端：M4 排班、M5 报数审核、M6 结算批次。
- M1/M2/M3 已有服务和测试，但前端业务表单与黄金路径 UI smoke 未完整接入。
- M7 审计中心已有未提交 WIP：`features/audit-center/` 与 `app/api/audit-logs/`。
- M8/M9/M10/M11 仍主要是参考 UI 或壳。
- 主播端 `/m/tasks` 和 `/m/me` 已接真实数据；`/m/recordings`、`/m/diagnosis`、`/desktop` 仍是视觉外壳。

## File Structure

### Audit Center

- Modify: `features/audit-center/audit-center-queries.ts`
  - 负责审计日志只读查询、角色过滤、筛选参数、DTO 映射。
- Modify: `features/audit-center/audit-center-queries.test.ts`
  - 覆盖 owner/ops/finance/operator 的可见范围和高风险筛选。
- Modify: `app/api/audit-logs/route.ts`
  - 只暴露 GET；不暴露 POST/PATCH/DELETE。
- Modify: `app/api/audit-logs/route.test.ts`
  - 固定 query params 到服务层参数映射。
- Modify: `components/reference-ui/ops-reference.jsx`
  - 把 `route === "audit"` 从 `PlaceholderScreen` 改成真实审计表格视图。
- Modify: `components/reference-ui/ops-reference.test.jsx`
  - 覆盖审计中心首屏、筛选、高风险标识。
- Modify: `app/(ops)/console/stubs/[module]/page.tsx`
  - 为 `m7` 注入审计日志初始数据。

### Notification And Todo Center

- Create: `features/notifications/notification-center-queries.ts`
  - 负责我的通知、角色通知、未读数、待办 DTO。
- Create: `features/notifications/notification-center-queries.test.ts`
  - 覆盖角色通知、用户通知、状态过滤。
- Create: `features/notifications/notification-service.ts`
  - 负责 read/handled/ignored 状态变更，写审计。
- Create: `features/notifications/notification-service.test.ts`
  - 覆盖只能处理本组织和本人可见通知。
- Create: `app/api/notifications/route.ts`
  - `GET` 返回铃铛和通知中心列表。
- Create: `app/api/notifications/[notificationId]/route.ts`
  - `PATCH` 支持 `read`、`handled`、`ignored` 三种状态动作。
- Create: `app/api/notifications/route.test.ts`
  - 固定通知中心 API DTO。
- Create: `app/api/notifications/[notificationId]/route.test.ts`
  - 固定状态动作和 403 边界。
- Modify: `components/layouts/ops-shell.tsx`
  - M9 菜单仍指向 `/console/stubs/m9`，但语义改成通知待办。
- Modify: `components/reference-ui/ops-reference.jsx`
  - 新增真实通知待办视图，复用现有商务后台视觉。

### Anomaly Scanner

- Create: `features/anomalies/anomaly-rules.ts`
  - 纯函数规则：未开播、未报数、报数逾期、缺少下播截图、直播超过 48 小时。
- Create: `features/anomalies/anomaly-rules.test.ts`
  - 覆盖每条规则和边界时间。
- Create: `features/anomalies/anomaly-scanner.ts`
  - 从任务/报数数据生成异常项，幂等写入通知。
- Create: `features/anomalies/anomaly-scanner.test.ts`
  - 覆盖不重复推送和跨组织隔离。
- Create: `app/api/anomalies/scan/route.ts`
  - 骨架期占位异步入口：只允许 owner/ops_manager/operator_business 手动触发扫描。
- Create: `app/api/anomalies/scan/route.test.ts`
  - 覆盖权限、响应体、审计。
- Modify: `docs/checklists/P3-governance.md`
  - 勾选异常扫描范围与验证命令。

### Export Center

- Create: `features/exports/export-definitions.ts`
  - 定义可导出对象、字段白名单、敏感字段标记、角色可见规则。
- Create: `features/exports/export-definitions.test.ts`
  - 覆盖主播/厂家/财务/运营输出字段不泄漏。
- Create: `features/exports/export-service.ts`
  - 骨架期生成 CSV 文本和导出审计日志，不接真实后台 worker。
- Create: `features/exports/export-service.test.ts`
  - 覆盖字段顺序、脱敏、导出审计。
- Create: `app/api/exports/route.ts`
  - `POST` 创建导出占位任务并返回 CSV preview metadata。
- Create: `app/api/exports/route.test.ts`
  - 固定导出请求与 403 边界。
- Modify: `components/reference-ui/ops-reference.jsx`
  - 把 `route === "export"` 从占位页改成导出中心视图。
- Modify: `components/reference-ui/ops-reference.test.jsx`
  - 覆盖选择导出类型、展示字段、提交导出请求。

### Vendor Delivery Package

- Create: `features/delivery-packages/delivery-package-dto.ts`
  - 厂家交付包 DTO：候选主播、执行报数、截图证明、结算摘要；排除成本、毛利、内部风险备注。
- Create: `features/delivery-packages/delivery-package-dto.test.ts`
  - 覆盖敏感字段不存在和字段名稳定。
- Create: `app/api/delivery-packages/route.ts`
  - `GET` 按 `projectId` 返回厂家安全交付包。
- Create: `app/api/delivery-packages/route.test.ts`
  - 覆盖项目权限、字段脱敏、空数据响应。

### Verification

- Modify: `docs/checklists/P3-governance.md`
  - 每个完成项写清命令和通过条件。
- Modify: `package.json`
  - 如果已有脚本不能覆盖 P3 smoke，新增 `test:p3-governance` 聚合命令。
- Create: `features/regression/governance-golden-path.test.ts`
  - 覆盖 P1/P2 动作产生审计和通知，P3 可查询、可导出、可扫描。

---

## Task 1: Stabilize Audit Center Read API

**Files:**

- Modify: `features/audit-center/audit-center-queries.ts`
- Modify: `features/audit-center/audit-center-queries.test.ts`
- Modify: `app/api/audit-logs/route.ts`
- Modify: `app/api/audit-logs/route.test.ts`

- [ ] **Step 1: Write role-scope tests for audit query**

Add tests in `features/audit-center/audit-center-queries.test.ts` for these exact cases:

```ts
it("limits finance users to finance-facing audit modules", async () => {
  const client = createAuditQueryClient();
  await listAuditCenterEntries(client, {
    userId: "user-finance",
    role: "finance",
    organizationId: "org-1",
  });

  expect(client.query.in).toHaveBeenCalledWith("module", [
    "finance",
    "settlement",
    "audit",
    "auth",
  ]);
});

it("limits operator_business users to their own logs when no project filter is provided", async () => {
  const client = createAuditQueryClient();
  await listAuditCenterEntries(client, {
    userId: "user-operator",
    role: "operator_business",
    organizationId: "org-1",
  });

  expect(client.query.eq).toHaveBeenCalledWith(
    "actor_user_id",
    "user-operator",
  );
});
```

- [ ] **Step 2: Run the audit query tests**

Run:

```powershell
pnpm test features/audit-center/audit-center-queries.test.ts
```

Expected: tests fail only if the current query service does not apply the role filters.

- [ ] **Step 3: Adjust query service to satisfy role filters**

Keep the query shape:

```ts
const financeModules = ["finance", "settlement", "audit", "auth"];

if (actor.role === "finance") {
  query = query.in("module", financeModules);
}

if (actor.role === "operator_business") {
  query = filters.projectId
    ? query.eq("project_id", filters.projectId)
    : query.eq("actor_user_id", actor.userId);
}
```

- [ ] **Step 4: Ensure API route is read-only**

In `app/api/audit-logs/route.test.ts`, keep this assertion:

```ts
import { GET, POST, PATCH, DELETE } from "./route";

it("does not expose audit mutation handlers", () => {
  expect(POST).toBeUndefined();
  expect(PATCH).toBeUndefined();
  expect(DELETE).toBeUndefined();
});
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
pnpm test features/audit-center/audit-center-queries.test.ts app/api/audit-logs/route.test.ts
```

Expected: PASS.

Commit:

```powershell
git add features/audit-center app/api/audit-logs
git commit -m "feat: add read-only audit center api"
```

---

## Task 2: Wire Audit Center UI To Real Data

**Files:**

- Modify: `app/(ops)/console/stubs/[module]/page.tsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Add initial audit data prop to the reference app**

Add a prop next to the existing live data props:

```jsx
export default function OpsReferenceApp({
  initialRoute = "warroom",
  liveTasks = [],
  liveReports = [],
  liveBatches = [],
  liveBatchDetails = {},
  liveSettlementPool = [],
  settlementScope = null,
  auditEntries = [],
}) {
```

- [ ] **Step 2: Render audit entries instead of placeholder**

Replace the audit placeholder branch with:

```jsx
{
  route === "audit" && <ScreenAuditCenter entries={auditEntries} />;
}
{
  route === "export" && <PlaceholderScreen route={route} go={go} />;
}
```

Add `ScreenAuditCenter` with these stable fields:

```jsx
function ScreenAuditCenter({ entries }) {
  return (
    <>
      <PageHeader
        title="操作日志 & 审计"
        subtitle="差异日志、高风险原因、角色范围与对象追溯"
      />
      <div style={{ padding: 32 }}>
        <Card padded={false}>
          <DataTable
            columns={["时间", "模块", "动作", "对象", "操作人", "风险", "原因"]}
            rows={entries.map((entry) => [
              fmtDate(entry.createdAt),
              entry.module,
              entry.action,
              entry.objectName || entry.objectId || entry.objectType,
              entry.actorName || "系统",
              entry.isHighRisk ? "高风险" : "普通",
              entry.reason || "-",
            ])}
          />
        </Card>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Load audit entries for M7**

In `app/(ops)/console/stubs/[module]/page.tsx`, add:

```ts
import { listAuditCenterEntries } from "@/features/audit-center/audit-center-queries";
```

Then in `loadLiveReferenceData`:

```ts
if (module === "m7") {
  const auditEntries = await listAuditCenterEntries(supabase, {
    userId: auth.userId,
    role: auth.role,
    organizationId: auth.organizationId,
  });
  return { auditEntries };
}
```

- [ ] **Step 4: Add UI smoke test for audit table**

Add in `components/reference-ui/ops-reference.test.jsx`:

```jsx
it("renders audit center entries from backend dto", () => {
  render(
    <OpsReferenceApp
      initialRoute="audit"
      auditEntries={[
        {
          id: "audit-1",
          module: "settlement",
          action: "lock",
          objectType: "settlement_batch",
          objectId: "batch-1",
          objectName: "6月应付批次",
          actorName: "财务主管",
          isHighRisk: true,
          reason: "财务核对无误",
          createdAt: "2026-06-02T10:00:00.000Z",
        },
      ]}
    />,
  );

  expect(screen.getByText("操作日志 & 审计")).toBeInTheDocument();
  expect(screen.getByText("6月应付批次")).toBeInTheDocument();
  expect(screen.getByText("高风险")).toBeInTheDocument();
});
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
pnpm test components/reference-ui/ops-reference.test.jsx
pnpm type-check
```

Expected: PASS.

Commit:

```powershell
git add "app/(ops)/console/stubs/[module]/page.tsx" components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: wire audit center ui"
```

---

## Task 3: Build Notification And Todo Center

**Files:**

- Create: `features/notifications/notification-center-queries.ts`
- Create: `features/notifications/notification-center-queries.test.ts`
- Create: `features/notifications/notification-service.ts`
- Create: `features/notifications/notification-service.test.ts`
- Create: `app/api/notifications/route.ts`
- Create: `app/api/notifications/[notificationId]/route.ts`
- Create: `app/api/notifications/route.test.ts`
- Create: `app/api/notifications/[notificationId]/route.test.ts`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/layouts/ops-shell.tsx`

- [ ] **Step 1: Write notification query tests**

Create `features/notifications/notification-center-queries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toNotificationCenterItem } from "./notification-center-queries";

describe("notification center dto", () => {
  it("maps database rows to camelCase ui items", () => {
    expect(
      toNotificationCenterItem({
        id: "notice-1",
        notification_type: "high_risk",
        status: "unread",
        title: "结算批次重开",
        content: "批次被 owner 重开",
        object_type: "settlement_batch",
        object_id: "batch-1",
        is_high_risk: true,
        created_at: "2026-06-02T10:00:00.000Z",
      }),
    ).toEqual({
      id: "notice-1",
      type: "high_risk",
      status: "unread",
      title: "结算批次重开",
      content: "批次被 owner 重开",
      objectType: "settlement_batch",
      objectId: "batch-1",
      isHighRisk: true,
      createdAt: "2026-06-02T10:00:00.000Z",
    });
  });
});
```

- [ ] **Step 2: Implement notification query DTO**

Create `features/notifications/notification-center-queries.ts`:

```ts
export type NotificationStatus = "unread" | "read" | "handled" | "ignored";

export type NotificationCenterRow = {
  id: string;
  notification_type: string;
  status: NotificationStatus;
  title: string;
  content: string;
  object_type: string | null;
  object_id: string | null;
  is_high_risk: boolean;
  created_at: string;
};

export type NotificationCenterItem = {
  id: string;
  type: string;
  status: NotificationStatus;
  title: string;
  content: string;
  objectType: string | null;
  objectId: string | null;
  isHighRisk: boolean;
  createdAt: string;
};

export function toNotificationCenterItem(
  row: NotificationCenterRow,
): NotificationCenterItem {
  return {
    id: row.id,
    type: row.notification_type,
    status: row.status,
    title: row.title,
    content: row.content,
    objectType: row.object_type,
    objectId: row.object_id,
    isHighRisk: row.is_high_risk,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 3: Add notification status service**

Create `features/notifications/notification-service.ts`:

```ts
import { writeAuditLog } from "@/lib/audit/audit";
import type { AppRole } from "@/lib/rbac/roles";

export type NotificationAction = "read" | "handled" | "ignored";

const statusByAction = {
  read: "read",
  handled: "handled",
  ignored: "ignored",
} as const;

export async function updateNotificationStatus({
  client,
  auth,
  notificationId,
  action,
}: {
  client: any;
  auth: {
    userId: string;
    organizationId: string;
    role: AppRole;
    name?: string;
  };
  notificationId: string;
  action: NotificationAction;
}) {
  const status = statusByAction[action];
  const { data, error } = await client
    .from("notifications")
    .update({ status })
    .eq("id", notificationId)
    .eq("organization_id", auth.organizationId)
    .select("id,title,status")
    .single();

  if (error) throw error;

  await writeAuditLog(client, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    actorName: auth.name,
    actorRole: auth.role,
    action: "update",
    module: "notification",
    objectType: "notification",
    objectId: notificationId,
    objectName: data.title,
    after: { status },
    changedFields: ["status"],
  });

  return data;
}
```

- [ ] **Step 4: Add API routes**

`app/api/notifications/route.ts` should authenticate, call query service, and return:

```ts
return NextResponse.json({
  items,
  unreadCount: items.filter((item) => item.status === "unread").length,
});
```

`app/api/notifications/[notificationId]/route.ts` should parse:

```ts
const { action } = await request.json();
```

and accept only:

```ts
const allowed = ["read", "handled", "ignored"];
```

- [ ] **Step 5: Wire M9 UI**

Route `m9` should render a notification center, not the audit placeholder. Add `routeByModule.m9 = "notifications"` and render `ScreenNotificationCenter`.

- [ ] **Step 6: Run tests and commit**

Run:

```powershell
pnpm test features/notifications app/api/notifications
pnpm type-check
```

Expected: PASS.

Commit:

```powershell
git add features/notifications app/api/notifications components/reference-ui/ops-reference.jsx components/layouts/ops-shell.tsx
git commit -m "feat: add notification todo center"
```

---

## Task 4: Add Deterministic Anomaly Scanner

**Files:**

- Create: `features/anomalies/anomaly-rules.ts`
- Create: `features/anomalies/anomaly-rules.test.ts`
- Create: `features/anomalies/anomaly-scanner.ts`
- Create: `features/anomalies/anomaly-scanner.test.ts`
- Create: `app/api/anomalies/scan/route.ts`
- Create: `app/api/anomalies/scan/route.test.ts`
- Modify: `docs/checklists/P3-governance.md`

- [ ] **Step 1: Write rule tests**

Create `features/anomalies/anomaly-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectTaskAnomalies } from "./anomaly-rules";

describe("detectTaskAnomalies", () => {
  it("detects scheduled tasks that have not started after scheduled start", () => {
    const anomalies = detectTaskAnomalies({
      now: "2026-06-02T13:00:00.000Z",
      task: {
        id: "task-1",
        status: "scheduled",
        scheduled_start_at: "2026-06-02T12:00:00.000Z",
        scheduled_end_at: "2026-06-02T14:00:00.000Z",
        started_at: null,
        ended_at: null,
        has_report: false,
        has_checkout_screenshot: false,
      },
    });

    expect(anomalies).toContainEqual({
      type: "not_started",
      objectType: "live_task",
      objectId: "task-1",
      severity: "warning",
    });
  });
});
```

- [ ] **Step 2: Implement pure rules**

Create `features/anomalies/anomaly-rules.ts` with these exact types:

```ts
export type AnomalyType =
  | "not_started"
  | "not_reported"
  | "report_overdue"
  | "missing_checkout_screenshot"
  | "live_over_48h";

export type DetectedAnomaly = {
  type: AnomalyType;
  objectType: "live_task" | "live_report";
  objectId: string;
  severity: "warning" | "danger";
};
```

Rules:

```ts
const fortyEightHours = 48 * 60 * 60 * 1000;

if (
  task.status === "scheduled" &&
  !task.started_at &&
  nowMs > Date.parse(task.scheduled_start_at)
) {
  anomalies.push({
    type: "not_started",
    objectType: "live_task",
    objectId: task.id,
    severity: "warning",
  });
}
```

- [ ] **Step 3: Implement scanner service**

`features/anomalies/anomaly-scanner.ts` should read active/recent live tasks, call `detectTaskAnomalies`, send notifications through `sendNotification`, and write one audit log with:

```ts
{
  action: "create",
  module: "anomaly",
  objectType: "anomaly_scan",
  changedFields: ["notifications"],
}
```

- [ ] **Step 4: Add manual scan route**

`app/api/anomalies/scan/route.ts` should allow `owner`, `ops_manager`, and `operator_business`. Other roles return 403.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
pnpm test features/anomalies app/api/anomalies
pnpm type-check
```

Expected: PASS.

Commit:

```powershell
git add features/anomalies app/api/anomalies docs/checklists/P3-governance.md
git commit -m "feat: add deterministic anomaly scanner"
```

---

## Task 5: Build Export Center With Field Whitelists

**Files:**

- Create: `features/exports/export-definitions.ts`
- Create: `features/exports/export-definitions.test.ts`
- Create: `features/exports/export-service.ts`
- Create: `features/exports/export-service.test.ts`
- Create: `app/api/exports/route.ts`
- Create: `app/api/exports/route.test.ts`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Define export fields with sensitivity**

Create `features/exports/export-definitions.ts`:

```ts
export type ExportKind =
  | "project_execution"
  | "report_details"
  | "settlement_batch"
  | "audit_logs"
  | "vendor_delivery";

export type ExportField = {
  key: string;
  label: string;
  sensitivity: "public" | "internal" | "finance_sensitive";
};

export const exportDefinitions: Record<ExportKind, ExportField[]> = {
  vendor_delivery: [
    { key: "projectName", label: "项目名称", sensitivity: "public" },
    { key: "streamerName", label: "主播", sensitivity: "public" },
    { key: "settlementDuration", label: "结算时长", sensitivity: "public" },
    { key: "evidenceLevel", label: "证据等级", sensitivity: "public" },
  ],
  project_execution: [
    { key: "projectName", label: "项目名称", sensitivity: "public" },
    { key: "status", label: "状态", sensitivity: "internal" },
  ],
  report_details: [
    { key: "streamerName", label: "主播", sensitivity: "public" },
    { key: "evidenceLevel", label: "证据等级", sensitivity: "public" },
  ],
  settlement_batch: [
    {
      key: "payableAmountCents",
      label: "应付金额",
      sensitivity: "finance_sensitive",
    },
  ],
  audit_logs: [
    { key: "module", label: "模块", sensitivity: "internal" },
    { key: "action", label: "动作", sensitivity: "internal" },
  ],
};

export function getAllowedExportFields(
  kind: ExportKind,
  role: string,
): ExportField[] {
  const fields = exportDefinitions[kind];
  if (kind === "vendor_delivery") {
    return fields.filter((field) => field.sensitivity === "public");
  }
  if (role === "streamer" || role === "operator_business") {
    return fields.filter((field) => field.sensitivity !== "finance_sensitive");
  }
  return fields;
}
```

- [ ] **Step 2: Test vendor export does not expose sensitive fields**

Create `features/exports/export-definitions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getAllowedExportFields } from "./export-definitions";

describe("export definitions", () => {
  it("keeps vendor delivery package free of cost and margin fields", () => {
    const fields = getAllowedExportFields(
      "vendor_delivery",
      "operator_business",
    );
    expect(fields.map((field) => field.key)).not.toContain("grossMarginCents");
    expect(fields.map((field) => field.key)).not.toContain("costCents");
    expect(fields.map((field) => field.key)).not.toContain(
      "vendorReceivableCents",
    );
  });
});
```

- [ ] **Step 3: Implement CSV service**

`features/exports/export-service.ts` should accept `kind`, `rows`, and `actor`, filter fields server-side, return:

```ts
{
  kind,
  filename: `${kind}-${new Date().toISOString().slice(0, 10)}.csv`,
  content,
  fieldCount: fields.length,
  rowCount: rows.length,
}
```

and write an `export` audit log.

- [ ] **Step 4: Add export route and UI**

`app/api/exports/route.ts` accepts:

```json
{ "kind": "audit_logs", "filters": { "projectId": "project-1" } }
```

and returns metadata plus CSV preview. The UI shows export kind, field list, and a submit button.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
pnpm test features/exports app/api/exports components/reference-ui/ops-reference.test.jsx
pnpm type-check
```

Expected: PASS.

Commit:

```powershell
git add features/exports app/api/exports components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: add governed export center"
```

---

## Task 6: Build Vendor Delivery Package DTO

**Files:**

- Create: `features/delivery-packages/delivery-package-dto.ts`
- Create: `features/delivery-packages/delivery-package-dto.test.ts`
- Create: `app/api/delivery-packages/route.ts`
- Create: `app/api/delivery-packages/route.test.ts`

- [ ] **Step 1: Write DTO sensitivity test**

Create `features/delivery-packages/delivery-package-dto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toVendorDeliveryPackage } from "./delivery-package-dto";

describe("vendor delivery package dto", () => {
  it("does not expose internal finance fields", () => {
    const dto = toVendorDeliveryPackage({
      project_id: "project-1",
      project_name: "王者荣耀暑期冲榜",
      streamer_name: "阿洛",
      settlement_duration_minutes: 120,
      evidence_level: "system",
      cost_cents: 10000,
      gross_margin_cents: 3000,
      internal_risk_note: "历史争议",
    });

    expect(JSON.stringify(dto)).not.toContain("cost_cents");
    expect(JSON.stringify(dto)).not.toContain("gross_margin_cents");
    expect(JSON.stringify(dto)).not.toContain("internal_risk_note");
  });
});
```

- [ ] **Step 2: Implement DTO**

Create `features/delivery-packages/delivery-package-dto.ts`:

```ts
export function toVendorDeliveryPackage(row: {
  project_id: string;
  project_name: string;
  streamer_name: string;
  settlement_duration_minutes: number;
  evidence_level: string;
  cost_cents?: number;
  gross_margin_cents?: number;
  internal_risk_note?: string;
}) {
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    streamerName: row.streamer_name,
    settlementDurationMinutes: row.settlement_duration_minutes,
    evidenceLevel: row.evidence_level,
  };
}
```

- [ ] **Step 3: Add route with project access check**

`app/api/delivery-packages/route.ts` should require `projectId` and call `can_access_project` through existing project access helpers or a service method. Return 403 when the actor cannot access the project.

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
pnpm test features/delivery-packages app/api/delivery-packages
pnpm type-check
```

Expected: PASS.

Commit:

```powershell
git add features/delivery-packages app/api/delivery-packages
git commit -m "feat: add vendor-safe delivery package"
```

---

## Task 7: Governance Golden Path Regression

**Files:**

- Create: `features/regression/governance-golden-path.test.ts`
- Modify: `docs/checklists/P3-governance.md`
- Modify: `package.json`

- [ ] **Step 1: Add governance regression test**

Create `features/regression/governance-golden-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectTaskAnomalies } from "@/features/anomalies/anomaly-rules";
import { toVendorDeliveryPackage } from "@/features/delivery-packages/delivery-package-dto";
import { getAllowedExportFields } from "@/features/exports/export-definitions";
import { toNotificationCenterItem } from "@/features/notifications/notification-center-queries";

describe("P3 governance golden path", () => {
  it("keeps notification, anomaly, export, and vendor delivery outputs server-side governed", () => {
    const notification = toNotificationCenterItem({
      id: "notice-1",
      notification_type: "high_risk",
      status: "unread",
      title: "结算批次重开",
      content: "批次被 owner 重开",
      object_type: "settlement_batch",
      object_id: "batch-1",
      is_high_risk: true,
      created_at: "2026-06-02T10:00:00.000Z",
    });

    const anomalies = detectTaskAnomalies({
      now: "2026-06-02T13:00:00.000Z",
      task: {
        id: "task-1",
        status: "scheduled",
        scheduled_start_at: "2026-06-02T12:00:00.000Z",
        scheduled_end_at: "2026-06-02T14:00:00.000Z",
        started_at: null,
        ended_at: null,
        has_report: false,
        has_checkout_screenshot: false,
      },
    });

    const exportFields = getAllowedExportFields(
      "vendor_delivery",
      "operator_business",
    );
    const deliveryPackage = toVendorDeliveryPackage({
      project_id: "project-1",
      project_name: "王者荣耀暑期冲榜",
      streamer_name: "阿洛",
      settlement_duration_minutes: 120,
      evidence_level: "system",
      cost_cents: 10000,
      gross_margin_cents: 3000,
      internal_risk_note: "历史争议",
    });

    expect(notification.isHighRisk).toBe(true);
    expect(anomalies.map((item) => item.type)).toContain("not_started");
    expect(exportFields.map((field) => field.key)).not.toContain(
      "grossMarginCents",
    );
    expect(JSON.stringify(deliveryPackage)).not.toContain("internal_risk_note");
  });
});
```

- [ ] **Step 2: Add package script**

In `package.json`, add:

```json
"test:p3-governance": "vitest run features/audit-center features/notifications features/anomalies features/exports features/delivery-packages features/regression/governance-golden-path.test.ts"
```

- [ ] **Step 3: Update P3 checklist**

In `docs/checklists/P3-governance.md`, mark completed items only after the corresponding commands pass:

```markdown
- [x] Audit center lists filterable audit logs with role-scoped visibility.
- [x] Export center uses field whitelists, sensitivity flags, async placeholders, and export audit logs.
- [x] Notification center supports unread / read / handled / ignored transitions and my todos.
- [x] Deterministic anomaly scanner covers not started, not reported, overdue report, missing screenshot, and live over 48h.
- [x] Delivery package DTOs remove price, margin, cost, and internal risk notes.
```

- [ ] **Step 4: Run full verification**

Run:

```powershell
pnpm test:p3-governance
pnpm test:golden
pnpm lint
pnpm type-check
pnpm build
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```powershell
git add package.json docs/checklists/P3-governance.md features/regression/governance-golden-path.test.ts
git commit -m "test: add P3 governance regression"
```

---

## Roadmap After This Plan

### P1 UI Closure

- Wire `/console/projects` to real M1 project list, create draft, edit fields, publish, and state transitions.
- Wire M2 streamer pool table/forms to `features/streamers/streamer-service.ts`.
- Wire M3 admission queue to `features/applications/application-queries.ts` and existing application routes.
- Run the P1 golden path through real UI: project publish → streamer apply/invite → recording review → final join.

### P4 Flywheel

- Add quote estimation service with documented divide-by-zero fallbacks.
- Add streamer matching engine using existing streamer/project data only.
- Add auto-review shadow mode before any automatic pass action.
- Add project review scoring and feed the score back into project/streamer matching inputs.

### P5 Commercialization

- Add plan/seat/usage tables with `organization_id` and RLS.
- Add server-side feature gates for export count, member count, and AI usage.
- Add usage metering append-only events.
- Add overdue read-only mode that blocks writes without deleting data.

---

## Self Review

- Spec coverage: This plan covers P3 governance gaps identified from the current repo: M7 audit, M8 export, M9 notifications/todos, anomaly scanning, and vendor delivery packages.
- Redline coverage: Every new write path includes audit; export and delivery outputs use service-side field whitelists/DTOs; no frontend-only hiding is used as a safety boundary.
- Scope discipline: P4 AI/matching/review and P5 billing/metering are listed as roadmap stages, not mixed into P3 implementation.
- Verification coverage: Each task includes focused tests, route tests, UI smoke where UI is touched, and final lint/type/build/golden checks.
