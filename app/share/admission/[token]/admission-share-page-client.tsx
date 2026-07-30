"use client";

import {
  CheckCircle2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  authenticateAdmissionShareAccess,
  loadAdmissionShareBoard,
  loadAdmissionShareDrafts,
  PublicAdmissionShareApiError,
  reportAdmissionSharePlaybackIssue,
  saveAdmissionShareDraft,
  submitAdmissionShareReview,
} from "./admission-share-api";
import { AdmissionShareReviewWorkspace } from "./admission-share-review-workspace";
import type {
  AdmissionSharePlaybackSource,
  PublicAdmissionShareBoard,
  ReviewDraft,
  ReviewDraftSaveState,
  VendorCheckpointOption,
} from "./admission-share-types";

type AdmissionSharePageClientProps = {
  token: string;
  initialAccessCode?: string;
};

type PageError = {
  code: string;
  message: string;
};

const emptyDraft = (): ReviewDraft => ({
  decision: "pending",
  remark: "",
  reasonCodes: [],
  revision: 0,
  updatedAt: null,
});

export default function AdmissionSharePageClient({
  token,
  initialAccessCode = "",
}: AdmissionSharePageClientProps) {
  const [board, setBoard] = useState<PublicAdmissionShareBoard | null>(null);
  const [reasonOptions, setReasonOptions] = useState<VendorCheckpointOption[]>(
    [],
  );
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [saveState, setSaveState] = useState<
    Record<string, ReviewDraftSaveState>
  >({});
  const [activeRecordingId, setActiveRecordingId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [needsAccessCode, setNeedsAccessCode] = useState(false);
  const [accessCodeInput, setAccessCodeInput] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [pageError, setPageError] = useState<PageError | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [projectRemark, setProjectRemark] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mountedRef = useRef(true);
  const boardRef = useRef<PublicAdmissionShareBoard | null>(null);
  const draftsRef = useRef<Record<string, ReviewDraft>>({});
  const saveStateRef = useRef<Record<string, ReviewDraftSaveState>>({});
  const editEpochRef = useRef(new Map<string, number>());
  const savedEpochRef = useRef(new Map<string, number>());
  const saveChainsRef = useRef(new Map<string, Promise<void>>());
  const remarkTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const conflictIdsRef = useRef(new Set<string>());
  const failedIdsRef = useRef(new Set<string>());
  const loadEpochRef = useRef(0);
  const hydrationGenerationRef = useRef(0);
  const submittingRef = useRef(false);

  const updateSaveState = useCallback(
    (recordingSubmissionId: string, state: ReviewDraftSaveState) => {
      const next = {
        ...saveStateRef.current,
        [recordingSubmissionId]: state,
      };
      saveStateRef.current = next;
      if (mountedRef.current) {
        setSaveState(next);
      }
    },
    [],
  );

  const updateDraftFromRef = useCallback(
    (
      recordingSubmissionId: string,
      updater: (current: ReviewDraft) => ReviewDraft,
    ) => {
      const current = draftsRef.current[recordingSubmissionId] ?? emptyDraft();
      const next = {
        ...draftsRef.current,
        [recordingSubmissionId]: updater(current),
      };
      draftsRef.current = next;
      if (mountedRef.current) {
        setDrafts(next);
      }
    },
    [],
  );

  const saveDraftNow = useCallback(
    async (recordingSubmissionId: string) => {
      const currentBoard = boardRef.current;
      const snapshot = draftsRef.current[recordingSubmissionId];
      if (
        !currentBoard ||
        currentBoard.mode !== "formal_review" ||
        !currentBoard.canSubmit ||
        !snapshot
      ) {
        return;
      }

      const saveEpoch = editEpochRef.current.get(recordingSubmissionId) ?? 0;
      const hydrationGeneration = hydrationGenerationRef.current;
      if (
        saveEpoch <= (savedEpochRef.current.get(recordingSubmissionId) ?? 0) &&
        !failedIdsRef.current.has(recordingSubmissionId)
      ) {
        return;
      }

      updateSaveState(recordingSubmissionId, "saving");
      try {
        const saved = await saveAdmissionShareDraft(
          token,
          recordingSubmissionId,
          {
            expectedRevision: snapshot.revision,
            decision: snapshot.decision,
            remark: snapshot.remark,
            reasonCodes: snapshot.reasonCodes,
          },
        );
        if (hydrationGeneration !== hydrationGenerationRef.current) {
          return;
        }
        const latestEpoch =
          editEpochRef.current.get(recordingSubmissionId) ?? 0;
        updateDraftFromRef(recordingSubmissionId, (latestLocal) =>
          latestEpoch === saveEpoch
            ? saved
            : {
                ...latestLocal,
                revision: saved.revision,
                updatedAt: saved.updatedAt,
              },
        );
        conflictIdsRef.current.delete(recordingSubmissionId);
        failedIdsRef.current.delete(recordingSubmissionId);
        if (latestEpoch === saveEpoch) {
          savedEpochRef.current.set(recordingSubmissionId, saveEpoch);
          updateSaveState(recordingSubmissionId, "saved");
        } else {
          updateSaveState(recordingSubmissionId, "idle");
        }
      } catch (error) {
        if (hydrationGeneration !== hydrationGenerationRef.current) {
          return;
        }
        failedIdsRef.current.add(recordingSubmissionId);
        updateSaveState(recordingSubmissionId, "failed");
        const requestError = normalizePageError(
          error,
          "草稿暂时无法保存，请保留页面并稍后重试。",
        );
        if (requestError.code === "DRAFT_CONFLICT") {
          conflictIdsRef.current.add(recordingSubmissionId);
          clearRemarkTimer(recordingSubmissionId, remarkTimersRef.current);
        }
        if (mountedRef.current) {
          setPageError(requestError);
        }
      }
    },
    [token, updateDraftFromRef, updateSaveState],
  );

  const queueDraftSave = useCallback(
    (
      recordingSubmissionId: string,
      { force = false }: { force?: boolean } = {},
    ) => {
      clearRemarkTimer(recordingSubmissionId, remarkTimersRef.current);
      if (conflictIdsRef.current.has(recordingSubmissionId) && !force) {
        return Promise.resolve();
      }

      const currentEpoch = editEpochRef.current.get(recordingSubmissionId) ?? 0;
      if (
        !force &&
        currentEpoch <= (savedEpochRef.current.get(recordingSubmissionId) ?? 0)
      ) {
        return (
          saveChainsRef.current.get(recordingSubmissionId) ?? Promise.resolve()
        );
      }

      updateSaveState(recordingSubmissionId, "saving");
      const previous = saveChainsRef.current.get(recordingSubmissionId);
      const next = previous
        ? previous
            .catch(() => undefined)
            .then(() => saveDraftNow(recordingSubmissionId))
        : saveDraftNow(recordingSubmissionId);
      saveChainsRef.current.set(recordingSubmissionId, next);
      void next.finally(() => {
        if (saveChainsRef.current.get(recordingSubmissionId) === next) {
          saveChainsRef.current.delete(recordingSubmissionId);
        }
      });
      return next;
    },
    [saveDraftNow, updateSaveState],
  );

  const flushAllDrafts = useCallback(async () => {
    const currentBoard = boardRef.current;
    if (!currentBoard || currentBoard.mode !== "formal_review") {
      return;
    }
    const saves = currentBoard.items.map((item) =>
      queueDraftSave(item.recordingSubmissionId),
    );
    await Promise.all(saves);
  }, [queueDraftSave]);

  const applyHydratedBoard = useCallback(
    (
      nextBoard: PublicAdmissionShareBoard,
      nextReasons: VendorCheckpointOption[],
      remoteDrafts: Awaited<ReturnType<typeof loadAdmissionShareDrafts>>,
    ) => {
      hydrationGenerationRef.current += 1;
      for (const timer of remarkTimersRef.current.values()) {
        clearTimeout(timer);
      }
      remarkTimersRef.current.clear();
      saveChainsRef.current.clear();
      conflictIdsRef.current.clear();
      failedIdsRef.current.clear();
      editEpochRef.current.clear();
      savedEpochRef.current.clear();

      const remoteByRecording = new Map(
        remoteDrafts.map((draft) => [draft.recordingSubmissionId, draft]),
      );
      const nextDrafts =
        nextBoard.mode === "formal_review"
          ? Object.fromEntries(
              nextBoard.items.map((item) => {
                const remote = remoteByRecording.get(
                  item.recordingSubmissionId,
                );
                const draft =
                  remote && remote.recordingVersion === item.recordingVersion
                    ? {
                        decision: remote.decision,
                        remark: remote.remark,
                        reasonCodes: remote.reasonCodes,
                        revision: remote.revision,
                        updatedAt: remote.updatedAt,
                      }
                    : emptyDraft();
                return [item.recordingSubmissionId, draft];
              }),
            )
          : {};
      const nextSaveState =
        nextBoard.mode === "formal_review"
          ? Object.fromEntries(
              nextBoard.items.map((item) => [
                item.recordingSubmissionId,
                remoteByRecording.has(item.recordingSubmissionId)
                  ? "saved"
                  : "idle",
              ]),
            )
          : {};

      boardRef.current = nextBoard;
      draftsRef.current = nextDrafts;
      saveStateRef.current = nextSaveState as Record<
        string,
        ReviewDraftSaveState
      >;
      if (!mountedRef.current) {
        return;
      }
      setBoard(nextBoard);
      setReasonOptions(nextReasons);
      setDrafts(nextDrafts);
      setSaveState(nextSaveState as Record<string, ReviewDraftSaveState>);
      setActiveRecordingId((current) =>
        nextBoard.items.some((item) => item.recordingSubmissionId === current)
          ? current
          : (nextBoard.items[0]?.recordingSubmissionId ?? ""),
      );
      setNeedsAccessCode(false);
      if (nextBoard.reviewState === "submitted_locked") {
        setIsSummaryOpen(false);
      }
    },
    [],
  );

  const hydrate = useCallback(
    async ({
      showLoading = true,
      clearSuccess = true,
    }: {
      showLoading?: boolean;
      clearSuccess?: boolean;
    } = {}) => {
      const loadEpoch = ++loadEpochRef.current;
      if (mountedRef.current) {
        if (showLoading) {
          setIsLoading(true);
        }
        setPageError(null);
        if (clearSuccess) {
          setSuccessMessage("");
        }
      }
      try {
        // The board request may create the HttpOnly session that protects
        // formal drafts, so draft hydration follows it. Preview links never
        // touch the draft route.
        const response = await loadAdmissionShareBoard(token);
        const remoteDrafts =
          response.shareBoard.mode === "formal_review"
            ? await loadAdmissionShareDrafts(token)
            : [];
        if (!mountedRef.current || loadEpoch !== loadEpochRef.current) {
          return;
        }
        applyHydratedBoard(
          response.shareBoard,
          response.vendorCheckpoints,
          remoteDrafts,
        );
      } catch (error) {
        if (!mountedRef.current || loadEpoch !== loadEpochRef.current) {
          return;
        }
        const requestError = normalizePageError(
          error,
          "无法读取复核链接，请稍后重试。",
        );
        setPageError(requestError);
        setNeedsAccessCode(isAccessCodeError(requestError));
        if (!boardRef.current) {
          setBoard(null);
          setDrafts({});
        }
      } finally {
        if (mountedRef.current && loadEpoch === loadEpochRef.current) {
          setIsLoading(false);
        }
      }
    },
    [applyHydratedBoard, token],
  );

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function initialize() {
      const legacyAccessCode =
        initialAccessCode.trim() || readLegacyAccessCodeFromUrl();
      if (legacyAccessCode) {
        clearLegacyAccessCodeFromUrl(token);
        try {
          await authenticateAdmissionShareAccess(token, legacyAccessCode);
        } catch (error) {
          if (!cancelled && mountedRef.current) {
            const requestError = normalizePageError(
              error,
              "访问码验证失败，请重新输入。",
            );
            setNeedsAccessCode(true);
            setPageError(requestError);
            setIsLoading(false);
          }
          return;
        }
      }
      if (!cancelled) {
        await hydrate();
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [hydrate, initialAccessCode, token]);

  useEffect(() => {
    const remarkTimers = remarkTimersRef.current;
    const handleBeforeUnload = () => {
      void flushAllDrafts();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      void flushAllDrafts();
      mountedRef.current = false;
      for (const timer of remarkTimers.values()) {
        clearTimeout(timer);
      }
      remarkTimers.clear();
    };
  }, [flushAllDrafts]);

  const updateDraft = useCallback(
    (recordingSubmissionId: string, patch: Partial<ReviewDraft>) => {
      const nextEpoch =
        (editEpochRef.current.get(recordingSubmissionId) ?? 0) + 1;
      editEpochRef.current.set(recordingSubmissionId, nextEpoch);
      const hasConflict = conflictIdsRef.current.has(recordingSubmissionId);
      if (!hasConflict) {
        failedIdsRef.current.delete(recordingSubmissionId);
      }
      updateDraftFromRef(recordingSubmissionId, (current) => ({
        ...current,
        ...patch,
        revision: current.revision,
        updatedAt: current.updatedAt,
      }));
      updateSaveState(recordingSubmissionId, hasConflict ? "failed" : "idle");
      if (hasConflict) {
        return;
      }

      if (
        Object.keys(patch).length === 1 &&
        Object.prototype.hasOwnProperty.call(patch, "remark")
      ) {
        clearRemarkTimer(recordingSubmissionId, remarkTimersRef.current);
        const timer = setTimeout(() => {
          remarkTimersRef.current.delete(recordingSubmissionId);
          void queueDraftSave(recordingSubmissionId);
        }, 500);
        remarkTimersRef.current.set(recordingSubmissionId, timer);
      } else {
        void queueDraftSave(recordingSubmissionId);
      }
    },
    [queueDraftSave, updateDraftFromRef, updateSaveState],
  );

  const changeActiveRecording = useCallback(
    (nextRecordingId: string) => {
      if (activeRecordingId && activeRecordingId !== nextRecordingId) {
        void queueDraftSave(activeRecordingId);
      }
      setActiveRecordingId(nextRecordingId);
    },
    [activeRecordingId, queueDraftSave],
  );

  const retryDraft = useCallback(
    (recordingSubmissionId: string) => {
      if (conflictIdsRef.current.has(recordingSubmissionId)) {
        void hydrate({ showLoading: false });
        return;
      }
      void queueDraftSave(recordingSubmissionId, { force: true });
    },
    [hydrate, queueDraftSave],
  );

  const openSummary = useCallback(() => {
    const currentBoard = boardRef.current;
    if (
      !currentBoard ||
      currentBoard.mode !== "formal_review" ||
      !currentBoard.items.every((item) =>
        isDraftComplete(draftsRef.current[item.recordingSubmissionId]),
      )
    ) {
      setPageError({
        code: "REVIEW_INCOMPLETE",
        message: "复核尚未完成，请补全所有录屏结论、负向备注和问题原因。",
      });
      return;
    }
    setPageError(null);
    setIsSummaryOpen(true);
  }, []);

  const submitReview = useCallback(async () => {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    if (mountedRef.current) {
      setIsSubmitting(true);
      setPageError(null);
    }
    try {
      await flushAllDrafts();
      if (failedIdsRef.current.size > 0) {
        throw new PublicAdmissionShareApiError(
          "仍有草稿未保存，请重试保存后再提交。",
          "DRAFT_SAVE_FAILED",
          503,
        );
      }
      await submitAdmissionShareReview(token, {
        projectRemark: projectRemark.trim(),
      });
      await hydrate({ showLoading: false, clearSuccess: false });
      if (mountedRef.current) {
        setProjectRemark("");
        setSuccessMessage("本轮复核已提交并锁定");
      }
    } catch (error) {
      if (mountedRef.current) {
        setPageError(normalizePageError(error, "提交复核失败，请稍后重试。"));
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, [flushAllDrafts, hydrate, projectRemark, token]);

  const reportPlaybackIssue = useCallback(
    async (
      recordingSubmissionId: string,
      sourceType: AdmissionSharePlaybackSource,
    ) => {
      try {
        await reportAdmissionSharePlaybackIssue(token, recordingSubmissionId, {
          sourceType,
          errorCode:
            sourceType === "external"
              ? "EXTERNAL_LINK_FAILED"
              : sourceType === "original"
                ? "MEDIA_LOAD_FAILED"
                : "NO_PLAYABLE_SOURCE",
        });
        if (mountedRef.current) {
          setSuccessMessage("播放问题已反馈，运营会尽快处理。");
          setPageError(null);
        }
      } catch (error) {
        if (mountedRef.current) {
          setPageError(
            normalizePageError(error, "播放问题反馈失败，请稍后重试。"),
          );
        }
      }
    },
    [token],
  );

  const submitAccessCode = useCallback(async () => {
    const normalized = accessCodeInput.trim();
    if (!normalized) {
      setPageError({
        code: "ACCESS_CODE_REQUIRED",
        message: "请输入访问码后继续。",
      });
      return;
    }
    setIsAuthenticating(true);
    setPageError(null);
    try {
      await authenticateAdmissionShareAccess(token, normalized);
      setAccessCodeInput("");
      await hydrate();
    } catch (error) {
      setNeedsAccessCode(true);
      setPageError(normalizePageError(error, "访问码验证失败，请重新输入。"));
    } finally {
      if (mountedRef.current) {
        setIsAuthenticating(false);
      }
    }
  }, [accessCodeInput, hydrate, token]);

  const reviewCounts = useMemo(
    () => reviewSummary(board, drafts),
    [board, drafts],
  );

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink-900)]">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-3 py-4 sm:px-5 lg:px-6">
        <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--blue-600)]">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                受控录屏复核
              </span>
              {board ? (
                <span className="text-[var(--ink-500)]">
                  第 {board.roundNumber} 轮 ·{" "}
                  {board.mode === "formal_review" ? "正式复核" : "预览"}
                </span>
              ) : null}
            </div>
            <h1 className="mt-2 truncate text-xl font-semibold tracking-normal text-[var(--ink-900)]">
              {board?.title || board?.project.name || "录屏复核工作台"}
            </h1>
            {board ? (
              <p className="mt-1 max-w-[72ch] text-sm leading-6 text-[var(--ink-500)]">
                {[board.project.name, board.purpose]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
          {board ? (
            <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              <div>
                <dt className="text-[var(--ink-500)]">进度</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">
                  {board.progress.completed}/{board.progress.total}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--ink-500)]">截止时间</dt>
                <dd className="mt-0.5 font-semibold">
                  {formatDateTime(board.expiresAt)}
                </dd>
              </div>
            </dl>
          ) : null}
        </header>

        {pageError ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-md border border-[var(--danger-600)] bg-[var(--danger-50)] px-4 py-3 text-sm text-[var(--danger-600)] sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{pageError.message}</span>
            {pageError.code === "DRAFT_CONFLICT" ? (
              <button
                type="button"
                className={dangerButtonClass}
                onClick={() => void hydrate({ showLoading: false })}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                刷新最新结果
              </button>
            ) : !needsAccessCode && !isLoading ? (
              <button
                type="button"
                className={dangerButtonClass}
                onClick={() => void hydrate()}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                重试
              </button>
            ) : null}
          </div>
        ) : null}

        {successMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded-md border border-[var(--ok-600)] bg-[var(--ok-50)] px-4 py-3 text-sm font-medium text-[var(--ok-600)]"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {successMessage}
          </div>
        ) : null}

        {isLoading ? <WorkspaceSkeleton /> : null}

        {!isLoading && needsAccessCode && !board ? (
          <AccessCodePanel
            value={accessCodeInput}
            isAuthenticating={isAuthenticating}
            onChange={setAccessCodeInput}
            onSubmit={() => void submitAccessCode()}
          />
        ) : null}

        {!isLoading && board?.reviewState === "submitted_locked" ? (
          <LockedReviewReceipt board={board} />
        ) : null}

        {!isLoading && board ? (
          <AdmissionShareReviewWorkspace
            board={board}
            drafts={drafts}
            saveState={saveState}
            activeRecordingId={
              activeRecordingId || board.items[0]?.recordingSubmissionId || ""
            }
            onActiveRecordingChange={changeActiveRecording}
            onDraftChange={updateDraft}
            onRetryDraft={retryDraft}
            onOpenSubmissionSummary={openSummary}
            onReportPlaybackIssue={(recordingSubmissionId, sourceType) =>
              void reportPlaybackIssue(recordingSubmissionId, sourceType)
            }
            reasonOptions={reasonOptions}
          />
        ) : null}
      </div>

      {isSummaryOpen && board ? (
        <SubmissionSummaryDialog
          counts={reviewCounts}
          projectRemark={projectRemark}
          isSubmitting={isSubmitting}
          onProjectRemarkChange={setProjectRemark}
          onClose={() => setIsSummaryOpen(false)}
          onSubmit={() => void submitReview()}
        />
      ) : null}
    </main>
  );
}

