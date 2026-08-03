# Organization Brand Studio and Recording Share UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 在不削弱业务状态、权限、隐私与录屏可用性的前提下，让组织品牌成为内部工作台与对外录屏分享的第一识别层，并保证新分享使用不可伪造、可追溯、创建后稳定的品牌与联系名片快照。

**Architecture:** 以 `organizations.branding` 继续承载当前已发布品牌投影，新增草稿、发布版本和组织联系名片表；所有品牌写入由 owner-only 服务与原子 RPC 控制。内部旧版 `ops-reference` 与 Ops V2 读取同一规范化品牌契约。分享创建 RPC 在数据库内读取已发布品牌和同组织有效名片并生成快照，公开 DTO 只返回白名单字段；私有 LOGO 通过受控路由读取。播放器采用浅色媒体工作区、品牌封面和真实比例视频画布。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5、Supabase/PostgreSQL RLS/RPC、Vitest、Testing Library、Playwright、Arco Design、CSS custom properties、Sharp 0.35。

---

## 实施状态与边界

本文是执行计划，不代表功能已实现、已合并或已部署。实施时只修改本文列出的文件；保留当前工作树中 `.superpowers/` 等无关未跟踪内容，不得顺手清理或纳入提交。

## 阶段与发布门槛

| 阶段                    | 可独立交付结果                            | 进入下一阶段的门槛                               | 回滚点                                   |
| ----------------------- | ----------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| 0. 契约与兼容存储       | 品牌规范化、配色、数据库加法迁移          | 单元测试、迁移契约、旧字段回退通过               | 代码回退；新增表/列保留不读              |
| 1. 品牌治理后端         | owner 草稿/发布、名片、LOGO、安全审计 API | 权限、并发、跨组织、文件验证测试通过             | 隐藏入口；旧已发布投影继续可读           |
| 2. 品牌中心与内部工作台 | 独立品牌中心；旧版与 V2 同源品牌壳        | 两套壳、只读/编辑、状态色隔离通过                | 保留 API，移除入口并恢复中性色变量       |
| 3. 分享原子快照         | 创建分享时由数据库生成品牌/名片快照       | 伪造、跨组织、旧分享稳定性测试通过               | UI 不传名片；快照列继续兼容              |
| 4. 公开分享与媒体工作区 | 品牌抬头、联系卡、浅色播放器及失败态      | DTO 泄漏、桌面/窄屏/移动、真实媒体浏览器验收通过 | 公开渲染回退到当前中性界面               |
| 5. 合并与部署验证       | 精确范围提交、CI、本地构建、部署后证据    | 所有必跑检查和生产版本一致性通过                 | 回滚应用版本；数据库加法结构不破坏旧代码 |

## 文件结构映射

### 新建

- `features/organizations/organization-brand.ts`：品牌/名片公共类型、规范化、配色与公开白名单。
- `features/organizations/organization-brand.test.ts`：字段、颜色、对比度、回退测试。
- `features/organizations/organization-brand-repository.ts`：Supabase 读写与 RPC 适配器。
- `features/organizations/organization-brand-service.ts`：权限、草稿、发布、名片、紧急移除编排。
- `features/organizations/organization-brand-service.test.ts`：治理与隔离测试。
- `lib/storage/organization-brand-logo.ts`：LOGO 文件解析、Sharp 验证/规范化与路径生成。
- `lib/storage/organization-brand-logo.test.ts`：MIME、扩展名、尺寸、体积、路径测试。
- `supabase/migrations/20260801090000_organization_brand_studio.sql`：草稿、版本、名片、RLS、发布/紧急移除 RPC。
- `supabase/migrations/20260801100000_admission_share_brand_snapshot_rpc.sql`：分享快照列、回填和原子创建 RPC。
- `lib/db/organization-brand-schema-contract.test.ts`：迁移结构与权限契约。
- `app/api/organization/brand/route.ts`：读取与保存草稿。
- `app/api/organization/brand/publish/route.ts`：发布草稿。
- `app/api/organization/brand/logo/route.ts`：owner-only multipart LOGO 上传。
- `app/api/organization/contact-cards/route.ts`：名片读取/创建。
- `app/api/organization/contact-cards/[cardId]/route.ts`：名片更新/停用。
- `app/api/organization/contact-cards/[cardId]/emergency-remove/route.ts`：从有效分享紧急移除。
- `app/api/organization/brand/route.test.ts`、`app/api/organization/brand/publish/route.test.ts`、`app/api/organization/brand/logo/route.test.ts`：品牌 API 契约测试。
- `app/api/organization/contact-cards/route.test.ts`、`app/api/organization/contact-cards/[cardId]/route.test.ts`、`app/api/organization/contact-cards/[cardId]/emergency-remove/route.test.ts`：名片治理 API 测试。
- `app/(ops)/console/brand/page.tsx`：品牌中心服务端入口。
- `components/organization-brand/brand-center.tsx`：品牌编辑、发布、名片与双预览。
- `components/organization-brand/brand-center.module.css`：品牌中心响应式布局。
- `components/organization-brand/brand-center.test.tsx`：权限、草稿、预览与冲突测试。
- `components/organization-brand/organization-brand-mark.tsx`：图片 LOGO/字标确定性回退。
- `components/organization-brand/organization-brand-theme.tsx`：内部品牌 CSS 变量边界。
- `app/api/public/admission-share/[token]/brand-logo/route.ts`：经分享鉴权的私有 LOGO 读取。
- `tests/visual/organization-brand-share.spec.ts`：真实浏览器品牌与播放器验收。
- `styles/public-share.css`：公开分享响应式样式。
- `features/ui-route-contracts/admission-share-brand-ui-flag.ts`：公开品牌与新版媒体工作区的可回滚开关。
- `features/ui-route-contracts/admission-share-brand-ui-flag.test.ts`：开关默认值和显式启停测试。

### 修改

