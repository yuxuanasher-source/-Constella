import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const OPS_REFERENCE_IMPORT = "@/components/reference-ui/ops-reference";
const OPS_SHELL_IMPORT = "@/components/layouts/ops-shell";
const CONSOLE_ROUTE_ROOT = "app/(ops)/console";
const DEFAULT_OUTPUT_DIR = path.join(
  process.cwd(),
  ".superpowers",
  "ops-ui-migration",
);

export function normalizeRouteFilePath(route) {
  if (route !== "/console" && !route.startsWith("/console/")) {
    throw new Error(`Expected route to start with /console: ${route}`);
  }

  if (route.includes("\\")) {
    throw new Error(`Route must not contain backslashes: ${route}`);
  }

  const routeSegments = route
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/");
  if (routeSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Route must not contain . or .. segments: ${route}`);
  }

  const pageFile = path.posix.normalize(
    path.posix.join("app/(ops)", ...routeSegments, "page.tsx"),
  );
  const relativeToConsole = path.posix.relative(CONSOLE_ROUTE_ROOT, pageFile);
  if (
    relativeToConsole === "" ||
    relativeToConsole.startsWith("../") ||
    relativeToConsole === ".." ||
    path.posix.isAbsolute(relativeToConsole)
  ) {
    throw new Error(`Route must stay under ${CONSOLE_ROUTE_ROOT}: ${route}`);
  }

  return pageFile;
}

export async function loadRegistryRoutes({
  repoRoot = process.cwd(),
  readText = (file) => fs.readFileSync(file, "utf8"),
  registryPath = path.join(
    repoRoot,
    "features",
    "ops-ui-migration",
    "route-migration-registry.ts",
  ),
} = {}) {
  const routes = await loadTypescriptExport({
    repoRoot,
    readText,
    sourcePath: registryPath,
    exportName: "OPS_UI_MIGRATION_ROUTES",
  });

  if (!Array.isArray(routes)) {
    throw new Error("OPS_UI_MIGRATION_ROUTES must be an array");
  }

  return routes;
}

export async function loadModuleRoutes({
  repoRoot = process.cwd(),
  readText = (file) => fs.readFileSync(file, "utf8"),
  moduleRouteMapPath = path.join(
    repoRoot,
    "features",
    "ui-route-contracts",
    "module-route-map.ts",
  ),
} = {}) {
  const moduleRoutes = await loadTypescriptExport({
    repoRoot,
    readText,
    sourcePath: moduleRouteMapPath,
    exportName: "OPS_MODULE_ROUTES",
  });

  if (!Array.isArray(moduleRoutes)) {
    throw new Error("OPS_MODULE_ROUTES must be an array");
  }

  return moduleRoutes;
}

export function buildMigrationAudit({
  routes,
  moduleRoutes = [],
  exists,
  readText,
}) {
  const generatedAt = new Date().toISOString();

  return {
    generatedAt,
    routes: routes.map((route) => {
      const pageFile = normalizeRouteFilePath(route.targetRoute);
      const hasPage = exists(pageFile);
      const pageText = hasPage ? readText(pageFile) : "";
      const usesOpsReference = pageText.includes(OPS_REFERENCE_IMPORT);
      const requiredTests = Array.from(route.requiredTests ?? []);
      const missingTests = requiredTests.filter((testFile) => !exists(testFile));
      const hasShellRoute = pageText.includes(OPS_SHELL_IMPORT);

      return {
        ...route,
        requiredTests,
        pageFile,
        hasPage,
        usesOpsReference,
        hasShellRoute,
        missingTests,
        routeMap: getRouteMapEvidence(route, moduleRoutes),
        hasSensitiveActionChecklist:
          route.hasSensitiveActionChecklist === true,
        nextAction: getNextAction({
          hasPage,
          usesOpsReference,
          hasShellRoute,
          missingTests,
        }),
      };
    }),
  };
}

async function loadTypescriptExport({
  repoRoot,
  readText,
  sourcePath,
  exportName,
}) {
  const typescriptModule = await import("typescript");
  const ts = typescriptModule.default ?? typescriptModule;
  const resolvedSourcePath = path.isAbsolute(sourcePath)
    ? sourcePath
    : path.join(repoRoot, sourcePath);
  const source = readText(resolvedSourcePath);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exports = {};
  const module = { exports };

  vm.runInNewContext(
    transpiled.outputText,
    {
      exports,
      module,
    },
    {
      filename: resolvedSourcePath,
      timeout: 1000,
    },
  );

  return module.exports[exportName];
}

function getRouteMapEvidence(route, moduleRoutes) {
  if (!route.module) {
    return null;
  }

  const moduleRoute = moduleRoutes.find((item) => item.module === route.module);
  if (!moduleRoute) {
    return null;
  }

  return {
    module: moduleRoute.module,
    routeKey: moduleRoute.routeKey,
    href: moduleRoute.href,
    status: moduleRoute.status,
  };
}

export function writeAuditReports(audit, outputDir = DEFAULT_OUTPUT_DIR) {
  fs.mkdirSync(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, "migration-audit.json");
  const markdownPath = path.join(outputDir, "migration-audit.md");

  fs.writeFileSync(jsonPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdownReport(audit), "utf8");

  return { jsonPath, markdownPath };
}

function getNextAction({
  hasPage,
  usesOpsReference,
  hasShellRoute,
  missingTests,
}) {
  if (!hasPage) {
    return "generate-route-skeleton";
  }

  if (usesOpsReference) {
    return "extract-shell-route";
  }

  if (missingTests.length > 0) {
    return "add-route-tests";
  }

  if (hasShellRoute) {
    return "gate-route-switch";
  }

  return "inspect-manually";
}

function renderMarkdownReport(audit) {
  const lines = [
    "# Ops UI Migration Audit",
    "",
    `Generated at: ${audit.generatedAt}`,
    "",
    "| Route | Status | Page | Uses ops-reference | Missing tests | Next action |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const route of audit.routes) {
    lines.push(
      [
        route.targetRoute,
        route.status,
        route.hasPage ? route.pageFile : "missing",
        route.usesOpsReference ? "yes" : "no",
        route.missingTests.length > 0 ? route.missingTests.join(", ") : "none",
        route.nextAction,
      ]
        .map(escapeMarkdownCell)
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }

  return `${lines.join("\n")}\n`;
}

function escapeMarkdownCell(value) {
  return String(value).replace(/\|/g, "\\|");
}

async function runCli() {
  const repoRoot = process.cwd();
  const [routes, moduleRoutes] = await Promise.all([
    loadRegistryRoutes({ repoRoot }),
    loadModuleRoutes({ repoRoot }),
  ]);

  const audit = buildMigrationAudit({
    routes,
    moduleRoutes,
    exists: (file) => fs.existsSync(path.join(repoRoot, file)),
    readText: (file) => fs.readFileSync(path.join(repoRoot, file), "utf8"),
  });
  const { jsonPath, markdownPath } = writeAuditReports(audit);

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