function SubmissionSummaryDialog({
  counts,
  projectRemark,
  isSubmitting,
  onProjectRemarkChange,
  onClose,
  onSubmit,
}: {
  counts: Record<
    "selected" | "backup" | "rejected" | "needs_changes" | "pending",
    number
  >;
  projectRemark: string;
  isSubmitting: boolean;
  onProjectRemarkChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const remarkRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    remarkRef.current?.focus();
  }, []);

  const close = () => {
    onClose();
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>("[data-submission-summary-trigger]")
        ?.focus(),
    );
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape" && !isSubmitting) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(11,23,51,0.45)] p-4">
      <dialog
        ref={dialogRef}
        open
        aria-label="提交复核汇总"
        aria-modal="true"
        className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-0 text-[var(--ink-900)] shadow-[var(--shadow-pop)]"
        onCancel={(event) => {
          event.preventDefault();
          if (!isSubmitting) {
            close();
          }
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">提交复核汇总</h2>
            <p className="mt-1 text-xs text-[var(--ink-500)]">
              提交后本轮锁定；如需调整须由 MCN 重新开启。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭提交汇总"
            className="grid h-10 w-10 place-items-center rounded-md outline-none hover:bg-[var(--ink-50)] focus-visible:ring-2 focus-visible:ring-[var(--blue-500)]"
            disabled={isSubmitting}
            onClick={close}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] sm:grid-cols-5">
            {[
              ["入选", counts.selected],
              ["备选", counts.backup],
              ["需修改", counts.needs_changes],
              ["拒绝", counts.rejected],
              ["待判断", counts.pending],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-white px-3 py-3">
                <dt className="text-xs text-[var(--ink-500)]">{label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <label className="mt-5 grid gap-1.5 text-xs font-semibold text-[var(--ink-700)]">
            项目整体备注
            <textarea
              ref={remarkRef}
              className="min-h-24 resize-y rounded-md border border-[var(--line)] px-3 py-2 text-sm font-normal leading-6 outline-none placeholder:text-[var(--ink-500)] focus:border-[var(--blue-500)] focus:ring-2 focus:ring-[var(--blue-100)]"
              value={projectRemark}
              maxLength={2000}
              placeholder="可补充本轮整体判断；单条结论以已保存草稿为准"
              onChange={(event) => onProjectRemarkChange(event.target.value)}
            />
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-[var(--line)] px-5 py-4">
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={isSubmitting}
            onClick={close}
          >
            返回检查
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--blue-600)] px-5 text-sm font-semibold text-white outline-none hover:bg-[var(--blue-700)] focus-visible:ring-2 focus-visible:ring-[var(--blue-500)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            onClick={onSubmit}
          >
            {isSubmitting ? "正在提交…" : "确认提交复核"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function AccessCodePanel({
  value,
  isAuthenticating,
  onChange,
  onSubmit,
}: {
  value: string;
  isAuthenticating: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section className="mx-auto w-full max-w-md rounded-lg border border-[var(--line)] bg-white p-5">
      <h2 className="text-base font-semibold">此分享需要访问码</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--ink-500)]">
        验证后本设备会保存安全会话，地址栏不会保留访问码。
      </p>
      <label className="mt-4 grid gap-1.5 text-sm font-medium">
        访问码
        <input
          className="min-h-11 rounded-md border border-[var(--line)] px-3 text-base outline-none focus:border-[var(--blue-500)] focus:ring-2 focus:ring-[var(--blue-100)]"
          type="password"
          autoComplete="one-time-code"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      </label>
      <button
        type="button"
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[var(--blue-600)] px-4 text-sm font-semibold text-white outline-none hover:bg-[var(--blue-700)] focus-visible:ring-2 focus-visible:ring-[var(--blue-500)] focus-visible:ring-offset-2 disabled:opacity-60"
        disabled={isAuthenticating}
        onClick={onSubmit}
      >
        {isAuthenticating ? "正在验证…" : "验证访问码"}
      </button>
    </section>
  );
}

function LockedReviewReceipt({ board }: { board: PublicAdmissionShareBoard }) {
  const submission = board.latestSubmission;
  return (
    <section className="flex flex-col gap-3 rounded-md border border-[var(--ok-600)] bg-[var(--ok-50)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <LockKeyhole
          className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ok-600)]"
          aria-hidden="true"
        />
        <div>
          <h2 className="text-sm font-semibold text-[var(--ok-600)]">
            本轮复核已提交并锁定
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-700)]">
            {submission
              ? `提交于 ${formatDateTime(submission.submittedAt)}，回执修订 ${submission.revision}。`
              : "结果已锁定，如需调整请联系 MCN 重新开启。"}
          </p>
        </div>
      </div>
      {submission ? (
        <span className="text-xs font-medium tabular-nums text-[var(--ink-700)]">
          入选 {submission.summary.selected} · 备选 {submission.summary.backup}{" "}
          · 需修改 {submission.summary.needsChanges} · 拒绝{" "}
          {submission.summary.rejected}
        </span>
      ) : null}
    </section>
  );
}

