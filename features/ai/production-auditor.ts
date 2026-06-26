import type { AiGatewayResult, AiUsage } from "./contracts";

/**
 * AI 生产执行与审计一体化引擎（AI Production Engine & Auditor）。
 *
 * 这个模块是一个**确定性闸门**：它不生成 AI 内容，而是对一次候选 AI 产出做
 * 生产级自检，确保每一次落库/执行的 AI 输出同时满足四道闸门：
 *
 *   1. 真实性  —— 必须是真实大模型调用（model/trace/prompt/response/token/latency/timestamp 齐全）。
 *   2. 落地性  —— 必须能映射到 ERP 业务对象（项目/主播/结算/审核/排班/收入成本分成）。
 *   3. 流程嵌入 —— 必须绑定至少一个业务流程节点（审核/结算/排班/对账/复盘/风控）。
 *   4. 结构化  —— 必须是严格结构化输出，禁止用自然语言替代结构数据。
 *
 * 任意一道闸门不满足 → 拒绝生成可执行结果，并标记为「不合格 AI 输出」。
 *
 * 引擎是纯函数、可单测、可在业务路径里同步调用，与 `invocation-ledger`、
 * `llm-gateway` 的账本/网关解耦。
 */

// ---------------------------------------------------------------------------
// 业务对象与流程节点字典
// ---------------------------------------------------------------------------

export const BUSINESS_OBJECT_TYPES = [
  "project",
  "host",
  "settlement",
  "review",
  "schedule",
  "revenue",
  "cost",
  "share",
] as const;

export type BusinessObjectType = (typeof BUSINESS_OBJECT_TYPES)[number];

export const PROCESS_NODES = [
  "审核",
  "结算",
  "排班",
  "对账",
  "复盘",
  "风控",
] as const;

export type ProcessNode = (typeof PROCESS_NODES)[number];

export type CredibilityLevel = "高" | "中" | "低" | "无";

/**
 * 把现有 `ai_invocations.object_type` / 业务侧别名归一到标准业务对象。
 * 例如真实调用里的 `live_report`、`settlement_batch`、`streamer` 都能落到标准对象。
 */
const BUSINESS_OBJECT_SYNONYMS: Record<string, BusinessObjectType> = {
  project: "project",
  projects: "project",
  项目: "project",
  host: "host",
  streamer: "host",
  streamers: "host",
  主播: "host",
  settlement: "settlement",
  settlement_batch: "settlement",
  settlement_pool: "settlement",
  结算: "settlement",
  结算单: "settlement",
  review: "review",
  live_report: "review",
  report: "review",
  审核: "review",
  审核单: "review",
  schedule: "schedule",
  live_task: "schedule",
  排班: "schedule",
  revenue: "revenue",
  income: "revenue",
  收入: "revenue",
  cost: "cost",
  成本: "cost",
  share: "share",
  分成: "share",
};

/**
 * 把流程节点别名（中/英）归一到标准节点。
 */
const PROCESS_NODE_SYNONYMS: Record<string, ProcessNode> = {
  审核: "审核",
  审核节点: "审核",
  review: "审核",
  auto_review: "审核",
  结算: "结算",
  结算节点: "结算",
  settlement: "结算",
  排班: "排班",
  排班节点: "排班",
  schedule: "排班",
  对账: "对账",
  对账节点: "对账",
  reconciliation: "对账",
  reconcile: "对账",
  复盘: "复盘",
  项目复盘: "复盘",
  项目复盘节点: "复盘",
  retrospective: "复盘",
  project_review: "复盘",
  风控: "风控",
  风控节点: "风控",
  risk: "风控",
  anomaly: "风控",
  risk_control: "风控",
};

// ---------------------------------------------------------------------------
// 引擎输入/输出契约
// ---------------------------------------------------------------------------

/**
 * 一次真实 AI 调用必须可观测的元数据。字段缺失即判定为「非真实 AI 调用」。
 */
export type AiAuthenticitySignals = {
  /** 模型名，如 gpt-4.1 / hunyuan-pro。 */
  modelName?: string | null;
  /** provider 返回的 request_id。与 traceId 至少其一存在。 */
  requestId?: string | null;
  /** 链路 trace_id。与 requestId 至少其一存在。 */
  traceId?: string | null;
  /** 实际送入模型的 prompt（可为字符串或消息数组）。 */
  promptInput?: unknown;
  /** 模型返回的原始/结构化响应。 */
  responseOutput?: unknown;
  /** token 用量，必须包含 input/output。 */
  usage?: Partial<AiUsage> | null;
  /** 端到端耗时（毫秒）。 */
  latencyMs?: number | null;
  /** 调用时间戳（ISO 字符串）。 */
  timestamp?: string | null;
};