- `package.json`、`pnpm-lock.yaml`：将已经被锁定的 Sharp 0.35.0 提升为直接生产依赖。
- `lib/auth/context.ts`、`app/(ops)/console/console-auth.ts`：扩展规范化已发布品牌。
- `app/api/organization/settings/route.ts`：品牌中心上线后禁止旧设置接口直接发布品牌字段。
- `components/reference-ui/ops-reference.jsx`、`components/reference-ui/ops-reference.test.jsx`：旧版壳、组织入口和旧抽屉迁移。
- `components/ops-shell/ops-shell.tsx`、`components/ops-shell/ops-sidebar.tsx`、`components/ops-shell/ops-console-v2-home.tsx`：Ops V2 同源品牌壳与组织品牌入口。
- `styles/ops/tokens.css`、`styles/ops/foundations.css`：品牌变量与状态色隔离。
- `features/applications/admission-share-board.ts`、`features/applications/admission-share-board.test.ts`：创建输入、持久化记录、内外 DTO 白名单。
- `app/api/projects/[projectId]/admission-share-boards/route.ts`、`app/api/projects/[projectId]/admission-share-boards/route.test.ts`：只接收 `contactCardId`，不接收快照内容。
- `components/reference-ui/admission-share-center.jsx`、`components/reference-ui/admission-share-center.test.jsx`：有效名片选择和同源预览。
- `app/share/admission/[token]/admission-share-types.ts`：公开品牌/名片 DTO 类型。
- `app/share/admission/[token]/admission-share-page-client.tsx`、`app/share/admission/[token]/admission-share-page-client.test.tsx`：组织官方分享抬头和联系卡。
- `app/share/admission/[token]/admission-share-review-workspace.tsx`、`app/share/admission/[token]/admission-share-review-workspace.test.tsx`：浅色媒体工作区、封面、比例与失败态。
- `app/share/admission/[token]/page.tsx`：导入公开分享样式并把服务端开关状态传给客户端。
- `.env.example`：记录 `ADMISSION_SHARE_BRAND_UI=false` 的默认关闭策略。

## 阶段 0：共享契约与向后兼容存储

### Task 1：锁定品牌规范化与可访问配色契约

**Files:**

- Create: `features/organizations/organization-brand.ts`
- Create: `features/organizations/organization-brand.test.ts`
- Modify: `lib/auth/context.ts`
- Modify: `app/(ops)/console/console-auth.ts`

- [ ] **Step 1: 先写字段规范化、非法颜色和对比度失败测试**

```ts
import { describe, expect, it } from "vitest";
import {
  normalizePublishedBrand,
  relativeContrast,
} from "./organization-brand";

describe("normalizePublishedBrand", () => {
  it("falls back safely and never turns semantic colors into brand colors", () => {
    const brand = normalizePublishedBrand(
      {
        logoText: " 星耀 ",
        brandName: " 星耀传媒 ",
        brandTagline: " 专业让价值被看见 ",
        primaryColor: "#fff000",
      },
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        organizationName: "星耀组织",
      },
    );

    expect(brand.logoText).toBe("星耀");
    expect(brand.brandName).toBe("星耀传媒");
    expect(brand.primaryColor).toBe("#FFF000");
    expect(
      relativeContrast(brand.actionColor, "#FFFFFF"),
    ).toBeGreaterThanOrEqual(4.5);
    expect(brand.semantic).toEqual({
      success: "#00B42A",
      warning: "#FF7D00",
      danger: "#F53F3F",
      info: "#165DFF",
    });
  });

  it("drops unsafe paths and malformed colors", () => {
    const brand = normalizePublishedBrand(
      {
        logoStoragePath:
          "22222222-2222-4222-8222-222222222222/brand-logos/33333333-3333-4333-8333-333333333333.webp",
        primaryColor: "red",
      },
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        organizationName: "北辰机构",
      },
    );

    expect(brand.logoStoragePath).toBeNull();
    expect(brand.primaryColor).toBe("#165DFF");
    expect(brand.brandName).toBe("北辰机构");
  });
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `pnpm vitest run features/organizations/organization-brand.test.ts`

Expected: FAIL，提示模块或导出不存在。

- [ ] **Step 3: 实现版本化契约、确定性回退和 AA 操作色校正**

```ts
export const DEFAULT_BRAND_PRIMARY = "#165DFF";
export const BRAND_SCHEMA_VERSION = 1 as const;

export type PublishedOrganizationBrand = {
  schemaVersion: 1;
  version: number;
  logoText: string;
  logoStoragePath: string | null;
  brandName: string;
  brandTagline: string;
  primaryColor: string;
  actionColor: string;
  softColor: string;
  publishedAt: string | null;
  semantic: {
    success: "#00B42A";
    warning: "#FF7D00";
    danger: "#F53F3F";
    info: "#165DFF";
  };
};

const HEX = /^#[0-9A-F]{6}$/;
const safeText = (value: unknown, fallback: string, max: number) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;

const normalizeHex = (value: unknown) => {
  const candidate = typeof value === "string" ? value.trim().toUpperCase() : "";
  return HEX.test(candidate) ? candidate : DEFAULT_BRAND_PRIMARY;
};

