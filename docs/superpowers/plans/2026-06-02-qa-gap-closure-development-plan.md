# QA Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根据当前 QA 结果，把“只有 UI、未接真实业务”的页面接回后端服务、RBAC、审计、通知、计费门控和黄金路径回归。

**Architecture:** 保留现有参考 UI 的视觉结构，新增 DTO 适配层和缺失 Route Handlers，让页面通过服务端查询拿首屏数据，通过 API 写入业务状态。所有写操作继续走现有领域服务、RLS、统一审计与通知；商业化门控以服务端 guard 统一拦截写路由，不把前端门控当安全边界。

**Tech Stack:** Next.js App Router, React 19, TypeScript strict, Supabase Postgres/RLS, Vitest, Testing Library, existing `components/reference-ui/*`, existing `features/*` domain services.

---

## QA Baseline

当前测试与代码走查结论：

- 已接真实能力：M4 直播任务、M5 报数审核、M6 结算批次、M7 审计中心、M8 导出入口、M9 通知中心、主播 `/m/tasks` 的任务开始/停止/报数主流程。
- 仍主要是 UI 或半连接：M0 组织权限、M1 项目管理、M2 主播池、M3 选播准入与录屏提交、M10 作战台、M11 商业化套餐、主播 `/m/diagnosis`、主播 `/m/recordings`、主播桌面 `/desktop`。
- 关键断点：`/console/projects` 仍只渲染 `OpsReferenceApp initialRoute="projects"`；`ScreenProjects` 使用静态 `PROJECTS`；`ScreenStreamers` 使用静态 `STREAMERS`；`ScreenWarRoom` 使用静态推荐与评分数据；`/console/stubs/m11` 当前映射到 `warroom` 而不是商业化页面；`/m/recordings` 当前渲染 `initialRoute="me"`；录屏/截图上传还没有真正的签名上传闭环；P5 计费状态已有 API，但尚未全局拦截写路由。

## File Structure Map

- `features/ui-route-contracts/module-route-map.ts`：经营端 M0-M11 导航和路由归属的单一来源。
- `features/ui-route-contracts/module-route-map.test.ts`：验证 M0-M11 都有中文标签、目标路由和对应页面 route key。
- `features/projects/project-ui-dto.ts`：把 `ProjectListItem` / `ProjectRecord` 转成参考 UI 可消费的项目卡片 DTO。
- `app/api/projects/route.ts`、`app/api/projects/[projectId]/route.ts`、`app/api/projects/[projectId]/publish/route.ts`：项目列表、创建草稿、编辑基础信息、发布。
- `features/streamers/streamer-queries.ts`、`features/streamers/streamer-ui-dto.ts`：主播池列表 DTO。
- `app/api/streamers/route.ts`、`app/api/streamers/[streamerId]/risk/route.ts`：主播池查询、创建主播、更新风险等级。
- `features/storage/private-upload.ts`、`app/api/uploads/signed/route.ts`：私有 bucket 短期签名上传 URL，用于录屏和截图。
- `components/reference-ui/ops-reference.jsx`：只改数据注入与事件绑定，保留设计稿视觉结构。
- `components/reference-ui/streamer-mobile-reference.jsx`：只改数据注入与事件绑定，保留设计稿视觉结构。
- `components/reference-ui/streamer-desktop-reference.jsx`：只改数据注入与事件绑定，保留设计稿视觉结构。
- `app/(ops)/console/projects/page.tsx`、`app/(ops)/console/stubs/[module]/page.tsx`：经营端首屏数据装配。
- `app/(streamer-app)/m/diagnosis/page.tsx`、`app/(streamer-app)/m/recordings/page.tsx`、`app/(streamer-desktop)/desktop/page.tsx`：主播端首屏数据装配。
- `features/billing/route-guard.ts`：基于 `getBillingStatus` 和 `assertBillingGate` 的统一写路由门控。
- `features/qa-gap/qa-gap-golden-path.test.ts`：覆盖项目、主播池、选播、录屏、作战台、商业化门控的端到端服务级回归。
- `components/reference-ui/qa-gap-ui-smoke.test.jsx`：覆盖经营端和主播端已接真实 DTO 后的 UI 冒烟。
- `scripts/qa-gap-api-smoke.mjs`：对本地运行中的应用做 API 级 smoke，验证返回字段和状态码。

## Execution Rules

- 不改已有迁移文件；如实现过程中发现必须新增表或字段，只新增新的 migration，并在提交说明里解释原因。
- 每个写路由必须：鉴权、组织范围、RBAC、计费 guard、领域服务、审计。若对应领域服务不存在，先写服务测试，再补服务。
- UI 只允许接数据和事件，不重做视觉；任何布局/颜色/间距变更都要能说明来自原设计稿或现有组件。
- Task 4 完成后是 P1 履约证据链闸口：输出完成报告，等待人工冒烟后再进入 Task 5。

---

### Task 1: Route Contract And Navigation Ownership

**Files:**

- Create: `features/ui-route-contracts/module-route-map.ts`
- Create: `features/ui-route-contracts/module-route-map.test.ts`
- Modify: `components/layouts/ops-shell.tsx`
- Modify: `app/(ops)/console/stubs/[module]/page.tsx`

- [ ] **Step 1: Write route contract test**

