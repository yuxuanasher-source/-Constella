import { createHash } from "node:crypto";

export const HERMES_MEMORY_TYPES = [
  "preference",
  "workflow",
  "communication",
  "user_instruction",
] as const;

export type HermesMemoryType = (typeof HERMES_MEMORY_TYPES)[number];
export type HermesMemoryPolicyErrorCode = "memory_content_rejected";

const UNICODE_NUMBER = String.raw`\p{Nd}(?:[\p{Nd},.]*\p{Nd})?`;
const CURRENCY_WORDS = String.raw`(?:usd|cny|rmb|eur|gbp|jpy|dollars?|euros?|pounds?|yen|yuan)`;
const MONEY_VALUE_PATTERNS = [
  new RegExp(
    String.raw`(?:\p{Sc}|\b${CURRENCY_WORDS})\s*[-+]?${UNICODE_NUMBER}`,
    "iu",
  ),
  new RegExp(
    String.raw`[-+]?${UNICODE_NUMBER}\s*(?:\p{Sc}|\b${CURRENCY_WORDS}\b|元)`,
    "iu",
  ),
  new RegExp(
    String.raw`${UNICODE_NUMBER}\s*(?:%|percent(?:age)?\b|bps\b|basis\s+points?\b)`,
    "iu",
  ),
  new RegExp(
    String.raw`\broi\b[^\r\n\p{Nd}]{0,24}[-+]?${UNICODE_NUMBER}`,
    "iu",
  ),
  new RegExp(
    String.raw`\bsettlement(?:[_\s-]+(?:amount|value|rate|total|balance))?\b[^\r\n\p{Nd}]{0,24}[-+]?${UNICODE_NUMBER}`,
    "iu",
  ),
  new RegExp(
    String.raw`\b(?:budget|price|cost|amount|revenue|income|expense|spend|spending|fee|commission|payment|salary|profit|loss|balance)\b[^\r\n\p{Nd}]{0,24}[-+]?${UNICODE_NUMBER}`,
    "iu",
  ),
];