const rgb = (hex: string) =>
  [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
const channel = (value: number) => {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

export function relativeContrast(left: string, right: string): number {
  const luminance = (hex: string) => {
    const [red, green, blue] = rgb(hex).map(channel);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const high = Math.max(luminance(left), luminance(right));
  const low = Math.min(luminance(left), luminance(right));
  return (high + 0.05) / (low + 0.05);
}

const mixWithBlack = (hex: string, ratio: number) => {
  const values = rgb(hex).map((value) => Math.round(value * (1 - ratio)));
  return `#${values.map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};

const actionColor = (seed: string) => {
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mixWithBlack(seed, step * 0.04);
    if (relativeContrast(candidate, "#FFFFFF") >= 4.5) return candidate;
  }
  return "#123A8C";
};

const softColor = (seed: string) => {
  const [red, green, blue] = rgb(seed).map((value) =>
    Math.round(value * 0.12 + 255 * 0.88),
  );
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};

export function normalizePublishedBrand(
  value: Record<string, unknown> | null | undefined,
  identity: { organizationId: string; organizationName: string },
): PublishedOrganizationBrand {
  const primaryColor = normalizeHex(value?.primaryColor);
  const path =
    typeof value?.logoStoragePath === "string"
      ? value.logoStoragePath.trim()
      : "";
  const ownedLogoPath =
    path.startsWith(`${identity.organizationId}/brand-logos/`) &&
    /^[0-9a-f-]{36}\/brand-logos\/[0-9a-f-]{36}\.webp$/i.test(path);
  return {
    schemaVersion: BRAND_SCHEMA_VERSION,
    version:
      typeof value?.version === "number" &&
      Number.isInteger(value.version) &&
      value.version >= 0
        ? value.version
        : 0,
    logoText: safeText(
      value?.logoText,
      identity.organizationName.slice(0, 2),
      8,
    ),
    logoStoragePath: ownedLogoPath ? path : null,
    brandName: safeText(value?.brandName, identity.organizationName, 40),
    brandTagline: safeText(value?.brandTagline, "", 80),
    primaryColor,
    actionColor: actionColor(primaryColor),
    softColor: softColor(primaryColor),
    publishedAt:
      typeof value?.publishedAt === "string" ? value.publishedAt : null,
    semantic: {
      success: "#00B42A",
      warning: "#FF7D00",
      danger: "#F53F3F",
      info: "#165DFF",
    },
  };
}
```

- [ ] **Step 4: 扩展认证读取但保持旧 `logoText/brandName/brandTagline` 数据可用**

在 `getAuthContext` 读取组织 ID/名称后调用 `normalizePublishedBrand(rawBranding, { organizationId, organizationName })`；`organizationSettingsFromAuth` 返回 `{ name, brand: normalizedBrand }`，并暂时保留旧扁平字段供 `ops-reference` 过渡。

- [ ] **Step 5: 运行聚焦测试**

Run: `pnpm vitest run features/organizations/organization-brand.test.ts 'app/(ops)/console/page.test.tsx'`

Expected: PASS。

- [ ] **Step 6: 提交契约**

```powershell
git add -- 'features/organizations/organization-brand.ts' 'features/organizations/organization-brand.test.ts' 'lib/auth/context.ts' 'app/(ops)/console/console-auth.ts' 'app/(ops)/console/page.test.tsx'
git diff --cached --check
git commit -m "feat: define organization brand contract"
```

### Task 2：增加加法数据库结构、RLS 和发布事务

**Files:**

- Create: `supabase/migrations/20260801090000_organization_brand_studio.sql`
- Create: `lib/db/organization-brand-schema-contract.test.ts`

- [ ] **Step 1: 写迁移契约测试，先锁定 owner-only、版本冲突与高风险审计**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260801090000_organization_brand_studio.sql",
  ),
  "utf8",
).toLowerCase();

describe("organization brand studio schema", () => {
  it("keeps drafts, versions and cards inside the organization boundary", () => {
    expect(sql).toContain("create table public.organization_brand_drafts");
    expect(sql).toContain("create table public.organization_brand_versions");
    expect(sql).toContain("create table public.organization_contact_cards");
    expect(sql).toContain(
      "public.current_user_role(organization_id) = 'owner'",
    );
  });

  it("publishes with optimistic concurrency and audits emergency removal", () => {
    expect(sql).toContain("brand_version_conflict");
    expect(sql).toContain("publish_organization_brand");
    expect(sql).toContain("emergency_remove_contact_card_from_shares");
    expect(sql).toContain("is_high_risk");
  });
});
```

- [ ] **Step 2: 运行测试并确认因迁移不存在而失败**

Run: `pnpm vitest run lib/db/organization-brand-schema-contract.test.ts`

Expected: FAIL with `ENOENT`。

- [ ] **Step 3: 创建表、索引和向后兼容初始化**

迁移必须包含以下实际结构；`content` 只保存规范化品牌数据，当前线上投影仍写回 `organizations.branding`：

```sql
alter table public.organizations
  add column if not exists branding_version integer not null default 0;

create table public.organization_brand_drafts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  base_version integer not null check (base_version >= 0),
  content jsonb not null,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_brand_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  content jsonb not null,
  published_by uuid not null references public.profiles(id),
  published_at timestamptz not null default now(),
  unique (organization_id, version)
);

create table public.organization_contact_cards (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  title text not null default '' check (char_length(title) <= 40),
  phone text,
  email text,
  wechat text,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    nullif(btrim(coalesce(phone, '')), '') is not null
    or nullif(btrim(coalesce(email, '')), '') is not null
    or nullif(btrim(coalesce(wechat, '')), '') is not null
  )
);

create index organization_brand_versions_org_published_idx
  on public.organization_brand_versions (organization_id, published_at desc);
create index organization_contact_cards_org_status_idx
  on public.organization_contact_cards (organization_id, status, updated_at desc);
```

- [ ] **Step 4: 添加 RLS 与原子发布/紧急移除 RPC**

要求：读取已发布版本允许组织成员；草稿和名片写入只允许 owner；RPC 内再次验证 `auth.uid()` 与 owner 角色。发布 RPC 必须对白名单字段、长度、十六进制颜色和属于当前组织的 LOGO path 再做数据库侧校验，以 `p_expected_version` 对比 `organizations.branding_version`，冲突抛出 `brand_version_conflict`，成功后依次插入版本、更新线上投影、删除草稿并写 `audit_logs(action='publish')`。紧急移除 RPC 只清空 `status='active'` 且未过期、未撤销分享中的 `contact_card_id/contact_card_snapshot`，并写带 reason 的高风险审计。

- [ ] **Step 5: 运行迁移契约测试和本地数据库检查**

Run: `pnpm vitest run lib/db/organization-brand-schema-contract.test.ts`

Expected: PASS。

Run: `supabase db lint --local`

Expected: schema lint reports no errors。完整重建只允许在已确认无用户数据的临时 Supabase 栈或 CI 数据库中运行 `pnpm supabase:migrate`；本地 Supabase 不可用时记录原始错误并将该门槛标为未完成，不得声称迁移已验证。

- [ ] **Step 6: 提交存储结构**

```powershell
git add -- 'supabase/migrations/20260801090000_organization_brand_studio.sql' 'lib/db/organization-brand-schema-contract.test.ts'
git diff --cached --check
git commit -m "feat: add organization brand governance schema"
```

## 阶段 1：品牌治理后端

### Task 3：实现 owner-only 品牌服务与 API

**Files:**

- Create: `features/organizations/organization-brand-repository.ts`
- Create: `features/organizations/organization-brand-service.ts`
- Create: `features/organizations/organization-brand-service.test.ts`
- Create: `app/api/organization/brand/route.ts`
- Create: `app/api/organization/brand/publish/route.ts`
- Create: `app/api/organization/contact-cards/route.ts`
- Create: `app/api/organization/contact-cards/[cardId]/route.ts`
- Create: `app/api/organization/contact-cards/[cardId]/emergency-remove/route.ts`
- Create: `app/api/organization/brand/route.test.ts`
- Create: `app/api/organization/brand/publish/route.test.ts`
- Create: `app/api/organization/contact-cards/route.test.ts`
- Create: `app/api/organization/contact-cards/[cardId]/route.test.ts`
- Create: `app/api/organization/contact-cards/[cardId]/emergency-remove/route.test.ts`

- [ ] **Step 1: 写权限、并发和跨组织失败测试**

至少覆盖：非 owner 保存/发布/建卡返回 403；`expectedVersion` 不一致返回 409；已停用或其他组织名片不可选；普通停用不改已有分享；紧急移除必须 owner + 非空原因并只改有效分享。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm vitest run features/organizations/organization-brand-service.test.ts app/api/organization/brand/route.test.ts app/api/organization/brand/publish/route.test.ts app/api/organization/contact-cards`

Expected: FAIL，模块或 handler 不存在。

- [ ] **Step 3: 实现严格输入契约与权限编排**

```ts
import { z } from "zod";
import { canManageOrganizationSettings } from "@/lib/rbac/permissions";
import type { AppRole } from "@/lib/rbac/roles";

export const brandDraftSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  logoText: z.string().trim().min(1).max(8),
  logoStoragePath: z.string().trim().nullable(),
  brandName: z.string().trim().min(1).max(40),
  brandTagline: z.string().trim().max(80),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export const contactCardSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40),
    title: z.string().trim().max(40).default(""),
    phone: z.string().trim().max(30).nullable(),
    email: z.string().trim().email().max(120).nullable(),
    wechat: z.string().trim().max(60).nullable(),
  })
  .refine((value) => value.phone || value.email || value.wechat, {
    message: "至少填写一种公开联系方式",
  });

export function assertBrandOwner(role: AppRole): void {
  if (!canManageOrganizationSettings(role)) {
    throw Object.assign(
      new Error("Only organization owners can manage branding"),
      { status: 403 },
    );
  }
}
```