/** 标准化后的可执行动作。 */
export type ExecutableAction = {
  /** 动作名，如 lock_settlement_batch、flag_streamer_risk。 */
  动作: string;
  /** 目标业务对象类型。 */
  业务对象?: string;
  /** 目标业务对象 ID。 */
  对象ID?: string;
  /** 高风险动作必须等待人工审批，不能自动执行。 */
  需人工审批?: boolean;
  /** 若声明自动执行，则视为越权（高风险建议不能自动执行）。 */
  自动执行?: boolean;
  参数?: Record<string, unknown>;
};

/** 候选 AI 输出内容（业务结论 + 建议 + 可执行动作）。 */
export type AiOutputContent = {
  结论?: string;
  建议?: string;
  可执行动作?: ExecutableAction[];
};

export type ProductionAuditInput = {
  /** 真实性元数据。 */
  authenticity: AiAuthenticitySignals;
  /** 候选 AI 输出内容。结构化要求：必须是对象，不能用纯自然语言替代。 */
  output: unknown;
  /** 业务对象映射；可显式声明，也可由 objectType 推导。 */
  businessMapping?: string[];
  /** 现有 ai_invocations.object_type，用于推导业务对象。 */
  objectType?: string;
  /** 业务对象 ID，用于判定可入库。 */
  objectId?: string;
  /** 业务流程节点；接受中/英别名。 */
  processNode?: string;
  /** ai_invocations 记录 ID，存在即代表可审计。 */
  invocationId?: string;
  /** 计费金额（分），>0 代表可计费。 */
  costCents?: number;
};

/** 标准结构化裁决结果。 */
export type ProductionAuditVerdict = {
  是否真实AI调用: boolean;
  调用可信等级: CredibilityLevel;
  业务对象映射: BusinessObjectType[];
  流程节点: ProcessNode | null;
  是否可执行: boolean;
  是否可入库: boolean;
  是否通过自检: boolean;
  AI输出内容: {
    结论: string;
    建议: string;
    可执行动作: ExecutableAction[];
  };
  风险项: string[];
  缺失字段: string[];
  最终判定: "通过" | "不通过";
};

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export function auditAiProduction(
  input: ProductionAuditInput,
): ProductionAuditVerdict {
  const 风险项: string[] = [];
  const 缺失字段: string[] = [];

  // —— 闸门一：AI 调用真实性 ————————————————————————————————
  const authMissing = missingAuthenticityFields(input.authenticity);
  缺失字段.push(...authMissing);
  const 是否真实AI调用 = authMissing.length === 0;
  if (!是否真实AI调用) {
    风险项.push(`非生产级 AI 调用：缺少真实性字段 ${authMissing.join("、")}`);
  }

  // —— 闸门二：业务落地性（业务对象映射） ——————————————————————————
  const 业务对象映射 = resolveBusinessMapping(input);
  if (业务对象映射.length === 0) {
    风险项.push("不可落地：无法映射任何 ERP 业务对象");
    缺失字段.push("business_object_mapping");
  }

  // —— 闸门三：流程嵌入（绑定流程节点） ——————————————————————————
  const 流程节点 = resolveProcessNode(input.processNode);
  if (!流程节点) {
    风险项.push("AI 能力未进入业务流：未绑定任何流程节点");
    缺失字段.push("process_node");
  }

  // —— 闸门四：结构化输出 ——————————————————————————————————
  const structured = normalizeStructuredOutput(input.output);
  if (!structured.valid) {
    风险项.push(structured.reason);
    缺失字段.push("structured_output");
  }
  const content = structured.content;

  // 治理：高风险动作不能自动执行，必须人工审批。
  let 治理通过 = true;
  content.可执行动作.forEach((action, index) => {
    if (action.自动执行 === true && action.需人工审批 !== true) {
      治理通过 = false;
      风险项.push(
        `可执行动作[${index}] 越权：声明自动执行但缺少人工审批，高风险建议不能自动执行`,
      );
    }
  });

  // —— 可执行 / 可入库 ——————————————————————————————————
  const actionsWellFormed =
    content.可执行动作.length > 0 &&
    content.可执行动作.every((action) => action.动作.trim().length > 0);
  const 是否可执行 =
    是否真实AI调用 && structured.valid && 治理通过 && actionsWellFormed;

  const 是否可入库 =
    是否真实AI调用 &&
    structured.valid &&
    业务对象映射.length > 0 &&
    (hasText(input.objectId) || hasText(input.invocationId));

  if (!是否可执行 && !是否可入库) {
    风险项.push("结果既不可执行也不可入库：不满足 ERP 落地要求");
  }

  // —— 可审计 / 可计费 ——————————————————————————————————
  if (!hasText(input.invocationId)) {
    风险项.push("未绑定 ai_invocations 记录：无法审计与追踪");
  }

  // —— 调用可信等级 ——————————————————————————————————
  const 调用可信等级 = gradeCredibility(input, 是否真实AI调用);

  // —— 综合自检 ——————————————————————————————————————
  const 是否通过自检 =
    是否真实AI调用 &&
    业务对象映射.length > 0 &&
    流程节点 !== null &&
    structured.valid &&
    治理通过 &&
    (是否可执行 || 是否可入库);

  return {
    是否真实AI调用,
    调用可信等级,
    业务对象映射,
    流程节点,
    是否可执行,
    是否可入库,
    是否通过自检,
    AI输出内容: content,
    风险项,
    缺失字段: dedupe(缺失字段),
    最终判定: 是否通过自检 ? "通过" : "不通过",
  };
}