function WorkspaceSkeleton() {
  return (
    <section
      aria-label="正在读取复核工作台"
      role="status"
      aria-live="polite"
      className="grid min-h-[680px] overflow-hidden rounded-lg border border-[var(--line)] bg-white lg:grid-cols-[280px_minmax(0,1fr)_340px]"
    >
      <span className="sr-only">正在读取复核工作台…</span>
      <div className="animate-pulse border-r border-[var(--line)] bg-[var(--bg-soft)] p-4 motion-reduce:animate-none">
        <div className="h-4 w-24 rounded bg-[var(--ink-100)]" />
        <div className="mt-5 grid gap-3">
          <div className="h-14 rounded bg-white" />
          <div className="h-14 rounded bg-white" />
          <div className="h-14 rounded bg-white" />
        </div>
      </div>
      <div className="grid place-items-center bg-[var(--ink-900)] p-5">
        <div className="aspect-video w-full max-w-4xl animate-pulse rounded-md bg-black motion-reduce:animate-none" />
      </div>
      <div className="animate-pulse border-l border-[var(--line)] p-5 motion-reduce:animate-none">
        <div className="h-4 w-28 rounded bg-[var(--ink-100)]" />
        <div className="mt-5 h-24 rounded bg-[var(--ink-50)]" />
        <div className="mt-4 h-28 rounded bg-[var(--ink-50)]" />
      </div>
    </section>
  );
}