Create `features/ui-route-contracts/module-route-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { OPS_MODULE_ROUTES, routeForOpsModule } from "./module-route-map";

describe("OPS_MODULE_ROUTES", () => {
  it("covers all M0-M11 modules with readable Chinese labels", () => {
    expect(OPS_MODULE_ROUTES.map((item) => item.module)).toEqual([
      "m0",
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
      "m8",
      "m9",
      "m10",
      "m11",
    ]);
    expect(OPS_MODULE_ROUTES.map((item) => item.label)).toContain(
      "M11 商业化与套餐",
    );
    expect(OPS_MODULE_ROUTES.every((item) => item.label.includes("�"))).toBe(
      false,
    );
  });

  it("routes M11 to billing instead of warroom", () => {
    expect(routeForOpsModule("m10")?.routeKey).toBe("warroom");
    expect(routeForOpsModule("m11")?.routeKey).toBe("billing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run features/ui-route-contracts/module-route-map.test.ts`

Expected: FAIL with `Cannot find module './module-route-map'`.

- [ ] **Step 3: Create route map**

Create `features/ui-route-contracts/module-route-map.ts`:

```ts
export type OpsModuleId =
  | "m0"
  | "m1"
  | "m2"
  | "m3"
  | "m4"
  | "m5"
  | "m6"
  | "m7"
  | "m8"
  | "m9"
  | "m10"
  | "m11";

export type OpsRouteKey =
  | "org"
  | "projects"
  | "streamers"
  | "admission"
  | "schedule"
  | "reports"
  | "settlement"
  | "audit"
  | "exports"
  | "notifications"
  | "warroom"
  | "billing";

export type OpsModuleRoute = {
  module: OpsModuleId;
  label: string;
  href: string;
  routeKey: OpsRouteKey;
  status: "live" | "partial" | "stub";
};

export const OPS_MODULE_ROUTES: OpsModuleRoute[] = [
  {
    module: "m0",
    label: "M0 组织与权限",
    href: "/console/stubs/m0",
    routeKey: "org",
    status: "stub",
  },
  {
    module: "m1",
    label: "M1 项目管理",
    href: "/console/projects",
    routeKey: "projects",
    status: "partial",
  },
  {
    module: "m2",
    label: "M2 主播池",
    href: "/console/stubs/m2",
    routeKey: "streamers",
    status: "stub",
  },
  {
    module: "m3",
    label: "M3 选播准入",
    href: "/console/stubs/m3",
    routeKey: "admission",
    status: "partial",
  },
  {
    module: "m4",
    label: "M4 排班直播",
    href: "/console/stubs/m4",
    routeKey: "schedule",
    status: "live",
  },
  {
    module: "m5",
    label: "M5 报数审核",
    href: "/console/stubs/m5",
    routeKey: "reports",
    status: "live",
  },
  {
    module: "m6",
    label: "M6 结算批次",
    href: "/console/stubs/m6",
    routeKey: "settlement",
    status: "live",
  },
  {
    module: "m7",
    label: "M7 审计中心",
    href: "/console/stubs/m7",
    routeKey: "audit",
    status: "live",
  },
  {
    module: "m8",
    label: "M8 导出交付",
    href: "/console/stubs/m8",
    routeKey: "exports",
    status: "live",
  },
  {
    module: "m9",
    label: "M9 通知待办",
    href: "/console/stubs/m9",
    routeKey: "notifications",
    status: "live",
  },
  {
    module: "m10",
    label: "M10 作战台",
    href: "/console/stubs/m10",
    routeKey: "warroom",
    status: "partial",
  },
  {
    module: "m11",
    label: "M11 商业化与套餐",
    href: "/console/stubs/m11",
    routeKey: "billing",
    status: "partial",
  },
];

export function routeForOpsModule(module: string) {
  return OPS_MODULE_ROUTES.find((item) => item.module === module);
}
```

- [ ] **Step 4: Wire navigation and stub router**

Modify `components/layouts/ops-shell.tsx` to import `OPS_MODULE_ROUTES` and render labels from it. Remove any hard-coded mojibake labels.

Modify `app/(ops)/console/stubs/[module]/page.tsx` so the route key is resolved with:

```ts
import { routeForOpsModule } from "@/features/ui-route-contracts/module-route-map";

const route = routeForOpsModule(module);
const initialRoute = route?.routeKey ?? "projects";
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm vitest run features/ui-route-contracts/module-route-map.test.ts
pnpm test:ui-smoke
```

Expected: both PASS.

Commit:

```bash
git add features/ui-route-contracts components/layouts/ops-shell.tsx "app/(ops)/console/stubs/[module]/page.tsx"
git commit -m "chore: centralize ops module routing"
```

---

### Task 2: M1 Project Management Real Data And Actions

**Files:**

- Create: `features/projects/project-ui-dto.ts`
- Create: `features/projects/project-ui-dto.test.ts`
- Create: `app/api/projects/route.ts`
- Create: `app/api/projects/[projectId]/route.ts`
- Create: `app/api/projects/[projectId]/publish/route.ts`
- Test: `app/api/projects/projects-route.test.ts`
- Modify: `app/(ops)/console/projects/page.tsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Write DTO test**

Create `features/projects/project-ui-dto.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toProjectCardDto } from "./project-ui-dto";

