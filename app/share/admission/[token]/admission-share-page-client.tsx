"use client";

import { ExternalLink, RefreshCcw, Send, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type VendorDecision =
  | "pending"
  | "selected"
  | "backup"
  | "rejected"
  | "needs_changes";

type PublicAdmissionShareBoard = {
  id: string;
  title: string;
  status: "active" | "expired" | "revoked";
  expiresAt: string;
  allowVendorSubmit: boolean;
  project: {
    id: string;
    code: string;
    name: string;
    vendor: string;
    product: string;
  };
  items: PublicAdmissionShareItem[];
};

type PublicAdmissionShareItem = {
  applicationId: string;
  applicationStatus: string;
  recordingSubmissionId: string;
  recordingVersion: number;
  recordingStatus: string;
  recordingUrl: string | null;
  hasPrivateStorage: boolean;
  streamer: {
    id: string;
    displayName: string;
    accountLabel: string;
  };
  vendorReview: {
    decision: VendorDecision;
    remark: string;
    reviewerName: string;
    reviewerContact: string;
    submittedAt: string;
  } | null;
};

type ReviewDraft = {
  decision: VendorDecision;
  remark: string;
};

type SubmitResult = {
  submittedCount: number;
  syncedCount: number;
  skippedCount: number;
};

type AdmissionSharePageClientProps = {
  token: string;
  initialAccessCode?: string;
};

const decisionOptions: Array<{ value: VendorDecision; label: string }> = [
  { value: "pending", label: "待判断" },
  { value: "selected", label: "选入" },
  { value: "backup", label: "备选" },
  { value: "rejected", label: "拒绝" },
  { value: "needs_changes", label: "需修改" },
];

const statusLabels: Record<string, string> = {
  active: "可复核",
  expired: "已过期",
  revoked: "已撤销",
  submitted: "已提交",
  reviewing: "复核中",
  approved: "已通过",
  rejected: "已拒绝",
  needs_changes: "需修改",
  recording_reviewing: "录屏复核中",
  recording_approved: "录屏已通过",
  recording_rejected: "录屏已拒绝",
  recording_required: "需补录",
  joined: "已入项",
};

export default function AdmissionSharePageClient({
  token,
  initialAccessCode = "",
}: AdmissionSharePageClientProps) {
  const [accessCode, setAccessCode] = useState(initialAccessCode);
  const [shareBoard, setShareBoard] =
    useState<PublicAdmissionShareBoard | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [reviewerName, setReviewerName] = useState("");
  const [reviewerContact, setReviewerContact] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const vendorLine = useMemo(() => {
    if (!shareBoard) {
      return "";
    }
    return [shareBoard.project.vendor, shareBoard.project.product]
      .filter(Boolean)
      .join(" / ");
  }, [shareBoard]);

  const applyShareBoard = useCallback(
    (nextShareBoard: PublicAdmissionShareBoard) => {
      setShareBoard(nextShareBoard);
      setDrafts(toDrafts(nextShareBoard.items));
      const firstReview = nextShareBoard.items.find(
        (item) => item.vendorReview,
      )?.vendorReview;
      if (firstReview) {
        setReviewerName(firstReview.reviewerName);
        setReviewerContact(firstReview.reviewerContact);
      }
    },
    [],
  );

  const loadShareBoard = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      applyShareBoard(await requestShareBoard(token, accessCode));
    } catch (error) {
      setShareBoard(null);
      setDrafts({});
      setErrorMessage(
        error instanceof Error ? error.message : "无法读取复核链接",
      );
    } finally {
      setIsLoading(false);
    }
  }, [accessCode, applyShareBoard, token]);

  useEffect(() => {
    let isCurrent = true;

    async function loadInitialShareBoard() {
      try {
        const nextShareBoard = await requestShareBoard(
          token,
          initialAccessCode,
        );
        if (!isCurrent) {
          return;
        }
        applyShareBoard(nextShareBoard);
      } catch (error) {
        if (!isCurrent) {
          return;
        }
        setShareBoard(null);
        setDrafts({});
        setErrorMessage(
          error instanceof Error ? error.message : "无法读取复核链接",
        );
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialShareBoard();

    return () => {
      isCurrent = false;
    };
  }, [applyShareBoard, initialAccessCode, token]);

  const updateDraft = (
    recordingSubmissionId: string,
    patch: Partial<ReviewDraft>,
  ) => {
    setDrafts((current) => {
      const existing = current[recordingSubmissionId] ?? {
        decision: "pending",
        remark: "",
      };
      return {
        ...current,
        [recordingSubmissionId]: {
          ...existing,
          ...patch,
        },
      };
    });
  };

  const submitReviews = async () => {
    if (!shareBoard) {
      return;
    }

    const payloadItems = shareBoard.items.map((item) => ({
      recordingSubmissionId: item.recordingSubmissionId,
      recordingVersion: item.recordingVersion,
      decision: drafts[item.recordingSubmissionId]?.decision ?? "pending",
      remark: drafts[item.recordingSubmissionId]?.remark ?? "",
    }));
    const missingRemark = payloadItems.some(
      (item) =>
        (item.decision === "rejected" || item.decision === "needs_changes") &&
        !item.remark.trim(),
    );
    if (missingRemark) {
      setErrorMessage("拒绝或需修改时请填写原因");
      setSuccessMessage("");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await fetch(publicReviewUrl(token, accessCode), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewerName,
          reviewerContact,
          items: payloadItems,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, "提交复核失败"));
      }

      const result = payload as SubmitResult;
      await loadShareBoard();
      setSuccessMessage(
        `提交成功：${result.submittedCount} 条反馈，${result.syncedCount} 条已同步，${result.skippedCount} 条仅记录`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "提交复核失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink-900)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-md border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--blue-600)]">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                主播录屏复核
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-normal">
                {shareBoard?.project.name ?? "录屏复核"}
              </h1>
              {vendorLine ? (
                <p className="mt-1 text-sm text-[var(--ink-500)]">
                  {vendorLine}
                </p>
              ) : null}
              {shareBoard ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-500)]">
                  <span className="rounded-sm border border-[var(--line)] px-2 py-1">
                    {shareBoard.title}
                  </span>
                  <span className="rounded-sm border border-[var(--line)] px-2 py-1">
                    {labelOf(shareBoard.status)}
                  </span>
                  <span className="rounded-sm border border-[var(--line)] px-2 py-1">
                    截止 {formatDateTime(shareBoard.expiresAt)}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(0,180px)_auto]">
              <label className="grid gap-1 text-xs font-medium text-[var(--ink-700)]">
                访问码
                <input
                  className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--blue-500)]"
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value)}
                  placeholder="如链接要求填写"
                />
              </label>
              <button
                className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-sm font-medium text-[var(--ink-700)] hover:border-[var(--blue-300)] disabled:cursor-not-allowed disabled:opacity-60 sm:mt-[22px]"
                type="button"
                onClick={() => void loadShareBoard()}
                disabled={isLoading}
              >
                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                刷新
              </button>
            </div>
          </div>
        </section>

        {errorMessage ? (
          <div className="rounded-md border border-[var(--danger-600)] bg-[var(--danger-50)] px-4 py-3 text-sm text-[var(--danger-600)]">
            {errorMessage}
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-md border border-[var(--ok-600)] bg-[var(--ok-50)] px-4 py-3 text-sm text-[var(--ok-600)]">
            {successMessage}
          </div>
        ) : null}

        {isLoading ? (
          <section className="rounded-md border border-[var(--line)] bg-white p-5 text-sm text-[var(--ink-500)]">
            正在读取复核清单...
          </section>
        ) : null}

        {shareBoard ? (
          <>
            <section className="grid gap-4 rounded-md border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)] md:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium text-[var(--ink-700)]">
                复核人姓名
                <input
                  className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--blue-500)]"
                  value={reviewerName}
                  onChange={(event) => setReviewerName(event.target.value)}
                  placeholder="填写复核人"
                />
              </label>
              <label className="grid gap-1 text-xs font-medium text-[var(--ink-700)]">
                联系方式
                <input
                  className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--blue-500)]"
                  value={reviewerContact}
                  onChange={(event) => setReviewerContact(event.target.value)}
                  placeholder="手机号、邮箱或 IM"
                />
              </label>
            </section>

            <section className="grid gap-3">
              {shareBoard.items.map((item, index) => (
                <article
                  className="grid gap-4 rounded-md border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)] lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.68fr)]"
                  key={item.recordingSubmissionId}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--blue-50)] text-xs font-semibold text-[var(--blue-600)]">
                        {index + 1}
                      </span>
                      <h2 className="text-lg font-semibold tracking-normal">
                        {item.streamer.displayName || "主播"}
                      </h2>
                      <span className="rounded-sm border border-[var(--line)] px-2 py-1 text-xs text-[var(--ink-500)]">
                        {labelOf(item.applicationStatus)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--ink-500)]">
                      {item.streamer.accountLabel || "未填写账号"}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ink-500)]">
                      <span className="rounded-sm bg-[var(--ink-50)] px-2 py-1">
                        版本 {item.recordingVersion}
                      </span>
                      <span className="rounded-sm bg-[var(--ink-50)] px-2 py-1">
                        {labelOf(item.recordingStatus)}
                      </span>
                      {item.recordingUrl ? (
                        <a
                          className="inline-flex items-center gap-1 rounded-sm bg-[var(--blue-50)] px-2 py-1 font-medium text-[var(--blue-600)]"
                          href={item.recordingUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看录屏
                          <ExternalLink
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        </a>
                      ) : (
                        <span className="rounded-sm bg-[var(--warn-50)] px-2 py-1 text-[var(--warn-600)]">
                          {item.hasPrivateStorage ? "私有录屏" : "无录屏链接"}
                        </span>
                      )}
                    </div>
                    {item.vendorReview ? (
                      <div className="mt-4 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-3 text-sm">
                        <div className="text-xs font-medium text-[var(--ink-500)]">
                          最近一次厂家反馈
                        </div>
                        <div className="mt-1 font-medium">
                          {labelOf(item.vendorReview.decision)}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-3">
                    <label className="grid gap-1 text-xs font-medium text-[var(--ink-700)]">
                      {item.streamer.displayName || "主播"} 决策
                      <select
                        className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--blue-500)]"
                        value={
                          drafts[item.recordingSubmissionId]?.decision ??
                          "pending"
                        }
                        onChange={(event) =>
                          updateDraft(item.recordingSubmissionId, {
                            decision: event.target.value as VendorDecision,
                          })
                        }
                      >
                        {decisionOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs font-medium text-[var(--ink-700)]">
                      {item.streamer.displayName || "主播"} 备注
                      <textarea
                        className="min-h-28 resize-y rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-500)]"
                        value={drafts[item.recordingSubmissionId]?.remark ?? ""}
                        onChange={(event) =>
                          updateDraft(item.recordingSubmissionId, {
                            remark: event.target.value,
                          })
                        }
                        placeholder="填写选入原因、拒绝原因或修改要求"
                      />
                    </label>
                  </div>
                </article>
              ))}
            </section>

            <div className="sticky bottom-0 -mx-4 border-t border-[var(--line)] bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
              <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-[var(--ink-500)]">
                  提交会携带当前录屏版本；若期间录屏更新，系统会拒绝旧版本反馈。
                </p>
                <button
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--blue-600)] px-5 text-sm font-semibold text-white shadow-[var(--shadow-fab)] hover:bg-[var(--blue-700)] disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  onClick={() => void submitReviews()}
                  disabled={
                    isSubmitting ||
                    !shareBoard.allowVendorSubmit ||
                    shareBoard.status !== "active"
                  }
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  提交复核
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}

function toDrafts(items: PublicAdmissionShareItem[]) {
  return Object.fromEntries(
    items.map((item) => [
      item.recordingSubmissionId,
      {
        decision: item.vendorReview?.decision ?? "pending",
        remark: item.vendorReview?.remark ?? "",
      },
    ]),
  ) as Record<string, ReviewDraft>;
}

async function requestShareBoard(token: string, accessCode: string) {
  const response = await fetch(publicShareUrl(token, accessCode), {
    method: "GET",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(errorText(payload, "无法读取复核链接"));
  }
  return payload.shareBoard as PublicAdmissionShareBoard;
}

function publicShareUrl(token: string, accessCode: string) {
  return `/api/public/admission-share/${encodeURIComponent(token)}${queryString(
    accessCode,
  )}`;
}

function publicReviewUrl(token: string, accessCode: string) {
  return `/api/public/admission-share/${encodeURIComponent(token)}/reviews${queryString(
    accessCode,
  )}`;
}

function queryString(accessCode: string) {
  const trimmed = accessCode.trim();
  return trimmed ? `?accessCode=${encodeURIComponent(trimmed)}` : "";
}

function errorText(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

function labelOf(value: string) {
  return statusLabels[value] ?? value;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