const PRIVATE_OBJECT_CONTEXT = String.raw`(?:project|streamer|(?:live[_\s-]*)?report|settlement(?:[_\s-]*batch)?|org(?:anization)?|knowledge(?:[_\s-]*(?:base|document|chunk))?|document|chunk)`;
const BARE_UUID_PATTERN = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/iu;
const EXPLICIT_OBJECT_ID_PATTERN = new RegExp(
  String.raw`\b${PRIVATE_OBJECT_CONTEXT}[_\s-]*(?:object[_\s-]*)?(?:id|uuid|key)\b\s*(?::|=|\bis\b)?\s*["']?([a-z0-9][a-z0-9_.:/#-]{2,})`,
  "giu",
);
const KNOWN_PREFIXED_OBJECT_ID_PATTERN =
  /\b(?:project|streamer|creator|report|batch|settlement|org(?:anization)?|knowledge|document|doc|chunk)[_-](?=[a-z0-9_.:/#-]{2,}\b)(?=[a-z0-9_.:/#-]*\p{Nd})[a-z0-9_.:/#-]+\b/giu;
const PROVENANCE_PATTERNS = [
  /\bevidence[_\s-]*refs?\b/iu,
  /\btool[_\s-]+(?:output|outputs|result|results|response|responses|call|calls)\b/iu,
  /\bknowledge\s+chunks?\b/iu,
];
const CREDENTIAL_PATTERNS = [
  /https?:\/\/[^\s/:@]+:[^\s/@]+@/iu,
  /https?:\/\/\S+[?&](?:x-amz-(?:credential|signature)|access[_-]?token|api[_-]?key|auth|credential|password|secret|signature|token)=/iu,
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/u,
  /\bBearer\s+\S+/iu,
  /\b(?:api[_\s-]*key|access[_\s-]*token|refresh[_\s-]*token|auth(?:orization)?[_\s-]*(?:header|token)?|bearer|password|passwd|cookie|private[_\s-]*key|secret[_\s-]*(?:key|token))\b\s*(?::|=|\bis\b)\s*\S+/iu,
  /\b(?:sk|pk|ghp|github_pat)_[a-z0-9_-]{8,}\b/iu,
  /\bsk-[a-z0-9_-]{8,}\b/iu,
  /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/iu,
];
const PERMISSION_BYPASS_PATTERNS = [
  /\b(?:ignore|bypass|disable|skip|override|evade)\b[^\r\n]{0,40}\b(?:role|scope|permission|authorization|authorisation|access)[-_\s]*(?:check|control|policy|restriction|guard)?s?\b/iu,
  /\b(?:act|run|execute)\s+as\s+(?:an?\s+)?(?:owner|admin|administrator|service[_\s-]*role)\b/iu,
];

const REJECTED_CONTENT_PATTERNS = [
  ...MONEY_VALUE_PATTERNS,
  ...PROVENANCE_PATTERNS,
  ...CREDENTIAL_PATTERNS,
  ...PERMISSION_BYPASS_PATTERNS,
];

export class HermesMemoryPolicyError extends Error {
  readonly code = "memory_content_rejected" as const;

  constructor() {
    super("Hermes memory content was rejected");
    this.name = "HermesMemoryPolicyError";
  }
}

export function isHermesMemoryType(value: unknown): value is HermesMemoryType {
  return HERMES_MEMORY_TYPES.includes(value as HermesMemoryType);
}

export function canonicalizeHermesMemoryContent(content: unknown): string {
  return normalizeHermesMemoryContent(content).canonicalContent;
}

export function prepareHermesMemoryContent(content: unknown): {
  canonicalContent: string;
  contentHash: string;
} {
  const { canonicalContent, joinedDetectionContent } =
    normalizeHermesMemoryContent(content);
  const detectionForms = [canonicalContent, joinedDetectionContent];
  if (
    detectionForms.some(
      (candidate) =>
        containsPrivateObjectId(candidate) ||
        REJECTED_CONTENT_PATTERNS.some((pattern) => pattern.test(candidate)),
    )
  ) {
    rejectMemoryContent();
  }
  return {
    canonicalContent,
    contentHash: createHash("sha256")
      .update(canonicalContent, "utf8")
      .digest("hex"),
  };
}

function normalizeHermesMemoryContent(content: unknown): {
  canonicalContent: string;
  joinedDetectionContent: string;
} {
  if (typeof content !== "string") rejectMemoryContent();
  const normalizedContent = content
    .normalize("NFKC")
    .replace(/[\p{Pd}\u2212]/gu, "-")
    .replace(/[\u0609\u060a\u066a]/gu, "%")
    .replace(/\u066b/gu, ".")
    .replace(/\u066c/gu, ",")
    .replace(/\r\n?/gu, "\n");
  const canonicalContent = normalizedContent
    .replace(/[^\S\r\n]*(?:\p{Cf}+[^\S\r\n]*)+/gu, " ")
    .trim();
  const joinedDetectionContent = normalizedContent
    .replace(/\p{Cf}/gu, "")
    .trim();
  if (
    !canonicalContent ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(canonicalContent)
  ) {
    rejectMemoryContent();
  }
  return { canonicalContent, joinedDetectionContent };
}

function containsPrivateObjectId(content: string): boolean {
  if (BARE_UUID_PATTERN.test(content)) return true;
  KNOWN_PREFIXED_OBJECT_ID_PATTERN.lastIndex = 0;
  if (KNOWN_PREFIXED_OBJECT_ID_PATTERN.test(content)) return true;

  EXPLICIT_OBJECT_ID_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(EXPLICIT_OBJECT_ID_PATTERN)) {
    if (isPlausibleMachineId(match[1] ?? "")) return true;
  }
  return false;
}

function isPlausibleMachineId(value: string): boolean {
  if (BARE_UUID_PATTERN.test(value)) return true;
  if (/^\p{Nd}{3,}$/u.test(value)) return true;
  if (value.length < 6) return false;
  return (
    /\p{Nd}/u.test(value) ||
    /[_.:/#-]/u.test(value) ||
    /^[0-9a-f]{8,}$/iu.test(value)
  );
}

function rejectMemoryContent(): never {
  throw new HermesMemoryPolicyError();
}