describe("toProjectCardDto", () => {
  it("formats project list rows for the reference UI", () => {
    expect(
      toProjectCardDto({
        id: "p1",
        code: "P2412",
        name: "鸣潮暑期招募",
        status: "recruiting",
        sensitivity: "normal",
        force_system_timing: true,
        default_hourly_rate: 4500,
        published_at: "2026-06-01T10:00:00.000Z",
        created_at: "2026-06-01T09:00:00.000Z",
      }),
    ).toEqual({
      id: "p1",
      code: "P2412",
      name: "鸣潮暑期招募",
      status: "recruiting",
      statusLabel: "招募中",
      hourlyRateLabel: "45.00 元/小时",
      timingLabel: "系统计时",
      publishedAtLabel: "2026-06-01",
    });
  });
});
```

- [ ] **Step 2: Run DTO test to verify it fails**

Run: `pnpm vitest run features/projects/project-ui-dto.test.ts`

Expected: FAIL with `Cannot find module './project-ui-dto'`.

- [ ] **Step 3: Implement DTO**

Create `features/projects/project-ui-dto.ts`:

```ts
import type { ProjectListItem } from "./project-queries";

const statusLabels: Record<string, string> = {
  draft: "草稿",
  recruiting: "招募中",
  scheduling: "排班中",
  live: "直播中",
  settlement: "结算中",
  closed: "已结项",
};

export type ProjectCardDto = {
  id: string;
  code: string;
  name: string;
  status: string;
  statusLabel: string;
  hourlyRateLabel: string;
  timingLabel: string;
  publishedAtLabel: string;
};

export function toProjectCardDto(row: ProjectListItem): ProjectCardDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    statusLabel: statusLabels[row.status] ?? row.status,
    hourlyRateLabel: `${(row.default_hourly_rate / 100).toFixed(2)} 元/小时`,
    timingLabel: row.force_system_timing ? "系统计时" : "人工校验",
    publishedAtLabel: row.published_at
      ? row.published_at.slice(0, 10)
      : "未发布",
  };
}

export function toProjectCardDtos(rows: ProjectListItem[]) {
  return rows.map(toProjectCardDto);
}
```

- [ ] **Step 4: Write API route tests**

Create `app/api/projects/projects-route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(async () => ({
    userId: "u1",
    name: "Owner",
    role: "owner",
    organizationId: "org-1",
  })),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(async () => ({
          data: [
            {
              id: "p1",
              code: "P2412",
              name: "鸣潮暑期招募",
              status: "draft",
              sensitivity: "normal",
              force_system_timing: true,
              default_hourly_rate: 4500,
              published_at: null,
              created_at: "2026-06-01T09:00:00.000Z",
            },
          ],
          error: null,
        })),
      })),
    })),
  })),
}));

describe("GET /api/projects", () => {
  it("returns project DTOs scoped by RLS-backed Supabase client", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      projects: [
        expect.objectContaining({
          id: "p1",
          code: "P2412",
          statusLabel: "草稿",
        }),
      ],
    });
  });
});
```

- [ ] **Step 5: Implement project routes**

Create `app/api/projects/route.ts`:

```ts
import { NextResponse } from "next/server";

import {
  createProjectAuditWriter,
  createProjectDraft,
} from "@/features/projects/project-service";
import { SupabaseProjectRepository } from "@/features/projects/project-repository";
import { listProjects } from "@/features/projects/project-queries";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";
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
    const projects = await listProjects(supabase);
    return NextResponse.json({ projects: toProjectCardDtos(projects) });
  } catch (error) {
    return jsonServiceError(error);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = (await request.json()) as {
      name?: string;
      code?: string;
      supplierId?: string;
    };
    if (!body.name?.trim() || !body.code?.trim()) {
      return NextResponse.json(
        { error: "name and code are required" },
        { status: 400 },
      );
    }
    const project = await createProjectDraft({
      repo: new SupabaseProjectRepository(supabase),
      audit: createProjectAuditWriter(supabase),
      actor: auth,
      input: {
        name: body.name.trim(),
        code: body.code.trim(),
        supplierId: body.supplierId,
      },
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return jsonServiceError(error);
  }
}

function jsonServiceError(error: unknown) {
  if (error instanceof Error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusForServiceError(error) },
    );
  }
  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}
```

Create `app/api/projects/[projectId]/publish/route.ts` using `publishProject` and `SupabaseProjectRepository`. It must return `{ project }`, status `200`, and reject unauthorized users with status `401`.

Create `app/api/projects/[projectId]/route.ts` using `updateProjectBasics`. It must accept `PATCH` with `name`, `startsAt`, `endsAt`, `openSignup`, `allowDirectInvite`, `forceRecording`, `forceSystemTiming`.

- [ ] **Step 6: Wire `/console/projects` server props and UI events**

Modify `app/(ops)/console/projects/page.tsx`:

```tsx
import {
  listProjects,
  unreadNotificationCount,
} from "@/features/projects/project-queries";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { OpsReferenceApp } from "@/components/reference-ui/ops-reference";

export default async function ProjectsPage() {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;
  const [projects, unreadCount] = await Promise.all([
    listProjects(supabase),
    unreadNotificationCount(supabase),
  ]);

  return (
    <OpsReferenceApp
      initialRoute="projects"
      currentUserRole={auth?.role ?? "operator_business"}
      unreadNotificationCount={unreadCount}
      projectCards={toProjectCardDtos(projects)}
    />
  );
}
```

Modify `components/reference-ui/ops-reference.jsx` so `ScreenProjects` reads `projectCards` from props and calls:

```js
await fetch("/api/projects", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name, code }),
});

