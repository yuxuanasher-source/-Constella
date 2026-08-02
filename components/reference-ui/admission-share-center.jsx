"use client";

import React from "react";

import { canShareAdmissionRecordingsForProject } from "@/features/applications/admission-share-policy";

const tabs = [
  { id: "library", label: "录屏库" },
  { id: "tasks", label: "分享任务" },
  { id: "results", label: "结果待办" },
];

const statusLabels = {
  ready: "就绪",
  warning: "提醒",
  blocked: "阻断",
};

const reasonLabels = {
  MCN_APPROVAL_REQUIRED: "MCN 审核通过后才可分享",
  SOURCE_UNAVAILABLE: "原始视频和外部链接均不可用",
  SELECTION_STALE: "录屏状态已变化，请重新选择",
  EXTERNAL_ONLY: "仅有外部链接，建议确认可访问性",
};

const sourceLabels = {
  original_ready: "原始视频",
  original_with_external_fallback: "原始视频 + 外链备用",
  external_only: "仅外部链接",
  blocked: "来源不可用",
  original: "原始视频",
  external: "外部链接",
  none: "无可用来源",
};

const taskStatusLabels = {
  active: "进行中",
  expired: "已过期",
  revoked: "已撤销",
  completed: "已完成",
};

const reviewStateLabels = {
  not_started: "未开始",
  in_progress: "进行中",
  submitted_locked: "已提交锁定",
  reopened: "已重开",
};

const vendorDecisionLabels = {
  selected: "通过",
  backup: "备选",
  rejected: "拒绝",
  needs_changes: "需修改",
};

const fallbackShareBrand = {
  version: 0,
  logoText: "组织",
  brandName: "组织",
  brandTagline: "",
  primaryColor: "#4E5969",
};

const buttonBase = {
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 6,
  border: "1px solid var(--line-strong, var(--line))",
  background: "#fff",
  color: "var(--ink-700)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const buttonKinds = {
  primary: {
    background: "var(--blue-600)",
    borderColor: "var(--blue-600)",
    color: "#fff",
  },
  danger: {
    background: "#fff",
    borderColor: "var(--danger-200, var(--line))",
    color: "var(--danger-600)",
  },
  quiet: {
    background: "transparent",
    borderColor: "transparent",
    color: "var(--blue-700)",
  },
};

const inputStyle = {
  minHeight: 44,
  width: "100%",
  border: "1px solid var(--line-strong, var(--line))",
  borderRadius: 6,
  background: "#fff",
  color: "var(--ink-900)",
  padding: "8px 10px",
  fontSize: 13,
};

const panelStyle = {
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "#fff",
};

const admissionShareCss = `
  .admission-share-action {
    transition: transform 160ms ease-out, box-shadow 160ms ease-out, filter 160ms ease-out;
  }
  .admission-share-action:hover:not(:disabled) {
    filter: brightness(0.97);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.1);
  }
  .admission-share-action:active:not(:disabled) {
    transform: translateY(1px);
    box-shadow: none;
  }
  .admission-share-action:focus-visible,
  .admission-share-center :is(input, select, textarea):focus-visible,
  .admission-share-tab:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--blue-600) 35%, transparent);
    outline-offset: 2px;
  }
  .admission-share-dialog-shell,
  .admission-share-center-panel,
  .admission-share-center-panel > * {
    min-width: 0;
  }
  @media (max-width: 640px) {
    .admission-share-dialog-shell {
      max-height: calc(100vh - 16px) !important;
    }
    .admission-share-dialog-footer {
      align-items: stretch !important;
      flex-direction: column;
    }
    .admission-share-dialog-footer > div {
      display: grid !important;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .admission-share-action {
      transition: none;
    }
  }
`;

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(dialog) {
  return Array.from(dialog?.querySelectorAll(focusableSelector) || []).filter(
    (element) => !element.closest("[inert]"),
  );
}

function trapDialogKeyDown(event, dialog, onEscape) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onEscape?.();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = focusableElements(dialog);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function useDialogFocus(initialFocusRef, restoreFocusRef) {
  const dialogRef = React.useRef(null);
  const openerRef = React.useRef(null);

  React.useLayoutEffect(() => {
    const restoreTarget = restoreFocusRef?.current;
    openerRef.current = restoreTarget || document.activeElement;
    const initial =
      initialFocusRef?.current || focusableElements(dialogRef.current)[0];
    initial?.focus?.();
    return () => (restoreTarget || openerRef.current)?.focus?.();
  }, [initialFocusRef, restoreFocusRef]);

  return { dialogRef, openerRef };
}

export function taskCapabilities(task, now = new Date().toISOString()) {
  const nowMs = Date.parse(now);
  const expiresAtMs = Date.parse(task?.expiresAt || "");
  const unexpired =
    Number.isFinite(expiresAtMs) &&
    Number.isFinite(nowMs) &&
    expiresAtMs > nowMs;
  const active = task?.status === "active" && unexpired;
  const formal = task?.mode === "formal_review";
  const revoked = task?.status === "revoked";
  let explanation = "";

  if (revoked) {
    explanation = "任务已撤销，仅保留历史记录。";
  } else if (task?.status === "expired" || !unexpired) {
    explanation = "任务已过期，不能延期、重置链接或重开。";
  } else if (task?.mode === "preview") {
    explanation = "预览任务不产生正式提交，也不能重开。";
  } else if (
    task?.status === "active" &&
    task?.reviewState !== "submitted_locked"
  ) {
    explanation = "仅已提交锁定的正式复核可以重开。";
  }

  return {
    extend: active,
    rotate: active,
    reopen: active && formal && task?.reviewState === "submitted_locked",
    revoke: !revoked,
    submissions: formal,
    explanation,
  };
}

