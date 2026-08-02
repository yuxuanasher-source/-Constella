import { randomUUID } from "node:crypto";

// @ts-expect-error -- sharp 0.35.0 publishes bundled declarations but omits
// the `types` condition from its package exports.
import sharp from "sharp";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const MIME_BY_FORMAT: Readonly<Record<string, string>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const BRAND_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const BRAND_LOGO_MAX_INPUT_PIXELS = 16_777_216;

export type BrandLogoErrorCode =
  | "BRAND_LOGO_INVALID_FILE"
  | "BRAND_LOGO_TOO_LARGE"
  | "BRAND_LOGO_INVALID_CONTENT"
  | "BRAND_LOGO_INVALID_ORGANIZATION";

export class BrandLogoError extends Error {
  constructor(
    public readonly code: BrandLogoErrorCode,
    message: string,
    public readonly status: 400 | 413 | 422,
  ) {
    super(message);
    this.name = "BrandLogoError";
  }
}

export type NormalizedBrandLogo = {
  body: Buffer;
  contentType: "image/webp";
  path: string;
};

export async function normalizeBrandLogo(
  file: File,
  organizationId: string,
): Promise<NormalizedBrandLogo> {
  if (!ORGANIZATION_ID_PATTERN.test(organizationId)) {
    throw new BrandLogoError(
      "BRAND_LOGO_INVALID_ORGANIZATION",
      "The organization identifier is invalid",
      400,
    );
  }

  if (file.size > BRAND_LOGO_MAX_BYTES) {
    throw new BrandLogoError(
      "BRAND_LOGO_TOO_LARGE",
      "The logo exceeds the 2 MiB limit",
      413,
    );
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (
    file.size <= 0 ||
    !ALLOWED_MIME_TYPES.has(file.type) ||
    MIME_BY_EXTENSION[extension] !== file.type
  ) {
    throw new BrandLogoError(
      "BRAND_LOGO_INVALID_FILE",
      "The logo file type is invalid",
      400,
    );
  }

  try {
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, {
      failOn: "error",
      limitInputPixels: BRAND_LOGO_MAX_INPUT_PIXELS,
    });
    const metadata = await image.metadata();

    if (
      !metadata.width ||
      !metadata.height ||
      !metadata.format ||
      MIME_BY_FORMAT[metadata.format] !== file.type
    ) {
      throw new BrandLogoError(
        "BRAND_LOGO_INVALID_CONTENT",
        "The logo content is invalid",
        422,
      );
    }

    const body = await image
      .rotate()
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer();

    return {
      body,
      contentType: "image/webp",
      path: `${organizationId}/brand-logos/${randomUUID()}.webp`,
    };
  } catch (error) {
    if (error instanceof BrandLogoError) {
      throw error;
    }
    throw new BrandLogoError(
      "BRAND_LOGO_INVALID_CONTENT",
      "The logo content is invalid",
      422,
    );
  }
}
