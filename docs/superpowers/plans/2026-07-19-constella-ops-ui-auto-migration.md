# Constella Ops UI Auto Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dry-run-first migration control plane that inventories the Constella UI kit, the current App Router console, and `ops-reference.jsx`, then generates route-by-route migration manifests, skeletons, and release gates.

**Architecture:** Keep production UI changes manual and route-scoped; automation only discovers, plans, validates, and generates reviewable files. The source of truth is a typed route migration registry, backed by Node scripts that write JSON/Markdown reports under `.superpowers/ops-ui-migration/`. No script edits `app/**`, `components/reference-ui/**`, API contracts, RBAC, Supabase migrations, or money/evidence behavior without an explicit `--write` flag and a route allowlist.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Node ESM scripts, existing `features/ui-route-contracts/module-route-map.ts`, existing `components/layouts/ops-shell.tsx`, Constella migration kit docs under `.superpowers/constella-ui-migration-kit-parse-20260719-2238/`.

---

## Scope And Guardrails

This plan creates automation for migration planning and repeatable execution gates. It does not migrate every page in one pass.

Allowed automation:

- Read migration-kit docs and current repo files.
- Generate audit JSON and Markdown reports.
- Generate route skeleton proposals into `.superpowers/ops-ui-migration/generated/`.
- Validate route status, visual-token availability, and test coverage.
- Propose exact staged batches.

Disallowed automation:

- No automatic edits to `components/reference-ui/ops-reference.jsx`.
- No automatic changes to `app/api/**`, `features/**` business services, database migrations, RLS, billing, settlement, report evidence, audit behavior, or export sensitivity.
- No iframe, CDN prototype copy, mock production data, or static demo values.
- No broad formatter pass over `ops-reference.jsx`.

The first real migration batch after this plan should still be a separate implementation plan for one route, preferably `/console/war-room` or `/console/ai`, because the user has already approved the Constella direction for the intelligent command surface.

## File Structure

Create:

- `features/ops-ui-migration/route-migration-registry.ts`
  - Typed migration source of truth for prototype page, formal route, module id, current status, data domains, and risk level.
- `features/ops-ui-migration/route-migration-registry.test.ts`
  - Contract tests between the migration registry, `OPS_MODULE_ROUTES`, and the migration-kit route map.
- `scripts/ops-ui-migration-audit.mjs`
  - Dry-run audit script that scans route files, `ops-reference.jsx` usage, module map status, and migration-kit docs.
- `scripts/ops-ui-migration-audit.test.mjs`
  - Unit tests for pure audit helpers using an in-memory file reader.
- `scripts/ops-ui-generate-route-skeletons.mjs`
  - Dry-run route skeleton generator that writes proposals under `.superpowers/ops-ui-migration/generated/`.
- `scripts/ops-ui-generate-route-skeletons.test.mjs`
  - Unit tests for route skeleton path safety and overwrite prevention.
- `scripts/ops-ui-migration-gate.mjs`
  - Validation script that fails when a route is marked `ready-to-switch` or `migrated` without required tests, page file, shell usage, explicit `ops-reference` removal evidence, route-map alignment evidence, and sensitive-action checklist evidence for money/evidence routes.
- `scripts/ops-ui-migration-gate.test.mjs`
  - Unit tests for route gate decisions.
- `.superpowers/ops-ui-migration/.gitkeep`
  - Keeps the local report folder discoverable while generated reports remain untracked.

Modify:

- `package.json`
  - Add each command only after its target script exists: Task 2 adds `ops-ui:migration:audit`, Task 3 adds `ops-ui:migration:skeletons`, and Task 4 adds `ops-ui:migration:gate`.
- `.gitignore`
  - Ignore `.superpowers/ops-ui-migration/generated/`, `.superpowers/ops-ui-migration/*.json`, and `.superpowers/ops-ui-migration/*.md` while keeping `.gitkeep`.

Verify:

- `pnpm vitest run features/ops-ui-migration scripts/ops-ui-migration-audit.test.mjs scripts/ops-ui-generate-route-skeletons.test.mjs scripts/ops-ui-migration-gate.test.mjs`
- `pnpm ops-ui:migration:audit`
- `pnpm ops-ui:migration:gate`
- `pnpm type-check`
- `git diff --check`

## Registry Model