/**
 * 在业务路径上调用：若 AI 产出不合格，则**拒绝生成可执行结果**并抛错。
 * 调用方应捕获该错误，回退到「不合格 AI 输出」处理（标记、人工复核、降级）。
 */
export function assertProductionGrade(
  input: ProductionAuditInput,
): ProductionAuditVerdict {
  const verdict = auditAiProduction(input);
  if (verdict.最终判定 !== "通过") {
    const reasons = verdict.风险项.join("; ") || "未通过生产级自检";
    throw new Error(`不合格 AI 输出：${reasons}`);
  }
  return verdict;
}

// ---------------------------------------------------------------------------
// 运行时适配器：把 llm-gateway 结果接入审计引擎
// ---------------------------------------------------------------------------

/**
 * 从一次真实 `runAiGateway` 调用结果直接构造审计输入并裁决。
 *
 * 网关只返回结构化输出与运行时账本字段；业务侧补充流程节点、业务对象映射、
 * invocation id 与 prompt 上下文，引擎据此判断该产出是否可执行/可入库。
 */
export function auditGatewayInvocation({
  gatewayResult,
  modelName,
  requestId,
  traceId,
  promptInput,
  timestamp,
  invocationId,
  objectType,
  objectId,
  businessMapping,
  processNode,
}: {
  gatewayResult: AiGatewayResult;
  modelName?: string | null;
  requestId?: string | null;
  traceId?: string | null;
  promptInput?: unknown;
  timestamp?: string | null;
  invocationId?: string;
  objectType?: string;
  objectId?: string;
  businessMapping?: string[];
  processNode?: string;
}): ProductionAuditVerdict {
  return auditAiProduction({
    authenticity: {
      modelName: modelName ?? gatewayResult.providerName ?? null,
      requestId,
      traceId,
      promptInput,
      responseOutput: gatewayResult.structuredOutput ?? gatewayResult.text,
      usage: gatewayResult.usage,
      latencyMs: gatewayResult.latencyMs,
      timestamp,
    },
    output: gatewayResult.structuredOutput,
    businessMapping,
    objectType,
    objectId,
    processNode,
    invocationId,
    costCents: gatewayResult.costCents,
  });
}

// ---------------------------------------------------------------------------
// 闸门实现
// ---------------------------------------------------------------------------

function missingAuthenticityFields(signals: AiAuthenticitySignals): string[] {
  const missing: string[] = [];

  if (!hasText(signals.modelName)) {
    missing.push("model_name");
  }
  if (!hasText(signals.requestId) && !hasText(signals.traceId)) {
    missing.push("request_id");
  }
  if (!isPresentValue(signals.promptInput)) {
    missing.push("prompt_input");
  }
  if (!isPresentValue(signals.responseOutput)) {
    missing.push("response_output");
  }
  if (!hasTokenUsage(signals.usage)) {
    missing.push("token_usage");
  }
  if (!isFiniteNonNegative(signals.latencyMs)) {
    missing.push("latency");
  }
  if (!isValidTimestamp(signals.timestamp)) {
    missing.push("timestamp");
  }

  return missing;
}

