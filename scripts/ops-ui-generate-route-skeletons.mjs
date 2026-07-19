import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadRegistryRoutes,
  normalizeRouteFilePath,
} from "./ops-ui-migration-audit.mjs";

const DEFAULT_OUTPUT_ROOT = ".superpowers/ops-ui-migration/generated";
const APP_ROUTE_ROOT = "app/(ops)";

export function parseSkeletonArgs(argv) {
  const routeArg = argv.find((arg) => arg.startsWith("--route="));
  if (!routeArg) {
    throw new Error("Missing required --route=/console/...");
  }

  const route = routeArg.slice("--route=".length);
  if (!route.startsWith("/console")) {
    throw new Error(`Route must start with /console: ${route}`);
  }

  normalizeRouteFilePath(route);

  return { route };
}

export function findMigrationRoute(routes, targetRoute) {
  return routes.find((route) => route.targetRoute === targetRoute);
}

export function safeGeneratedRoutePath(route, outputRoot = DEFAULT_OUTPUT_ROOT) {
  const routePageFile = normalizeRouteFilePath(route);
  const routeProposalPath = path.posix.relative(APP_ROUTE_ROOT, routePageFile);

  if (
    routeProposalPath === "" ||
    routeProposalPath.startsWith("../") ||
    routeProposalPath === ".." ||
    path.posix.isAbsolute(routeProposalPath)
  ) {
    throw new Error(`Route must stay under ${APP_ROUTE_ROOT}: ${route}`);
  }

  return path.posix.join(outputRoot, routeProposalPath);
}

export function buildRouteSkeleton(route) {
  const title = buildRouteTitle(route);
  const componentName = buildComponentName(route.targetRoute);
  const metadata = [
    "GENERATED REVIEW PROPOSAL - DO NOT SHIP WITHOUT HUMAN IMPLEMENTATION",
    `Prototype: ${route.prototype}`,
    `Target route: ${route.targetRoute}`,
    `Module: ${route.module ?? "none"}`,
    `Route key: ${route.routeKey}`,
    `Status: ${route.status}`,
    `Risk: ${route.risk}`,
    `Data domains: ${formatList(route.dataDomains)}`,
    `Required tests: ${formatList(route.requiredTests)}`,
  ];

  return `import { OpsShell } from "@/components/layouts/ops-shell";

/*
${metadata.map((line) => ` * ${line}`).join("\n")}
 */
export default function ${componentName}() {
  return (
    <OpsShell context={null} unreadCount={0} activeHref="${route.targetRoute}">
      <section className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--ink-300)]">
            Generated migration proposal
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--ink-900)]">
            ${escapeJsxText(title)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--ink-500)]">
            This generated file is a dry-run review proposal for ${escapeJsxText(
              route.targetRoute,
            )}. Replace this placeholder with real route implementation before
            any production switch.
          </p>
        </div>

        <div className="rounded-md border border-[var(--line)] bg-white p-4 text-sm text-[var(--ink-500)]">
          <p>Prototype: ${escapeJsxText(route.prototype)}</p>
          <p>Module: ${escapeJsxText(route.module ?? "none")}</p>
          <p>Route key: ${escapeJsxText(route.routeKey)}</p>
          <p>Risk: ${escapeJsxText(route.risk)}</p>
          <p>Data domains: ${escapeJsxText(formatList(route.dataDomains))}</p>
          <p>Required tests: ${escapeJsxText(formatList(route.requiredTests))}</p>
        </div>

        <div className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-4 text-sm text-[var(--ink-500)]">
          No mock data, business mutations, money changes, evidence edits, API
          contract changes, RBAC changes, or production UI route changes are
          performed by this proposal.
        </div>
      </section>
    </OpsShell>
  );
}
`;
}

export function writeRouteSkeleton({
  route,
  outputRoot = DEFAULT_OUTPUT_ROOT,
  exists,
  writeText,
}) {
  if (route.status === "migrated") {
    throw new Error(
      `${route.targetRoute} is already marked migrated; skeleton generation is disabled for migrated routes`,
    );
  }

  const generatedPath = safeGeneratedRoutePath(route.targetRoute, outputRoot);
  if (exists(generatedPath)) {
    throw new Error(
      `${generatedPath} already exists; remove it before generating a new skeleton proposal`,
    );
  }

  writeText(generatedPath, buildRouteSkeleton(route));
  return generatedPath;
}

function buildRouteTitle(route) {
  const routeLabel = route.targetRoute
    .replace(/^\/console\/?/, "")
    .replace(/\//g, " / ");

  if (!routeLabel) {
    return "Console";
  }

  return `${toTitleCase(routeLabel)} Route Proposal`;
}

function buildComponentName(route) {
  const parts = route
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => part.replace(/^\[(.+)\]$/, "$1"))
    .map(toPascalCase)
    .filter(Boolean);

  return `GeneratedOps${parts.join("")}Page`;
}

function toTitleCase(value) {
  return value
    .split(/[\s/[\]-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function toPascalCase(value) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function formatList(value) {
  return Array.from(value ?? []).join(", ") || "none";
}

function escapeJsxText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

async function runCli() {
  const { route: targetRoute } = parseSkeletonArgs(process.argv);
  const routes = await loadRegistryRoutes();
  const route = findMigrationRoute(routes, targetRoute);

  if (!route) {
    throw new Error(`Unknown migration route: ${targetRoute}`);
  }

  const generatedPath = writeRouteSkeleton({
    route,
    exists: (file) => fs.existsSync(path.join(process.cwd(), file)),
    writeText: (file, text) => {
      const absolutePath = path.join(process.cwd(), file);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, text, "utf8");
    },
  });

  console.log(generatedPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
