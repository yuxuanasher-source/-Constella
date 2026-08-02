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

    expect(tokens).toMatch(
      /\.organization-brand-theme\s*\{[\s\S]*--ops-primary:\s*var\(--org-brand-action/,
    );
    expect(tokens).toMatch(
      /\.organization-brand-theme\s*\{[\s\S]*--ops-primary-soft:\s*var\(--org-brand-soft/,
    );
    expect(tokens).toMatch(/--ops-success:\s*#00B42A/i);
    expect(tokens).toMatch(/--ops-warning:\s*#FF7D00/i);
    expect(tokens).toMatch(/--ops-danger:\s*#F53F3F/i);
    expect(tokens).not.toMatch(
      /--(?:ops-(?:success|warning|danger)|ok-600|warn-600|danger-600):[^;]*var\(--org-brand-/,
    );
    expect(tokens).not.toMatch(/--blue-[^:]+:[^;]*var\(--org-brand-/);
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
});
