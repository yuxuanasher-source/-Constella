export const DEFAULT_BRAND_PRIMARY = "#165DFF";
export const BRAND_SCHEMA_VERSION = 1 as const;

export type PublishedOrganizationBrand = {
  schemaVersion: typeof BRAND_SCHEMA_VERSION;
  version: number;
  logoText: string;
  logoStoragePath: string | null;
  brandName: string;
  brandTagline: string;
  primaryColor: string;
  actionColor: string;
  softColor: string;
  publishedAt: string | null;
  semantic: {
    success: "#00B42A";
    warning: "#FF7D00";
    danger: "#F53F3F";
    info: "#165DFF";
  };
};

const HEX_COLOR = /^#[0-9A-F]{6}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_PUBLISHED_AT_LENGTH = 32;

function recordFrom(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function cap(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

function safeText(value: unknown, fallback: string, maxLength: number): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return cap(candidate || fallback.trim(), maxLength);
}

function normalizeHex(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim().toUpperCase() : "";
  return HEX_COLOR.test(candidate) ? candidate : DEFAULT_BRAND_PRIMARY;
}

function normalizeVersion(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_POSTGRES_INTEGER
    ? value
    : 0;
}

function normalizePublishedAt(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (value.length > MAX_PUBLISHED_AT_LENGTH) {
    return null;
  }

  const candidate = value.trim();
  if (!candidate) {
    return null;
  }

  const match = candidate.match(ISO_TIMESTAMP);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "0").padEnd(3, "0").slice(0, 3));
  const offsetHour = Number(match[10] ?? "0");
  const offsetMinute = Number(match[11] ?? "0");

  if (offsetHour > 23 || offsetMinute > 59) {
    return null;
  }

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millisecond);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second ||
    local.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }

  const offsetDirection = match[9] === "+" ? 1 : match[9] === "-" ? -1 : 0;
  const expectedTime =
    local.getTime() -
    offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
  const parsedTime = Date.parse(candidate);

  return Number.isFinite(parsedTime) && parsedTime === expectedTime
    ? candidate
    : null;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  ) as [number, number, number];
}

function linearChannel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [red, green, blue] = rgb(hex).map(linearChannel);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function relativeContrast(left: string, right: string): number {
  const high = Math.max(luminance(left), luminance(right));
  const low = Math.min(luminance(left), luminance(right));
  return (high + 0.05) / (low + 0.05);
}

function mixWithBlack(hex: string, ratio: number): string {
  const values = rgb(hex).map((value) => Math.round(value * (1 - ratio)));
  return `#${values
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function deriveActionColor(seed: string): string {
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mixWithBlack(seed, step * 0.04);
    if (relativeContrast(candidate, "#FFFFFF") >= 4.5) {
      return candidate;
    }
  }
  return "#123A8C";
}

function deriveSoftColor(seed: string): string {
  const values = rgb(seed).map((value) =>
    Math.round(value * 0.12 + 255 * 0.88),
  );
  return `#${values
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function normalizeLogoStoragePath(
  value: unknown,
  organizationId: string,
): string | null {
  if (typeof value !== "string" || !UUID.test(organizationId)) {
    return null;
  }

  const path = value.trim();
  const match = path.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/brand-logos\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.webp$/i,
  );
  if (!match) {
    return null;
  }

  return match[1].toLowerCase() === organizationId.toLowerCase() ? path : null;
}

export function normalizePublishedBrand(
  value: unknown,
  identity: { organizationId: string; organizationName: string },
): PublishedOrganizationBrand {
  const rawSource = recordFrom(value);
  const source =
    !Object.prototype.hasOwnProperty.call(rawSource, "schemaVersion") ||
    rawSource.schemaVersion === BRAND_SCHEMA_VERSION
      ? rawSource
      : {};
  const organizationName = identity.organizationName.trim();
  const primaryColor = normalizeHex(source.primaryColor);

  return {
    schemaVersion: BRAND_SCHEMA_VERSION,
    version: normalizeVersion(source.version),
    logoText: safeText(source.logoText, cap(organizationName, 2), 8),
    logoStoragePath: normalizeLogoStoragePath(
      source.logoStoragePath,
      identity.organizationId,
    ),
    brandName: safeText(source.brandName, organizationName, 40),
    brandTagline: safeText(source.brandTagline, "", 80),
    primaryColor,
    actionColor: deriveActionColor(primaryColor),
    softColor: deriveSoftColor(primaryColor),
    publishedAt: normalizePublishedAt(source.publishedAt),
    semantic: {
      success: "#00B42A",
      warning: "#FF7D00",
      danger: "#F53F3F",
      info: "#165DFF",
    },
  };
}
