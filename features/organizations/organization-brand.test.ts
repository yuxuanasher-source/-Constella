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
  it("accepts missing schemaVersion as legacy branding", () => {
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
      logoText: "星",
      brandName: "星耀经营舱",
      brandTagline: "专业让价值被看见",
    });
  });

  it("accepts numeric schemaVersion 1 as the current contract", () => {
    const brand = normalizePublishedBrand(
      {
        schemaVersion: 1,
        version: 7,
        logoText: "当前",
        brandName: "当前品牌",
        brandTagline: "当前标语",
        primaryColor: "#123456",
        publishedAt: "2026-08-01T12:34:56.789Z",
      },
      identity,
    );

    expect(brand).toMatchObject({
      schemaVersion: BRAND_SCHEMA_VERSION,
      version: 7,
      logoText: "当前",
      brandName: "当前品牌",
      brandTagline: "当前标语",
      primaryColor: "#123456",
      publishedAt: "2026-08-01T12:34:56.789Z",
    });
  });

  it.each([undefined, 0, 2, 99, "1", "future", null, {}, Number.NaN])(
    "falls back to safe legacy defaults for unsupported schemaVersion %p",
    (schemaVersion) => {
      const brand = normalizePublishedBrand(
        {
          schemaVersion,
          version: 41,
          logoText: "不可信",
          logoStoragePath: `${ORGANIZATION_ID}/brand-logos/${LOGO_ID}.webp`,
          brandName: "不可信品牌",
          brandTagline: "不可信标语",
          primaryColor: "#123456",
          publishedAt: "2026-08-01T12:34:56.789Z",
        },
        identity,
      );

      expect(brand).toMatchObject({
        schemaVersion: BRAND_SCHEMA_VERSION,
        version: 0,
        logoText: "北辰",
        logoStoragePath: null,
        brandName: "北辰机构",
        brandTagline: "",
        primaryColor: DEFAULT_BRAND_PRIMARY,
        publishedAt: null,
      });
    },
  );

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

  it.each([
    [0, 0],
    [2_147_483_647, 2_147_483_647],
    [2_147_483_648, 0],
    [-1, 0],
    [Number.MAX_SAFE_INTEGER + 1, 0],
    [1e20, 0],
    [1.5, 0],
  ])("normalizes publication version %p to %p", (version, expected) => {
    expect(
      normalizePublishedBrand({ schemaVersion: 1, version }, identity).version,
    ).toBe(expected);
  });

  it.each(["2026-08-01T12:34:56.789Z", "2026-08-01T20:34:56+08:00"])(
    "accepts a bounded ISO-8601 publishedAt timestamp: %s",
    (publishedAt) => {
      expect(
        normalizePublishedBrand({ schemaVersion: 1, publishedAt }, identity)
          .publishedAt,
      ).toBe(publishedAt);
    },
  );

  it.each([
    "not-a-date",
    "2026-02-30T12:34:56.789Z",
    "2026-08-01",
    "2026-08-01 12:34:56Z",
    `${"2".repeat(80)}-08-01T12:34:56.789Z`,
    `${" ".repeat(40)}2026-08-01T12:34:56.789Z`,
    "2026-08-01T12:34:56.789Z-extra",
    "",
    null,
  ])("drops an unsafe publishedAt value: %p", (publishedAt) => {
    expect(
      normalizePublishedBrand({ schemaVersion: 1, publishedAt }, identity)
        .publishedAt,
    ).toBeNull();
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
