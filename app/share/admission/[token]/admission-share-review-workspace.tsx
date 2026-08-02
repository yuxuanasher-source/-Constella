"use client";

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileVideo,
  ListFilter,
  LoaderCircle,
  Menu,
  RotateCcw,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from "react";

import { normalizeAbsoluteHttpUrl } from "@/lib/http/safe-public-url";
import { normalizePublishedBrand } from "@/features/organizations/organization-brand";

import type {
  AdmissionSharePlaybackSource,
  BrandedPublicAdmissionShareBoard,
  PublicAdmissionShareBoard,
  ReviewDraft,
  ReviewDraftSaveState,
  VendorCheckpointOption,
} from "./admission-share-types";

export type AdmissionShareReviewWorkspaceProps = {
  board: PublicAdmissionShareBoard | BrandedPublicAdmissionShareBoard;
  drafts: Record<string, ReviewDraft>;
  saveState: Record<string, ReviewDraftSaveState>;
  activeRecordingId: string;
  onActiveRecordingChange: (recordingSubmissionId: string) => void;
  onDraftChange: (
    recordingSubmissionId: string,
    patch: Partial<ReviewDraft>,
  ) => void;
  onRetryDraft: (recordingSubmissionId: string) => void;
  onOpenSubmissionSummary: () => void;
  onReportPlaybackIssue: (
    recordingSubmissionId: string,
    sourceType: AdmissionSharePlaybackSource,
  ) => Promise<boolean>;
  reasonOptions?: VendorCheckpointOption[];
  brandUiEnabled?: boolean;
};

export type MediaStageState =
  | "idle"
  | "loading"
  | "playing"
  | "error"
  | "unavailable";

const decisionOptions = [
  { value: "selected", label: "入选" },
  { value: "backup", label: "备选" },
  { value: "needs_changes", label: "需修改" },
  { value: "rejected", label: "拒绝" },
] as const;

const decisionLabels = {
  pending: "待判断",
  selected: "入选",
  backup: "备选",
  needs_changes: "需修改",
  rejected: "拒绝",
} as const;

const saveLabels: Record<ReviewDraftSaveState, string> = {
  idle: "尚未保存",
  saving: "保存中",
  saved: "已保存",
  failed: "保存失败",
};

