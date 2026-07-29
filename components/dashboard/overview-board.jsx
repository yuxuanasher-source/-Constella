"use client";

/* eslint-disable */
// 经营总览看板 —— 主看板优先的三栏工作台（主看板 / 个人面板 / AI 助手）。
// 数据全部为真实业务数据：服务端 dashboard（kpis/panels/queue/risks，按角色计算）
// + 实时 projects/tasks/reports/batches + /api/marketplace/intel + /api/ai/*。
// 「不做假」原则：算不出的真实时序就不画走势线、不编造环比；缺数据的区块自动隐藏；
// AI 面板调用真实接口，返回真实诊断或真实错误，绝不伪造成功内容。

import * as React from "react";
import {
  AlertTriangle,
  Ban,
  Bot,
  CheckCircle2,
  CircleHelp,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Square,
  Wrench,
} from "lucide-react";
import { isConversationStreamEvent } from "@/features/ai/conversation-contracts";
import { HermesSkillDraftReview } from "./hermes-skill-draft-review";

// ——— 设计稿调色板（取自设计文件内联样式） ———
const C = {
  page: "#f4f6fb",
  card: "#ffffff",
  border: "#dfe6f2",
  divider: "#e7edf6",
  divider2: "#edf2f8",
  track: "#e8eef7",
  soft: "#f7f9fd",
  ink: "#0b1733",
  ink2: "#1b2744",
  ink3: "#2d3a58",
  ink4: "#5e6a82",
  muted: "#7b879c",
  faint: "#a8b1c2",
  primary: "#3b6be6",
  primaryDeep: "#1e50c8",
  primarySoft: "#eef3ff",
  ok: "#0e8a4d",
  okBg: "#e6f6ee",
  warn: "#a86a00",
  warnText: "#a86a00",
  danger: "#d43d45",
  dangerDeep: "#b9323b",
  dangerBg: "#fdecec",
};

const TONE = {
  ok: { color: C.ok, bg: C.okBg, solid: "#34b86a" },
  good: { color: C.ok, bg: C.okBg, solid: "#34b86a" },
  green: { color: C.ok, bg: C.okBg, solid: "#34b86a" },
  info: { color: C.primaryDeep, bg: C.primarySoft, solid: C.primary },
  blue: { color: C.primaryDeep, bg: C.primarySoft, solid: C.primary },
  primary: { color: C.primaryDeep, bg: C.primarySoft, solid: C.primary },
  violet: { color: "#7b54ec", bg: "#efeafe", solid: "#7b54ec" },
  neutral: { color: C.ink4, bg: "#eef0f5", solid: "#c9cdd6" },
  warn: { color: C.warn, bg: "#fef5e3", solid: "#e0a82e" },
  warning: { color: C.warn, bg: "#fef5e3", solid: "#e0a82e" },
  amber: { color: C.warn, bg: "#fef5e3", solid: "#e0a82e" },
  danger: { color: C.dangerDeep, bg: C.dangerBg, solid: C.danger },
  bad: { color: C.dangerDeep, bg: C.dangerBg, solid: C.danger },
  red: { color: C.dangerDeep, bg: C.dangerBg, solid: C.danger },
};
const tone = (t) => TONE[t] || TONE.neutral;
const solid = (t) => tone(t).solid;
// 待办点颜色（设计稿 KPI 点位用具体色值）
const dotColor = (t) =>
  t === "primary" || t === "info" || t === "blue"
    ? C.primary
    : t === "warn" || t === "amber"
      ? "#e0a82e"
      : t === "bad" || t === "danger" || t === "red"
        ? "#d7a02a"
        : t === "ok" || t === "green"
          ? C.ok
          : "#c9cdd6";

const ROUTE_LABELS = {
  project: "项目",
  projects: "项目",
  streamers: "主播",
  tasks: "任务",
  reports: "报数",
  settle: "结算",
  audit: "审计",
  notifications: "通知",
  marketplace: "撮合",
};
const routeLabel = (r) => ROUTE_LABELS[r] || "查看";

const DASHBOARD_TIME_ZONE = "Asia/Shanghai";
const PERIOD_TABS = ["实时", "今日", "本周", "本月"];

const num = (n) => (Number(n) || 0).toLocaleString("en-US");
const money = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 10000) return `¥${(v / 10000).toFixed(1)}万`;
  return `¥${v.toLocaleString("en-US")}`;
};
const moneyK = (n) => {
  const v = Number(n) || 0;
  return Math.abs(v) >= 1000
    ? `¥${(v / 1000).toFixed(1)}K`
    : `¥${v.toLocaleString("en-US")}`;
};

function normalizeVisualSeries(value) {
  if (!Array.isArray(value)) return null;
  const series = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  return series.length >= 2 ? series : null;
}

const AI_CONVERSATION_STORAGE_PREFIX =
  "jingying-cabin.dashboard.ai.conversation.v1";