await fetch(`/api/projects/${projectId}/publish`, { method: "POST" });
```

Keep existing class names and markup structure. Add disabled states to existing buttons only.

- [ ] **Step 7: Verify and commit**

Run:

```bash
pnpm vitest run features/projects/project-ui-dto.test.ts app/api/projects/projects-route.test.ts
pnpm test:ui-smoke
pnpm test:golden
```

Expected: all PASS.

Commit:

```bash
git add features/projects app/api/projects "app/(ops)/console/projects/page.tsx" components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: wire project management to backend"
```

---

### Task 3: M2 Streamer Pool Real Data And Risk Actions

**Files:**

- Create: `features/streamers/streamer-queries.ts`
- Create: `features/streamers/streamer-ui-dto.ts`
- Create: `features/streamers/streamer-ui-dto.test.ts`
- Create: `app/api/streamers/route.ts`
- Create: `app/api/streamers/[streamerId]/risk/route.ts`
- Test: `app/api/streamers/streamers-route.test.ts`
- Modify: `app/(ops)/console/stubs/[module]/page.tsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Write streamer DTO test**

Create `features/streamers/streamer-ui-dto.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toStreamerCardDto } from "./streamer-ui-dto";

describe("toStreamerCardDto", () => {
  it("does not expose settlement cost or margin fields", () => {
    const dto = toStreamerCardDto({
      id: "s1",
      display_name: "小鹿",
      cooperation_status: "active",
      risk_level: "medium",
      platform: "douyin",
      fans_count: 120000,
      created_at: "2026-06-01T00:00:00.000Z",
    });
    expect(dto).toEqual({
      id: "s1",
      displayName: "小鹿",
      platformLabel: "douyin",
      fansLabel: "12.0万",
      cooperationStatus: "active",
      riskLevel: "medium",
      createdAtLabel: "2026-06-01",
    });
    expect(Object.keys(dto)).not.toContain("grossMargin");
  });
});
```

- [ ] **Step 2: Run DTO test to verify it fails**

Run: `pnpm vitest run features/streamers/streamer-ui-dto.test.ts`

Expected: FAIL with `Cannot find module './streamer-ui-dto'`.

- [ ] **Step 3: Implement streamer queries and DTO**

Create `features/streamers/streamer-queries.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type StreamerListRow = {
  id: string;
  display_name: string;
  cooperation_status: string;
  risk_level: string;
  platform: string | null;
  fans_count: number | null;
  created_at: string;
};

export async function listStreamerPool(
  supabase: SupabaseClient | null,
): Promise<StreamerListRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("streamers")
    .select(
      "id, display_name, cooperation_status, risk_level, platform, fans_count, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
```

Create `features/streamers/streamer-ui-dto.ts`:

```ts
import type { StreamerListRow } from "./streamer-queries";

export type StreamerCardDto = {
  id: string;
  displayName: string;
  platformLabel: string;
  fansLabel: string;
  cooperationStatus: string;
  riskLevel: string;
  createdAtLabel: string;
};

export function toStreamerCardDto(row: StreamerListRow): StreamerCardDto {
  return {
    id: row.id,
    displayName: row.display_name,
    platformLabel: row.platform ?? "未填写",
    fansLabel: formatFans(row.fans_count),
    cooperationStatus: row.cooperation_status,
    riskLevel: row.risk_level,
    createdAtLabel: row.created_at.slice(0, 10),
  };
}

export function toStreamerCardDtos(rows: StreamerListRow[]) {
  return rows.map(toStreamerCardDto);
}

function formatFans(value: number | null) {
  if (!value) return "0";
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return String(value);
}
```

- [ ] **Step 4: Implement streamer API routes**

Create `app/api/streamers/route.ts` with `GET` returning `{ streamers: toStreamerCardDtos(await listStreamerPool(supabase)) }` and `POST` calling `createStreamerProfile`.

Create `app/api/streamers/[streamerId]/risk/route.ts` with `PATCH` calling `updateStreamerRisk`. Request body:

```ts
{
  "riskLevel": "medium",
  "riskReason": "录屏证据缺失频次较高",
  "blacklistReason": null,
  "reason": "运营复核后调整风险等级"
}
```

The route must return `400` if `reason` is missing.

- [ ] **Step 5: Wire M2 screen**

Modify `app/(ops)/console/stubs/[module]/page.tsx` so M2 loads `listStreamerPool` and passes `streamerCards={toStreamerCardDtos(rows)}` into `OpsReferenceApp`.

Modify `components/reference-ui/ops-reference.jsx` so `ScreenStreamers` reads the prop and calls:

```js
await fetch("/api/streamers", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ displayName }),
});

await fetch(`/api/streamers/${streamerId}/risk`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ riskLevel, riskReason, blacklistReason, reason }),
});
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm vitest run features/streamers/streamer-ui-dto.test.ts app/api/streamers/streamers-route.test.ts
pnpm test:ui-smoke
pnpm test:permissions
```

Expected: all PASS.

Commit:

```bash
git add features/streamers app/api/streamers "app/(ops)/console/stubs/[module]/page.tsx" components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: wire streamer pool to backend"
```

---

### Task 4: M3 Admission And Recording Upload Closure

**Files:**

- Create: `features/storage/private-upload.ts`
- Create: `features/storage/private-upload.test.ts`
- Create: `app/api/uploads/signed/route.ts`
- Test: `app/api/uploads/signed-route.test.ts`
- Modify: `app/(ops)/console/stubs/[module]/page.tsx`
- Modify: `app/(streamer-app)/m/recordings/page.tsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`

- [ ] **Step 1: Write private upload path test**

Create `features/storage/private-upload.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildPrivateUploadPath } from "./private-upload";

describe("buildPrivateUploadPath", () => {
  it("creates organization-scoped object paths", () => {
    expect(
      buildPrivateUploadPath({
        organizationId: "org-1",
        category: "recordings",
        ownerId: "application-1",
        fileName: "demo.mp4",
      }),
    ).toBe("org-1/recordings/application-1/demo.mp4");
  });
});
```

