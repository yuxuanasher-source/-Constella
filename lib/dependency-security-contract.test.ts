import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readProjectFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("production dependency security contract", () => {
  const packageJson = JSON.parse(readProjectFile("package.json")) as {
    devDependencies?: Record<string, string>;
  };
  const workspace = readProjectFile("pnpm-workspace.yaml");
  const lockfile = readProjectFile("pnpm-lock.yaml");
  const nextConfig = readProjectFile("next.config.ts");

  it("pins the patched Playwright release used by Next's optional peer", () => {
    expect(packageJson.devDependencies?.["@playwright/test"]).toBe("1.55.1");
    expect(lockfile).toContain("playwright@1.55.1");
    expect(lockfile).not.toContain("playwright@1.51.1");
  });

  it("overrides PostCSS to the patched release", () => {
    expect(workspace).toMatch(/^\s*postcss:\s*8\.5\.18\s*$/m);
    expect(lockfile).toContain("postcss@8.5.18");
    expect(lockfile).not.toContain("postcss@8.5.15");
  });

  it("overrides Sharp to the patched release used by image optimization", () => {
    expect(workspace).toMatch(/^\s*sharp:\s*0\.35\.0\s*$/m);
    expect(lockfile).toContain("sharp@0.35.0");
    expect(lockfile).not.toContain("sharp@0.34.5");
  });

  it("does not force the ESM-only brace-expansion major onto legacy CJS consumers", () => {
    expect(workspace).not.toMatch(/^\s*brace-expansion:\s*5\.0\.8\s*$/m);
  });

  it("scopes the Archiver upgrade to ExcelJS", () => {
    expect(workspace).toMatch(/^\s*['"]?exceljs>archiver['"]?:\s*8\.0\.0\s*$/m);
    expect(lockfile).toContain("archiver@8.0.0");
  });

  it("scopes the Unzipper upgrade to ExcelJS", () => {
    expect(workspace).toMatch(/^\s*['"]?exceljs>unzipper['"]?:\s*0\.12\.5\s*$/m);
    expect(lockfile).toContain("unzipper@0.12.5");
  });

  it("externalizes Unzipper from the Next server bundle", () => {
    expect(nextConfig).toMatch(
      /serverExternalPackages:\s*\[\s*["']unzipper["']\s*\]/,
    );
  });

  it("scopes the patched UUID major to ExcelJS", () => {
    expect(workspace).toMatch(/^\s*['"]?exceljs>uuid['"]?:\s*11\.1\.1\s*$/m);
    expect(lockfile).toContain("uuid@11.1.1");
  });
});
