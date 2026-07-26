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
    reviewerName: string;
    reviewerContact: string;
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
}: AdmissionSharePageClientProps) {
  const [shareBoard, setShareBoard] =
    useState<PublicAdmissionShareBoard | null>(null);
  const [vendorCheckpoints, setVendorCheckpoints] = useState<
    VendorCheckpointOption[]
  >([]);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [requiresUnlock, setRequiresUnlock] = useState(false);
  const [unlockCode, setUnlockCode] = useState("");
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
      setRequiresUnlock(false);
    } catch (error) {
      setShareBoard(null);
      setDrafts({});
      const message =
        error instanceof Error ? error.message : "无法读取复核链接";
      setRequiresUnlock(message === "Access code is required");
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [applyShareBoard, token]);

  useEffect(() => {
    let isCurrent = true;

    async function loadInitialShareBoard() {
      try {
        const nextShareBoard = await requestShareBoard(token);
        if (!isCurrent) {
          return;
        }
        applyShareBoard(nextShareBoard);
        setRequiresUnlock(false);
      } catch (error) {
        if (!isCurrent) {
          return;
        }
        setShareBoard(null);
        setDrafts({});
        const message =
          error instanceof Error ? error.message : "无法读取复核链接";
        setRequiresUnlock(message === "Access code is required");
        setErrorMessage(message);
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
  }, [applyShareBoard, token]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("accessCode")) {
      return;
    }
    url.searchParams.delete("accessCode");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  const unlockShareBoard = async () => {
    setIsUnlocking(true);
    setErrorMessage("");
    try {
      const response = await fetch(publicUnlockUrl(token), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: unlockCode }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, "访问码校验失败"));
      }
      setUnlockCode("");
      await loadShareBoard();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "访问码校验失败",
      );
    } finally {
      setIsUnlocking(false);
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
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewerName: "",
          reviewerContact: "",
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
          <div className="rounded-md border border-[var(--danger-600)] bg-[var(--danger-50)] px-4 py-3 text-sm text-[var(--danger-600)]">
            {errorMessage}
          </div>
        ) : null}

        {requiresUnlock ? (
          <section className="rounded-md border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
            <form
              className="flex max-w-md flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void unlockShareBoard();
              }}
            >
              <label className="grid gap-1 text-sm font-medium text-[var(--ink-700)]">
                访问码
                <input
                  className="h-10 rounded-md border border-[var(--line)] px-3 outline-none focus:border-[var(--blue-500)]"
                  type="password"
                  autoComplete="one-time-code"
                  value={unlockCode}
                  onChange={(event) => setUnlockCode(event.target.value)}
                />
              </label>
              <button
                className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--blue-600)] px-4 text-sm font-semibold text-white disabled:opacity-60"
                type="submit"
                disabled={isUnlocking || !unlockCode.trim()}
              >
                {isUnlocking ? "正在校验..." : "解锁复核链接"}
              </button>
            </form>
          </section>
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
            <section className="grid gap-3">
              {shareBoard.items.map((item, index) => (
                <article
                  className="grid gap-5 rounded-md border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)] lg:grid-cols-[minmax(360px,1fr)_minmax(300px,0.72fr)]"
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
                    <RecordingPlayer item={item} />
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
                                    ? "rounded-full border border-[var(--blue-500)] bg-[var(--blue-50)] px-3 py-1 text-xs font-medium text-[var(--blue-600)]"
                                    : "rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs text-[var(--ink-500)] hover:border-[var(--blue-300)]"
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

function RecordingPlayer({ item }: { item: PublicAdmissionShareItem }) {
  const sourceUrl = item.playbackUrl ?? item.recordingUrl;
  const streamerName = item.streamer.displayName || "主播";
  const externalUrl = item.recordingUrl ?? sourceUrl;

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
            平台录屏链接
          </div>
          <p className="mt-1 truncate text-xs text-[var(--ink-500)]">
            {sourceUrl}
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
      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--blue-600)] hover:text-[var(--blue-700)]"
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

function youtubeEmbedSource(sourceUrl: string) {
  const url = parseUrl(sourceUrl);
  if (!url) {
    return null;
  }

  let videoId: string | null = null;
  if (url.hostname.includes("youtu.be")) {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  }
  if (url.hostname.includes("youtube.com")) {
    videoId = url.searchParams.get("v");
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
    credentials: "same-origin",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(errorText(payload, "无法读取复核链接"));
  }
  return {
    shareBoard: payload.shareBoard as PublicAdmissionShareBoard,
    vendorCheckpoints: Array.isArray(payload.vendorCheckpoints)
      ? (payload.vendorCheckpoints as VendorCheckpointOption[])
      : [],
  };
}

function publicShareUrl(token: string) {
  return `/api/public/admission-share/${encodeURIComponent(token)}`;
}

function publicReviewUrl(token: string) {
  return `/api/public/admission-share/${encodeURIComponent(token)}/reviews`;
}

function publicUnlockUrl(token: string) {
  return `/api/public/admission-share/${encodeURIComponent(token)}/unlock`;
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