- [ ] **Step 2: Run storage test to verify it fails**

Run: `pnpm vitest run features/storage/private-upload.test.ts`

Expected: FAIL with `Cannot find module './private-upload'`.

- [ ] **Step 3: Implement private upload helper**

Create `features/storage/private-upload.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type UploadCategory = "recordings" | "report-screenshots";

export function buildPrivateUploadPath(input: {
  organizationId: string;
  category: UploadCategory;
  ownerId: string;
  fileName: string;
}) {
  const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${input.organizationId}/${input.category}/${input.ownerId}/${safeFileName}`;
}

export async function createSignedUploadUrl(input: {
  client: SupabaseClient;
  bucket: string;
  path: string;
}) {
  const { data, error } = await input.client.storage
    .from(input.bucket)
    .createSignedUploadUrl(input.path);
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Implement signed upload API**

Create `app/api/uploads/signed/route.ts`:

```ts
import { NextResponse } from "next/server";

import {
  buildPrivateUploadPath,
  createSignedUploadUrl,
  type UploadCategory,
} from "@/features/storage/private-upload";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

const bucket = process.env.SUPABASE_PRIVATE_BUCKET ?? "evidence-private";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = (await request.json()) as {
      category?: UploadCategory;
      ownerId?: string;
      fileName?: string;
    };
    if (!body.category || !body.ownerId || !body.fileName) {
      return NextResponse.json(
        { error: "category, ownerId and fileName are required" },
        { status: 400 },
      );
    }
    const path = buildPrivateUploadPath({
      organizationId: auth.organizationId,
      category: body.category,
      ownerId: body.ownerId,
      fileName: body.fileName,
    });
    const signed = await createSignedUploadUrl({
      client: supabase,
      bucket,
      path,
    });
    return NextResponse.json({
      bucket,
      path,
      signedUrl: signed.signedUrl,
      token: signed.token,
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

- [ ] **Step 5: Wire admission queue and streamer recordings UI**

Modify `app/(ops)/console/stubs/[module]/page.tsx` so M3 loads `listOpsApplicationQueue(supabase)` and passes `applicationQueue`.

Modify `app/(streamer-app)/m/recordings/page.tsx` to render:

```tsx
<StreamerMobileReferenceApp
  initialRoute="videos"
  applicationCards={applicationCards}
/>
```

where `applicationCards` comes from `listStreamerApplicationCards(supabase)`.

Modify `components/reference-ui/ops-reference.jsx` so M3 review buttons call existing endpoints:

```js
await fetch(`/api/applications/${applicationId}/review`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ decision, reason }),
});

await fetch(`/api/applications/${applicationId}/confirm-join`, {
  method: "POST",
});
```

Modify `components/reference-ui/streamer-mobile-reference.jsx` so recording submit calls:

```js
const signed = await fetch("/api/uploads/signed", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    category: "recordings",
    ownerId: applicationId,
    fileName: file.name,
  }),
}).then((res) => res.json());

await fetch(signed.signedUrl, { method: "PUT", body: file });

await fetch(`/api/applications/${applicationId}/videos`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    storagePath: signed.path,
    durationSeconds,
    fileHash,
  }),
});
```

- [ ] **Step 6: Verify P1 closure and commit**

Run:

```bash
pnpm vitest run features/storage/private-upload.test.ts app/api/uploads/signed-route.test.ts features/applications
pnpm test:ui-smoke
pnpm test:api-contracts
pnpm test:golden
```

Expected: all PASS.

Commit:

```bash
git add features/storage app/api/uploads "app/(ops)/console/stubs/[module]/page.tsx" "app/(streamer-app)/m/recordings/page.tsx" components/reference-ui/ops-reference.jsx components/reference-ui/streamer-mobile-reference.jsx components/reference-ui/streamer-mobile-reference.test.jsx
git commit -m "feat: close admission recording upload flow"
```

**P1 Hard Gate:** Stop after this commit. Report: “建项目→发布招募→主播报名/录屏→运营审核→二次确认加入” can run. Ask user to perform manual smoke before Task 5.

---

### Task 5: M10 War Room API Binding

**Files:**

- Create: `features/war-room/war-room-ui-dto.ts`
- Create: `features/war-room/war-room-ui-dto.test.ts`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `app/(ops)/console/stubs/[module]/page.tsx`

- [ ] **Step 1: Write war room DTO test**

Create `features/war-room/war-room-ui-dto.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toPricingResultDto } from "./war-room-ui-dto";

describe("toPricingResultDto", () => {
  it("formats integer-cent pricing values without floats in UI state", () => {
    expect(
      toPricingResultDto({
        breakEvenCents: 120000,
        suggestedQuoteCents: 168000,
        estimatedGrossMarginCents: 48000,
        estimatedGrossMarginRate: 0.2857,
      }),
    ).toEqual({
      breakEvenLabel: "1,200.00 元",
      suggestedQuoteLabel: "1,680.00 元",
      grossMarginLabel: "480.00 元",
      grossMarginRateLabel: "28.57%",
    });
  });
});
```

- [ ] **Step 2: Implement war room UI DTO**

Create `features/war-room/war-room-ui-dto.ts`:

```ts
export type PricingResult = {
  breakEvenCents: number;
  suggestedQuoteCents: number;
  estimatedGrossMarginCents: number;
  estimatedGrossMarginRate: number;
};

