import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PublishedOrganizationBrand } from "@/features/organizations/organization-brand";

import { OpsShell } from "./ops-shell";

const BRAND: PublishedOrganizationBrand = {
  schemaVersion: 1,
  version: 3,
  logoText: "北辰",
  logoStoragePath: null,
  brandName: "北辰直播运营",
  brandTagline: "专业协作",
  primaryColor: "#7A3E00",
  actionColor: "#663400",
  softColor: "#F0E7DE",
  publishedAt: null,
  semantic: {
    success: "#00B42A",
    warning: "#FF7D00",
    danger: "#F53F3F",
    info: "#165DFF",
  },
};

describe("OpsShell", () => {
  it("passes one published brand through desktop and mobile identity contexts", () => {
    const { container } = render(
      <OpsShell
        brand={BRAND}
        logoUrl={null}
        organizationName="北辰机构"
        userName="Alice"
        role="owner"
      >
        <main>工作内容</main>
      </OpsShell>,
    );

    expect(container.querySelector(".organization-brand-theme")).toHaveStyle({
      "--org-brand-action": "#663400",
      "--org-brand-soft": "#F0E7DE",
    });
    expect(screen.getAllByText("北辰直播运营").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(screen.getAllByText("专业协作").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("北辰机构")).toBeInTheDocument();
    expect(screen.getByText("Alice · owner")).toBeInTheDocument();
    expect(screen.getByText("工作内容")).toBeInTheDocument();
  });
});