Repository 的 `publishDraft` 和 `emergencyRemoveContactCard` 必须调用数据库 RPC，不得用多条客户端更新模拟事务。API 从服务端认证上下文取得 `organizationId/userId/role`，不得接受请求体中的组织 ID 或操作者 ID。

- [ ] **Step 4: 统一错误映射**

将 `brand_version_conflict` 映射为 HTTP 409；跨组织/已停用名片映射 400 或 404；无权限映射 403；数据库不可用映射 503。返回体只包含安全错误码、用户可理解文案和最新版本号，不返回 SQL 文本。

- [ ] **Step 5: 运行聚焦测试**

Run: `pnpm vitest run features/organizations/organization-brand-service.test.ts app/api/organization/brand app/api/organization/contact-cards`

Expected: PASS。

- [ ] **Step 6: 提交品牌治理 API**

```powershell
git add -- 'features/organizations/organization-brand-repository.ts' 'features/organizations/organization-brand-service.ts' 'features/organizations/organization-brand-service.test.ts' 'app/api/organization/brand' 'app/api/organization/contact-cards'
git diff --cached --check
git commit -m "feat: add organization brand governance api"
```

### Task 4：实现私有 LOGO 上传、验证和受控读取基础

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `lib/storage/organization-brand-logo.ts`
- Create: `lib/storage/organization-brand-logo.test.ts`
- Create: `app/api/organization/brand/logo/route.ts`
- Create: `app/api/organization/brand/logo/route.test.ts`

- [ ] **Step 1: 将 Sharp 固定为直接生产依赖**

Run: `pnpm add sharp@0.35.0 --save-exact`

Expected: `package.json` 出现 `"sharp": "0.35.0"`，锁文件只发生预期 importer 变化。

- [ ] **Step 2: 写伪装 SVG、超限、跨组织路径和正常 WebP 测试**

测试输入必须包含：扩展名为 PNG 但内容是 SVG；超过 2 MB；扩展名与 MIME 不匹配；非 JPEG/PNG/WebP；高分辨率合法图片被安全缩放为 512×512 内 WebP；超大像素解码炸弹被拒绝；输出路径严格为 `${organizationId}/brand-logos/${uuid}.webp`。

- [ ] **Step 3: 实现服务端内容检测和规范化**

```ts
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const MAX_BYTES = 2 * 1024 * 1024;

export async function normalizeBrandLogo(file: File, organizationId: string) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (
    !ALLOWED.has(file.type) ||
    !ALLOWED_EXTENSIONS.has(extension) ||
    MIME_BY_EXTENSION[extension] !== file.type ||
    file.size <= 0 ||
    file.size > MAX_BYTES
  ) {
    throw new Error("BRAND_LOGO_INVALID_FILE");
  }
  const input = Buffer.from(await file.arrayBuffer());
  const image = sharp(input, { failOn: "error", limitInputPixels: 16_777_216 });
  const metadata = await image.metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    !metadata.format ||
    MIME_BY_FORMAT[metadata.format] !== file.type
  ) {
    throw new Error("BRAND_LOGO_INVALID_CONTENT");
  }
  const body = await image
    .rotate()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  return {
    body,
    contentType: "image/webp" as const,
    path: `${organizationId}/brand-logos/${randomUUID()}.webp`,
  };
}
```

- [ ] **Step 4: 实现 owner-only multipart route**

Route 必须从认证上下文取得组织 ID；调用规范化后才上传到 `getPrivateStorageBucket()`；仅返回受控 storage path 给当前草稿绑定。上传失败不改变草稿；禁止 SVG、任意客户端路径和公开 bucket。

- [ ] **Step 5: 运行聚焦测试与依赖契约**

Run: `pnpm vitest run lib/storage/organization-brand-logo.test.ts app/api/organization/brand/logo/route.test.ts lib/dependency-security-contract.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交 LOGO 安全链路**

```powershell
git add -- 'package.json' 'pnpm-lock.yaml' 'lib/storage/organization-brand-logo.ts' 'lib/storage/organization-brand-logo.test.ts' 'app/api/organization/brand/logo'
git diff --cached --check
git commit -m "feat: add private organization logo upload"
```

## 阶段 2：品牌中心与内部工作台

### Task 5：建立独立品牌中心，支持草稿、发布、名片与双预览

**Files:**

- Create: `app/(ops)/console/brand/page.tsx`
- Create: `components/organization-brand/brand-center.tsx`
- Create: `components/organization-brand/brand-center.module.css`
- Create: `components/organization-brand/brand-center.test.tsx`
- Create: `components/organization-brand/organization-brand-mark.tsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `app/api/organization/settings/route.ts`
- Modify: `app/api/organization/settings/route.test.ts`

- [ ] **Step 1: 写 owner 编辑、成员只读、发布确认和 409 冲突测试**

断言页面标题为“品牌中心”；owner 可见上传/保存/发布/名片管理；非 owner 只见当前已发布版本；未发布草稿不改变工作台预览；发布确认明确说明“只影响新页面刷新和新分享，已有分享保留原快照”；冲突时显示线上新版本并要求重新确认。

- [ ] **Step 2: 实现服务端入口与精简客户端状态机**

```tsx
import { requireConsoleStaffAuth } from "../console-auth";
import { OrganizationBrandCenter } from "@/components/organization-brand/brand-center";
import { getOrganizationBrandStudio } from "@/features/organizations/organization-brand-service";

export default async function OrganizationBrandPage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  const studio = await getOrganizationBrandStudio({
    client: supabase,
    organizationId: auth.organizationId,
    userId: auth.userId,
    role: auth.role,
  });
  return (
    <OrganizationBrandCenter
      initialStudio={studio}
      canEdit={auth.role === "owner"}
    />
  );
}
```

客户端状态只保存 `published`、`draft`、`cards`、`selectedPreview`、`saveState`、`publishState`；草稿保存和发布分别调用 API。不得把上传完成当作发布完成。

- [ ] **Step 3: 实现图片回退与预览边界**

`OrganizationBrandMark` 在图片加载失败时隐藏图片并显示 `logoText`；内部预览和公开分享预览复用同一个规范化 brand 对象，但公开预览不得呈现内部版本、路径或操作者字段。

- [ ] **Step 4: 把旧组织设置抽屉的品牌字段改为只读摘要 + 品牌中心入口**

旧抽屉不再直接提交 `logoText/brandName/brandTagline`。`app/api/organization/settings/route.ts` 对这些遗留品牌字段返回 `409 BRAND_STUDIO_REQUIRED`，只保留组织名称等非品牌设置能力，防止绕过草稿/发布。