export function toPricingResultDto(result: PricingResult) {
  return {
    breakEvenLabel: money(result.breakEvenCents),
    suggestedQuoteLabel: money(result.suggestedQuoteCents),
    grossMarginLabel: money(result.estimatedGrossMarginCents),
    grossMarginRateLabel: `${(result.estimatedGrossMarginRate * 100).toFixed(2)}%`,
  };
}

function money(cents: number) {
  return `${(cents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} 元`;
}
```

- [ ] **Step 3: Wire ScreenWarRoom actions**

Modify `components/reference-ui/ops-reference.jsx` so the current static quote, match, and review buttons call:

```js
const pricing = await fetch("/api/war-room/pricing", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(pricingInput),
}).then((res) => res.json());

const matching = await fetch("/api/war-room/matching", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(matchInput),
}).then((res) => res.json());

const review = await fetch("/api/war-room/project-review", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(reviewInput),
}).then((res) => res.json());
```

Keep the existing visual containers and replace static arrays only after an API response returns.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm vitest run features/war-room/war-room-ui-dto.test.ts
pnpm test:p4-flywheel
pnpm test:ui-smoke
```

Expected: all PASS.

Commit:

```bash
git add features/war-room components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx "app/(ops)/console/stubs/[module]/page.tsx"
git commit -m "feat: bind war room UI to flywheel APIs"
```

---

### Task 6: M11 Billing UI And Global Write Guard

**Files:**

- Create: `features/billing/route-guard.ts`
- Create: `features/billing/route-guard.test.ts`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `app/api/projects/route.ts`
- Modify: `app/api/projects/[projectId]/route.ts`
- Modify: `app/api/projects/[projectId]/publish/route.ts`
- Modify: `app/api/applications/route.ts`
- Modify: `app/api/applications/[applicationId]/review/route.ts`
- Modify: `app/api/applications/[applicationId]/videos/route.ts`
- Modify: `app/api/live-tasks/route.ts`
- Modify: `app/api/live-reports/[reportId]/review/route.ts`
- Modify: `app/api/settlement-batches/route.ts`
- Modify: `app/api/exports/route.ts`

- [ ] **Step 1: Write billing guard test**

Create `features/billing/route-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { assertWriteAllowedFromBillingStatus } from "./route-guard";

describe("assertWriteAllowedFromBillingStatus", () => {
  it("allows writes for active subscriptions", () => {
    expect(() =>
      assertWriteAllowedFromBillingStatus({
        paymentStatus: "active",
        readOnly: false,
      }),
    ).not.toThrow();
  });

  it("blocks writes for past-due read-only organizations", () => {
    expect(() =>
      assertWriteAllowedFromBillingStatus({
        paymentStatus: "past_due",
        readOnly: true,
      }),
    ).toThrow("Organization is read-only because billing is past due");
  });
});
```

- [ ] **Step 2: Implement billing route guard**

Create `features/billing/route-guard.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import { getBillingStatus } from "./billing-status";

export type BillingWriteStatus = {
  paymentStatus: string;
  readOnly: boolean;
};

export function assertWriteAllowedFromBillingStatus(
  status: BillingWriteStatus,
) {
  if (status.readOnly || status.paymentStatus === "past_due") {
    throw new Error("Organization is read-only because billing is past due");
  }
}

export async function assertBillingWriteAllowed(input: {
  client: SupabaseClient;
  organizationId: string;
}) {
  const billing = await getBillingStatus({
    client: input.client,
    organizationId: input.organizationId,
  });
  assertWriteAllowedFromBillingStatus({
    paymentStatus: billing.paymentStatus,
    readOnly: billing.readOnly,
  });
}
```

- [ ] **Step 3: Add billing screen**

Modify `components/reference-ui/ops-reference.jsx`:

- Add `billingStatus` prop.
- Add `ScreenBilling` for route key `billing`.
- Fetch `/api/billing/status` on refresh.
- Display package, usage, payment status, read-only state.

Use existing table/card classes already present in the file. Do not introduce a new visual design.

- [ ] **Step 4: Apply write guard to representative write routes**

For every route listed under **Files**, after auth is resolved and before the domain write call, add:

```ts
await assertBillingWriteAllowed({
  client: supabase,
  organizationId: auth.organizationId,
});
```

Do not add this guard to GET routes. Do not block audit log writes; audit must continue even if billing is past due.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm vitest run features/billing/route-guard.test.ts
pnpm test:p5-commercialization
pnpm test:api-contracts
pnpm test:ui-smoke
```

Expected: all PASS.

Commit:

```bash
git add features/billing components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx app/api
git commit -m "feat: enforce billing read-only guard on writes"
```

---

### Task 7: Streamer Mobile Diagnosis And Evidence Upload Closure

**Files:**

- Modify: `app/(streamer-app)/m/diagnosis/page.tsx`
- Modify: `app/(streamer-app)/m/tasks/page.tsx`
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
- Test: `app/api/ai/diagnosis/route.test.ts`

- [ ] **Step 1: Extend mobile UI smoke test**

Modify `components/reference-ui/streamer-mobile-reference.test.jsx` to assert:

```jsx
it("shows diagnosis result after calling the AI diagnosis API", async () => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      result: {
        level: "warning",
        summary: "存在断流风险",
        suggestions: ["检查 OBS 推流码", "确认系统计时已开启"],
      },
    }),
  }));

  render(<StreamerMobileReferenceApp initialRoute="ai" />);
  fireEvent.click(screen.getByRole("button", { name: /开始诊断/ }));
  expect(await screen.findByText("存在断流风险")).toBeInTheDocument();
});
```

- [ ] **Step 2: Wire diagnosis page and component action**

Modify `app/(streamer-app)/m/diagnosis/page.tsx` so it passes `initialRoute="ai"` and any current streamer context already available.

Modify `components/reference-ui/streamer-mobile-reference.jsx` so the diagnosis button calls:

```js
await fetch("/api/ai/diagnosis", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    source: "streamer_mobile",
    checks: ["network", "recording", "timing"],
  }),
});
```

- [ ] **Step 3: Replace demo screenshot path in task report flow**

In `components/reference-ui/streamer-mobile-reference.jsx`, replace the hard-coded report screenshot path with the Task 4 signed upload flow using `category: "report-screenshots"`, then submit the returned `path` to the existing report API.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm test:ui-smoke
pnpm test:p4-flywheel
pnpm test:api-contracts
```

