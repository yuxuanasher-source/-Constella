import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PublishedOrganizationBrand } from "@/features/organizations/organization-brand";

import { OPS_V2_NAV_ITEMS } from "./navigation";
import { OpsSidebar } from "./ops-sidebar";

const BRAND: PublishedOrganizationBrand = {
  schemaVersion: 1,
  version: 3,
  logoText: "北辰",
  logoStoragePath: "private/never-render-this-path.webp",
  brandName: "北辰直播运营中心",
  brandTagline: "让交付清楚、可信、可追溯",
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

describe("OpsSidebar", () => {
  it("leads with the organization brand and keeps Brand Center secondary", () => {
    render(
      <OpsSidebar
        brand={BRAND}
        logoUrl="https://signed.example/brand.webp"
        activeHref="/console/projects"
        items={OPS_V2_NAV_ITEMS}
      />,
    );

    expect(
      screen.getByRole("img", { name: "北辰直播运营中心品牌标识" }),
    ).toHaveAttribute("src", "https://signed.example/brand.webp");
    expect(screen.getByText("北辰直播运营中心")).toBeInTheDocument();
    expect(screen.getByText("让交付清楚、可信、可追溯")).toBeInTheDocument();
    expect(screen.getByText("由经营舱提供技术服务")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "进入北辰直播运营中心品牌中心" }),
    ).toHaveAttribute("href", "/console/brand");
    expect(screen.getByRole("link", { name: "项目管理" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      OPS_V2_NAV_ITEMS.some((item) => String(item.href) === "/console/brand"),
    ).toBe(false);
    expect(document.body.innerHTML).not.toContain(
      "private/never-render-this-path.webp",
    );
    expect(document.body.innerHTML).not.toContain("/brand/ops-mascot-logo.png");
  });

  it("falls back to the published wordmark when the signed image fails", () => {
    render(
      <OpsSidebar
        brand={BRAND}
        logoUrl="https://signed.example/brand.webp"
        activeHref="/console"
        items={OPS_V2_NAV_ITEMS}
      />,
    );

    fireEvent.error(
      screen.getByRole("img", { name: "北辰直播运营中心品牌标识" }),
    );

    expect(
      screen.queryByRole("img", { name: "北辰直播运营中心品牌标识" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("ops-v2-brand-mark")).toHaveTextContent("北辰");
  });

  it("does not render a broken image when no signed URL is available", () => {
    render(
      <OpsSidebar
        brand={{ ...BRAND, logoText: "" }}
        logoUrl={null}
        activeHref="/console"
        items={OPS_V2_NAV_ITEMS}
      />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByTestId("ops-v2-brand-mark")).toHaveTextContent(
      "北辰直播",
    );
  });
});
