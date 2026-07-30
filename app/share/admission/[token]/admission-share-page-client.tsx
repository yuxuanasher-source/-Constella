"use client";

import {
  ExternalLink,
  FileVideo,
  PlayCircle,
  Send,
  ShieldCheck,
} from "lucide-react";
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
  playbackUrl: string | null;
  hasPrivateStorage: boolean;
  streamer: {
    id: string;
    displayName: string;
    accountLabel: string;
  };
  vendorReview: {
    decision: VendorDecision;
    remark: string;
    submittedAt: string;
  } | null;
};

type ReviewDraft = {
  decision: VendorDecision;
  remark: string;
  reasonCodes: string[];
};

type VendorCheckpointOption = {
  key: string;
  label: string;
  description: string;
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
  pending: "待判断",
  selected: "选入",
  backup: "备选",
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
  const [shareBoard, setShareBoard] =
    useState<PublicAdmissionShareBoard | null>(null);
  const [vendorCheckpoints, setVendorCheckpoints] = useState<
    VendorCheckpointOption[]
  >([]);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [needsAccessCode, setNeedsAccessCode] = useState(false);
  const [accessCodeInput, setAccessCodeInput] = useState("");
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

  const reviewedCount = useMemo(
    () =>
      shareBoard?.items.filter(
        (item) =>
          (drafts[item.recordingSubmissionId]?.decision ?? "pending") !==
          "pending",
      ).length ?? 0,
    [drafts, shareBoard],
  );

  const applyShareBoard = useCallback(
    ({
      shareBoard: nextShareBoard,
      vendorCheckpoints: nextCheckpoints,
    }: ShareBoardResponse) => {
      setShareBoard(nextShareBoard);
      setVendorCheckpoints(nextCheckpoints);
      setDrafts(toDrafts(nextShareBoard.items));
    },
    [],
  );

  const loadShareBoard = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      applyShareBoard(await requestShareBoard(token));
      setNeedsAccessCode(false);
    } catch (error) {
      setShareBoard(null);
      setDrafts({});
      const requestError = toShareRequestError(error, "无法读取复核链接");
      setNeedsAccessCode(isAccessCodeError(requestError));
      setErrorMessage(requestError.message);
    } finally {
      setIsLoading(false);
    }
  }, [applyShareBoard, token]);

  useEffect(() => {
    let isCurrent = true;

    async function loadInitialShareBoard() {
      try {
        const legacyAccessCode =
          initialAccessCode.trim() || readLegacyAccessCodeFromUrl();
        if (legacyAccessCode) {
          clearLegacyAccessCodeFromUrl(token);
          await authenticateShareAccess(token, legacyAccessCode);
        }
        const nextShareBoard = await requestShareBoard(token);
        if (!isCurrent) {
          return;
        }
        applyShareBoard(nextShareBoard);
        setNeedsAccessCode(false);
      } catch (error) {
        if (!isCurrent) {
          return;
        }
        setShareBoard(null);
        setDrafts({});
        const requestError = toShareRequestError(error, "无法读取复核链接");
        setNeedsAccessCode(isAccessCodeError(requestError));
        setErrorMessage(requestError.message);
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

  const submitAccessCode = async () => {
    const normalizedAccessCode = accessCodeInput.trim();
    if (!normalizedAccessCode) {
      setErrorMessage("请输入访问码后继续。");
      return;
    }

    setIsAuthenticating(true);
    setErrorMessage("");
    try {
      await authenticateShareAccess(token, normalizedAccessCode);
      setAccessCodeInput("");
      await loadShareBoard();
    } catch (error) {
      const requestError = toShareRequestError(error, "访问码验证失败");
      setNeedsAccessCode(true);
      setErrorMessage(requestError.message);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const updateDraft = (
    recordingSubmissionId: string,
    patch: Partial<ReviewDraft>,
  ) => {
    setDrafts((current) => {
      const existing = current[recordingSubmissionId] ?? {
        decision: "pending",
        remark: "",
        reasonCodes: [],
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

  const toggleReasonCode = (recordingSubmissionId: string, code: string) => {
    setDrafts((current) => {
      const existing = current[recordingSubmissionId] ?? {
        decision: "pending" as VendorDecision,
        remark: "",
        reasonCodes: [] as string[],
      };
      const reasonCodes = existing.reasonCodes.includes(code)
        ? existing.reasonCodes.filter((item) => item !== code)
        : [...existing.reasonCodes, code];
      return {
        ...current,
        [recordingSubmissionId]: { ...existing, reasonCodes },
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
      reasonCodes: drafts[item.recordingSubmissionId]?.reasonCodes ?? [],
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
      const response = await fetch(publicReviewUrl(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: payloadItems,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw shareRequestError(payload, "提交复核失败", response.status);
      }

      const result = payload as SubmitResult;
      await loadShareBoard();
      setSuccessMessage(
        `提交成功：${result.submittedCount} 条反馈，${result.syncedCount} 条已同步，${result.skippedCount} 条仅记录`,
      );
    } catch (error) {
      const requestError = toShareRequestError(error, "提交复核失败");
      if (isAccessCodeError(requestError)) {
        setShareBoard(null);
        setNeedsAccessCode(true);
      }
      setErrorMessage(requestError.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink-900)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-md border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-[var(--blue-50)] px-3 py-1 text-xs font-semibold text-[var(--blue-600)]">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  录屏交付复核包
                </span>
                <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-medium text-[var(--ink-500)]">
                  甲方验收视图
                </span>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-normal text-[var(--ink-900)]">
                {shareBoard?.project.name ?? "录屏复核"}
              </h1>
              {vendorLine ? (
                <p className="mt-2 text-sm text-[var(--ink-500)]">
                  {vendorLine}
                </p>
              ) : null}
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ink-600)]">
                本页面用于甲方集中查看乙方提交的主播选播录屏，并对候选结果给出复核意见。录屏、版本与提交动作均按当前分享链接受控校验。
              </p>
            </div>

            {shareBoard ? (
              <dl className="grid min-w-[260px] grid-cols-3 gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-3 text-center">
                <div>
                  <dt className="text-[11px] text-[var(--ink-400)]">录屏数</dt>
                  <dd className="mt-1 text-lg font-semibold text-[var(--ink-900)]">
                    {shareBoard.items.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-[var(--ink-400)]">状态</dt>
                  <dd className="mt-1 text-sm font-semibold text-[var(--blue-600)]">
                    {labelOf(shareBoard.status)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-[var(--ink-400)]">截止</dt>
                  <dd className="mt-1 text-xs font-medium text-[var(--ink-700)]">
                    {formatDateTime(shareBoard.expiresAt)}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
        </section>

        {errorMessage ? (
          <div
            className="flex flex-col gap-3 rounded-md border border-[var(--danger-600)] bg-[var(--danger-50)] px-4 py-3 text-sm text-[var(--danger-600)] sm:flex-row sm:items-center sm:justify-between"
            role="alert"
            aria-label={errorMessage}
          >
            <span>{errorMessage}</span>
            {!needsAccessCode && !shareBoard && !isLoading ? (
              <button
                className="min-h-11 shrink-0 rounded-md border border-[var(--danger-600)] bg-white px-4 font-semibold hover:bg-[var(--danger-50)]"
                type="button"
                onClick={() => void loadShareBoard()}
              >
                重试
              </button>
            ) : null}
          </div>
        ) : null}

        {successMessage ? (
          <div
            className="rounded-md border border-[var(--ok-600)] bg-[var(--ok-50)] px-4 py-3 text-sm text-[var(--ok-600)]"
            role="status"
            aria-live="polite"
          >
            {successMessage}
          </div>
        ) : null}

        {isLoading ? (
          <section
            className="rounded-md border border-[var(--line)] bg-white p-5 text-sm text-[var(--ink-500)]"
            role="status"
            aria-live="polite"
          >
            正在读取复核清单...
          </section>
        ) : null}

        {!isLoading && needsAccessCode && !shareBoard ? (
          <section className="mx-auto w-full max-w-md rounded-md border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
            <h2 className="text-lg font-semibold text-[var(--ink-900)]">
              此分享需要访问码
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-500)]">
              请输入分享方提供的访问码。验证成功后，本设备会保存安全会话，地址栏不会保留访问码。
            </p>
            <label className="mt-4 grid gap-1.5 text-sm font-medium text-[var(--ink-700)]">
              访问码
              <input
                className="min-h-11 rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none focus:border-[var(--blue-500)]"
                type="password"
                autoComplete="one-time-code"
                value={accessCodeInput}
                onChange={(event) => setAccessCodeInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitAccessCode();
                  }
                }}
              />
            </label>
            <button
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[var(--blue-600)] px-5 text-sm font-semibold text-white hover:bg-[var(--blue-700)] disabled:cursor-not-allowed disabled:opacity-60"
              type="button"
              disabled={isAuthenticating}
              onClick={() => void submitAccessCode()}
            >
              {isAuthenticating ? "正在验证…" : "验证访问码"}
            </button>
          </section>
        ) : null}

        {shareBoard ? (
          <>
            <section className="grid gap-3">
              {shareBoard.items.map((item, index) => (
                <article
                  className="grid gap-5 rounded-md border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5 lg:grid-cols-[minmax(360px,1fr)_minmax(300px,0.72fr)]"
                  key={item.recordingSubmissionId}
                >
                  <div className="grid gap-4">
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
                    <RecordingPlayer
                      key={`${item.recordingSubmissionId}:${item.playbackUrl ?? ""}:${item.recordingUrl ?? ""}`}
                      item={item}
                    />
                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ink-500)]">
                      <span className="rounded-sm bg-[var(--ink-50)] px-2 py-1">
                        版本 {item.recordingVersion}
                      </span>
                      <span className="rounded-sm bg-[var(--ink-50)] px-2 py-1">
                        {labelOf(item.recordingStatus)}
                      </span>
                      <span className="rounded-sm bg-[var(--ink-50)] px-2 py-1">
                        {item.hasPrivateStorage ? "原始上传" : "外部链接"}
                      </span>
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
                        className="min-h-11 rounded-md border border-[var(--line)] bg-white px-3 text-base outline-none focus:border-[var(--blue-500)] sm:text-sm"
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
                    {vendorCheckpoints.length > 0 &&
                    ["rejected", "needs_changes"].includes(
                      drafts[item.recordingSubmissionId]?.decision ?? "",
                    ) ? (
                      <div className="grid gap-1 text-xs font-medium text-[var(--ink-700)]">
                        问题标签（可多选，帮助主播针对性修改）
                        <div className="flex flex-wrap gap-2">
                          {vendorCheckpoints.map((checkpoint) => {
                            const selected = (
                              drafts[item.recordingSubmissionId]?.reasonCodes ??
                              []
                            ).includes(checkpoint.key);
                            return (
                              <button
                                key={checkpoint.key}
                                type="button"
                                title={checkpoint.description}
                                onClick={() =>
                                  toggleReasonCode(
                                    item.recordingSubmissionId,
                                    checkpoint.key,
                                  )
                                }
                                className={
                                  selected
                                    ? "min-h-11 rounded-full border border-[var(--blue-500)] bg-[var(--blue-50)] px-3 py-2 text-xs font-medium text-[var(--blue-600)]"
                                    : "min-h-11 rounded-full border border-[var(--line)] bg-white px-3 py-2 text-xs text-[var(--ink-500)] hover:border-[var(--blue-300)]"
                                }
                              >
                                {checkpoint.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
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

            <div className="sticky bottom-0 -mx-4 border-t border-[var(--line)] bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
              <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--ink-900)]">
                    已判断 {reviewedCount} / {shareBoard.items.length}
                  </p>
                  <p className="mt-0.5 hidden text-xs text-[var(--ink-500)] sm:block">
                    提交会锁定当前录屏版本；录屏更新后需刷新再提交。
                  </p>
                </div>
                <button
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-[var(--blue-600)] px-5 text-sm font-semibold text-white shadow-[var(--shadow-fab)] hover:bg-[var(--blue-700)] disabled:cursor-not-allowed disabled:opacity-60"
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

function RecordingPlayer({ item }: { item: PublicAdmissionShareItem }) {
  const sourceUrl = item.playbackUrl ?? item.recordingUrl;
  const streamerName = item.streamer.displayName || "主播";
  const externalUrl = item.recordingUrl ?? sourceUrl;
  const [playbackFailed, setPlaybackFailed] = useState(false);

  if (!sourceUrl) {
    return (
      <div className="grid aspect-video place-items-center rounded-md border border-dashed border-[var(--line)] bg-[var(--bg-soft)] text-sm text-[var(--ink-500)]">
        <div className="flex flex-col items-center gap-2">
          <FileVideo
            className="h-7 w-7 text-[var(--ink-300)]"
            aria-hidden="true"
          />
          暂无可播放录屏
        </div>
      </div>
    );
  }

  if (playbackFailed) {
    return (
      <div className="grid aspect-video place-items-center rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-5 text-center">
        <div>
          <div className="text-sm font-semibold text-[var(--ink-900)]">
            视频加载失败
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-500)]">
            当前浏览器无法播放此来源，请在新窗口打开原始链接。
          </p>
          {externalUrl ? (
            <div className="mt-3">
              <RecordingSourceLink href={externalUrl} name={streamerName} />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const platformEmbedUrl = platformEmbedSource(sourceUrl);
  if (platformEmbedUrl) {
    return (
      <div className="grid gap-2">
        <iframe
          className="aspect-video w-full rounded-md border border-[var(--line)] bg-black"
          title={`${streamerName} 平台录屏播放器`}
          src={platformEmbedUrl}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          onError={() => setPlaybackFailed(true)}
        />
        {externalUrl ? (
          <RecordingSourceLink href={externalUrl} name={streamerName} />
        ) : null}
      </div>
    );
  }

  if (item.hasPrivateStorage || isDirectVideoSource(sourceUrl)) {
    return (
      <div className="grid gap-2">
        <video
          aria-label={`${streamerName} 原始录屏播放器`}
          className="aspect-video w-full rounded-md border border-[var(--line)] bg-black"
          src={sourceUrl}
          controls
          preload="metadata"
          onError={() => setPlaybackFailed(true)}
        />
        {externalUrl ? (
          <RecordingSourceLink href={externalUrl} name={streamerName} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white text-[var(--blue-600)]">
          <PlayCircle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--ink-900)]">
            平台链接无法内嵌播放
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-500)]">
            请在新窗口打开原始链接继续查看。
          </p>
          <div className="mt-3">
            <RecordingSourceLink
              href={externalUrl ?? sourceUrl}
              name={streamerName}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function RecordingSourceLink({ href, name }: { href: string; name: string }) {
  return (
    <a
      className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--blue-600)] hover:bg-[var(--blue-50)] hover:text-[var(--blue-700)]"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      打开 {name} 原始链接
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

function platformEmbedSource(sourceUrl: string) {
  return bilibiliEmbedSource(sourceUrl) ?? youtubeEmbedSource(sourceUrl);
}

function bilibiliEmbedSource(sourceUrl: string) {
  const url = parseUrl(sourceUrl);
  if (!url || !url.hostname.includes("bilibili.com")) {
    return null;
  }

  const videoId = url.pathname.match(/\/video\/([^/?#]+)/)?.[1];
  if (!videoId) {
    return null;
  }

  const params = new URLSearchParams();
  if (videoId.toUpperCase().startsWith("BV")) {
    params.set("bvid", videoId);
  } else {
    params.set("aid", videoId.replace(/^av/i, ""));
  }
  return `https://player.bilibili.com/player.html?${params.toString()}`;
}

export function youtubeEmbedSource(sourceUrl: string) {
  const url = parseUrl(sourceUrl);
  if (!url) {
    return null;
  }

  let videoId: string | null = null;
  if (url.hostname === "youtu.be" || url.hostname.endsWith(".youtu.be")) {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  }
  if (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) {
    videoId =
      url.searchParams.get("v") ??
      url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/)?.[1] ??
      null;
  }
  return videoId
    ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`
    : null;
}

function isDirectVideoSource(sourceUrl: string) {
  const url = parseUrl(sourceUrl);
  const pathname = (url?.pathname ?? sourceUrl).toLowerCase();
  return [".mp4", ".webm", ".mov", ".m4v", ".ogg"].some((extension) =>
    pathname.endsWith(extension),
  );
}

function parseUrl(sourceUrl: string) {
  try {
    return new URL(sourceUrl, "https://delivery.local");
  } catch {
    return null;
  }
}

function toDrafts(items: PublicAdmissionShareItem[]) {
  return Object.fromEntries(
    items.map((item) => [
      item.recordingSubmissionId,
      {
        decision: item.vendorReview?.decision ?? "pending",
        remark: item.vendorReview?.remark ?? "",
        reasonCodes: [],
      },
    ]),
  ) as Record<string, ReviewDraft>;
}

type ShareBoardResponse = {
  shareBoard: PublicAdmissionShareBoard;
  vendorCheckpoints: VendorCheckpointOption[];
};

async function requestShareBoard(token: string): Promise<ShareBoardResponse> {
  const response = await fetch(publicShareUrl(token), {
    method: "GET",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw shareRequestError(payload, "无法读取复核链接", response.status);
  }
  return {
    shareBoard: payload.shareBoard as PublicAdmissionShareBoard,
    vendorCheckpoints: Array.isArray(payload.vendorCheckpoints)
      ? (payload.vendorCheckpoints as VendorCheckpointOption[])
      : [],
  };
}

async function authenticateShareAccess(token: string, accessCode: string) {
  const response = await fetch(
    `/api/public/admission-share/${encodeURIComponent(token)}/access`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode: accessCode.trim() }),
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    throw shareRequestError(payload, "访问码验证失败", response.status);
  }
}

function clearLegacyAccessCodeFromUrl(token: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.history.replaceState(
    window.history.state,
    "",
    `/share/admission/${encodeURIComponent(token)}`,
  );
}

function readLegacyAccessCodeFromUrl() {
  if (typeof window === "undefined") {
    return "";
  }
  return (
    new URLSearchParams(window.location.search).get("accessCode")?.trim() ?? ""
  );
}

function publicShareUrl(token: string) {
  return `/api/public/admission-share/${encodeURIComponent(token)}`;
}

function publicReviewUrl(token: string) {
  return `/api/public/admission-share/${encodeURIComponent(token)}/reviews`;
}

class ShareRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function shareRequestError(payload: unknown, fallback: string, status = 0) {
  const body =
    payload && typeof payload === "object"
      ? (payload as { code?: unknown; error?: unknown })
      : {};
  return new ShareRequestError(
    typeof body.error === "string" && body.error.trim() ? body.error : fallback,
    typeof body.code === "string" ? body.code : "UNKNOWN",
    status,
  );
}

function toShareRequestError(error: unknown, fallback: string) {
  return error instanceof ShareRequestError
    ? error
    : new ShareRequestError(
        error instanceof Error ? error.message : fallback,
        "UNKNOWN",
        0,
      );
}

function isAccessCodeError(error: ShareRequestError) {
  return (
    error.code === "ACCESS_CODE_REQUIRED" ||
    error.code === "ACCESS_CODE_INVALID"
  );
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
