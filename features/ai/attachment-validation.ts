import type { AiAttachment } from "./contracts";

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 200_000;
const MAX_ATTACHMENT_DATA_CHARS =
  Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 1024;

export type AiAttachmentValidationResult =
  | { ok: true; attachments: AiAttachment[] }
  | { ok: false; error: string };

export function sanitizeAiAttachments(
  value: unknown,
): AiAttachmentValidationResult {
  if (value === undefined || value === null) {
    return { ok: true, attachments: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: "Attachments must be an array" };
  }
  if (value.length > MAX_ATTACHMENTS) {
    return {
      ok: false,
      error: "AI chat supports up to five attachments per message",
    };
  }

  const attachments: AiAttachment[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      return { ok: false, error: `Attachment ${index + 1} is invalid` };
    }

    const name = sanitizeAttachmentName(item.name, index);
    const mimeType = sanitizeAttachmentMimeType(item.mimeType);
    if (!mimeType) {
      return {
        ok: false,
        error: `Attachment ${name} has an unsupported file type`,
      };
    }

    const sizeBytes =
      typeof item.sizeBytes === "number" && Number.isFinite(item.sizeBytes)
        ? Math.max(0, Math.trunc(item.sizeBytes))
        : undefined;
    if (sizeBytes !== undefined && sizeBytes > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: `Attachment ${name} is too large` };
    }

    const attachment: AiAttachment = {
      name,
      mimeType,
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    };

    if (typeof item.text === "string" && item.text.trim()) {
      if (item.text.length > MAX_ATTACHMENT_TEXT_CHARS) {
        return { ok: false, error: `Attachment ${name} text is too large` };
      }
      attachment.text = item.text.trim();
    }
    if (typeof item.data === "string" && item.data.trim()) {
      if (item.data.length > MAX_ATTACHMENT_DATA_CHARS) {
        return { ok: false, error: `Attachment ${name} data is too large` };
      }
      attachment.data = item.data.trim();
    }
    if (typeof item.fileId === "string" && item.fileId.trim()) {
      attachment.fileId = item.fileId.trim();
    }
    if (typeof item.url === "string" && item.url.trim()) {
      attachment.url = item.url.trim();
    }

    if (
      !attachment.text &&
      !attachment.data &&
      !attachment.fileId &&
      !attachment.url
    ) {
      return { ok: false, error: `Attachment ${name} has no readable content` };
    }

    attachments.push(attachment);
  }

  return { ok: true, attachments };
}

function sanitizeAttachmentName(value: unknown, index: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  const safe = text
    .replace(/[\\/]/g, "_")
    .replace(/[^\w.\-\u4e00-\u9fa5]/g, "_")
    .slice(0, 120);
  return safe || `attachment-${index + 1}`;
}

function sanitizeAttachmentMimeType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const mimeType = value.trim().toLowerCase();
  if (!mimeType) return null;
  if (mimeType.startsWith("text/") || mimeType.startsWith("image/")) {
    return mimeType;
  }

  const allowed = new Set([
    "application/json",
    "application/pdf",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]);
  return allowed.has(mimeType) ? mimeType : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