function resolveBusinessMapping(
  input: ProductionAuditInput,
): BusinessObjectType[] {
  const candidates = [
    ...(input.businessMapping ?? []),
    ...(input.objectType ? [input.objectType] : []),
  ];

  const mapped = candidates
    .map((value) => BUSINESS_OBJECT_SYNONYMS[normalizeKey(value)])
    .filter((value): value is BusinessObjectType => Boolean(value));

  return dedupe(mapped) as BusinessObjectType[];
}

function resolveProcessNode(node: string | undefined): ProcessNode | null {
  if (!hasText(node)) {
    return null;
  }
  return PROCESS_NODE_SYNONYMS[normalizeKey(node)] ?? null;
}

type StructuredResult =
  | { valid: true; content: NormalizedContent }
  | { valid: false; reason: string; content: NormalizedContent };

type NormalizedContent = {
  结论: string;
  建议: string;
  可执行动作: ExecutableAction[];
};

function normalizeStructuredOutput(output: unknown): StructuredResult {
  const empty: NormalizedContent = { 结论: "", 建议: "", 可执行动作: [] };

  if (typeof output === "string") {
    return {
      valid: false,
      reason: "输出非结构化：使用自然语言替代结构数据",
      content: empty,
    };
  }

  if (!isPlainObject(output)) {
    return {
      valid: false,
      reason: "输出非结构化：缺少标准结构（结论/建议/可执行动作）",
      content: empty,
    };
  }

  const raw = output as Record<string, unknown>;
  const 结论 = typeof raw.结论 === "string" ? raw.结论 : "";
  const 建议 = typeof raw.建议 === "string" ? raw.建议 : "";
  const 可执行动作 = normalizeActions(raw.可执行动作);
  const content: NormalizedContent = { 结论, 建议, 可执行动作 };

  // 结构存在但完全空白（无结论且无可执行动作）视为未产出可用结构。
  if (!hasText(结论) && 可执行动作.length === 0) {
    return {
      valid: false,
      reason: "输出非结构化：结论与可执行动作均为空",
      content,
    };
  }

  // 可执行动作字段必须是数组形态。
  if (raw.可执行动作 !== undefined && !Array.isArray(raw.可执行动作)) {
    return {
      valid: false,
      reason: "输出非结构化：可执行动作必须是数组",
      content,
    };
  }

  return { valid: true, content };
}

function normalizeActions(value: unknown): ExecutableAction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isPlainObject).map((item) => {
    const raw = item as Record<string, unknown>;
    const 动作 =
      typeof raw.动作 === "string"
        ? raw.动作
        : typeof raw.action === "string"
          ? raw.action
          : "";
    const action: ExecutableAction = { 动作 };
    if (typeof raw.业务对象 === "string") action.业务对象 = raw.业务对象;
    if (typeof raw.对象ID === "string") action.对象ID = raw.对象ID;
    if (typeof raw.需人工审批 === "boolean") action.需人工审批 = raw.需人工审批;
    if (typeof raw.自动执行 === "boolean") action.自动执行 = raw.自动执行;
    if (isPlainObject(raw.参数))
      action.参数 = raw.参数 as Record<string, unknown>;
    return action;
  });
}

function gradeCredibility(
  input: ProductionAuditInput,
  是否真实AI调用: boolean,
): CredibilityLevel {
  if (!是否真实AI调用) {
    return "无";
  }

  const usage = input.authenticity.usage;
  let score = 0;
  if (
    isFinitePositive(usage?.promptTokens) &&
    isFinitePositive(usage?.completionTokens)
  ) {
    score += 1; // token 实际消耗
  }
  if (isFinitePositive(input.authenticity.latencyMs)) {
    score += 1; // 真实耗时
  }
  if (
    hasText(input.authenticity.requestId) &&
    hasText(input.authenticity.traceId)
  ) {
    score += 1; // 双链路可追踪
  }
  if (hasText(input.invocationId)) {
    score += 1; // 可审计
  }
  if (isFinitePositive(input.costCents)) {
    score += 1; // 可计费
  }

  if (score >= 4) return "高";
  if (score >= 2) return "中";
  return "低";
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPresentValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function hasTokenUsage(usage: Partial<AiUsage> | null | undefined): boolean {
  if (!usage) return false;
  return (
    isFiniteNonNegative(usage.promptTokens) &&
    isFiniteNonNegative(usage.completionTokens)
  );
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isValidTimestamp(value: unknown): value is string {
  return hasText(value) && !Number.isNaN(Date.parse(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