export function AdmissionShareReviewWorkspace({
  board,
  drafts,
  saveState,
  activeRecordingId,
  onActiveRecordingChange,
  onDraftChange,
  onRetryDraft,
  onOpenSubmissionSummary,
  onReportPlaybackIssue,
  reasonOptions = [],
  brandUiEnabled = false,
}: AdmissionShareReviewWorkspaceProps) {
  const [pendingOnly, setPendingOnly] = useState(false);
  const [isListOpen, setIsListOpen] = useState(false);
  const [playbackReportState, setPlaybackReportState] = useState<{
    boardId: string;
    reports: Record<string, "idle" | "reporting" | "reported" | "failed">;
  }>(() => ({ boardId: board.id, reports: {} }));
  const listTriggerRef = useRef<HTMLButtonElement>(null);
  const playbackReportLocksRef = useRef(new Map<string, number>());
  const nextPlaybackReportRequestIdRef = useRef(0);
  const mountedRef = useRef(false);
  const currentBoardIdRef = useRef(board.id);
  const currentRecordingIdRef = useRef(activeRecordingId);
  const previousRecordingIdRef = useRef(activeRecordingId);
  const currentPlaybackReports =
    playbackReportState.boardId === board.id ? playbackReportState.reports : {};
  const activeIndex = Math.max(
    0,
    board.items.findIndex(
      (item) => item.recordingSubmissionId === activeRecordingId,
    ),
  );
  const activeItem = board.items[activeIndex] ?? board.items[0];
  const isFormal = board.mode === "formal_review";
  const isLocked = board.reviewState === "submitted_locked";
  const isEditable = isFormal && board.canSubmit && !isLocked;
  const activeDraft = activeItem
    ? drafts[activeItem.recordingSubmissionId]
    : undefined;
  const canOpenSummary = useMemo(
    () =>
      isEditable &&
      board.items.every((item) =>
        isDraftComplete(drafts[item.recordingSubmissionId]),
      ),
    [board.items, drafts, isEditable],
  );

  useEffect(() => {
    const playbackReportLocks = playbackReportLocksRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      playbackReportLocks.clear();
    };
  }, []);

  useEffect(() => {
    currentBoardIdRef.current = board.id;
    playbackReportLocksRef.current.clear();
  }, [board.id]);

  useEffect(() => {
    currentRecordingIdRef.current = activeRecordingId;
    const previousRecordingId = previousRecordingIdRef.current;
    previousRecordingIdRef.current = activeRecordingId;
    if (previousRecordingId === activeRecordingId) {
      return;
    }
    playbackReportLocksRef.current.delete(
      `${currentBoardIdRef.current}:${previousRecordingId}`,
    );
    setPlaybackReportState((current) => {
      if (current.reports[previousRecordingId] !== "reporting") {
        return current;
      }
      const reports = { ...current.reports };
      delete reports[previousRecordingId];
      return { ...current, reports };
    });
  }, [activeRecordingId]);

  const closeListAndRestoreFocus = () => {
    setIsListOpen(false);
    requestAnimationFrame(() => listTriggerRef.current?.focus());
  };

  const activate = (recordingSubmissionId: string) => {
    onActiveRecordingChange(recordingSubmissionId);
    if (isListOpen) {
      closeListAndRestoreFocus();
    }
  };

  const move = (offset: number) => {
    const nextItem = board.items[activeIndex + offset];
    if (nextItem) {
      onActiveRecordingChange(nextItem.recordingSubmissionId);
    }
  };

  const reportPlaybackIssue = async (
    recordingSubmissionId: string,
    sourceType: AdmissionSharePlaybackSource,
  ) => {
    const requestBoardId = board.id;
    const requestKey = `${requestBoardId}:${recordingSubmissionId}`;
    if (playbackReportLocksRef.current.has(requestKey)) {
      return;
    }
    const requestId = nextPlaybackReportRequestIdRef.current + 1;
    nextPlaybackReportRequestIdRef.current = requestId;
    playbackReportLocksRef.current.set(requestKey, requestId);
    setPlaybackReportState((current) => ({
      boardId: requestBoardId,
      reports: {
        ...(current.boardId === requestBoardId ? current.reports : {}),
        [recordingSubmissionId]: "reporting",
      },
    }));
    let reported = false;
    try {
      reported = await onReportPlaybackIssue(recordingSubmissionId, sourceType);
    } catch {
      reported = false;
    } finally {
      const ownsCurrentLock =
        playbackReportLocksRef.current.get(requestKey) === requestId;
      const currentRequestKey = `${currentBoardIdRef.current}:${currentRecordingIdRef.current}`;
      const isCurrentRequest =
        mountedRef.current &&
        ownsCurrentLock &&
        currentBoardIdRef.current === requestBoardId &&
        currentRequestKey === requestKey;
      if (!isCurrentRequest) {
        return;
      }
      if (!reported) {
        playbackReportLocksRef.current.delete(requestKey);
      }
      setPlaybackReportState((current) => ({
        boardId: requestBoardId,
        reports: {
          ...(current.boardId === requestBoardId ? current.reports : {}),
          [recordingSubmissionId]: reported ? "reported" : "failed",
        },
      }));
    }
  };

  return (
    <section
      aria-label="录屏复核工作台"
      className="grid min-h-[680px] rounded-lg border border-[var(--line)] bg-white lg:grid-cols-[280px_minmax(0,1fr)_340px] lg:overflow-hidden"
    >
      <div className="hidden min-h-0 border-r border-[var(--line)] bg-[var(--bg-soft)] lg:flex">
        <RecordingListPane
          board={board}
          drafts={drafts}
          activeRecordingId={activeRecordingId}
          pendingOnly={pendingOnly}
          onPendingOnlyChange={setPendingOnly}
          onActivate={activate}
        />
      </div>

      <div className="min-w-0">
        <div className="flex min-h-12 items-center justify-between border-b border-[var(--line)] px-4 lg:hidden">
          <button
            ref={listTriggerRef}
            type="button"
            className={secondaryButtonClass}
            aria-expanded={isListOpen}
            onClick={() => setIsListOpen(true)}
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
            打开录屏列表
          </button>
          <span className="text-xs font-medium text-[var(--ink-500)]">
            {Math.min(activeIndex + 1, board.items.length)} /{" "}
            {board.items.length}
          </span>
        </div>

        {activeItem ? (
          <ActiveRecordingPane
            key={activeItem.recordingSubmissionId}
            item={activeItem}
            board={board}
            brandUiEnabled={brandUiEnabled}
            reportState={
              currentPlaybackReports[activeItem.recordingSubmissionId] ?? "idle"
            }
            onReportPlaybackIssue={reportPlaybackIssue}
          />
        ) : (
          <EmptyRecordingPane />
        )}
      </div>

      <aside className="min-w-0 border-t border-[var(--line)] bg-white lg:border-l lg:border-t-0">
        {activeItem ? (
          <DecisionPane
            item={activeItem}
            draft={activeDraft}
            saveState={saveState[activeItem.recordingSubmissionId] ?? "idle"}
            isFormal={isFormal}
            isEditable={isEditable}
            reasonOptions={reasonOptions}
            canOpenSummary={canOpenSummary}
            onDraftChange={onDraftChange}
            onRetryDraft={onRetryDraft}
            onOpenSubmissionSummary={onOpenSubmissionSummary}
          />
        ) : null}
      </aside>

      {board.items.length > 0 ? (
        <div className="sticky bottom-0 z-10 col-span-full flex items-center justify-between gap-3 border-t border-[var(--line)] bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={activeIndex <= 0}
            onClick={() => move(-1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            上一条
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={activeIndex >= board.items.length - 1}
            onClick={() => move(1)}
          >
            下一条
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {isListOpen ? (
        <MobileRecordingListDialog
          board={board}
          drafts={drafts}
          activeRecordingId={activeRecordingId}
          pendingOnly={pendingOnly}
          onPendingOnlyChange={setPendingOnly}
          onActivate={activate}
          onClose={closeListAndRestoreFocus}
        />
      ) : null}
    </section>
  );
}

function RecordingListPane({
  board,
  drafts,
  activeRecordingId,
  pendingOnly,
  onPendingOnlyChange,
  onActivate,
}: Pick<
  AdmissionShareReviewWorkspaceProps,
  "board" | "drafts" | "activeRecordingId"
> & {
  pendingOnly: boolean;
  onPendingOnlyChange: (value: boolean) => void;
  onActivate: (recordingSubmissionId: string) => void;
}) {
  const filteredItems = pendingOnly
    ? board.items.filter(
        (item) =>
          (drafts[item.recordingSubmissionId]?.decision ?? "pending") ===
          "pending",
      )
    : board.items;

  return (
    <nav aria-label="录屏列表" className="flex min-h-0 w-full flex-col">
      <div className="border-b border-[var(--line)] px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--ink-900)]">
            录屏列表
          </h2>
          <span className="text-xs tabular-nums text-[var(--ink-500)]">
            {
              board.items.filter((item) =>
                isDraftComplete(drafts[item.recordingSubmissionId]),
              ).length
            }
            /{board.items.length}
          </span>
        </div>
        <button
          type="button"
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-xs font-medium text-[var(--ink-700)] outline-none hover:border-[var(--blue-300)] focus-visible:ring-2 focus-visible:ring-[var(--blue-500)] focus-visible:ring-offset-2"
          aria-pressed={pendingOnly}
          onClick={() => onPendingOnlyChange(!pendingOnly)}
        >
          <ListFilter className="h-4 w-4" aria-hidden="true" />
          {pendingOnly ? "显示全部录屏" : "只看待判断"}
        </button>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto p-2">
        {filteredItems.map((item, index) => {
          const draft = drafts[item.recordingSubmissionId];
          const decision = draft?.decision ?? "pending";
          const active = item.recordingSubmissionId === activeRecordingId;
          return (
            <li key={item.recordingSubmissionId}>
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                className={`mb-1 flex min-h-14 w-full items-start gap-3 rounded-md px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue-500)] focus-visible:ring-inset ${
                  active
                    ? "bg-[var(--blue-50)] text-[var(--blue-800)]"
                    : "text-[var(--ink-700)] hover:bg-[var(--ink-50)]"
                }`}
                onClick={() => onActivate(item.recordingSubmissionId)}
              >
                <span
                  className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded text-[11px] font-semibold ${
                    active
                      ? "bg-[var(--blue-600)] text-white"
                      : "bg-white text-[var(--ink-500)]"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {item.streamer.displayName || "主播名称未提供"}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--ink-500)]">
                    {item.streamer.accountLabel ||
                      `版本 ${item.recordingVersion}`}
                  </span>
                </span>
                <span
                  className={`mt-0.5 shrink-0 text-[11px] font-medium ${
                    decision === "pending"
                      ? "text-[var(--warn-600)]"
                      : "text-[var(--ok-600)]"
                  }`}
                >
                  {decisionLabels[decision]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {filteredItems.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs leading-5 text-[var(--ink-500)]">
          当前没有待判断录屏，可切换为显示全部。
        </p>
      ) : null}
    </nav>
  );
}

function MobileRecordingListDialog({
  onClose,
  ...listProps
}: Parameters<typeof RecordingListPane>[0] & { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    <div
      className="fixed inset-0 z-40 bg-[rgba(11,23,51,0.4)] lg:hidden"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="选择录屏"
        className="h-full w-[min(88vw,340px)] bg-white shadow-[var(--shadow-pop)]"
        onKeyDown={handleKeyDown}
      >
        <div className="flex min-h-12 items-center justify-between border-b border-[var(--line)] px-4">
          <span className="text-sm font-semibold">选择录屏</span>
          <button
            ref={closeRef}
            type="button"
            className="grid h-11 w-11 place-items-center rounded-md outline-none hover:bg-[var(--ink-50)] focus-visible:ring-2 focus-visible:ring-[var(--blue-500)]"
            aria-label="关闭录屏列表"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="h-[calc(100%-3rem)]">
          <RecordingListPane {...listProps} />
        </div>
      </div>
    </div>
  );
}

function ActiveRecordingPane({
  board,
  brandUiEnabled,
  ...legacyProps
}: {
  board: PublicAdmissionShareBoard | BrandedPublicAdmissionShareBoard;
  brandUiEnabled: boolean;
  item: PublicAdmissionShareBoard["items"][number];
  reportState: "idle" | "reporting" | "reported" | "failed";
  onReportPlaybackIssue: (
    recordingSubmissionId: string,
    sourceType: AdmissionSharePlaybackSource,
  ) => Promise<void>;
}) {
  if (!brandUiEnabled || !("brand" in board)) {
    return <LegacyActiveRecordingPane {...legacyProps} />;
  }

  return (
    <BrandedActiveRecordingPane
      {...legacyProps}
      brand={board.brand}
      projectName={board.project.name}
      roundNumber={board.roundNumber}
    />
  );
}

function LegacyActiveRecordingPane({
  item,
  reportState,
  onReportPlaybackIssue,
}: {
  item: PublicAdmissionShareBoard["items"][number];
  reportState: "idle" | "reporting" | "reported" | "failed";
  onReportPlaybackIssue: (
    recordingSubmissionId: string,
    sourceType: AdmissionSharePlaybackSource,
  ) => Promise<void>;
}) {
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const safeItem = {
    ...item,
    externalUrl: normalizeAbsoluteHttpUrl(item.externalUrl),
  };
  const sourceType = sourceTypeFor(safeItem);
  const embedUrl =
    sourceType === "external" && safeItem.externalUrl
      ? platformEmbedSource(safeItem.externalUrl)
      : null;
  const externalOnly = sourceType === "external";

  return (
    <section
      aria-label="录屏播放器"
      className="flex min-h-full flex-col bg-[var(--ink-900)]"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-4 text-white sm:px-5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">
            {item.streamer.displayName || "主播名称未提供"}
          </h2>
          <p className="mt-1 truncate text-xs text-[var(--ink-200)]">
            {item.streamer.accountLabel || "账号信息未填写"} · 版本{" "}
            {item.recordingVersion}
          </p>
        </div>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white">
          {sourceHealthLabel(item.sourceHealth)}
        </span>
      </header>

      <div className="grid flex-1 place-items-center p-3 sm:p-5">
        <div className="w-full max-w-5xl">
          {playbackFailed ? (
            <PlaybackFallback
              item={safeItem}
              sourceType={sourceType}
              onRetryPlayback={() => {
                setPlaybackAttempt((current) => current + 1);
                setPlaybackFailed(false);
              }}
            />
          ) : embedUrl ? (
            <iframe
              className="aspect-video w-full rounded-md border-0 bg-black"
              title="外部平台录屏"
              aria-label={`${item.streamer.displayName || "主播"} 外部录屏播放器`}
              src={embedUrl}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              onError={() => setPlaybackFailed(true)}
            />
          ) : sourceType === "original" ? (
            <video
              key={`${item.recordingSubmissionId}:${playbackAttempt}`}
              aria-label={`${item.streamer.displayName || "主播"} 原始录屏播放器`}
              className="aspect-video w-full rounded-md bg-black"
              src={item.playbackUrl}
              controls
              preload="metadata"
              onError={() => setPlaybackFailed(true)}
            />
          ) : externalOnly &&
            safeItem.externalUrl &&
            isDirectVideoSource(safeItem.externalUrl) ? (
            <video
              key={`${item.recordingSubmissionId}:${playbackAttempt}`}
              aria-label={`${item.streamer.displayName || "主播"} 外部录屏播放器`}
              className="aspect-video w-full rounded-md bg-black"
              src={item.playbackUrl}
              controls
              preload="metadata"
              onError={() => setPlaybackFailed(true)}
            />
          ) : externalOnly && safeItem.externalUrl ? (
            <ExternalRecordingLink item={safeItem} />
          ) : (
            <NoPlayableSource />
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3 text-xs text-[var(--ink-200)] sm:px-5">
        <span>若播放异常，请反馈当前录屏，运营会跟进来源。</span>
        <div className="flex min-h-11 items-center gap-3">
          {reportState === "reported" || reportState === "failed" ? (
            <span
              role="status"
              aria-label="播放问题反馈状态"
              aria-live="polite"
              className="font-medium"
            >
              {reportState === "reported" ? "已反馈" : "反馈失败，可重试"}
            </span>
          ) : null}
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/30 px-3 font-medium text-white outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
            disabled={reportState === "reporting" || reportState === "reported"}
            onClick={() =>
              void onReportPlaybackIssue(item.recordingSubmissionId, sourceType)
            }
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {reportState === "reporting"
              ? "反馈中…"
              : reportState === "reported"
                ? "已反馈"
                : reportState === "failed"
                  ? "重试反馈无法播放"
                  : playbackFailed
                    ? "反馈无法播放"
                    : "反馈播放问题"}
          </button>
        </div>
      </footer>
    </section>
  );
}

function BrandedActiveRecordingPane({
  item,
  brand,
  projectName,
  roundNumber,
  reportState,
  onReportPlaybackIssue,
}: {
  item: PublicAdmissionShareBoard["items"][number];
  brand: BrandedPublicAdmissionShareBoard["brand"];
  projectName: string;
  roundNumber: number;
  reportState: "idle" | "reporting" | "reported" | "failed";
  onReportPlaybackIssue: (
    recordingSubmissionId: string,
    sourceType: AdmissionSharePlaybackSource,
  ) => Promise<void>;
}) {
  const safeItem = {
    ...item,
    externalUrl: normalizeAbsoluteHttpUrl(item.externalUrl),
  };
  const sourceType = sourceTypeFor(safeItem);
  const embedUrl =
    sourceType === "external" && safeItem.externalUrl
      ? platformEmbedSource(safeItem.externalUrl)
      : null;
  const isDirectExternal =
    sourceType === "external" &&
    Boolean(safeItem.externalUrl && isDirectVideoSource(safeItem.externalUrl));
  const canPlayInline =
    sourceType === "original" || Boolean(embedUrl) || isDirectExternal;
  const [mediaState, setMediaState] = useState<MediaStageState>(() =>
    sourceType === "none" || !canPlayInline ? "unavailable" : "idle",
  );
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [aspectRatio, setAspectRatio] = useState("16 / 9");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">(
    "landscape",
  );
  const mediaStageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const embedRef = useRef<HTMLIFrameElement>(null);
  const playbackAttemptRef = useRef(0);
  const focusTransferRef = useRef<{
    anchor: HTMLElement;
    attempt: number;
    consumed: boolean;
  } | null>(null);
  const pendingMediaFocusAttemptRef = useRef<number | null>(null);
  const derivedBrand = useMemo(
    () =>
      normalizePublishedBrand(
        { primaryColor: brand.primaryColor },
        {
          organizationId: "00000000-0000-4000-8000-000000000000",
          organizationName: brand.brandName,
        },
      ),
    [brand.brandName, brand.primaryColor],
  );
  const shouldMountInlineMedia =
    canPlayInline && (mediaState === "loading" || mediaState === "playing");
  const stageStyle = {
    "--share-brand-seed": derivedBrand.primaryColor,
    "--share-brand-action": derivedBrand.actionColor,
    "--share-brand-soft": derivedBrand.softColor,
  } as CSSProperties;
  const canvasStyle = {
    "--recording-aspect-ratio": aspectRatio,
  } as CSSProperties;

  useEffect(() => {
    const revokeOnExternalFocus = (event: FocusEvent) => {
      const grant = focusTransferRef.current;
      const target = event.target;
      const stage = mediaStageRef.current;
      if (
        !grant ||
        !(target instanceof HTMLElement) ||
        target === grant.anchor ||
        target === stage ||
        stage?.contains(target)
      ) {
        return;
      }
      focusTransferRef.current = null;
      pendingMediaFocusAttemptRef.current = null;
    };
    document.addEventListener("focusin", revokeOnExternalFocus);
    return () => {
      document.removeEventListener("focusin", revokeOnExternalFocus);
      focusTransferRef.current = null;
      pendingMediaFocusAttemptRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (mediaState !== "playing") {
      return;
    }
    const pendingAttempt = pendingMediaFocusAttemptRef.current;
    pendingMediaFocusAttemptRef.current = null;
    if (pendingAttempt !== playbackAttemptRef.current) {
      return;
    }
    const target = videoRef.current ?? embedRef.current;
    if (target?.isConnected) {
      target.focus();
    }
  }, [mediaState]);

  const armFocusTransfer = (anchor: HTMLElement, attempt: number) => {
    focusTransferRef.current = { anchor, attempt, consumed: false };
  };

  const queueFocusTransferOnce = (attempt: number) => {
    const grant = focusTransferRef.current;
    if (!grant || grant.attempt !== attempt || grant.consumed) {
      return;
    }
    grant.consumed = true;
    pendingMediaFocusAttemptRef.current = attempt;
  };

  const startPlayback = (trigger: HTMLButtonElement) => {
    if (!canPlayInline) {
      setMediaState("unavailable");
      return;
    }
    pendingMediaFocusAttemptRef.current = null;
    armFocusTransfer(trigger, playbackAttemptRef.current);
    setMediaState("loading");
  };

  const retryPlayback = (trigger: HTMLButtonElement) => {
    const nextAttempt = playbackAttemptRef.current + 1;
    pendingMediaFocusAttemptRef.current = null;
    playbackAttemptRef.current = nextAttempt;
    setPlaybackAttempt(nextAttempt);
    const stage = mediaStageRef.current;
    if (stage) {
      stage.focus();
      armFocusTransfer(stage, nextAttempt);
    } else {
      armFocusTransfer(trigger, nextAttempt);
    }
    setMediaState("loading");
  };

  const updateIntrinsicRatio = (event: SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = event.currentTarget;
    if (
      !Number.isFinite(videoWidth) ||
      !Number.isFinite(videoHeight) ||
      videoWidth <= 0 ||
      videoHeight <= 0
    ) {
      setAspectRatio("16 / 9");
      setOrientation("landscape");
      return;
    }
    const divisor = greatestCommonDivisor(videoWidth, videoHeight);
    setAspectRatio(`${videoWidth / divisor} / ${videoHeight / divisor}`);
    setOrientation(videoHeight > videoWidth ? "portrait" : "landscape");
  };

  const markVideoPlaying = (attempt: number) => {
    if (attempt !== playbackAttemptRef.current) {
      return;
    }
    queueFocusTransferOnce(attempt);
    setMediaState("playing");
  };
  const markEmbedPlaying = (attempt: number) => {
    if (attempt !== playbackAttemptRef.current) {
      return;
    }
    queueFocusTransferOnce(attempt);
    setMediaState("playing");
  };
  const markError = (attempt: number) => {
    if (attempt !== playbackAttemptRef.current) {
      return;
    }
    focusTransferRef.current = null;
    pendingMediaFocusAttemptRef.current = null;
    setMediaState("error");
  };

  return (
    <section aria-label="录屏播放器" className="recording-media-pane">
      <header className="recording-media-pane__header">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-[var(--ink-900)]">
            {item.streamer.displayName || "主播名称未提供"}
          </h2>
          <p className="mt-1 truncate text-xs text-[var(--ink-500)]">
            {item.streamer.accountLabel || "账号信息未填写"} · 版本{" "}
            {item.recordingVersion}
          </p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[var(--ink-700)]">
          {sourceHealthLabel(item.sourceHealth)}
        </span>
      </header>

      <div
        ref={mediaStageRef}
        aria-label="录屏媒体工作区"
        className="recording-media-stage"
        data-state={mediaState}
        role="region"
        style={stageStyle}
        tabIndex={-1}
      >
        <div
          className="recording-media-canvas"
          data-orientation={orientation}
          style={canvasStyle}
        >
          {shouldMountInlineMedia && embedUrl ? (
            <iframe
              ref={embedRef}
              key={`${item.recordingSubmissionId}:${playbackAttempt}`}
              title="外部平台录屏"
              aria-label={`${item.streamer.displayName || "主播"} 外部录屏播放器`}
              src={embedUrl}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              tabIndex={0}
              onLoad={() => markEmbedPlaying(playbackAttempt)}
              onError={() => markError(playbackAttempt)}
            />
          ) : shouldMountInlineMedia && sourceType === "original" ? (
            <video
              ref={videoRef}
              key={`${item.recordingSubmissionId}:${playbackAttempt}`}
              aria-label={`${item.streamer.displayName || "主播"} 原始录屏播放器`}
              src={item.playbackUrl}
              controls
              autoPlay
              tabIndex={0}
              preload="metadata"
              onCanPlay={() => markVideoPlaying(playbackAttempt)}
              onPlaying={() => markVideoPlaying(playbackAttempt)}
              onLoadedMetadata={updateIntrinsicRatio}
              onError={() => markError(playbackAttempt)}
            />
          ) : shouldMountInlineMedia && isDirectExternal ? (
            <video
              ref={videoRef}
              key={`${item.recordingSubmissionId}:${playbackAttempt}`}
              aria-label={`${item.streamer.displayName || "主播"} 外部录屏播放器`}
              src={item.playbackUrl}
              controls
              autoPlay
              tabIndex={0}
              preload="metadata"
              onCanPlay={() => markVideoPlaying(playbackAttempt)}
              onPlaying={() => markVideoPlaying(playbackAttempt)}
              onLoadedMetadata={updateIntrinsicRatio}
              onError={() => markError(playbackAttempt)}
            />
          ) : null}

          {mediaState === "idle" || mediaState === "loading" ? (
            <BrandedRecordingPoster
              brandName={brand.brandName}
              streamerName={item.streamer.displayName || "主播名称未提供"}
              projectName={projectName}
              roundNumber={roundNumber}
              isLoading={mediaState === "loading"}
              onPlay={startPlayback}
            />
          ) : null}

          {mediaState === "error" ? (
            <BrandedPlaybackFallback
              item={safeItem}
              sourceType={sourceType}
              projectName={projectName}
              roundNumber={roundNumber}
              onRetryPlayback={retryPlayback}
            />
          ) : null}

          {mediaState === "unavailable" ? (
            <BrandedUnavailableSource
              item={safeItem}
              projectName={projectName}
              roundNumber={roundNumber}
            />
          ) : null}
        </div>
      </div>

      <footer className="recording-media-pane__footer">
        <span>若播放异常，请反馈当前录屏，运营会跟进来源。</span>
        <div className="flex min-h-11 items-center gap-3">
          {reportState === "reported" || reportState === "failed" ? (
            <span
              role="status"
              aria-label="播放问题反馈状态"
              aria-live="polite"
              className="font-medium"
            >
              {reportState === "reported" ? "已反馈" : "反馈失败，可重试"}
            </span>
          ) : null}
          <button
            type="button"
            className="recording-media-pane__report"
            disabled={reportState === "reporting" || reportState === "reported"}
            onClick={() =>
              void onReportPlaybackIssue(item.recordingSubmissionId, sourceType)
            }
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {reportState === "reporting"
              ? "反馈中…"
              : reportState === "reported"
                ? "已反馈"
                : reportState === "failed"
                  ? "重试反馈无法播放"
                  : mediaState === "error"
                    ? "反馈无法播放"
                    : "反馈播放问题"}
          </button>
        </div>
      </footer>
    </section>
  );
}

function BrandedRecordingPoster({
  brandName,
  streamerName,
  projectName,
  roundNumber,
  isLoading,
  onPlay,
}: {
  brandName: string;
  streamerName: string;
  projectName: string;
  roundNumber: number;
  isLoading: boolean;
  onPlay: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <section
      className="recording-poster"
      aria-label={`${streamerName} 录屏待播放`}
    >
      <div className="recording-poster__content">
        <p className="recording-poster__eyebrow">{brandName} · 组织官方分享</p>
        <h2>{streamerName}</h2>
        <p className="recording-poster__context">
          {projectName} · 第 {roundNumber} 轮
        </p>
        <button
          type="button"
          aria-disabled={isLoading}
          className="recording-poster__play min-h-11"
          onClick={(event) => {
            if (!isLoading) {
              onPlay(event.currentTarget);
            }
          }}
        >
          {isLoading ? (
            <>
              <LoaderCircle
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              正在加载录屏…
            </>
          ) : (
            "播放录屏"
          )}
        </button>
        {isLoading ? (
          <span
            aria-label="录屏加载状态"
            aria-live="polite"
            className="sr-only"
            role="status"
          >
            正在加载录屏…
          </span>
        ) : null}
      </div>
    </section>
  );
}

function BrandedPlaybackFallback({
  item,
  sourceType,
  projectName,
  roundNumber,
  onRetryPlayback,
}: {
  item: PublicAdmissionShareBoard["items"][number];
  sourceType: AdmissionSharePlaybackSource;
  projectName: string;
  roundNumber: number;
  onRetryPlayback: (trigger: HTMLButtonElement) => void;
}) {
  const externalOnly = sourceType === "external" && !item.hasPrivateStorage;
  return (
    <div
      aria-label="录屏播放失败"
      className="recording-media-message"
      role="alert"
    >
      <AlertTriangle
        className="h-7 w-7 text-[var(--warn-600)]"
        aria-hidden="true"
      />
      <p className="recording-media-message__title">视频加载失败</p>
      <p>
        {item.streamer.displayName || "主播名称未提供"} · {projectName} · 第{" "}
        {roundNumber} 轮
      </p>
      <p>请尝试重新加载；若仍无法播放，可打开允许的外部来源并反馈问题。</p>
      <div className="recording-media-message__actions">
        <button
          type="button"
          className="recording-media-action recording-media-action--primary min-h-11"
          onClick={(event) => onRetryPlayback(event.currentTarget)}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {externalOnly ? "重试外部视频" : "重试原始视频"}
        </button>
        {item.externalUrl ? (
          <a
            className="recording-media-action min-h-11"
            href={item.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {externalOnly ? "打开外部视频" : "打开备用视频"}
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function BrandedUnavailableSource({
  item,
  projectName,
  roundNumber,
}: {
  item: PublicAdmissionShareBoard["items"][number];
  projectName: string;
  roundNumber: number;
}) {
  return (
    <div
      aria-label="录屏不可用"
      className="recording-media-message"
      role="alert"
    >
      <FileVideo className="h-7 w-7 text-[var(--ink-500)]" aria-hidden="true" />
      <p className="recording-media-message__title">
        {item.externalUrl ? "此来源需在外部平台查看" : "当前没有可播放来源"}
      </p>
      <p>
        {item.streamer.displayName || "主播名称未提供"} · {projectName} · 第{" "}
        {roundNumber} 轮
      </p>
      <p>
        {item.externalUrl
          ? "站内无法安全播放此来源，可在新窗口打开。"
          : "请联系分享方补充原始录屏或可访问的外部链接。"}
      </p>
      {item.externalUrl ? (
        <div className="recording-media-message__actions">
          <a
            className="recording-media-action recording-media-action--primary min-h-11"
            href={item.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            打开外部录屏
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </div>
  );
}

function DecisionPane({
  item,
  draft,
  saveState,
  isFormal,
  isEditable,
  reasonOptions,
  canOpenSummary,
  onDraftChange,
  onRetryDraft,
  onOpenSubmissionSummary,
}: {
  item: PublicAdmissionShareBoard["items"][number];
  draft: ReviewDraft | undefined;
  saveState: ReviewDraftSaveState;
  isFormal: boolean;
  isEditable: boolean;
  reasonOptions: VendorCheckpointOption[];
  canOpenSummary: boolean;
  onDraftChange: AdmissionShareReviewWorkspaceProps["onDraftChange"];
  onRetryDraft: AdmissionShareReviewWorkspaceProps["onRetryDraft"];
  onOpenSubmissionSummary: () => void;
}) {
  const reasonHelpId = useId();
  const remarkId = useId();
  const currentDraft =
    draft ??
    ({
      decision: "pending",
      remark: "",
      reasonCodes: [],
      revision: 0,
      updatedAt: null,
    } satisfies ReviewDraft);
  const isNegative =
    currentDraft.decision === "rejected" ||
    currentDraft.decision === "needs_changes";

  if (!isFormal) {
    return (
      <section aria-label="录屏信息" className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--ink-900)]">
          预览信息
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-500)]">
          当前链接仅用于预览录屏，不会读取或保存复核草稿。
        </p>
        {item.finalReview ? <FinalReviewReceipt item={item} /> : null}
      </section>
    );
  }

  if (!isEditable) {
    return (
      <section aria-label="复核回执" className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--ink-900)]">
          本轮复核已锁定
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-500)]">
          已提交的结果不可继续修改。如需调整，请联系 MCN 重新开启本轮。
        </p>
        {item.finalReview ? <FinalReviewReceipt item={item} /> : null}
      </section>
    );
  }

  return (
    <form
      aria-label="当前录屏判断"
      className="flex min-h-full flex-col"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <h2 className="text-sm font-semibold text-[var(--ink-900)]">
          当前录屏判断
        </h2>
        <SaveStateIndicator
          state={saveState}
          onRetry={() => onRetryDraft(item.recordingSubmissionId)}
        />
      </div>

      <div className="grid flex-1 content-start gap-5 overflow-y-auto p-4 sm:p-5">
        <fieldset>
          <legend className="text-xs font-semibold text-[var(--ink-700)]">
            复核结论
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {decisionOptions.map((option) => (
              <label
                key={option.value}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium outline-none focus-within:ring-2 focus-within:ring-[var(--blue-500)] focus-within:ring-offset-2 ${
                  currentDraft.decision === option.value
                    ? "border-[var(--blue-500)] bg-[var(--blue-50)] text-[var(--blue-700)]"
                    : "border-[var(--line)] bg-white text-[var(--ink-700)] hover:border-[var(--blue-300)]"
                }`}
              >
                <input
                  className="h-4 w-4 accent-[var(--blue-600)]"
                  type="radio"
                  name={`decision-${item.recordingSubmissionId}`}
                  value={option.value}
                  checked={currentDraft.decision === option.value}
                  onChange={() =>
                    onDraftChange(item.recordingSubmissionId, {
                      decision: option.value,
                      reasonCodes:
                        option.value === "selected" || option.value === "backup"
                          ? []
                          : currentDraft.reasonCodes,
                    })
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        {isNegative ? (
          <fieldset aria-describedby={reasonHelpId}>
            <legend className="text-xs font-semibold text-[var(--ink-700)]">
              问题原因
            </legend>
            <p
              id={reasonHelpId}
              className="mt-1 text-xs leading-5 text-[var(--ink-500)]"
            >
              负向结论至少选择一项，便于主播针对性修改。
            </p>
            <div className="mt-2 grid gap-2">
              {reasonOptions.length > 0 ? (
                reasonOptions.map((option) => (
                  <label
                    key={option.key}
                    title={option.description}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-[var(--line)] px-3 text-sm text-[var(--ink-700)] outline-none hover:border-[var(--blue-300)] focus-within:ring-2 focus-within:ring-[var(--blue-500)]"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--blue-600)]"
                      checked={currentDraft.reasonCodes.includes(option.key)}
                      onChange={() =>
                        onDraftChange(item.recordingSubmissionId, {
                          reasonCodes: currentDraft.reasonCodes.includes(
                            option.key,
                          )
                            ? currentDraft.reasonCodes.filter(
                                (code) => code !== option.key,
                              )
                            : [...currentDraft.reasonCodes, option.key],
                        })
                      }
                    />
                    {option.label}
                  </label>
                ))
              ) : (
                <p className="rounded-md bg-[var(--warn-50)] px-3 py-2 text-xs leading-5 text-[var(--warn-600)]">
                  原因选项暂未加载，请刷新后再试。
                </p>
              )}
            </div>
          </fieldset>
        ) : null}

        <div className="grid gap-1.5">
          <label
            htmlFor={remarkId}
            className="text-xs font-semibold text-[var(--ink-700)]"
          >
            当前录屏备注
          </label>
          <textarea
            id={remarkId}
            className="min-h-28 resize-y rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm font-normal leading-6 text-[var(--ink-900)] outline-none placeholder:text-[var(--ink-500)] focus:border-[var(--blue-500)] focus:ring-2 focus:ring-[var(--blue-100)]"
            value={currentDraft.remark}
            maxLength={2000}
            required={isNegative}
            placeholder={
              isNegative
                ? "请说明拒绝原因或需要修改的具体内容"
                : "可补充选入依据或其他说明"
            }
            onChange={(event) =>
              onDraftChange(item.recordingSubmissionId, {
                remark: event.target.value,
              })
            }
          />
          <span className="text-right text-[11px] font-normal tabular-nums text-[var(--ink-500)]">
            {currentDraft.remark.length}/2000
          </span>
        </div>
      </div>

      <div className="border-t border-[var(--line)] p-4 sm:p-5">
        <button
          type="button"
          data-submission-summary-trigger
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[var(--blue-600)] px-4 text-sm font-semibold text-white outline-none hover:bg-[var(--blue-700)] focus-visible:ring-2 focus-visible:ring-[var(--blue-500)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--ink-200)]"
          disabled={!canOpenSummary}
          onClick={onOpenSubmissionSummary}
        >
          查看提交汇总
        </button>
        {!canOpenSummary ? (
          <p className="mt-2 text-xs leading-5 text-[var(--ink-500)]">
            完成全部录屏判断；拒绝或需修改时还需填写备注并选择原因。
          </p>
        ) : null}
      </div>
    </form>
  );
}

function SaveStateIndicator({
  state,
  onRetry,
}: {
  state: ReviewDraftSaveState;
  onRetry: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 text-xs font-medium ${
        state === "failed"
          ? "text-[var(--danger-600)]"
          : state === "saved"
            ? "text-[var(--ok-600)]"
            : "text-[var(--ink-500)]"
      }`}
      role="status"
      aria-live="polite"
    >
      {state === "saving" ? (
        <LoaderCircle
          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : state === "saved" ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : state === "failed" ? (
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      ) : null}
      <span>{saveLabels[state]}</span>
      {state === "failed" ? (
        <button
          type="button"
          className="ml-1 inline-flex min-h-11 items-center gap-1 rounded px-2 font-semibold outline-none hover:bg-[var(--danger-50)] focus-visible:ring-2 focus-visible:ring-[var(--danger-600)]"
          onClick={onRetry}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          重试保存
        </button>
      ) : null}
    </div>
  );
}

function PlaybackFallback({
  item,
  sourceType,
  onRetryPlayback,
}: {
  item: PublicAdmissionShareBoard["items"][number];
  sourceType: AdmissionSharePlaybackSource;
  onRetryPlayback: () => void;
}) {
  const externalOnly = sourceType === "external" && !item.hasPrivateStorage;
  return (
    <div className="grid aspect-video place-items-center rounded-md bg-black p-6 text-center text-white">
      <div>
        <AlertTriangle
          className="mx-auto h-7 w-7 text-[var(--warn-600)]"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm font-semibold">视频加载失败</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--ink-200)]">
          请尝试重新加载；若仍无法播放，可打开允许的外部来源并反馈问题。
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-white px-3 text-xs font-semibold text-[var(--ink-900)] outline-none hover:bg-[var(--ink-50)] focus-visible:ring-2 focus-visible:ring-white"
            onClick={onRetryPlayback}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {externalOnly ? "重试外部视频" : "重试原始视频"}
          </button>
          {item.externalUrl ? (
            <a
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/30 px-3 text-xs font-semibold outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white"
              href={item.externalUrl}
              target="_blank"
              rel="noreferrer"
            >
              {externalOnly ? "打开外部视频" : "打开备用视频"}
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ExternalRecordingLink({
  item,
}: {
  item: PublicAdmissionShareBoard["items"][number];
}) {
  return (
    <div className="grid aspect-video place-items-center rounded-md bg-black p-6 text-center text-white">
      <div>
        <ExternalLink
          className="mx-auto h-7 w-7 text-[var(--blue-300)]"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm font-semibold">外部平台录屏</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--ink-200)]">
          此来源不支持站内播放，请在新窗口查看原始录屏。
        </p>
        <a
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-white px-3 text-xs font-semibold text-[var(--ink-900)] outline-none hover:bg-[var(--ink-50)] focus-visible:ring-2 focus-visible:ring-white"
          href={item.externalUrl ?? item.playbackUrl}
          target="_blank"
          rel="noreferrer"
        >
          打开外部录屏
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

function NoPlayableSource() {
  return (
    <div className="grid aspect-video place-items-center rounded-md bg-black p-6 text-center text-white">
      <div>
        <FileVideo
          className="mx-auto h-7 w-7 text-[var(--ink-300)]"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm font-semibold">当前没有可播放来源</p>
        <p className="mt-1 text-xs text-[var(--ink-200)]">
          请联系分享方补充原始录屏或可访问的外部链接。
        </p>
      </div>
    </div>
  );
}

function EmptyRecordingPane() {
  return (
    <section
      aria-label="录屏播放器"
      className="grid min-h-[420px] place-items-center bg-[var(--ink-900)] p-6 text-center text-white"
    >
      <div>
        <FileVideo
          className="mx-auto h-8 w-8 text-[var(--ink-300)]"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm font-semibold">本轮暂无录屏</p>
        <p className="mt-1 text-xs text-[var(--ink-200)]">
          分享方尚未添加可供查看的录屏。
        </p>
      </div>
    </section>
  );
}

function FinalReviewReceipt({
  item,
}: {
  item: PublicAdmissionShareBoard["items"][number];
}) {
  if (!item.finalReview) {
    return null;
  }
  return (
    <dl className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 text-sm">
      <div>
        <dt className="text-xs text-[var(--ink-500)]">已提交结论</dt>
        <dd className="mt-1 font-semibold text-[var(--ink-900)]">
          {decisionLabels[item.finalReview.decision]}
        </dd>
      </div>
      {item.finalReview.remark ? (
        <div>
          <dt className="text-xs text-[var(--ink-500)]">备注</dt>
          <dd className="mt-1 whitespace-pre-wrap leading-6 text-[var(--ink-700)]">
            {item.finalReview.remark}
          </dd>
        </div>
      ) : null}
    </dl>
  );
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

function sourceTypeFor(
  item: PublicAdmissionShareBoard["items"][number],
): AdmissionSharePlaybackSource {
  if (
    item.hasPrivateStorage &&
    (item.sourceHealth === "original_ready" ||
      item.sourceHealth === "original_with_external_fallback")
  ) {
    return "original";
  }
  if (item.sourceHealth === "external_only" && item.externalUrl) {
    return "external";
  }
  return "none";
}

function sourceHealthLabel(
  sourceHealth: PublicAdmissionShareBoard["items"][number]["sourceHealth"],
) {
  switch (sourceHealth) {
    case "original_ready":
      return "原始录屏";
    case "original_with_external_fallback":
      return "原始录屏 · 含备用链接";
    case "external_only":
      return "外部链接";
    case "blocked":
      return "来源不可用";
  }
}

function platformEmbedSource(sourceUrl: string) {
  return bilibiliEmbedSource(sourceUrl) ?? youtubeEmbedSource(sourceUrl);
}

function bilibiliEmbedSource(sourceUrl: string) {
  const url = parseUrl(sourceUrl);
  if (
    !url ||
    (url.hostname !== "bilibili.com" && !url.hostname.endsWith(".bilibili.com"))
  ) {
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

function parseUrl(sourceUrl: string) {
  const safeUrl = normalizeAbsoluteHttpUrl(sourceUrl);
  return safeUrl ? new URL(safeUrl) : null;
}

function isDirectVideoSource(sourceUrl: string) {
  const url = parseUrl(sourceUrl);
  const pathname = (url?.pathname ?? sourceUrl).toLowerCase();
  return [".mp4", ".webm", ".mov", ".m4v", ".ogg"].some((extension) =>
    pathname.endsWith(extension),
  );
}

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
}

const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-sm font-semibold text-[var(--ink-700)] outline-none hover:border-[var(--blue-300)] hover:bg-[var(--blue-50)] focus-visible:ring-2 focus-visible:ring-[var(--blue-500)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