- [ ] **Step 5: 运行 UI 与 API 测试**

Run: `pnpm vitest run components/organization-brand/brand-center.test.tsx components/reference-ui/ops-reference.test.jsx app/api/organization/settings/route.test.ts`

Expected: PASS；现有组织名称更新测试继续通过。

- [ ] **Step 6: 提交品牌中心**

```powershell
git add -- 'app/(ops)/console/brand' 'components/organization-brand' 'components/reference-ui/ops-reference.jsx' 'components/reference-ui/ops-reference.test.jsx' 'app/api/organization/settings/route.ts' 'app/api/organization/settings/route.test.ts'
git diff --cached --check
git commit -m "feat: add organization brand center"
```

### Task 6：让旧版与 Ops V2 使用同一品牌壳，同时固定状态色

**Files:**

- Create: `components/organization-brand/organization-brand-theme.tsx`
- Modify: `components/ops-shell/ops-shell.tsx`
- Modify: `components/ops-shell/ops-sidebar.tsx`
- Modify: `components/ops-shell/ops-console-v2-home.tsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `styles/ops/tokens.css`
- Modify: `styles/ops/foundations.css`
- Create: `components/ops-shell/ops-shell.test.tsx`
- Create: `components/ops-shell/ops-sidebar.test.tsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: 写两套壳的同源品牌与状态色隔离测试**

给定同一 brand，断言旧版和 V2 都展示图片 LOGO/品牌名/口号，图片失败均回退字标；当前导航、主按钮、焦点使用 `--org-brand-action`；成功、预警、危险 token 仍等于原语义色；“经营舱”只作为低优先级服务署名。

- [ ] **Step 2: 实现 CSS 变量边界**

```tsx
import type { CSSProperties, ReactNode } from "react";
import type { PublishedOrganizationBrand } from "@/features/organizations/organization-brand";

export function OrganizationBrandTheme({
  brand,
  children,
}: {
  brand: PublishedOrganizationBrand;
  children: ReactNode;
}) {
  const style = {
    "--org-brand-primary": brand.primaryColor,
    "--org-brand-action": brand.actionColor,
    "--org-brand-soft": brand.softColor,
  } as CSSProperties;
  return (
    <div className="organization-brand-theme" style={style}>
      {children}
    </div>
  );
}
```

```css
.organization-brand-theme {
  --ops-primary: var(--org-brand-action, #165dff);
  --ops-primary-soft: var(--org-brand-soft, #e8f0ff);
}

/* These remain semantic and must never reference --org-brand-* variables. */
:root {
  --ops-success: #00b42a;
  --ops-warning: #ff7d00;
  --ops-danger: #f53f3f;
}
```

- [ ] **Step 3: 改造 Ops V2 props，移除硬编码品牌**

`OpsShell` 接收 `brand: PublishedOrganizationBrand`；`OpsSidebar` 接收 `brand` 并渲染 `OrganizationBrandMark`。删除硬编码 `brandName="经营舱"` 和固定 `/brand/ops-mascot-logo.png` 第一视觉。在品牌身份块和“组织设置”上下文中提供 `/console/brand` 次级入口，不在主业务导航中新增与“组织设置”并列的顶级模块。

- [ ] **Step 4: 改造旧版根容器**

用同一 `OrganizationBrandTheme` 包住 `OpsReferenceApp` 根部，侧栏第一位使用规范化品牌；保留组织名称与角色作为上下文。“品牌中心”入口必须在组织模块内可达。

`components/brand/brand-logo.tsx` 等平台登录/定价品牌组件不在本次改造范围内，禁止把租户品牌全局替换到平台身份页面。

- [ ] **Step 5: 运行两套界面测试**

Run: `pnpm vitest run components/ops-shell components/reference-ui/ops-reference.test.jsx 'app/(ops)/console/page.test.tsx'`

Expected: PASS；分别在 `NEXT_PUBLIC_OPS_UI_V2=false/true` 的测试上下文中验证。

- [ ] **Step 6: 提交内部品牌壳**

```powershell
git add -- 'components/organization-brand/organization-brand-theme.tsx' 'components/ops-shell' 'components/reference-ui/ops-reference.jsx' 'components/reference-ui/ops-reference.test.jsx' 'styles/ops/tokens.css' 'styles/ops/foundations.css' 'app/(ops)/console/page.test.tsx'
git diff --cached --check
git commit -m "feat: apply organization branding to console shells"
```

## 阶段 3：录屏分享原子快照与内部管理

### Task 7：由数据库创建分享快照，拒绝前端伪造

**Files:**

- Create: `supabase/migrations/20260801100000_admission_share_brand_snapshot_rpc.sql`
- Modify: `lib/db/organization-brand-schema-contract.test.ts`
- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Modify: `app/api/projects/[projectId]/admission-share-boards/route.ts`
- Modify: `app/api/projects/[projectId]/admission-share-boards/route.test.ts`

- [ ] **Step 1: 写快照稳定性、同组织名片和伪造输入测试**

覆盖：POST 仅接受 `contactCardId`；传 `brandSnapshot/contactCardSnapshot` 被 schema 丢弃或拒绝；其他组织、disabled 名片失败；无名片生成 null；修改组织品牌后旧分享 DTO 不变，新分享使用新版本。

- [ ] **Step 2: 添加列并一次性回填现有分享**

```sql
alter table public.project_recording_share_boards
  add column if not exists brand_snapshot jsonb,
  add column if not exists brand_version integer,
  add column if not exists contact_card_id uuid references public.organization_contact_cards(id) on delete set null,
  add column if not exists contact_card_snapshot jsonb;

update public.project_recording_share_boards as board
set brand_snapshot = jsonb_build_object(
      'schemaVersion', 1,
      'version', organization.branding_version,
      'logoText', coalesce(nullif(btrim(organization.branding->>'logoText'), ''), left(organization.name, 2)),
      'logoStoragePath', nullif(btrim(organization.branding->>'logoStoragePath'), ''),
      'brandName', coalesce(nullif(btrim(organization.branding->>'brandName'), ''), organization.name),
      'brandTagline', coalesce(organization.branding->>'brandTagline', ''),
      'primaryColor', coalesce(organization.branding->>'primaryColor', '#165DFF'),
      'publishedAt', organization.branding->>'publishedAt'
    ),
    brand_version = organization.branding_version
from public.organizations as organization
where organization.id = board.organization_id
  and board.brand_snapshot is null;

alter table public.project_recording_share_boards
  alter column brand_snapshot set not null,
  alter column brand_version set not null;
```

- [ ] **Step 3: 重建创建 RPC，只增加 `p_contact_card_id`，快照在数据库内生成**

RPC 中锁定组织行并读取 `branding/branding_version`；若传名片 ID，则执行下面的组织/状态检查并只构造公开字段：

