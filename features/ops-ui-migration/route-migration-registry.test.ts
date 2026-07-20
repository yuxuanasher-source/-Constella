import { describe, expect, it } from "vitest";

import { OPS_MODULE_ROUTES } from "@/features/ui-route-contracts/module-route-map";

import { OPS_UI_MIGRATION_ROUTES } from "./route-migration-registry";
import type {
  OpsMigrationStatus,
  OpsUiMigrationRoute,
} from "./route-migration-registry";

const EXPECTED_INITIAL_MIGRATION_INVENTORY = [
  {
    prototype: "index.html",
    targetRoute: "/console",
    module: "m10",
    routeKey: "warroom",
    status: "ops-reference-route",
    risk: "high",
  },
  {
    prototype: "ai-workbench.html",
    targetRoute: "/console/ai",
    module: "m10",
    routeKey: "warroom",
    status: "ready-to-switch",
    risk: "high",
  },
  {
    prototype: "projects.html",
    targetRoute: "/console/projects",
    module: "m1",
    routeKey: "projects",
    status: "ops-reference-route",
    risk: "high",
  },
  {
    prototype: "project-detail.html",
    targetRoute: "/console/projects/[projectId]",
    module: "m1",
    routeKey: "projects",
    status: "legacy-stub",
    risk: "high",
  },
  {
    prototype: "streamers.html",
    targetRoute: "/console/streamers",
    module: "m2",
    routeKey: "streamers",
    status: "legacy-stub",
    risk: "medium",
  },
  {
    prototype: "admissions.html",
    targetRoute: "/console/admissions",
    module: "m3",
    routeKey: "admission",
    status: "legacy-stub",
    risk: "money-or-evidence",
  },
  {
    prototype: "schedules.html",
    targetRoute: "/console/schedules",
    module: "m4",
    routeKey: "tasks",
    status: "legacy-stub",
    risk: "high",
  },
  {
    prototype: "reports.html",
    targetRoute: "/console/reports",
    module: "m5",
    routeKey: "reports",
    status: "legacy-stub",
    risk: "money-or-evidence",
  },
  {
    prototype: "settlements.html",
    targetRoute: "/console/settlements",
    module: "m6",
    routeKey: "settle",
    status: "legacy-stub",
    risk: "money-or-evidence",
  },
  {
    prototype: "audit.html",
    targetRoute: "/console/audit",
    module: "m7",
    routeKey: "audit",
    status: "legacy-stub",
    risk: "money-or-evidence",
  },
  {
    prototype: "audit.html",
    targetRoute: "/console/exports",
    module: "m8",
    routeKey: "export",
    status: "legacy-stub",
    risk: "money-or-evidence",
  },
  {
    prototype: "knowledge-base.html",
    targetRoute: "/console/knowledge",
    module: "m10",
    routeKey: "warroom",
    status: "legacy-stub",
    risk: "medium",
  },
  {
    prototype: "settings.html",
    targetRoute: "/console/settings",
    module: "m0",
    routeKey: "org",
    status: "legacy-stub",
    risk: "high",
  },
] as const;

function isNotMigrated(status: OpsMigrationStatus) {
  return status !== "migrated";
}

describe("OPS_UI_MIGRATION_ROUTES", () => {
  it("locks the initial migration route inventory", () => {
    expect(
      OPS_UI_MIGRATION_ROUTES.map(
        ({ prototype, targetRoute, module, routeKey, status, risk }) => ({
          prototype,
          targetRoute,
          module,
          routeKey,
          status,
          risk,
        }),
      ),
    ).toEqual(EXPECTED_INITIAL_MIGRATION_INVENTORY);
  });

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
    expect(OPS_UI_MIGRATION_ROUTES.map((entry) => entry.targetRoute)).toEqual(
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
    expect(sensitive.every((entry) => isNotMigrated(entry.status))).toBe(true);
  });

  it("does not checklist-approve money or evidence surfaces by default", () => {
    const sensitive: readonly OpsUiMigrationRoute[] =
      OPS_UI_MIGRATION_ROUTES.filter(
        (entry) => entry.risk === "money-or-evidence",
      );

    expect(sensitive.length).toBeGreaterThan(0);
    expect(
      sensitive.every((entry) => entry.hasSensitiveActionChecklist !== true),
    ).toBe(true);
  });
});
