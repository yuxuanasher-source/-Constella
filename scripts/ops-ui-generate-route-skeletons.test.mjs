import { describe, expect, it } from "vitest";

import {
  buildRouteSkeleton,
  findMigrationRoute,
  parseSkeletonArgs,
  safeGeneratedRoutePath,
  writeRouteSkeleton,
} from "./ops-ui-generate-route-skeletons.mjs";

const aiRoute = {
  prototype: "ai-workbench.html",
  targetRoute: "/console/ai",
  module: "m10",
  routeKey: "warroom",
  status: "legacy-stub",
  risk: "high",
  dataDomains: ["features/ai", "features/war-room", "/api/ai/**"],
  requiredTests: ["components/dashboard/overview-board.test.jsx"],
};

describe("ops ui route skeleton generator", () => {
  it("requires an explicit console route argument", () => {
    expect(() => parseSkeletonArgs([])).toThrow(
      "Missing required --route=/console/...",
    );

    expect(parseSkeletonArgs(["--route=/console/ai"])).toEqual({
      route: "/console/ai",
    });
    expect(parseSkeletonArgs(["node", "script", "--route=/console/ai"])).toEqual(
      {
        route: "/console/ai",
      },
    );
  });

  it("rejects unsafe or non-console route arguments", () => {
    expect(() => parseSkeletonArgs(["--route=/settings"])).toThrow(
      "Route must start with /console",
    );
    expect(() =>
      parseSkeletonArgs(["--route=/console/projects\\..\\settings"]),
    ).toThrow("Route must not contain backslashes");
    expect(() => parseSkeletonArgs(["--route=/console/../settings"])).toThrow(
      "Route must not contain . or .. segments",
    );
  });

  it("finds registry entries by target route", () => {
    expect(findMigrationRoute([aiRoute], "/console/ai")).toBe(aiRoute);
    expect(findMigrationRoute([aiRoute], "/console/missing")).toBeUndefined();
  });

  it("writes generated proposals under the local migration folder", () => {
    expect(safeGeneratedRoutePath("/console/ai")).toBe(
      ".superpowers/ops-ui-migration/generated/console/ai/page.tsx",
    );
  });

  it("keeps safe nested dynamic route paths inside generated output", () => {
    expect(safeGeneratedRoutePath("/console/projects/[projectId]")).toBe(
      ".superpowers/ops-ui-migration/generated/console/projects/[projectId]/page.tsx",
    );
  });

  it("creates a clearly marked shell route proposal with metadata", () => {
    const output = buildRouteSkeleton(aiRoute);

    expect(output).toContain(
      'import { OpsShell } from "@/components/layouts/ops-shell";',
    );
    expect(output).toContain("GENERATED REVIEW PROPOSAL");
    expect(output).toContain("Prototype: ai-workbench.html");
    expect(output).toContain("Target route: /console/ai");
    expect(output).toContain("Module: m10");
    expect(output).toContain("Route key: warroom");
    expect(output).toContain("Status: legacy-stub");
    expect(output).toContain("Risk: high");
    expect(output).toContain("Data domains: features/ai, features/war-room, /api/ai/**");
    expect(output).toContain(
      "Required tests: components/dashboard/overview-board.test.jsx",
    );
    expect(output).toContain("This generated file is a dry-run review proposal");
    expect(output).not.toContain("ops-reference");
  });

  it("prevents overwriting an existing proposal by default", () => {
    expect(() =>
      writeRouteSkeleton({
        route: aiRoute,
        exists: () => true,
        writeText: () => {
          throw new Error("writeText should not be called");
        },
      }),
    ).toThrow(
      "already exists; remove it before generating a new skeleton proposal",
    );
  });

  it("writes skeleton text and returns the generated path", () => {
    const writes = [];
    const generatedPath = writeRouteSkeleton({
      route: aiRoute,
      exists: () => false,
      writeText: (file, text) => writes.push({ file, text }),
    });

    expect(generatedPath).toBe(
      ".superpowers/ops-ui-migration/generated/console/ai/page.tsx",
    );
    expect(writes).toEqual([
      {
        file: generatedPath,
        text: expect.stringContaining("GeneratedOpsConsoleAiPage"),
      },
    ]);
  });

  it("fails closed for routes already marked migrated", () => {
    expect(() =>
      writeRouteSkeleton({
        route: { ...aiRoute, status: "migrated" },
        exists: () => false,
        writeText: () => {},
      }),
    ).toThrow("already marked migrated");
  });
});