```sql
if p_contact_card_id is not null then
  select card.id,
         jsonb_strip_nulls(jsonb_build_object(
           'displayName', card.display_name,
           'title', nullif(card.title, ''),
           'phone', card.phone,
           'email', card.email,
           'wechat', card.wechat
         ))
  into v_contact_card_id, v_contact_card_snapshot
  from public.organization_contact_cards as card
  where card.id = p_contact_card_id
    and card.organization_id = p_organization_id
    and card.status = 'active'
  for share;

  if not found then
    raise exception 'invalid_organization_contact_card';
  end if;
end if;
```

插入 board 时写入 RPC 自己生成的 `v_brand_snapshot/v_brand_version/v_contact_card_id/v_contact_card_snapshot`。绝不新增 `p_brand_snapshot` 或 `p_contact_card_snapshot` 参数。

- [ ] **Step 4: 更新 TypeScript persistence contract，并建立内外同源展示投影**

创建输入增加 `contactCardId?: string | null`；repository RPC 只传 `p_contact_card_id`。新增 `AdmissionSharePresentation`，其组织品牌、项目 ID/名称/代码、分享标题/用途、模式/轮次/截止时间、录屏版本/顺序/主播展示名、分享状态和最新提交回执只在 `toAdmissionSharePresentation(snapshot)` 映射一次。内部管理 DTO 与 `toPublicShareDto` 都复用该投影，然后各自附加内部诊断或外部评审字段，禁止两套 UI 分别拼装这些共享字段。内部 board record 可读取快照，但任何日志、错误和 token-safe 返回不得包含 storage path 之外的私有字段。

```ts
export type AdmissionSharePresentation = Pick<
  PublicAdmissionShareBoard,
  | "title"
  | "purpose"
  | "mode"
  | "status"
  | "reviewState"
  | "roundNumber"
  | "expiresAt"
  | "project"
> & {
  brand: Omit<PublicAdmissionShareBoard["brand"], "logoUrl">;
  contactCard: PublicAdmissionShareBoard["contactCard"];
  items: Array<
    Pick<
      PublicAdmissionShareBoard["items"][number],
      | "applicationId"
      | "recordingSubmissionId"
      | "recordingVersion"
      | "sourceHealth"
      | "streamer"
      | "finalReview"
    >
  >;
};

export function toAdmissionSharePresentation(
  snapshot: PublicAdmissionShareBoardSnapshot,
): AdmissionSharePresentation {
  return {
    title: snapshot.title,
    purpose: snapshot.purpose,
    mode: snapshot.mode,
    status: snapshot.status,
    reviewState: snapshot.reviewState,
    roundNumber: snapshot.roundNumber,
    expiresAt: snapshot.expiresAt,
    project: snapshot.project,
    brand: toSharedBrand(snapshot),
    contactCard: pickPublicContactCard(snapshot.contactCardSnapshot),
    items: snapshot.items.map(toSharedRecordingItem),
  };
}
```

公开 DTO 在该投影上追加 token 受控的 `logoUrl/playbackUrl/externalUrl`；内部 DTO 追加源健康诊断、撤销、审计等私有字段。共享字段必须逐字段深相等测试。

- [ ] **Step 5: 运行迁移、服务和 API 测试**

Run: `pnpm vitest run lib/db/organization-brand-schema-contract.test.ts features/applications/admission-share-board.test.ts 'app/api/projects/[projectId]/admission-share-boards/route.test.ts'`

Expected: PASS。

- [ ] **Step 6: 提交原子快照**

```powershell
git add -- 'supabase/migrations/20260801100000_admission_share_brand_snapshot_rpc.sql' 'lib/db/organization-brand-schema-contract.test.ts' 'features/applications/admission-share-board.ts' 'features/applications/admission-share-board.test.ts' 'app/api/projects/[projectId]/admission-share-boards/route.ts' 'app/api/projects/[projectId]/admission-share-boards/route.test.ts'
git diff --cached --check
git commit -m "feat: snapshot organization brand on recording shares"
```

### Task 8：在内部分享创建与管理视图选择已发布名片并同源预览

**Files:**

- Modify: `components/reference-ui/admission-share-center.jsx`
- Modify: `components/reference-ui/admission-share-center.test.jsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: 写选择/不展示/停用和同源字段测试**

默认选择“不展示联系方式”，仅列出当前组织 active 名片；提交 payload 只含 `contactCardId`；预览展示组织、项目、标题、用途、模式、轮次、截止时间、录屏顺序和所选名片；停用名片在新建列表消失但旧分享预览仍显示快照。

- [ ] **Step 2: 扩展 wizard draft 与提交 payload**

```js
const initialDraft = {
  title: "",
  purpose: "",
  mode: "formal_review",
  expiresAt: "",
  accessCode: "",
  contactCardId: null,
  items: [],
};

const payload = {
  title: draft.title,
  purpose: draft.purpose,
  mode: draft.mode,
  expiresAt: draft.expiresAt,
  accessCode: draft.accessCode || undefined,
  contactCardId: draft.contactCardId,
  items: draft.items,
};
```

- [ ] **Step 3: 让内部预览消费 API 返回的安全快照**

创建成功后以服务端返回的 brand/contact snapshot 渲染预览，不用浏览器本地品牌状态冒充已保存结果；既有分享列表也从持久化快照渲染。

- [ ] **Step 4: 运行分享中心测试**

Run: `pnpm vitest run components/reference-ui/admission-share-center.test.jsx components/reference-ui/ops-reference.test.jsx`

Expected: PASS。

- [ ] **Step 5: 提交内部分享体验**

```powershell
git add -- 'components/reference-ui/admission-share-center.jsx' 'components/reference-ui/admission-share-center.test.jsx' 'components/reference-ui/ops-reference.jsx' 'components/reference-ui/ops-reference.test.jsx'
git diff --cached --check
git commit -m "feat: add branded recording share preview"
```

## 阶段 4：公开分享品牌层与浅色媒体工作区

### Task 9：公开 DTO、品牌抬头、联系卡和受控 LOGO 路由

**Files:**

- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Modify: `app/api/public/admission-share/[token]/route.test.ts`
- Create: `app/api/public/admission-share/[token]/brand-logo/route.ts`
- Create: `app/api/public/admission-share/[token]/brand-logo/route.test.ts`
- Modify: `app/share/admission/[token]/admission-share-types.ts`
- Modify: `app/share/admission/[token]/admission-share-page-client.tsx`
- Modify: `app/share/admission/[token]/admission-share-page-client.test.tsx`
- Create: `features/ui-route-contracts/admission-share-brand-ui-flag.ts`
- Create: `features/ui-route-contracts/admission-share-brand-ui-flag.test.ts`
- Modify: `app/share/admission/[token]/page.tsx`
- Modify: `.env.example`

- [ ] **Step 1: 先建立默认关闭、可显式启用的公开 UI 开关**

```ts
type AdmissionShareBrandUiEnv = Record<string, string | undefined>;
const ENABLED_VALUES = new Set(["true", "1", "yes", "on"]);