function ActionButton({
  children,
  kind = "default",
  style,
  disabled,
  className = "",
  ...props
}) {
  return (
    <button
      type="button"
      className={`admission-share-action admission-share-action-${kind} ${className}`.trim()}
      disabled={disabled}
      style={{
        ...buttonBase,
        ...(buttonKinds[kind] || {}),
        ...(disabled ? { cursor: "not-allowed", opacity: 0.5 } : {}),
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}

function sevenDaysFromNowInput() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setSeconds(0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function dateInputToIso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function shareItem(candidate, sortOrder) {
  return {
    applicationId: candidate.applicationId,
    recordingSubmissionId: candidate.recordingSubmissionId,
    recordingVersion: candidate.recordingVersion,
    sortOrder,
  };
}

function normalizeTaskPage(result) {
  if (Array.isArray(result)) {
    return { shareBoards: result, nextCursor: null };
  }
  return {
    shareBoards: Array.isArray(result?.shareBoards) ? result.shareBoards : [],
    nextCursor:
      typeof result?.nextCursor === "string" && result.nextCursor.trim()
        ? result.nextCursor.trim()
        : null,
  };
}

function appendUniqueTasks(current, incoming) {
  const next = [...current];
  const seen = new Set(current.map((task) => task?.id).filter(Boolean));
  for (const task of incoming) {
    if (!task?.id || seen.has(task.id)) continue;
    seen.add(task.id);
    next.push(task);
  }
  return next;
}

function candidateLabel(candidate) {
  return `${candidate.streamer?.displayName || "主播名称未提供"} V${candidate.recordingVersion}`;
}

function formatDate(value) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function safeAdmissionShareUiError(error, fallback) {
  if (
    error?.code === "SHARE_SELECTION_CHANGED" ||
    error?.code === "SELECTION_STALE"
  ) {
    return "部分录屏状态已变化";
  }
  if (error?.code === "SHARE_FORMAL_ROUND_CONFLICT") {
    return "当前已有正式复核轮次，请刷新任务后重试";
  }
  if (Number(error?.status) >= 500) return fallback;
  return error?.message || fallback;
}

function contactCardOptionLabel(card) {
  return [card?.displayName, card?.title].filter(Boolean).join(" · ");
}

function draftPresentation({ draft, project, brand, contactCards, selected }) {
  const contactCard =
    contactCards.find((card) => card.id === draft.contactCardId) || null;
  return {
    title: draft.title.trim() || "未命名分享",
    purpose: draft.purpose.trim(),
    mode: draft.mode,
    status: "draft",
    reviewState: "not_started",
    roundNumber: null,
    expiresAt: dateInputToIso(draft.expiresAt),
    project: {
      id: project.id,
      name: project.name || "项目名称待确认",
      code: project.code || "项目代码待确认",
    },
    progress: { completed: 0, total: selected.length },
    latestSubmission: null,
    brand: brand || fallbackShareBrand,
    contactCard,
    items: selected.map((candidate) => ({
      applicationId: candidate.applicationId,
      recordingSubmissionId: candidate.recordingSubmissionId,
      recordingVersion: candidate.recordingVersion,
      sourceHealth: candidate.sourceHealth,
      streamer: {
        id: candidate.streamer?.id || "",
        displayName: candidate.streamer?.displayName || "主播名称未提供",
        accountLabel: candidate.streamer?.accountLabel || "",
      },
      finalReview: null,
    })),
  };
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard command was rejected");
  }
}

export function AdmissionShareCenter({ project, actions, onClose }) {
  const firstTabRef = React.useRef(null);
  const taskTabRef = React.useRef(null);
  const centerDialogRef = React.useRef(null);
  const openerRef = React.useRef(null);
  const wizardOpenerRef = React.useRef(null);
  const restoreTaskFocusAfterDeliveryRef = React.useRef(false);
  const [tab, setTab] = React.useState("library");
  const [candidates, setCandidates] = React.useState([]);
  const [tasks, setTasks] = React.useState([]);
  const [taskNextCursor, setTaskNextCursor] = React.useState(null);
  const [issueListState, setIssueListState] = React.useState(() => ({
    projectId: project.id,
    issues: [],
    error: "",
    loading: false,
  }));
  const [selected, setSelected] = React.useState(new Map());
  const [expandedVersions, setExpandedVersions] = React.useState(new Set());
  const [search, setSearch] = React.useState("");
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [shareableOnly, setShareableOnly] = React.useState(false);
  const [candidatesLoading, setCandidatesLoading] = React.useState(true);
  const [tasksLoading, setTasksLoading] = React.useState(true);
  const [tasksLoadingMore, setTasksLoadingMore] = React.useState(false);
  const [candidateError, setCandidateError] = React.useState("");
  const [taskError, setTaskError] = React.useState("");
  const [issueResolveErrors, setIssueResolveErrors] = React.useState({});
  const [resolvingIssueIds, setResolvingIssueIds] = React.useState(new Set());
  const [busy, setBusy] = React.useState("");
  const [pendingTasks, setPendingTasks] = React.useState(new Set());
  const [message, setMessage] = React.useState("");
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [wizardStep, setWizardStep] = React.useState(0);
  const [wizardError, setWizardError] = React.useState("");
  const [wizardProject, setWizardProject] = React.useState(null);
  const [preflight, setPreflight] = React.useState(null);
  const [draft, setDraft] = React.useState({
    mode: "formal_review",
    title: `${project.name || "项目"} 录屏复核`,
    purpose: "",
    expiresAt: sevenDaysFromNowInput(),
    requireAccessCode: true,
    accessCode: "",
    allowExternalFallback: true,
    contactCardId: null,
  });
  const [shareBrand, setShareBrand] = React.useState(fallbackShareBrand);
  const [shareBrandLoading, setShareBrandLoading] = React.useState(true);
  const [shareBrandError, setShareBrandError] = React.useState("");
  const [contactCards, setContactCards] = React.useState([]);
  const [contactCardsLoading, setContactCardsLoading] = React.useState(true);
  const [contactCardsError, setContactCardsError] = React.useState("");
  const [taskPreview, setTaskPreview] = React.useState(null);
  const [delivery, setDelivery] = React.useState(null);
  const [sensitiveDeliveryPending, setSensitiveDeliveryPending] =
    React.useState(false);
  const [taskExpiresAt, setTaskExpiresAt] = React.useState({});
  const [reopenReasons, setReopenReasons] = React.useState({});
  const [submissions, setSubmissions] = React.useState({});
  const resolvingIssueIdsRef = React.useRef(new Set());
  const mountedRef = React.useRef(false);
  const currentProjectIdRef = React.useRef(project.id);
  const currentProjectNameRef = React.useRef(project.name);
  currentProjectNameRef.current = project.name;
  const candidateGenerationRef = React.useRef(0);
  const taskListGenerationRef = React.useRef(0);
  const shareBrandGenerationRef = React.useRef(0);
  const contactCardGenerationRef = React.useRef(0);
  const taskPreviewGenerationRef = React.useRef(0);
  const preflightGenerationRef = React.useRef(0);
  const createGenerationRef = React.useRef(0);
  const createPendingRef = React.useRef(false);
  const sensitiveDeliveryPendingRef = React.useRef(false);
  const wizardFocusRestoreRef = React.useRef(null);
  const deliveryRef = React.useRef(null);
  deliveryRef.current = delivery;
  const issueListGenerationRef = React.useRef(0);
  const issueResolveGenerationRef = React.useRef(new Map());
  const nextIssueResolveGenerationRef = React.useRef(0);
  const currentIssueList =
    issueListState.projectId === project.id
      ? issueListState
      : { issues: [], error: "", loading: false };
  const canCreateShare = canShareAdmissionRecordingsForProject(project.status);
  const projectGateMessage =
    project.status === "settling"
      ? "项目已进入结算阶段，不能新建录屏分享"
      : "当前项目阶段不能新建录屏分享";

  React.useEffect(() => {
    const issueResolveGenerations = issueResolveGenerationRef.current;
    const resolvingIssueIds = resolvingIssueIdsRef.current;
    mountedRef.current = true;
    openerRef.current = document.activeElement;
    firstTabRef.current?.focus();
    return () => {
      mountedRef.current = false;
      wizardOpenerRef.current = null;
      wizardFocusRestoreRef.current = null;
      candidateGenerationRef.current += 1;
      taskListGenerationRef.current += 1;
      shareBrandGenerationRef.current += 1;
      contactCardGenerationRef.current += 1;
      taskPreviewGenerationRef.current += 1;
      preflightGenerationRef.current += 1;
      createGenerationRef.current += 1;
      createPendingRef.current = false;
      sensitiveDeliveryPendingRef.current = false;
      issueListGenerationRef.current += 1;
      issueResolveGenerations.clear();
      resolvingIssueIds.clear();
      openerRef.current?.focus?.();
    };
  }, []);

  React.useLayoutEffect(() => {
    const preservePendingCreate = createPendingRef.current;
    wizardOpenerRef.current = null;
    wizardFocusRestoreRef.current = null;
    currentProjectIdRef.current = project.id;
    candidateGenerationRef.current += 1;
    taskListGenerationRef.current += 1;
    shareBrandGenerationRef.current += 1;
    contactCardGenerationRef.current += 1;
    taskPreviewGenerationRef.current += 1;
    preflightGenerationRef.current += 1;
    if (!preservePendingCreate) createGenerationRef.current += 1;
    issueListGenerationRef.current += 1;
    issueResolveGenerationRef.current.clear();
    resolvingIssueIdsRef.current.clear();
    setCandidates([]);
    setCandidatesLoading(true);
    setCandidateError("");
    setIssueResolveErrors({});
    setResolvingIssueIds(new Set());
    setTasks([]);
    setTaskNextCursor(null);
    setTaskError("");
    setTasksLoading(true);
    setTasksLoadingMore(false);
    setPendingTasks(new Set());
    setTaskExpiresAt({});
    setReopenReasons({});
    setSubmissions({});
    setMessage("");
    if (!preservePendingCreate) {
      setSelected(new Map());
      setPreflight(null);
      setWizardOpen(false);
      setWizardStep(0);
      setWizardError("");
      setWizardProject(null);
      setBusy("");
    }
    setShareBrand(fallbackShareBrand);
    setShareBrandLoading(true);
    setShareBrandError("");
    setContactCards([]);
    setContactCardsLoading(true);
    setContactCardsError("");
    setTaskPreview(null);
    if (!preservePendingCreate) {
      setDraft((current) => ({
        ...current,
        title: `${currentProjectNameRef.current || "项目"} 录屏复核`,
        contactCardId: null,
        accessCode: "",
      }));
    }
  }, [project.id]);

  const loadTasks = React.useCallback(async () => {
    const requestProjectId = project.id;
    const requestGeneration = taskListGenerationRef.current + 1;
    taskListGenerationRef.current = requestGeneration;
    const isCurrentRequest = () =>
      mountedRef.current &&
      currentProjectIdRef.current === requestProjectId &&
      taskListGenerationRef.current === requestGeneration;
    setTasksLoading(true);
    setTasksLoadingMore(false);
    setTaskError("");
    try {
      if (!actions.listAdmissionShareBoards) {
        throw new Error("分享任务接口暂未接入");
      }
      const result = await actions.listAdmissionShareBoards(project.id);
      const page = normalizeTaskPage(result);
      if (!isCurrentRequest()) return [];
      setTasks(appendUniqueTasks([], page.shareBoards));
      setTaskNextCursor(page.nextCursor);
      return page.shareBoards;
    } catch (error) {
      if (!isCurrentRequest()) return [];
      setTaskError(error?.message || "分享任务加载失败");
      throw error;
    } finally {
      if (isCurrentRequest()) setTasksLoading(false);
    }
  }, [actions, project.id]);

  const loadMoreTasks = React.useCallback(async () => {
    const cursor = taskNextCursor;
    if (!cursor || tasksLoadingMore) return [];
    const requestProjectId = project.id;
    const requestGeneration = taskListGenerationRef.current + 1;
    taskListGenerationRef.current = requestGeneration;
    const isCurrentRequest = () =>
      mountedRef.current &&
      currentProjectIdRef.current === requestProjectId &&
      taskListGenerationRef.current === requestGeneration;
    setTasksLoadingMore(true);
    setTaskError("");
    try {
      if (!actions.listAdmissionShareBoards) {
        throw new Error("分享任务接口暂未接入");
      }
      const result = await actions.listAdmissionShareBoards(
        requestProjectId,
        cursor,
      );
      const page = normalizeTaskPage(result);
      if (page.nextCursor === cursor) {
        throw new Error("分享任务分页游标重复");
      }
      if (!isCurrentRequest()) return [];
      setTasks((current) => appendUniqueTasks(current, page.shareBoards));
      setTaskNextCursor(page.nextCursor);
      return page.shareBoards;
    } catch (error) {
      if (!isCurrentRequest()) return [];
      setTaskError(error?.message || "分享任务加载更多失败");
      throw error;
    } finally {
      if (isCurrentRequest()) setTasksLoadingMore(false);
    }
  }, [actions, project.id, taskNextCursor, tasksLoadingMore]);

  React.useLayoutEffect(() => {
    if (!delivery && restoreTaskFocusAfterDeliveryRef.current) {
      restoreTaskFocusAfterDeliveryRef.current = false;
      taskTabRef.current?.focus();
    }
  }, [delivery]);

  React.useLayoutEffect(() => {
    if (wizardOpen) return;
    const restoreContext = wizardFocusRestoreRef.current;
    if (!restoreContext) return;
    wizardFocusRestoreRef.current = null;
    const target = restoreContext.element;
    const center = restoreContext.center;
    if (
      wizardOpenerRef.current ||
      !mountedRef.current ||
      !target ||
      !center ||
      restoreContext.projectId !== currentProjectIdRef.current ||
      centerDialogRef.current !== center ||
      !target.isConnected ||
      !center.contains(target) ||
      target.matches?.(":disabled") ||
      target.tabIndex < 0 ||
      target.closest?.("[inert]")
    ) {
      return;
    }
    const activeElement = document.activeElement;
    if (
      activeElement === target ||
      (activeElement &&
        activeElement !== document.body &&
        activeElement !== document.documentElement &&
        activeElement.isConnected)
    ) {
      return;
    }
    target.focus({ preventScroll: true });
  }, [busy, wizardOpen]);

  const loadCandidates = React.useCallback(async () => {
    const requestProjectId = project.id;
    const requestGeneration = candidateGenerationRef.current + 1;
    candidateGenerationRef.current = requestGeneration;
    const isCurrentRequest = () =>
      mountedRef.current &&
      currentProjectIdRef.current === requestProjectId &&
      candidateGenerationRef.current === requestGeneration;
    setCandidatesLoading(true);
    setCandidateError("");
    try {
      if (!actions.listAdmissionShareCandidates) {
        throw new Error("录屏候选接口暂未接入");
      }
      const result =
        await actions.listAdmissionShareCandidates(requestProjectId);
      const next = Array.isArray(result) ? result : [];
      if (!isCurrentRequest()) return [];
      setCandidates(next);
      return next;
    } catch (error) {
      if (!isCurrentRequest()) return [];
      setCandidateError(error?.message || "录屏库加载失败");
      throw error;
    } finally {
      if (isCurrentRequest()) setCandidatesLoading(false);
    }
  }, [actions, project.id]);

  const loadShareBrand = React.useCallback(async () => {
    const requestProjectId = project.id;
    const requestGeneration = shareBrandGenerationRef.current + 1;
    shareBrandGenerationRef.current = requestGeneration;
    const isCurrentRequest = () =>
      mountedRef.current &&
      currentProjectIdRef.current === requestProjectId &&
      shareBrandGenerationRef.current === requestGeneration;
    setShareBrandLoading(true);
    setShareBrandError("");
    try {
      if (!actions.getAdmissionShareBrandPreview) {
        throw new Error("组织品牌预览接口暂未接入");
      }
      const brand = await actions.getAdmissionShareBrandPreview();
      if (!isCurrentRequest()) return null;
      setShareBrand(brand || fallbackShareBrand);
      return brand;
    } catch (error) {
      if (!isCurrentRequest()) return null;
      setShareBrand(fallbackShareBrand);
      setShareBrandError(error?.message || "组织品牌加载失败");
      return null;
    } finally {
      if (isCurrentRequest()) setShareBrandLoading(false);
    }
  }, [actions, project.id]);

  const loadContactCards = React.useCallback(async () => {
    const requestProjectId = project.id;
    const requestGeneration = contactCardGenerationRef.current + 1;
    contactCardGenerationRef.current = requestGeneration;
    const isCurrentRequest = () =>
      mountedRef.current &&
      currentProjectIdRef.current === requestProjectId &&
      contactCardGenerationRef.current === requestGeneration;
    setContactCardsLoading(true);
    setContactCardsError("");
    try {
      if (!actions.listAdmissionShareContactCards) {
        throw new Error("组织联系名片接口暂未接入");
      }
      const result = await actions.listAdmissionShareContactCards();
      const activeCards = (Array.isArray(result) ? result : []).filter(
        (card) => card?.status === "active",
      );
      if (!isCurrentRequest()) return [];
      setContactCards(activeCards);
      setDraft((current) => ({
        ...current,
        contactCardId: activeCards.some(
          (card) => card.id === current.contactCardId,
        )
          ? current.contactCardId
          : null,
      }));
      return activeCards;
    } catch (error) {
      if (!isCurrentRequest()) return [];
      setContactCards([]);
      setDraft((current) => ({ ...current, contactCardId: null }));
      setContactCardsError(error?.message || "组织联系名片加载失败");
      return [];
    } finally {
      if (isCurrentRequest()) setContactCardsLoading(false);
    }
  }, [actions, project.id]);

  const loadIssues = React.useCallback(async () => {
    const requestProjectId = project.id;
    const requestGeneration = issueListGenerationRef.current + 1;
    issueListGenerationRef.current = requestGeneration;
    const isCurrentRequest = () =>
      mountedRef.current &&
      currentProjectIdRef.current === requestProjectId &&
      issueListGenerationRef.current === requestGeneration;
    setIssueListState((current) => ({
      projectId: requestProjectId,
      issues: current.projectId === requestProjectId ? current.issues : [],
      error: "",
      loading: true,
    }));
    try {
      if (!actions.listAdmissionSharePlaybackIssues) {
        throw new Error("播放问题接口暂未接入");
      }
      const result = await actions.listAdmissionSharePlaybackIssues(
        project.id,
        "open",
      );
      const next = Array.isArray(result) ? result : [];
      if (!isCurrentRequest()) {
        return [];
      }
      setIssueListState({
        projectId: requestProjectId,
        issues: next,
        error: "",
        loading: false,
      });
      return next;
    } catch (error) {
      if (!isCurrentRequest()) {
        return [];
      }
      setIssueListState((current) => ({
        projectId: requestProjectId,
        issues: current.projectId === requestProjectId ? current.issues : [],
        error: error?.message || "播放问题待办加载失败",
        loading: false,
      }));
      throw error;
    }
  }, [actions, project.id]);

  React.useEffect(() => {
    void loadShareBrand();
    void loadContactCards();
  }, [loadContactCards, loadShareBrand]);

  React.useEffect(() => {
    let current = true;
    const requestProjectId = project.id;
    const candidateRequestGeneration = candidateGenerationRef.current + 1;
    candidateGenerationRef.current = candidateRequestGeneration;
    const taskRequestGeneration = taskListGenerationRef.current + 1;
    taskListGenerationRef.current = taskRequestGeneration;
    const isCurrentTaskRequest = () =>
      current &&
      mountedRef.current &&
      currentProjectIdRef.current === requestProjectId &&
      taskListGenerationRef.current === taskRequestGeneration;
    const isCurrentCandidateRequest = () =>
      current &&
      mountedRef.current &&
      currentProjectIdRef.current === requestProjectId &&
      candidateGenerationRef.current === candidateRequestGeneration;
    void Promise.allSettled([
      Promise.resolve().then(() => {
        if (!actions.listAdmissionShareCandidates) {
          throw new Error("录屏候选接口暂未接入");
        }
        return actions.listAdmissionShareCandidates(project.id);
      }),
      Promise.resolve().then(() => {
        if (!actions.listAdmissionShareBoards) {
          throw new Error("分享任务接口暂未接入");
        }
        return actions.listAdmissionShareBoards(project.id);
      }),
    ]).then(([candidateResult, taskResult]) => {
      if (isCurrentCandidateRequest()) {
        if (candidateResult.status === "fulfilled") {
          setCandidates(
            Array.isArray(candidateResult.value) ? candidateResult.value : [],
          );
        } else {
          setCandidateError(
            candidateResult.reason?.message || "录屏库加载失败",
          );
        }
        setCandidatesLoading(false);
      }
      if (isCurrentTaskRequest()) {
        if (taskResult.status === "fulfilled") {
          const page = normalizeTaskPage(taskResult.value);
          setTasks(appendUniqueTasks([], page.shareBoards));
          setTaskNextCursor(page.nextCursor);
        } else {
          setTaskError(taskResult.reason?.message || "分享任务加载失败");
        }
        setTasksLoading(false);
      }
    });
    return () => {
      current = false;
    };
  }, [actions, project.id]);

  const selectedCandidates = React.useMemo(
    () => Array.from(selected.values()),
    [selected],
  );

  const candidateByRecordingId = React.useMemo(
    () =>
      new Map(
        candidates.map((candidate) => [
          candidate.recordingSubmissionId,
          candidate,
        ]),
      ),
    [candidates],
  );

  const groupedCandidates = React.useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const matches = candidates.filter((candidate) => {
      const searchable = [
        candidate.streamer?.displayName,
        candidate.streamer?.accountLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (normalizedSearch && !searchable.includes(normalizedSearch)) {
        return false;
      }
      if (shareableOnly && !candidate.isShareable) return false;
      if (sourceFilter === "original" && !candidate.hasPrivateStorage) {
        return false;
      }
      if (sourceFilter === "external" && !candidate.externalUrl) return false;
      if (sourceFilter === "blocked" && candidate.sourceHealth !== "blocked") {
        return false;
      }
      return true;
    });

    const groups = new Map();
    for (const candidate of matches) {
      const group = groups.get(candidate.applicationId) || [];
      group.push(candidate);
      groups.set(candidate.applicationId, group);
    }
    return Array.from(groups.entries()).map(([applicationId, items]) => ({
      applicationId,
      items: items.sort(
        (left, right) => right.recordingVersion - left.recordingVersion,
      ),
    }));
  }, [candidates, search, shareableOnly, sourceFilter]);

  const toggleSelection = (candidate) => {
    if (!canCreateShare) {
      setMessage(projectGateMessage);
      return;
    }
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(candidate.recordingSubmissionId)) {
        next.delete(candidate.recordingSubmissionId);
      } else {
        next.set(candidate.recordingSubmissionId, candidate);
      }
      return next;
    });
  };

  const moveSelection = (recordingSubmissionId, offset) => {
    setSelected((current) => {
      const entries = Array.from(current.entries());
      const index = entries.findIndex(([id]) => id === recordingSubmissionId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= entries.length) return current;
      [entries[index], entries[target]] = [entries[target], entries[index]];
      return new Map(entries);
    });
  };

  const startWizard = async (event) => {
    const eventOpener = event?.currentTarget;
    const center = centerDialogRef.current;
    wizardFocusRestoreRef.current = null;
    wizardOpenerRef.current =
      eventOpener &&
      center &&
      center.contains(eventOpener) &&
      typeof eventOpener.focus === "function"
        ? { element: eventOpener, projectId: project.id, center }
        : null;
    if (!canCreateShare) {
      setMessage(projectGateMessage);
      return;
    }
    if (selected.size === 0) {
      setMessage("请先主动选择本次分享的录屏");
      return;
    }
    if (!actions.preflightAdmissionShareBoard) {
      setMessage("分享预检接口暂未接入");
      return;
    }
    const requestProject = {
      id: project.id,
      name: project.name,
      code: project.code,
    };
    const requestGeneration = preflightGenerationRef.current + 1;
    preflightGenerationRef.current = requestGeneration;
    const isCurrentRequest = () =>
      mountedRef.current &&
      currentProjectIdRef.current === requestProject.id &&
      preflightGenerationRef.current === requestGeneration;
    const items = selectedCandidates.map(shareItem);
    setBusy("preflight");
    setMessage("");
    setWizardError("");
    setWizardOpen(true);
    setWizardProject(requestProject);
    setWizardStep(0);
    setPreflight(null);
    try {
      const result = await actions.preflightAdmissionShareBoard(
        requestProject.id,
        items,
      );
      if (!isCurrentRequest()) return;
      setPreflight(result);
      if ((result?.summary?.blocked || 0) === 0) {
        setWizardStep(1);
      }
    } catch (error) {
      if (!isCurrentRequest()) return;
      setWizardError(
        safeAdmissionShareUiError(error, "分享预检失败，请稍后重试"),
      );
    } finally {
      if (isCurrentRequest()) setBusy("");
    }
  };

  const removeBlockedAndContinue = () => {
    const blockedIds = new Set(
      (preflight?.items || [])
        .filter((item) => item.status === "blocked")
        .map((item) => item.recordingSubmissionId),
    );
    setSelected(
      new Map(
        Array.from(selected.entries()).filter(([id]) => !blockedIds.has(id)),
      ),
    );
    setPreflight((current) => ({
      ...current,
      items: (current?.items || []).filter((item) => item.status !== "blocked"),
      summary: {
        ready: current?.summary?.ready || 0,
        warning: current?.summary?.warning || 0,
        blocked: 0,
      },
    }));
    setWizardStep(1);
  };

  const createShare = async () => {
    if (!actions.createAdmissionShareBoard) {
      setMessage("创建分享接口暂未接入");
      return;
    }
    const requestProject = wizardProject || {
      id: project.id,
      name: project.name,
      code: project.code,
    };
    const requestGeneration = createGenerationRef.current + 1;
    createGenerationRef.current = requestGeneration;
    createPendingRef.current = true;
    const isCurrentRequest = () =>
      mountedRef.current && createGenerationRef.current === requestGeneration;
    setBusy("create");
    setMessage("");
    setWizardError("");
    try {
      const expiresAt = dateInputToIso(draft.expiresAt);
      const result = await actions.createAdmissionShareBoard(
        requestProject.id,
        {
          mode: draft.mode,
          title: draft.title.trim(),
          purpose: draft.purpose.trim() || undefined,
          expiresAt: expiresAt || undefined,
          requireAccessCode: draft.requireAccessCode,
          accessCode:
            draft.requireAccessCode && draft.accessCode.trim()
              ? draft.accessCode.trim()
              : undefined,
          allowExternalFallback: draft.allowExternalFallback,
          contactCardId: draft.contactCardId,
          items: selectedCandidates.map(shareItem),
        },
      );
      if (!isCurrentRequest()) return;
      createPendingRef.current = false;
      setBusy("");
      const persistedPresentation = result?.shareBoard?.presentation || null;
      setDelivery({
        kind: "created",
        projectId: requestProject.id,
        projectName: requestProject.name || requestProject.id,
        shareUrl: result?.shareUrl || "",
        accessCode: result?.accessCode || "",
        title: persistedPresentation?.title || draft.title.trim(),
        presentation: persistedPresentation,
      });
      setSelected(new Map());
      wizardOpenerRef.current = null;
      setPreflight(null);
      setWizardOpen(false);
      setWizardStep(0);
      setWizardProject(null);
      setDraft((current) => ({
        ...current,
        accessCode: "",
        contactCardId: null,
      }));
      if (currentProjectIdRef.current === requestProject.id) {
        setMessage("分享任务已创建；链接和访问码仅在本次弹窗展示");
        await loadTasks().catch(() => {});
      }
    } catch (error) {
      if (!isCurrentRequest()) return;
      const isSourceProjectCurrent =
        currentProjectIdRef.current === requestProject.id;
      const errorMessage = safeAdmissionShareUiError(
        error,
        "分享任务创建失败，请稍后重试",
      );
      if (isSourceProjectCurrent) setWizardError(errorMessage);
      else {
        setWizardOpen(false);
        setWizardStep(0);
        setWizardProject(null);
        setSelected(new Map());
        setPreflight(null);
        setMessage(
          `${requestProject.name || "上一项目"}的分享任务创建失败，请返回后重试`,
        );
      }
      if (
        isSourceProjectCurrent &&
        (error?.code === "SHARE_SELECTION_CHANGED" ||
          error?.code === "SELECTION_STALE")
      ) {
        const staleById = new Map(
          (Array.isArray(error.items) ? error.items : []).map((item) => [
            item.recordingSubmissionId,
            item,
          ]),
        );
        const priorItems =
          preflight?.items?.length > 0
            ? preflight.items
            : selectedCandidates.map((candidate, index) => ({
                ...shareItem(candidate, index),
                status: "ready",
                sourceHealth: candidate.sourceHealth,
                reasonCode: null,
              }));
        const items = priorItems.map((item) => ({
          ...item,
          ...(staleById.get(item.recordingSubmissionId) || {}),
        }));
        setPreflight({
          items,
          summary: items.reduce(
            (summary, item) => ({
              ...summary,
              [item.status]: (summary[item.status] || 0) + 1,
            }),
            { ready: 0, warning: 0, blocked: 0 },
          ),
        });
        setWizardStep(0);
      }
    } finally {
      if (isCurrentRequest()) {
        createPendingRef.current = false;
        setBusy("");
      }
    }
  };

  const loadTaskPreview = async (task, requestProjectId = project.id) => {
    if (currentProjectIdRef.current !== requestProjectId) return null;
    const requestGeneration = taskPreviewGenerationRef.current + 1;
    taskPreviewGenerationRef.current = requestGeneration;
    const isCurrentRequest = () =>
      mountedRef.current &&
      currentProjectIdRef.current === requestProjectId &&
      taskPreviewGenerationRef.current === requestGeneration;
    setTaskPreview({
      projectId: requestProjectId,
      taskId: task.id,
      status: "loading",
      presentation: null,
      error: "",
    });
    try {
      if (!actions.getAdmissionShareBoardDetail) {
        throw new Error("分享详情接口暂未接入");
      }
      const detail = await actions.getAdmissionShareBoardDetail(
        requestProjectId,
        task.id,
      );
      if (!isCurrentRequest()) return null;
      if (!detail?.presentation) {
        throw new Error("分享详情未返回已保存预览");
      }
      setTaskPreview({
        projectId: requestProjectId,
        taskId: task.id,
        status: "ready",
        presentation: detail.presentation,
        error: "",
      });
      return detail;
    } catch (error) {
      if (!isCurrentRequest()) return null;
      setTaskPreview({
        projectId: requestProjectId,
        taskId: task.id,
        status: "error",
        presentation: null,
        error: safeAdmissionShareUiError(
          error,
          "分享预览暂时无法加载，请稍后重试",
        ),
      });
      return null;
    }
  };

  const runTaskAction = async (
    taskId,
    action,
    successMessage,
    { refresh = true, previewTask = null } = {},
  ) => {
    const requestProjectId = project.id;
    const shouldReloadPreview = previewTask && taskPreview?.taskId === taskId;
    if (shouldReloadPreview) {
      taskPreviewGenerationRef.current += 1;
      setTaskPreview(null);
    }
    setPendingTasks((current) => new Set(current).add(taskId));
    setMessage("");
    try {
      const result = await action();
      if (currentProjectIdRef.current === requestProjectId) {
        if (successMessage) setMessage(successMessage);
        if (refresh) await loadTasks();
        if (
          shouldReloadPreview &&
          currentProjectIdRef.current === requestProjectId
        ) {
          await loadTaskPreview(previewTask, requestProjectId);
        }
      }
      return result;
    } catch (error) {
      if (currentProjectIdRef.current === requestProjectId) {
        setMessage(
          safeAdmissionShareUiError(error, "分享任务操作失败，请稍后重试"),
        );
      }
    } finally {
      if (currentProjectIdRef.current === requestProjectId) {
        setPendingTasks((current) => {
          const next = new Set(current);
          next.delete(taskId);
          return next;
        });
      }
    }
  };

  const rotateTaskToken = async (task) => {
    if (
      !actions.rotateAdmissionShareBoardToken ||
      sensitiveDeliveryPendingRef.current
    ) {
      return;
    }
    sensitiveDeliveryPendingRef.current = true;
    setSensitiveDeliveryPending(true);
    const requestProject = {
      id: project.id,
      name: project.name,
    };
    try {
      const result = await runTaskAction(
        task.id,
        () =>
          actions.rotateAdmissionShareBoardToken(requestProject.id, task.id),
        "",
        { refresh: false, previewTask: task },
      );
      if (result && mountedRef.current) {
        const nextDelivery = {
          kind: "reset",
          projectId: requestProject.id,
          projectName: requestProject.name || requestProject.id,
          title: `${task.title}（已重置）`,
          shareUrl: result?.shareUrl || "",
          accessCode: result?.accessCode || "",
        };
        deliveryRef.current = nextDelivery;
        setDelivery(nextDelivery);
      }
    } finally {
      sensitiveDeliveryPendingRef.current = false;
      if (mountedRef.current) setSensitiveDeliveryPending(false);
    }
  };

  const viewSubmissions = async (task) => {
    if (!actions.listAdmissionShareSubmissions) return;
    const result = await runTaskAction(
      task.id,
      () => actions.listAdmissionShareSubmissions(project.id, task.id),
      "",
      { refresh: false },
    );
    if (result) {
      setSubmissions((current) => ({
        ...current,
        [task.id]: Array.isArray(result) ? result : [],
      }));
    }
  };

  const toggleTaskPreview = async (task) => {
    if (taskPreview?.taskId === task.id && taskPreview.status === "loading") {
      return;
    }
    if (taskPreview?.taskId === task.id && taskPreview.status === "ready") {
      taskPreviewGenerationRef.current += 1;
      setTaskPreview(null);
      return;
    }

    await loadTaskPreview(task);
  };

  const changeTab = (nextTab) => {
    setTab(nextTab);
    setMessage("");
    if (nextTab === "results") {
      void loadIssues().catch(() => {});
    }
  };

  const resolveIssue = async (issue) => {
    if (
      !actions.resolveAdmissionSharePlaybackIssue ||
      resolvingIssueIdsRef.current.has(issue.id)
    ) {
      return;
    }
    const requestProjectId = project.id;
    const requestGeneration = nextIssueResolveGenerationRef.current + 1;
    nextIssueResolveGenerationRef.current = requestGeneration;
    issueResolveGenerationRef.current.set(issue.id, requestGeneration);
    resolvingIssueIdsRef.current.add(issue.id);
    setIssueResolveErrors((current) => {
      const next = { ...current };
      delete next[issue.id];
      return next;
    });
    setResolvingIssueIds((current) => {
      const next = new Set(current);
      next.add(issue.id);
      return next;
    });
    try {
      await actions.resolveAdmissionSharePlaybackIssue(
        requestProjectId,
        issue.id,
      );
      if (
        !mountedRef.current ||
        currentProjectIdRef.current !== requestProjectId ||
        issueResolveGenerationRef.current.get(issue.id) !== requestGeneration
      ) {
        return;
      }
      setIssueListState((current) =>
        current.projectId === requestProjectId
          ? {
              ...current,
              issues: current.issues.filter((item) => item.id !== issue.id),
            }
          : current,
      );
      setMessage("播放问题已标记为解决");
    } catch (error) {
      if (
        !mountedRef.current ||
        currentProjectIdRef.current !== requestProjectId ||
        issueResolveGenerationRef.current.get(issue.id) !== requestGeneration
      ) {
        return;
      }
      setIssueResolveErrors((current) => ({
        ...current,
        [issue.id]: error?.message || "播放问题处理失败",
      }));
    } finally {
      const isLatestRequest =
        issueResolveGenerationRef.current.get(issue.id) === requestGeneration;
      const canUpdateState =
        mountedRef.current &&
        currentProjectIdRef.current === requestProjectId &&
        isLatestRequest;
      if (isLatestRequest) {
        issueResolveGenerationRef.current.delete(issue.id);
        resolvingIssueIdsRef.current.delete(issue.id);
      }
      if (canUpdateState) {
        setResolvingIssueIds((current) => {
          const next = new Set(current);
          next.delete(issue.id);
          return next;
        });
      }
    }
  };

  const closeWizard = () => {
    if (createPendingRef.current) return;
    const restoreContext = wizardOpenerRef.current;
    wizardOpenerRef.current = null;
    wizardFocusRestoreRef.current = restoreContext;
    preflightGenerationRef.current += 1;
    setBusy((current) => (current === "preflight" ? "" : current));
    setWizardOpen(false);
    setPreflight(null);
    setWizardStep(0);
    setWizardError("");
    setWizardProject(null);
    setDraft((current) => ({ ...current, accessCode: "" }));
  };

  const closeDelivery = () => {
    restoreTaskFocusAfterDeliveryRef.current = true;
    setTab("tasks");
    setDelivery(null);
    setDraft((current) => ({ ...current, accessCode: "" }));
  };

  const closeCenter = () => {
    if (
      createPendingRef.current ||
      sensitiveDeliveryPendingRef.current ||
      deliveryRef.current
    ) {
      return;
    }
    candidateGenerationRef.current += 1;
    shareBrandGenerationRef.current += 1;
    contactCardGenerationRef.current += 1;
    taskPreviewGenerationRef.current += 1;
    preflightGenerationRef.current += 1;
    createGenerationRef.current += 1;
    wizardOpenerRef.current = null;
    wizardFocusRestoreRef.current = null;
    setDelivery(null);
    setWizardOpen(false);
    setTaskPreview(null);
    setDraft((current) => ({ ...current, accessCode: "" }));
    openerRef.current?.focus?.();
    onClose?.();
  };

  const centerMessage = sensitiveDeliveryPending
    ? "正在重置分享链接，请等待一次性交付信息返回…"
    : message;

  return (
    <>
      <style>{admissionShareCss}</style>
      <section
        ref={centerDialogRef}
        className="admission-share-center"
        role="dialog"
        aria-modal="true"
        aria-busy={sensitiveDeliveryPending ? "true" : undefined}
        aria-hidden={wizardOpen || Boolean(delivery) ? "true" : undefined}
        inert={wizardOpen || Boolean(delivery)}
        aria-label={`${project.name || "项目"} 录屏分享中心`}
        onKeyDown={(event) => {
          if (!wizardOpen && !delivery) {
            trapDialogKeyDown(event, centerDialogRef.current, closeCenter);
          }
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 90,
          display: "grid",
          placeItems: "center",
          padding: 16,
          background: "rgba(15, 23, 42, 0.28)",
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeCenter();
        }}
      >
        <div
          className="admission-share-center-panel"
          style={{
            width: "min(1180px, 100%)",
            height: "min(860px, calc(100vh - 32px))",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderRadius: 10,
            background: "var(--bg, #f7f8fb)",
            boxShadow: "0 24px 70px rgba(15, 23, 42, 0.2)",
            color: "var(--ink-900)",
          }}
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              padding: "16px 20px",
              borderBottom: "1px solid var(--line)",
              background: "#fff",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>录屏分享中心</div>
              <div
                style={{
                  minWidth: 0,
                  marginTop: 3,
                  overflowWrap: "anywhere",
                  fontSize: 12,
                  color: "var(--ink-500)",
                }}
              >
                {project.name} · 由你明确选择本轮分享的录屏和版本
              </div>
            </div>
            <ActionButton
              aria-label="关闭录屏分享中心"
              disabled={
                busy === "create" ||
                sensitiveDeliveryPending ||
                Boolean(delivery)
              }
              onClick={closeCenter}
            >
              关闭
            </ActionButton>
          </header>

          <div
            role="tablist"
            aria-label="录屏分享中心栏目"
            style={{
              display: "flex",
              gap: 4,
              padding: "8px 20px 0",
              borderBottom: "1px solid var(--line)",
              background: "#fff",
              overflowX: "auto",
            }}
          >
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`admission-share-tab-${item.id}`}
                aria-controls="admission-share-tabpanel"
                aria-selected={tab === item.id}
                tabIndex={tab === item.id ? 0 : -1}
                className="admission-share-tab"
                ref={
                  item.id === "library"
                    ? firstTabRef
                    : item.id === "tasks"
                      ? taskTabRef
                      : undefined
                }
                onClick={() => changeTab(item.id)}
                onKeyDown={(event) => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  ) {
                    return;
                  }
                  event.preventDefault();
                  const currentIndex = tabs.findIndex(
                    (candidate) => candidate.id === item.id,
                  );
                  const next =
                    event.key === "Home"
                      ? tabs[0]
                      : event.key === "End"
                        ? tabs[tabs.length - 1]
                        : tabs[
                            (currentIndex +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              tabs.length) %
                              tabs.length
                          ];
                  changeTab(next.id);
                  document
                    .getElementById(`admission-share-tab-${next.id}`)
                    ?.focus();
                }}
                style={{
                  minHeight: 44,
                  padding: "0 14px",
                  border: 0,
                  borderBottom:
                    tab === item.id
                      ? "2px solid var(--blue-600)"
                      : "2px solid transparent",
                  background: "transparent",
                  color: tab === item.id ? "var(--blue-700)" : "var(--ink-500)",
                  fontSize: 13,
                  fontWeight: tab === item.id ? 700 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div
            aria-live="polite"
            role="status"
            style={{
              minHeight: centerMessage ? 37 : 0,
              padding: centerMessage ? "9px 20px" : 0,
              borderBottom: centerMessage ? "1px solid var(--line)" : 0,
              background: centerMessage ? "var(--blue-50)" : "transparent",
              color: "var(--blue-700)",
              fontSize: 13,
            }}
          >
            {centerMessage}
          </div>

          <main
            id="admission-share-tabpanel"
            role="tabpanel"
            aria-labelledby={`admission-share-tab-${tab}`}
            style={{ minHeight: 0, flex: 1, overflow: "auto", padding: 20 }}
          >
            {tab === "library" ? (
              <CandidateLibrary
                loading={candidatesLoading}
                error={candidateError}
                onRetry={loadCandidates}
                creationBlocked={!canCreateShare}
                creationBlockedMessage={projectGateMessage}
                groups={groupedCandidates}
                selected={selected}
                selectedCandidates={selectedCandidates}
                expandedVersions={expandedVersions}
                search={search}
                sourceFilter={sourceFilter}
                shareableOnly={shareableOnly}
                onSearchChange={setSearch}
                onSourceFilterChange={setSourceFilter}
                onShareableOnlyChange={setShareableOnly}
                onToggleVersion={(applicationId) =>
                  setExpandedVersions((current) => {
                    const next = new Set(current);
                    if (next.has(applicationId)) next.delete(applicationId);
                    else next.add(applicationId);
                    return next;
                  })
                }
                onToggleSelection={toggleSelection}
                onMoveSelection={moveSelection}
                onPlayback={(candidate) =>
                  actions.openAdmissionShareCandidatePlayback?.(
                    project.id,
                    candidate.recordingSubmissionId,
                  )
                }
                onCreate={startWizard}
                busy={busy === "preflight"}
              />
            ) : null}
            {tab === "tasks" ? (
              <ShareTasks
                tasks={tasks}
                loading={tasksLoading}
                loadingMore={tasksLoadingMore}
                hasMore={Boolean(taskNextCursor)}
                error={taskError}
                onRetry={loadTasks}
                onLoadMore={loadMoreTasks}
                onRetryMore={loadMoreTasks}
                pendingTasks={pendingTasks}
                taskExpiresAt={taskExpiresAt}
                reopenReasons={reopenReasons}
                submissions={submissions}
                taskPreview={taskPreview}
                onTaskExpiresAtChange={(taskId, value) =>
                  setTaskExpiresAt((current) => ({
                    ...current,
                    [taskId]: value,
                  }))
                }
                onReopenReasonChange={(taskId, value) =>
                  setReopenReasons((current) => ({
                    ...current,
                    [taskId]: value,
                  }))
                }
                onRotate={rotateTaskToken}
                onExtend={(task) => {
                  const expiresAt = dateInputToIso(taskExpiresAt[task.id]);
                  if (!expiresAt) {
                    setMessage("请选择新的到期日期");
                    return;
                  }
                  runTaskAction(
                    task.id,
                    () =>
                      actions.extendAdmissionShareBoard?.(
                        project.id,
                        task.id,
                        expiresAt,
                      ),
                    "分享任务已延期",
                    { previewTask: task },
                  );
                }}
                onReopen={(task) => {
                  const reason = (reopenReasons[task.id] || "").trim();
                  if (!reason) {
                    setMessage("请填写重开原因");
                    return;
                  }
                  runTaskAction(
                    task.id,
                    () =>
                      actions.reopenAdmissionShareBoard?.(
                        project.id,
                        task.id,
                        reason,
                      ),
                    "复核任务已重开",
                    { previewTask: task },
                  );
                }}
                onRevoke={(task) =>
                  runTaskAction(
                    task.id,
                    () =>
                      actions.revokeAdmissionShareBoard?.(project.id, task.id),
                    "分享任务已撤销",
                    { previewTask: task },
                  )
                }
                onViewSubmissions={viewSubmissions}
                onViewPreview={toggleTaskPreview}
              />
            ) : null}
            {tab === "results" ? (
              <div style={{ display: "grid", gap: 20 }}>
                <ResultPendingTasks
                  tasks={tasks}
                  loading={tasksLoading}
                  loadingMore={tasksLoadingMore}
                  hasMore={Boolean(taskNextCursor)}
                  error={taskError}
                  submissions={submissions}
                  pendingTasks={pendingTasks}
                  onRetry={loadTasks}
                  onLoadMore={loadMoreTasks}
                  onRetryMore={loadMoreTasks}
                  onViewSubmissions={viewSubmissions}
                />
                <PlaybackIssues
                  issues={currentIssueList.issues}
                  loading={currentIssueList.loading}
                  error={currentIssueList.error}
                  resolveErrors={issueResolveErrors}
                  resolvingIssueIds={resolvingIssueIds}
                  onRetry={() => {
                    void loadIssues().catch(() => {});
                  }}
                  onResolve={resolveIssue}
                />
              </div>
            ) : null}
          </main>
        </div>
      </section>

      {wizardOpen ? (
        <ShareWizard
          step={wizardStep}
          draft={draft}
          preflight={preflight}
          selected={selectedCandidates}
          candidateByRecordingId={candidateByRecordingId}
          project={wizardProject || project}
          shareBrand={shareBrand}
          shareBrandLoading={shareBrandLoading}
          shareBrandError={shareBrandError}
          contactCards={contactCards}
          contactCardsLoading={contactCardsLoading}
          contactCardsError={contactCardsError}
          busy={busy}
          locked={busy === "create"}
          error={wizardError}
          onDraftChange={(patch) =>
            setDraft((current) => ({ ...current, ...patch }))
          }
          onRemoveBlocked={removeBlockedAndContinue}
          onContinue={() =>
            setWizardStep((current) => Math.min(2, current + 1))
          }
          onBack={() => setWizardStep((current) => Math.max(0, current - 1))}
          onCreate={createShare}
          onRetryShareBrand={loadShareBrand}
          onRetryContactCards={loadContactCards}
          onClose={closeWizard}
        />
      ) : null}

      {delivery ? (
        <DeliveryDialog
          delivery={delivery}
          restoreFocusRef={taskTabRef}
          onClose={closeDelivery}
        />
      ) : null}
    </>
  );
}

