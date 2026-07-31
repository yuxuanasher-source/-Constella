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
  const minimatch = resolvePackageFrom(
    readdirGlob.packageJsonPath,
    "minimatch",
  );
  const braceExpansion = resolvePackageFrom(
    minimatch.packageJsonPath,
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
    expect(minimatch.version).toBe("9.0.9");
    expect(braceExpansion.version).toBe("5.0.8");
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