export function isAdmissionShareBrandUiEnabled(
  env: AdmissionShareBrandUiEnv = process.env,
): boolean {
  const value = env.ADMISSION_SHARE_BRAND_UI?.trim().toLowerCase();
  return value ? ENABLED_VALUES.has(value) : false;
}
```

测试默认未配置和 `false/0/off` 返回 false，`true/1/on` 返回 true。`.env.example` 增加 `ADMISSION_SHARE_BRAND_UI=false`。`page.tsx` 把结果作为 `brandUiEnabled` 传给客户端；false 必须走现有公开页与现有播放器路径，true 才启用 Task 9/10 新渲染。开关不改变 DTO、快照或数据库数据。

- [ ] **Step 2: 写 DTO 白名单和品牌资源鉴权测试**

断言公开 DTO 有 `brand.version/logoText/logoUrl/brandName/brandTagline/primaryColor` 和可选 `contactCard`；没有 `logoStoragePath`、actor、内部备注、token hash、访问码 hash。LOGO 路由复用分享 token、过期、撤销和访问码会话校验；无 LOGO 返回 404；不得因 LOGO 失败阻断主 DTO。

- [ ] **Step 3: 实现安全公开映射**

```ts
const publicBrand = {
  version: board.brandVersion,
  logoText: normalized.logoText,
  logoUrl: normalized.logoStoragePath
    ? `/api/public/admission-share/${encodeURIComponent(token)}/brand-logo`
    : null,
  brandName: normalized.brandName,
  brandTagline: normalized.brandTagline,
  primaryColor: normalized.primaryColor,
};

const publicContactCard = board.contactCardSnapshot
  ? pickPublicContactCard(board.contactCardSnapshot)
  : null;
```

`pickPublicContactCard` 只允许 `displayName/title/phone/email/wechat`，未知字段全部忽略。

- [ ] **Step 4: 仿照现有 recording route 实现 LOGO route**

先调用公开分享访问校验，再从 board snapshot 取得 path，调用 `createSignedDownloadUrl`，使用 `normalizeAbsoluteHttpUrl` 校验后 302；不在响应正文、Location 参数或日志中暴露原始 storage path。

- [ ] **Step 5: 实现组织官方分享抬头与可选联系卡**

页面第一视觉为组织 LOGO/字标、品牌名、口号与“组织官方分享”；项目名/代码和分享标题紧随其后。不得使用“平台认证”“官方认证”等未经事实支持的文案。`contactCard === null` 时整块不渲染。

- [ ] **Step 6: 运行 DTO、API、开关和页面测试**

Run: `pnpm vitest run features/applications/admission-share-board.test.ts 'app/api/public/admission-share/[token]' features/ui-route-contracts/admission-share-brand-ui-flag.test.ts 'app/share/admission/[token]/admission-share-page-client.test.tsx'`

Expected: PASS。

- [ ] **Step 7: 提交公开品牌层**

```powershell
git add -- '.env.example' 'features/applications/admission-share-board.ts' 'features/applications/admission-share-board.test.ts' 'app/api/public/admission-share/[token]' 'features/ui-route-contracts/admission-share-brand-ui-flag.ts' 'features/ui-route-contracts/admission-share-brand-ui-flag.test.ts' 'app/share/admission/[token]/page.tsx' 'app/share/admission/[token]/admission-share-types.ts' 'app/share/admission/[token]/admission-share-page-client.tsx' 'app/share/admission/[token]/admission-share-page-client.test.tsx'
git diff --cached --check
git commit -m "feat: brand public recording shares"
```

### Task 10：把大黑块改为浅色媒体工作区和品牌封面

**Files:**

- Modify: `app/share/admission/[token]/admission-share-review-workspace.tsx`
- Modify: `app/share/admission/[token]/admission-share-review-workspace.test.tsx`
- Create: `styles/public-share.css`
- Modify: `app/share/admission/[token]/page.tsx`
- Modify: `app/share/admission/[token]/admission-share-page-client.tsx`

- [ ] **Step 1: 写 idle/loading/playing/error 和比例测试**

断言：开关关闭时保持当前渲染；开关开启后 idle/loading 显示品牌封面且整栏不是黑底；播放后才挂载或显示真实 `<video>`；横屏 16:9；竖屏按固有比例居中，留白用中性品牌底色；original 失败保留草稿并提供重试/报告/允许时外部来源；无来源仍保留录屏、主播、项目上下文。

- [ ] **Step 2: 抽出明确媒体状态并实现品牌封面**

```tsx
type MediaStageState = "idle" | "loading" | "playing" | "error" | "unavailable";

