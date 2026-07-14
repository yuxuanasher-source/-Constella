"use client";

import {
  ChevronRight,
  ExternalLink,
  FileVideo,
  PlayCircle,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

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
  pending: "待判断",
  selected: "选入",
  backup: "备选",
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
  const accessCode = initialAccessCode;
  const [shareBoard, setShareBoard] =
    useState<PublicAdmissionShareBoard | null>(null);
  const [vendorCheckpoints, setVendorCheckpoints] = useState<
    VendorCheckpointOption[]
  >([]);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [selectedRecordingSubmissionId, setSelectedRecordingSubmissionId] =
    useState("");
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
    ({
      shareBoard: nextShareBoard,
      vendorCheckpoints: nextCheckpoints,
    }: ShareBoardResponse) => {
      setShareBoard(nextShareBoard);
      setVendorCheckpoints(nextCheckpoints);
      setDrafts(toDrafts(nextShareBoard.items));
      setSelectedRecordingSubmissionId((current) =>
        nextShareBoard.items.some(
          (item) => item.recordingSubmissionId === current,
        )
          ? current
          : (nextShareBoard.items[0]?.recordingSubmissionId ?? ""),
      );
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
      setSelectedRecordingSubmissionId("");
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
        setSelectedRecordingSubmissionId("");
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

  const selectedItem = useMemo(
    () =>
      shareBoard?.items.find(
        (item) => item.recordingSubmissionId === selectedRecordingSubmissionId,
      ) ??
      shareBoard?.items[0] ??
      null,
    [selectedRecordingSubmissionId, shareBoard],
  );

  const selectedDraft = selectedItem
    ? (drafts[selectedItem.recordingSubmissionId] ?? {
        decision: "pending" as VendorDecision,
        remark: "",
        reasonCodes: [],
      })
    : null;

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
      const response = await fetch(publicReviewUrl(token, accessCode), {
        method: "POST",
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
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 rounded-md border border-[var(--line)] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[var(--blue-50)] text-[var(--blue-600)]">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--blue-600)]">
                录屏交付复核
              </p>
              <h1 className="truncate text-lg font-semibold tracking-normal text-[var(--ink-900)]">
                {shareBoard?.project.name ?? "录屏复核"}
              </h1>
              {vendorLine ? (
                <p className="truncate text-xs text-[var(--ink-500)]">
                  {vendorLine}
                </p>
              ) : null}
            </div>
          </div>

          {shareBoard ? (
            <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs sm:justify-end">
              <div className="flex items-baseline gap-2">
                <dt className="text-[var(--ink-400)]">录屏</dt>
                <dd className="font-semibold text-[var(--ink-900)]">
                  {shareBoard.items.length} 条
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-[var(--ink-400)]">状态</dt>
                <dd className="font-semibold text-[var(--blue-600)]">
                  {labelOf(shareBoard.status)}
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-[var(--ink-400)]">截止</dt>
                <dd className="font-medium text-[var(--ink-700)]">
                  {formatDateTime(shareBoard.expiresAt)}
                </dd>
              </div>
            </dl>
          ) : null}
        </header>

        {errorMessage ? (
          <div
            className="rounded-md border border-[var(--danger-600)] bg-[var(--danger-50)] px-4 py-3 text-sm text-[var(--danger-600)]"
            role="alert"
          >
            {errorMessage}
          </div>
        ) : null}

        {successMessage ? (
          <div
            className="rounded-md border border-[var(--ok-600)] bg-[var(--ok-50)] px-4 py-3 text-sm text-[var(--ok-600)]"
            aria-live="polite"
          >
            {successMessage}
          </div>
        ) : null}

        {isLoading ? (
          <section className="rounded-md border border-[var(--line)] bg-white p-5 text-sm text-[var(--ink-500)]">
            正在读取复核清单...
          </section>
        ) : null}

        {shareBoard ? (
          <section className="grid items-start gap-4 lg:grid-cols-[minmax(380px,0.9fr)_minmax(520px,1.1fr)]">
            <section
              aria-labelledby="recording-queue-heading"
              className="overflow-hidden rounded-md border border-[var(--line)] bg-white lg:sticky lg:top-4"
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
                <div>
                  <h2
                    id="recording-queue-heading"
                    className="text-sm font-semibold tracking-normal text-[var(--ink-900)]"
                  >
                    待审录屏明细
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--ink-400)]">
                    共 {shareBoard.items.length} 条录屏
                  </p>
                </div>
                <span className="rounded-sm bg-[var(--bg-soft)] px-2 py-1 text-xs font-medium text-[var(--ink-600)]">
                  {
                    shareBoard.items.filter(
                      (item) =>
                        (drafts[item.recordingSubmissionId]?.decision ??
                          "pending") !== "pending",
                    ).length
                  }
                  /{shareBoard.items.length} 已判断
                </span>
              </div>

              {shareBoard.items.length > 0 ? (
                <div
                  className="lg:max-h-[calc(100vh-178px)] lg:overflow-y-auto"
                  role="list"
                >
                  {shareBoard.items.map((item, index) => {
                    const isSelected =
                      item.recordingSubmissionId ===
                      selectedItem?.recordingSubmissionId;
                    const streamerName = item.streamer.displayName || "主播";
                    const accountLabel =
                      item.streamer.accountLabel || "未填写账号";
                    const sourceLabel = recordingSourceLabel(item);
                    const decision =
                      drafts[item.recordingSubmissionId]?.decision ?? "pending";

                    return (
                      <div
                        className="border-b border-[var(--line)] last:border-b-0"
                        key={item.recordingSubmissionId}
                        role="listitem"
                      >
                        <button
                          type="button"
                          aria-label={`${index + 1}. ${streamerName}，${accountLabel}，版本 ${item.recordingVersion}，${labelOf(item.recordingStatus)}，${sourceLabel}，当前决定 ${labelOf(decision)}`}
                          aria-pressed={isSelected}
                          onClick={() =>
                            setSelectedRecordingSubmissionId(
                              item.recordingSubmissionId,
                            )
                          }
                          className={`flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-150 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--blue-500)] ${
                            isSelected
                              ? "bg-[var(--blue-50)] ring-1 ring-inset ring-[var(--blue-400)]"
                              : "bg-white hover:bg-[var(--bg-soft)]"
                          }`}
                        >
                          <span
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-semibold ${
                              isSelected
                                ? "bg-[var(--blue-600)] text-white"
                                : "bg-[var(--bg-soft)] text-[var(--ink-500)]"
                            }`}
                          >
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[var(--ink-900)]">
                              {streamerName}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-[var(--ink-400)]">
                              {accountLabel}
                            </span>
                            <span className="mt-1 flex items-center gap-2 text-[11px] text-[var(--ink-500)] sm:hidden">
                              <span>v{item.recordingVersion}</span>
                              <span>{sourceLabel}</span>
                            </span>
                          </span>
                          <span className="hidden shrink-0 items-center gap-2 sm:flex">
                            <span className="text-xs font-medium text-[var(--ink-500)]">
                              v{item.recordingVersion}
                            </span>
                            <span className="rounded-sm bg-[var(--bg-soft)] px-2 py-1 text-[11px] text-[var(--ink-500)]">
                              {sourceLabel}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 rounded-sm px-2 py-1 text-[11px] font-medium ${decisionBadgeClass(decision)}`}
                          >
                            {labelOf(decision)}
                          </span>
                          <ChevronRight
                            className={`h-4 w-4 shrink-0 ${
                              isSelected
                                ? "text-[var(--blue-600)]"
                                : "text-[var(--ink-300)]"
                            }`}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-4 py-10 text-center text-sm text-[var(--ink-500)]">
                  暂无可复核录屏
                </div>
              )}
            </section>

            <aside
              aria-labelledby="recording-player-heading"
              className="overflow-hidden rounded-md border border-[var(--line)] bg-white lg:sticky lg:top-4 lg:max-h-[calc(100vh-32px)] lg:overflow-y-auto"
            >
              <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2
                    id="recording-player-heading"
                    className="text-sm font-semibold tracking-normal text-[var(--ink-900)]"
                  >
                    录屏播放器
                  </h2>
                  {selectedItem ? (
                    <p className="mt-0.5 truncate text-xs text-[var(--ink-400)]">
                      {selectedItem.streamer.displayName || "主播"} ·{" "}
                      {selectedItem.streamer.accountLabel || "未填写账号"}
                    </p>
                  ) : null}
                </div>
                {selectedItem ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-sm bg-[var(--bg-soft)] px-2 py-1 text-[var(--ink-600)]">
                      v{selectedItem.recordingVersion}
                    </span>
                    <span className="rounded-sm bg-[var(--blue-50)] px-2 py-1 font-medium text-[var(--blue-600)]">
                      {labelOf(selectedItem.recordingStatus)}
                    </span>
                  </div>
                ) : null}
              </div>

              {selectedItem && selectedDraft ? (
                <>
                  <div className="bg-[#0b1220] p-3 sm:p-4">
                    <RecordingPlayer
                      key={selectedItem.recordingSubmissionId}
                      item={selectedItem}
                    />
                  </div>

                  <div className="grid gap-4 border-t border-[var(--line)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[var(--ink-900)]">
                        复核结论
                      </h3>
                      {selectedItem.vendorReview ? (
                        <span className="text-xs text-[var(--ink-500)]">
                          上次反馈：
                          {labelOf(selectedItem.vendorReview.decision)}
                        </span>
                      ) : null}
                    </div>

                    <label className="grid gap-1.5 text-xs font-medium text-[var(--ink-700)]">
                      复核决定
                      <select
                        aria-label={`${selectedItem.streamer.displayName || "主播"} 决策`}
                        className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--blue-500)] focus:ring-1 focus:ring-[var(--blue-500)]"
                        value={selectedDraft.decision}
                        onChange={(event) =>
                          updateDraft(selectedItem.recordingSubmissionId, {
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
                      selectedDraft.decision,
                    ) ? (
                      <div className="grid gap-2 text-xs font-medium text-[var(--ink-700)]">
                        问题标签
                        <div className="flex flex-wrap gap-2">
                          {vendorCheckpoints.map((checkpoint) => {
                            const isChecked =
                              selectedDraft.reasonCodes.includes(
                                checkpoint.key,
                              );
                            return (
                              <button
                                key={checkpoint.key}
                                type="button"
                                aria-pressed={isChecked}
                                title={checkpoint.description}
                                onClick={() =>
                                  toggleReasonCode(
                                    selectedItem.recordingSubmissionId,
                                    checkpoint.key,
                                  )
                                }
                                className={
                                  isChecked
                                    ? "rounded-full border border-[var(--blue-500)] bg-[var(--blue-50)] px-3 py-1.5 text-xs font-medium text-[var(--blue-600)]"
                                    : "rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs text-[var(--ink-600)] hover:border-[var(--blue-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue-500)]"
                                }
                              >
                                {checkpoint.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <label className="grid gap-1.5 text-xs font-medium text-[var(--ink-700)]">
                      复核备注
                      <textarea
                        aria-label={`${selectedItem.streamer.displayName || "主播"} 备注`}
                        className="min-h-24 resize-y rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm leading-6 outline-none placeholder:text-[var(--ink-400)] focus:border-[var(--blue-500)] focus:ring-1 focus:ring-[var(--blue-500)]"
                        value={selectedDraft.remark}
                        onChange={(event) =>
                          updateDraft(selectedItem.recordingSubmissionId, {
                            remark: event.target.value,
                          })
                        }
                        placeholder="填写选入依据、拒绝原因或修改要求"
                      />
                    </label>
                  </div>

                  <div className="flex flex-col gap-3 border-t border-[var(--line)] bg-[var(--bg-soft)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="max-w-xl text-xs leading-5 text-[var(--ink-500)]">
                      提交包含清单内全部录屏的当前决定，并锁定对应录屏版本。
                    </p>
                    <button
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-[var(--blue-600)] px-4 text-sm font-semibold text-white hover:bg-[var(--blue-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue-500)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                      type="button"
                      onClick={() => void submitReviews()}
                      disabled={
                        isSubmitting ||
                        !shareBoard.allowVendorSubmit ||
                        shareBoard.status !== "active"
                      }
                    >
                      <Send className="h-4 w-4" aria-hidden="true" />
                      {isSubmitting ? "提交中..." : "提交复核"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="grid min-h-72 place-items-center px-4 py-10 text-center text-sm text-[var(--ink-500)]">
                  从左侧选择一条录屏
                </div>
              )}
            </aside>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function recordingSourceLabel(item: PublicAdmissionShareItem) {
  if (item.hasPrivateStorage && item.recordingUrl) {
    return "双来源";
  }
  if (item.hasPrivateStorage) {
    return "原始上传";
  }
  const sourceUrl = item.playbackUrl ?? item.recordingUrl;
  if (!sourceUrl) {
    return "无录屏";
  }
  if (platformEmbedSource(sourceUrl)) {
    return "平台链接";
  }
  if (isDirectVideoSource(sourceUrl)) {
    return "视频链接";
  }
  return "外部链接";
}

function decisionBadgeClass(decision: VendorDecision) {
  if (decision === "selected") {
    return "bg-[var(--ok-50)] text-[var(--ok-600)]";
  }
  if (decision === "backup") {
    return "bg-[var(--violet-50)] text-[var(--violet-600)]";
  }
  if (decision === "rejected") {
    return "bg-[var(--danger-50)] text-[var(--danger-600)]";
  }
  if (decision === "needs_changes") {
    return "bg-[var(--warn-50)] text-[var(--warn-600)]";
  }
  return "bg-[var(--ink-50)] text-[var(--ink-500)]";
}

function RecordingPlayer({ item }: { item: PublicAdmissionShareItem }) {
  const streamerName = item.streamer.displayName || "主播";
  const privatePlaybackUrl = item.hasPrivateStorage ? item.playbackUrl : null;
  const externalUrl =
    item.recordingUrl ?? (item.hasPrivateStorage ? null : item.playbackUrl);
  const [activeSource, setActiveSource] = useState<"private" | "external">(
    privatePlaybackUrl ? "private" : "external",
  );

  const hasBothSources = Boolean(privatePlaybackUrl && externalUrl);
  const isPrivateSource = Boolean(
    privatePlaybackUrl && (!externalUrl || activeSource === "private"),
  );
  const sourceUrl = isPrivateSource ? privatePlaybackUrl : externalUrl;

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

  const platformEmbedUrl = isPrivateSource
    ? null
    : platformEmbedSource(sourceUrl);
  let player: ReactNode;

  if (platformEmbedUrl) {
    player = (
      <>
        <iframe
          className="aspect-video w-full rounded-md border border-[var(--line)] bg-black"
          title={`${streamerName} 平台录屏播放器`}
          src={platformEmbedUrl}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
        <RecordingSourceLink href={externalUrl!} name={streamerName} />
      </>
    );
  } else if (isPrivateSource || isDirectVideoSource(sourceUrl)) {
    player = (
      <>
        <video
          aria-label={`${streamerName} 原始录屏播放器`}
          className="aspect-video w-full rounded-md border border-[var(--line)] bg-black"
          src={sourceUrl}
          controls
          preload="metadata"
        />
        {!isPrivateSource && externalUrl ? (
          <RecordingSourceLink href={externalUrl} name={streamerName} />
        ) : null}
      </>
    );
  } else {
    player = (
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
              <RecordingSourceLink href={sourceUrl} name={streamerName} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {hasBothSources ? (
        <div
          aria-label="录屏来源"
          className="inline-flex w-fit rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-0.5"
          role="group"
        >
          <button
            className={`h-8 rounded px-3 text-xs font-medium transition-colors ${
              isPrivateSource
                ? "bg-white text-[var(--blue-700)] shadow-sm"
                : "text-[var(--ink-500)] hover:text-[var(--ink-700)]"
            }`}
            onClick={() => setActiveSource("private")}
            type="button"
          >
            原始录屏
          </button>
          <button
            className={`h-8 rounded px-3 text-xs font-medium transition-colors ${
              !isPrivateSource
                ? "bg-white text-[var(--blue-700)] shadow-sm"
                : "text-[var(--ink-500)] hover:text-[var(--ink-700)]"
            }`}
            onClick={() => setActiveSource("external")}
            type="button"
          >
            {platformEmbedSource(externalUrl!) ? "平台链接" : "URL 链接"}
          </button>
        </div>
      ) : null}
      {player}
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

async function requestShareBoard(
  token: string,
  accessCode: string,
): Promise<ShareBoardResponse> {
  const response = await fetch(publicShareUrl(token, accessCode), {
    method: "GET",
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
