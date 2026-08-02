import { describe, expect, it } from "vitest";

import {
  BRAND_SCHEMA_VERSION,
  DEFAULT_BRAND_PRIMARY,
  normalizePublishedBrand,
  relativeContrast,
} from "./organization-brand";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const LOGO_ID = "33333333-3333-4333-8333-333333333333";

const identity = {
  organizationId: ORGANIZATION_ID,
  organizationName: "北辰机构",
};

describe("normalizePublishedBrand", () => {
  it("trims and caps the published text fields", () => {
    const brand = normalizePublishedBrand(
      {
        logoText: "  北辰品牌工作室一号  ",
        brandName: `  ${"品牌".repeat(24)}  `,
        brandTagline: `  ${"专业".repeat(44)}  `,
      },
      identity,
    );

    expect(brand.logoText).toBe("北辰品牌工作室一");
    expect(Array.from(brand.logoText)).toHaveLength(8);
    expect(brand.brandName).toBe("品牌".repeat(20));
    expect(Array.from(brand.brandName)).toHaveLength(40);
    expect(brand.brandTagline).toBe("专业".repeat(40));
    expect(Array.from(brand.brandTagline)).toHaveLength(80);
  });

  it("normalizes primary colors and falls back for malformed values", () => {
    expect(
      normalizePublishedBrand({ primaryColor: "  #a1b2c3  " }, identity)
        .primaryColor,
    ).toBe("#A1B2C3");

    for (const primaryColor of [
      "red",
      "#FFF",
      "#12345G",
      "#12345678",
      "",
      null,
      123456,
    ]) {
      expect(
        normalizePublishedBrand({ primaryColor }, identity).primaryColor,
      ).toBe(DEFAULT_BRAND_PRIMARY);
    }
  });

  it("always derives an action color with WCAG AA contrast against white", () => {
    for (const primaryColor of [
      "#FFFFFF",
      "#FFF000",
      "#00B42A",
      "#A1B2C3",
      "#165DFF",
      "#000000",
    ]) {
      const brand = normalizePublishedBrand({ primaryColor }, identity);

      expect(
        relativeContrast(brand.actionColor, "#FFFFFF"),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps semantic colors fixed instead of deriving them from the brand", () => {
    const semantic = {
      success: "#00B42A",
      warning: "#FF7D00",
      danger: "#F53F3F",
      info: "#165DFF",
    } as const;

    expect(
      normalizePublishedBrand({ primaryColor: "#123456" }, identity).semantic,
    ).toEqual(semantic);
    expect(
      normalizePublishedBrand({ primaryColor: "#ABCDEF" }, identity).semantic,
    ).toEqual(semantic);
  });

  it("accepts only an exact organization-owned WebP logo path", () => {
    const validPath = `${ORGANIZATION_ID}/brand-logos/${LOGO_ID}.webp`;
    expect(
      normalizePublishedBrand({ logoStoragePath: ` ${validPath} ` }, identity)
        .logoStoragePath,
    ).toBe(validPath);

    for (const logoStoragePath of [
      `22222222-2222-4222-8222-222222222222/brand-logos/${LOGO_ID}.webp`,
      `${ORGANIZATION_ID}/brand-logos/../${LOGO_ID}.webp`,
      `${ORGANIZATION_ID}/brand-logos/${LOGO_ID}.svg`,
      `${ORGANIZATION_ID}/brand-logos/not-a-uuid.webp`,
      `not-an-org/brand-logos/${LOGO_ID}.webp`,
      `${ORGANIZATION_ID}/nested/brand-logos/${LOGO_ID}.webp`,
      `${ORGANIZATION_ID}/brand-logos/${LOGO_ID}.webp/extra`,
    ]) {
      expect(
        normalizePublishedBrand({ logoStoragePath }, identity).logoStoragePath,
      ).toBeNull();
    }
  });

  it("normalizes legacy text-only branding into the versioned contract", () => {
    const brand = normalizePublishedBrand(
      {
        logoText: " 星 ",
        brandName: " 星耀经营舱 ",
        brandTagline: " 专业让价值被看见 ",
      },
      identity,
    );

    expect(brand).toMatchObject({
      schemaVersion: BRAND_SCHEMA_VERSION,
      version: 0,
      logoText: "星",
      logoStoragePath: null,
      brandName: "星耀经营舱",
      brandTagline: "专业让价值被看见",
      primaryColor: DEFAULT_BRAND_PRIMARY,
      publishedAt: null,
    });
    expect(
      relativeContrast(brand.actionColor, "#FFFFFF"),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("uses deterministic organization fallbacks and safe metadata values", () => {
    const brand = normalizePublishedBrand(
      {
        version: -1,
        logoText: "   ",
        brandName: null,
        brandTagline: 42,
        publishedAt: { unsafe: true },
      },
      { organizationId: ORGANIZATION_ID, organizationName: "  北辰机构  " },
    );

    expect(brand).toMatchObject({
      version: 0,
      logoText: "北辰",
      brandName: "北辰机构",
      brandTagline: "",
      publishedAt: null,
    });
  });
});

describe("relativeContrast", () => {
  it("calculates the WCAG contrast ratio deterministically", () => {
    expect(relativeContrast("#000000", "#FFFFFF")).toBeCloseTo(21, 8);
    expect(relativeContrast("#FFFFFF", "#FFFFFF")).toBe(1);
  });
});
