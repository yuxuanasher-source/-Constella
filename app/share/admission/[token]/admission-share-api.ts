import type {
  AdmissionSharePlaybackErrorCode,
  AdmissionSharePlaybackSource,
  AdmissionShareReviewDraftDto,
  AdmissionShareReviewSubmitResult,
  PublicAdmissionShareBoardResponse,
  ReviewDraft,
  VendorAdmissionDecision,
} from "./admission-share-types";
import { normalizeAbsoluteHttpUrl } from "@/lib/http/safe-public-url";

type SaveAdmissionShareDraftInput = {
  expectedRevision: number;
  decision: VendorAdmissionDecision;
  remark: string;
  reasonCodes: string[];
};

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

export class PublicAdmissionShareApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "PublicAdmissionShareApiError";
  }
}

export async function loadAdmissionShareBoard(
  token: string,
): Promise<PublicAdmissionShareBoardResponse> {
  const response = await requestJson<PublicAdmissionShareBoardResponse>(
    shareUrl(token),
    {
      method: "GET",
    },
  );
  return {
    ...response,
    shareBoard: {
      ...response.shareBoard,
      items: response.shareBoard.items.map((item) => ({
        ...item,
        externalUrl: normalizeAbsoluteHttpUrl(item.externalUrl),
      })),
    },
  };
}

export async function loadAdmissionShareDrafts(
  token: string,
): Promise<AdmissionShareReviewDraftDto[]> {
  const payload = await requestJson<{
    drafts?: AdmissionShareReviewDraftDto[];
  }>(`${shareUrl(token)}/drafts`, { method: "GET" });
  return Array.isArray(payload.drafts) ? payload.drafts : [];
}

export async function saveAdmissionShareDraft(
  token: string,
  recordingSubmissionId: string,
  input: SaveAdmissionShareDraftInput,
): Promise<ReviewDraft> {
  const payload = await requestJson<AdmissionShareReviewDraftDto>(
    `${shareUrl(token)}/drafts/${encodeURIComponent(recordingSubmissionId)}`,
    {
      method: "PUT",
      keepalive: true,
      body: JSON.stringify({
        expectedRevision: input.expectedRevision,
        decision: input.decision,
        remark: input.remark,
        reasonCodes: input.reasonCodes,
      }),
    },
  );
  return {
    decision: payload.decision,
    remark: payload.remark,
    reasonCodes: payload.reasonCodes,
    revision: payload.revision,
    updatedAt: payload.updatedAt,
  };
}

export async function submitAdmissionShareReview(
  token: string,
  input: { projectRemark: string },
): Promise<AdmissionShareReviewSubmitResult> {
  return requestJson<AdmissionShareReviewSubmitResult>(
    `${shareUrl(token)}/reviews`,
    {
      method: "POST",
      body: JSON.stringify({ projectRemark: input.projectRemark }),
    },
  );
}

export async function reportAdmissionSharePlaybackIssue(
  token: string,
  recordingSubmissionId: string,
  input: {
    sourceType: AdmissionSharePlaybackSource;
    errorCode: AdmissionSharePlaybackErrorCode;
  },
): Promise<{ issueId: string }> {
  return requestJson<{ issueId: string }>(
    `${shareUrl(token)}/recordings/${encodeURIComponent(
      recordingSubmissionId,
    )}/issues`,
    {
      method: "POST",
      body: JSON.stringify({
        sourceType: input.sourceType,
        errorCode: input.errorCode,
      }),
    },
  );
}

export async function authenticateAdmissionShareAccess(
  token: string,
  accessCode: string,
): Promise<void> {
  await requestJson(`${shareUrl(token)}/access`, {
    method: "POST",
    body: JSON.stringify({ accessCode: accessCode.trim() }),
  });
}

async function requestJson<T>(
  url: string,
  init: Omit<RequestInit, "credentials" | "headers">,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      headers: jsonHeaders,
    });
  } catch (error) {
    throw new PublicAdmissionShareApiError(
      error instanceof Error ? error.message : "网络连接失败，请稍后重试。",
      "NETWORK_ERROR",
      0,
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw toApiError(payload, response.status);
  }
  return payload as T;
}

function toApiError(payload: unknown, status: number) {
  const body =
    payload && typeof payload === "object"
      ? (payload as {
          code?: unknown;
          error?: unknown;
          retryAfterSeconds?: unknown;
        })
      : {};
  return new PublicAdmissionShareApiError(
    typeof body.error === "string" && body.error.trim()
      ? body.error
      : "请求失败，请稍后重试。",
    typeof body.code === "string" ? body.code : "UNKNOWN",
    status,
    typeof body.retryAfterSeconds === "number"
      ? body.retryAfterSeconds
      : undefined,
  );
}

function shareUrl(token: string) {
  return `/api/public/admission-share/${encodeURIComponent(token)}`;
}