Use these exact route statuses:

```ts
export type OpsMigrationStatus =
  | "legacy-stub"
  | "ops-reference-route"
  | "shell-route"
  | "ready-to-switch"
  | "migrated";
```

Use these exact risk levels:

```ts
export type OpsMigrationRisk = "low" | "medium" | "high" | "money-or-evidence";
```

Initial registry entries:

| Prototype | Target route | Module | Route key | Initial status | Risk |
| --- | --- | --- | --- | --- | --- |
| `index.html` | `/console` | `m10` | `warroom` | `ops-reference-route` | `high` |
| `ai-workbench.html` | `/console/ai` | `m10` | `warroom` | `legacy-stub` | `high` |
| `projects.html` | `/console/projects` | `m1` | `projects` | `ops-reference-route` | `high` |
| `project-detail.html` | `/console/projects/[projectId]` | `m1` | `projects` | `legacy-stub` | `high` |
| `streamers.html` | `/console/streamers` | `m2` | `streamers` | `legacy-stub` | `medium` |
| `admissions.html` | `/console/admissions` | `m3` | `admission` | `legacy-stub` | `money-or-evidence` |
| `schedules.html` | `/console/schedules` | `m4` | `tasks` | `legacy-stub` | `high` |
| `reports.html` | `/console/reports` | `m5` | `reports` | `legacy-stub` | `money-or-evidence` |
| `settlements.html` | `/console/settlements` | `m6` | `settle` | `legacy-stub` | `money-or-evidence` |
| `audit.html` | `/console/audit` | `m7` | `audit` | `legacy-stub` | `money-or-evidence` |
| `audit.html` | `/console/exports` | `m8` | `export` | `legacy-stub` | `money-or-evidence` |
| `knowledge-base.html` | `/console/knowledge` | `m10` | `warroom` | `legacy-stub` | `medium` |
| `settings.html` | `/console/settings` | `m0` | `org` | `legacy-stub` | `high` |

## Task 1: Add Typed Migration Registry

**Files:**

- Create: `features/ops-ui-migration/route-migration-registry.ts`
- Create: `features/ops-ui-migration/route-migration-registry.test.ts`

- [ ] **Step 1: Write the failing registry tests**

Add tests that assert every module-backed entry matches `OPS_MODULE_ROUTES`, every target route starts with `/console`, and money/evidence pages are not initially marked `migrated`.

```ts
import { describe, expect, it } from "vitest";

import { OPS_MODULE_ROUTES } from "@/features/ui-route-contracts/module-route-map";

import { OPS_UI_MIGRATION_ROUTES } from "./route-migration-registry";

describe("OPS_UI_MIGRATION_ROUTES", () => {
  it("keeps module-backed migration entries aligned with the console module map", () => {
    for (const entry of OPS_UI_MIGRATION_ROUTES.filter((item) => item.module)) {
      const moduleRoute = OPS_MODULE_ROUTES.find(
        (item) => item.module === entry.module,
      );

      expect(moduleRoute, entry.targetRoute).toBeDefined();
      expect(moduleRoute?.routeKey).toBe(entry.routeKey);
    }
  });

  it("uses real console target routes", () => {
    expect(
      OPS_UI_MIGRATION_ROUTES.map((entry) => entry.targetRoute),
    ).toEqual(
      OPS_UI_MIGRATION_ROUTES.map((entry) =>
        expect.stringMatching(/^\/console(\/|$)/),
      ),
    );
  });

  it("does not mark money or evidence surfaces migrated by default", () => {
    const sensitive = OPS_UI_MIGRATION_ROUTES.filter(
      (entry) => entry.risk === "money-or-evidence",
    );

    expect(sensitive.length).toBeGreaterThan(0);
    expect(sensitive.every((entry) => entry.status !== "migrated")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the registry tests to verify RED**

Run:

```powershell
pnpm vitest run features/ops-ui-migration/route-migration-registry.test.ts
```

Expected: FAIL because `route-migration-registry.ts` does not exist.

- [ ] **Step 3: Implement the registry**

Create `features/ops-ui-migration/route-migration-registry.ts`:

```ts
import type {
  OpsModuleId,
  OpsRouteKey,
} from "@/features/ui-route-contracts/module-route-map";

