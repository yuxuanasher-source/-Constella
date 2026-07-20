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
  readonly dataDomains: readonly string[];
  readonly requiredTests: readonly string[];
  hasSensitiveActionChecklist?: boolean;
};

export const OPS_UI_MIGRATION_ROUTES = [
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
    status: "shell-route",
    risk: "high",
    dataDomains: ["features/ai", "features/war-room", "/api/ai/**"],
    requiredTests: [
      "app/(ops)/console/ai/page.test.tsx",
      "components/console/ai-workbench.test.tsx",
      "components/dashboard/overview-board.test.jsx",
    ],
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
    module: "m10",
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
] as const satisfies readonly OpsUiMigrationRoute[];