Expected: all PASS.

Commit:

```bash
git add "app/(streamer-app)/m/diagnosis/page.tsx" "app/(streamer-app)/m/tasks/page.tsx" components/reference-ui/streamer-mobile-reference.jsx components/reference-ui/streamer-mobile-reference.test.jsx
git commit -m "feat: wire streamer mobile diagnosis and evidence uploads"
```

---

### Task 8: Streamer Desktop Data Binding

**Files:**

- Create: `features/streamer-desktop/desktop-dashboard-dto.ts`
- Create: `features/streamer-desktop/desktop-dashboard-dto.test.ts`
- Modify: `app/(streamer-desktop)/desktop/page.tsx`
- Modify: `components/reference-ui/streamer-desktop-reference.jsx`
- Test: `components/reference-ui/streamer-desktop-reference.test.jsx`

- [ ] **Step 1: Write desktop DTO test**

Create `features/streamer-desktop/desktop-dashboard-dto.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toDesktopDashboardDto } from "./desktop-dashboard-dto";

describe("toDesktopDashboardDto", () => {
  it("combines task and application counts for desktop shell", () => {
    expect(
      toDesktopDashboardDto({
        tasks: [{ id: "t1", status: "scheduled" }],
        applications: [{ id: "a1", status: "pending_review" }],
      }),
    ).toEqual({
      scheduledTaskCount: 1,
      pendingApplicationCount: 1,
    });
  });
});
```

- [ ] **Step 2: Implement desktop DTO**

Create `features/streamer-desktop/desktop-dashboard-dto.ts`:

```ts
export function toDesktopDashboardDto(input: {
  tasks: Array<{ id: string; status: string }>;
  applications: Array<{ id: string; status: string }>;
}) {
  return {
    scheduledTaskCount: input.tasks.filter(
      (task) => task.status === "scheduled",
    ).length,
    pendingApplicationCount: input.applications.filter(
      (application) => application.status === "pending_review",
    ).length,
  };
}
```

- [ ] **Step 3: Wire desktop page props**

Modify `app/(streamer-desktop)/desktop/page.tsx` to load the same task/application DTOs used by mobile pages and pass them to `StreamerDesktopReferenceApp`.

Modify `components/reference-ui/streamer-desktop-reference.jsx` so it renders the passed counts and task rows. Keep desktop layout and classes unchanged.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm vitest run features/streamer-desktop/desktop-dashboard-dto.test.ts components/reference-ui/streamer-desktop-reference.test.jsx
pnpm test:ui-smoke
```

Expected: all PASS.

Commit:

```bash
git add features/streamer-desktop "app/(streamer-desktop)/desktop/page.tsx" components/reference-ui/streamer-desktop-reference.jsx components/reference-ui/streamer-desktop-reference.test.jsx
git commit -m "feat: bind streamer desktop shell to live data"
```

---

### Task 9: QA Gap Golden Path Regression

**Files:**

- Create: `features/qa-gap/qa-gap-golden-path.test.ts`
- Create: `scripts/qa-gap-api-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write service-level golden path test**

Create `features/qa-gap/qa-gap-golden-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("QA gap closure golden path", () => {
  it("documents the connected path from project draft to billing-gated write", () => {
    const path = [
      "project:create-draft",
      "project:publish",
      "streamer:create-profile",
      "application:submit",
      "recording:signed-upload",
      "application:review",
      "application:confirm-join",
      "war-room:pricing",
      "billing:write-guard",
    ];
    expect(path).toEqual(
      expect.arrayContaining([
        "recording:signed-upload",
        "billing:write-guard",
      ]),
    );
  });
});
```

This test starts as a contract sentinel. After Tasks 2-8 pass, replace the sentinel array with calls into the same domain services used by the API routes. The final assertion must verify audit logs are written for project publish, risk update, recording review, and billing-blocked write attempts.

- [ ] **Step 2: Create API smoke script**

Create `scripts/qa-gap-api-smoke.mjs`:

```js
const baseUrl = process.env.QA_BASE_URL ?? "http://localhost:3000";

const endpoints = [
  ["/api/projects", "projects"],
  ["/api/streamers", "streamers"],
  ["/api/billing/status", "billing"],
];

for (const [path, key] of endpoints) {
  const response = await fetch(`${baseUrl}${path}`);
  if (![200, 401, 403].includes(response.status)) {
    throw new Error(`${path} returned unexpected status ${response.status}`);
  }
  console.log(`${key}: ${response.status}`);
}
```

- [ ] **Step 3: Add test script**

Modify `package.json` scripts:

```json
"test:qa-gap": "vitest run features/qa-gap/qa-gap-golden-path.test.ts components/reference-ui/qa-gap-ui-smoke.test.jsx"
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm test:qa-gap
pnpm test:api-integration-smoke
pnpm lint
pnpm type-check
```

