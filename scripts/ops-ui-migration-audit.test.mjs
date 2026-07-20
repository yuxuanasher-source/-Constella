import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildMigrationBatches,
  buildMigrationAudit,
  loadRegistryRoutes,
  normalizeRouteFilePath,
  writeAuditReports,
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

  it("rejects unsafe or non-console route paths", () => {
    expect(() => normalizeRouteFilePath("/settings")).toThrow(
      "Expected route to start with /console",
    );
    expect(() => normalizeRouteFilePath("/console/../settings")).toThrow(
      "Route must not contain . or .. segments",
    );
    expect(() => normalizeRouteFilePath("/console/./settings")).toThrow(
      "Route must not contain . or .. segments",
    );
    expect(() => normalizeRouteFilePath("/console/..\\..\\settings")).toThrow(
      "Route must not contain backslashes",
    );
    expect(() =>
      normalizeRouteFilePath("/console/projects\\..\\settings"),
    ).toThrow("Route must not contain backslashes");
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

  it("detects shell routes from the page imports", () => {
    const audit = buildMigrationAudit({
      routes: [
        {
          prototype: "projects.html",
          targetRoute: "/console/projects",
          module: "m1",
          routeKey: "projects",
          status: "legacy-stub",
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
          ? 'import { OpsShell } from "@/components/layouts/ops-shell";'
          : "",
    });

    expect(audit.routes).toEqual([
      expect.objectContaining({
        targetRoute: "/console/projects",
        hasShellRoute: true,
        nextAction: "gate-route-switch",
      }),
    ]);
  });

  it("emits route-map evidence for module-backed routes", () => {
    const audit = buildMigrationAudit({
      routes: [
        {
          prototype: "projects.html",
          targetRoute: "/console/projects",
          module: "m1",
          routeKey: "projects",
          status: "ready-to-switch",
          risk: "high",
          dataDomains: ["features/projects"],
          requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
        },
      ],
      moduleRoutes: [
        {
          module: "m1",
          href: "/console/projects",
          routeKey: "projects",
          status: "partial",
        },
      ],
      exists: (file) =>
        [
          "app/(ops)/console/projects/page.tsx",
          "app/(ops)/console/projects/page.test.tsx",
        ].includes(file),
      readText: (file) =>
        file.endsWith("page.tsx")
          ? 'import { OpsShell } from "@/components/layouts/ops-shell";'
          : "",
    });

    expect(audit.routes[0]).toEqual(
      expect.objectContaining({
        routeMap: {
          module: "m1",
          routeKey: "projects",
          href: "/console/projects",
          status: "partial",
        },
      }),
    );
  });

  it("emits route-map mismatches as producer evidence instead of hiding them", () => {
    const audit = buildMigrationAudit({
      routes: [
        {
          prototype: "settlements.html",
          targetRoute: "/console/settlements",
          module: "m6",
          routeKey: "projects",
          status: "ready-to-switch",
          risk: "money-or-evidence",
          dataDomains: ["features/settlements"],
          requiredTests: ["features/settlements/settlement-service.test.ts"],
        },
      ],
      moduleRoutes: [
        {
          module: "m6",
          href: "/console/stubs/m6",
          routeKey: "settle",
          status: "live",
        },
      ],
      exists: () => true,
      readText: () =>
        'import { OpsShell } from "@/components/layouts/ops-shell";',
    });

    expect(audit.routes[0]).toEqual(
      expect.objectContaining({
        routeKey: "projects",
        routeMap: {
          module: "m6",
          routeKey: "settle",
          href: "/console/stubs/m6",
          status: "live",
        },
      }),
    );
  });

  it("emits explicit null route-map evidence when the module map has no match", () => {
    const audit = buildMigrationAudit({
      routes: [
        {
          prototype: "custom.html",
          targetRoute: "/console/custom",
          module: null,
          routeKey: "projects",
          status: "legacy-stub",
          risk: "high",
          dataDomains: ["features/projects"],
          requiredTests: ["features/projects/project-queries.test.ts"],
        },
        {
          prototype: "unknown.html",
          targetRoute: "/console/unknown",
          module: "m1",
          routeKey: "projects",
          status: "legacy-stub",
          risk: "high",
          dataDomains: ["features/projects"],
          requiredTests: ["features/projects/project-queries.test.ts"],
        },
      ],
      moduleRoutes: [],
      exists: () => false,
      readText: () => "",
    });

    expect(audit.routes.map((route) => route.routeMap)).toEqual([null, null]);
  });

  it("emits sensitive checklist evidence as false by default", () => {
    const audit = buildMigrationAudit({
      routes: [
        {
          prototype: "settlements.html",
          targetRoute: "/console/settlements",
          module: "m6",
          routeKey: "settle",
          status: "legacy-stub",
          risk: "money-or-evidence",
          dataDomains: ["features/settlements"],
          requiredTests: ["features/settlements/settlement-service.test.ts"],
        },
        {
          prototype: "audit.html",
          targetRoute: "/console/audit",
          module: "m7",
          routeKey: "audit",
          status: "ready-to-switch",
          risk: "money-or-evidence",
          dataDomains: ["features/audit-center"],
          requiredTests: ["features/audit-center"],
          hasSensitiveActionChecklist: true,
        },
      ],
      moduleRoutes: [
        {
          module: "m6",
          href: "/console/stubs/m6",
          routeKey: "settle",
          status: "live",
        },
        {
          module: "m7",
          href: "/console/stubs/m7",
          routeKey: "audit",
          status: "live",
        },
      ],
      exists: () => true,
      readText: () =>
        'import { OpsShell } from "@/components/layouts/ops-shell";',
    });

    expect(
      audit.routes.map((route) => route.hasSensitiveActionChecklist),
    ).toEqual([false, true]);
  });

  it.each([
    {
      name: "generate-route-skeleton",
      pageText: null,
      requiredTestExists: true,
      expected: "generate-route-skeleton",
    },
    {
      name: "extract-shell-route",
      pageText: 'import OpsReferenceApp from "@/components/reference-ui/ops-reference";',
      requiredTestExists: true,
      expected: "extract-shell-route",
    },
    {
      name: "add-route-tests",
      pageText: "export default function ProjectsPage() {}",
      requiredTestExists: false,
      expected: "add-route-tests",
    },
    {
      name: "gate-route-switch",
      pageText: 'import { OpsShell } from "@/components/layouts/ops-shell";',
      requiredTestExists: true,
      expected: "gate-route-switch",
    },
    {
      name: "inspect-manually",
      pageText: "export default function ProjectsPage() {}",
      requiredTestExists: true,
      expected: "inspect-manually",
    },
  ])("reports next action: $name", ({ pageText, requiredTestExists, expected }) => {
    const audit = buildMigrationAudit({
      routes: [
        {
          prototype: "projects.html",
          targetRoute: "/console/projects",
          module: "m1",
          routeKey: "projects",
          status: "legacy-stub",
          risk: "high",
          dataDomains: ["features/projects"],
          requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
        },
      ],
      exists: (file) => {
        if (file === "app/(ops)/console/projects/page.tsx") {
          return pageText !== null;
        }

        return (
          file === "app/(ops)/console/projects/page.test.tsx" &&
          requiredTestExists
        );
      },
      readText: () => pageText ?? "",
    });

    expect(audit.routes[0]).toEqual(
      expect.objectContaining({
        nextAction: expected,
      }),
    );
  });

  it("loads registry routes by transpiling TypeScript source", async () => {
    await expect(
      loadRegistryRoutes({
        repoRoot: "C:/repo",
        registryPath: "features/ops-ui-migration/route-migration-registry.ts",
        readText: () => `
          import type { OpsRouteKey } from "@/features/ui-route-contracts/module-route-map";

          export const OPS_UI_MIGRATION_ROUTES = [
            {
              prototype: "projects.html",
              targetRoute: "/console/projects",
              module: "m1",
              routeKey: "projects" as OpsRouteKey,
              status: "legacy-stub",
              risk: "high",
              dataDomains: ["features/projects"],
              requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
            },
          ];
        `,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        targetRoute: "/console/projects",
      }),
    ]);
  });

  it("throws a clear error when registry routes are missing", async () => {
    await expect(
      loadRegistryRoutes({
        registryPath: "registry.ts",
        readText: () => "export const OPS_UI_MIGRATION_ROUTES = null;",
      }),
    ).rejects.toThrow("OPS_UI_MIGRATION_ROUTES must be an array");
  });

  it("builds migration batches in the approved deterministic order", () => {
    const batches = buildMigrationBatches([
      routeFixture("/console/war-room", "high"),
      routeFixture("/console/projects", "high"),
      routeFixture("/console", "high"),
      routeFixture("/console/ai", "high"),
    ]);

    expect(batches.map((batch) => batch.name)).toEqual([
      "foundation-and-shell",
      "command-and-ai",
      "supply-and-projects",
      "money-evidence-and-governance",
    ]);
    expect(batches.map((batch) => batch.commands)).toEqual([
      ["pnpm ops-ui:migration:audit", "pnpm ops-ui:migration:gate"],
      ["pnpm vitest run components/dashboard/overview-board.test.jsx"],
      [
        'pnpm vitest run "app/(ops)/console/projects/page.test.tsx" components/console/projects-workbench.test.tsx',
      ],
      [
        "pnpm test:permissions",
        "pnpm test:custom-settlement",
        "pnpm test:p3-governance",
      ],
    ]);
  });

  it("places policy routes into the expected migration batches", () => {
    const batches = buildMigrationBatches([
      routeFixture("/console/projects/[projectId]", "high"),
      routeFixture("/console/streamers", "high"),
      routeFixture("/console/admissions", "high"),
      routeFixture("/console/schedules", "high"),
      routeFixture("/console/projects", "high"),
      routeFixture("/console/ai", "high"),
      routeFixture("/console/war-room", "high"),
      routeFixture("/console", "high"),
    ]);

    expect(batchRoutes(batches, "foundation-and-shell")).toEqual(["/console"]);
    expect(batchRoutes(batches, "command-and-ai")).toEqual([
      "/console/ai",
      "/console/war-room",
    ]);
    expect(batchRoutes(batches, "supply-and-projects")).toEqual([
      "/console/projects",
      "/console/projects/[projectId]",
      "/console/streamers",
      "/console/admissions",
      "/console/schedules",
    ]);
  });

  it("places every money-or-evidence route into the governance batch once", () => {
    const batches = buildMigrationBatches([
      routeFixture("/console/settlements", "money-or-evidence"),
      routeFixture("/console/projects", "high"),
      routeFixture("/console/audit", "money-or-evidence"),
      routeFixture("/console/settlements", "money-or-evidence"),
    ]);

    expect(batchRoutes(batches, "money-evidence-and-governance")).toEqual([
      "/console/settlements",
      "/console/audit",
    ]);
  });

  it("preserves batch order when routes are missing", () => {
    const batches = buildMigrationBatches([]);

    expect(batches.map((batch) => batch.name)).toEqual([
      "foundation-and-shell",
      "command-and-ai",
      "supply-and-projects",
      "money-evidence-and-governance",
    ]);
    expect(batches.map((batch) => batch.routes)).toEqual([[], [], [], []]);
  });

  it("writes the recommended batches section to markdown in batch order", () => {
    const outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "ops-ui-migration-audit-"),
    );
    const audit = {
      generatedAt: "2026-07-20T00:00:00.000Z",
      routes: [
        auditRouteFixture("/console", "high"),
        auditRouteFixture("/console/ai", "high"),
        auditRouteFixture("/console/projects", "high"),
        auditRouteFixture("/console/settlements", "money-or-evidence"),
      ],
    };

    const { markdownPath } = writeAuditReports(audit, outputDir);
    const markdown = fs.readFileSync(markdownPath, "utf8");

    expect(markdown).toContain("## Recommended Batches");
    expect(markdown.indexOf("### foundation-and-shell")).toBeLessThan(
      markdown.indexOf("### command-and-ai"),
    );
    expect(markdown.indexOf("### command-and-ai")).toBeLessThan(
      markdown.indexOf("### supply-and-projects"),
    );
    expect(markdown.indexOf("### supply-and-projects")).toBeLessThan(
      markdown.indexOf("### money-evidence-and-governance"),
    );
    expect(markdown).toContain("- Routes: /console");
    expect(markdown).toContain("- Routes: /console/settlements");
    expect(markdown).toContain("- `pnpm ops-ui:migration:audit`");
    expect(markdown).toContain("- `pnpm ops-ui:migration:gate`");
    expect(markdown).toContain(
      '- `pnpm vitest run "app/(ops)/console/projects/page.test.tsx" components/console/projects-workbench.test.tsx`',
    );
    expect(markdown).toContain("- `pnpm test:permissions`");
    expect(markdown).toContain("- `pnpm test:custom-settlement`");
    expect(markdown).toContain("- `pnpm test:p3-governance`");
    expect(markdown).not.toContain("&&");
  });
});

function routeFixture(targetRoute, risk) {
  return {
    prototype: `${targetRoute.replaceAll("/", "-")}.html`,
    targetRoute,
    module: "m1",
    routeKey: "projects",
    status: "legacy-stub",
    risk,
    dataDomains: ["features/projects"],
    requiredTests: [],
  };
}

function auditRouteFixture(targetRoute, risk) {
  return {
    ...routeFixture(targetRoute, risk),
    pageFile: "app/(ops)/console/page.tsx",
    hasPage: true,
    usesOpsReference: false,
    hasShellRoute: true,
    missingTests: [],
    routeMap: null,
    hasSensitiveActionChecklist: false,
    nextAction: "gate-route-switch",
  };
}

function batchRoutes(batches, name) {
  return batches.find((batch) => batch.name === name)?.routes;
}