const AI_CHAT_ATTACHMENT_LIMIT = 5;
const AI_CHAT_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const AI_CHAT_ATTACHMENT_ACCEPT = [
  ".csv",
  ".txt",
  ".md",
  ".json",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/*",
  "application/pdf",
].join(",");

const AI_UI_SAFE_FAILURE_TEXT = "AI response unavailable";
const AI_UI_STOP_UNCONFIRMED_TEXT = "停止请求未确认";
const AI_UI_CLARIFY_FAILED_TEXT = "澄清提交失败";
const AI_UI_INTERNAL_TEXT =
  /(Hermes(?:\s+Gateway)?|DeepSeek|OpenAI|provider|model|\/api\/|stack\s*trace|stack|rawArguments|arguments|args|reasoning|chain-of-thought|toolName|gateway|sessionId|prompt|event:\s|data:\s|{\s*["'])/i;

function aiPublicText(value, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  if (AI_UI_INTERNAL_TEXT.test(text)) return fallback;
  return text.replace(/\s+/g, " ").slice(0, 240);
}

function aiPublicContent(value, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  if (AI_UI_INTERNAL_TEXT.test(text)) return fallback;
  return text.slice(0, 12000);
}

function aiPublicList(value, fallback = "") {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((item) => aiPublicText(item, ""))
    .filter(Boolean)
    .slice(0, 6)
    .concat(fallback ? [fallback] : [])
    .slice(0, 6);
}

function aiPublicStatus(status, fallback = "running") {
  return [
    "running",
    "completed",
    "succeeded",
    "success",
    "limited",
    "denied",
    "failed",
    "failure",
  ].includes(status)
    ? status
    : fallback;
}

function aiConversationStorageKey(user) {
  const identity = user?.id || user?.name || user?.role || "anonymous";
  return `${AI_CONVERSATION_STORAGE_PREFIX}.${identity}`;
}

function loadStoredConversationId(storageKey) {
  if (typeof window === "undefined" || !window.localStorage) return "";
  try {
    const value = window.localStorage.getItem(storageKey) || "";
    return value.length <= 120 ? value : "";
  } catch {
    return "";
  }
}

function saveStoredConversationId(storageKey, conversationId) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (conversationId) {
      window.localStorage.setItem(storageKey, conversationId);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Conversation still works for the current page when storage is unavailable.
  }
}

function createAiClientRequestId(prefix = "turn") {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `${prefix}:${randomId}`
    : `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeAiMessageMeta(value) {
  const projectHealth = normalizeProjectHealth(
    value?.projectHealth || value?.grounding?.projectHealth,
  );
  const suggestedActions = normalizeSuggestedActions(
    value?.suggestedActions || value?.grounding?.suggestedActions,
  );
  const webSearch = normalizeWebSearchMeta(
    value?.webSearch || value?.knowledge?.webSearch,
  );
  const outcome = normalizeAiOutcome(value);
  const skillDrafts = normalizeHermesSkillDrafts(
    value?.skillDrafts || value?.hermes?.skillDrafts || value?.metadata?.skillDrafts,
  );
  const meta = {
    ...(projectHealth ? { projectHealth } : {}),
    ...(suggestedActions ? { suggestedActions } : {}),
    ...(webSearch ? { webSearch } : {}),
    ...(outcome ? { outcome } : {}),
    ...(skillDrafts?.length ? { skillDrafts } : {}),
  };
  return Object.keys(meta).length ? meta : undefined;
}

function normalizeAiOutcome(value) {
  const outcome =
    value?.outcome === "complete" ||
    value?.outcome === "partial" ||
    value?.outcome === "blocked"
      ? value.outcome
      : value?.metadata?.outcome === "partial" ||
          value?.metadata?.outcome === "blocked" ||
          value?.metadata?.outcome === "complete"
        ? value.metadata.outcome
        : null;
  if (!outcome || outcome === "complete") return null;
  const missing = Array.isArray(value?.missing)
    ? value.missing
    : Array.isArray(value?.metadata?.missing)
      ? value.metadata.missing
      : [];
  return {
    outcome,
    missing: aiPublicList(missing).slice(0, 5),
  };
}

function normalizeHermesSkillDrafts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((draft) => {
      const id = aiPublicText(draft?.id, "");
      const skillId = aiPublicText(draft?.skillId || draft?.skill_id, "");
      const bundleSha256 = aiPublicText(
        draft?.bundleSha256 || draft?.bundle_sha256,
        "",
      );
      if (!id || !skillId || !bundleSha256) return null;
      return {
        id,
        skillId,
        version: aiPublicText(draft?.version, ""),
        bundleSha256,
        manifest: sanitizeAiPublicValue(draft?.manifest || {}),
        status:
          draft?.status === "pending_review" ||
          draft?.status === "approved" ||
          draft?.status === "rejected"
            ? draft.status
            : "pending_review",
      };
    })
    .filter(Boolean)
    .slice(0, 3);
}

function sanitizeAiPublicValue(value) {
  if (typeof value === "string") return aiPublicText(value, "已隐藏内部字段");
  if (Array.isArray(value)) return value.map(sanitizeAiPublicValue).slice(0, 20);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !AI_UI_INTERNAL_TEXT.test(key))
      .slice(0, 30)
      .map(([key, item]) => [key, sanitizeAiPublicValue(item)]),
  );
}

function normalizeProjectHealth(value) {
  const rows = Array.isArray(value?.topProjects) ? value.topProjects : [];
  const topProjects = rows
    .map((item) => {
      const projectName =
        typeof item?.projectName === "string" ? item.projectName.trim() : "";
      if (!projectName) return null;
      const priority =
        item?.priority === "high" ||
        item?.priority === "medium" ||
        item?.priority === "low"
          ? item.priority
          : "medium";
      const reasons = Array.isArray(item?.reasons)
        ? item.reasons
            .map((reason) =>
              typeof reason === "string" ? reason.trim().slice(0, 180) : "",
            )
            .filter(Boolean)
            .slice(0, 3)
        : [];
      const evidence = Array.isArray(item?.evidence)
        ? item.evidence
            .map((entry) => ({
              sourceTool:
                typeof entry?.sourceTool === "string"
                  ? entry.sourceTool.slice(0, 80)
                  : "role_home_dashboard",
              sourceId:
                typeof entry?.sourceId === "string"
                  ? entry.sourceId.slice(0, 180)
                  : "",
            }))
            .filter((entry) => entry.sourceId)
            .slice(0, 3)
        : [];
      const score = Number(item?.score);
      return {
        projectId:
          typeof item?.projectId === "string"
            ? item.projectId.slice(0, 120)
            : undefined,
        projectName: projectName.slice(0, 120),
        priority,
        score: Number.isFinite(score) ? score : undefined,
        reasons,
        evidence,
        target: normalizeAiTarget(item?.target),
      };
    })
    .filter(Boolean)
    .slice(0, 3);
  return topProjects.length ? { topProjects } : null;
}

function normalizeSuggestedActions(value) {
  if (!Array.isArray(value)) return null;
  const actions = value
    .map((item) => {
      const title = typeof item?.title === "string" ? item.title.trim() : "";
      if (!title) return null;
      const priority =
        item?.priority === "high" ||
        item?.priority === "medium" ||
        item?.priority === "low"
          ? item.priority
          : "medium";
      const evidence = Array.isArray(item?.evidence)
        ? item.evidence
            .map((entry) => ({
              sourceTool:
                typeof entry?.sourceTool === "string"
                  ? entry.sourceTool.slice(0, 80)
                  : "role_home_dashboard",
              sourceId:
                typeof entry?.sourceId === "string"
                  ? entry.sourceId.slice(0, 180)
                  : "",
            }))
            .filter((entry) => entry.sourceId)
            .slice(0, 3)
        : [];
      return {
        actionId:
          typeof item?.actionId === "string"
            ? item.actionId.slice(0, 160)
            : title,
        projectId:
          typeof item?.projectId === "string"
            ? item.projectId.slice(0, 120)
            : undefined,
        projectName:
          typeof item?.projectName === "string"
            ? item.projectName.slice(0, 120)
            : "",
        priority,
        title: title.slice(0, 160),
        rationale:
          typeof item?.rationale === "string"
            ? item.rationale.slice(0, 240)
            : "",
        evidence,
        target: normalizeAiTarget(item?.target),
        requiresHumanApproval: item?.requiresHumanApproval !== false,
      };
    })
    .filter(Boolean)
    .slice(0, 3);
  return actions.length ? actions : null;
}

function normalizeWebSearchMeta(value) {
  const status =
    value?.status === "succeeded" ||
    value?.status === "empty" ||
    value?.status === "failed" ||
    value?.status === "unconfigured"
      ? value.status
      : null;
  if (!status) return null;
  const results = Array.isArray(value?.results)
    ? value.results
        .map((item) => {
          const title =
            typeof item?.title === "string" ? item.title.trim() : "";
          const url = safeWebSearchUrl(
            typeof item?.url === "string" ? item.url : "",
          );
          if (!title || !url) return null;
          return {
            title: title.slice(0, 140),
            url: url.slice(0, 240),
            sourceQuery:
              typeof item?.sourceQuery === "string"
                ? item.sourceQuery.trim().slice(0, 240)
                : "",
            content:
              typeof item?.content === "string"
                ? item.content.trim().slice(0, 220)
                : "",
            publishedAt:
              typeof item?.publishedAt === "string"
                ? item.publishedAt.trim().slice(0, 40)
                : null,
          };
        })
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const error = typeof value?.error === "string" ? value.error.trim() : "";
  return {
    status,
    results,
    ...(error ? { error: error.slice(0, 220) } : {}),
  };
}

function safeWebSearchUrl(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? text
      : "";
  } catch {
    return "";
  }
}

function normalizeAiTodoDrafts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((draft) =>
      normalizeAiTodoDraft({
        id: draft?.id,
        ...(draft?.payload || {}),
      }),
    )
    .filter(Boolean);
}

function normalizeAiTodoDraft(value) {
  const title =
    typeof value?.title === "string"
      ? value.title.trim()
      : typeof value?.text === "string"
        ? value.text.trim()
        : "";
  const id =
    typeof value?.draftId === "string"
      ? value.draftId
      : typeof value?.id === "string"
        ? value.id
        : typeof value?.key === "string" && value.key.startsWith("ai-draft:")
          ? value.key.slice("ai-draft:".length)
          : "";
  if (!title || !id) return null;
  const priority =
    value?.priority === "high" ||
    value?.priority === "medium" ||
    value?.priority === "low"
      ? value.priority
      : value?.count === "high" ||
          value?.count === "medium" ||
          value?.count === "low"
        ? value.count
        : "medium";
  return {
    key: `ai-draft:${id}`,
    text: title.slice(0, 160),
    count: priority,
    tone:
      priority === "high"
        ? "danger"
        : priority === "medium"
          ? "warn"
          : "neutral",
    route:
      typeof value?.route === "string" && value.route ? value.route : undefined,
    targetId:
      typeof value?.targetId === "string" && value.targetId
        ? value.targetId
        : undefined,
    draftId: id,
  };
}

function mergeAiDraftTodos(personal, aiDraftTodos) {
  if (!aiDraftTodos.length) return personal;
  const existing = new Set((personal?.todos || []).map((todo) => todo.key));
  const todos = [
    ...aiDraftTodos.filter((todo) => !existing.has(todo.key)),
    ...(personal?.todos || []),
  ].slice(0, 5);
  return {
    ...(personal || { summary: [], recos: [] }),
    todos,
  };
}

function normalizeAiTarget(value) {
  if (!value || typeof value !== "object") return undefined;
  const route = typeof value.route === "string" ? value.route : "";
  if (!route) return undefined;
  return {
    route,
    ...(typeof value.id === "string" ? { id: value.id.slice(0, 120) } : {}),
  };
}

function normalizeConversationHistory(value) {
  const turns = Array.isArray(value?.turns) ? value.turns : [];
  const turnByAssistantMessage = new Map(
    turns
      .filter(
        (turn) =>
          typeof turn?.assistantMessageId === "string" &&
          typeof turn?.id === "string",
      )
      .map((turn) => [turn.assistantMessageId, turn]),
  );
  if (!Array.isArray(value?.messages)) return [];

  return value.messages
    .filter(
      (message) =>
        message?.status !== "superseded" &&
        (message?.role === "user" || message?.role === "assistant"),
    )
    .map((message) => {
      const turn = turnByAssistantMessage.get(message.id);
      const status =
        typeof message?.status === "string" ? message.status : "completed";
      const rawText =
        typeof message?.content === "string" ? message.content.trim() : "";
      const safeRawText =
        message?.role === "assistant"
          ? rawText
            ? aiPublicContent(rawText, AI_UI_SAFE_FAILURE_TEXT)
            : ""
          : rawText;
      const failedText = aiPublicText(
        turn?.errorSummary,
        AI_UI_SAFE_FAILURE_TEXT,
      );
      return {
        id: typeof message?.id === "string" ? message.id : undefined,
        role: message?.role === "user" ? "user" : "ai",
        text:
          safeRawText ||
          (status === "failed"
            ? `⚠ ${failedText}`
            : status === "completed"
              ? "已完成回复"
              : "正在恢复会话状态…"),
        status,
        ...(normalizeAiMessageMeta(message?.metadata)
          ? { meta: normalizeAiMessageMeta(message.metadata) }
          : {}),
        ...(turn?.id ? { turnId: turn.id } : {}),
        ...(turn?.retryable ? { retryable: true } : {}),
      };
    });
}

function normalizePendingClarify(value) {
  const turns = Array.isArray(value?.turns) ? value.turns : [];
  for (const turn of turns) {
    const pending =
      turn?.pendingClarify ||
      turn?.pending_clarify ||
      turn?.providerState?.pendingClarify ||
      turn?.provider_state?.pendingClarify;
    if (!pending || typeof pending !== "object") continue;
    const clarifyId =
      typeof pending.clarifyId === "string"
        ? pending.clarifyId
        : typeof pending.clarify_id === "string"
          ? pending.clarify_id
          : "";
    const question = aiPublicText(pending.question, "");
    if (!clarifyId || !question || typeof turn?.id !== "string") continue;
    return {
      clarifyId,
      turnId: turn.id,
      question,
      choices: aiPublicList(pending.choices).slice(0, 6),
      allowFreeText: pending.allowFreeText === true,
      submitted: false,
    };
  }
  return null;
}

function fileToAiAttachment(file) {
  if (file.size > AI_CHAT_ATTACHMENT_MAX_BYTES) {
    return Promise.reject(new Error(`附件 ${file.name} 超过 8MB`));
  }

  return Promise.all([
    readFileAsDataUrl(file),
    shouldReadAttachmentText(file) ? readFileAsText(file) : Promise.resolve(""),
  ]).then(([data, text]) => ({
    name: file.name || "attachment",
    mimeType: inferAttachmentMimeType(file),
    sizeBytes: file.size,
    data,
    ...(text ? { text: text.slice(0, 120_000) } : {}),
  }));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`附件 ${file.name} 读取失败`));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve("");
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsText(file);
  });
}

function shouldReadAttachmentText(file) {
  const mimeType = inferAttachmentMimeType(file);
  return (
    mimeType.startsWith("text/") ||
    /\.(csv|txt|md|markdown|json|log)$/i.test(file.name || "")
  );
}

function inferAttachmentMimeType(file) {
  if (file.type) return file.type;
  if (/\.csv$/i.test(file.name || "")) return "text/csv";
  if (/\.json$/i.test(file.name || "")) return "application/json";
  if (/\.md|\.markdown$/i.test(file.name || "")) return "text/markdown";
  if (/\.txt|\.log$/i.test(file.name || "")) return "text/plain";
  if (/\.pdf$/i.test(file.name || "")) return "application/pdf";
  if (/\.docx$/i.test(file.name || "")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (/\.xlsx$/i.test(file.name || "")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "application/octet-stream";
}

function fmtKpi(value, unit) {
  if (unit === "元") {
    const v = Number(value) || 0;
    return {
      value: Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) : String(v),
      unit: Math.abs(v) >= 10000 ? "万" : "元",
    };
  }
  return { value: String(value), unit: unit || "" };
}

function normalizeDashboardActionGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((group, groupIndex) => ({
      title: group?.title || `待办组 ${groupIndex + 1}`,
      items: (Array.isArray(group?.items) ? group.items : [])
        .map((item, itemIndex) => ({
          label: item?.label || `事项 ${itemIndex + 1}`,
          value: Number(item?.value) || 0,
          tone: item?.tone || "neutral",
          target: item?.target,
        }))
        .slice(0, 2),
    }))
    .filter((group) => group.items.length > 0)
    .slice(0, 4);
}

function normalizeDashboardPersonalPanel(panel) {
  if (!panel || typeof panel !== "object") return null;
  const summary = Array.isArray(panel.summary)
    ? panel.summary.slice(0, 4).map((item) => ({
        label: item?.label || "",
        value: String(Number(item?.value) || 0),
        color: tone(item?.tone).color,
        attention: !!item?.attention,
        series: normalizeVisualSeries(item?.series),
      }))
    : [];
  const recos = Array.isArray(panel.recommendations)
    ? panel.recommendations.slice(0, 3).map((item) => ({
        icon: item?.icon || "看",
        text: item?.text || "",
        sub: item?.sub || "",
        tone: item?.tone || "neutral",
        cta: item?.cta || "查看",
        route: item?.target?.route || item?.route,
      }))
    : [];
  const todos = Array.isArray(panel.todos)
    ? panel.todos.slice(0, 5).map((item, index) => ({
        key: item?.key || `todo-${index}`,
        text: item?.text || "",
        count:
          item?.count === null || item?.count === undefined
            ? null
            : Number(item.count) || 0,
        tone: item?.tone || "neutral",
        route: item?.target?.route || item?.route,
      }))
    : [];

  if (!summary.length && !recos.length && !todos.length) return null;
  return { summary, recos, todos };
}

const cnt = (arr, fn) => (arr || []).filter(fn).length;
const pStatus = (p, s) => p?.status === s;
const OPERATING_PROJECT_STATUSES = new Set([
  "recruiting",
  "pending_start",
  "active",
  "paused",
  "settling",
]);
const PENDING_REPORT_STATUSES = new Set([
  "pending_review",
  "pending_adjudication",
]);
const margin = (p) => Number(p?.metrics?.margin);
const isLive = (t) => t?.status === "live" || t?.statusLabel === "直播中";
const isNotStarted = (t) =>
  ["pending_live", "not_started", "scheduled"].includes(t?.status);
const isDone = (t) =>
  t?.status === "completed" || t?.status === "done" || t?.status === "已完成";
const isAnomaly = (t) => t?.anomaly || t?.status === "abnormal";
const isOperatingProject = (project) =>
  OPERATING_PROJECT_STATUSES.has(project?.status);
const isPendingReport = (report) => PENDING_REPORT_STATUSES.has(report?.status);

function projectMetricTotal(projects, key) {
  return (projects || []).reduce(
    (total, project) => total + (Number(project?.metrics?.[key]) || 0),
    0,
  );
}

function scopedPendingReportCount(projects, reports) {
  return Math.max(
    projectMetricTotal(projects, "reportedPending"),
    cnt(reports, isPendingReport),
  );
}

function scopedAnomalyCount(projects, tasks) {
  return Math.max(
    projectMetricTotal(projects, "anomalies"),
    cnt(tasks, isAnomaly),
  );
}

// 今日排班按小时累计（真实可计算的时序；无则返回 null，不画线）。
function scheduleSeries(tasks) {
  const byHour = Array(24).fill(0);
  let any = false;
  (tasks || []).forEach((t) => {
    const h = Number(t?.startHour);
    if (Number.isFinite(h)) {
      byHour[Math.max(0, Math.min(23, Math.round(h)))] += 1;
      any = true;
    }
  });
  if (!any) return null;
  const out = [];
  let acc = 0;
  for (let h = 6; h <= 23; h += 1) {
    acc += byHour[h];
    out.push(acc);
  }
  return out.length >= 2 ? out : null;
}

// 4 个 KPI 待办分组（设计稿主看板 4 张卡）。按登录角色给出两段对照值。
function computeTodoGroups(
  role,
  { projects = [], tasks = [], reports = [], batches = [] },
) {
  const bs = (s) => cnt(batches, (b) => b.status === s || b.statusKey === s);
  const pendReports = cnt(reports, (r) => r.status === "pending_review");
  const anomalies = cnt(tasks, isAnomaly);
  const notStarted = cnt(tasks, isNotStarted);
  const recordingPending = (projects || []).reduce(
    (s, p) => s + (p?.streamers?.pendingReview ?? 0),
    0,
  );
  const gapProjects = cnt(projects, (p) => (p?.streamers?.candidate ?? 0) > 0);
  const G = (title, items) => ({ title, items });
  const I = (label, value, t, route) => ({
    label,
    value: Number(value) || 0,
    tone: t,
    target: route ? { route } : undefined,
  });

  if (role.includes("operator")) {
    return [
      G("今日任务", [
        I(
          "待处理",
          cnt(tasks, (t) => !isDone(t)),
          "primary",
          "tasks",
        ),
        I("已完成", cnt(tasks, isDone), "ok", "tasks"),
      ]),
      G("直播待办", [
        I("未开播", notStarted, notStarted ? "bad" : "neutral", "tasks"),
        I("异常", anomalies, anomalies ? "bad" : "neutral", "tasks"),
      ]),
      G("报数待办", [
        I("待审核", pendReports, pendReports ? "warn" : "neutral", "reports"),
        I("总报数", reports.length, "neutral", "reports"),
      ]),
      G("准入待办", [
        I(
          "录屏待审",
          recordingPending,
          recordingPending ? "warn" : "neutral",
          "projects",
        ),
        I("主播缺口", gapProjects, gapProjects ? "bad" : "neutral", "projects"),
      ]),
    ];
  }
  if (role.includes("finance")) {
    return [
      G("批次待办", [
        I("待生成", bs("draft"), "neutral", "settle"),
        I("待确认", bs("pending_confirm") + bs("generated"), "warn", "settle"),
      ]),
      G("锁定待办", [
        I("已锁定", bs("locked"), "ok", "settle"),
        I("已导出", bs("exported"), "neutral", "settle"),
      ]),
      G("风险待办", [
        I("重开", bs("reopened"), bs("reopened") ? "bad" : "neutral", "settle"),
        I("待审报数", pendReports, pendReports ? "warn" : "neutral", "reports"),
      ]),
      G("报数待办", [
        I("待审核", pendReports, pendReports ? "warn" : "neutral", "reports"),
        I("总报数", reports.length, "neutral", "reports"),
      ]),
    ];
  }
  if (role.includes("ops")) {
    return [
      G("项目待办", [
        I(
          "执行中",
          cnt(projects, (p) => pStatus(p, "active")),
          "primary",
          "projects",
        ),
        I(
          "招募中",
          cnt(projects, (p) => pStatus(p, "recruiting")),
          "neutral",
          "projects",
        ),
      ]),
      G("准入待办", [
        I(
          "录屏待审",
          recordingPending,
          recordingPending ? "warn" : "neutral",
          "projects",
        ),
        I("主播缺口", gapProjects, gapProjects ? "bad" : "neutral", "projects"),
      ]),
      G("直播待办", [
        I("今日排班", tasks.length, "ok", "tasks"),
        I("异常", anomalies, anomalies ? "bad" : "neutral", "tasks"),
      ]),
      G("报数待办", [
        I("待审核", pendReports, pendReports ? "warn" : "neutral", "reports"),
        I("未开播", notStarted, notStarted ? "bad" : "neutral", "tasks"),
      ]),
    ];
  }
  return [
    G("项目待办", [
      I(
        "进行中",
        cnt(projects, (p) => pStatus(p, "active")),
        "primary",
        "projects",
      ),
      I(
        "招募中",
        cnt(projects, (p) => pStatus(p, "recruiting")),
        "neutral",
        "projects",
      ),
    ]),
    G("复盘待办", [
      I(
        "低毛利",
        cnt(projects, (p) => margin(p) >= 0 && margin(p) < 20),
        "warn",
        "projects",
      ),
      I(
        "负毛利",
        cnt(projects, (p) => margin(p) < 0),
        "bad",
        "projects",
      ),
    ]),
    G("结算待办", [
      I("待生成", bs("draft"), "neutral", "settle"),
      I("待确认", bs("pending_confirm") + bs("generated"), "warn", "settle"),
    ]),
    G("审计待办", [
      I(
        "高风险",
        cnt(projects, (p) => p.risk === "high"),
        "bad",
        "audit",
      ),
      I("重开", bs("reopened"), bs("reopened") ? "bad" : "neutral", "settle"),
    ]),
  ];
}

function localDateParts(value) {
  const text = String(value || "");
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    const [year = "0", month = "0", day = "0"] = text.slice(0, 10).split("-");
    return {
      year: Number(year),
      month: Number(month),
      day: Number(day),
    };
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateKeyFromParts(parts) {
  if (!parts.year || !parts.month || !parts.day) return null;
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function localDateKey(value) {
  if (!value) return null;
  return dateKeyFromParts(localDateParts(value));
}

function dateKeyToUtcDate(dateKey) {
  const [year, month, day] = String(dateKey || "")
    .split("-")
    .map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysToDateKey(dateKey, days) {
  const date = dateKeyToUtcDate(dateKey);
  if (!date) return dateKey;
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate(),
  )}`;
}

function dashboardPeriodRange(period, generatedAt) {
  if (period === "实时") return null;

  const baseKey = localDateKey(generatedAt || new Date().toISOString());
  if (!baseKey) return null;

  if (period === "今日") {
    return { start: baseKey, end: baseKey };
  }

  const baseDate = dateKeyToUtcDate(baseKey);
  if (!baseDate) return { start: baseKey, end: baseKey };

  if (period === "本周") {
    const day = baseDate.getUTCDay() || 7;
    const start = addDaysToDateKey(baseKey, 1 - day);
    return { start, end: addDaysToDateKey(start, 6) };
  }

  const parts = localDateParts(baseKey);
  const start = `${parts.year}-${pad2(parts.month)}-01`;
  const end = `${parts.year}-${pad2(parts.month)}-${pad2(
    new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate(),
  )}`;
  return { start, end };
}

function dateInRange(value, range) {
  if (!range) return true;
  const key = localDateKey(value);
  return !!key && key >= range.start && key <= range.end;
}

function dateSpanOverlapsRange(startValue, endValue, range) {
  if (!range) return true;
  const start = localDateKey(startValue);
  const end = localDateKey(endValue) || start;
  if (!start && !end) return false;
  const from = start || end;
  const to = end || start;
  return from <= range.end && to >= range.start;
}

function projectInPeriod(project, range) {
  if (!range) return true;
  return dateSpanOverlapsRange(
    project?.start ||
      project?.startDate ||
      project?.startsAt ||
      project?.createdAt ||
      project?.updatedAt,
    project?.end ||
      project?.endDate ||
      project?.endsAt ||
      project?.updatedAt ||
      project?.start,
    range,
  );
}

function taskInPeriod(task, range) {
  if (!range) return true;
  return dateSpanOverlapsRange(
    task?.plannedStartAt || task?.startAt || task?.createdAt || task?.updatedAt,
    task?.plannedEndAt || task?.endAt || task?.updatedAt,
    range,
  );
}

function reportInPeriod(report, range) {
  if (!range) return true;
  return dateInRange(
    report?.submittedAt || report?.createdAt || report?.updatedAt,
    range,
  );
}

function batchInPeriod(batch, range) {
  if (!range) return true;
  return (
    dateSpanOverlapsRange(batch?.periodStart, batch?.periodEnd, range) ||
    dateInRange(batch?.updatedAt || batch?.createdAt, range)
  );
}

function scopeDashboardDataByPeriod(
  period,
  generatedAt,
  { projects = [], tasks = [], reports = [], batches = [] },
) {
  const range = dashboardPeriodRange(period, generatedAt);
  if (!range) return { projects, tasks, reports, batches };

  return {
    projects: projects.filter((project) => projectInPeriod(project, range)),
    tasks: tasks.filter((task) => taskInPeriod(task, range)),
    reports: reports.filter((report) => reportInPeriod(report, range)),
    batches: batches.filter((batch) => batchInPeriod(batch, range)),
  };
}

function sumMetric(projects, key) {
  return projectMetricTotal(projects, key);
}

function scopedRiskCount({ projects = [], tasks = [], batches = [] }) {
  return (
    cnt(projects, (project) => project?.risk === "high") +
    cnt(tasks, isAnomaly) +
    cnt(batches, (batch) => batch?.status === "reopened")
  );
}

function scopedKpiValue(key, data) {
  const projects = data.projects || [];
  const tasks = data.tasks || [];
  const reports = data.reports || [];
  const batches = data.batches || [];
  const receivable = sumMetric(projects, "receivable");
  const gross = sumMetric(projects, "gross");
  const plannedHours = sumMetric(projects, "plannedHours");
  const doneHours = sumMetric(projects, "doneHours");
  const recordingPending = projects.reduce(
    (total, project) => total + (project?.streamers?.pendingReview ?? 0),
    0,
  );
  const streamerGapProjects = cnt(
    projects,
    (project) => (project?.streamers?.candidate ?? 0) > 0,
  );
  const pendingReports = scopedPendingReportCount(projects, reports);

  switch (key) {
    case "vendorReceivable":
      return receivable;
    case "estimatedGross":
      return gross;
    case "grossMarginRate":
      return receivable > 0 ? Math.round((gross / receivable) * 1000) / 10 : 0;
    case "highRiskItems":
      return scopedRiskCount(data);
    case "activeProjects":
      return cnt(projects, isOperatingProject);
    case "deliveryProgress":
      return plannedHours > 0
        ? Math.round((doneHours / plannedHours) * 1000) / 10
        : 0;
    case "streamerGapProjects":
      return streamerGapProjects;
    case "recordingsPending":
      return recordingPending;
    case "pendingReports":
      return pendingReports;
    case "anomalyTasks":
    case "streamerReminders":
      return scopedAnomalyCount(projects, tasks);
    case "myTodayTasks":
      return tasks.length;
    case "notStartedTasks":
      return cnt(tasks, isNotStarted);
    case "draftBatches":
      return cnt(batches, (batch) => batch?.status === "draft");
    case "reopenedBatches":
      return cnt(batches, (batch) => batch?.status === "reopened");
    default:
      return undefined;
  }
}

function buildScopedLiveKpis(baseKpis, role, data) {
  const defaults = role.includes("finance")
    ? [
        { key: "draftBatches", label: "待生成批次", unit: "个" },
        { key: "pendingReports", label: "待审核报数", unit: "条" },
        { key: "reopenedBatches", label: "重开批次", unit: "个", tone: "red" },
        { key: "highRiskItems", label: "高风险事项", unit: "项", tone: "red" },
      ]
    : role.includes("operator")
      ? [
          { key: "myTodayTasks", label: "我的任务", unit: "项" },
          {
            key: "notStartedTasks",
            label: "未开播",
            unit: "项",
            tone: "amber",
          },
          { key: "pendingReports", label: "待审核报数", unit: "条" },
          {
            key: "streamerReminders",
            label: "需联系主播",
            unit: "人",
            tone: "red",
          },
        ]
      : role.includes("ops")
        ? [
            { key: "activeProjects", label: "招募/执行项目", unit: "个" },
            { key: "deliveryProgress", label: "履约进度", unit: "%" },
            {
              key: "streamerGapProjects",
              label: "主播缺口项目",
              unit: "个",
              tone: "amber",
            },
            {
              key: "recordingsPending",
              label: "录屏待审",
              unit: "条",
              tone: "amber",
            },
          ]
        : [
            { key: "vendorReceivable", label: "本月厂家应收", unit: "元" },
            { key: "estimatedGross", label: "预计毛利", unit: "元" },
            { key: "grossMarginRate", label: "预计毛利率", unit: "%" },
            {
              key: "highRiskItems",
              label: "高风险事项",
              unit: "项",
              tone: "red",
            },
          ];

  const source = (baseKpis?.length ? baseKpis : defaults).slice(0, 4);
  return source.map((item, index) => {
    const fallback = defaults[index] || item;
    const key = item.key || fallback.key;
    const scopedValue = scopedKpiValue(key, data);
    return {
      ...fallback,
      ...item,
      key,
      label: item.label || fallback.label,
      unit: item.unit || fallback.unit,
      value: scopedValue === undefined ? item.value : scopedValue,
    };
  });
}

function admissionDecision(stage, index, total) {
  if (index === 0) {
    return {
      title: "报名入口",
      detail: "候选量是否充足，来源质量是否稳定？",
    };
  }
  if (index === total - 1) {
    return {
      title: "入项确认",
      detail: "可排班人选是否稳定，是否满足项目节奏？",
    };
  }
  if (String(stage?.key || "").includes("review")) {
    return {
      title: "录屏审核",
      detail: "录屏证据是否达标，卡点集中在哪？",
    };
  }
  return {
    title: "筛选推进",
    detail: "这一层的流失是否异常，是否需要运营介入？",
  };
}

function funnelRate(funnel) {
  const st = funnel?.stages;
  if (!st?.length) return null;
  const first = Number(st[0]?.value) || 0;
  const last = Number(st[st.length - 1]?.value) || 0;
  if (first <= 0) return null;
  return Math.round((last / first) * 100);
}

// ——— 走势线（仅画真实序列） ———
function sp(arr, w, h, pad = 2) {
  if (!arr || arr.length < 2) return null;
  const mn = Math.min(...arr),
    mx = Math.max(...arr),
    rng = mx - mn || 1;
  const xPad = Math.max(3, pad * 2);
  const drawableW = Math.max(1, w - xPad * 2);
  const pts = arr.map((v, i) => {
    const x = xPad + (i / (arr.length - 1)) * drawableW;
    const y = h - pad - ((v - mn) / rng) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",");
  const first = pts[0].split(",");
  return {
    line: pts.join(" "),
    area: `${first[0]},${h} ${pts.join(" ")} ${last[0]},${h}`,
    lastX: last[0],
    lastY: last[1],
  };
}
function AreaSpark({ series, color, w = 320, h = 54, gid, testId }) {
  const s = spp(series, w, h);
  if (!s) return null;
  const id = gid || `sk${color.replace(/[^a-z0-9]/gi, "")}${series.length}`;
  return (
    <svg
      data-testid={testId}
      width="100%"
      height={h + 2}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        display: "block",
        marginTop: 10,
        overflow: "visible",
        width: "100%",
      }}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={s.area} fill={`url(#${id})`} />
      <polyline
        points={s.line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={s.lastX}
        cy={s.lastY}
        r="2.6"
        fill={color}
        stroke="#fff"
        strokeWidth="1.5"
      />
    </svg>
  );
}
function spp(arr, w, h, pad = 6) {
  return spr(arr, w, h, pad, Math.max(10, pad * 2));
}
function spr(arr, w, h, pad, xPad = pad) {
  if (!arr || arr.length < 2) return null;
  const mn = Math.min(...arr),
    mx = Math.max(...arr),
    rng = mx - mn || 1;
  const drawableW = Math.max(1, w - xPad * 2);
  const pts = arr.map((v, i) => {
    const x = xPad + (i / (arr.length - 1)) * drawableW;
    const y = h - pad - ((v - mn) / rng) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",");
  const first = pts[0].split(",");
  return {
    line: pts.join(" "),
    area: `${first[0]},${h} ${pts.join(" ")} ${last[0]},${h}`,
    lastX: last[0],
    lastY: last[1],
  };
}
function MiniLine({ series, color, w = 46, h = 20, testId }) {
  const spark = spr(series, w, h, 2, 3);
  if (!spark) return null;
  return (
    <svg
      data-testid={testId}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", overflow: "visible" }}
      aria-hidden
    >
      <polyline
        points={spark.line}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        opacity=".85"
      />
    </svg>
  );
}

function AdmissionFunnelModel({ admission }) {
  const stages = admission?.stages || [];
  const base = Math.max(
    ...stages.map((stage) => Math.abs(Number(stage.value) || 0)),
    1,
  );
  const first = Number(stages[0]?.value) || 0;
  const shrinkStep = stages.length > 1 ? 42 / (stages.length - 1) : 0;

  return (
    <div
      data-testid="admission-funnel-model"
      className="ob-admission-funnel-model"
      style={{
        padding: 0,
      }}
    >
      <div className="ob-admission-funnel-grid">
        <div
          className="ob-admission-funnel-head"
          style={{
            fontSize: 12,
            fontWeight: 680,
            color: C.ink4,
            padding: "0 8px 2px",
          }}
        >
          转化指标
        </div>
        <div
          className="ob-admission-funnel-head ob-admission-funnel-head-stage"
          style={{
            fontSize: 12,
            fontWeight: 680,
            color: C.ink4,
            textAlign: "center",
            paddingBottom: 2,
          }}
        >
          阶段
        </div>
        <div
          className="ob-admission-funnel-head ob-admission-funnel-head-decision"
          style={{
            fontSize: 12,
            fontWeight: 680,
            color: C.ink4,
            padding: "0 8px 2px",
          }}
        >
          业务决策
        </div>

        {stages.map((stage, index) => {
          const value = Math.abs(Number(stage.value) || 0);
          const pct = Math.min(
            Math.max(Math.round((value / base) * 100), 6),
            100,
          );
          const ofFirst =
            first > 0 ? `${Math.round((value / first) * 100)}%` : "—";
          const next = stages[index + 1];
          const conversion =
            next && value > 0
              ? `${Math.round(((Number(next.value) || 0) / value) * 100)}%`
              : null;
          const decision = admissionDecision(stage, index, stages.length);
          const width = Math.max(44, 88 - index * shrinkStep);
          const tone =
            index === stages.length - 1
              ? {
                  fill: "linear-gradient(180deg,var(--violet-600) 0%,var(--blue-800) 100%)",
                  metric: "var(--blue-50)",
                  accent: "var(--violet-600)",
                }
              : {
                  fill: "linear-gradient(180deg,var(--blue-500) 0%,var(--violet-600) 100%)",
                  metric: "var(--violet-50)",
                  accent: "var(--blue-600)",
                };

          return (
            <React.Fragment key={stage.key || index}>
              <div
                data-testid="admission-funnel-metric"
                className="ob-admission-funnel-metric"
                style={{
                  minHeight: 58,
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 64px",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 11px 9px 14px",
                  background: tone.metric,
                  border: `1px solid ${C.divider}`,
                  clipPath:
                    "polygon(0 0,calc(100% - 18px) 0,100% 50%,calc(100% - 18px) 100%,0 100%)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 680,
                      color: C.ink2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {stage.label}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 11.5,
                      color: C.ink4,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    占报名 {ofFirst}
                  </div>
                </div>
                <div
                  style={{
                    minHeight: 38,
                    border: `1px dashed ${C.ink3}`,
                    borderRadius: 6,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    color: tone.accent,
                    background: "rgba(255,255,255,.62)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <strong style={{ fontSize: 18, lineHeight: 1 }}>
                    {num(stage.value)}
                  </strong>
                  <span style={{ fontSize: 10.5, color: C.ink4 }}>人</span>
                </div>
              </div>

              <div
                className="ob-admission-funnel-segment-wrap"
                style={{
                  minHeight: 58,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                <div
                  data-testid="admission-funnel-segment"
                  style={{
                    width: `${width}%`,
                    height: 58,
                    clipPath: "polygon(5% 0,95% 0,84% 100%,16% 100%)",
                    background: tone.fill,
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,.26),0 8px 18px -14px rgba(91,75,209,.45)",
                    color: "#fff",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 720 }}>
                    {stage.label}
                  </span>
                  <span
                    style={{
                      marginTop: 3,
                      fontSize: 11,
                      opacity: 0.86,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {pct}% 阶段占比
                  </span>
                </div>
              </div>

              <div
                data-testid="admission-funnel-decision"
                className="ob-admission-funnel-decision"
                style={{
                  minHeight: 58,
                  display: "grid",
                  gridTemplateColumns: "38px minmax(0,1fr)",
                  gap: 10,
                  alignItems: "center",
                  padding: "9px 12px",
                  background: "linear-gradient(180deg,#f7f9fd 0%,#ffffff 100%)",
                  border: `1px solid ${C.divider2}`,
                  borderRadius: 10,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: tone.accent,
                    background: tone.metric,
                    fontSize: 15,
                    fontWeight: 780,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {index + 1}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 3,
                    }}
                  >
                    <strong
                      style={{
                        fontSize: 12.5,
                        color: C.ink2,
                        fontWeight: 720,
                      }}
                    >
                      {decision.title}
                    </strong>
                    {conversion ? (
                      <span
                        style={{
                          fontSize: 11,
                          color: C.warn,
                          background: "var(--warn-50)",
                          borderRadius: 999,
                          padding: "2px 7px",
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        下一层 {conversion}
                      </span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      lineHeight: 1.45,
                      color: C.ink4,
                    }}
                  >
                    {decision.detail}
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function useClock() {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(force, 5000);
    return () => clearInterval(id);
  }, []);
}
function nowClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function updatedLabelFrom(generatedAt) {
  if (!generatedAt) return "刚刚更新";
  const diff = Math.max(
    0,
    Math.floor((Date.now() - new Date(generatedAt).getTime()) / 1000),
  );
  return diff < 60 ? `${diff} 秒前更新` : `${Math.floor(diff / 60)} 分钟前更新`;
}

const ROLE_LABELS = {
  owner: "负责人",
  ops_manager: "运营负责人",
  operator_business: "次级运营",
  finance: "财务",
  streamer: "主播",
};
function greeting() {
  const h = new Date().getHours();
  return h < 6
    ? "凌晨好"
    : h < 11
      ? "早上好"
      : h < 13
        ? "中午好"
        : h < 18
          ? "下午好"
          : "晚上好";
}

// ============================================================
//  KPI 卡（设计稿主看板 4 张）
// ============================================================
function KpiCard({ group }) {
  const a = group.items[0] || { label: "", value: 0, tone: "neutral" };
  const b = group.items[1] || { label: "", value: 0, tone: "neutral" };
  const t = (Number(a.value) || 0) + (Number(b.value) || 0) || 1;
  const aCol = dotColor(a.tone),
    bCol = dotColor(b.tone);
  const numCol = (it, col) => (it.tone === "neutral" ? C.ink : col);
  const metricItems = [
    { item: a, color: aCol },
    { item: b, color: bCol },
  ];
  return (
    <div
      className="ob-kpi-card lift"
      style={{
        borderRadius: 14,
        padding: "16px 16px 14px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: "linear-gradient(180deg,#eef3ff,#e4ebff)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,.72),0 0 0 1px rgba(59,107,230,.08)",
          }}
        >
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: 3,
              background: C.primary,
            }}
          />
        </div>
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 12.5,
            color: C.ink3,
            fontWeight: 600,
          }}
        >
          {group.title}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2,minmax(0,1fr))",
          gap: 8,
        }}
      >
        {metricItems.map(({ item, color }) => (
          <div
            key={item.key || item.label}
            style={{
              minWidth: 0,
              borderRadius: 10,
              padding: "8px 9px",
              background: "rgba(247,249,253,.78)",
              border: `1px solid ${C.divider2}`,
            }}
          >
            <div
              style={{
                fontSize: 23,
                fontWeight: 720,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
                color: numCol(item, color),
              }}
            >
              {item.value}
            </div>
            <div
              data-testid="overview-kpi-metric-label"
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                wordBreak: "keep-all",
                fontSize: 11.5,
                color: C.muted,
                marginTop: 5,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                style={{
                  flex: "0 0 auto",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: color,
                }}
              />
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.label}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          height: 5,
          borderRadius: 3,
          background: C.track,
          marginTop: 13,
          display: "flex",
          overflow: "hidden",
          boxShadow: "inset 0 0 0 1px rgba(15,23,42,.03)",
        }}
      >
        <div
          style={{
            width: `${(((Number(a.value) || 0) / t) * 100).toFixed(1)}%`,
            background: aCol,
          }}
        />
        <div
          style={{
            width: `${(((Number(b.value) || 0) / t) * 100).toFixed(1)}%`,
            background: bCol,
          }}
        />
      </div>
    </div>
  );
}

// ============================================================
//  AI 助手面板（右栏）—— 调用真实 /api/ai/* 与 /api/marketplace/intel
// ============================================================
function extractAiText(body) {
  const o = body?.agentOutput || body?.output || body || {};
  if (typeof o.summary === "string" && o.summary.trim()) {
    const recs = Array.isArray(o.recommendations) ? o.recommendations : [];
    const tail = recs
      .slice(0, 3)
      .map((r) => `· ${typeof r === "string" ? r : r.text || r.title || ""}`)
      .filter(Boolean)
      .join("\n");
    return tail ? `${o.summary}\n\n建议：\n${tail}` : o.summary;
  }
  if (typeof o.narrative === "string" && o.narrative.trim()) return o.narrative;
  if (Array.isArray(o.findings) && o.findings.length)
    return o.findings.map((f) => `· ${f.title || f.text || ""}`).join("\n");
  return "已生成分析（需人工确认后采用）。";
}

function businessCopilotPayload(body) {
  return body?.result?.output || body?.output || body || {};
}

function formatBusinessCopilotText(body) {
  const answer = businessCopilotPayload(body);
  const lines = [
    typeof answer.answer === "string" && answer.answer.trim()
      ? answer.answer.trim()
      : "经营问答已生成。",
  ];
  const sourceSummary = answer.sourceSummary || {};
  const confidence = answer.confidence || {};

  if (sourceSummary.scopeLabel || confidence.label) {
    lines.push(
      `**来源**：${[sourceSummary.scopeLabel, confidence.label]
        .filter(Boolean)
        .join(" · ")}`,
    );
  }

  if (Array.isArray(answer.facts) && answer.facts.length) {
    lines.push(
      "",
      "### 事实",
      ...answer.facts.slice(0, 6).map((fact) => {
        const label = String(fact?.label || "事实");
        const value = `${fact?.value ?? ""}${fact?.unit ?? ""}`;
        return `- ${label}：${value}`;
      }),
    );
  }

  if (Array.isArray(answer.recommendations) && answer.recommendations.length) {
    lines.push(
      "",
      "### 建议",
      ...answer.recommendations
        .slice(0, 4)
        .map((item) => `- ${item?.proposal || "请人工复核后处理。"}`),
    );
  }

  if (Array.isArray(answer.caveats) && answer.caveats.length) {
    lines.push(
      "",
      "### 注意",
      ...answer.caveats.slice(0, 3).map((item) => `- ${item}`),
    );
  }

  if (answer.requiresHumanConfirmation) {
    lines.push("", "需人工确认");
  }

  return lines.join("\n");
}

function cleanMarkdownText(value) {
  return String(value || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
}

function markdownCells(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(cleanMarkdownText);
}

function isMarkdownTableRow(line) {
  const trimmed = String(line || "").trim();
  return trimmed.startsWith("|") && trimmed.includes("|", 1);
}

function isMarkdownTableSeparator(line) {
  if (!isMarkdownTableRow(line)) return false;
  const cells = markdownCells(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableStart(lines, index) {
  return (
    isMarkdownTableRow(lines[index]) &&
    isMarkdownTableSeparator(lines[index + 1])
  );
}

function parseMarkdownTable(lines) {
  const headers = markdownCells(lines[0]);
  const rows = lines
    .slice(2)
    .map(markdownCells)
    .filter((row) => row.some(Boolean));
  return { headers, rows };
}

function parseMarkdownHeading(line) {
  const match = /^(#{1,4})\s+(.+)$/.exec(String(line || "").trim());
  if (!match) return null;
  return {
    level: Math.min(match[1].length, 4),
    text: cleanMarkdownText(match[2]),
  };
}

function parseMarkdownListItem(line) {
  const unordered = /^\s*[-*+]\s+(.+)$/.exec(String(line || ""));
  if (unordered) {
    return { ordered: false, text: unordered[1] };
  }
  const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(String(line || ""));
  if (ordered) {
    return { ordered: true, text: ordered[1] };
  }
  return null;
}

function parseAiMarkdown(text) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let pendingText = [];

  const flushText = () => {
    const value = pendingText.join("\n").trim();
    if (value) blocks.push({ type: "paragraph", value });
    pendingText = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) {
      flushText();
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      flushText();
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "table", value: parseMarkdownTable(tableLines) });
      continue;
    }

    const heading = parseMarkdownHeading(lines[index]);
    if (heading) {
      flushText();
      blocks.push({ type: "heading", value: heading });
      continue;
    }

    const listItem = parseMarkdownListItem(lines[index]);
    if (listItem) {
      flushText();
      const items = [listItem.text];
      const ordered = listItem.ordered;
      index += 1;
      while (index < lines.length) {
        const nextItem = parseMarkdownListItem(lines[index]);
        if (!nextItem || nextItem.ordered !== ordered) break;
        items.push(nextItem.text);
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "list", value: { ordered, items } });
      continue;
    }

    pendingText.push(lines[index]);
  }

  flushText();
  return blocks;
}

function renderInlineMarkdown(text, keyPrefix = "inline") {
  const source = String(text || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const pattern = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`)/g;
  const nodes = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(source))) {
    if (match.index > lastIndex) {
      nodes.push(source.slice(lastIndex, match.index));
    }

    if (match[2] || match[3]) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${match.index}`}>
          {match[2] || match[3]}
        </strong>,
      );
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${match.index}`}
          style={{
            fontSize: "0.95em",
            color: C.primaryDeep,
            background: C.primarySoft,
            borderRadius: 4,
            padding: "0 4px",
          }}
        >
          {match[4]}
        </code>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < source.length) {
    nodes.push(source.slice(lastIndex));
  }

  return nodes.length ? nodes : [source];
}

function AiMessageContent({ text }) {
  const blocks = parseAiMarkdown(text);
  if (!blocks.length) return null;

  return (
    <div style={{ display: "grid", gap: 9, whiteSpace: "normal" }}>
      {blocks.map((block, index) =>
        block.type === "table" ? (
          <AiMarkdownTable key={index} table={block.value} />
        ) : block.type === "heading" ? (
          <AiHeadingBlock key={index} heading={block.value} />
        ) : block.type === "list" ? (
          <AiListBlock key={index} list={block.value} />
        ) : (
          <AiTextBlock key={index} text={block.value} />
        ),
      )}
    </div>
  );
}

function priorityTone(priority) {
  if (priority === "high") return tone("danger");
  if (priority === "medium") return tone("warn");
  return tone("ok");
}

function webSearchTone(status) {
  if (status === "succeeded") return tone("info");
  if (status === "failed") return tone("danger");
  return tone("warn");
}

function webSearchLabel(status) {
  if (status === "succeeded") return "Web search succeeded";
  if (status === "empty") return "Web search returned no usable sources";
  if (status === "unconfigured") return "Web search is not configured";
  return "Web search failed";
}

function AiWebSearchStatusCard({ webSearch }) {
  if (!webSearch) return null;
  const t = webSearchTone(webSearch.status);
  const sourceCount = Array.isArray(webSearch.results)
    ? webSearch.results.length
    : 0;
  const results = Array.isArray(webSearch.results)
    ? webSearch.results.slice(0, 4)
    : [];

  return (
    <div
      data-testid="ai-web-search-status-card"
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        background: C.soft,
        padding: "9px 10px",
        display: "grid",
        gap: 7,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: t.solid,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            minWidth: 0,
            flex: 1,
            fontSize: 12,
            fontWeight: 730,
            color: C.ink,
            overflowWrap: "anywhere",
          }}
        >
          {webSearchLabel(webSearch.status)}
        </span>
        <span
          style={{
            flexShrink: 0,
            color: t.color,
            background: t.bg,
            borderRadius: 999,
            padding: "2px 7px",
            fontSize: 10.5,
            fontWeight: 720,
            lineHeight: 1.4,
          }}
        >
          {sourceCount} sources
        </span>
      </div>
      {results.length ? (
        <div
          style={{
            display: "grid",
            gap: 6,
            paddingTop: 2,
            borderTop: `1px solid ${C.divider}`,
          }}
        >
          {results.map((result) => (
            <div key={result.url} style={{ display: "grid", gap: 2 }}>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  color: C.primaryDeep,
                  fontWeight: 700,
                  overflowWrap: "anywhere",
                  textDecoration: "none",
                }}
              >
                {result.title}
              </a>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 10.5,
                  lineHeight: 1.45,
                  color: C.muted,
                  overflowWrap: "anywhere",
                  textDecoration: "none",
                }}
              >
                {result.url}
              </a>
              {result.content ? (
                <div
                  style={{
                    fontSize: 10.8,
                    lineHeight: 1.45,
                    color: C.ink4,
                    overflowWrap: "anywhere",
                  }}
                >
                  {result.content}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : webSearch.error ? (
        <div
          style={{
            fontSize: 11.5,
            lineHeight: 1.5,
            color: C.ink3,
            overflowWrap: "anywhere",
          }}
        >
          {webSearch.error}
        </div>
      ) : null}
    </div>
  );
}

function AiProjectHealthCard({ projectHealth }) {
  const project = projectHealth?.topProjects?.[0];
  if (!project) return null;

  const t = priorityTone(project.priority);
  const reasons = Array.isArray(project.reasons)
    ? project.reasons.slice(0, 3)
    : [];
  const evidence = Array.isArray(project.evidence)
    ? project.evidence.slice(0, 2)
    : [];

  return (
    <div
      data-testid="ai-project-health-card"
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        background: C.soft,
        padding: "10px 11px",
        display: "grid",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: t.solid,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            minWidth: 0,
            flex: 1,
            fontSize: 12.5,
            fontWeight: 730,
            color: C.ink,
            overflowWrap: "anywhere",
          }}
        >
          {project.projectName}
        </span>
        <span
          style={{
            flexShrink: 0,
            color: t.color,
            background: t.bg,
            borderRadius: 999,
            padding: "2px 7px",
            fontSize: 10.5,
            fontWeight: 720,
            lineHeight: 1.4,
          }}
        >
          {project.priority}
        </span>
      </div>
      {reasons.length ? (
        <div style={{ display: "grid", gap: 5 }}>
          {reasons.map((reason, index) => (
            <div
              key={`${reason}-${index}`}
              style={{
                display: "grid",
                gridTemplateColumns: "10px minmax(0, 1fr)",
                gap: 6,
                alignItems: "start",
                fontSize: 11.5,
                color: C.ink3,
                lineHeight: 1.45,
              }}
            >
              <span style={{ color: t.color, fontWeight: 740 }}>-</span>
              <span style={{ overflowWrap: "anywhere" }}>{reason}</span>
            </div>
          ))}
        </div>
      ) : null}
      {evidence.length ? (
        <div
          style={{
            display: "grid",
            gap: 3,
            paddingTop: 2,
            borderTop: `1px solid ${C.divider}`,
          }}
        >
          {evidence.map((entry, index) => (
            <span
              key={`${entry.sourceId}-${index}`}
              style={{
                fontSize: 10.5,
                lineHeight: 1.45,
                color: C.muted,
                overflowWrap: "anywhere",
              }}
            >
              {entry.sourceId}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AiSuggestedActionCard({ actions, onCreateDraft }) {
  const action = actions?.[0];
  if (!action) return null;

  const [draftState, setDraftState] = React.useState("idle");
  const t = priorityTone(action.priority);
  const evidence = Array.isArray(action.evidence)
    ? action.evidence.slice(0, 2)
    : [];
  const draftBusy = draftState === "pending";
  const draftDone = draftState === "done";

  const createDraft = async () => {
    if (!onCreateDraft || draftBusy || draftDone) return;
    setDraftState("pending");
    try {
      await onCreateDraft(action);
      setDraftState("done");
    } catch {
      setDraftState("error");
    }
  };

  return (
    <div
      data-testid="ai-suggested-action-card"
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        background: C.card,
        padding: "10px 11px",
        display: "grid",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 8,
            background: t.bg,
            color: t.color,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 760,
          }}
        >
          !
        </span>
        <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 3 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 730,
              color: C.ink,
              lineHeight: 1.4,
              overflowWrap: "anywhere",
            }}
          >
            {action.title}
          </div>
          {action.projectName ? (
            <div
              style={{
                fontSize: 11,
                color: C.muted,
                lineHeight: 1.45,
                overflowWrap: "anywhere",
              }}
            >
              {action.projectName}
            </div>
          ) : null}
        </div>
      </div>
      {action.rationale ? (
        <div
          style={{
            fontSize: 11.5,
            lineHeight: 1.5,
            color: C.ink3,
            overflowWrap: "anywhere",
          }}
        >
          {action.rationale}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            color: t.color,
            background: t.bg,
            borderRadius: 999,
            padding: "2px 7px",
            fontSize: 10.5,
            fontWeight: 720,
            lineHeight: 1.4,
          }}
        >
          {action.priority}
        </span>
        {action.requiresHumanApproval ? (
          <span
            style={{
              color: C.muted,
              background: C.soft,
              borderRadius: 999,
              padding: "2px 7px",
              fontSize: 10.5,
              fontWeight: 650,
              lineHeight: 1.4,
            }}
          >
            Human approval required
          </span>
        ) : null}
      </div>
      {evidence.length ? (
        <div
          style={{
            display: "grid",
            gap: 3,
            paddingTop: 2,
            borderTop: `1px solid ${C.divider}`,
          }}
        >
          {evidence.map((entry, index) => (
            <span
              key={`${entry.sourceId}-${index}`}
              style={{
                fontSize: 10.5,
                lineHeight: 1.45,
                color: C.muted,
                overflowWrap: "anywhere",
              }}
            >
              {entry.sourceId}
            </span>
          ))}
        </div>
      ) : null}
      {onCreateDraft ? (
        <div style={{ display: "grid", gap: 6 }}>
          <button
            type="button"
            onClick={createDraft}
            disabled={draftBusy || draftDone}
            style={{
              height: 30,
              border: `1px solid ${draftDone ? C.border : t.solid}`,
              borderRadius: 9,
              background: draftDone ? C.soft : t.bg,
              color: draftDone ? C.muted : t.color,
              fontSize: 11.5,
              fontWeight: 720,
              cursor: draftBusy || draftDone ? "default" : "pointer",
            }}
          >
            {draftBusy
              ? "创建中..."
              : draftDone
                ? "待办草稿已创建"
                : "创建待办草稿"}
          </button>
          {draftState === "error" ? (
            <span style={{ color: C.danger, fontSize: 11 }}>
              待办草稿创建失败
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AiRunProgressPanel({ progress, onSubmitClarify }) {
  const activities = progress?.activities || [];
  const todos = progress?.todos || [];
  const subagents = progress?.subagents || [];
  const clarify = progress?.clarify;
  const visible =
    activities.length || todos.length || subagents.length || clarify;
  if (!visible) return null;
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div
        data-testid="ai-activity-panel"
        style={{
          maxWidth: "94%",
          width: "100%",
          background: "#fff",
          border: `1px solid ${C.border}`,
          borderRadius: "14px 14px 14px 4px",
          padding: "9px 10px",
          display: "grid",
          gap: 7,
          boxShadow: "0 1px 2px rgba(24,27,46,.05)",
        }}
      >
        {activities.map((item) => (
          <AiProgressRow
            key={item.id}
            item={item}
            icon={<Wrench size={13} aria-hidden="true" />}
            kind="tool"
          />
        ))}
        {todos.length ? (
          <div style={{ display: "grid", gap: 5 }}>
            {todos.map((item) => (
              <AiProgressRow
                key={item.id}
                item={item}
                icon={<ListChecks size={13} aria-hidden="true" />}
                testId="ai-todo-row"
              />
            ))}
          </div>
        ) : null}
        {subagents.length ? (
          <div style={{ display: "grid", gap: 5 }}>
            {subagents.map((item) => (
              <AiProgressRow
                key={item.id}
                item={item}
                icon={<Bot size={13} aria-hidden="true" />}
                testId="ai-subagent-row"
              />
            ))}
          </div>
        ) : null}
        {clarify ? (
          <AiClarifyPrompt clarify={clarify} onSubmit={onSubmitClarify} />
        ) : null}
      </div>
    </div>
  );
}

function AiProgressRow({ item, icon, kind, testId }) {
  const safeLabel = aiPublicText(item?.label, kind === "tool" ? "读取数据" : "处理中");
  const safeSource = aiPublicText(item?.source, "");
  const statusLabel = compactStatusLabel(kind, item.status);
  const statusTone =
    statusLabel === "成功" || statusLabel === "已完成"
      ? TONE.ok
      : statusLabel === "受限"
        ? TONE.warn
        : statusLabel === "失败"
          ? TONE.danger
          : TONE.info;
  const StatusIcon =
    statusLabel === "成功" || statusLabel === "已完成"
      ? CheckCircle2
      : statusLabel === "受限"
        ? Ban
        : statusLabel === "失败"
          ? AlertTriangle
          : CircleHelp;
  return (
    <div
      data-testid={testId}
      style={{
        display: "grid",
        gridTemplateColumns: "18px minmax(0,1fr) auto",
        alignItems: "center",
        gap: 7,
        minHeight: 24,
        color: C.ink3,
        fontSize: 11.5,
        lineHeight: 1.35,
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 6,
          background: C.soft,
          color: C.muted,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </span>
      <span
        style={{
          display: "flex",
          gap: 6,
          minWidth: 0,
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            fontWeight: 680,
            color: C.ink2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {safeLabel}
        </span>
        {safeSource ? (
          <span
            style={{
              color: C.muted,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {safeSource}
          </span>
        ) : null}
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          color: statusTone.color,
          background: statusTone.bg,
          borderRadius: 999,
          padding: "2px 6px",
          fontSize: 10.5,
          fontWeight: 720,
          lineHeight: 1.3,
        }}
      >
        <StatusIcon size={11} aria-hidden="true" />
        {statusLabel}
      </span>
    </div>
  );
}

function AiClarifyPrompt({ clarify, onSubmit }) {
  const [choice, setChoice] = React.useState("");
  const [text, setText] = React.useState("");
  const submitted = clarify.submitted === true;
  const trimmedText = text.trim();
  const validChoice = choice && clarify.choices?.includes(choice);
  const canSubmit =
    !submitted &&
    (Boolean(validChoice) ||
      (clarify.allowFreeText === true && Boolean(trimmedText)));

  React.useEffect(() => {
    setChoice("");
    setText("");
  }, [clarify.clarifyId]);

  return (
    <div
      style={{
        borderTop: `1px solid ${C.divider}`,
        paddingTop: 8,
        display: "grid",
        gap: 7,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 720, color: C.ink }}>
        {clarify.question}
      </div>
      {clarify.choices?.length ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {clarify.choices.map((item) => {
            const active = choice === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setChoice(item)}
                disabled={submitted}
                style={{
                  minHeight: 28,
                  border: `1px solid ${active ? C.primary : C.border}`,
                  borderRadius: 8,
                  background: active ? C.primarySoft : C.soft,
                  color: active ? C.primaryDeep : C.ink4,
                  padding: "4px 8px",
                  fontSize: 11.5,
                  fontWeight: 680,
                  cursor: submitted ? "default" : "pointer",
                }}
              >
                {item}
              </button>
            );
          })}
        </div>
      ) : null}
      {clarify.allowFreeText ? (
        <input
          aria-label="补充说明"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={submitted}
          placeholder="补充说明"
          style={{
            height: 30,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            background: submitted ? C.soft : "#fff",
            color: C.ink,
            padding: "0 9px",
            fontSize: 12,
            outline: "none",
          }}
        />
      ) : null}
      {clarify.error ? (
        <div
          data-testid="ai-clarify-error"
          style={{ fontSize: 11.5, color: C.danger, justifySelf: "end" }}
        >
          {clarify.error}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => onSubmit?.({ clarify, choice, text })}
        disabled={!canSubmit}
        style={{
          justifySelf: "end",
          height: 28,
          border: `1px solid ${canSubmit ? C.primary : C.border}`,
          borderRadius: 8,
          background: canSubmit ? C.primarySoft : C.soft,
          color: canSubmit ? C.primaryDeep : C.muted,
          padding: "0 10px",
          fontSize: 11.5,
          fontWeight: 720,
          cursor: canSubmit ? "pointer" : "default",
        }}
      >
        提交澄清
      </button>
    </div>
  );
}

function AiOutcomeNotice({ outcome }) {
  if (!outcome) return null;
  const isPartial = outcome.outcome === "partial";
  const title = isPartial ? "基于部分可用数据" : "关键数据不可用";
  const t = isPartial ? TONE.warn : TONE.danger;
  const Icon = isPartial ? AlertTriangle : Ban;
  return (
    <div
      style={{
        border: `1px solid ${t.solid}`,
        background: t.bg,
        color: t.color,
        borderRadius: 10,
        padding: "7px 8px",
        display: "grid",
        gap: 5,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11.5,
          fontWeight: 760,
        }}
      >
        <Icon size={13} aria-hidden="true" />
        {title}
      </div>
      {outcome.missing?.length ? (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {outcome.missing.map((item) => (
            <span
              key={item}
              style={{
                background: "rgba(255,255,255,.58)",
                border: "1px solid rgba(255,255,255,.62)",
                borderRadius: 999,
                padding: "2px 6px",
                fontSize: 10.5,
                fontWeight: 650,
              }}
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AiHeadingBlock({ heading }) {
  const Tag = heading.level <= 2 ? "h3" : "h4";
  return (
    <Tag
      style={{
        margin: 0,
        paddingTop: 2,
        fontSize: heading.level <= 2 ? 14 : 13,
        lineHeight: 1.45,
        fontWeight: 760,
        color: C.ink,
      }}
    >
      {heading.text}
    </Tag>
  );
}

function AiTextBlock({ text }) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {lines.map((line, index) => (
        <p
          key={`${line}-${index}`}
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.7,
            color: "#2a2f3a",
            overflowWrap: "anywhere",
          }}
        >
          {renderInlineMarkdown(line, `p-${index}`)}
        </p>
      ))}
    </div>
  );
}

function AiListBlock({ list }) {
  const Tag = list.ordered ? "ol" : "ul";
  return (
    <Tag
      style={{
        margin: 0,
        paddingLeft: list.ordered ? 20 : 18,
        display: "grid",
        gap: 5,
        color: "#2a2f3a",
      }}
    >
      {list.items.map((item, index) => (
        <li
          key={`${item}-${index}`}
          style={{
            fontSize: 12.5,
            lineHeight: 1.6,
            paddingLeft: 2,
            overflowWrap: "anywhere",
          }}
        >
          {renderInlineMarkdown(item, `li-${index}`)}
        </li>
      ))}
    </Tag>
  );
}

function AiMarkdownTable({ table }) {
  const headers = table.headers || [];
  const rows = table.rows || [];
  if (!headers.length || !rows.length) return null;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map((row, rowIndex) => {
        const title = row[0] || `#${rowIndex + 1}`;
        const details = headers
          .map((header, index) => ({
            header: header || `字段 ${index + 1}`,
            value: row[index] || "-",
          }))
          .filter((item, index) => index > 0 && item.value !== "-");

        return (
          <div
            key={`${title}-${rowIndex}`}
            data-testid="ai-markdown-table-row"
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 11,
              background: "#fafbff",
              padding: "9px 10px",
              display: "grid",
              gap: 7,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.72)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: C.primary,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 720,
                  color: C.ink,
                  minWidth: 0,
                  overflowWrap: "anywhere",
                }}
              >
                {title}
              </span>
            </div>
            <div style={{ display: "grid", gap: 5 }}>
              {details.map((item) => (
                <div
                  key={`${item.header}-${item.value}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "82px minmax(0, 1fr)",
                    gap: 8,
                    alignItems: "start",
                  }}
                >
                  <span
                    style={{
                      color: C.muted,
                      fontSize: 11,
                      lineHeight: 1.45,
                    }}
                  >
                    {item.header}
                  </span>
                  <span
                    style={{
                      color: C.ink3,
                      fontSize: 11.5,
                      lineHeight: 1.45,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function createEmptyAiRunProgress() {
  return {
    activities: [],
    todos: [],
    subagents: [],
    clarify: null,
  };
}

function upsertById(items, id, nextItem) {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return items.concat([nextItem]);
  const next = items.slice();
  next[index] = { ...items[index], ...nextItem };
  return next;
}

function compactStatusLabel(kind, status) {
  if (kind === "tool") {
    if (status === "completed" || status === "succeeded" || status === "success")
      return "成功";
    if (status === "denied" || status === "limited") return "受限";
    if (status === "failed" || status === "failure") return "失败";
  }
  if (status === "done" || status === "completed" || status === "succeeded")
    return "已完成";
  if (status === "blocked" || status === "limited") return "受限";
  if (status === "failed" || status === "failure") return "失败";
  if (status === "running") return "进行中";
  return "待处理";
}

function AiPanel({ user, projects, go, onTodoDraftCreated }) {
  const conversationStorageKey = aiConversationStorageKey(user);
  const [msgs, setMsgs] = React.useState([]);
  const [conversationId, setConversationId] = React.useState(() =>
    loadStoredConversationId(conversationStorageKey),
  );
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState("fast");
  const [runProgress, setRunProgress] = React.useState(() =>
    createEmptyAiRunProgress(),
  );
  const [attachments, setAttachments] = React.useState([]);
  const [attachmentError, setAttachmentError] = React.useState("");
  const [conversations, setConversations] = React.useState([]);
  const [conversationSwitching, setConversationSwitching] =
    React.useState(false);
  const name =
    (user?.name && user.name !== "未登录用户" ? user.name : null) ||
    "经营舱用户";
  const bodyRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const conversationIdRef = React.useRef(conversationId);
  const conversationInitRef = React.useRef(null);
  const conversationCreateRef = React.useRef(null);
  const panelMountedRef = React.useRef(true);
  const activeRunRef = React.useRef(null);
  const runProgressRef = React.useRef(runProgress);
  React.useEffect(() => {
    if (bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, busy]);
  React.useEffect(() => {
    conversationIdRef.current = conversationId;
    saveStoredConversationId(conversationStorageKey, conversationId);
  }, [conversationId, conversationStorageKey]);
  React.useEffect(() => {
    runProgressRef.current = runProgress;
  }, [runProgress]);
  React.useEffect(() => {
    panelMountedRef.current = true;
    if (!conversationInitRef.current) {
      conversationInitRef.current = restoreServerConversation();
    }
    void conversationInitRef.current.then(() => refreshConversations());
    return () => {
      panelMountedRef.current = false;
    };
  }, [conversationStorageKey]);

  const push = (role, text, meta, fields) =>
    setMsgs((m) =>
      m.concat([
        {
          role,
          text,
          ...(meta ? { meta } : {}),
          ...(fields || {}),
        },
      ]),
    );
  async function restoreServerConversation() {
    const clearActiveConversation = () => {
      conversationIdRef.current = "";
      if (panelMountedRef.current) {
        setConversationId("");
        setMsgs([]);
      }
      saveStoredConversationId(conversationStorageKey, "");
    };
    try {
      let activeId = conversationIdRef.current;
      if (!activeId) {
        const listResponse = await fetch("/api/ai/conversations", {
          cache: "no-store",
        });
        const listPayload = await listResponse.json().catch(() => ({}));
        activeId = Array.isArray(listPayload?.conversations)
          ? listPayload.conversations.find(
              (conversation) => typeof conversation?.id === "string",
            )?.id || ""
          : "";
      }
      if (!activeId) return null;

      const historyResponse = await fetch(
        `/api/ai/conversations/${encodeURIComponent(activeId)}`,
        { cache: "no-store" },
      );
      const history = await historyResponse.json().catch(() => ({}));
      if (!historyResponse.ok) {
        if ([404, 410].includes(historyResponse.status)) {
          clearActiveConversation();
          return null;
        }
        throw new Error(history?.error || "无法恢复 AI 会话");
      }
      if (history?.conversation?.id !== activeId) {
        clearActiveConversation();
        return null;
      }

      conversationIdRef.current = activeId;
      if (panelMountedRef.current) {
        setConversationId(activeId);
        setMsgs(normalizeConversationHistory(history));
        const pendingClarify = normalizePendingClarify(history);
        setRunProgress({
          ...createEmptyAiRunProgress(),
          clarify: pendingClarify,
        });
      }
      saveStoredConversationId(conversationStorageKey, activeId);
      return activeId;
    } catch {
      // A transient restore failure is surfaced on the next user action.
      return null;
    }
  }

  async function refreshConversations() {
    try {
      const response = await fetch("/api/ai/conversations", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload?.conversations)) return;
      if (panelMountedRef.current) {
        setConversations(
          payload.conversations.filter(
            (conversation) => typeof conversation?.id === "string",
          ),
        );
      }
    } catch {
      // 列表刷新失败不阻断会话本身，下一次动作会重新拉取。
    }
  }

  async function switchConversation(nextId) {
    if (busy || conversationSwitching) return;
    if (!nextId || nextId === conversationIdRef.current) return;
    setConversationSwitching(true);
    try {
      conversationIdRef.current = nextId;
      if (panelMountedRef.current) {
        setConversationId(nextId);
        setMsgs([]);
        setRunProgress(createEmptyAiRunProgress());
        setAttachments([]);
        setAttachmentError("");
      }
      saveStoredConversationId(conversationStorageKey, nextId);
      await restoreServerConversation();
    } finally {
      if (panelMountedRef.current) setConversationSwitching(false);
    }
  }

  async function startNewConversation() {
    if (busy || conversationSwitching) return;
    if (conversationIdRef.current && msgs.length === 0) return;
    setConversationSwitching(true);
    try {
      const response = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "新会话" }),
      });
      const payload = await response.json().catch(() => ({}));
      const nextId =
        typeof payload?.conversation?.id === "string"
          ? payload.conversation.id
          : "";
      if (!nextId) {
        throw new Error(payload?.error || "无法创建新会话，请稍后重试");
      }
      conversationIdRef.current = nextId;
      if (panelMountedRef.current) {
        setConversationId(nextId);
        setMsgs([]);
        setRunProgress(createEmptyAiRunProgress());
        setAttachments([]);
        setAttachmentError("");
      }
      saveStoredConversationId(conversationStorageKey, nextId);
      await refreshConversations();
    } catch (error) {
      if (panelMountedRef.current) {
        push("ai", `⚠ ${error?.message || "无法创建新会话"}`);
      }
    } finally {
      if (panelMountedRef.current) setConversationSwitching(false);
    }
  }

  async function ensureServerConversation(title) {
    if (conversationInitRef.current) {
      await conversationInitRef.current;
      if (conversationIdRef.current) return conversationIdRef.current;
    }
    if (conversationIdRef.current) return conversationIdRef.current;
    if (conversationCreateRef.current) return conversationCreateRef.current;

    conversationCreateRef.current = (async () => {
      const response = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: String(title || "新会话").slice(0, 40) }),
      });
      const payload = await response.json().catch(() => ({}));
      const nextId =
        typeof payload?.conversation?.id === "string"
          ? payload.conversation.id
          : "";
      if (!nextId) {
        throw new Error(payload?.error || "星耀 AI 会话协议不可用，请稍后重试");
      }

      conversationIdRef.current = nextId;
      if (panelMountedRef.current) {
        setMsgs([]);
        setConversationId(nextId);
      }
      saveStoredConversationId(conversationStorageKey, nextId);
      return nextId;
    })();

    try {
      return await conversationCreateRef.current;
    } finally {
      conversationCreateRef.current = null;
    }
  }

  async function consumeConversationStream(
    res,
    {
      userMessageClientId,
      replaceMessageId,
      onTurnStarted,
      onAssistantMessageId,
    } = {},
  ) {
    if (!res.body) throw new Error("AI 会话流不可用");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamedText = "";
    let activeTurnId = "";
    let activeAssistantMessageId = "";
    let sawTerminalEvent = false;
    let failed = false;

    const upsertAiMessage = (message) => {
      setMsgs((current) => {
        const index = current.findIndex(
          (item) =>
            (message.id && item.id === message.id) ||
            (replaceMessageId && item.id === replaceMessageId),
        );
        if (index < 0) return current.concat([message]);
        const next = current.slice();
        next[index] = { ...current[index], ...message };
        return next;
      });
    };

    let processParts = [];
    // runProgress 走 React 状态，同一批事件内 ref 尚未刷新，
    // 快照活动需在消费器内本地累积。
    let capturedActivities = [];
    let capturedSubagents = [];
    const captureThinkingSegment = () => {
      if (!streamedText.trim() || !activeAssistantMessageId) return;
      processParts.push(streamedText);
      streamedText = "";
      upsertAiMessage({
        id: activeAssistantMessageId,
        role: "ai",
        text: "",
        process: processParts.slice(),
        status: "streaming",
        turnId: activeTurnId,
      });
    };

    const handleEvent = (eventName, payload) => {
      if (eventName === "turn.started") {
        activeTurnId =
          typeof payload?.turnId === "string" ? payload.turnId : activeTurnId;
        activeAssistantMessageId =
          typeof payload?.assistantMessageId === "string"
            ? payload.assistantMessageId
            : activeAssistantMessageId;
        onTurnStarted?.({
          turnId: activeTurnId,
          userMessageId: payload.userMessageId,
          assistantMessageId: activeAssistantMessageId,
        });
        if (activeRunRef.current) {
          activeRunRef.current.turnId = activeTurnId;
          activeRunRef.current.assistantMessageId = activeAssistantMessageId;
          if (activeRunRef.current.stopQueued) void stopActiveRun();
        }
        onAssistantMessageId?.(activeAssistantMessageId);
        if (userMessageClientId && payload?.userMessageId) {
          setMsgs((current) =>
            current.map((message) =>
              message.id === userMessageClientId
                ? {
                    ...message,
                    id: payload.userMessageId,
                    turnId: activeTurnId,
                  }
                : message,
            ),
          );
        }
        return;
      }
      if (eventName === "activity.updated") {
        captureThinkingSegment();
        const id = `activity:${payload?.label || "activity"}`;
        const activityItem = {
          id,
          label: String(payload?.label || "处理中").slice(0, 80),
          status: payload?.status || "running",
          source: "",
          kind: "activity",
        };
        capturedActivities = upsertById(capturedActivities, id, activityItem);
        setRunProgress((current) => ({
          ...current,
          activities: upsertById(current.activities, id, activityItem),
        }));
        return;
      }
      if (eventName === "tool.started" || eventName === "tool.completed") {
        captureThinkingSegment();
        const id = payload?.toolCallId || payload?.toolName || payload?.label;
        if (!id) return;
        const source = [
          ...(Array.isArray(payload?.evidence) ? payload.evidence : []),
          ...(Array.isArray(payload?.missing) ? payload.missing : []),
        ]
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)[0];
        const toolItem = {
          id,
          label: String(payload?.label || payload?.toolName || "读取数据").slice(
            0,
            80,
          ),
          status:
            eventName === "tool.started"
              ? "running"
              : payload?.status || "completed",
          source: source ? source.slice(0, 120) : "",
          kind: "tool",
        };
        capturedActivities = upsertById(capturedActivities, id, toolItem);
        setRunProgress((current) => ({
          ...current,
          activities: upsertById(current.activities, id, toolItem),
        }));
        return;
      }
      if (eventName === "todo.updated") {
        captureThinkingSegment();
        setRunProgress((current) => ({
          ...current,
          todos: Array.isArray(payload?.items)
            ? payload.items
                .map((item) => ({
                  id: item.id,
                  label: String(item.label || "").slice(0, 120),
                  status: item.status,
                }))
                .filter((item) => item.id && item.label)
                .slice(0, 5)
            : current.todos,
        }));
        return;
      }
      if (eventName === "subagent.updated") {
        captureThinkingSegment();
        const id = payload?.subagentId;
        if (!id) return;
        const subagentItem = {
          id,
          label: String(payload?.label || "只读子任务").slice(0, 120),
          status: payload?.status || "running",
        };
        capturedSubagents = upsertById(
          capturedSubagents,
          id,
          subagentItem,
        ).slice(0, 5);
        setRunProgress((current) => ({
          ...current,
          subagents: upsertById(current.subagents, id, subagentItem).slice(0, 5),
        }));
        return;
      }
      if (eventName === "clarify.requested") {
        setRunProgress((current) => ({
          ...current,
          clarify: {
            clarifyId: payload.clarifyId,
            turnId: payload.turnId || activeTurnId,
            question: aiPublicText(payload.question, "需要进一步确认"),
            choices: aiPublicList(payload.choices).slice(0, 6),
            allowFreeText: payload.allowFreeText === true,
            submitted: false,
          },
        }));
        return;
      }
      if (eventName === "response.delta") {
        const delta = typeof payload?.delta === "string" ? payload.delta : "";
        if (!delta) return;
        if (AI_UI_INTERNAL_TEXT.test(delta)) return;
        streamedText += delta;
        activeTurnId = payload?.turnId || activeTurnId;
        activeAssistantMessageId =
          payload?.messageId || activeAssistantMessageId;
        onAssistantMessageId?.(activeAssistantMessageId);
        upsertAiMessage({
          id: activeAssistantMessageId,
          role: "ai",
          text: aiPublicContent(streamedText, AI_UI_SAFE_FAILURE_TEXT),
          process: processParts.slice(),
          status: "streaming",
          turnId: activeTurnId,
        });
        return;
      }
      if (eventName === "response.completed") {
        sawTerminalEvent = true;
        activeTurnId = payload?.turnId || activeTurnId;
        activeAssistantMessageId =
          payload?.messageId || activeAssistantMessageId;
        onAssistantMessageId?.(activeAssistantMessageId);
        const completedMeta = normalizeAiMessageMeta(payload?.meta || payload);
        const fullStreamed = processParts.join("") + streamedText;
        const serverContent =
          typeof payload?.content === "string" ? payload.content : "";
        let bodyText;
        if (processParts.length) {
          // 已出现思考分段（工具/活动切割过）时，terminal 终稿若与流式
          // 内容不同则以终稿为正文，把残余尾巴并入思考过程；否则最后
          // 一段 delta 即正文。无分段时保持原契约：终稿替换流式内容。
          bodyText = streamedText;
          if (
            serverContent &&
            serverContent !== fullStreamed &&
            serverContent !== streamedText
          ) {
            if (streamedText.trim()) processParts.push(streamedText);
            bodyText = serverContent;
          } else if (!bodyText) {
            bodyText = serverContent || processParts.pop();
          }
        } else {
          bodyText = serverContent || streamedText;
        }
        const processActivities = capturedActivities
          .slice(0, 12)
          .map((item) => ({ ...item }));
        const processSubagents = capturedSubagents
          .slice(0, 5)
          .map((item) => ({ ...item }));
        upsertAiMessage({
          id: activeAssistantMessageId,
          role: "ai",
          text: aiPublicContent(bodyText, AI_UI_SAFE_FAILURE_TEXT),
          process: processParts.slice(),
          processActivities,
          processSubagents,
          status: "completed",
          turnId: activeTurnId,
          retryable: false,
          ...(completedMeta ? { meta: completedMeta } : {}),
        });
        if (processActivities.length || processSubagents.length) {
          setRunProgress((current) => ({
            ...current,
            activities: [],
            subagents: [],
          }));
        }
        return;
      }
      if (eventName === "response.cancelled") {
        sawTerminalEvent = true;
        activeTurnId = payload?.turnId || activeTurnId;
        activeAssistantMessageId =
          payload?.messageId || activeAssistantMessageId;
        upsertAiMessage({
          id:
            activeAssistantMessageId ||
            replaceMessageId ||
            createAiClientRequestId("assistant"),
          role: "ai",
          text: "已停止生成",
          status: "cancelled",
          turnId: activeTurnId,
          retryable: false,
        });
        return;
      }
      if (eventName === "response.failed") {
        sawTerminalEvent = true;
        failed = true;
        activeTurnId = payload?.turnId || activeTurnId;
        const message = AI_UI_SAFE_FAILURE_TEXT;
        upsertAiMessage({
          id:
            activeAssistantMessageId ||
            replaceMessageId ||
            createAiClientRequestId("assistant"),
          role: "ai",
          text: streamedText ? `${streamedText}\n\n${message}` : message,
          status: "failed",
          turnId: activeTurnId,
          retryable: payload?.retryable === true,
        });
      }
    };

    const flushEventBlock = (block) => {
      let eventName = "message";
      const dataLines = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) return;
      try {
        const payload = JSON.parse(dataLines.join("\n"));
        if (payload?.type === eventName && isConversationStreamEvent(payload)) {
          handleEvent(eventName, payload);
        }
      } catch {
        // Ignore malformed non-terminal events; missing terminal is handled below.
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separator = buffer.match(/\r?\n\r?\n/);
        while (separator?.index != null) {
          const block = buffer.slice(0, separator.index);
          buffer = buffer.slice(separator.index + separator[0].length);
          if (block.trim()) flushEventBlock(block);
          separator = buffer.match(/\r?\n\r?\n/);
        }
      }
      if (buffer.trim()) flushEventBlock(buffer);
    } catch (error) {
      reader.cancel?.().catch?.(() => {});
      if (sawTerminalEvent) return { failed, turnId: activeTurnId };
      throw error;
    }

    if (!sawTerminalEvent) {
      throw new Error("AI 会话连接提前结束");
    }
    return { failed, turnId: activeTurnId };
  }

  async function sendConversationTurn({
    activeConversationId,
    userText,
    requestMode,
    requestAttachments,
    userMessageClientId,
    onTurnStarted,
    onAssistantMessageId,
    signal,
  }) {
    const res = await fetch(
      `/api/ai/conversations/${encodeURIComponent(activeConversationId)}/turns`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          content: userText,
          mode: requestMode,
          attachments: requestAttachments,
          clientRequestId: createAiClientRequestId("turn"),
        }),
        signal,
      },
    );
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload?.error || "AI 会话调用失败");
    }
    const contentType = res.headers?.get?.("content-type") || "";
    if (!res.body || !contentType.includes("text/event-stream")) {
      throw new Error("AI 会话未返回有效的流式响应");
    }
    return consumeConversationStream(res, {
      userMessageClientId,
      onTurnStarted,
      onAssistantMessageId,
    });
  }

  async function run(kind, userText, options = {}) {
    if (busy) return;
    const requestMode = options.mode || mode;
    const requestAttachments = options.attachments || [];
    const userMessageClientId = createAiClientRequestId("user");
    const askRunControl =
      kind === "ask"
        ? {
            controller: new AbortController(),
            conversationId: "",
            turnId: "",
            assistantMessageId: "",
            cancelRequested: false,
            stopQueued: false,
            canceling: false,
            localAbort: false,
          }
        : null;
    let acceptedTurn = null;
    let userMessagePushed = false;
    const pushUserMessage = () => {
      if (userMessagePushed) return;
      push(
        "user",
        userText,
        requestAttachments.length
          ? {
              attachmentNames: requestAttachments.map(
                (attachment) => attachment.name,
              ),
            }
          : undefined,
        { id: userMessageClientId, status: "completed" },
      );
      userMessagePushed = true;
    };
    setBusy(true);
    setRunProgress(createEmptyAiRunProgress());
    if (askRunControl) activeRunRef.current = askRunControl;
    try {
      let text = "";
      let meta;
      const activeConversationId =
        kind === "ask" ? await ensureServerConversation(userText) : null;
      if (askRunControl) askRunControl.conversationId = activeConversationId || "";
      pushUserMessage();
      if (kind === "match") {
        const res = await fetch("/api/marketplace/intel", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "撮合情报获取失败");
        const recos = (json?.matches?.recommendations || []).slice(0, 3);
        text = recos.length
          ? "为当前供需匹配出以下高契合机会：\n" +
            recos
              .map((r) => `· ${r.title}（${(r.reasons || []).join("、")}）`)
              .join("\n")
          : "当前暂无可撮合的高契合机会，待有新发单/接单意向后会自动出现。";
      } else if (kind === "ask") {
        await sendConversationTurn({
          activeConversationId,
          userText,
          requestMode,
          requestAttachments,
          userMessageClientId,
          signal: askRunControl.controller.signal,
          onTurnStarted: (turn) => {
            acceptedTurn = turn;
          },
        });
        setAttachments([]);
        setAttachmentError("");
        return;
      } else if (kind === "business") {
        const res = await fetch("/api/ai/business-copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: userText }),
        });
        const json = await res.json();
        const answer = businessCopilotPayload(json);
        meta = normalizeAiMessageMeta(answer);
        if (!res.ok) throw new Error(json?.error || "经营问答调用失败");
        text = formatBusinessCopilotText(json);
      } else {
        // review / risk → 真实经营诊断代理（只传 projectId，明细由服务端取数）
        const projectId = (projects || [])[0]?.id;
        if (!projectId) {
          text = "当前范围内暂无可诊断的项目，请先创建项目或调整周期后再试。";
        } else {
          const res = await fetch("/api/ai/project-reviews", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json?.error || "AI 诊断调用失败");
          text = extractAiText(json);
        }
      }
      if (kind === "ask") {
        setAttachments([]);
        setAttachmentError("");
      }
      push("ai", text, meta);
    } catch (e) {
      if (kind === "ask" && activeRunRef.current?.localAbort) {
        return;
      }
      const errorMessage =
        kind === "ask"
          ? aiPublicText(e instanceof Error ? e.message : "", AI_UI_SAFE_FAILURE_TEXT)
          : e instanceof Error
            ? e.message
            : "调用失败，请稍后重试";
      if (kind === "ask") {
        setMsgs((current) => {
          const next = acceptedTurn
            ? current.slice()
            : current.filter((message) => message.id !== userMessageClientId);
          if (!acceptedTurn) {
            return next.concat([{ role: "ai", text: `⚠ ${errorMessage}` }]);
          }

          const assistantId = acceptedTurn.assistantMessageId;
          const index = next.findIndex((message) => message.id === assistantId);
          const failedMessage = {
            id: assistantId,
            role: "ai",
            status: "failed",
            retryable: false,
            turnId: acceptedTurn.turnId,
            text: `⚠ ${errorMessage}，请刷新以恢复服务端会话状态`,
          };
          if (index < 0) return next.concat([failedMessage]);
          next[index] = {
            ...next[index],
            ...failedMessage,
            text: next[index].text
              ? `${next[index].text}\n\n⚠ 回复中断：${errorMessage}`
              : failedMessage.text,
          };
          return next;
        });
      } else {
        pushUserMessage();
        push("ai", `⚠ ${errorMessage}`);
      }
    } finally {
      if (!activeRunRef.current?.localAbort) setBusy(false);
      activeRunRef.current = null;
      void refreshConversations();
    }
  }

  async function stopActiveRun() {
    const active = activeRunRef.current;
    if (!active || active.cancelRequested || active.canceling) return;
    if (!active.turnId) {
      active.stopQueued = true;
      return;
    }
    active.canceling = true;
    try {
      const response = await fetch(
        `/api/ai/conversations/${encodeURIComponent(
          active.conversationId,
        )}/turns/${encodeURIComponent(active.turnId)}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientRequestId: createAiClientRequestId("cancel"),
          }),
        },
      );
      if (!response.ok) {
        active.localAbort = true;
        active.controller?.abort?.();
        upsertStopResult(active, {
          text: AI_UI_STOP_UNCONFIRMED_TEXT,
          status: "failed",
          retryable: false,
        });
        setBusy(false);
        return;
      }
      active.cancelRequested = true;
      active.localAbort = true;
      active.controller?.abort?.();
      upsertStopResult(active, {
        text: "已停止生成",
        status: "cancelled",
        retryable: false,
      });
      setBusy(false);
    } catch {
      active.localAbort = true;
      active.controller?.abort?.();
      upsertStopResult(active, {
        text: AI_UI_STOP_UNCONFIRMED_TEXT,
        status: "failed",
        retryable: false,
      });
      setBusy(false);
    } finally {
      active.canceling = false;
    }
  }

  function upsertStopResult(active, patch) {
    const assistantId =
      active.assistantMessageId || createAiClientRequestId("assistant");
    setMsgs((current) => {
      if (current.some((message) => message.id === assistantId)) {
        return current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                role: "ai",
                text: patch.text,
                status: patch.status,
                retryable: patch.retryable,
                turnId: active.turnId,
              }
            : message,
        );
      }
      return current.concat([
        {
          id: assistantId,
          role: "ai",
          text: patch.text,
          status: patch.status,
          retryable: patch.retryable,
          turnId: active.turnId,
        },
      ]);
    });
  }

  async function submitClarifyResponse({ clarify, choice, text }) {
    const currentClarify = runProgressRef.current?.clarify;
    if (
      !conversationIdRef.current ||
      !clarify?.turnId ||
      clarify.submitted ||
      !currentClarify ||
      currentClarify.clarifyId !== clarify.clarifyId ||
      currentClarify.turnId !== clarify.turnId
    ) {
      return;
    }
    const selectedChoice = typeof choice === "string" ? choice.trim() : "";
    const freeText = typeof text === "string" ? text.trim() : "";
    if (
      selectedChoice &&
      !currentClarify.choices?.includes(selectedChoice)
    ) {
      return;
    }
    if (freeText && currentClarify.allowFreeText !== true) return;
    const answer = [selectedChoice, freeText].filter(Boolean).join("\n").trim();
    if (!answer) return;
    const response = await fetch(
      `/api/ai/conversations/${encodeURIComponent(
        conversationIdRef.current,
      )}/turns/${encodeURIComponent(clarify.turnId)}/clarify`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clarifyId: clarify.clarifyId,
          answer,
          choice: selectedChoice || null,
          text: freeText || "",
          clientRequestId: createAiClientRequestId("clarify"),
        }),
      },
    );
    if (!response.ok) {
      setRunProgress((current) => ({
        ...current,
        clarify:
          current.clarify?.clarifyId === clarify.clarifyId &&
          current.clarify?.turnId === clarify.turnId
            ? {
                ...current.clarify,
                submitted: false,
                error: AI_UI_CLARIFY_FAILED_TEXT,
              }
            : current.clarify,
      }));
      return;
    }
    setRunProgress((current) => ({
      ...current,
      clarify: current.clarify
        ? { ...current.clarify, submitted: true, error: "" }
        : current.clarify,
    }));
  }

  async function replayConversationMessage(message, action) {
    if (busy || !message?.turnId) return;
    setBusy(true);
    setMsgs((current) =>
      current.map((item) =>
        item.id === message.id ? { ...item, status: "retrying" } : item,
      ),
    );
    let replacementMessageId = message.id;
    let replacementTurnId = message.turnId;
    try {
      const endpoint =
        action === "regenerate"
          ? `/api/ai/turns/${encodeURIComponent(message.turnId)}/regenerate`
          : `/api/ai/turns/${encodeURIComponent(message.turnId)}/retry`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          clientRequestId: createAiClientRequestId(action),
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          aiPublicText(payload?.error, AI_UI_SAFE_FAILURE_TEXT),
        );
      }
      const contentType = res.headers?.get?.("content-type") || "";
      if (!res.body || !contentType.includes("text/event-stream")) {
        throw new Error("AI 会话恢复未返回有效的流式响应");
      }
      await consumeConversationStream(res, {
        replaceMessageId: message.id,
        onTurnStarted: (turn) => {
          replacementMessageId = turn.assistantMessageId;
          replacementTurnId = turn.turnId;
        },
        onAssistantMessageId: (messageId) => {
          replacementMessageId = messageId || replacementMessageId;
        },
      });
    } catch (error) {
      const safeReplayError = aiPublicText(
        error instanceof Error ? error.message : "",
        AI_UI_SAFE_FAILURE_TEXT,
      );
      setMsgs((current) =>
        current.map((item) =>
          item.id === message.id || item.id === replacementMessageId
            ? {
                ...item,
                status: "failed",
                retryable: true,
                turnId: replacementTurnId,
                text: item.text
                  ? `${item.text}\n\n⚠ 回复中断：${safeReplayError}`
                  : `⚠ ${safeReplayError}`,
              }
            : item,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function createSuggestedActionDraft(action) {
    const res = await fetch("/api/ai/drafts/suggested-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = await res.json();
    if (!res.ok)
      throw new Error(json?.error || "Failed to create AI todo draft");
    if (json?.todo) onTodoDraftCreated?.(json.todo);
    return json?.todo;
  }

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    const selectedAttachments = attachments;
    setDraft("");
    run("ask", t, { mode, attachments: selectedAttachments });
  };

  const handleAttachmentChange = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    if (attachments.length + files.length > AI_CHAT_ATTACHMENT_LIMIT) {
      setAttachmentError(`最多支持 ${AI_CHAT_ATTACHMENT_LIMIT} 个附件`);
      return;
    }

    try {
      setAttachmentError("");
      const nextAttachments = await Promise.all(files.map(fileToAiAttachment));
      setAttachments((current) =>
        current.concat(nextAttachments).slice(0, AI_CHAT_ATTACHMENT_LIMIT),
      );
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "附件读取失败，请重新选择",
      );
    }
  };
  const quick = (icon, bg, stroke, title, sub, onClick) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        width: "100%",
        textAlign: "left",
        background: "#fff",
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: "11px 12px",
        cursor: busy ? "default" : "pointer",
        boxShadow: "0 1px 2px rgba(24,27,46,.03)",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: bg,
        }}
      >
        {icon}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 12.5,
            fontWeight: 650,
            color: C.ink,
          }}
        >
          {title}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 11,
            color: C.muted,
            marginTop: 1,
          }}
        >
          {sub}
        </span>
      </span>
    </button>
  );

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "linear-gradient(180deg,#fcfcfe,#f3f4f9)",
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        overflow: "hidden",
        boxShadow:
          "0 1px 2px rgba(24,27,46,.04),0 12px 32px -20px rgba(24,27,46,.2)",
      }}
    >
      {/* 顶栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "13px 15px",
          borderBottom: `1px solid ${C.divider}`,
          background: "rgba(255,255,255,.55)",
        }}
      >
        <span
          style={{
            display: "flex",
            width: 22,
            height: 22,
            borderRadius: 7,
            background: "linear-gradient(140deg,#5566e6,#8a72ee)",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 6px rgba(85,102,230,.4)",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 100 100" fill="#fff">
            <path d="M50 6C54 30 70 46 94 50 70 54 54 70 50 94 46 70 30 54 6 50 30 46 46 30 50 6Z" />
          </svg>
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>
          星耀 AI 助手
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: C.primaryDeep,
            background: C.primarySoft,
            borderRadius: 6,
            padding: "2px 6px",
          }}
        >
          Beta
        </span>
      </div>
      {/* 会话切换条 */}
      <div
        aria-label="AI 会话列表"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "9px 12px 0",
          background: "rgba(255,255,255,.55)",
        }}
      >
        <button
          type="button"
          aria-label="新建会话"
          onClick={() => void startNewConversation()}
          disabled={busy || conversationSwitching}
          style={{
            flexShrink: 0,
            border: `1px solid ${C.border}`,
            borderRadius: 9,
            background: "#fff",
            color: C.primaryDeep,
            fontSize: 12,
            fontWeight: 700,
            padding: "5px 10px",
            cursor: busy || conversationSwitching ? "default" : "pointer",
          }}
        >
          ＋ 新会话
        </button>
        <div
          className="scl"
          role="tablist"
          aria-label="历史会话"
          style={{
            display: "flex",
            gap: 6,
            overflowX: "auto",
            flex: 1,
            minWidth: 0,
            paddingBottom: 2,
          }}
        >
          {conversations.map((conversation) => {
            const active = conversation.id === conversationId;
            const label = String(conversation.title || "新会话");
            return (
              <button
                key={conversation.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={label}
                onClick={() => void switchConversation(conversation.id)}
                disabled={busy || conversationSwitching}
                style={{
                  flexShrink: 0,
                  maxWidth: 128,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  border: `1px solid ${active ? C.primary : C.border}`,
                  borderRadius: 9,
                  background: active ? C.primarySoft : "#fff",
                  color: active ? C.primaryDeep : C.muted,
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: "5px 9px",
                  cursor: busy || conversationSwitching ? "default" : "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div
        aria-label="AI 回复模式"
        role="group"
        style={{
          display: "flex",
          gap: 6,
          padding: "9px 12px 0",
          background: "rgba(255,255,255,.55)",
        }}
      >
        {[
          ["fast", "快速"],
          ["deep", "深度思考"],
        ].map(([itemMode, label]) => {
          const active = mode === itemMode;
          return (
            <button
              key={itemMode}
              type="button"
              onClick={() => setMode(itemMode)}
              disabled={busy}
              style={{
                flex: 1,
                border: `1px solid ${active ? C.primary : C.border}`,
                borderRadius: 9,
                background: active ? C.primarySoft : "#fff",
                color: active ? C.primaryDeep : C.muted,
                fontSize: 12,
                fontWeight: 700,
                padding: "6px 8px",
                cursor: busy ? "default" : "pointer",
                boxShadow: active
                  ? "inset 0 0 0 1px rgba(85,102,230,.08)"
                  : "none",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      {/* 对话区 */}
      <div
        ref={bodyRef}
        className="scl"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "18px 15px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          minHeight: 0,
        }}
      >
        {msgs.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              padding: "18px 4px 4px",
            }}
          >
            <div
              style={{
                position: "relative",
                width: 74,
                height: 74,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle,rgba(138,114,238,.28),transparent 68%)",
                }}
              />
              <svg
                width="54"
                height="54"
                viewBox="0 0 100 100"
                style={{ position: "relative" }}
              >
                <defs>
                  <linearGradient id="aiStar" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#8b9cf0" />
                    <stop offset=".52" stopColor="#a98ad8" />
                    <stop offset="1" stopColor="#e7b491" />
                  </linearGradient>
                </defs>
                <path
                  d="M50 3C55 31 69 45 97 50 69 55 55 69 50 97 45 69 31 55 3 50 31 45 45 31 50 3Z"
                  fill="url(#aiStar)"
                />
              </svg>
            </div>
            <div
              style={{
                fontSize: 19,
                fontWeight: 730,
                marginTop: 16,
                letterSpacing: "-.2px",
                color: C.ink,
              }}
            >
              你好，{name} 👋
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: C.muted,
                marginTop: 7,
                lineHeight: 1.5,
              }}
            >
              需要我帮你分析经营数据
              <br />
              或处理待办事项吗？
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 9,
                width: "100%",
                marginTop: 22,
              }}
            >
              {quick(
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={C.primaryDeep}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 19V5" />
                  <path d="M4 19h16" />
                  <path d="m8 15 3-4 3 2 4-6" />
                </svg>,
                C.primarySoft,
                C.primaryDeep,
                "问经营数据",
                "只读回答健康、优先级与结算风险",
                () => run("business", "这个月经营健康吗"),
              )}
              {quick(
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#4453d4"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 3v18h18" />
                  <path d="m7 14 4-4 3 3 5-6" />
                </svg>,
                "linear-gradient(145deg,#e7e9fc,#dadef9)",
                "#4453d4",
                "生成复盘报告",
                "汇总本月经营与低毛利项目",
                () =>
                  run(
                    "ask",
                    "帮我生成本月经营复盘报告，并结合知识库沉淀可复用经验",
                  ),
              )}
              {quick(
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#1f9d55"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="3.4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.5a4 4 0 0 1 0 7" />
                </svg>,
                "linear-gradient(145deg,#e2f3e9,#d3eedd)",
                "#1f9d55",
                "智能撮合推荐",
                "为招募项目匹配主播",
                () => run("match", "为当前招募中的项目推荐匹配主播"),
              )}
              {quick(
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#b5790a"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />
                </svg>,
                "linear-gradient(145deg,#fbeccb,#f7e1ac)",
                "#b5790a",
                "解读风险事项",
                "分析风险并给出处理优先级",
                () => run("risk", "解读当前风险事项并按优先级给出处理建议"),
              )}
            </div>
          </div>
        ) : null}
        {msgs.map((m, i) => (
          <div
            key={m.id || i}
            style={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={
                m.role === "user"
                  ? {
                      maxWidth: "84%",
                      background: "linear-gradient(135deg,#5566e6,#7160e6)",
                      color: "#fff",
                      borderRadius: "14px 14px 4px 14px",
                      padding: "9px 12px",
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      boxShadow: "0 2px 7px rgba(85,102,230,.26)",
                    }
                  : {
                      maxWidth: "94%",
                      background: "#fff",
                      color: "#2a2f3a",
                      border: `1px solid ${C.border}`,
                      borderRadius: "14px 14px 14px 4px",
                      padding: "9px 12px",
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      whiteSpace: "normal",
                      boxShadow: "0 1px 2px rgba(24,27,46,.05)",
                    }
              }
            >
              {m.role === "ai" ? (
                <div style={{ display: "grid", gap: 9 }}>
                  <AiOutcomeNotice outcome={m.meta?.outcome} />
                  {m.process?.length ||
                  m.processActivities?.length ||
                  m.processSubagents?.length ? (
                    <div
                      data-testid="ai-thinking-quote"
                      style={{
                        borderLeft: `3px solid ${C.primary}`,
                        background: C.soft,
                        borderRadius: "4px 10px 10px 4px",
                        padding: "8px 10px",
                        display: "grid",
                        gap: 7,
                      }}
                    >
                      {(m.process || []).map((segment, segmentIndex) => (
                        <div
                          key={segmentIndex}
                          style={{
                            fontSize: 12,
                            color: C.muted,
                            lineHeight: 1.55,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {aiPublicText(segment, "")}
                        </div>
                      ))}
                      {(m.processActivities || []).map((item) => (
                        <AiProgressRow
                          key={item.id}
                          item={item}
                          icon={<Wrench size={13} aria-hidden="true" />}
                          kind="tool"
                        />
                      ))}
                      {(m.processSubagents || []).map((item) => (
                        <AiProgressRow
                          key={item.id}
                          item={item}
                          icon={<Bot size={13} aria-hidden="true" />}
                          testId="ai-subagent-row"
                        />
                      ))}
                      {m.status === "streaming" && m.text ? (
                        <div
                          style={{
                            fontSize: 12,
                            color: C.muted,
                            lineHeight: 1.55,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {m.text}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {m.status === "streaming" && m.process?.length ? null : (
                    <AiMessageContent text={m.text} />
                  )}
                  <AiWebSearchStatusCard webSearch={m.meta?.webSearch} />
                  <AiProjectHealthCard projectHealth={m.meta?.projectHealth} />
                  <AiSuggestedActionCard
                    actions={m.meta?.suggestedActions}
                    onCreateDraft={createSuggestedActionDraft}
                  />
                  {Array.isArray(m.meta?.skillDrafts)
                    ? m.meta.skillDrafts.map((skillDraft) => (
                        <HermesSkillDraftReview
                          key={skillDraft.id}
                          draft={skillDraft}
                          currentUser={user}
                        />
                      ))
                    : null}
                  {m.turnId &&
                  (m.status === "failed" || m.status === "completed") ? (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 6,
                        paddingTop: 2,
                      }}
                    >
                      {m.status === "failed" && m.retryable ? (
                        <button
                          type="button"
                          onClick={() => replayConversationMessage(m, "retry")}
                          disabled={busy}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            minHeight: 28,
                            border: `1px solid ${C.border}`,
                            borderRadius: 7,
                            background: C.soft,
                            color: C.ink4,
                            padding: "4px 8px",
                            fontSize: 11.5,
                            fontWeight: 650,
                            cursor: busy ? "default" : "pointer",
                          }}
                        >
                          <RotateCcw size={12} aria-hidden="true" />
                          重试
                        </button>
                      ) : null}
                      {m.status === "completed" ? (
                        <button
                          type="button"
                          onClick={() =>
                            replayConversationMessage(m, "regenerate")
                          }
                          disabled={busy}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            minHeight: 28,
                            border: "1px solid transparent",
                            borderRadius: 7,
                            background: "transparent",
                            color: C.muted,
                            padding: "4px 7px",
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: busy ? "default" : "pointer",
                          }}
                        >
                          <RefreshCw size={12} aria-hidden="true" />
                          重新生成
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                m.text
              )}
            </div>
          </div>
        ))}
        <AiRunProgressPanel
          progress={runProgress}
          onSubmitClarify={submitClarifyResponse}
        />
        {busy ? (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: "14px 14px 14px 4px",
                padding: "9px 12px",
                fontSize: 12.5,
                color: C.muted,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 13,
                  height: 13,
                  border: "2.2px solid #d8dbe6",
                  borderTopColor: C.primary,
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "obspin .7s linear infinite",
                }}
              />
              正在分析真实数据…
            </div>
          </div>
        ) : null}
      </div>
      {/* 输入坞 */}
      <div
        style={{
          borderTop: `1px solid ${C.divider}`,
          padding: 12,
          background: "#fff",
        }}
      >
        {attachments.length || attachmentError ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 8,
            }}
          >
            {attachments.map((attachment, index) => (
              <span
                key={`${attachment.name}-${index}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  maxWidth: "100%",
                  borderRadius: 999,
                  border: `1px solid ${C.border}`,
                  background: C.primarySoft,
                  color: C.ink2,
                  fontSize: 11.5,
                  padding: "4px 7px",
                }}
              >
                <span
                  style={{
                    maxWidth: 150,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {attachment.name}
                </span>
                <button
                  type="button"
                  aria-label={`移除 ${attachment.name}`}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  style={{
                    border: 0,
                    background: "transparent",
                    color: C.muted,
                    cursor: "pointer",
                    fontSize: 12,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            {attachmentError ? (
              <span
                style={{
                  color: C.danger,
                  fontSize: 11.5,
                  padding: "4px 0",
                }}
              >
                {attachmentError}
              </span>
            ) : null}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#f5f6f9",
            border: "1px solid #e8eaf0",
            borderRadius: 13,
            padding: "7px 7px 7px 13px",
          }}
        >
          <button
            type="button"
            aria-label="上传附件"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              border: 0,
              background: "transparent",
              color: "#aeb3bf",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: busy ? "default" : "pointer",
              flexShrink: 0,
              padding: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="向 AI 助手提问或下达指令…"
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              outline: "none",
              fontSize: 13,
              color: C.ink,
              fontFamily: "inherit",
              minWidth: 0,
            }}
          />
          <input
            ref={fileInputRef}
            data-testid="ai-attachment-input"
            type="file"
            multiple
            accept={AI_CHAT_ATTACHMENT_ACCEPT}
            onChange={handleAttachmentChange}
            style={{ display: "none" }}
          />
          <button
            type="button"
            data-testid="ai-send-stop-button"
            aria-label={busy ? "停止生成" : "发送"}
            title={busy ? "停止生成" : "发送"}
            onClick={busy ? stopActiveRun : send}
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              border: "none",
              background: C.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              opacity: 1,
            }}
          >
            {busy ? (
              <Square size={14} fill="#fff" color="#fff" aria-hidden="true" />
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            )}
          </button>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 9,
          }}
        >
          <span style={{ fontSize: 11, color: "#b4b9c4" }}>
            AI 产出为草稿，需人工确认
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "#b4b9c4" }}>Enter 发送</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  个人面板（中栏）
// ============================================================
function MarketplaceRecos({ go }) {
  const [recos, setRecos] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/marketplace/intel", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled)
          setRecos(
            res.ok ? (json?.matches?.recommendations || []).slice(0, 3) : [],
          );
      } catch {
        if (!cancelled) setRecos([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!recos || recos.length === 0) return null;
  return (
    <div
      className="card ob-side-card"
      style={{
        borderRadius: 16,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 680,
          marginBottom: 11,
          color: C.ink,
        }}
      >
        撮合推荐
        <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
          · 供需广场
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {recos.map((r) => (
          <button
            key={r.kind + r.refId}
            type="button"
            onClick={() => go?.("marketplace")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "9px 8px",
              borderRadius: 11,
              cursor: "pointer",
              border: 0,
              background: "transparent",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                flexShrink: 0,
                borderRadius: 9,
                background: tone(r.kind === "posting" ? "blue" : "violet").bg,
                color: tone(r.kind === "posting" ? "blue" : "violet").color,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              {r.kind === "posting" ? "需" : "接"}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: C.ink,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.title}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: C.muted,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {(r.reasons || []).join(" · ")}
              </span>
            </span>
            <span style={{ fontSize: 13, color: C.primary, fontWeight: 700 }}>
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PersonalPanel({
  user,
  scopeLabel,
  periodLabel = "实时",
  summary,
  recos,
  todos,
  go,
}) {
  const name =
    (user?.name && user.name !== "未登录用户" ? user.name : null) ||
    "经营舱用户";
  // 头像图片优先；无图时用自定义字标；Array.from 按码点取首字，emoji 姓名不会被截半
  const avatarImage =
    (typeof user?.avatarUrl === "string" && user.avatarUrl.trim()) || "";
  const avatarLabel =
    (typeof user?.avatarText === "string" && user.avatarText.trim()) ||
    Array.from(name)[0] ||
    "U";
  const roleLabel = ROLE_LABELS[user?.role] || "成员";
  const org = user?.org || user?.dept || scopeLabel || "";
  const [done, setDone] = React.useState({});
  const todoTotal = todos.length || 1;
  const todoDone = todos.filter((t) => done[t.key]).length;
  return (
    <>
      {/* 问候卡 */}
      <div
        className="ob-greeting-card"
        style={{
          background:
            "linear-gradient(135deg,#17233f 0%,#24294d 58%,#30345f 100%)",
          border: "1px solid rgba(255,255,255,.1)",
          borderRadius: 16,
          padding: 18,
          color: "#fff",
          position: "relative",
          overflow: "hidden",
          boxShadow:
            "0 1px 2px rgba(15,23,42,.18),0 18px 34px -24px rgba(15,23,42,.52),inset 0 1px 0 rgba(255,255,255,.12)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            position: "relative",
          }}
        >
          {avatarImage ? (
            <img
              src={avatarImage}
              alt={`${name} 的头像`}
              style={{
                width: 48,
                height: 48,
                flexShrink: 0,
                borderRadius: 14,
                objectFit: "cover",
                boxShadow: "0 4px 12px rgba(85,102,230,.4)",
              }}
            />
          ) : (
            <span
              style={{
                width: 48,
                height: 48,
                flexShrink: 0,
                borderRadius: 14,
                background:
                  "linear-gradient(145deg,rgba(255,255,255,.3),rgba(255,255,255,.14))",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: Array.from(avatarLabel).length > 1 ? 15 : 20,
                fontWeight: 800,
                boxShadow: "0 4px 12px rgba(85,102,230,.4)",
              }}
            >
              {avatarLabel}
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16.5, fontWeight: 650 }}>
              {greeting()}，{name} 👋
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: "#aab0c0",
                marginTop: 3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {roleLabel}
              {org ? ` · ${org}` : ""}
            </div>
          </div>
        </div>
      </div>

      {/* 大盘总览 2x2 */}
      <div
        className="card ob-side-card"
        style={{
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 680, color: C.ink }}>
            大盘总览
          </div>
          <span style={{ fontSize: 11, color: C.muted }}>{periodLabel}</span>
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
        >
          {summary.map((s) => (
            <div
              key={s.label}
              style={{
                background: s.attention
                  ? "linear-gradient(150deg,#fff8ea,#fffaf2)"
                  : C.soft,
                border: `1px solid ${s.attention ? "#f1e4c4" : C.divider}`,
                borderRadius: 12,
                padding: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 730,
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                    color: s.color || C.ink,
                  }}
                >
                  {s.value}
                </div>
                {s.series ? (
                  <MiniLine
                    series={s.series}
                    color={s.color || C.primary}
                    testId="personal-summary-sparkline"
                  />
                ) : null}
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 今日推荐 */}
      {recos.length ? (
        <div
          className="card ob-side-card"
          style={{
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 680,
              marginBottom: 11,
              color: C.ink,
            }}
          >
            今日推荐
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {recos.map((r) => (
              <button
                key={r.text}
                type="button"
                onClick={() => r.route && go?.(r.route)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "9px 8px",
                  borderRadius: 11,
                  cursor: "pointer",
                  border: 0,
                  background: "transparent",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: `linear-gradient(145deg,${tone(r.tone).bg},${tone(r.tone).bg})`,
                    color: tone(r.tone).color,
                    fontWeight: 800,
                    fontSize: 12.5,
                    boxShadow: `inset 0 0 0 1px ${tone(r.tone).solid}28`,
                  }}
                >
                  {r.icon}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12.5,
                      fontWeight: 600,
                      lineHeight: 1.3,
                      color: C.ink,
                    }}
                  >
                    {r.text}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      color: C.muted,
                      marginTop: 2,
                    }}
                  >
                    {r.sub}
                  </span>
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: tone(r.tone).color,
                    background: tone(r.tone).bg,
                    borderRadius: 7,
                    padding: "3px 8px",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.cta || "前往"}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <MarketplaceRecos go={go} />

      {/* 待办事项 */}
      {todos.length ? (
        <div
          className="card ob-side-card"
          style={{
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", marginBottom: 12 }}
          >
            <div style={{ fontSize: 13, fontWeight: 680, color: C.ink }}>
              待办事项
            </div>
            <div style={{ flex: 1 }} />
            <div
              style={{
                fontSize: 11.5,
                color: C.muted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {todoDone} / {todos.length} 已完成
            </div>
          </div>
          <div
            style={{
              height: 4,
              borderRadius: 3,
              background: C.divider,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                height: "100%",
                background: "linear-gradient(90deg,#1e50c8,#3b6be6)",
                borderRadius: 3,
                width: "100%",
                transform: `scaleX(${todoDone / todoTotal})`,
                transformOrigin: "left center",
                transition: "transform .3s",
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {todos.map((t) => {
              const checked = !!done[t.key];
              return (
                <div
                  key={t.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 6px",
                    borderRadius: 9,
                    cursor: "pointer",
                  }}
                >
                  <button
                    type="button"
                    aria-label="标记完成"
                    onClick={() =>
                      setDone((dd) => ({ ...dd, [t.key]: !dd[t.key] }))
                    }
                    style={{
                      width: 18,
                      height: 18,
                      flexShrink: 0,
                      borderRadius: 6,
                      border: checked
                        ? `1px solid ${C.primary}`
                        : "1.5px solid #d3d7e0",
                      background: checked ? C.primary : "#fff",
                      color: "#fff",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      padding: 0,
                      boxShadow: checked
                        ? "0 1px 3px rgba(85,102,230,.35)"
                        : "none",
                    }}
                  >
                    {checked ? "✓" : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => t.route && go?.(t.route)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      border: 0,
                      background: "transparent",
                      padding: 0,
                      cursor: "pointer",
                      fontSize: 12.5,
                      lineHeight: 1.35,
                      color: checked ? "#b4b9c4" : C.ink2,
                      textDecoration: checked ? "line-through" : "none",
                    }}
                  >
                    {t.text}
                  </button>
                  {t.count != null ? (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 10.5,
                        fontWeight: 600,
                        borderRadius: 6,
                        padding: "2px 6px",
                        color: tone(t.tone).color,
                        background: tone(t.tone).bg,
                      }}
                    >
                      {t.count}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ============================================================
//  风险事项核验抽屉 —— 真实 d.risks
// ============================================================
const RISK_LEVEL = {
  high: { text: "高风险", chip: { background: "#fdecec", color: "#d63c41" } },
  mid: { text: "中风险", chip: { background: "#fef5e3", color: "#b5790a" } },
  low: { text: "低风险", chip: { background: "#eef0fe", color: "#4453d4" } },
};
function toneToLevel(t) {
  return t === "bad" || t === "danger" || t === "red"
    ? "high"
    : t === "warn" || t === "amber"
      ? "mid"
      : "low";
}
function RiskDrawer({ open, risks, onClose, go }) {
  const [tab, setTab] = React.useState("all");
  if (!open) return null;
  const enriched = (risks || []).map((r, i) => ({
    ...r,
    key: r.key || `risk-${i}`,
    level: r.level || toneToLevel(r.tone),
  }));
  const counts = {
    all: enriched.length,
    high: enriched.filter((r) => r.level === "high").length,
    mid: enriched.filter((r) => r.level === "mid").length,
    low: enriched.filter((r) => r.level === "low").length,
  };
  const visible =
    tab === "all" ? enriched : enriched.filter((r) => r.level === tab);
  const tabBtn = (key, label) => {
    const active = tab === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setTab(key)}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          height: 30,
          border: "none",
          borderRadius: 8,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          background: active ? "#fff" : "transparent",
          color: active ? C.ink : "#7a818f",
          boxShadow: active ? "0 1px 3px rgba(24,27,46,.1)" : "none",
        }}
      >
        {label}{" "}
        <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.7 }}>
          {counts[key]}
        </span>
      </button>
    );
  };
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        animation: "obfade .18s",
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(20,24,40,.34)",
        }}
      />
      <div
        role="dialog"
        aria-label="风险事项核验"
        className="scl"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 560,
          maxWidth: "94vw",
          background: "#fff",
          boxShadow: "-12px 0 44px rgba(20,24,40,.2)",
          display: "flex",
          flexDirection: "column",
          animation: "obslide .28s cubic-bezier(.2,.85,.25,1)",
        }}
      >
        <div
          style={{
            padding: "20px 22px 16px",
            borderBottom: `1px solid ${C.divider}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "linear-gradient(145deg,#fde0e0,#fbd2d2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#d63c41"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />
                <path d="M12 8v4" />
                <path d="M12 15h.01" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 680, color: C.ink }}>
                风险事项核验
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>
                共{" "}
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {enriched.length}
                </span>{" "}
                条命中规则，需人工确认处理
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                border: `1px solid ${C.border}`,
                background: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#5b626f"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div
            style={{
              display: "flex",
              gap: 4,
              marginTop: 16,
              background: "#f4f5f8",
              borderRadius: 10,
              padding: 3,
            }}
          >
            {tabBtn("all", "全部")}
            {tabBtn("high", "高风险")}
            {tabBtn("mid", "中风险")}
            {tabBtn("low", "低风险")}
          </div>
        </div>
        <div
          className="scl"
          style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}
        >
          {visible.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {visible.map((r) => {
                const lv = RISK_LEVEL[r.level] || RISK_LEVEL.low;
                return (
                  <div
                    key={r.key}
                    className="card"
                    style={{
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: 14,
                      boxShadow: "0 1px 2px rgba(24,27,46,.03)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          fontSize: 11,
                          fontWeight: 650,
                          borderRadius: 7,
                          padding: "3px 8px",
                          flexShrink: 0,
                          ...lv.chip,
                        }}
                      >
                        {lv.text}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 620,
                            lineHeight: 1.4,
                            color: C.ink,
                          }}
                        >
                          {r.title}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginTop: 7,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11.5,
                              color: "#7a818f",
                              background: "#f4f5f8",
                              borderRadius: 6,
                              padding: "2px 7px",
                            }}
                          >
                            {routeLabel(r.target?.route)}
                          </span>
                          {r.subtitle ? (
                            <span style={{ fontSize: 11.5, color: C.muted }}>
                              {r.subtitle}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: `1px solid ${C.divider2}`,
                      }}
                    >
                      <div style={{ flex: 1 }} />
                      <button
                        type="button"
                        onClick={onClose}
                        style={{
                          fontSize: 12,
                          color: "#5b626f",
                          background: "#fff",
                          border: `1px solid ${C.border}`,
                          borderRadius: 8,
                          padding: "5px 11px",
                          cursor: "pointer",
                        }}
                      >
                        稍后
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          go?.(r.target?.route || "warroom", r.target?.id);
                          onClose();
                        }}
                        style={{
                          fontSize: 12,
                          color: "#fff",
                          background: C.primary,
                          border: "none",
                          borderRadius: 8,
                          padding: "5px 13px",
                          cursor: "pointer",
                          fontWeight: 600,
                          boxShadow: "0 2px 5px rgba(85,102,230,.3)",
                        }}
                      >
                        去处理
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "60px 20px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 16,
                  background: "linear-gradient(145deg,#e8f6ee,#daf0e3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 14,
                }}
              >
                <svg
                  width="27"
                  height="27"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#1f9d55"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 620, color: C.ink }}>
                该等级暂无待核验事项
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: C.muted,
                  marginTop: 5,
                  maxWidth: 240,
                }}
              >
                所有命中此风险等级的事项均已处理完成
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  主组件
// ============================================================
export function OverviewBoard({
  dashboard,
  go,
  projects,
  tasks,
  reports,
  batches,
  currentUser,
}) {
  const [drawer, setDrawer] = React.useState(false);
  const [period, setPeriod] = React.useState("实时");
  useClock();
  const d = dashboard || {};
  const profile = d.profile || {};
  const role = String(profile.role || "owner");
  const panels = d.panels || {};
  const kpis = d.kpis || [];
  const risks = d.risks || [];
  const updatedLabel = updatedLabelFrom(d.generatedAt);
  const periodScopedData = React.useMemo(
    () =>
      scopeDashboardDataByPeriod(period, d.generatedAt, {
        projects: projects || [],
        tasks: tasks || [],
        reports: reports || [],
        batches: batches || [],
      }),
    [period, d.generatedAt, projects, tasks, reports, batches],
  );
  const scopedProjects = periodScopedData.projects;
  const scopedTasks = periodScopedData.tasks;
  const scopedReports = periodScopedData.reports;
  const scopedBatches = periodScopedData.batches;
  const isRealtimePeriod = period === "实时";
  const riskCount = isRealtimePeriod
    ? risks.length
    : scopedRiskCount(periodScopedData);
  const dashboardActionGroups = React.useMemo(
    () => normalizeDashboardActionGroups(d.actionGroups),
    [d.actionGroups],
  );
  const dashboardPersonal = React.useMemo(
    () => normalizeDashboardPersonalPanel(d.personal),
    [d.personal],
  );
  const [aiDraftTodos, setAiDraftTodos] = React.useState([]);

  React.useEffect(() => {
    let cancelled = false;
    async function loadAiDraftTodos() {
      try {
        const res = await fetch("/api/ai/drafts?status=pending", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok || cancelled) return;
        setAiDraftTodos(normalizeAiTodoDrafts(json?.drafts));
      } catch {
        if (!cancelled) setAiDraftTodos([]);
      }
    }
    loadAiDraftTodos();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, currentUser?.role]);

  const handleAiTodoDraftCreated = React.useCallback((todo) => {
    const normalized = normalizeAiTodoDraft(todo);
    if (!normalized) return;
    setAiDraftTodos((items) => [
      normalized,
      ...items.filter((item) => item.key !== normalized.key),
    ]);
  }, []);

  const todoGroups = React.useMemo(
    () =>
      isRealtimePeriod && dashboardActionGroups.length
        ? dashboardActionGroups
        : computeTodoGroups(role, {
            projects: scopedProjects,
            tasks: scopedTasks,
            reports: scopedReports,
            batches: scopedBatches,
          }),
    [
      isRealtimePeriod,
      dashboardActionGroups,
      role,
      scopedProjects,
      scopedTasks,
      scopedReports,
      scopedBatches,
    ],
  );

  // 直播执行实时盘：真实 KPI（厂家应收 / 毛利 / 毛利率 / 风险等，按角色由服务端算）。
  // 走势线仅在能算出真实序列（今日排班累计）时绘制，否则不画、不编造环比。
  const bizCols = React.useMemo(() => {
    const liveKpis =
      isRealtimePeriod && kpis.length
        ? kpis.slice(0, 4)
        : buildScopedLiveKpis(kpis, role, periodScopedData);
    const series = scheduleSeries(scopedTasks);
    return liveKpis.map((k, i) => {
      const f = fmtKpi(k.value, k.unit);
      const fallbackColor =
        i === 0 ? C.primary : i === 1 ? C.ok : i === 2 ? "#e0a82e" : C.danger;
      return {
        key: k.key || `kpi-${i}`,
        label: k.label,
        value: f.value,
        unit: f.unit,
        hint: k.hint || "",
        series: normalizeVisualSeries(k.series) || (i === 0 ? series : null),
        color:
          k.tone && k.tone !== "neutral" ? tone(k.tone).solid : fallbackColor,
      };
    });
  }, [isRealtimePeriod, kpis, role, periodScopedData, scopedTasks]);

  const proj = React.useMemo(
    () => ({
      total: scopedProjects.length,
      running: cnt(scopedProjects, isOperatingProject),
      pending: scopedPendingReportCount(scopedProjects, scopedReports),
      abnormal: scopedAnomalyCount(scopedProjects, scopedTasks),
    }),
    [scopedProjects, scopedReports, scopedTasks],
  );

  const admission = panels.admissionFunnel;
  const passRate = funnelRate(admission);
  const passSeries = admission?.stages?.length
    ? admission.stages.map((s) => Number(s.value) || 0)
    : null;

  // 个人面板真实派生
  const basePersonal = React.useMemo(() => {
    if (isRealtimePeriod && dashboardPersonal) return dashboardPersonal;

    const active = cnt(scopedProjects, isOperatingProject);
    const pendingReports = scopedPendingReportCount(
      scopedProjects,
      scopedReports,
    );
    const anomalies = scopedAnomalyCount(scopedProjects, scopedTasks);
    const recordingPending = (scopedProjects || []).reduce(
      (s, p) => s + (p?.streamers?.pendingReview ?? 0),
      0,
    );
    const lowMargin = cnt(
      scopedProjects,
      (p) => Number.isFinite(margin(p)) && margin(p) < 20,
    );
    const bs = (s) => cnt(scopedBatches, (b) => b.status === s);
    const sched = scheduleSeries(scopedTasks);
    const summary = [
      {
        label: "在营项目",
        value: String(active),
        color: C.primary,
        series: null,
      },
      {
        label: "待办合计",
        value: String(
          todoGroups.reduce(
            (s, g) =>
              s + g.items.reduce((a, i) => a + (Number(i.value) || 0), 0),
            0,
          ),
        ),
        color: "#7b6ef0",
        series: null,
      },
      {
        label: "风险数",
        value: String(riskCount),
        color: riskCount > 0 ? C.warn : C.ink,
        attention: riskCount > 0,
        series: null,
      },
      {
        label: "今日场次",
        value: String((tasks || []).length),
        color: C.ok,
        series: sched,
      },
    ];
    const recos = [];
    if (recordingPending > 0)
      recos.push({
        icon: "录",
        text: "优先处理录屏审核",
        sub: `${recordingPending} 条待审`,
        tone: "warn",
        cta: "去审核",
        route: "projects",
      });
    if (anomalies > 0)
      recos.push({
        icon: "异",
        text: "跟进异常直播任务",
        sub: `${anomalies} 个异常`,
        tone: "warn",
        cta: "去处理",
        route: "tasks",
      });
    if (lowMargin > 0)
      recos.push({
        icon: "复",
        text: "复盘低毛利项目",
        sub: `${lowMargin} 个低于阈值`,
        tone: "warn",
        cta: "去复盘",
        route: "warroom",
      });
    if (pendingReports > 0)
      recos.push({
        icon: "审",
        text: "清理待审报数",
        sub: `${pendingReports} 条`,
        tone: "info",
        cta: "去审核",
        route: "reports",
      });
    if (!recos.length)
      recos.push({
        icon: "看",
        text: "查看项目经营排行",
        sub: "按毛利贡献",
        tone: "info",
        cta: "查看",
        route: "warroom",
      });
    const todos = [];
    if (pendingReports > 0)
      todos.push({
        key: "rev",
        text: "审核待审报数",
        count: pendingReports,
        tone: "warn",
        route: "reports",
      });
    if (anomalies > 0)
      todos.push({
        key: "ano",
        text: "处理异常直播任务",
        count: anomalies,
        tone: "warn",
        route: "tasks",
      });
    if (recordingPending > 0)
      todos.push({
        key: "rec",
        text: "核验录屏待审",
        count: recordingPending,
        tone: "warn",
        route: "projects",
      });
    if (bs("draft") > 0)
      todos.push({
        key: "bat",
        text: "生成结算批次",
        count: bs("draft"),
        tone: "neutral",
        route: "settle",
      });
    if (bs("pending_confirm") > 0)
      todos.push({
        key: "cfm",
        text: "确认待确认批次",
        count: bs("pending_confirm"),
        tone: "warn",
        route: "settle",
      });
    if (!todos.length)
      todos.push({
        key: "none",
        text: "暂无紧急待办，保持关注经营总览",
        count: null,
        route: "warroom",
      });
    return { summary, recos: recos.slice(0, 3), todos: todos.slice(0, 5) };
  }, [
    isRealtimePeriod,
    dashboardPersonal,
    scopedProjects,
    scopedTasks,
    scopedReports,
    scopedBatches,
    todoGroups,
    riskCount,
  ]);
  const personal = React.useMemo(
    () => mergeAiDraftTodos(basePersonal, aiDraftTodos),
    [basePersonal, aiDraftTodos],
  );

  return (
    <div className="ob-shell ob-command-surface" style={{ minHeight: "100%" }}>
      <style>{`
        @keyframes obpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.82)}}
        @keyframes obspin{to{transform:rotate(360deg)}}
        @keyframes obfade{from{opacity:0}to{opacity:1}}
        @keyframes obslide{from{transform:translateX(44px);opacity:0}to{transform:translateX(0);opacity:1}}
        .ob-command-surface{--ob-command-bg:linear-gradient(180deg,#eef3fb 0%,#f4f6fb 260px,#f4f6fb 100%);--ob-panel-border:#dfe6f2;--ob-panel-shadow:0 1px 2px rgba(15,23,42,.05),0 12px 30px -22px rgba(15,23,42,.34);--ob-panel-highlight:inset 0 1px 0 rgba(255,255,255,.86);background:var(--ob-command-bg);color:#0b1733}
        .ob-shell *{box-sizing:border-box}
        .ob-card .lift,.lift{transition:box-shadow .2s ease,transform .2s ease,border-color .2s ease}
        .lift:hover{box-shadow:0 1px 2px rgba(15,23,42,.06),0 18px 34px -24px rgba(15,23,42,.42);transform:translateY(-1px)}
        .ob-panel-card,.ob-side-card,.ob-live-card,.ob-kpi-card{background:linear-gradient(180deg,#ffffff 0%,#fbfdff 100%);border:1px solid var(--ob-panel-border);box-shadow:var(--ob-panel-shadow),var(--ob-panel-highlight)}
        .ob-kpi-card{position:relative;overflow:hidden}
        .ob-kpi-card::before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,rgba(59,107,230,.28),rgba(14,138,77,.16),rgba(168,106,0,.18))}
        .ob-live-card{box-shadow:0 1px 2px rgba(15,23,42,.05),0 18px 42px -30px rgba(15,23,42,.42),var(--ob-panel-highlight)}
        .ob-critical-banner{background:linear-gradient(180deg,#fff8e7 0%,#fff3d6 100%);border:1px solid #efd89f;box-shadow:0 1px 2px rgba(121,80,0,.05),inset 0 1px 0 rgba(255,255,255,.74)}
        .ob-segmented{display:flex;gap:2px;background:#e9eef7;border:1px solid #dce4f0;border-radius:11px;padding:3px;box-shadow:inset 0 1px 2px rgba(15,23,42,.04)}
        .ob-segmented-button{min-width:54px;height:28px;padding:0 14px;border:none;border-radius:8px;font-size:12.5px;font-weight:650;cursor:pointer;transition:background-color .16s ease,color .16s ease,box-shadow .16s ease;line-height:28px}
        .ob-segmented-button.is-active{background:#ffffff;color:#1e50c8;box-shadow:0 1px 2px rgba(15,23,42,.08),0 0 0 1px rgba(255,255,255,.8)}
        .ob-segmented-button:not(.is-active){background:transparent;color:#66748a}
        .ob-toolbar-pill{background:rgba(255,255,255,.76);border:1px solid var(--ob-panel-border);box-shadow:0 1px 2px rgba(15,23,42,.03),inset 0 1px 0 rgba(255,255,255,.82)}
        .scl::-webkit-scrollbar{width:8px;height:8px}
        .scl::-webkit-scrollbar-thumb{background:#cfd7e6;border-radius:4px}
        .scl::-webkit-scrollbar-track{background:transparent}
        .ob-shell{--ob-ai-width:clamp(360px,21vw,440px);--ob-personal-width:clamp(280px,15vw,300px);--ob-gap:clamp(12px,.8vw,16px);--ob-pad-r:clamp(16px,1vw,20px);--ob-pad-l:clamp(18px,1.25vw,24px);--ob-ai-top:76px;--ob-ai-bottom:20px}
        /* 全屏优先保留截图里的主看板 / 个人面板 / AI 助手三栏。
           宽度用 clamp 做连续收缩，避免不同设备全屏时被过早切成单列。 */
        .ob-layout{display:grid;grid-template-columns:minmax(0,1fr) var(--ob-personal-width);gap:var(--ob-gap);align-items:start;padding:20px calc(var(--ob-ai-width) + var(--ob-gap) + var(--ob-pad-r)) 40px var(--ob-pad-l);box-sizing:border-box}
        .ob-main{min-width:0;display:flex;flex-direction:column;gap:16px;container-type:inline-size}
        .ob-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
        @container (max-width:860px){.ob-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @container (max-width:520px){.ob-kpi-grid{grid-template-columns:1fr}}
        .ob-admission-funnel-model{container-type:inline-size;min-width:0}
        .ob-admission-funnel-grid{display:grid;grid-template-columns:minmax(150px,.78fr) minmax(180px,1fr) minmax(180px,1fr);gap:12px;align-items:stretch}
        .ob-admission-funnel-metric,.ob-admission-funnel-segment-wrap,.ob-admission-funnel-decision{min-width:0}
        @container (max-width:760px){.ob-admission-funnel-grid{grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr)}.ob-admission-funnel-head-decision{display:none}.ob-admission-funnel-decision{grid-column:1 / -1}}
        @container (max-width:520px){.ob-admission-funnel-grid{grid-template-columns:1fr}.ob-admission-funnel-head-stage,.ob-admission-funnel-head-decision{display:none}.ob-admission-funnel-segment-wrap,.ob-admission-funnel-decision{grid-column:1 / -1}}
        .ob-personal{min-width:0;display:flex;flex-direction:column;gap:16px}
        .ob-ai{min-width:0;position:fixed;right:var(--ob-pad-r);top:var(--ob-ai-top);bottom:var(--ob-ai-bottom);width:var(--ob-ai-width);z-index:20;display:flex;flex-direction:column}
        /* 只有窗口真的被缩窄时才切换为纵向自适应，常见桌面全屏保持完整三栏。 */
        @media(max-width:1180px){.ob-layout{grid-template-columns:1fr;padding:16px 16px 32px}.ob-personal{order:-1}.ob-ai{position:relative;right:auto;top:auto;bottom:auto;width:auto;height:min(620px,calc(100vh - 120px));min-height:520px;z-index:auto}}
        @media(max-width:760px){.ob-layout{padding:14px 12px 28px}.ob-ai{height:540px;min-height:480px}}
      `}</style>

      <div className="ob-layout">
        {/* ===== 左：主看板 ===== */}
        <section className="ob-main">
          {/* 标题 */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 0,
                display: "flex",
                alignItems: "center",
                gap: 9,
                color: C.ink,
              }}
            >
              {profile.title || "经营总览看板"}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: C.primaryDeep,
                  background: C.primarySoft,
                  borderRadius: 20,
                  padding: "3px 9px",
                  boxShadow: "inset 0 0 0 1px rgba(85,102,230,.14)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: C.primary,
                    animation: "obpulse 1.6s infinite",
                  }}
                />
                实时
              </span>
            </h1>
          </div>

          {/* tabs + meta */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="ob-segmented">
              {PERIOD_TABS.map((p) => {
                const active = period === p;
                return (
                  <button
                    key={p}
                    type="button"
                    className={`ob-segmented-button${active ? " is-active" : ""}`}
                    onClick={() => setPeriod(p)}
                    style={{
                      fontFamily: "inherit",
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <div style={{ flex: 1 }} />
            {profile.scopeLabel ? (
              <div
                className="ob-toolbar-pill"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 32,
                  borderRadius: 9,
                  padding: "0 11px",
                  fontSize: 12.5,
                  color: C.ink4,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#9aa0ad"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 7h18M3 12h18M3 17h18" />
                </svg>
                {profile.scopeLabel}
              </div>
            ) : null}
            <div
              className="ob-toolbar-pill"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 32,
                borderRadius: 9,
                padding: "0 11px",
                fontSize: 12.5,
                color: C.ink4,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#9aa0ad"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              {updatedLabel}
            </div>
          </div>

          {/* 风险横幅 */}
          {riskCount > 0 ? (
            <div
              className="ob-critical-banner"
              style={{
                position: "relative",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                gap: 14,
                borderRadius: 14,
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "linear-gradient(150deg,#fcedc4,#f7da93)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,.65),0 0 0 4px rgba(247,218,147,.22)",
                }}
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#c2860a"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0Z" />
                  <path d="M12 9v4M12 17h.01" />
                </svg>
              </div>
              <div style={{ position: "relative", flex: 1, lineHeight: 1.4 }}>
                <div
                  style={{ fontSize: 13.5, fontWeight: 650, color: "#6b5326" }}
                >
                  命中风险规则的事项待人工核验处理
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 20,
                      height: 20,
                      padding: "0 6px",
                      marginLeft: 8,
                      background: "rgba(181,121,10,.12)",
                      color: C.warn,
                      border: "1px solid rgba(181,121,10,.22)",
                      borderRadius: 7,
                      fontSize: 12,
                      fontVariantNumeric: "tabular-nums",
                      verticalAlign: "middle",
                    }}
                  >
                    {riskCount}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#9c8755", marginTop: 2 }}>
                  含{" "}
                  {risks.filter((r) => toneToLevel(r.tone) === "high").length}{" "}
                  条高风险事项，建议优先处理
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawer(true)}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  height: 34,
                  border: "none",
                  borderRadius: 9,
                  padding: "0 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background:
                    "linear-gradient(135deg,#edb52b 0%,#e2a314 52%,#d4940b 100%)",
                  cursor: "pointer",
                  flexShrink: 0,
                  boxShadow:
                    "0 3px 9px rgba(206,150,16,.3),inset 0 1px 0 rgba(255,255,255,.32)",
                }}
              >
                去处理
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          ) : null}

          {/* 4 KPI */}
          {todoGroups.length ? (
            <div className="ob-kpi-grid">
              {todoGroups.slice(0, 4).map((g) => (
                <KpiCard key={g.title} group={g} />
              ))}
            </div>
          ) : null}

          {/* 经营数据卡（直播执行实时盘） */}
          {bizCols.length ? (
            <div
              className="card ob-live-card"
              style={{
                position: "relative",
                borderRadius: 16,
                padding: "18px 20px 20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  marginBottom: 18,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: C.primary,
                    boxShadow: "0 0 0 3px rgba(85,102,230,.14)",
                    animation: "obpulse 1.6s infinite",
                  }}
                />
                <span style={{ fontSize: 14.5, fontWeight: 680, color: C.ink }}>
                  直播执行实时盘
                </span>
                <span style={{ fontSize: 11.5, color: C.muted }}>
                  · 经营汇总
                </span>
                {cnt(scopedTasks, isLive) > 0 ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      color: C.ok,
                      background: C.okBg,
                      borderRadius: 6,
                      padding: "2px 7px",
                      marginLeft: 2,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: C.ok,
                      }}
                    />
                    {cnt(scopedTasks, isLive)} 场直播中
                  </span>
                ) : null}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: C.muted }}>
                  {updatedLabel}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${bizCols.length},1fr)`,
                }}
              >
                {bizCols.map((c, i) => (
                  <div
                    key={c.key}
                    style={{
                      padding: "0 18px",
                      paddingLeft: i === 0 ? 0 : 18,
                      borderLeft: i === 0 ? "none" : `1px solid ${C.divider}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12.5,
                        color: C.muted,
                        marginBottom: 9,
                      }}
                    >
                      {c.label}
                    </div>
                    <div
                      style={{
                        fontSize: 27,
                        fontWeight: 720,
                        fontVariantNumeric: "tabular-nums",
                        letterSpacing: 0,
                        lineHeight: 1,
                        display: "flex",
                        alignItems: "baseline",
                        gap: 1,
                        color: C.ink,
                      }}
                    >
                      {c.value}
                      {c.unit ? (
                        <span
                          style={{
                            fontSize: 15,
                            color: "#a3a8b4",
                            fontWeight: 600,
                            marginLeft: 2,
                          }}
                        >
                          {c.unit}
                        </span>
                      ) : null}
                    </div>
                    {c.hint ? (
                      <div
                        style={{ fontSize: 11.5, marginTop: 8, color: C.muted }}
                      >
                        {c.hint}
                      </div>
                    ) : (
                      <div style={{ height: 8 }} />
                    )}
                    {c.series ? (
                      <AreaSpark
                        series={c.series}
                        color={c.color}
                        gid={`biz-${c.key}`}
                        testId="live-kpi-sparkline"
                      />
                    ) : (
                      <div style={{ height: 45 }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* 进行中项目 + 准入通过率 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: passRate != null ? "1.4fr 1fr" : "1fr",
              gap: 16,
            }}
          >
            <div
              className="ob-project-card"
              style={{
                background:
                  "linear-gradient(135deg,#374475 0%,#4a4e82 52%,#665b83 100%)",
                border: "1px solid rgba(255,255,255,.12)",
                borderRadius: 16,
                padding: "19px 20px",
                color: "#fff",
                position: "relative",
                overflow: "hidden",
                boxShadow:
                  "0 1px 2px rgba(15,23,42,.12),0 22px 42px -30px rgba(58,54,104,.68),inset 0 1px 0 rgba(255,255,255,.13)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 13,
                    fontWeight: 600,
                    opacity: 0.94,
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3 3 8l9 5 9-5-9-5Z" />
                    <path d="m3 16 9 5 9-5" />
                  </svg>
                  进行中项目
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  marginBottom: 16,
                  position: "relative",
                }}
              >
                <span
                  style={{
                    fontSize: 44,
                    fontWeight: 760,
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                    letterSpacing: 0,
                    textShadow: "0 2px 10px rgba(30,26,70,.3)",
                  }}
                >
                  {proj.total}
                </span>
                <span style={{ fontSize: 14, opacity: 0.82 }}>个</span>
              </div>
              <div style={{ display: "flex", gap: 8, position: "relative" }}>
                <div
                  style={{
                    flex: 1,
                    background: "rgba(255,255,255,.12)",
                    borderRadius: 11,
                    padding: "10px 12px",
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,.1)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1,
                    }}
                  >
                    {proj.running}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                    进行中
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    background: "rgba(255,255,255,.12)",
                    borderRadius: 11,
                    padding: "10px 12px",
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,.1)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1,
                    }}
                  >
                    {proj.pending}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                    待报数
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    background:
                      "linear-gradient(135deg,rgba(224,168,46,.22),rgba(181,121,10,.12))",
                    borderRadius: 11,
                    padding: "10px 12px",
                    boxShadow: "inset 0 0 0 1px rgba(224,168,46,.2)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    {proj.abnormal}
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "#e0a82e",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.9, marginTop: 4 }}>
                    异常
                  </div>
                </div>
              </div>
            </div>
            {passRate != null ? (
              <div
                className="card ob-panel-card lift"
                style={{
                  borderRadius: 16,
                  padding: 18,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 2,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.ink3 }}>
                    准入通过率
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: C.muted,
                      background: "#f4f5f8",
                      borderRadius: 6,
                      padding: "2px 7px",
                    }}
                  >
                    录屏→入项
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 7,
                    marginTop: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 31,
                      fontWeight: 730,
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: 0,
                      color: C.ink,
                    }}
                  >
                    {passRate}
                    <span
                      style={{ fontSize: 17, color: C.muted, fontWeight: 600 }}
                    >
                      %
                    </span>
                  </span>
                </div>
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "flex-end",
                    marginTop: 6,
                    minHeight: 78,
                  }}
                >
                  {passSeries && passSeries.length >= 2 ? (
                    <AreaSpark
                      series={passSeries}
                      color={C.primary}
                      w={420}
                      h={64}
                      gid="passrate"
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {/* 准入漏斗 */}
          {admission?.stages?.length ? (
            <div
              className="card ob-panel-card lift"
              style={{
                borderRadius: 16,
                padding: 0,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "18px 20px 14px",
                  borderBottom: `1px solid ${C.divider2}`,
                  background:
                    "linear-gradient(180deg,rgba(247,249,253,.92) 0%,rgba(255,255,255,.72) 100%)",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 680, color: C.ink }}>
                  {admission.title || "准入漏斗 · 录屏到入项"}
                </div>
                <div style={{ flex: 1 }} />
                {passRate != null ? (
                  <div style={{ fontSize: 12, color: C.muted }}>
                    整体转化{" "}
                    <span
                      style={{
                        color: C.ok,
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                        fontSize: 13.5,
                        background: C.okBg,
                        border: "1px solid rgba(14,138,77,.16)",
                        borderRadius: 999,
                        padding: "3px 8px",
                      }}
                    >
                      {passRate}%
                    </span>
                  </div>
                ) : null}
              </div>
              <AdmissionFunnelModel admission={admission} />
            </div>
          ) : null}

          {d.emptyState ? (
            <div
              style={{
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: 16,
                padding: 20,
              }}
            >
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 800,
                  color: C.ink,
                  marginBottom: 8,
                }}
              >
                {d.emptyState.title}
              </div>
              <div style={{ fontSize: 13, color: C.muted }}>
                {d.emptyState.hint}
              </div>
            </div>
          ) : null}
        </section>

        {/* ===== 中：个人面板 ===== */}
        <aside className="ob-personal">
          <PersonalPanel
            user={currentUser}
            scopeLabel={profile.scopeLabel}
            periodLabel={period}
            summary={personal.summary}
            recos={personal.recos}
            todos={personal.todos}
            go={go}
          />
        </aside>

        {/* ===== 右：AI 助手 ===== */}
        <aside className="ob-ai">
          <AiPanel
            user={currentUser}
            projects={scopedProjects}
            go={go}
            onTodoDraftCreated={handleAiTodoDraftCreated}
          />
        </aside>
      </div>

      <RiskDrawer
        open={drawer}
        risks={risks}
        onClose={() => setDrawer(false)}
        go={go}
      />
    </div>
  );
}

export default OverviewBoard;
