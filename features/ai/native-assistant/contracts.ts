import { HERMES_KERNEL_ID, type HermesReadScope } from "../hermes/contracts";
import {
  sanitizeHermesPageContext,
  type HermesPageContext,
} from "../hermes/page-context";

export const NATIVE_XINGYAO_ASSISTANT = {
  displayName: "星耀 AI",
  kernelId: HERMES_KERNEL_ID,
} as const;

export type NativeAssistantClientRequest = {
  message: string;
  pageContext?: HermesPageContext;
  attachmentIds: string[];
};

const CLIENT_REQUEST_KEYS = [
  "attachmentIds",
  "message",
  "pageContext",
] as const;

export function parseNativeAssistantClientRequest(
  value: unknown,
): NativeAssistantClientRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const keys = Object.keys(value).sort();
  if (!keys.every((key) => CLIENT_REQUEST_KEYS.includes(key as never))) {
    return null;
  }

  const message = normalizedString(value.message, 12_000);
  if (!message) {
    return null;
  }

  const pageContext =
    value.pageContext == null
      ? undefined
      : sanitizeHermesPageContext(value.pageContext);
  if (value.pageContext != null && !pageContext) {
    return null;
  }

  const attachmentIds = sanitizeAttachmentIds(value.attachmentIds);
  if (!attachmentIds) {
    return null;
  }

  return {
    message,
    ...(pageContext ? { pageContext } : {}),
    attachmentIds,
  };
}

export type NativeAssistantActorContext = {
  userId: string;
  organizationId: string;
  role: string;
  conversationId: string;
  allowedReadScopes: HermesReadScope[];
  skillGrantsHash: string;
  profileVersion: string;
};

function sanitizeAttachmentIds(value: unknown): string[] | null {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 20) {
    return null;
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = normalizedString(item, 128);
    if (!id || seen.has(id)) {
      return null;
    }
    ids.push(id);
    seen.add(id);
  }
  return ids;
}

function normalizedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
