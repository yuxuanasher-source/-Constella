import { File } from "node:buffer";

// @ts-expect-error -- sharp 0.35.0 publishes bundled declarations but omits
// the `types` condition from its package exports.
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { BrandLogoError, normalizeBrandLogo } from "./organization-brand-logo";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

function imageFile(
  body: Buffer | string,
  name: string,
  type: string,
): globalThis.File {
  return new File([body], name, { type }) as unknown as globalThis.File;
}

async function expectBrandLogoError(
  promise: Promise<unknown>,
  code: BrandLogoError["code"],
) {
  await expect(promise).rejects.toMatchObject({
    name: "BrandLogoError",
    code,
  });
}

describe("normalizeBrandLogo", () => {
  it("rejects empty uploads with a stable invalid-file code", async () => {
    await expectBrandLogoError(
      normalizeBrandLogo(
        imageFile(Buffer.alloc(0), "logo.png", "image/png"),
        ORGANIZATION_ID,
      ),
      "BRAND_LOGO_INVALID_FILE",
    );
  });

  it("rejects files over 2 MiB with a dedicated size code", async () => {
    await expectBrandLogoError(
      normalizeBrandLogo(
        imageFile(Buffer.alloc(2 * 1024 * 1024 + 1), "logo.png", "image/png"),
        ORGANIZATION_ID,
      ),
      "BRAND_LOGO_TOO_LARGE",
    );
  });

  it.each([
    ["logo.svg", "image/svg+xml"],
    ["logo.gif", "image/gif"],
    ["logo.txt", "text/plain"],
  ])("rejects an unsupported %s upload", async (name, type) => {
    await expectBrandLogoError(
      normalizeBrandLogo(
        imageFile("not-an-image", name, type),
        ORGANIZATION_ID,
      ),
      "BRAND_LOGO_INVALID_FILE",
    );
  });

  it("rejects a MIME and extension mismatch before decoding", async () => {
    const png = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: "#123456",
      },
    })
      .png()
      .toBuffer();

    await expectBrandLogoError(
      normalizeBrandLogo(
        imageFile(png, "logo.jpg", "image/png"),
        ORGANIZATION_ID,
      ),
      "BRAND_LOGO_INVALID_FILE",
    );
  });

  it("rejects SVG content disguised as a PNG", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

    await expectBrandLogoError(
      normalizeBrandLogo(
        imageFile(svg, "logo.png", "image/png"),
        ORGANIZATION_ID,
      ),
      "BRAND_LOGO_INVALID_CONTENT",
    );
  });

  it("rejects damaged image data without exposing Sharp errors", async () => {
    const promise = normalizeBrandLogo(
      imageFile(Buffer.from("definitely not a PNG"), "logo.png", "image/png"),
      ORGANIZATION_ID,
    );

    await expectBrandLogoError(promise, "BRAND_LOGO_INVALID_CONTENT");
    await expect(promise).rejects.not.toMatchObject({
      message: expect.stringMatching(/sharp|png|decode|input/i),
    });
  });

  it("rejects decoded formats that disagree with the declared MIME", async () => {
    const png = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: "#abcdef",
      },
    })
      .png()
      .toBuffer();

    await expectBrandLogoError(
      normalizeBrandLogo(
        imageFile(png, "logo.jpg", "image/jpeg"),
        ORGANIZATION_ID,
      ),
      "BRAND_LOGO_INVALID_CONTENT",
    );
  });

  it("rejects a compressed image whose decoded pixel count exceeds the limit", async () => {
    const pixelBomb = await sharp({
      create: {
        width: 4_097,
        height: 4_097,
        channels: 3,
        background: "#ffffff",
      },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(pixelBomb.byteLength).toBeLessThan(2 * 1024 * 1024);

    await expectBrandLogoError(
      normalizeBrandLogo(
        imageFile(pixelBomb, "logo.png", "image/png"),
        ORGANIZATION_ID,
      ),
      "BRAND_LOGO_INVALID_CONTENT",
    );
  });

  it("applies EXIF rotation and normalizes a real high-resolution image to bounded WebP", async () => {
    const jpeg = await sharp({
      create: {
        width: 900,
        height: 1_500,
        channels: 3,
        background: "#2360a8",
      },
    })
      .jpeg({ quality: 90 })
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await normalizeBrandLogo(
      imageFile(jpeg, "team-logo.jpeg", "image/jpeg"),
      ORGANIZATION_ID,
    );
    const metadata = await sharp(result.body).metadata();

    expect(metadata).toMatchObject({ format: "webp", width: 512, height: 307 });
    expect(result.contentType).toBe("image/webp");
    expect(result.path).toMatch(
      /^11111111-1111-4111-8111-111111111111\/brand-logos\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/,
    );
  });

  it.each([
    "../another-organization",
    "11111111-1111-4111-8111-111111111111/../../attacker",
    "not-a-uuid",
    "11111111-1111-4111-8111-111111111111%2f..%2fattacker",
  ])(
    "rejects an unsafe organization path source: %s",
    async (organizationId) => {
      const png = await sharp({
        create: {
          width: 16,
          height: 16,
          channels: 4,
          background: "#ffffff",
        },
      })
        .png()
        .toBuffer();

      await expectBrandLogoError(
        normalizeBrandLogo(
          imageFile(png, "logo.png", "image/png"),
          organizationId,
        ),
        "BRAND_LOGO_INVALID_ORGANIZATION",
      );
    },
  );
});
