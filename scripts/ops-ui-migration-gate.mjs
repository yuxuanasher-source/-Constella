import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_AUDIT_PATH = path.join(
  ".superpowers",
  "ops-ui-migration",
  "migration-audit.json",
);

const BLOCKING_STATUSES = new Set(["ready-to-switch", "migrated"]);

export function loadAuditReport({
  auditPath = DEFAULT_AUDIT_PATH,
  readText = (file) => fs.readFileSync(file, "utf8"),
} = {}) {
  let rawText;
  try {
    rawText = readText(auditPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Missing ops UI migration audit report at ${auditPath}. Run pnpm ops-ui:migration:audit first.`,
      );
    }

    throw error;
  }

  let audit;
  try {
    audit = JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `Could not parse ops UI migration audit report at ${auditPath}: ${error.message}`,
    );
  }

  if (!audit || !Array.isArray(audit.routes)) {
    throw new Error(
      `Invalid ops UI migration audit report at ${auditPath}: expected a routes array.`,
    );
  }

  return audit;
}

export function evaluateRouteGate(routeAudit) {
  const targetRoute = routeAudit.targetRoute ?? "(unknown route)";
  const status = routeAudit.status ?? "(missing status)";
  const failures = [];
  const notes = [];
  const isBlocking = BLOCKING_STATUSES.has(status);

  if (!isBlocking) {
    return {
      targetRoute,
      status,
      risk: routeAudit.risk ?? "unknown",
      blocking: false,
      gateStatus: status === "shell-route" ? "not-ready" : "skipped",
      passed: true,
      failures,
      notes,
    };
  }

  if (routeAudit.hasPage !== true) {
    failures.push({
      code: "missing-page",
      message: "hasPage must be true.",
    });
  }

  if (routeAudit.hasShellRoute !== true) {
    failures.push({
      code: "missing-shell-route",
      message: "hasShellRoute must be true.",
    });
  }

  if (!Array.isArray(routeAudit.requiredTests)) {
    failures.push({
      code: "required-tests-evidence",
      message: "requiredTests audit evidence must be present as an array.",
    });
  } else if (routeAudit.requiredTests.length === 0) {
    failures.push({
      code: "required-tests-empty",
      message:
        "Routes marked ready-to-switch or migrated must declare at least one required test.",
    });
  }

  if (!Array.isArray(routeAudit.missingTests)) {
    failures.push({
      code: "missing-tests-evidence",
      message: "missingTests audit evidence must be present as an array.",
    });
  } else if (routeAudit.missingTests.length > 0) {
    failures.push({
      code: "missing-tests",
      message: "missingTests must be empty.",
      evidence: routeAudit.missingTests,
    });
  }

  if (routeAudit.usesOpsReference === true) {
    failures.push({
      code: "uses-ops-reference",
      message:
        "Routes marked ready-to-switch or migrated must not still import ops-reference.",
    });
  } else if (routeAudit.usesOpsReference !== false) {
    failures.push({
      code: "uses-ops-reference-evidence",
      message:
        "usesOpsReference audit evidence must be present and explicitly false.",
    });
  }

  if (
    routeAudit.risk === "money-or-evidence" &&
    routeAudit.hasSensitiveActionChecklist !== true
  ) {
    failures.push({
      code: "sensitive-action-checklist-evidence",
      message:
        "Money or evidence routes marked ready-to-switch or migrated must include explicit sensitive-action checklist evidence.",
    });
  }

  evaluateRouteMapEvidence(routeAudit, failures);

  const passed = failures.length === 0;
  return {
    targetRoute,
    status,
    risk: routeAudit.risk ?? "unknown",
    blocking: true,
    gateStatus: passed ? "passed" : "failed",
    passed,
    failures,
    notes,
  };
}

export function evaluateMigrationGate(audit) {
  const routes = Array.from(audit.routes ?? []).map(evaluateRouteGate);
  const blockingRouteCount = routes.filter((route) => route.blocking).length;
  const failedRouteCount = routes.filter((route) => !route.passed).length;

  return {
    generatedAt: audit.generatedAt,
    passed: failedRouteCount === 0,
    routeCount: routes.length,
    blockingRouteCount,
    failedRouteCount,
    routes,
  };
}

export function formatGateReport(result) {
  const lines = [
    "# Ops UI Migration Readiness Gate",
    "",
    `Result: ${result.passed ? "PASS" : "FAIL"}`,
    `Routes: ${result.routeCount}`,
    `Blocking routes: ${result.blockingRouteCount}`,
    `Failed blocking routes: ${result.failedRouteCount}`,
  ];

  if (result.generatedAt) {
    lines.push(`Audit generated at: ${result.generatedAt}`);
  }

  const failures = result.routes.filter((route) => !route.passed);
  if (failures.length > 0) {
    lines.push("", "## Blocking Failures");
    for (const route of failures) {
      lines.push(`- ${route.targetRoute} (${route.status}, ${route.risk})`);
      for (const failure of route.failures) {
        lines.push(`  - ${formatFailure(failure)}`);
      }
    }
  }

  const passedBlocking = result.routes.filter(
    (route) => route.blocking && route.passed,
  );
  if (passedBlocking.length > 0) {
    lines.push("", "## Passed Blocking Routes");
    for (const route of passedBlocking) {
      lines.push(`- ${route.targetRoute} (${route.status})`);
    }
  }

  const skipped = result.routes.filter((route) => !route.blocking);
  if (skipped.length > 0) {
    lines.push("", "## Skipped / not ready");
    for (const route of skipped) {
      lines.push(
        `- ${route.targetRoute} (${route.status}, ${route.risk}): ${route.gateStatus}`,
      );
    }
  }

  const notes = result.routes.flatMap((route) =>
    route.notes.map((note) => `${route.targetRoute}: ${note}`),
  );
  if (notes.length > 0) {
    lines.push("", "## Notes", ...notes.map((note) => `- ${note}`));
  }

  return `${lines.join("\n")}\n`;
}

function evaluateRouteMapEvidence(routeAudit, failures) {
  const routeMapEvidence = getRouteMapEvidence(routeAudit);
  if (!routeMapEvidence) {
    failures.push({
      code: "route-map-evidence",
      message:
        "Routes marked ready-to-switch or migrated must include route-map alignment evidence in the audit report.",
    });
    return;
  }

  if (
    (typeof routeAudit.module === "string" &&
      typeof routeMapEvidence.module !== "string") ||
    (typeof routeAudit.routeKey === "string" &&
      typeof routeMapEvidence.routeKey !== "string")
  ) {
    failures.push({
      code: "route-map-evidence-incomplete",
      message:
        "Route-map evidence must include string module and routeKey fields when the registry route declares them.",
    });
    return;
  }

  if (
    routeMapEvidence.module !== undefined &&
    routeAudit.module !== undefined &&
    routeMapEvidence.module !== routeAudit.module
  ) {
    failures.push({
      code: "route-map-module-mismatch",
      message: "Audit route-map module evidence must match the registry module.",
      evidence: {
        registryModule: routeAudit.module,
        routeMapModule: routeMapEvidence.module,
      },
    });
  }

  if (
    routeMapEvidence.routeKey !== undefined &&
    routeAudit.routeKey !== undefined &&
    routeMapEvidence.routeKey !== routeAudit.routeKey
  ) {
    failures.push({
      code: "route-map-route-key-mismatch",
      message:
        "Audit route-map routeKey evidence must match the registry routeKey.",
      evidence: {
        registryRouteKey: routeAudit.routeKey,
        routeMapRouteKey: routeMapEvidence.routeKey,
      },
    });
  }
}

function getRouteMapEvidence(routeAudit) {
  if (routeAudit.routeMap && typeof routeAudit.routeMap === "object") {
    return routeAudit.routeMap;
  }

  if (
    "routeMapModule" in routeAudit ||
    "routeMapRouteKey" in routeAudit ||
    "mappedModule" in routeAudit ||
    "mappedRouteKey" in routeAudit
  ) {
    return {
      module: routeAudit.routeMapModule ?? routeAudit.mappedModule,
      routeKey: routeAudit.routeMapRouteKey ?? routeAudit.mappedRouteKey,
    };
  }

  return null;
}

function formatFailure(failure) {
  if (Array.isArray(failure.evidence)) {
    return `${failure.code}: ${failure.evidence.join(", ")}`;
  }

  if (failure.evidence && typeof failure.evidence === "object") {
    return `${failure.code}: ${JSON.stringify(failure.evidence)}`;
  }

  return failure.code;
}

async function runCli() {
  const audit = loadAuditReport();
  const result = evaluateMigrationGate(audit);
  console.log(formatGateReport(result));
  process.exitCode = result.passed ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
