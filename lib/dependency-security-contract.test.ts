import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, parse, resolve } from "node:path";

import { describe, expect, it } from "vitest";

type PackageManifest = {
  name?: string;
  version: string;
};

type ResolvedPackage = {
  packageJsonPath: string;
  version: string;
};

function readProjectFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function readManifest(packageJsonPath: string) {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageManifest;
}

function findPackageJson(entrypoint: string, packageName: string) {
  let directory = dirname(entrypoint);
  const root = parse(directory).root;

  while (directory !== root) {
    const candidate = resolve(directory, "package.json");
    if (existsSync(candidate)) {
      const manifest = readManifest(candidate);
      if (manifest.name === packageName) {
        return candidate;
      }
    }
    directory = dirname(directory);
  }

  throw new Error(`Unable to find package.json for ${packageName}`);
}

function resolvePackageFrom(
  fromPackageJsonPath: string,
  dependency: string,
): ResolvedPackage {
  const requireFromPackage = createRequire(fromPackageJsonPath);
  let packageJsonPath: string;

  try {
    packageJsonPath = requireFromPackage.resolve(`${dependency}/package.json`);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED"
    ) {
      throw error;
    }
    packageJsonPath = findPackageJson(
      requireFromPackage.resolve(dependency),
      dependency,
    );
  }

  return {
    packageJsonPath,
    version: readManifest(packageJsonPath).version,
  };
}