function reviewSummary(
  board: PublicAdmissionShareBoard | null,
  drafts: Record<string, ReviewDraft>,
) {
  const summary = {
    selected: 0,
    backup: 0,
    rejected: 0,
    needs_changes: 0,
    pending: 0,
  };
  for (const item of board?.items ?? []) {
    const decision = drafts[item.recordingSubmissionId]?.decision ?? "pending";
    summary[decision] += 1;
  }
  return summary;
}

function isDraftComplete(draft: ReviewDraft | undefined) {
  if (!draft || draft.decision === "pending") {
    return false;
  }
  if (draft.decision === "rejected" || draft.decision === "needs_changes") {
    return Boolean(draft.remark.trim() && draft.reasonCodes.length > 0);
  }
  return true;
}

function clearRemarkTimer(
  recordingSubmissionId: string,
  timers: Map<string, ReturnType<typeof setTimeout>>,
) {
  const timer = timers.get(recordingSubmissionId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(recordingSubmissionId);
  }
}

function normalizePageError(error: unknown, fallback: string): PageError {
  if (error instanceof PublicAdmissionShareApiError) {
    return { code: error.code, message: error.message };
  }
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    return {
      code: typeof candidate.code === "string" ? candidate.code : "UNKNOWN",
      message:
        typeof candidate.message === "string" && candidate.message.trim()
          ? candidate.message
          : fallback,
    };
  }
  return { code: "UNKNOWN", message: fallback };
}

function isAccessCodeError(error: PageError) {
  return (
    error.code === "ACCESS_CODE_REQUIRED" ||
    error.code === "ACCESS_CODE_INVALID"
  );
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

const dangerButtonClass =
  "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-[var(--danger-600)] bg-white px-3 text-xs font-semibold outline-none hover:bg-[var(--danger-50)] focus-visible:ring-2 focus-visible:ring-[var(--danger-600)] focus-visible:ring-offset-2";

const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--line)] bg-white px-4 text-sm font-semibold outline-none hover:bg-[var(--ink-50)] focus-visible:ring-2 focus-visible:ring-[var(--blue-500)] focus-visible:ring-offset-2 disabled:opacity-60";