export type OpsMigrationStatus =
  | "legacy-stub"
  | "ops-reference-route"
  | "shell-route"
  | "ready-to-switch"
  | "migrated";

export type OpsMigrationRisk = "low" | "medium" | "high" | "money-or-evidence";

export type OpsUiMigrationRoute = {
  prototype: string;
  targetRoute: string;
  module: OpsModuleId | null;
  routeKey: OpsRouteKey;
  status: OpsMigrationStatus;
  risk: OpsMigrationRisk;
  dataDomains: string[];
  requiredTests: string[];
};

export const OPS_UI_MIGRATION_ROUTES: OpsUiMigrationRoute[] = [
  {
    prototype: "index.html",
    targetRoute: "/console",
    module: "m10",
    routeKey: "warroom",
    status: "ops-reference-route",
    risk: "high",
    dataDomains: ["features/dashboards", "/api/dashboards/role-home"],
    requiredTests: ["app/(ops)/console/page.test.tsx"],
  },
  {
    prototype: "ai-workbench.html",
    targetRoute: "/console/ai",
    module: "m10",
    routeKey: "warroom",
    status: "legacy-stub",
    risk: "high",
    dataDomains: ["features/ai", "features/war-room", "/api/ai/**"],
    requiredTests: ["components/dashboard/overview-board.test.jsx"],
  },
  {
    prototype: "projects.html",
    targetRoute: "/console/projects",
    module: "m1",
    routeKey: "projects",
    status: "ops-reference-route",
    risk: "high",
    dataDomains: ["features/projects", "/api/projects"],
    requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
  },
  {
    prototype: "project-detail.html",
    targetRoute: "/console/projects/[projectId]",
    module: "m1",
    routeKey: "projects",
    status: "legacy-stub",
    risk: "high",
    dataDomains: ["features/projects", "features/collaborations"],
    requiredTests: ["features/projects/project-queries.test.ts"],
  },
  {
    prototype: "streamers.html",
    targetRoute: "/console/streamers",
    module: "m2",
    routeKey: "streamers",
    status: "legacy-stub",
    risk: "medium",
    dataDomains: ["features/streamers", "features/streamer-lifecycle"],
    requiredTests: ["features/streamers/streamer-service.test.ts"],
  },
  {
    prototype: "admissions.html",
    targetRoute: "/console/admissions",
    module: "m3",
    routeKey: "admission",
    status: "legacy-stub",
    risk: "money-or-evidence",
    dataDomains: ["features/applications", "features/admission-review"],
    requiredTests: ["features/applications/application-route-utils.test.ts"],
  },
  {
    prototype: "schedules.html",
    targetRoute: "/console/schedules",
    module: "m4",
    routeKey: "tasks",
    status: "legacy-stub",
    risk: "high",
    dataDomains: ["features/live-operations", "/api/live-tasks"],
    requiredTests: ["features/live-operations/live-operations-service.test.ts"],
  },
  {
    prototype: "reports.html",
    targetRoute: "/console/reports",
    module: "m5",
    routeKey: "reports",
    status: "legacy-stub",
    risk: "money-or-evidence",
    dataDomains: ["features/live-operations", "features/report-pre-review"],
    requiredTests: ["features/report-pre-review-schema-contract.test.ts"],
  },
  {
    prototype: "settlements.html",
    targetRoute: "/console/settlements",
    module: "m6",
    routeKey: "settle",
    status: "legacy-stub",
    risk: "money-or-evidence",
    dataDomains: ["features/settlements", "/api/settlement-batches"],
    requiredTests: ["features/settlements/settlement-service.test.ts"],
  },
  {
    prototype: "audit.html",
    targetRoute: "/console/audit",
    module: "m7",
    routeKey: "audit",
    status: "legacy-stub",
    risk: "money-or-evidence",
    dataDomains: ["features/audit-center", "/api/audit-logs"],
    requiredTests: ["features/audit-center"],
  },
  {
    prototype: "audit.html",
    targetRoute: "/console/exports",
    module: "m8",
    routeKey: "export",
    status: "legacy-stub",
    risk: "money-or-evidence",
    dataDomains: ["features/exports", "/api/exports"],
    requiredTests: ["features/exports", "app/api/exports"],
  },
  {
    prototype: "knowledge-base.html",
    targetRoute: "/console/knowledge",
    module: null,
    routeKey: "warroom",
    status: "legacy-stub",
    risk: "medium",
    dataDomains: ["/api/knowledge-base", "/api/ai/kb"],
    requiredTests: ["components/reference-ui/ops-reference.test.jsx"],
  },
  {
    prototype: "settings.html",
    targetRoute: "/console/settings",
    module: "m0",
    routeKey: "org",
    status: "legacy-stub",
    risk: "high",
    dataDomains: ["features/organizations", "/api/organization/settings"],
    requiredTests: ["components/reference-ui/ops-reference-org-members.test.jsx"],
  },
];
```

- [ ] **Step 4: Run the registry tests to verify GREEN**

Run:

```powershell
pnpm vitest run features/ops-ui-migration/route-migration-registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the registry**

