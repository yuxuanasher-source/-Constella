import { NextResponse } from "next/server";

import type {
  AdmissionReviewDraftDto,
  PublicAdmissionShareError,
} from "@/features/applications/admission-share-board";

type PublicAdmissionShareErrorCode =
  | PublicAdmissionShareError["code"]
  | "SHARE_SERVICE_UNAVAILABLE";

const PUBLIC_ERROR_MESSAGES: Record<PublicAdmissionShareErrorCode, string> = {
  ACCESS_CODE_REQUIRED: "请输入访问码后继续。",
  ACCESS_CODE_INVALID: "访问码不正确，请重新输入。",
  ACCESS_RATE_LIMITED: "尝试次数过多，请稍后再试。",
  SHARE_NOT_AVAILABLE: "分享链接不存在或已失效。",
  SHARE_EXPIRED: "分享链接已过期。",
  SHARE_REVOKED: "分享链接已撤销。",
  RECORDING_NOT_SHARED: "该录屏不在当前分享范围内。",
  RECORDING_SOURCE_UNAVAILABLE: "录屏来源暂时不可用，请重试或打开备用视频。",
  REVIEW_VALIDATION_FAILED: "提交内容不完整，请检查后重试。",
  REVIEW_INCOMPLETE: "复核尚未完成，请补全所有录屏结论和必填备注。",
  RECORDING_VERSION_STALE: "录屏版本已更新，请刷新页面后重新提交。",
  DRAFT_CONFLICT: "其他复核人刚刚更新了结果，请刷新后查看最新内容。",
  DRAFT_SAVE_FAILED: "草稿暂时无法保存，请保留页面并稍后重试。",
  REVIEW_ALREADY_LOCKED: "本轮结果已经提交并锁定。",
  REVIEW_REOPEN_REQUIRED: "本轮结果已锁定，请由 MCN 重新开启后再修改。",
  SHARE_SERVICE_UNAVAILABLE: "分享服务暂时不可用，请稍后重试。",
};

const PUBLIC_ERROR_CODES = new Set<PublicAdmissionShareErrorCode>(
  Object.keys(PUBLIC_ERROR_MESSAGES) as PublicAdmissionShareErrorCode[],
);

const LEGACY_ERROR_MAP = new Map<
  string,
  { code: PublicAdmissionShareErrorCode; status: number }
>([
  ["Access code is required", { code: "ACCESS_CODE_REQUIRED", status: 401 }],
  ["Access code is invalid", { code: "ACCESS_CODE_INVALID", status: 401 }],
  ["Share link is not available", { code: "SHARE_NOT_AVAILABLE", status: 404 }],
  ["Share link is expired", { code: "SHARE_EXPIRED", status: 410 }],
  ["Share link is revoked", { code: "SHARE_REVOKED", status: 410 }],
  [
    "Recording is not part of this share board",
    { code: "RECORDING_NOT_SHARED", status: 404 },
  ],
  [
    "Recording playback source is unavailable",
    { code: "RECORDING_SOURCE_UNAVAILABLE", status: 404 },
  ],
  [
    "Recording version is stale",
    { code: "RECORDING_VERSION_STALE", status: 409 },
  ],
  [
    "Share board does not allow vendor submissions",
    { code: "REVIEW_VALIDATION_FAILED", status: 400 },
  ],
  [
    "Vendor review submission requires at least one item",
    { code: "REVIEW_VALIDATION_FAILED", status: 400 },
  ],
  [
    "Vendor rejection or change request requires a remark",
    { code: "REVIEW_VALIDATION_FAILED", status: 400 },
  ],
  [
    "Invalid vendor decision",
    { code: "REVIEW_VALIDATION_FAILED", status: 400 },
  ],
]);

export function publicAdmissionShareErrorResponse(
  error: unknown,
  logger: (message: string, error: unknown) => void = console.error,
) {
  if (isPublicAdmissionShareError(error)) {
    return responseForPublicError(
      error.code,
      error.statusCode,
      error.retryAfterSeconds,
    );
  }

  if (error instanceof Error) {
    const known = LEGACY_ERROR_MAP.get(error.message);
    if (known) {
      return responseForPublicError(known.code, known.status);
    }
  }

  logger("Public admission share route failed", error);
  return responseForPublicError("SHARE_SERVICE_UNAVAILABLE", 503);
}

export function publicAdmissionReviewDraftDto(
  draft: AdmissionReviewDraftDto,
): AdmissionReviewDraftDto {
  return {
    recordingSubmissionId: draft.recordingSubmissionId,
    recordingVersion: draft.recordingVersion,
    decision: draft.decision,
    remark: draft.remark,
    reasonCodes: draft.reasonCodes,
    revision: draft.revision,
    updatedAt: draft.updatedAt,
  };
}

function isPublicAdmissionShareError(error: unknown): error is {
  code: PublicAdmissionShareErrorCode;
  statusCode: number;
  retryAfterSeconds?: number;
} {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    code?: unknown;
    statusCode?: unknown;
    retryAfterSeconds?: unknown;
  };
  return (
    typeof candidate.code === "string" &&
    PUBLIC_ERROR_CODES.has(candidate.code as PublicAdmissionShareErrorCode) &&
    typeof candidate.statusCode === "number" &&
    (candidate.retryAfterSeconds === undefined ||
      typeof candidate.retryAfterSeconds === "number")
  );
}

function responseForPublicError(
  code: PublicAdmissionShareErrorCode,
  status: number,
  retryAfterSeconds?: number,
) {
  const response = NextResponse.json(
    {
      code,
      error: PUBLIC_ERROR_MESSAGES[code],
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    },
    { status },
  );
  if (retryAfterSeconds) {
    response.headers.set("Retry-After", String(retryAfterSeconds));
  }
  return response;
}