Expected: all PASS.

Commit:

```bash
git add features/qa-gap scripts/qa-gap-api-smoke.mjs package.json
git commit -m "test: add qa gap closure regression"
```

---

### Task 10: Final QA Report And Browser Acceptance

**Files:**

- Create: `docs/reports/2026-06-02-qa-gap-closure-report.md`
- Modify: `docs/checklists/qa-gap-closure-checklist.md`

- [ ] **Step 1: Create acceptance checklist**

Create `docs/checklists/qa-gap-closure-checklist.md`:

```md
# QA Gap Closure Checklist

- [ ] `/console/projects` shows database-backed project rows.
- [ ] Project draft creation writes audit log.
- [ ] Project publish enforces owner/ops_manager role and writes audit log.
- [ ] `/console/stubs/m2` shows database-backed streamer rows.
- [ ] Streamer risk update requires reason and writes high-risk audit log.
- [ ] `/console/stubs/m3` shows application queue and recording review state.
- [ ] `/m/recordings` opens recording workflow instead of profile route.
- [ ] Recording upload uses signed private upload URL.
- [ ] `/console/stubs/m10` calls pricing, matching, and project review APIs.
- [ ] `/console/stubs/m11` shows billing status instead of war room.
- [ ] Past-due read-only billing blocks representative write routes.
- [ ] `/m/diagnosis` calls AI diagnosis API and renders returned result.
- [ ] `/desktop` receives live task/application counts.
```

- [ ] **Step 2: Run full regression**

Run:

```bash
pnpm test
pnpm test:api-contracts
pnpm test:dto-contracts
pnpm test:golden
pnpm test:p3-governance
pnpm test:p4-flywheel
pnpm test:p5-commercialization
pnpm test:ui-smoke
pnpm test:qa-gap
pnpm lint
pnpm type-check
pnpm build
```

Expected: all PASS.

- [ ] **Step 3: Browser acceptance**

With the dev server running, open these routes in the in-app browser at the same viewport used by the reference UI QA:

```text
http://localhost:3000/console/projects
http://localhost:3000/console/stubs/m2
http://localhost:3000/console/stubs/m3
http://localhost:3000/console/stubs/m10
http://localhost:3000/console/stubs/m11
http://localhost:3000/m/tasks
http://localhost:3000/m/recordings
http://localhost:3000/m/diagnosis
http://localhost:3000/desktop
```

For each route, confirm:

- The page has no obvious visual drift from the supplied HTML design files.
- Buttons that imply writes call real APIs and show success/error state.
- Data rows come from server props or API responses, not static arrays.
- Browser console has no runtime error.

- [ ] **Step 4: Write final QA gap closure report**

Create `docs/reports/2026-06-02-qa-gap-closure-report.md` with:

```md
# QA Gap Closure Report

## Completed

- M1 project management is connected to project APIs.
- M2 streamer pool is connected to streamer APIs.
- M3 admission and recording upload use application APIs and signed private uploads.
- M10 war room calls pricing, matching, and project review APIs.
- M11 billing page shows billing status and write routes enforce read-only guard.
- Streamer mobile recordings and diagnosis are connected to APIs.
- Streamer desktop receives live task/application data.

## Verification

- `pnpm test`: PASS
- `pnpm test:api-contracts`: PASS
- `pnpm test:dto-contracts`: PASS
- `pnpm test:golden`: PASS
- `pnpm test:p3-governance`: PASS
- `pnpm test:p4-flywheel`: PASS
- `pnpm test:p5-commercialization`: PASS
- `pnpm test:ui-smoke`: PASS
- `pnpm test:qa-gap`: PASS
- `pnpm lint`: PASS
- `pnpm type-check`: PASS
- `pnpm build`: PASS

## Remaining Product Scope Outside This Closure

- Real OCR provider connection.
- Real AI provider connection.
- Real payment provider connection.
- External notification channels.
```

- [ ] **Step 5: Commit final report**

Commit:

```bash
git add docs/checklists/qa-gap-closure-checklist.md docs/reports/2026-06-02-qa-gap-closure-report.md
git commit -m "docs: report qa gap closure verification"
```

---

## Definition Of Done

- M1/M2/M3/M10/M11 no longer rely on static reference arrays for primary business data.
- `/m/recordings`, `/m/diagnosis`, and `/desktop` are connected to relevant backend APIs or server DTOs.
- Every new write route passes auth, RBAC where applicable, billing guard, organization scope, domain service, and audit.
- Field-level desensitization remains server-side; streamer-facing DTOs do not expose manufacturer receivables, gross margin, or cost.
- Past-due read-only billing blocks representative writes without blocking reads or audit logging.
- P1 hard gate is honored after Task 4.
- Full regression commands in Task 10 pass before reporting completion.

## Self-Review Checklist

- Spec coverage: each QA gap maps to one task above.
- Placeholder scan command:

```bash
$patterns = @("TB"+"D", "TO"+"DO", "implement "+"later", "fill "+"in details", "appropriate "+"error handling", "similar "+"to", "Write tests "+"for the above")
$patterns | ForEach-Object { rg -n $_ docs/superpowers/plans/2026-06-02-qa-gap-closure-development-plan.md }
```

Expected: no matches.

- Type consistency: route keys are `projects`, `streamers`, `admission`, `warroom`, `billing`; module ids are `m0` through `m11`; money values remain integer cents in services and formatted only in DTO/UI.