Run:

```powershell
git add features/ops-ui-migration/route-migration-registry.ts features/ops-ui-migration/route-migration-registry.test.ts
git commit -m "chore: add ops ui migration registry"
```

## Task 2: Add Dry-Run Migration Audit

**Files:**

- Create: `scripts/ops-ui-migration-audit.mjs`
- Create: `scripts/ops-ui-migration-audit.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `.superpowers/ops-ui-migration/.gitkeep`

- [ ] **Step 1: Write failing audit-helper tests**

Use pure functions so the script can be tested without touching the real filesystem:

```js
import { describe, expect, it } from "vitest";

import {
  buildMigrationAudit,
  normalizeRouteFilePath,
} from "./ops-ui-migration-audit.mjs";

describe("ops ui migration audit", () => {
  it("normalizes console route paths for Windows-safe LiteralPath usage", () => {
    expect(normalizeRouteFilePath("/console/projects/[projectId]")).toBe(
      "app/(ops)/console/projects/[projectId]/page.tsx",
    );
    expect(normalizeRouteFilePath("/console")).toBe(
      "app/(ops)/console/page.tsx",
    );
  });

  it("reports route existence, ops-reference usage, and required tests", () => {
    const audit = buildMigrationAudit({
      routes: [
        {
          prototype: "projects.html",
          targetRoute: "/console/projects",
          module: "m1",
          routeKey: "projects",
          status: "ops-reference-route",
          risk: "high",
          dataDomains: ["features/projects"],
          requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
        },
      ],
      exists: (file) =>
        [
          "app/(ops)/console/projects/page.tsx",
          "app/(ops)/console/projects/page.test.tsx",
        ].includes(file),
      readText: (file) =>
        file.endsWith("page.tsx")
          ? 'import OpsReferenceApp from "@/components/reference-ui/ops-reference";'
          : "",
    });

    expect(audit.routes).toEqual([
      expect.objectContaining({
        targetRoute: "/console/projects",
        hasPage: true,
        usesOpsReference: true,
        missingTests: [],
        nextAction: "extract-shell-route",
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run audit tests to verify RED**

Run:

```powershell
pnpm vitest run scripts/ops-ui-migration-audit.test.mjs
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement the audit script**

Create `scripts/ops-ui-migration-audit.mjs` with named exports and a CLI entry. The CLI dynamically imports the TypeScript registry by reading the built-in route list from a JSON bridge generated in memory; if direct TS import is unavailable in Node, the script uses `tsx` only when the project already provides it. Do not add a dependency for this task.

Use this implementation shape:

```js
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const reportDir = path.join(repoRoot, ".superpowers", "ops-ui-migration");

export function normalizeRouteFilePath(route) {
  if (route === "/console") return "app/(ops)/console/page.tsx";
  const suffix = route.replace(/^\/console\/?/, "");
  return suffix
    ? `app/(ops)/console/${suffix}/page.tsx`
    : "app/(ops)/console/page.tsx";
}

export function buildMigrationAudit({ routes, exists, readText }) {
  return {
    generatedAt: new Date().toISOString(),
    routes: routes.map((entry) => {
      const pageFile = normalizeRouteFilePath(entry.targetRoute);
      const pageText = exists(pageFile) ? readText(pageFile) : "";
      const missingTests = entry.requiredTests.filter((file) => !exists(file));
      const usesOpsReference = pageText.includes(
        "@/components/reference-ui/ops-reference",
      );
      const hasShellRoute = pageText.includes("@/components/layouts/ops-shell");
      const hasPage = exists(pageFile);
      const nextAction = !hasPage
        ? "generate-route-skeleton"
        : usesOpsReference
          ? "extract-shell-route"
          : missingTests.length
            ? "add-route-tests"
            : hasShellRoute
              ? "gate-route-switch"
              : "inspect-manually";

      return {
        ...entry,
        pageFile,
        hasPage,
        usesOpsReference,
        hasShellRoute,
        missingTests,
        nextAction,
      };
    }),
  };
}

export function writeAuditReports(audit, outputDir = reportDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "migration-audit.json");
  const mdPath = path.join(outputDir, "migration-audit.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(audit, null, 2)}\n`);
  fs.writeFileSync(
    mdPath,
    [
      "# Ops UI Migration Audit",
      "",
      "| Route | Status | Page | Uses ops-reference | Missing tests | Next action |",
      "| --- | --- | --- | --- | --- | --- |",
      ...audit.routes.map((route) =>
        [
          route.targetRoute,
          route.status,
          route.hasPage ? "yes" : "no",
          route.usesOpsReference ? "yes" : "no",
          route.missingTests.length ? route.missingTests.join("<br>") : "none",
          route.nextAction,
        ].join(" | "),
      ),
      "",
    ].join("\n"),
  );
  return { jsonPath, mdPath };
}
```

The CLI entry should load `OPS_UI_MIGRATION_ROUTES` from `features/ops-ui-migration/route-migration-registry.ts` by transpiling the registry with the existing `typescript` dev dependency and evaluating the CommonJS output in a constrained `vm` context, then call `writeAuditReports`. Do not rely on native Node TypeScript importing; the repo supports Node `>=20`.

- [ ] **Step 4: Add package and ignore entries**

Add only the audit script in this task:

```json
{
  "ops-ui:migration:audit": "node scripts/ops-ui-migration-audit.mjs"
}
```

Add `.gitignore` lines:

```gitignore
.superpowers/ops-ui-migration/*.json
.superpowers/ops-ui-migration/*.md
.superpowers/ops-ui-migration/generated/
!.superpowers/ops-ui-migration/.gitkeep
```

- [ ] **Step 5: Run tests and the audit**

Run:

```powershell
pnpm vitest run scripts/ops-ui-migration-audit.test.mjs
pnpm ops-ui:migration:audit
```

Expected: tests PASS; `.superpowers/ops-ui-migration/migration-audit.json` and `.superpowers/ops-ui-migration/migration-audit.md` are generated but ignored by git.

- [ ] **Step 6: Commit the audit tooling**

Run:

```powershell
git add scripts/ops-ui-migration-audit.mjs scripts/ops-ui-migration-audit.test.mjs package.json .gitignore .superpowers/ops-ui-migration/.gitkeep
git commit -m "chore: audit ops ui migration readiness"
```

## Task 3: Add Dry-Run Route Skeleton Generator

**Files:**

- Create: `scripts/ops-ui-generate-route-skeletons.mjs`
- Create: `scripts/ops-ui-generate-route-skeletons.test.mjs`

- [ ] **Step 1: Write failing skeleton tests**

```js
import { describe, expect, it } from "vitest";

import {
  buildRouteSkeleton,
  safeGeneratedRoutePath,
} from "./ops-ui-generate-route-skeletons.mjs";

describe("ops ui route skeleton generator", () => {
  it("writes generated proposals under the local migration folder", () => {
    expect(safeGeneratedRoutePath("/console/ai")).toBe(
      ".superpowers/ops-ui-migration/generated/console/ai/page.tsx",
    );
  });

  it("creates a shell route proposal that does not import ops-reference", () => {
    const output = buildRouteSkeleton({
      targetRoute: "/console/ai",
      routeKey: "warroom",
      dataDomains: ["features/ai", "/api/ai/**"],
    });

    expect(output).toContain('import { OpsShell } from "@/components/layouts/ops-shell";');
    expect(output).toContain("requireConsoleStaffAuth");
    expect(output).toContain("AI 工作台");
    expect(output).not.toContain("ops-reference");
  });
});
```

- [ ] **Step 2: Run skeleton tests to verify RED**

Run:

```powershell
pnpm vitest run scripts/ops-ui-generate-route-skeletons.test.mjs
```

Expected: FAIL because the generator does not exist.

- [ ] **Step 3: Implement the skeleton generator**

The generator must only write under `.superpowers/ops-ui-migration/generated/`.

```js
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function safeGeneratedRoutePath(route) {
  const clean = route.replace(/^\/+/, "").replace(/\[|\]/g, "");
  if (clean.includes("..")) {
    throw new Error(`Unsafe route path: ${route}`);
  }
  return `.superpowers/ops-ui-migration/generated/${clean}/page.tsx`;
}

export function buildRouteSkeleton(entry) {
  const title =
    entry.targetRoute === "/console/ai"
      ? "AI 工作台"
      : entry.targetRoute === "/console/war-room"
        ? "今日指挥台"
        : "经营控制台页面";

  return `import { OpsShell } from "@/components/layouts/ops-shell";

import { requireConsoleStaffAuth } from "../console-auth";

export default async function GeneratedOpsRoutePage() {
  const { auth } = await requireConsoleStaffAuth();

  return (
    <OpsShell context={auth} unreadCount={0} activeHref="${entry.targetRoute}">
      <section className="space-y-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-normal text-[var(--ink-900)]">
            ${title}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-500)]">
            数据域：${entry.dataDomains.join("、")}
          </p>
        </div>
        <div className="rounded-md border border-[var(--line)] bg-white p-4 text-sm text-[var(--ink-500)]">
          这是自动生成的迁移骨架，只能作为人工实现起点，不能直接发布。
        </div>
      </section>
    </OpsShell>
  );
}
`;
}

export function writeSkeleton(entry, root = process.cwd()) {
  const relative = safeGeneratedRoutePath(entry.targetRoute);
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, buildRouteSkeleton(entry));
  return relative;
}
```

The CLI accepts `--route=/console/ai` and refuses to run without a route. It prints the generated path.

- [ ] **Step 4: Add the package script**

Add the skeleton command only after `scripts/ops-ui-generate-route-skeletons.mjs` exists:

```json
{
  "ops-ui:migration:skeletons": "node scripts/ops-ui-generate-route-skeletons.mjs"
}
```

- [ ] **Step 5: Run tests and generate one proposal**

Run:

```powershell
pnpm vitest run scripts/ops-ui-generate-route-skeletons.test.mjs
pnpm ops-ui:migration:skeletons -- --route=/console/ai
```

Expected: tests PASS; generated proposal appears under `.superpowers/ops-ui-migration/generated/console/ai/page.tsx` and is ignored by git.

- [ ] **Step 6: Commit the skeleton generator**

Run:

```powershell
git add scripts/ops-ui-generate-route-skeletons.mjs scripts/ops-ui-generate-route-skeletons.test.mjs package.json
git commit -m "chore: generate dry-run ops route skeletons"
```

## Task 4: Add Migration Gate

**Files:**

- Create: `scripts/ops-ui-migration-gate.mjs`
- Create: `scripts/ops-ui-migration-gate.test.mjs`

- [ ] **Step 1: Write failing gate tests**

```js
import { describe, expect, it } from "vitest";

import { evaluateRouteGate } from "./ops-ui-migration-gate.mjs";

describe("ops ui migration gate", () => {
  it("blocks migrated status without a page, tests, and shell route", () => {
    expect(
      evaluateRouteGate({
        status: "migrated",
        hasPage: true,
        hasShellRoute: false,
        usesOpsReference: true,
        missingTests: [],
        risk: "high",
      }),
    ).toEqual({
      ok: false,
      reasons: [
        "migrated route must use OpsShell",
        "migrated route must not import ops-reference",
      ],
    });
  });

  it("requires sensitive routes to pass explicit money/evidence checks", () => {
    expect(
      evaluateRouteGate({
        status: "ready-to-switch",
        hasPage: true,
        hasShellRoute: true,
        usesOpsReference: false,
        missingTests: [],
        risk: "money-or-evidence",
        hasSensitiveActionChecklist: false,
      }),
    ).toEqual({
      ok: false,
      reasons: ["money/evidence route requires sensitive action checklist"],
    });
  });
});
```

- [ ] **Step 2: Run gate tests to verify RED**

Run:

```powershell
pnpm vitest run scripts/ops-ui-migration-gate.test.mjs
```

Expected: FAIL because the gate script does not exist.

- [ ] **Step 3: Implement the gate evaluator**

```js
export function evaluateRouteGate(route) {
  const reasons = [];

  if ((route.status === "ready-to-switch" || route.status === "migrated") && !route.hasPage) {
    reasons.push("route page file is missing");
  }
  if ((route.status === "ready-to-switch" || route.status === "migrated") && route.missingTests.length) {
    reasons.push(`missing tests: ${route.missingTests.join(", ")}`);
  }
  if (route.status === "migrated" && !route.hasShellRoute) {
    reasons.push("migrated route must use OpsShell");
  }
  if (route.status === "migrated" && route.usesOpsReference) {
    reasons.push("migrated route must not import ops-reference");
  }
  if (
    (route.status === "ready-to-switch" || route.status === "migrated") &&
    route.risk === "money-or-evidence" &&
    !route.hasSensitiveActionChecklist
  ) {
    reasons.push("money/evidence route requires sensitive action checklist");
  }

  return { ok: reasons.length === 0, reasons };
}
```

The CLI reads `.superpowers/ops-ui-migration/migration-audit.json`, evaluates every route, prints failures, and exits 1 when any gate fails.

- [ ] **Step 4: Add the package script**

Add the gate command only after `scripts/ops-ui-migration-gate.mjs` exists:

```json
{
  "ops-ui:migration:gate": "node scripts/ops-ui-migration-gate.mjs"
}
```

- [ ] **Step 5: Run the gate**

Run:

```powershell
pnpm vitest run scripts/ops-ui-migration-gate.test.mjs
pnpm ops-ui:migration:audit
pnpm ops-ui:migration:gate
```

Expected: tests PASS. The gate may report routes not ready; it must only exit 1 when a route is marked `ready-to-switch` or `migrated` without the required evidence.

- [ ] **Step 6: Commit the gate**

Run:

```powershell
git add scripts/ops-ui-migration-gate.mjs scripts/ops-ui-migration-gate.test.mjs package.json
git commit -m "chore: gate ops ui migration readiness"
```

## Task 5: Generate The First Migration Batch Report

**Files:**

- Modify: `scripts/ops-ui-migration-audit.mjs`
- Modify: `scripts/ops-ui-migration-audit.test.mjs`

- [ ] **Step 1: Add failing batch-order tests**

```js
import { describe, expect, it } from "vitest";

import { buildMigrationBatches } from "./ops-ui-migration-audit.mjs";

describe("migration batch ordering", () => {
  it("orders low-risk shell work before money and evidence pages", () => {
    const batches = buildMigrationBatches([
      { targetRoute: "/console/reports", risk: "money-or-evidence", nextAction: "generate-route-skeleton" },
      { targetRoute: "/console/ai", risk: "high", nextAction: "generate-route-skeleton" },
      { targetRoute: "/console/streamers", risk: "medium", nextAction: "generate-route-skeleton" },
    ]);

    expect(batches.map((batch) => batch.name)).toEqual([
      "foundation-and-shell",
      "command-and-ai",
      "supply-and-projects",
      "money-evidence-and-governance",
    ]);
    expect(batches[1].routes).toContain("/console/ai");
    expect(batches[3].routes).toContain("/console/reports");
  });
});
```

- [ ] **Step 2: Implement `buildMigrationBatches`**

Use this deterministic batch policy:

```js
export function buildMigrationBatches(routes) {
  return [
    {
      name: "foundation-and-shell",
      routes: ["/console"],
      commands: ["pnpm ops-ui:migration:audit", "pnpm ops-ui:migration:gate"],
    },
    {
      name: "command-and-ai",
      routes: routes
        .filter((route) => ["/console/ai", "/console/war-room"].includes(route.targetRoute))
        .map((route) => route.targetRoute),
      commands: ["pnpm vitest run components/dashboard/overview-board.test.jsx"],
    },
    {
      name: "supply-and-projects",
      routes: routes
        .filter((route) =>
          ["/console/projects", "/console/projects/[projectId]", "/console/streamers", "/console/admissions", "/console/schedules"].includes(route.targetRoute),
        )
        .map((route) => route.targetRoute),
      commands: [
        'pnpm vitest run "app/(ops)/console/projects/page.test.tsx" components/reference-ui/ops-reference.test.jsx',
      ],
    },
    {
      name: "money-evidence-and-governance",
      routes: routes
        .filter((route) => route.risk === "money-or-evidence")
        .map((route) => route.targetRoute),
      commands: [
        "pnpm test:permissions",
        "pnpm test:custom-settlement",
        "pnpm test:p3-governance",
      ],
    },
  ];
}
```

- [ ] **Step 3: Write the batch report**

Extend `writeAuditReports` so `migration-audit.md` includes a `## Recommended Batches` section with batch name, route list, and PowerShell-copyable verification commands.

- [ ] **Step 4: Run tests and regenerate the report**

Run:

```powershell
pnpm vitest run scripts/ops-ui-migration-audit.test.mjs
pnpm ops-ui:migration:audit
```

Expected: tests PASS; the Markdown report contains batch names in the exact order above.

- [ ] **Step 5: Commit batch reporting**

Run:

```powershell
git add scripts/ops-ui-migration-audit.mjs scripts/ops-ui-migration-audit.test.mjs
git commit -m "chore: report ops ui migration batches"
```

## Task 6: Final Verification

**Files:**

- Verify only.

- [ ] **Step 1: Run focused automation tests**

Run:

```powershell
pnpm vitest run features/ops-ui-migration scripts/ops-ui-migration-audit.test.mjs scripts/ops-ui-generate-route-skeletons.test.mjs scripts/ops-ui-migration-gate.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run migration commands**

Run:

```powershell
pnpm ops-ui:migration:audit
pnpm ops-ui:migration:skeletons -- --route=/console/ai
pnpm ops-ui:migration:gate
```

Expected: audit and skeleton files are generated under `.superpowers/ops-ui-migration/`; generated reports remain untracked; gate does not fail unless a route is incorrectly marked `ready-to-switch` or `migrated`.

- [ ] **Step 3: Run repository checks**

Run:

```powershell
pnpm type-check
git diff --check
git status --short
```

Expected: type-check and diff check pass. `git status --short` may show unrelated pre-existing workspace edits; do not stage them.

- [ ] **Step 4: Commit final package wiring if needed**

If Task 2 did not already commit `package.json`, `.gitignore`, and `.superpowers/ops-ui-migration/.gitkeep`, stage only those files:

```powershell
git add package.json .gitignore .superpowers/ops-ui-migration/.gitkeep
git commit -m "chore: wire ops ui migration commands"
```

Expected: no unrelated files are staged.

## Execution After This Plan

After this automation plan lands, execute migrations in this order:

1. Run `pnpm ops-ui:migration:audit` and inspect `.superpowers/ops-ui-migration/migration-audit.md`.
2. Generate `/console/ai` and `/console/war-room` skeleton proposals.
3. Write a route-specific implementation plan for `/console/ai` or `/console/war-room`.
4. Migrate one route using TDD and existing real data loaders.
5. Mark only that route `ready-to-switch`.
6. Run `pnpm ops-ui:migration:gate`.
7. Update `OPS_MODULE_ROUTES` only after route tests, visual checks, permission checks, and sensitive-action checks pass.

## Self-Review

Spec coverage:

- Migration-kit architecture is covered by typed registry, dry-run audit, skeleton generation, and route gate.
- Current App Router and `ops-reference.jsx` boundaries are covered by audit fields `hasPage`, `usesOpsReference`, and `hasShellRoute`.
- The approved command/AI direction is prioritized in `command-and-ai` batch.
- Money, evidence, settlement, export, audit, and report surfaces are guarded by `money-or-evidence` risk and sensitive-action checklist.
- No backend/API/database/RBAC changes are made by this automation layer.

Placeholder scan:

- No step uses open-ended deferred work.
- Every script has a concrete test, command, and expected result.
- Generated output paths are explicit and constrained to `.superpowers/ops-ui-migration/`.

Type consistency:

- `OpsMigrationStatus`, `OpsMigrationRisk`, `OpsUiMigrationRoute`, `routeKey`, and `module` names are consistent across registry, audit, skeleton, and gate tasks.
- The plan uses `routeKey: "settle"` to match the existing `OpsRouteKey` union.
- The plan uses PowerShell-safe quoted paths when invoking paths containing `(ops)` or `[projectId]`.
