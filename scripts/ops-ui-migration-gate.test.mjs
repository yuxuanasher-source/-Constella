import { describe, expect, it } from "vitest";

import {
  evaluateMigrationGate,
  evaluateRouteGate,
  formatGateReport,
  loadAuditReport,
} from "./ops-ui-migration-gate.mjs";

const baseRoute = {
  prototype: "projects.html",
  targetRoute: "/console/projects",
  module: "m1",
  routeKey: "projects",
  status: "legacy-stub",
  risk: "high",
  dataDomains: ["features/projects"],
  requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
  pageFile: "app/(ops)/console/projects/page.tsx",
  hasPage: false,
  usesOpsReference: false,
  hasShellRoute: false,
  missingTests: [],
  routeMap: {
    module: "m1",
    routeKey: "projects",
    href: "/console/projects",
  },
  nextAction: "generate-route-skeleton",
};

describe("ops ui migration gate", () => {
  it("tells operators to run the audit first when the audit file is missing", () => {
    expect(() =>
      loadAuditReport({
        auditPath: ".superpowers/ops-ui-migration/migration-audit.json",
        readText: () => {
          const error = new Error("missing");
          error.code = "ENOENT";
          throw error;
        },
      }),
    ).toThrow("Run pnpm ops-ui:migration:audit first");
  });

  it("passes when there are no blocking routes yet", () => {
    const result = evaluateMigrationGate({
      generatedAt: "2026-07-19T16:24:57.837Z",
      routes: [
        baseRoute,
        {
          ...baseRoute,
          targetRoute: "/console",
          status: "ops-reference-route",
          hasPage: true,
          usesOpsReference: true,
          nextAction: "extract-shell-route",
        },
        {
          ...baseRoute,
          targetRoute: "/console/ai",
          status: "shell-route",
          hasPage: true,
          hasShellRoute: true,
          nextAction: "gate-route-switch",
        },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.blockingRouteCount).toBe(0);
    expect(result.failedRouteCount).toBe(0);
    expect(result.routes.map((route) => route.gateStatus)).toEqual([
      "skipped",
      "skipped",
      "not-ready",
    ]);
  });

  it("fails a ready route when the page is missing", () => {
    expect(
      evaluateRouteGate({
        ...baseRoute,
        status: "ready-to-switch",
      }),
    ).toEqual(
      expect.objectContaining({
        gateStatus: "failed",
        passed: false,
        failures: [
          expect.objectContaining({
            code: "missing-page",
          }),
          expect.objectContaining({
            code: "missing-shell-route",
          }),
        ],
      }),
    );
  });

  it("fails a ready route when it still imports ops-reference", () => {
    const result = evaluateRouteGate({
      ...baseRoute,
      status: "ready-to-switch",
      hasPage: true,
      hasShellRoute: true,
      usesOpsReference: true,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({
        code: "uses-ops-reference",
      }),
    ]);
  });

  it("fails a migrated route when required tests are missing", () => {
    const result = evaluateRouteGate({
      ...baseRoute,
      status: "migrated",
      hasPage: true,
      hasShellRoute: true,
      missingTests: ["app/(ops)/console/projects/page.test.tsx"],
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({
        code: "missing-tests",
        evidence: ["app/(ops)/console/projects/page.test.tsx"],
      }),
    ]);
  });

  it("fails a blocking route when missing test evidence is absent", () => {
    const { missingTests, ...routeWithoutMissingTestsEvidence } = baseRoute;

    const result = evaluateRouteGate({
      ...routeWithoutMissingTestsEvidence,
      status: "ready-to-switch",
      hasPage: true,
      hasShellRoute: true,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({
        code: "missing-tests-evidence",
      }),
    ]);
  });

  it.each(["ready-to-switch", "migrated"])(
    "fails a %s route when required test evidence is absent",
    (status) => {
      const { requiredTests, ...routeWithoutRequiredTestsEvidence } = baseRoute;

      const result = evaluateRouteGate({
        ...routeWithoutRequiredTestsEvidence,
        status,
        hasPage: true,
        hasShellRoute: true,
        missingTests: [],
        usesOpsReference: false,
      });

      expect(result.passed).toBe(false);
      expect(result.failures).toEqual([
        expect.objectContaining({
          code: "required-tests-evidence",
        }),
      ]);
    },
  );

  it.each(["ready-to-switch", "migrated"])(
    "fails a %s route when required tests are empty",
    (status) => {
      const result = evaluateRouteGate({
        ...baseRoute,
        status,
        hasPage: true,
        hasShellRoute: true,
        requiredTests: [],
        missingTests: [],
        usesOpsReference: false,
      });

      expect(result.passed).toBe(false);
      expect(result.failures).toEqual([
        expect.objectContaining({
          code: "required-tests-empty",
        }),
      ]);
    },
  );

  it.each([
    ["ready-to-switch", "missing", undefined],
    ["ready-to-switch", "non-boolean", "no"],
    ["migrated", "missing", undefined],
    ["migrated", "non-boolean", "no"],
  ])(
    "fails a %s route when usesOpsReference evidence is %s",
    (status, _name, value) => {
      const route =
        value === undefined
          ? (() => {
              const {
                usesOpsReference,
                ...routeWithoutOpsReferenceEvidence
              } = baseRoute;
              return routeWithoutOpsReferenceEvidence;
            })()
          : { ...baseRoute, usesOpsReference: value };

      const result = evaluateRouteGate({
        ...route,
        status,
        hasPage: true,
        hasShellRoute: true,
        requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
        missingTests: [],
      });

      expect(result.passed).toBe(false);
      expect(result.failures).toEqual([
        expect.objectContaining({
          code: "uses-ops-reference-evidence",
        }),
      ]);
    },
  );

  it("passes a blocking route when all required evidence is present", () => {
    const result = evaluateRouteGate({
      ...baseRoute,
      status: "migrated",
      hasPage: true,
      hasShellRoute: true,
      requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
      missingTests: [],
      usesOpsReference: false,
    });

    expect(result).toEqual(
      expect.objectContaining({
        gateStatus: "passed",
        passed: true,
        failures: [],
      }),
    );
  });

  it("does not bypass money or evidence routes", () => {
    const result = evaluateRouteGate({
      ...baseRoute,
      targetRoute: "/console/settlements",
      status: "ready-to-switch",
      risk: "money-or-evidence",
      hasPage: true,
      hasShellRoute: false,
      missingTests: [],
      hasSensitiveActionChecklist: true,
      routeMap: {
        ...baseRoute.routeMap,
        href: "/console/settlements",
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({
        code: "missing-shell-route",
      }),
    ]);
  });

  it.each([
    ["missing", undefined],
    ["false", false],
  ])(
    "fails a money or evidence route when sensitive checklist evidence is %s",
    (_name, value) => {
      const route =
        value === undefined
          ? baseRoute
          : { ...baseRoute, hasSensitiveActionChecklist: value };

      const result = evaluateRouteGate({
        ...route,
        targetRoute: "/console/settlements",
        status: "ready-to-switch",
        risk: "money-or-evidence",
        hasPage: true,
        hasShellRoute: true,
        requiredTests: ["features/settlements/settlement-service.test.ts"],
        missingTests: [],
        usesOpsReference: false,
        routeMap: {
          ...baseRoute.routeMap,
          href: "/console/settlements",
        },
      });

      expect(result.passed).toBe(false);
      expect(result.failures).toEqual([
        expect.objectContaining({
          code: "sensitive-action-checklist-evidence",
        }),
      ]);
    },
  );

  it("does not require sensitive checklist evidence for non-sensitive routes", () => {
    const result = evaluateRouteGate({
      ...baseRoute,
      status: "ready-to-switch",
      risk: "high",
      hasPage: true,
      hasShellRoute: true,
      requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
      missingTests: [],
      usesOpsReference: false,
    });

    expect(result).toEqual(
      expect.objectContaining({
        gateStatus: "passed",
        passed: true,
        failures: [],
      }),
    );
  });

  it.each([
    ["missing", undefined],
    ["null", null],
  ])("fails a blocking route when route-map evidence is %s", (_name, value) => {
    const route =
      value === undefined
        ? (() => {
            const { routeMap, ...routeWithoutRouteMapEvidence } = baseRoute;
            return routeWithoutRouteMapEvidence;
          })()
        : { ...baseRoute, routeMap: value };

    const result = evaluateRouteGate({
      ...route,
      status: "ready-to-switch",
      hasPage: true,
      hasShellRoute: true,
      requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
      missingTests: [],
      usesOpsReference: false,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({
        code: "route-map-evidence",
      }),
    ]);
    expect(result.notes).toEqual([]);
  });

  it.each([
    ["empty", {}],
    ["module-only", { module: "m1" }],
    ["route-key-only", { routeKey: "projects" }],
    ["href-missing", { module: "m1", routeKey: "projects" }],
  ])(
    "fails a blocking route when route-map evidence is incomplete: %s",
    (_name, routeMap) => {
      const result = evaluateRouteGate({
        ...baseRoute,
        status: "ready-to-switch",
        hasPage: true,
        hasShellRoute: true,
        requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
        missingTests: [],
        usesOpsReference: false,
        routeMap,
      });

      expect(result.passed).toBe(false);
      expect(result.failures).toEqual([
        expect.objectContaining({
          code: "route-map-evidence-incomplete",
        }),
      ]);
    },
  );

  it("fails when included route-map module evidence is misaligned", () => {
    const result = evaluateRouteGate({
      ...baseRoute,
      status: "ready-to-switch",
      hasPage: true,
      hasShellRoute: true,
      requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
      missingTests: [],
      usesOpsReference: false,
      routeMap: {
        module: "m2",
        routeKey: "projects",
        href: "/console/projects",
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({
        code: "route-map-module-mismatch",
      }),
    ]);
  });

  it("fails when included route-map routeKey evidence is misaligned", () => {
    const result = evaluateRouteGate({
      ...baseRoute,
      status: "ready-to-switch",
      hasPage: true,
      hasShellRoute: true,
      requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
      missingTests: [],
      usesOpsReference: false,
      routeMap: {
        module: "m1",
        routeKey: "settle",
        href: "/console/projects",
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({
        code: "route-map-route-key-mismatch",
      }),
    ]);
  });

  it("fails when included route-map href evidence is not the target route", () => {
    const result = evaluateRouteGate({
      ...baseRoute,
      status: "ready-to-switch",
      hasPage: true,
      hasShellRoute: true,
      requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
      missingTests: [],
      usesOpsReference: false,
      routeMap: {
        module: "m1",
        routeKey: "projects",
        href: "/console/other",
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({
        code: "route-map-href-mismatch",
      }),
    ]);
  });

  it("fails when a blocking route still points at a console stub href", () => {
    const result = evaluateRouteGate({
      ...baseRoute,
      targetRoute: "/console/stubs/m1",
      status: "ready-to-switch",
      hasPage: true,
      hasShellRoute: true,
      requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
      missingTests: [],
      usesOpsReference: false,
      routeMap: {
        module: "m1",
        routeKey: "projects",
        href: "/console/stubs/m1",
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({
        code: "route-map-stub-href",
      }),
    ]);
  });

  it("formats concise operator output with failures, skips, and notes", () => {
    const report = formatGateReport(
      evaluateMigrationGate({
        generatedAt: "2026-07-19T16:24:57.837Z",
        routes: [
          {
            ...baseRoute,
            status: "ready-to-switch",
            hasPage: true,
            hasShellRoute: false,
            requiredTests: ["app/(ops)/console/projects/page.test.tsx"],
            missingTests: [],
            usesOpsReference: false,
          },
          {
            ...baseRoute,
            targetRoute: "/console/settlements",
            status: "legacy-stub",
            risk: "money-or-evidence",
          },
        ],
      }),
    );

    expect(report).toContain("# Ops UI Migration Readiness Gate");
    expect(report).toContain("Result: FAIL");
    expect(report).toContain("/console/projects");
    expect(report).toContain("missing-shell-route");
    expect(report).toContain("Skipped / not ready");
    expect(report).toContain("/console/settlements");
    expect(report).not.toContain("Route-map alignment evidence");
  });
});
