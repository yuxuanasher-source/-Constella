import fs from "node:fs";
import path from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PublishedOrganizationBrand } from "@/features/organizations/organization-brand";

import { OrganizationBrandTheme } from "./organization-brand-theme";

const BRAND: PublishedOrganizationBrand = {
  schemaVersion: 1,
  version: 8,
  logoText: "北辰",
  logoStoragePath: null,
  brandName: "北辰直播运营",
  brandTagline: "让每次交付都有依据",
  primaryColor: "#7A3E00",
  actionColor: "#663400",
  softColor: "#F0E7DE",
  publishedAt: "2026-08-01T00:00:00.000Z",
  semantic: {
    success: "#00B42A",
    warning: "#FF7D00",
    danger: "#F53F3F",
    info: "#165DFF",
  },
};

function extractFlatCssBlock(stylesheet: string, selector: string) {
  const selectorStart = stylesheet.indexOf(selector);
  if (selectorStart < 0) {
    throw new Error(`Missing CSS selector: ${selector}`);
  }

  const openingBrace = stylesheet.indexOf("{", selectorStart + selector.length);
  if (openingBrace < 0) {
    throw new Error(`Missing opening brace for CSS selector: ${selector}`);
  }
  if (stylesheet.slice(selectorStart, openingBrace).trim() !== selector) {
    throw new Error(`Unexpected CSS selector header: ${selector}`);
  }

  const closingBrace = stylesheet.indexOf("}", openingBrace + 1);
  if (closingBrace < 0) {
    throw new Error(`Missing closing brace for CSS selector: ${selector}`);
  }

  return stylesheet.slice(openingBrace + 1, closingBrace);
}

function readDeclarations(block: string) {
  return new Map(
    block
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separator = declaration.indexOf(":");
        return [
          declaration.slice(0, separator).trim(),
          declaration.slice(separator + 1).trim(),
        ] as const;
      }),
  );
}

function expectScopedConsoleTokens(stylesheet: string) {
  const scopedBlock = extractFlatCssBlock(
    stylesheet,
    ".organization-brand-theme",
  );
  const declarations = readDeclarations(scopedBlock);

  expect(declarations.get("--ops-primary")).toMatch(
    /^var\(--org-brand-action(?:,|\))/,
  );
  expect(declarations.get("--ops-primary-soft")).toMatch(
    /^var\(--org-brand-soft(?:,|\))/,
  );

  const fixedSemanticTokens = {
    "--ops-success": "#00B42A",
    "--ops-warning": "#FF7D00",
    "--ops-danger": "#F53F3F",
    "--ops-info": "#165DFF",
    "--ok-600": "#00B42A",
    "--warn-600": "#FF7D00",
    "--danger-600": "#F53F3F",
  };
  Object.entries(fixedSemanticTokens).forEach(([token, expected]) => {
    const value = declarations.get(token);
    expect(value?.toLowerCase()).toBe(expected.toLowerCase());
    expect(value).not.toContain("var(--org-brand-");
  });
}

describe("OrganizationBrandTheme", () => {
  it("scopes the published organization palette to its child subtree", () => {
    const { container } = render(
      <OrganizationBrandTheme brand={BRAND}>
        <span>工作台</span>
      </OrganizationBrandTheme>,
    );

    const root = container.querySelector<HTMLElement>(
      ".organization-brand-theme",
    );
    expect(root).toHaveStyle({
      "--org-brand-primary": "#7A3E00",
      "--org-brand-action": "#663400",
      "--org-brand-soft": "#F0E7DE",
    });
    expect(root?.parentElement).not.toHaveClass("organization-brand-theme");
  });

  it("maps interactive tokens without making semantic colors brand-dependent", () => {
    const tokens = fs.readFileSync(
      path.join(process.cwd(), "styles/ops/tokens.css"),
      "utf8",
    );
    const foundations = fs.readFileSync(
      path.join(process.cwd(), "styles/ops/foundations.css"),
      "utf8",
    );

    expectScopedConsoleTokens(tokens);
    expect(foundations).toMatch(
      /\.organization-brand-theme\s+\.ops-reference-nav-item\[data-active="true"\][\s\S]*var\(--org-brand-soft[\s\S]*var\(--org-brand-action/,
    );
    expect(foundations).toMatch(
      /button\[data-button-kind="primary"\][\s\S]*background:\s*var\(--org-brand-action/,
    );
    expect(foundations).toMatch(
      /\.organization-brand-theme[\s\S]*:focus-visible[\s\S]*var\(--org-brand-action/,
    );
    expect(foundations).toMatch(
      /\.organization-brand-theme[\s\S]*input\[type="checkbox"\][\s\S]*accent-color:\s*var\(--org-brand-action/,
    );
    expect(foundations).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("does not let correct root semantics mask a mutated scoped token", () => {
    const tokens = fs.readFileSync(
      path.join(process.cwd(), "styles/ops/tokens.css"),
      "utf8",
    );
    const scopedBlock = extractFlatCssBlock(
      tokens,
      ".organization-brand-theme",
    );
    const mutatedBlock = scopedBlock.replace(
      /--ops-success:\s*#[0-9a-f]+;/i,
      "--ops-success: var(--org-brand-action);",
    );
    const mutatedTokens = tokens.replace(scopedBlock, mutatedBlock);

    expect(mutatedBlock).not.toBe(scopedBlock);
    expect(extractFlatCssBlock(mutatedTokens, ":root")).toMatch(
      /--ops-success:\s*#00b42a/i,
    );
    expect(() => expectScopedConsoleTokens(mutatedTokens)).toThrow();
  });
});
