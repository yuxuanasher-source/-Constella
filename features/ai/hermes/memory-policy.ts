import { createHash } from "node:crypto";

export const HERMES_MEMORY_TYPES = [
  "preference",
  "workflow",
  "communication",
  "user_instruction",
] as const;

export type HermesMemoryType = (typeof HERMES_MEMORY_TYPES)[number];
export type HermesMemoryPolicyErrorCode = "memory_content_rejected";

const MONEY_VALUE_PATTERNS = [
  /(?:[$¥€£￥]|\b(?:usd|cny|rmb|eur|gbp|jpy|dollars?|euros?|pounds?|yen|yuan)\b)\s*[-+]?\d/iu,
  /[-+]?\d(?:[\d,.]*\d)?\s*(?:[$¥€£￥]|\b(?:usd|cny|rmb|eur|gbp|jpy|dollars?|euros?|pounds?|yen|yuan)\b|元)/iu,
  /\b\d(?:[\d,.]*\d)?\s*(?:%|％|percent(?:age)?\b|bps\b|basis\s+points?\b)/iu,
  /\broi\b[^\r\n\d]{0,24}[-+]?\d/iu,
  /\bsettlement(?:[_\s-]+(?:amount|value|rate|total|balance))?\b[^\r\n\d]{0,24}[-+]?\d/iu,
];

const PRIVATE_OBJECT_CONTEXT = String.raw`(?:project|streamer|(?:live[_\s-]*)?report|settlement(?:[_\s-]*batch)?|org(?:anization)?|knowledge(?:[_\s-]*(?:base|document|chunk))?|document|chunk)`;
const PRIVATE_OBJECT_ID_PATTERNS = [
  new RegExp(
    String.raw`\b${PRIVATE_OBJECT_CONTEXT}[_\s-]*(?:object[_\s-]*)?(?:id|uuid)\s*(?::|=|\bis\b)?\s*["']?[a-z0-9][a-z0-9_.:/#-]{2,}`,
    "iu",
  ),
  new RegExp(
    String.raw`\b${PRIVATE_OBJECT_CONTEXT}\s*(?::|=)\s*["']?[a-z0-9][a-z0-9_.:/#-]{2,}`,
    "iu",
  ),
  /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/iu,
  /\b(?:project|streamer|report|settlement|org(?:anization)?|knowledge|document|chunk)_[a-z0-9][a-z0-9_-]{5,}\b/iu,
];
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
  ...PRIVATE_OBJECT_ID_PATTERNS,
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
  if (typeof content !== "string") rejectMemoryContent();
  const canonicalContent = content
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\r\n?/gu, "\n")
    .trim();
  if (
    !canonicalContent ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(canonicalContent)
  ) {
    rejectMemoryContent();
  }
  return canonicalContent;
}

export function prepareHermesMemoryContent(content: unknown): {
  canonicalContent: string;
  contentHash: string;
} {
  const canonicalContent = canonicalizeHermesMemoryContent(content);
  if (
    REJECTED_CONTENT_PATTERNS.some((pattern) => pattern.test(canonicalContent))
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

function rejectMemoryContent(): never {
  throw new HermesMemoryPolicyError();
}