function BrandedRecordingPoster({
  brandName,
  streamerName,
  projectName,
  roundLabel,
  onPlay,
}: {
  brandName: string;
  streamerName: string;
  projectName: string;
  roundLabel: string;
  onPlay: () => void;
}) {
  return (
    <section
      className="recording-poster"
      aria-label={`${streamerName} 录屏待播放`}
    >
      <p className="recording-poster__eyebrow">{brandName} · 组织官方分享</p>
      <h2>{streamerName}</h2>
      <p>
        {projectName} · {roundLabel}
      </p>
      <button type="button" className="recording-poster__play" onClick={onPlay}>
        播放录屏
      </button>
    </section>
  );
}
```

- [ ] **Step 3: 实现浅色舞台、真实比例和减少动态效果**

```css
.recording-media-stage {
  display: grid;
  place-items: center;
  min-width: 0;
  background: linear-gradient(
    145deg,
    var(--share-brand-soft, #eef3ff),
    #f7f8fa 62%
  );
  border: 1px solid #e5e6eb;
  border-radius: 18px;
  overflow: hidden;
}

.recording-media-canvas {
  width: min(100%, 1120px);
  max-height: min(72vh, 760px);
  aspect-ratio: var(--recording-aspect-ratio, 16 / 9);
  background: color-mix(in srgb, var(--share-brand-soft, #eef3ff) 55%, #f2f3f5);
}

.recording-media-canvas[data-orientation="portrait"] {
  width: min(100%, 430px);
}

.recording-media-canvas video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: transparent;
}

@media (prefers-reduced-motion: reduce) {
  .recording-poster,
  .recording-media-canvas {
    transition: none;
  }
}
```

视频容器周围不可使用整栏纯黑；原生控制条自身的高对比深色不受此限制。

在 `<video onLoadedMetadata>` 中读取 `videoWidth/videoHeight`，把约分后的比例写入 `--recording-aspect-ratio`，并以 `videoHeight > videoWidth` 设置 `data-orientation="portrait"`；元数据缺失时回退 16:9。加载元数据只改变画布比例，不改变当前录屏或复核表单 key。

- [ ] **Step 4: 保持复核草稿与错误状态解耦**

媒体加载失败只能更新媒体状态，不得重建 review form key、清空本地草稿或切换当前录屏。错误动作使用现有安全外部 URL 规范化和 `rel="noopener noreferrer"`。

- [ ] **Step 5: 运行工作区测试**

Run: `pnpm vitest run 'app/share/admission/[token]/admission-share-review-workspace.test.tsx' 'app/share/admission/[token]/admission-share-page-client.test.tsx'`

Expected: PASS。

- [ ] **Step 6: 提交媒体工作区**

```powershell
git add -- 'app/share/admission/[token]/admission-share-review-workspace.tsx' 'app/share/admission/[token]/admission-share-review-workspace.test.tsx' 'app/share/admission/[token]/admission-share-page-client.tsx' 'app/share/admission/[token]/admission-share-page-client.test.tsx' 'styles/public-share.css'
git diff --cached --check
git commit -m "feat: add branded recording media workspace"
```

## 阶段 5：浏览器验收、合并与部署

### Task 11：执行真实浏览器矩阵和无障碍验收

**Files:**

- Create: `tests/visual/organization-brand-share.spec.ts`
- Modify: `package.json`（增加聚焦脚本时）

- [ ] **Step 1: 编写 Playwright 关键路径**

覆盖 owner 保存草稿→发布→内部两套壳刷新；成员只读；创建带/不带名片分享；公开页抬头；已有分享在品牌再发布后不变化；LOGO 失败字标回退；访问码/过期/撤销仍生效。

- [ ] **Step 2: 建立媒体浏览器矩阵**

使用可控测试夹具逐项验证：私有 original 横屏、私有 original 竖屏、外部嵌入、外部链接、加载失败、无来源、允许外部 fallback。每项截图并断言无整栏黑块、无 storage path、复核草稿不丢失。

- [ ] **Step 3: 验证三个视口和键盘路径**

视口至少为 1440×900、1024×768、390×844；完成 Tab/Shift+Tab、Enter/Space 播放、焦点可见、对话框焦点归还、ARIA live 保存/发布/播放错误播报，并在 reduced-motion 上下文复测。

- [ ] **Step 4: 运行聚焦浏览器测试**

Run: `pnpm playwright test tests/visual/organization-brand-share.spec.ts --project=chromium`

Expected: PASS；保留 Playwright HTML 报告与失败截图路径作为证据。

- [ ] **Step 5: 提交浏览器验收**

```powershell
git add -- 'tests/visual/organization-brand-share.spec.ts' 'package.json' 'pnpm-lock.yaml'
git diff --cached --check
git commit -m "test: cover organization brand share journeys"
```

### Task 12：全量验证、范围审计、合并与部署

**Files:**

- Modify only if required by verified failures in the feature scope.

- [ ] **Step 1: 运行聚焦回归**

```powershell
pnpm vitest run features/organizations lib/db/organization-brand-schema-contract.test.ts app/api/organization/brand app/api/organization/contact-cards app/api/organization/settings/route.test.ts features/applications/admission-share-board.test.ts 'app/api/projects/[projectId]/admission-share-boards/route.test.ts' 'app/api/public/admission-share/[token]' components/organization-brand components/ops-shell components/reference-ui/admission-share-center.test.jsx components/reference-ui/ops-reference.test.jsx 'app/share/admission/[token]'
```

Expected: PASS。

- [ ] **Step 2: 运行静态和构建验证**

```powershell
pnpm type-check
pnpm lint
pnpm build
pnpm check:changed-format
git diff --check
```

Expected: 全部 PASS。若出现仓库既有基线失败，必须用未修改基线或精确文件证据证明并单独报告，不得把它写成通过。

- [ ] **Step 3: 审计安全与 DTO 泄漏**

```powershell
rg -n 'logoStoragePath|logo_storage_path|token_hash|access_code_hash|before_json|after_json' app/share app/api/public features/applications/admission-share-board.ts
rg -n -- '--org-brand-(success|warning|danger)|var\(--org-brand.*(success|warning|danger)' styles components app
```

Expected: 公开类型/JSON/HTML 中没有私有路径或哈希；语义状态色不依赖品牌变量。允许 server-only LOGO route 内部读取 path，但不得序列化输出。

- [ ] **Step 4: 审计提交范围**

```powershell
git status --short
git diff --stat origin/codex/full-project-ui...HEAD
git diff --name-only origin/codex/full-project-ui...HEAD
git log --oneline origin/codex/full-project-ui..HEAD
```

Expected: 仅规格、计划和本功能文件；`.superpowers/` 仍未跟踪且未暂存；无用户无关改动。

- [ ] **Step 5: 合并前复核**

执行 `superpowers:requesting-code-review`；修复 P0/P1/P2 范围内问题并重跑受影响测试。只有审查、测试和构建真实通过后才能合并。

- [ ] **Step 6: 合并与部署**

按仓库实际远程默认分支创建 PR；确认 CI 完成而非仅排队后合并。部署沿用项目现有 Tencent/PM2 流程，先保持 `ADMISSION_SHARE_BRAND_UI=false` 完成数据库和内部品牌冒烟，再把该变量设为 `true` 并 reload 应用；使用已存在的 `tencent-nextjs-deploy-verify` 程序验证服务器 HEAD、Node 20 路径、PM2 `exec cwd`、实际进程环境、健康检查和公开分享页面资源。

- [ ] **Step 7: 部署后冒烟与回滚判定**

部署后以 owner、普通成员、无会话外部访客三种身份验证：品牌中心权限、工作台品牌、带/不带名片分享、旧分享快照、original/外部/失败媒体。若品牌资源或新版媒体 UI 回归但业务仍可用，立即设置 `ADMISSION_SHARE_BRAND_UI=false` 并 reload，确认恢复当前公开页；若权限、DTO 泄漏或分享创建异常，立即回滚应用版本并保留加法数据库结构，随后撤销受影响分享 token。

## 完成定义

- [ ] 规格第 3–17 节均可映射到至少一个自动化测试或浏览器验收项。
- [ ] owner 之外无法保存、发布、管理名片或紧急移除。
- [ ] 分享 API 不接受客户端品牌/名片快照，数据库原子生成快照。
- [ ] 修改品牌不改变既有分享；紧急移除是唯一受审计例外。
- [ ] 旧版和 Ops V2 展示同源组织品牌，状态色保持语义固定。
- [ ] 公开 DTO、HTML、网络响应不泄露私有存储路径或内部字段。
- [ ] 待播放/加载/竖屏/失败状态没有整栏大黑块，复核草稿不因媒体错误丢失。
- [ ] 桌面、窄屏、移动端以及键盘、焦点、ARIA、reduced-motion 均通过。
- [ ] 已完成真实的本地验证、审查、合并、部署和部署后验证；未完成项明确标注，不能以计划或排队状态代替结果。