describe("production dependency security contract", () => {
  const projectPackageJsonPath = resolve(process.cwd(), "package.json");
  const workspace = readProjectFile("pnpm-workspace.yaml");
  const lockfile = readProjectFile("pnpm-lock.yaml");
  const nextConfig = readProjectFile("next.config.ts");
  const patchPath = resolve(
    process.cwd(),
    "patches/archiver-utils@5.0.2.patch",
  );

  const next = resolvePackageFrom(projectPackageJsonPath, "next");
  const playwright = resolvePackageFrom(
    projectPackageJsonPath,
    "@playwright/test",
  );
  const postcss = resolvePackageFrom(next.packageJsonPath, "postcss");
  const sharp = resolvePackageFrom(next.packageJsonPath, "sharp");

  const exceljs = resolvePackageFrom(projectPackageJsonPath, "exceljs");
  const archiver = resolvePackageFrom(exceljs.packageJsonPath, "archiver");
  const unzipper = resolvePackageFrom(exceljs.packageJsonPath, "unzipper");
  const uuid = resolvePackageFrom(exceljs.packageJsonPath, "uuid");
  const archiverUtils = resolvePackageFrom(
    archiver.packageJsonPath,
    "archiver-utils",
  );
  const readdirGlob = resolvePackageFrom(
    archiver.packageJsonPath,
    "readdir-glob",
  );
  const readdirMinimatch = resolvePackageFrom(
    readdirGlob.packageJsonPath,
    "minimatch",
  );
  const readdirBraceExpansion = resolvePackageFrom(
    readdirMinimatch.packageJsonPath,
    "brace-expansion",
  );
  const archiverGlob = resolvePackageFrom(
    archiverUtils.packageJsonPath,
    "glob",
  );
  const globMinimatch = resolvePackageFrom(
    archiverGlob.packageJsonPath,
    "minimatch",
  );
  const globBraceExpansion = resolvePackageFrom(
    globMinimatch.packageJsonPath,
    "brace-expansion",
  );

  const jsdom = resolvePackageFrom(projectPackageJsonPath, "jsdom");
  const undici = resolvePackageFrom(jsdom.packageJsonPath, "undici");
  const eslint = resolvePackageFrom(projectPackageJsonPath, "eslint");
  const eslintRc = resolvePackageFrom(eslint.packageJsonPath, "@eslint/eslintrc");
  const jsYaml = resolvePackageFrom(eslintRc.packageJsonPath, "js-yaml");
  const eslintMinimatch = resolvePackageFrom(
    eslint.packageJsonPath,
    "minimatch",
  );
  const legacyBraceExpansion = resolvePackageFrom(
    eslintMinimatch.packageJsonPath,
    "brace-expansion",
  );

  it("resolves the patched framework dependency releases", () => {
    expect(playwright.version).toBe("1.55.1");
    expect(postcss.version).toBe("8.5.18");
    expect(sharp.version).toBe("0.35.0");
  });

  it("resolves the hardened ExcelJS dependency graph", () => {
    expect(exceljs.version).toBe("4.4.0");
    expect(archiver.version).toBe("7.0.1");
    expect(unzipper.version).toBe("0.12.5");
    expect(uuid.version).toBe("11.1.1");
    expect(archiverUtils.version).toBe("5.0.2");
    expect(readdirGlob.version).toBe("1.1.3");
    expect(readdirMinimatch.version).toBe("10.2.5");
    expect(readdirBraceExpansion.version).toBe("5.0.8");
    expect(archiverGlob.version).toBe("10.5.0");
    expect(globMinimatch.version).toBe("10.2.5");
    expect(globBraceExpansion.version).toBe("5.0.8");
  });

  it("resolves the patched development dependency releases", () => {
    expect(jsdom.version).toBe("29.1.1");
    expect(undici.version).toBe("7.28.0");
    expect(eslintRc.version).toBe("3.3.5");
    expect(jsYaml.version).toBe("4.3.0");
  });

  it("limits brace expansion through the CJS maintenance backport", () => {
    expect(eslintMinimatch.version).toBe("3.1.5");
    expect(legacyBraceExpansion.version).toBe("1.1.18");

    const source = readFileSync(
      resolve(dirname(legacyBraceExpansion.packageJsonPath), "index.js"),
      "utf8",
    );
    expect(source).toContain("EXPANSION_MAX_LENGTH");
    expect(source).toContain("CVE-2026-14257");

    const requireFromLegacyBrace = createRequire(
      legacyBraceExpansion.packageJsonPath,
    );
    const expand = requireFromLegacyBrace("brace-expansion") as (
      pattern: string,
    ) => string[];
    const expansions = expand("{a,b}".repeat(1_500));
    const expandedLength = expansions.reduce(
      (length, expansion) => length + expansion.length,
      0,
    );
    expect(expansions.length).toBeLessThan(100_000);
    expect(expandedLength).toBeLessThanOrEqual(4_000_000);
  });

  it("locks brace expansion to the two reviewed patched releases", () => {
    const requireFromEslintRc = createRequire(eslintRc.packageJsonPath);
    const yaml = requireFromEslintRc("js-yaml") as {
      load(source: string): { packages?: Record<string, unknown> };
    };
    const parsedLockfile = yaml.load(lockfile);
    const braceVersions = Object.keys(parsedLockfile.packages ?? {})
      .flatMap((key) => key.match(/^brace-expansion@(.+)$/)?.[1] ?? [])
      .sort();

    expect(braceVersions).toEqual(["1.1.18", "5.0.8"]);
  });

  it("ignores only the registry overmatch for the reviewed CJS backport", () => {
    const requireFromEslintRc = createRequire(eslintRc.packageJsonPath);
    const yaml = requireFromEslintRc("js-yaml") as {
      load(source: string): {
        auditConfig?: { ignoreGhsas?: string[] };
      };
    };
    const parsedWorkspace = yaml.load(workspace);

    expect(parsedWorkspace.auditConfig?.ignoreGhsas).toEqual([
      "GHSA-mh99-v99m-4gvg",
    ]);
    expect(workspace).toContain("brace-expansion@1.1.18");
    expect(workspace).toContain("EXPANSION_MAX_LENGTH");
  });

  it("loads Archiver utils from pnpm's patched package instance", () => {
    expect(workspace).toMatch(
      /^\s*archiver-utils@5\.0\.2:\s*patches\/archiver-utils@5\.0\.2\.patch\s*$/m,
    );
    expect(existsSync(patchPath)).toBe(true);

    const patch = readFileSync(patchPath, "utf8");
    expect(patch).toContain("source.pipe(passthrough);");
    expect(patch).toContain("return passthrough;");

    const installedSource = readFileSync(
      resolve(dirname(archiverUtils.packageJsonPath), "index.js"),
      "utf8",
    );
    expect(installedSource).toContain("source.pipe(passthrough);");
    expect(installedSource).toContain("return passthrough;");
  });

  it("does not force the ESM-only brace-expansion major globally", () => {
    expect(workspace).not.toMatch(/^\s*brace-expansion:\s*5\.0\.8\s*$/m);
  });

  it("externalizes Unzipper from the Next server bundle", () => {
    expect(nextConfig).toMatch(
      /serverExternalPackages:\s*\[\s*["']unzipper["']\s*\]/,
    );
  });
});
