import { describe, expect, it } from "vitest";

import {
  buildMigrationAudit,
  loadRegistryRoutes,
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
});