function CandidateLibrary({
  loading,
  error,
  onRetry,
  creationBlocked,
  creationBlockedMessage,
  groups,
  selected,
  selectedCandidates,
  expandedVersions,
  search,
  sourceFilter,
  shareableOnly,
  onSearchChange,
  onSourceFilterChange,
  onShareableOnlyChange,
  onToggleVersion,
  onToggleSelection,
  onMoveSelection,
  onPlayback,
  onCreate,
  busy,
}) {
  return (
    <div>
      {creationBlocked ? (
        <div
          role="alert"
          style={{
            marginBottom: 14,
            padding: 12,
            border: "1px solid var(--warn-200, var(--line))",
            borderRadius: 6,
            background: "var(--warn-50, #fffbeb)",
            color: "var(--warn-700, #8a5b00)",
            fontSize: 13,
          }}
        >
          {creationBlockedMessage}；历史任务仍可在“分享任务”中查看。
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 14,
            padding: 12,
            border: "1px solid var(--danger-200, var(--line))",
            borderRadius: 6,
            background: "var(--danger-50, #fff7f7)",
            color: "var(--danger-700, var(--danger-600))",
            fontSize: 13,
          }}
        >
          <span>录屏库加载失败：{error}</span>
          <ActionButton
            aria-label="重试加载录屏库"
            onClick={() => void onRetry().catch(() => {})}
          >
            重试
          </ActionButton>
        </div>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
          gap: 10,
          alignItems: "end",
        }}
      >
        <label style={fieldLabelStyle}>
          搜索主播
          <input
            aria-label="搜索主播"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="主播名或账号"
            style={inputStyle}
          />
        </label>
        <label style={fieldLabelStyle}>
          来源筛选
          <select
            aria-label="来源筛选"
            value={sourceFilter}
            onChange={(event) => onSourceFilterChange(event.target.value)}
            style={inputStyle}
          >
            <option value="all">全部来源</option>
            <option value="original">有原始视频</option>
            <option value="external">有外部链接</option>
            <option value="blocked">来源不可用</option>
          </select>
        </label>
        <label
          style={{
            ...fieldLabelStyle,
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <input
            type="checkbox"
            aria-label="只看可分享"
            checked={shareableOnly}
            onChange={(event) => onShareableOnlyChange(event.target.checked)}
          />
          只看可分享
        </label>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {loading ? (
          <div style={emptyStyle}>录屏库加载中…</div>
        ) : groups.length === 0 ? (
          <div style={emptyStyle}>没有符合条件的录屏</div>
        ) : (
          groups.map((group) => {
            const expanded = expandedVersions.has(group.applicationId);
            const visibleItems =
              expanded || group.items.length === 1
                ? group.items
                : group.items.slice(0, 1);
            const streamerName =
              group.items[0]?.streamer?.displayName || "主播名称未提供";
            return (
              <section key={group.applicationId} style={panelStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong
                      style={{
                        minWidth: 0,
                        overflowWrap: "anywhere",
                        fontSize: 13,
                      }}
                    >
                      {streamerName}
                    </strong>
                    <span
                      style={{
                        minWidth: 0,
                        marginLeft: 8,
                        overflowWrap: "anywhere",
                        fontSize: 12,
                        color: "var(--ink-400)",
                      }}
                    >
                      {group.items[0]?.streamer?.accountLabel || "无账号"}
                    </span>
                  </div>
                  {group.items.length > 1 ? (
                    <ActionButton
                      kind="quiet"
                      aria-label={`${expanded ? "收起" : "展开"} ${streamerName} 历史版本`}
                      onClick={() => onToggleVersion(group.applicationId)}
                    >
                      {expanded
                        ? "收起历史版本"
                        : `展开历史版本（${group.items.length - 1}）`}
                    </ActionButton>
                  ) : null}
                </div>
                {visibleItems.map((candidate) => (
                  <CandidateRow
                    key={candidate.recordingSubmissionId}
                    candidate={candidate}
                    checked={selected.has(candidate.recordingSubmissionId)}
                    selectionDisabled={creationBlocked}
                    onToggle={() => onToggleSelection(candidate)}
                    onPlayback={() => onPlayback(candidate)}
                  />
                ))}
              </section>
            );
          })
        )}
      </div>

      {selectedCandidates.length > 0 || creationBlocked ? (
        <section
          className="admission-share-selection-bar"
          role="region"
          aria-label="已选择录屏"
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 2,
            marginTop: 18,
            padding: 12,
            borderTop: "1px solid var(--line)",
            background: "#fff",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <strong style={{ minWidth: 0, fontSize: 14 }}>
              {creationBlocked
                ? creationBlockedMessage
                : `已选择 ${selectedCandidates.length} 条`}
            </strong>
            <ActionButton
              kind="primary"
              disabled={busy || creationBlocked}
              onClick={onCreate}
            >
              {busy ? "正在预检…" : "创建分享"}
            </ActionButton>
          </div>
          <ol
            style={{
              display: "grid",
              gap: 6,
              margin: "10px 0 0",
              padding: 0,
              listStyle: "none",
            }}
          >
            {selectedCandidates.map((candidate, index) => (
              <li
                key={candidate.recordingSubmissionId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                  fontSize: 12,
                  color: "var(--ink-600)",
                }}
              >
                <span style={{ width: 20, textAlign: "right" }}>
                  {index + 1}.
                </span>
                <span
                  style={{
                    minWidth: 0,
                    flex: 1,
                    overflowWrap: "anywhere",
                  }}
                >
                  {candidateLabel(candidate)}
                </span>
                <ActionButton
                  kind="quiet"
                  aria-label={`上移 ${candidateLabel(candidate)}`}
                  disabled={index === 0}
                  onClick={() =>
                    onMoveSelection(candidate.recordingSubmissionId, -1)
                  }
                >
                  上移
                </ActionButton>
                <ActionButton
                  kind="quiet"
                  aria-label={`下移 ${candidateLabel(candidate)}`}
                  disabled={index === selectedCandidates.length - 1}
                  onClick={() =>
                    onMoveSelection(candidate.recordingSubmissionId, 1)
                  }
                >
                  下移
                </ActionButton>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function CandidateRow({
  candidate,
  checked,
  selectionDisabled,
  onToggle,
  onPlayback,
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))",
        gap: 12,
        alignItems: "center",
        padding: "10px 14px",
        borderTop: "1px solid var(--line)",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          minWidth: 0,
          minHeight: 44,
          overflowWrap: "anywhere",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <input
          type="checkbox"
          aria-label={`选择 ${candidateLabel(candidate)}`}
          checked={checked}
          disabled={selectionDisabled}
          onChange={onToggle}
        />
        <span>
          V{candidate.recordingVersion}
          {candidate.isLatestVersion ? (
            <span
              style={{
                marginLeft: 7,
                color: "var(--blue-700)",
                fontSize: 11,
              }}
            >
              当前版本
            </span>
          ) : (
            <span
              style={{
                marginLeft: 7,
                color: "var(--ink-400)",
                fontSize: 11,
              }}
            >
              历史版本
            </span>
          )}
        </span>
      </label>
      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
        <div>{sourceLabels[candidate.sourceHealth] || "来源待确认"}</div>
        <div style={{ marginTop: 3 }}>
          {candidate.isShareable
            ? "可加入本次分享"
            : reasonLabels[candidate.blockReason] || "暂不可分享"}
        </div>
      </div>
      <ActionButton
        aria-label={`播放 ${candidateLabel(candidate)}`}
        onClick={onPlayback}
      >
        播放
      </ActionButton>
    </div>
  );
}

function ShareWizard({
  step,
  draft,
  preflight,
  selected,
  candidateByRecordingId,
  project,
  shareBrand,
  shareBrandLoading,
  shareBrandError,
  contactCards,
  contactCardsLoading,
  contactCardsError,
  busy,
  locked,
  error,
  onDraftChange,
  onRemoveBlocked,
  onContinue,
  onBack,
  onCreate,
  onRetryShareBrand,
  onRetryContactCards,
  onClose,
}) {
  const { dialogRef } = useDialogFocus();
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="创建录屏分享"
      aria-busy={locked ? "true" : undefined}
      style={overlayStyle}
      onKeyDown={(event) => {
        trapDialogKeyDown(
          event,
          dialogRef.current,
          locked ? undefined : onClose,
        );
      }}
      onClick={(event) => {
        if (!locked && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="admission-share-dialog-shell" style={dialogStyle}>
        <header style={dialogHeaderStyle}>
          <div>
            <strong>创建录屏分享</strong>
            <div
              style={{ marginTop: 4, fontSize: 12, color: "var(--ink-500)" }}
            >
              {["1 确认录屏", "2 分享规则", "3 甲方视角预览"].map(
                (label, index) => (
                  <span
                    key={label}
                    style={{
                      marginRight: 14,
                      color:
                        step === index ? "var(--blue-700)" : "var(--ink-400)",
                      fontWeight: step === index ? 700 : 500,
                    }}
                  >
                    {label}
                  </span>
                ),
              )}
            </div>
          </div>
          <ActionButton
            aria-label="关闭创建向导"
            disabled={locked}
            onClick={onClose}
          >
            关闭
          </ActionButton>
        </header>

        <div style={{ padding: 20, overflow: "auto" }}>
          {error ? (
            <div
              role="alert"
              style={{
                marginBottom: 12,
                padding: 12,
                border: "1px solid var(--danger-200, var(--line))",
                borderRadius: 6,
                background: "var(--danger-50, #fff7f7)",
                color: "var(--danger-700, var(--danger-600))",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : null}
          {step === 0 ? (
            <PreflightPanel
              preflight={preflight}
              candidateByRecordingId={candidateByRecordingId}
            />
          ) : null}
          {step === 1 ? (
            <ShareRules
              draft={draft}
              preflight={preflight}
              candidateByRecordingId={candidateByRecordingId}
              contactCards={contactCards}
              contactCardsLoading={contactCardsLoading}
              contactCardsError={contactCardsError}
              onDraftChange={onDraftChange}
              onRetryContactCards={onRetryContactCards}
            />
          ) : null}
          {step === 2 ? (
            <VendorPreview
              draft={draft}
              selected={selected}
              preflight={preflight}
              project={project}
              shareBrand={shareBrand}
              shareBrandLoading={shareBrandLoading}
              shareBrandError={shareBrandError}
              contactCards={contactCards}
              onRetryShareBrand={onRetryShareBrand}
            />
          ) : null}
        </div>

        <footer
          className="admission-share-dialog-footer"
          style={dialogFooterStyle}
        >
          {step > 0 ? (
            <ActionButton disabled={locked} onClick={onBack}>
              上一步
            </ActionButton>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {step === 0 && (preflight?.summary?.blocked || 0) > 0 ? (
              <ActionButton
                kind="primary"
                disabled={locked}
                onClick={onRemoveBlocked}
              >
                移除异常并继续
              </ActionButton>
            ) : null}
            {step === 0 &&
            preflight &&
            (preflight?.summary?.blocked || 0) === 0 ? (
              <ActionButton
                kind="primary"
                disabled={locked}
                onClick={onContinue}
              >
                下一步
              </ActionButton>
            ) : null}
            {step === 1 ? (
              <ActionButton
                kind="primary"
                disabled={locked || !draft.title.trim()}
                onClick={onContinue}
              >
                下一步
              </ActionButton>
            ) : null}
            {step === 2 ? (
              <ActionButton
                kind="primary"
                disabled={busy === "create"}
                onClick={onCreate}
              >
                {busy === "create" ? "正在生成…" : "确认生成"}
              </ActionButton>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

function PreflightPanel({ preflight, candidateByRecordingId }) {
  if (!preflight) return <div style={emptyStyle}>正在逐条检查录屏状态…</div>;
  const blocked = preflight.summary?.blocked || 0;
  return (
    <div>
      <div
        style={{
          padding: 12,
          border: `1px solid ${
            blocked
              ? "var(--danger-200, var(--line))"
              : "var(--ok-200, var(--line))"
          }`,
          background: blocked
            ? "var(--danger-50, #fff7f7)"
            : "var(--ok-50, #f3fbf6)",
          color: blocked ? "var(--danger-600)" : "var(--ok-700, #27794b)",
          fontSize: 13,
        }}
      >
        {blocked
          ? `${blocked} 条录屏无法分享`
          : `预检通过：${preflight.summary?.ready || 0} 条就绪，${
              preflight.summary?.warning || 0
            } 条提醒`}
      </div>
      <PreflightRows
        preflight={preflight}
        candidateByRecordingId={candidateByRecordingId}
      />
    </div>
  );
}

function PreflightRows({ preflight, candidateByRecordingId }) {
  return (
    <div style={{ ...panelStyle, marginTop: 12 }}>
      {(preflight?.items || []).map((item, index) => {
        const candidate = candidateByRecordingId.get(
          item.recordingSubmissionId,
        );
        return (
          <div
            key={item.recordingSubmissionId}
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, 150px), 1fr))",
              gap: 10,
              alignItems: "center",
              minHeight: 52,
              padding: "6px 12px",
              borderTop: index ? "1px solid var(--line)" : 0,
              fontSize: 12,
            }}
          >
            <span style={{ color: "var(--ink-400)" }}>{index + 1}</span>
            <strong>
              {candidate
                ? candidateLabel(candidate)
                : `录屏 V${item.recordingVersion}`}
            </strong>
            <span
              style={{
                color:
                  item.status === "blocked"
                    ? "var(--danger-600)"
                    : item.status === "warning"
                      ? "var(--warn-600)"
                      : "var(--ok-600)",
                fontWeight: 700,
              }}
            >
              {statusLabels[item.status] || item.status}
            </span>
            <span style={{ color: "var(--ink-500)" }}>
              {reasonLabels[item.reasonCode] ||
                sourceLabels[item.sourceHealth] ||
                "状态正常"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ShareRules({
  draft,
  preflight,
  candidateByRecordingId,
  contactCards,
  contactCardsLoading,
  contactCardsError,
  onDraftChange,
  onRetryContactCards,
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <PreflightRows
        preflight={preflight}
        candidateByRecordingId={candidateByRecordingId}
      />
      <fieldset
        style={{
          ...panelStyle,
          display: "flex",
          gap: 18,
          padding: 14,
          margin: 0,
        }}
      >
        <legend style={{ padding: "0 6px", fontSize: 12, fontWeight: 700 }}>
          分享模式
        </legend>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="share-mode"
            aria-label="正式复核"
            checked={draft.mode === "formal_review"}
            onChange={() =>
              onDraftChange({
                mode: "formal_review",
                requireAccessCode: true,
              })
            }
          />
          正式复核
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="share-mode"
            aria-label="仅预览"
            checked={draft.mode === "preview"}
            onChange={() =>
              onDraftChange({ mode: "preview", requireAccessCode: false })
            }
          />
          仅预览
        </label>
      </fieldset>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 12,
        }}
      >
        <label style={fieldLabelStyle}>
          分享名称
          <input
            aria-label="分享名称"
            value={draft.title}
            onChange={(event) => onDraftChange({ title: event.target.value })}
            style={inputStyle}
          />
        </label>
        <label style={fieldLabelStyle}>
          有效期
          <input
            type="datetime-local"
            aria-label="分享有效期"
            value={draft.expiresAt}
            onChange={(event) =>
              onDraftChange({ expiresAt: event.target.value })
            }
            style={inputStyle}
          />
        </label>
      </div>
      <label style={fieldLabelStyle}>
        分享目的
        <textarea
          aria-label="分享目的"
          value={draft.purpose}
          onChange={(event) => onDraftChange({ purpose: event.target.value })}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </label>
      <section style={{ ...panelStyle, padding: 14 }}>
        <label style={fieldLabelStyle}>
          对外联系名片
          <select
            aria-label="对外联系名片"
            value={draft.contactCardId || ""}
            onChange={(event) =>
              onDraftChange({ contactCardId: event.target.value || null })
            }
            style={inputStyle}
          >
            <option value="">不展示联系方式</option>
            {contactCards.map((card) => (
              <option key={card.id} value={card.id}>
                {contactCardOptionLabel(card)}
              </option>
            ))}
          </select>
        </label>
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 8,
            minHeight: 18,
            color: "var(--ink-500)",
            fontSize: 12,
          }}
        >
          {contactCardsLoading
            ? "正在读取当前组织的活动联系名片…"
            : contactCards.length === 0 && !contactCardsError
              ? "当前没有可用于新分享的活动联系名片。"
              : "只会保存所选名片当时的公开字段快照。"}
        </div>
        {contactCardsError ? (
          <div
            role="alert"
            aria-label="联系名片加载失败"
            style={{
              marginTop: 8,
              padding: 10,
              border: "1px solid var(--warn-200, var(--line))",
              background: "var(--warn-50, #fffbeb)",
              color: "var(--warn-700, #8a5b00)",
              fontSize: 12,
            }}
          >
            <div>联系名片加载失败，不影响选择不展示联系方式。</div>
            <ActionButton
              aria-label="重试加载联系名片"
              style={{ marginTop: 8 }}
              onClick={() => void onRetryContactCards()}
            >
              重试
            </ActionButton>
          </div>
        ) : null}
      </section>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <label style={radioLabelStyle}>
          <input
            type="checkbox"
            aria-label="需要访问码"
            checked={draft.requireAccessCode}
            onChange={(event) =>
              onDraftChange({ requireAccessCode: event.target.checked })
            }
          />
          需要访问码
        </label>
        <label style={radioLabelStyle}>
          <input
            type="checkbox"
            aria-label="允许外部链接备用"
            checked={draft.allowExternalFallback}
            onChange={(event) =>
              onDraftChange({ allowExternalFallback: event.target.checked })
            }
          />
          允许外部链接备用
        </label>
      </div>
      {draft.requireAccessCode ? (
        <label style={fieldLabelStyle}>
          自定义访问码（留空则系统生成）
          <input
            aria-label="自定义访问码"
            autoComplete="off"
            value={draft.accessCode}
            onChange={(event) =>
              onDraftChange({ accessCode: event.target.value })
            }
            style={inputStyle}
          />
        </label>
      ) : null}
    </div>
  );
}

function VendorPreview({
  draft,
  selected,
  preflight,
  project,
  shareBrand,
  shareBrandLoading,
  shareBrandError,
  contactCards,
  onRetryShareBrand,
}) {
  const warningCount = preflight?.summary?.warning || 0;
  const presentation = draftPresentation({
    draft,
    project,
    brand: shareBrand,
    contactCards,
    selected,
  });
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {shareBrandLoading ? (
        <div role="status" style={{ fontSize: 12, color: "var(--ink-500)" }}>
          正在读取当前已发布品牌；不影响继续创建。
        </div>
      ) : null}
      {shareBrandError ? (
        <div
          role="alert"
          aria-label="组织品牌预览加载失败"
          style={{
            padding: 10,
            border: "1px solid var(--warn-200, var(--line))",
            background: "var(--warn-50, #fffbeb)",
            color: "var(--warn-700, #8a5b00)",
            fontSize: 12,
          }}
        >
          <span>已使用安全字标降级，创建成功后将以服务端快照为准。</span>
          <ActionButton
            aria-label="重试加载组织品牌预览"
            style={{ marginLeft: 8 }}
            onClick={() => void onRetryShareBrand()}
          >
            重试
          </ActionButton>
        </div>
      ) : null}
      <SharePresentationPreview
        presentation={presentation}
        ariaLabel="将要创建的外部分享预览"
        stateLabel="将要创建"
        notice="这不是已保存分享；创建成功后以服务端快照为准。"
      />
      <div style={{ color: "var(--ink-500)", fontSize: 12 }}>
        甲方将看到 {selected.length} 条录屏
      </div>
      {warningCount ? (
        <div
          style={{
            padding: 12,
            background: "var(--warn-50, #fffbeb)",
            color: "var(--warn-700, #8a5b00)",
            fontSize: 12,
          }}
        >
          有 {warningCount}{" "}
          条录屏仅使用外部链接；已保留提醒，不会被“移除异常”删除。
        </div>
      ) : null}
    </div>
  );
}

function SharePresentationPreview({
  presentation,
  ariaLabel,
  stateLabel = "已保存",
  notice,
}) {
  if (!presentation) return null;
  const brand = presentation.brand || fallbackShareBrand;
  const project = presentation.project || {};
  const progress = presentation.progress || {};
  const items = (
    Array.isArray(presentation.items) ? presentation.items : []
  ).filter((item) => item && typeof item === "object" && !Array.isArray(item));
  const contactCard = presentation.contactCard || null;
  const logoText =
    brand.logoText ||
    Array.from(brand.brandName || "组织")
      .slice(0, 4)
      .join("");
  return (
    <section
      role="region"
      aria-label={ariaLabel}
      style={{
        ...panelStyle,
        overflow: "hidden",
        borderTop: `3px solid ${brand.primaryColor || fallbackShareBrand.primaryColor}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: 14,
          borderBottom: "1px solid var(--line)",
          background: "var(--bg-soft, #f7f8fa)",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              flex: "0 0 40px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              background: brand.primaryColor || fallbackShareBrand.primaryColor,
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {logoText}
          </span>
          <span style={{ minWidth: 0 }}>
            <strong style={{ display: "block", overflowWrap: "anywhere" }}>
              {brand.brandName || "组织"}
            </strong>
            {brand.brandTagline ? (
              <span
                style={{
                  display: "block",
                  marginTop: 2,
                  color: "var(--ink-500)",
                  fontSize: 12,
                  overflowWrap: "anywhere",
                }}
              >
                {brand.brandTagline}
              </span>
            ) : null}
          </span>
        </div>
        <span
          style={{ fontSize: 12, color: "var(--ink-500)", fontWeight: 600 }}
        >
          {stateLabel} · 组织官方分享
        </span>
      </div>

      <div style={{ display: "grid", gap: 12, padding: 14 }}>
        {notice ? (
          <div
            style={{
              padding: "8px 10px",
              background: "var(--blue-50, #f2f7ff)",
              color: "var(--blue-700)",
              fontSize: 12,
            }}
          >
            {notice}
          </div>
        ) : null}
        <div>
          <strong
            style={{ display: "block", fontSize: 15, overflowWrap: "anywhere" }}
          >
            {presentation.title || "未命名分享"}
          </strong>
          <span
            style={{
              display: "block",
              marginTop: 4,
              color: "var(--ink-500)",
              fontSize: 12,
              overflowWrap: "anywhere",
            }}
          >
            项目 {project.name || "项目名称待确认"} ·{" "}
            {project.code || "项目代码待确认"}
          </span>
          <span
            style={{
              display: "block",
              marginTop: 4,
              color: "var(--ink-700)",
              fontSize: 13,
              overflowWrap: "anywhere",
            }}
          >
            用途：{presentation.purpose || "未填写"}
          </span>
        </div>

        <dl
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 130px), 1fr))",
            gap: 8,
            margin: 0,
          }}
        >
          <PreviewFact
            label="模式"
            value={
              presentation.mode === "formal_review" ? "正式复核" : "仅预览"
            }
          />
          <PreviewFact
            label="轮次"
            value={
              presentation.roundNumber
                ? `第 ${presentation.roundNumber} 轮`
                : "创建后由服务端确认"
            }
          />
          <PreviewFact
            label="截止"
            value={formatDate(presentation.expiresAt)}
          />
          <PreviewFact
            label="进度"
            value={`${progress.completed || 0}/${progress.total ?? items.length}`}
          />
          <PreviewFact
            label="状态"
            value={`${taskStatusLabels[presentation.status] || (presentation.status === "draft" ? "待创建" : "状态待确认")} · ${reviewStateLabels[presentation.reviewState] || "复核待确认"}`}
          />
        </dl>

        {presentation.latestSubmission ? (
          <div
            aria-label="最新提交回执"
            style={{
              padding: "9px 10px",
              borderLeft: "3px solid var(--ok-600, #27794b)",
              background: "var(--ok-50, #f3fbf6)",
              color: "var(--ink-700)",
              fontSize: 12,
            }}
          >
            最新回执：第 {presentation.latestSubmission.revision || 1} 次提交 ·{" "}
            {formatDate(presentation.latestSubmission.submittedAt)} · 通过{" "}
            {presentation.latestSubmission.summary?.selected || 0} / 备选{" "}
            {presentation.latestSubmission.summary?.backup || 0} / 拒绝{" "}
            {presentation.latestSubmission.summary?.rejected || 0} / 需修改{" "}
            {presentation.latestSubmission.summary?.needsChanges || 0}
          </div>
        ) : null}

        <div>
          <div
            style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-700)" }}
          >
            录屏清单（{items.length}）
          </div>
          <ol
            style={{
              margin: "6px 0 0",
              padding: "0 0 0 28px",
              border: "1px solid var(--line)",
              borderRadius: 6,
            }}
          >
            {items.map((item, index) => (
              <li
                key={`${item.recordingSubmissionId || "recording"}-${index}`}
                style={{
                  minHeight: 44,
                  padding: "9px 10px 9px 2px",
                  borderTop: index ? "1px solid var(--line)" : 0,
                  fontSize: 12,
                  overflowWrap: "anywhere",
                }}
              >
                <strong>
                  {item.streamer?.displayName || "主播名称未提供"}
                </strong>{" "}
                · V{item.recordingVersion || "?"} ·{" "}
                {sourceLabels[item.sourceHealth] || "来源待确认"}
              </li>
            ))}
          </ol>
        </div>

        {contactCard ? (
          <div
            aria-label="组织联系名片"
            style={{
              padding: 12,
              border: "1px solid var(--line)",
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            <strong>{contactCard.displayName}</strong>
            {contactCard.title ? <span> · {contactCard.title}</span> : null}
            <div
              style={{
                marginTop: 5,
                color: "var(--ink-500)",
                overflowWrap: "anywhere",
              }}
            >
              {[contactCard.phone, contactCard.email, contactCard.wechat]
                .filter(Boolean)
                .join(" · ") || "未提供公开联系方式"}
            </div>
          </div>
        ) : (
          <div style={{ color: "var(--ink-500)", fontSize: 12 }}>
            联系方式：不展示
          </div>
        )}
      </div>
    </section>
  );
}

function PreviewFact({ label, value }) {
  return (
    <div style={{ padding: 8, background: "var(--bg-soft, #f7f8fa)" }}>
      <dt style={{ color: "var(--ink-500)", fontSize: 11 }}>{label}</dt>
      <dd
        style={{
          margin: "3px 0 0",
          color: "var(--ink-800)",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {value}
      </dd>
    </div>
  );
}

function ShareTasks({
  tasks,
  loading,
  loadingMore,
  hasMore,
  error,
  onRetry,
  onLoadMore,
  onRetryMore,
  pendingTasks,
  taskExpiresAt,
  reopenReasons,
  submissions,
  taskPreview,
  onTaskExpiresAtChange,
  onReopenReasonChange,
  onRotate,
  onExtend,
  onReopen,
  onRevoke,
  onViewSubmissions,
  onViewPreview,
}) {
  const [confirmingRevoke, setConfirmingRevoke] = React.useState("");
  if (loading && tasks.length === 0) {
    return <div style={emptyStyle}>分享任务加载中…</div>;
  }
  if (error && tasks.length === 0) {
    return (
      <div role="alert" style={emptyStyle}>
        <div>分享任务加载失败：{error}</div>
        <ActionButton
          style={{ marginTop: 12 }}
          aria-label="重试加载分享任务"
          onClick={() => void onRetry().catch(() => {})}
        >
          重试
        </ActionButton>
      </div>
    );
  }
  if (tasks.length === 0) return <div style={emptyStyle}>暂无分享任务</div>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error ? (
        <div role="alert" style={{ ...emptyStyle, padding: 14 }}>
          <div>分享任务加载更多失败：{error}</div>
          <ActionButton
            style={{ marginTop: 12 }}
            aria-label="重试加载更多分享任务"
            onClick={() => void onRetryMore().catch(() => {})}
          >
            重试
          </ActionButton>
        </div>
      ) : null}
      {tasks.map((task) => {
        const capabilities = taskCapabilities(task);
        const taskPending = pendingTasks.has(task.id);
        return (
          <article key={task.id} style={{ ...panelStyle, padding: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {task.title}
                </div>
                <div
                  style={{
                    marginTop: 5,
                    fontSize: 12,
                    color: "var(--ink-500)",
                  }}
                >
                  {task.mode === "formal_review" ? "正式复核" : "仅预览"} · 第{" "}
                  {task.roundNumber || 1} 轮 ·{" "}
                  {taskStatusLabels[task.status] || task.status}
                </div>
              </div>
              <div
                style={{
                  textAlign: "right",
                  fontSize: 12,
                  color: "var(--ink-500)",
                }}
              >
                <div>
                  进度 {task.draftCompletedCount || 0}/{task.itemCount || 0}
                </div>
                <div style={{ marginTop: 4 }}>
                  到期 {formatDate(task.expiresAt)}
                </div>
              </div>
            </div>

            {capabilities.explanation ? (
              <p
                style={{
                  margin: "12px 0 0",
                  color: "var(--ink-500)",
                  fontSize: 12,
                }}
              >
                {capabilities.explanation}
              </p>
            ) : null}
            {capabilities.extend || capabilities.reopen ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                  marginTop: 14,
                }}
              >
                {capabilities.extend ? (
                  <label style={fieldLabelStyle}>
                    延期至
                    <input
                      type="date"
                      aria-label={`${task.title} 延期至`}
                      value={taskExpiresAt[task.id] || ""}
                      onChange={(event) =>
                        onTaskExpiresAtChange(task.id, event.target.value)
                      }
                      disabled={taskPending}
                      style={inputStyle}
                    />
                  </label>
                ) : null}
                {capabilities.reopen ? (
                  <label style={fieldLabelStyle}>
                    重开原因
                    <input
                      aria-label={`${task.title} 重开原因`}
                      value={reopenReasons[task.id] || ""}
                      onChange={(event) =>
                        onReopenReasonChange(task.id, event.target.value)
                      }
                      disabled={taskPending}
                      placeholder="仅在确需重新提交时填写"
                      style={inputStyle}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 12,
              }}
            >
              {capabilities.rotate ? (
                <ActionButton
                  onClick={() => onRotate(task)}
                  disabled={taskPending}
                >
                  重置分享链接
                </ActionButton>
              ) : null}
              {capabilities.extend ? (
                <ActionButton
                  aria-label={`延期 ${task.title}`}
                  onClick={() => onExtend(task)}
                  disabled={taskPending}
                >
                  延期
                </ActionButton>
              ) : null}
              {capabilities.reopen ? (
                <ActionButton
                  aria-label={`重开 ${task.title}`}
                  onClick={() => onReopen(task)}
                  disabled={taskPending}
                >
                  重开
                </ActionButton>
              ) : null}
              {capabilities.submissions ? (
                <ActionButton
                  aria-label={`查看 ${task.title} 提交历史`}
                  onClick={() => onViewSubmissions(task)}
                  disabled={taskPending}
                >
                  查看提交历史
                </ActionButton>
              ) : null}
              <ActionButton
                aria-label={
                  (taskPreview?.taskId === task.id &&
                  taskPreview.status === "ready"
                    ? "收起"
                    : "查看") +
                  " " +
                  task.title +
                  " 分享预览"
                }
                onClick={() => onViewPreview(task)}
                disabled={
                  taskPreview?.taskId === task.id &&
                  taskPreview.status === "loading"
                }
              >
                {taskPreview?.taskId === task.id &&
                taskPreview.status === "loading"
                  ? "正在加载分享预览…"
                  : taskPreview?.taskId === task.id &&
                      taskPreview.status === "ready"
                    ? "收起分享预览"
                    : "查看分享预览"}
              </ActionButton>
              {capabilities.revoke ? (
                <ActionButton
                  kind="danger"
                  aria-label={`撤销 ${task.title}`}
                  onClick={() => setConfirmingRevoke(task.id)}
                  disabled={taskPending}
                >
                  撤销
                </ActionButton>
              ) : null}
            </div>
            {confirmingRevoke === task.id ? (
              <div
                role="alert"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  marginTop: 12,
                  padding: 12,
                  border: "1px solid var(--danger-200, var(--line))",
                  background: "var(--danger-50, #fff7f7)",
                  color: "var(--danger-700, var(--danger-600))",
                  fontSize: 12,
                }}
              >
                <span>撤销后当前分享链接立即失效，确认继续？</span>
                <span style={{ display: "flex", gap: 8 }}>
                  <ActionButton onClick={() => setConfirmingRevoke("")}>
                    取消
                  </ActionButton>
                  <ActionButton
                    kind="danger"
                    aria-label={`确认撤销 ${task.title}`}
                    disabled={taskPending}
                    onClick={() => {
                      setConfirmingRevoke("");
                      onRevoke(task);
                    }}
                  >
                    确认撤销
                  </ActionButton>
                </span>
              </div>
            ) : null}
            {taskPreview?.taskId === task.id &&
            taskPreview.status === "loading" ? (
              <div
                role="status"
                style={{
                  marginTop: 12,
                  color: "var(--ink-500)",
                  fontSize: 12,
                }}
              >
                正在读取已保存分享预览…
              </div>
            ) : null}
            {taskPreview?.taskId === task.id &&
            taskPreview.status === "error" ? (
              <div
                role="alert"
                aria-label={task.title + " 分享预览加载失败"}
                style={{
                  marginTop: 12,
                  padding: 12,
                  border: "1px solid var(--danger-200, var(--line))",
                  background: "var(--danger-50, #fff7f7)",
                  color: "var(--danger-700, var(--danger-600))",
                  fontSize: 12,
                }}
              >
                <div>分享预览加载失败：{taskPreview.error}</div>
                <ActionButton
                  aria-label={"重试 " + task.title + " 分享预览"}
                  style={{ marginTop: 8 }}
                  onClick={() => onViewPreview(task)}
                >
                  重试
                </ActionButton>
              </div>
            ) : null}
            {taskPreview?.taskId === task.id &&
            taskPreview.status === "ready" ? (
              <div style={{ marginTop: 12 }}>
                <SharePresentationPreview
                  presentation={taskPreview.presentation}
                  ariaLabel={task.title + " 已保存分享预览"}
                />
              </div>
            ) : null}
            {Object.hasOwn(submissions, task.id) ? (
              <div
                aria-label={`${task.title} 提交历史`}
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderTop: "1px solid var(--line)",
                }}
              >
                {submissions[task.id].length === 0 ? (
                  <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
                    暂无提交记录
                  </span>
                ) : (
                  submissions[task.id].map((submission, index) => (
                    <div
                      key={submission.id || index}
                      style={{ fontSize: 12, color: "var(--ink-600)" }}
                    >
                      {`第 ${submission.revision || index + 1} 次提交 · ${formatDate(
                        submission.submittedAt,
                      )}`}
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </article>
        );
      })}
      {hasMore && !error ? (
        <ActionButton
          aria-label="加载更多分享任务"
          disabled={loadingMore}
          onClick={() => void onLoadMore().catch(() => {})}
          style={{ justifySelf: "center" }}
        >
          {loadingMore ? "加载中…" : "加载更多"}
        </ActionButton>
      ) : null}
    </div>
  );
}

function ResultPendingTasks({
  tasks,
  loading,
  loadingMore,
  hasMore,
  error,
  submissions,
  pendingTasks,
  onRetry,
  onLoadMore,
  onRetryMore,
  onViewSubmissions,
}) {
  const pendingResults = tasks.filter(
    (task) => task.reviewState === "submitted_locked",
  );

  return (
    <section aria-label="复核结果待办">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>复核结果待办</h3>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: "var(--ink-500)",
            }}
          >
            先处理甲方已提交结果；播放问题作为独立技术待办跟进
          </p>
        </div>
        <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
          {pendingResults.length} 个结果
        </span>
      </div>
      {loading && tasks.length === 0 ? (
        <div role="status" aria-label="复核结果待办加载中" style={emptyStyle}>
          复核结果待办加载中…
        </div>
      ) : error && tasks.length === 0 ? (
        <div role="alert" aria-label="复核结果待办加载失败" style={emptyStyle}>
          <div>复核结果待办加载失败：{error}</div>
          <ActionButton
            style={{ marginTop: 12 }}
            onClick={() => void onRetry().catch(() => {})}
          >
            重试加载复核结果待办
          </ActionButton>
        </div>
      ) : pendingResults.length === 0 ? (
        <div style={emptyStyle}>
          {hasMore
            ? "当前已加载内容中暂无待处理复核结果，可继续加载更多。"
            : "暂无待处理复核结果"}
        </div>
      ) : (
        <div style={panelStyle}>
          {pendingResults.map((task, index) => (
            <article
              key={task.id}
              style={{
                padding: "12px 14px",
                borderTop: index ? "1px solid var(--line)" : 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      overflowWrap: "anywhere",
                      fontSize: 13,
                      fontWeight: 650,
                    }}
                  >
                    {task.title || "未命名复核任务"}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: "var(--ink-500)",
                    }}
                  >
                    第 {task.roundNumber || 1} 轮 · {task.itemCount || 0} 条录屏
                    {task.lastSubmittedAt
                      ? ` · ${formatDate(task.lastSubmittedAt)} 提交`
                      : ""}
                  </div>
                </div>
                <ActionButton
                  disabled={pendingTasks.has(task.id)}
                  onClick={() => onViewSubmissions(task)}
                >
                  {pendingTasks.has(task.id)
                    ? "加载中…"
                    : Object.hasOwn(submissions, task.id)
                      ? "刷新复核结果"
                      : "查看复核结果"}
                </ActionButton>
              </div>
              {Object.hasOwn(submissions, task.id) ? (
                <ResultSubmissionDetails
                  task={task}
                  submissions={submissions[task.id]}
                />
              ) : null}
            </article>
          ))}
        </div>
      )}
      {error && tasks.length > 0 ? (
        <div
          role="alert"
          aria-label="复核结果待办加载更多失败"
          style={{ ...emptyStyle, marginTop: 12, padding: 14 }}
        >
          <div>复核结果待办加载更多失败：{error}</div>
          <ActionButton
            style={{ marginTop: 12 }}
            onClick={() => void onRetryMore().catch(() => {})}
          >
            重试加载更多复核结果待办
          </ActionButton>
        </div>
      ) : null}
      {hasMore && !error ? (
        <ActionButton
          aria-label="加载更多复核结果待办"
          disabled={loadingMore}
          onClick={() => void onLoadMore().catch(() => {})}
          style={{ display: "block", margin: "12px auto 0" }}
        >
          {loadingMore ? "加载中…" : "加载更多"}
        </ActionButton>
      ) : null}
    </section>
  );
}

function ResultSubmissionDetails({ task, submissions }) {
  return (
    <div
      aria-label={`${task.title || "未命名复核任务"} 复核提交详情`}
      style={{
        display: "grid",
        gap: 10,
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid var(--line)",
      }}
    >
      {submissions.length === 0 ? (
        <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
          暂无提交记录
        </span>
      ) : (
        submissions.map((submission, index) => (
          <article
            key={submission.id || index}
            style={{
              display: "grid",
              gap: 8,
              padding: 12,
              border: "1px solid var(--line)",
              borderRadius: 6,
              background: "var(--bg-soft, #f8fafc)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 12,
              }}
            >
              <strong>第 {submission.revision || index + 1} 次提交</strong>
              <span style={{ color: "var(--ink-500)" }}>
                {formatDate(submission.submittedAt)}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-600)" }}>
              {`通过 ${submission.summary?.selected ?? 0} · 备选 ${
                submission.summary?.backup ?? 0
              } · 拒绝 ${submission.summary?.rejected ?? 0} · 需修改 ${
                submission.summary?.needsChanges ?? 0
              }`}
            </div>
            {submission.projectRemark ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  fontSize: 12,
                }}
              >
                <strong>总体说明</strong>
                <span>{submission.projectRemark}</span>
              </div>
            ) : null}
            <div style={{ display: "grid", gap: 6 }}>
              {(submission.items || []).map((item, itemIndex) => (
                <div
                  key={`${item.recordingSubmissionId || "recording"}:${itemIndex}`}
                  style={{
                    display: "grid",
                    gap: 3,
                    padding: "8px 10px",
                    borderLeft: "3px solid var(--line-strong, var(--line))",
                    fontSize: 12,
                  }}
                >
                  <strong>
                    录屏 V{item.recordingVersion || "-"} ·{" "}
                    {vendorDecisionLabels[item.decision] || "未知决定"}
                  </strong>
                  {item.remark ? <span>{item.remark}</span> : null}
                </div>
              ))}
            </div>
          </article>
        ))
      )}
    </div>
  );
}

function PlaybackIssues({
  issues,
  loading,
  error,
  resolveErrors,
  resolvingIssueIds,
  onRetry,
  onResolve,
}) {
  return (
    <section aria-label="播放问题待办">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>播放问题</h3>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: "var(--ink-500)",
            }}
          >
            仅展示尚未解决的甲方播放反馈
          </p>
        </div>
        <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
          {issues.length} 条待办
        </span>
      </div>
      {loading ? (
        <div style={emptyStyle}>结果待办加载中…</div>
      ) : error ? (
        <div
          role="alert"
          aria-label="播放问题加载失败"
          style={{
            ...emptyStyle,
            color: "var(--danger-700, #b42318)",
          }}
        >
          <div>{error}</div>
          <ActionButton onClick={onRetry}>重试加载播放问题</ActionButton>
        </div>
      ) : issues.length === 0 ? (
        <div style={emptyStyle}>暂无播放问题</div>
      ) : (
        <div style={{ ...panelStyle, overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              minWidth: 720,
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr style={{ background: "var(--ink-50)" }}>
                {["主播 / 版本", "来源", "错误码", "上报时间", "操作"].map(
                  (label) => (
                    <th
                      key={label}
                      scope="col"
                      style={{
                        padding: "10px 12px",
                        textAlign: "left",
                        color: "var(--ink-500)",
                        fontWeight: 600,
                      }}
                    >
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr
                  key={issue.id}
                  style={{ borderTop: "1px solid var(--line)" }}
                >
                  <td style={tableCellStyle}>
                    {issue.streamerDisplayName || "主播名称未提供"} · V
                    {issue.recordingVersion}
                  </td>
                  <td style={tableCellStyle}>
                    {sourceLabels[issue.sourceType] || issue.sourceType}
                  </td>
                  <td style={tableCellStyle}>{issue.errorCode}</td>
                  <td style={tableCellStyle}>{formatDate(issue.reportedAt)}</td>
                  <td style={tableCellStyle}>
                    {resolveErrors[issue.id] ? (
                      <div
                        role="alert"
                        aria-label="播放问题处理失败"
                        style={{
                          marginBottom: 6,
                          color: "var(--danger-700, #b42318)",
                          lineHeight: 1.5,
                        }}
                      >
                        {resolveErrors[issue.id]}
                      </div>
                    ) : null}
                    <ActionButton
                      onClick={() => onResolve(issue)}
                      disabled={resolvingIssueIds.has(issue.id)}
                    >
                      {resolvingIssueIds.has(issue.id)
                        ? "处理中…"
                        : resolveErrors[issue.id]
                          ? "重试标记已解决"
                          : "标记已解决"}
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DeliveryDialog({ delivery, restoreFocusRef, onClose }) {
  const { dialogRef } = useDialogFocus(undefined, restoreFocusRef);
  const [copying, setCopying] = React.useState(false);
  const [copyStatus, setCopyStatus] = React.useState("");
  const deliveryText = [
    delivery.projectName ? `来源项目：${delivery.projectName}` : "",
    delivery.title ? `任务：${delivery.title}` : "",
    `分享链接：${delivery.shareUrl}`,
    delivery.accessCode ? `访问码：${delivery.accessCode}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="一次性交付信息"
      style={{ ...overlayStyle, zIndex: 120 }}
      onKeyDown={(event) => {
        trapDialogKeyDown(event, dialogRef.current, onClose);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="admission-share-dialog-shell"
        style={{ ...dialogStyle, width: "min(560px, 100%)" }}
      >
        <header style={dialogHeaderStyle}>
          <div>
            <strong>一次性交付信息</strong>
            <div
              style={{ marginTop: 4, fontSize: 12, color: "var(--danger-600)" }}
            >
              关闭后不再展示明文，请现在完成交付。
            </div>
          </div>
        </header>
        <div style={{ padding: 20, display: "grid", gap: 12 }}>
          {delivery.projectName ? (
            <div style={{ color: "var(--ink-500)", fontSize: 12 }}>
              来源项目：{delivery.projectName}
            </div>
          ) : null}
          <label style={fieldLabelStyle}>
            分享链接
            <div
              style={{
                ...inputStyle,
                minHeight: 0,
                overflowWrap: "anywhere",
                userSelect: "all",
              }}
            >
              {delivery.shareUrl || "未返回分享链接"}
            </div>
          </label>
          {delivery.accessCode ? (
            <label style={fieldLabelStyle}>
              访问码
              <strong
                style={{
                  ...inputStyle,
                  display: "block",
                  minHeight: 0,
                  letterSpacing: "0.12em",
                }}
              >
                {delivery.accessCode}
              </strong>
            </label>
          ) : null}
          {delivery.presentation ? (
            <SharePresentationPreview
              presentation={delivery.presentation}
              ariaLabel="已保存的外部分享预览"
              notice="以下字段来自创建接口返回的已保存快照，可与外部页面逐项核对。"
            />
          ) : delivery.kind === "reset" ? null : (
            <div
              role="alert"
              style={{ color: "var(--warn-700, #8a5b00)", fontSize: 12 }}
            >
              创建接口未返回已保存预览，请到分享任务中重新读取详情。
            </div>
          )}
          <div role="status" aria-live="polite" style={{ minHeight: 20 }}>
            {copyStatus}
          </div>
        </div>
        <footer
          className="admission-share-dialog-footer"
          style={dialogFooterStyle}
        >
          <ActionButton
            disabled={copying}
            onClick={async () => {
              setCopying(true);
              setCopyStatus("");
              try {
                await copyText(deliveryText);
                setCopyStatus("完整交付信息已复制");
              } catch {
                setCopyStatus("复制失败，请手动复制");
              } finally {
                setCopying(false);
              }
            }}
          >
            {copying ? "正在复制…" : "复制完整交付信息"}
          </ActionButton>
          <ActionButton
            kind="primary"
            aria-label="关闭交付信息"
            onClick={onClose}
          >
            我已完成交付并关闭
          </ActionButton>
        </footer>
      </div>
    </div>
  );
}

const fieldLabelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  color: "var(--ink-600)",
  fontSize: 12,
  fontWeight: 600,
};

const radioLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 44,
  fontSize: 13,
  color: "var(--ink-700)",
};

const emptyStyle = {
  ...panelStyle,
  padding: 32,
  textAlign: "center",
  color: "var(--ink-400)",
  fontSize: 13,
};

const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 110,
  display: "grid",
  placeItems: "center",
  padding: 16,
  background: "rgba(15, 23, 42, 0.38)",
};

const dialogStyle = {
  width: "min(760px, 100%)",
  maxHeight: "calc(100vh - 32px)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  borderRadius: 10,
  background: "#fff",
  boxShadow: "0 24px 70px rgba(15, 23, 42, 0.22)",
};

const dialogHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "16px 20px",
  borderBottom: "1px solid var(--line)",
};

const dialogFooterStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "12px 20px",
  borderTop: "1px solid var(--line)",
  background: "var(--ink-50)",
};

const tableCellStyle = {
  padding: "10px 12px",
  color: "var(--ink-700)",
};
