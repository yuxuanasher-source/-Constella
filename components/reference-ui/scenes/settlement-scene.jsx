"use client";
/* eslint-disable */
import React from "react";

const SETTLEMENT_METHOD_OPTIONS = [
  { value: "cpt", label: "CPT" },
  { value: "cpa", label: "CPA" },
  { value: "cps", label: "CPS" },
  { value: "gift", label: "礼物流水" },
  { value: "base_salary", label: "保底" },
  { value: "base_salary_cpt", label: "保底 + CPT" },
  { value: "manual", label: "手动结算" },
];

function settlementProjectOptions({
  projects = [],
  batches = [],
  settlementPool = [],
  settlementScope = null,
}) {
  const options = new Map();
  const upsert = (projectId, projectName, source = {}) => {
    const id = cleanSettlementText(projectId);
    if (!id) return;

    const existing = options.get(id) || {};
    // A "name" that is empty, UUID-like, or equal to the project id itself is
    // not a real label — a manually-entered project id flows through here as
    // the name. Ignore it so an already-resolved real name (or the formatted
    // displayRecordId fallback) wins instead of showing a raw UUID.
    const resolveName = (value) => {
      const text = cleanSettlementText(value);
      return text && text !== id && !isUuidLikeId(text) ? text : "";
    };
    const name =
      resolveName(source.name) ||
      resolveName(projectName) ||
      cleanSettlementText(existing.name) ||
      displayRecordId(id, "项目记录");

    options.set(id, {
      id,
      name,
      code: cleanSettlementText(source.code) || existing.code || "",
      pricing: cleanSettlementText(source.pricing) || existing.pricing || "",
      start: cleanSettlementText(source.start) || existing.start || "",
      end: cleanSettlementText(source.end) || existing.end || "",
      metrics: source.metrics || existing.metrics || {},
      defaultSettlementMethod:
        source.defaultSettlementMethod ?? existing.defaultSettlementMethod,
      defaultHourlyRate:
        source.defaultHourlyRate ?? existing.defaultHourlyRate ?? "",
      defaultBaseSalary:
        source.defaultBaseSalary ?? existing.defaultBaseSalary ?? "",
      defaultSettlementRule:
        source.defaultSettlementRule ?? existing.defaultSettlementRule ?? {},
    });
  };

  projects.forEach((project) => {
    upsert(project.id || project.projectId || project.name, project.name, {
      name: project.name,
      code: project.code,
      pricing: project.pricing,
      start: project.start,
      end: project.end,
      metrics: project.metrics,
      defaultSettlementMethod: project.defaultSettlementMethod,
      defaultHourlyRate: project.defaultHourlyRate,
      defaultBaseSalary: project.defaultBaseSalary,
      defaultSettlementRule: project.defaultSettlementRule,
    });
  });
  batches.forEach((batch) => {
    upsert(batch.projectId || batch.project, batch.project);
  });
  settlementPool.forEach((row) => {
    upsert(row.projectId || row.project, row.project);
  });
  if (settlementScope?.projectId) {
    const scopeName =
      settlementScope.projectName ||
      settlementScope.project ||
      (settlementPool.length === 1 ? settlementPool[0]?.project : "") ||
      "";
    upsert(settlementScope.projectId, scopeName);
  }

  return Array.from(options.values());
}

function filterSettlementRowsByProject(rows, projectId, projectName) {
  const id = cleanSettlementText(projectId);
  const name = cleanSettlementText(projectName);
  if (!id && !name) return rows;

  return rows.filter((row) => {
    const rowProjectId = cleanSettlementText(row.projectId || row.project_id);
    const rowProjectName = cleanSettlementText(row.project || row.projectName);
    return (
      (id && rowProjectId === id) ||
      (id && rowProjectName === id) ||
      (name && rowProjectName === name)
    );
  });
}

function settlementRuleDraft(project) {
  const rule = settlementRuleObject(project?.defaultSettlementRule);
  return {
    defaultSettlementMethod:
      project?.defaultSettlementMethod ||
      settlementMethodFromPricing(project?.pricing),
    defaultHourlyRate:
      project?.defaultHourlyRate || project?.defaultHourlyRate === 0
        ? String(project.defaultHourlyRate)
        : "",
    defaultBaseSalary:
      project?.defaultBaseSalary || project?.defaultBaseSalary === 0
        ? String(project.defaultBaseSalary)
        : "",
    defaultSettlementRule: builderRuleFromStored(rule),
  };
}

function settlementRuleObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function settlementMethodFromPricing(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("base_salary_cpt") || text.includes("保底 + cpt")) {
    return "base_salary_cpt";
  }
  if (text.includes("base_salary") || text.includes("保底")) {
    return "base_salary";
  }
  if (text.includes("cps")) return "cps";
  if (text.includes("cpa")) return "cpa";
  if (text.includes("gift") || text.includes("礼物")) return "gift";
  if (text.includes("manual") || text.includes("手动")) return "manual";
  return "cpt";
}

function cleanSettlementText(value) {
  return String(value || "").trim();
}

// ===== src\screen-settlement.jsx =====
// ——— Screen: 结算中心 ————————————————————————————

const CUSTOM_RULE_PROJECT_TARGET = Object.freeze({
  targetType: "project",
  targetId: null,
});

function buildExternalCostResolutionValue(draft) {
  const raw = draft?.reviewedValue;
  const valueType = draft?.valueType || "money_cents";
  if (valueType === "money_cents") {
    const amountCents = yuanInputToCents(raw);
    return amountCents === null ? null : { type: "money_cents", amountCents };
  }
  if (valueType === "rate_bps") {
    const percent = Number(raw);
    if (!Number.isFinite(percent) || percent < 0) return null;
    return { type: "rate_bps", rateBps: Math.round(percent * 100) };
  }
  if (valueType === "integer") {
    const value = Number(raw);
    return Number.isSafeInteger(value) ? { type: "integer", value } : null;
  }
  if (valueType === "number") {
    const value = Number(raw);
    return Number.isFinite(value) ? { type: "number", value } : null;
  }
  if (valueType === "boolean") {
    if (raw === "true") return { type: "boolean", value: true };
    if (raw === "false") return { type: "boolean", value: false };
    return null;
  }
  if (valueType === "timestamp") {
    return raw ? { type: "timestamp", value: String(raw) } : null;
  }
  return raw ? { type: "string", value: String(raw) } : null;
}

let Avatar,
  BATCH_DETAIL_ITEMS,
  BATCH_STATUS,
  BATCHES,
  Badge,
  Button,
  COST_DIRECTION_OPTIONS,
  COST_EVIDENCE_OPTIONS,
  COST_ITEM_TYPE_OPTIONS,
  Card,
  CollapsibleSection,
  CustomSettlementRuleWorkspace,
  DataTable,
  EmptyHint,
  Icon,
  KV,
  MiniStat,
  OpsLiveDataContext,
  PageHeader,
  ProjectFinancialSettings,
  SettlementRuleBuilder,
  Tabs,
  TaskFormLabel,
  auditModuleLabel,
  auditModuleTone,
  batchStatusMeta,
  builderRuleFromStored,
  buildCostItemPayload,
  buildReconciliationCheckGroups,
  buildReconciliationRows,
  canConfirmCostItem,
  canFinanceConfirmSettlementBatch,
  canVoidCostItem,
  costStatusLabel,
  costStatusTone,
  defaultCostDraft,
  displayRecordId,
  draftNumber,
  draftPercentToBps,
  financialDraftFromProject,
  formatOpsMinute,
  formatYuanFromCents,
  getAllowedProjectStatusTransitions,
  isCustomSettlementRulesEnabled,
  isUuidLikeId,
  reconciliationBlockMessage,
  reconciliationGate,
  reconciliationRunMeta,
  reconciliationSeverityTone,
  riskFlagLabel,
  serializeBuilderRule,
  serializeFinancialDraft,
  taskInputStyle,
  useOpsAuditEntries,
  useOpsComplexCost,
  useOpsCurrentUser,
  useOpsLiveActions,
  useOpsProjects,
  useOpsSettlementBatchDetails,
  useOpsSettlementBatches,
  useOpsSettlementPool,
  useOpsSettlementScope,
  useOpsStreamers,
  warnBackgroundRefreshFailure,
  yuanInputToCents;

let configuredSettlementDependencies = null;

export function configureSettlementScene(dependencies) {
  if (configuredSettlementDependencies) {
    if (configuredSettlementDependencies !== dependencies) {
      throw new Error("Settlement scene dependencies cannot be reconfigured");
    }
    return;
  }
  ({
    Avatar,
    BATCH_DETAIL_ITEMS,
    BATCH_STATUS,
    BATCHES,
    Badge,
    Button,
    COST_DIRECTION_OPTIONS,
    COST_EVIDENCE_OPTIONS,
    COST_ITEM_TYPE_OPTIONS,
    Card,
    CollapsibleSection,
    CustomSettlementRuleWorkspace,
    DataTable,
    EmptyHint,
    Icon,
    KV,
    MiniStat,
    OpsLiveDataContext,
    PageHeader,
    ProjectFinancialSettings,
    SettlementRuleBuilder,
    Tabs,
    TaskFormLabel,
    auditModuleLabel,
    auditModuleTone,
    batchStatusMeta,
    builderRuleFromStored,
    buildCostItemPayload,
    buildReconciliationCheckGroups,
    buildReconciliationRows,
    canConfirmCostItem,
    canFinanceConfirmSettlementBatch,
    canVoidCostItem,
    costStatusLabel,
    costStatusTone,
    defaultCostDraft,
    displayRecordId,
    draftNumber,
    draftPercentToBps,
    financialDraftFromProject,
    formatOpsMinute,
    formatYuanFromCents,
    getAllowedProjectStatusTransitions,
    isCustomSettlementRulesEnabled,
    isUuidLikeId,
    reconciliationBlockMessage,
    reconciliationGate,
    reconciliationRunMeta,
    reconciliationSeverityTone,
    riskFlagLabel,
    serializeBuilderRule,
    serializeFinancialDraft,
    taskInputStyle,
    useOpsAuditEntries,
    useOpsComplexCost,
    useOpsCurrentUser,
    useOpsLiveActions,
    useOpsProjects,
    useOpsSettlementBatchDetails,
    useOpsSettlementBatches,
    useOpsSettlementPool,
    useOpsSettlementScope,
    useOpsStreamers,
    warnBackgroundRefreshFailure,
    yuanInputToCents,
  } = dependencies);
  configuredSettlementDependencies = dependencies;
}

export default function ScreenSettlement({ go }) {
  if (!configuredSettlementDependencies) {
    throw new Error("Settlement scene dependencies are not configured");
  }
  const projects = useOpsProjects();
  const { projects: projectData, settlementPool: settlementPoolData } =
    React.useContext(OpsLiveDataContext);
  const batches = useOpsSettlementBatches();
  const batchDetails = useOpsSettlementBatchDetails();
  const settlementPool = useOpsSettlementPool();
  const settlementScope = useOpsSettlementScope();
  const complexCost = useOpsComplexCost();
  const actions = useOpsLiveActions();
  const streamers = useOpsStreamers();
  const customRulesEnabled = isCustomSettlementRulesEnabled();
  const projectOptions = React.useMemo(
    () =>
      settlementProjectOptions({
        projects,
        batches,
        settlementPool,
        settlementScope,
      }),
    [projects, batches, settlementPool, settlementScope],
  );
  const [selectedProjectId, setSelectedProjectId] = React.useState(
    settlementScope?.projectId || projectOptions[0]?.id || "",
  );
  // 结算周期：默认取服务端默认结算范围，可在页头自选；改周期或切项目都会
  // 按「项目 + 周期」重新拉取可结算池。
  const [settlementPeriod, setSettlementPeriod] = React.useState({
    start: settlementScope?.periodStart || "",
    end: settlementScope?.periodEnd || "",
  });
  const [type, setType] = React.useState("all");
  const [busyAction, setBusyAction] = React.useState(null);
  const [activeId, setActiveId] = React.useState(batches[0]?.id ?? null);
  const [detailTab, setDetailTab] = React.useState("summary");
  const [batchFormOpen, setBatchFormOpen] = React.useState(false);
  const [manualFormOpen, setManualFormOpen] = React.useState(false);
  const [settlementMessage, setSettlementMessage] = React.useState("");
  const [streamerRuleDraft, setStreamerRuleDraft] = React.useState({
    streamerId: "",
    settlementMethod: "cpt",
    hourlyRate: "",
    baseSalary: "",
    cpsRatePercent: "",
    reason: "",
  });
  const [batchDraft, setBatchDraft] = React.useState({
    projectId: settlementScope?.projectId || "",
    periodStart: settlementScope?.periodStart || "",
    periodEnd: settlementScope?.periodEnd || "",
    batchType: "payable",
    title: "",
  });
  // 建批次的参与主播勾选：null = 未手动改动过（默认全选池内主播）。
  const [batchStreamerIds, setBatchStreamerIds] = React.useState(null);
  const [manualDraft, setManualDraft] = React.useState({
    itemType: "cpa",
    manualAmount: "300",
    evidenceLevel: "red",
    reason: "人工录入 CPA/CPS/礼物金额",
  });
  const [lockReason, setLockReason] = React.useState("财务核对无误");
  const [ruleDraft, setRuleDraft] = React.useState(() =>
    settlementRuleDraft(projectOptions[0]),
  );
  const [financialDraft, setFinancialDraft] = React.useState(() =>
    financialDraftFromProject(projectOptions[0]),
  );
  const [reconciliation, setReconciliation] = React.useState(null);
  // Identifies the project + period the current reconciliation verdict was run
  // for, so a stale verdict from a different period (same project) never gates
  // another batch's lock.
  const [reconciliationKey, setReconciliationKey] = React.useState(null);
  const [costItems, setCostItems] = React.useState([]);
  const [costItemsLoadedFor, setCostItemsLoadedFor] = React.useState(null);
  const [costRuleExceptions, setCostRuleExceptions] = React.useState([]);
  const [costExceptionDrafts, setCostExceptionDrafts] = React.useState({});
  const [costDraft, setCostDraft] = React.useState(() => defaultCostDraft());
  const reconciliationBlockingHeadingRef = React.useRef(null);

  React.useEffect(() => {
    if (
      projectData == null &&
      settlementPoolData == null &&
      actions.refreshProjects
    ) {
      actions
        .refreshProjects()
        .catch((error) =>
          warnBackgroundRefreshFailure("settlement projects", error),
        );
    }
  }, [actions, projectData, settlementPoolData]);

  React.useEffect(() => {
    if (!projectOptions.length) return;
    if (!selectedProjectId) {
      setSelectedProjectId(projectOptions[0].id);
      return;
    }
    if (!projectOptions.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projectOptions[0].id);
    }
  }, [projectOptions, selectedProjectId]);

  const selectedProject =
    projectOptions.find((project) => project.id === selectedProjectId) ||
    projectOptions[0] ||
    null;
  const selectedProjectName = selectedProject?.name || "";
  const projectBatches = React.useMemo(
    () =>
      filterSettlementRowsByProject(
        batches,
        selectedProjectId,
        selectedProjectName,
      ),
    [batches, selectedProjectId, selectedProjectName],
  );
  const projectSettlementPool = React.useMemo(
    () =>
      filterSettlementRowsByProject(
        settlementPool,
        selectedProjectId,
        selectedProjectName,
      ),
    [settlementPool, selectedProjectId, selectedProjectName],
  );
  // 池内出现过的主播（去重），作为建批次时「参与主播」勾选项。
  const poolStreamers = React.useMemo(() => {
    const seen = new Map();
    projectSettlementPool.forEach((row) => {
      if (row.streamerId && !seen.has(row.streamerId)) {
        seen.set(row.streamerId, row.streamer || row.streamerId);
      }
    });
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [projectSettlementPool]);
  const selectedBatchStreamerIds = React.useMemo(() => {
    if (batchStreamerIds === null) {
      return poolStreamers.map((streamer) => streamer.id);
    }
    const poolIds = new Set(poolStreamers.map((streamer) => streamer.id));
    return batchStreamerIds.filter((id) => poolIds.has(id));
  }, [batchStreamerIds, poolStreamers]);
  const toggleBatchStreamer = (streamerId) => {
    setBatchStreamerIds(() => {
      const current = new Set(selectedBatchStreamerIds);
      if (current.has(streamerId)) {
        current.delete(streamerId);
      } else {
        current.add(streamerId);
      }
      return Array.from(current);
    });
  };

  React.useEffect(() => {
    if (!projectBatches.some((b) => b.id === activeId)) {
      setActiveId(projectBatches[0]?.id ?? null);
    }
  }, [activeId, projectBatches]);

  // 批次明细按需加载：项目页等入口的 SSR 不再预载全组织批次明细，首次查看
  // 某个批次且明细缺失时拉一次该批次（结果缓存进 batchDetailsState）。
  //   - 演示兜底批次（BATCHES）没有后端记录，跳过；
  //   - busyAction 期间不拉：结算动作内部（如新建批次）已按需刷新明细，
  //     避免与动作过程中的中间状态赛跑造成重复请求；
  //   - ref 去重：同一批次失败后不在本次挂载内反复重试。
  const requestedBatchDetailIdsRef = React.useRef(new Set());
  React.useEffect(() => {
    if (!activeId || busyAction || !actions.refreshSettlementBatchDetail) {
      return;
    }
    if (batchDetails[activeId] != null) return;
    if (BATCHES.some((batch) => batch.id === activeId)) return;
    if (requestedBatchDetailIdsRef.current.has(activeId)) return;
    requestedBatchDetailIdsRef.current.add(activeId);
    actions
      .refreshSettlementBatchDetail(activeId)
      .catch((error) =>
        warnBackgroundRefreshFailure("settlement batch detail", error),
      );
  }, [actions, activeId, batchDetails, busyAction]);

  React.useEffect(() => {
    setRuleDraft(settlementRuleDraft(selectedProject));
    setFinancialDraft(financialDraftFromProject(selectedProject));
  }, [selectedProject]);

  const filtered =
    type === "all"
      ? projectBatches
      : projectBatches.filter((b) => b.type === type);
  const activeBatch =
    projectBatches.find((batch) => batch.id === activeId) ||
    projectBatches[0] ||
    null;
  const activeBatchDetailRows = activeBatch
    ? (batchDetails[activeBatch.id] ?? [])
    : [];
  const activeBatchHasRedEvidence = activeBatchDetailRows.some(
    (row) => String(row.evidenceLevel).toLowerCase() === "red",
  );
  // 默认 scope 的 poolCount 兜底只在「默认项目 + 默认周期」下成立。
  const poolCount =
    projectSettlementPool.length > 0
      ? projectSettlementPool.length
      : selectedProjectId === settlementScope?.projectId &&
          settlementPeriod.start === (settlementScope?.periodStart || "") &&
          settlementPeriod.end === (settlementScope?.periodEnd || "")
        ? (settlementScope?.poolCount ?? 0)
        : 0;
  const settlementSummary = React.useMemo(() => {
    const vendorBatches = projectBatches.filter((batch) => {
      return batch.type === "vendor_receivable";
    });
    const lockedPayableBatches = projectBatches.filter((batch) => {
      return batch.type === "streamer_payable" && batch.status === "locked";
    });
    const vendorReceivable = sumSettlementBatchAmounts(vendorBatches);
    const lockedPayable = sumSettlementBatchAmounts(lockedPayableBatches);
    const gross = vendorReceivable - lockedPayable;
    const marginRate =
      vendorReceivable > 0 ? (gross / vendorReceivable) * 100 : 0;

    return {
      vendorReceivable,
      vendorBatchCount: vendorBatches.length,
      lockedPayable,
      lockedPayableBatchCount: lockedPayableBatches.length,
      gross,
      marginRate,
    };
  }, [projectBatches]);

  const runSettlementAction = async (actionName, fn) => {
    if (busyAction) return;
    setBusyAction(actionName);
    try {
      const shouldReload = await fn();
      if (shouldReload !== false) {
        globalThis.location?.reload();
      }
    } catch (error) {
      globalThis.alert?.(
        error instanceof Error ? error.message : "结算操作失败",
      );
    } finally {
      setBusyAction(null);
    }
  };

  React.useEffect(() => {
    setBatchDraft((draft) => ({
      ...draft,
      projectId:
        selectedProjectId ||
        draft.projectId ||
        settlementScope?.projectId ||
        activeBatch?.projectId ||
        "",
      periodStart: draft.periodStart || settlementPeriod.start || "",
      periodEnd: draft.periodEnd || settlementPeriod.end || "",
    }));
  }, [activeBatch, selectedProjectId, settlementScope, settlementPeriod]);

  // 服务端只预载了「默认项目 + 默认周期」的可结算池：项目或周期任一变化
  // 都要按新范围重新拉取，否则池子（报数）只对默认范围有数据。
  const reloadSettlementPool = (projectId, period) => {
    if (
      !actions.refreshSettlementPool ||
      !period.start ||
      !period.end ||
      period.start > period.end
    ) {
      return;
    }
    actions
      .refreshSettlementPool({
        projectId,
        periodStart: period.start,
        periodEnd: period.end,
        batchType: settlementScope?.batchType,
      })
      .catch((error) => warnBackgroundRefreshFailure("settlement pool", error));
  };

  const selectProject = (event) => {
    const projectId = event.target.value;
    setSelectedProjectId(projectId);
    setActiveId(null);
    setBatchDraft((draft) => ({ ...draft, projectId }));
    setSettlementMessage("");
    setReconciliation(null);
    setReconciliationKey(null);
    setCostItems([]);
    setCostItemsLoadedFor(null);
    reloadSettlementPool(projectId, settlementPeriod);
  };

  const changeSettlementPeriod = (field) => (event) => {
    const next = { ...settlementPeriod, [field]: event.target.value };
    setSettlementPeriod(next);
    // 创建批次的周期默认值跟随当前查看的周期，避免池子和批次口径不一致。
    setBatchDraft((draft) => ({
      ...draft,
      periodStart: next.start,
      periodEnd: next.end,
    }));
    reloadSettlementPool(selectedProjectId, next);
  };

  const updateCostDraft = (field) => (event) =>
    setCostDraft((draft) => ({ ...draft, [field]: event.target.value }));

  const updateCostExceptionDraft = (exceptionId, field) => (event) =>
    setCostExceptionDrafts((drafts) => ({
      ...drafts,
      [exceptionId]: {
        valueType: "money_cents",
        reviewedValue: "",
        reason: "",
        ...(drafts[exceptionId] ?? {}),
        [field]: event.target.value,
      },
    }));

  const reloadCostItems = async (projectId) => {
    const items = await actions.fetchProjectCostItems?.(projectId);
    const nextItems = Array.isArray(items) ? items : [];
    setCostItems(nextItems);
    setCostItemsLoadedFor(projectId);
    const itemBatchIds = [
      ...new Set(
        nextItems
          .map((item) => item.sourceImportBatchId)
          .filter((batchId) => typeof batchId === "string" && batchId),
      ),
    ];
    let exceptionBatchSummaries = [];
    try {
      exceptionBatchSummaries =
        (await actions.fetchExternalCostRuleExceptionBatches?.(projectId)) ??
        [];
    } catch {
      exceptionBatchSummaries = [];
    }
    const exceptionBatchIds = Array.isArray(exceptionBatchSummaries)
      ? exceptionBatchSummaries
          .map((batch) => batch?.importBatchId || batch?.id)
          .filter((batchId) => typeof batchId === "string" && batchId)
      : [];
    const batchIds = [...new Set([...itemBatchIds, ...exceptionBatchIds])];
    if (!actions.fetchExternalCostRuleExceptions || batchIds.length === 0) {
      setCostRuleExceptions([]);
      return;
    }
    const groups = await Promise.all(
      batchIds.map(async (batchId) => {
        const exceptions = await actions.fetchExternalCostRuleExceptions(
          projectId,
          batchId,
        );
        return Array.isArray(exceptions)
          ? exceptions.map((exception) => ({
              ...exception,
              importBatchId: exception.importBatchId || batchId,
            }))
          : [];
      }),
    );
    const nextExceptions = groups.flat();
    setCostRuleExceptions(nextExceptions);
    setCostExceptionDrafts((drafts) => {
      const nextDrafts = { ...drafts };
      nextExceptions.forEach((exception) => {
        if (!nextDrafts[exception.id]) {
          nextDrafts[exception.id] = {
            valueType: "money_cents",
            reviewedValue: "",
            reason: "",
          };
        }
      });
      return nextDrafts;
    });
  };

  const loadCostItems = () =>
    runSettlementAction("cost-load", async () => {
      const costProjectId = selectedProjectId || selectedProject?.id || "";
      if (!costProjectId) {
        setSettlementMessage("请先选择结算项目");
        return false;
      }
      await reloadCostItems(costProjectId);
      setSettlementMessage("");
      return false;
    });

  const submitCostItem = (event) => {
    event?.preventDefault?.();
    return runSettlementAction("cost-create", async () => {
      if (!selectedProjectId) {
        setSettlementMessage("请先选择结算项目");
        return false;
      }
      const built = buildCostItemPayload(costDraft);
      if (built.error) {
        setSettlementMessage(built.error);
        return false;
      }
      await actions.createProjectCostItem?.(selectedProjectId, built.payload);
      await reloadCostItems(selectedProjectId);
      setCostDraft(defaultCostDraft());
      setSettlementMessage("外部成本已录入（待确认）");
      return false;
    });
  };

  const reviewCostItem = (itemId, status) =>
    runSettlementAction(`cost-review-${itemId}`, async () => {
      if (!selectedProjectId) return false;
      const reason = globalThis.prompt?.(
        status === "confirmed" ? "确认入账原因" : "作废原因",
      );
      if (!reason || !reason.trim()) {
        setSettlementMessage("操作已取消：需填写原因");
        return false;
      }
      await actions.reviewProjectCostItem?.(selectedProjectId, itemId, {
        status,
        reason: reason.trim(),
      });
      await reloadCostItems(selectedProjectId);
      setSettlementMessage("");
      return false;
    });

  const resolveCostRuleException = (exception) =>
    runSettlementAction(`cost-exception-${exception.id}`, async () => {
      const costProjectId = selectedProjectId || selectedProject?.id || "";
      if (!costProjectId || !exception.importBatchId) {
        setSettlementMessage("缺少项目或导入批次，无法复核异常");
        return false;
      }
      const draft = costExceptionDrafts[exception.id] ?? {
        valueType: "money_cents",
        reviewedValue: "",
        reason: "",
      };
      const resolutionValue = buildExternalCostResolutionValue(draft);
      if (!resolutionValue) {
        setSettlementMessage("请填写有效的复核值");
        return false;
      }
      if (!draft.reason?.trim()) {
        setSettlementMessage("请填写复核原因");
        return false;
      }
      const result = await actions.resolveExternalCostRuleException?.(
        costProjectId,
        exception.importBatchId,
        exception.id,
        {
          resolutionValue,
          resolutionReason: draft.reason.trim(),
        },
      );
      await reloadCostItems(costProjectId);
      setSettlementMessage(
        result?.replay?.replayed
          ? "异常已复核，公式成本已重新生成并等待审核"
          : "异常已复核，等待同批次其他异常处理",
      );
      return false;
    });

  const reconciliationKeyOf = (projectId, periodStart, periodEnd) =>
    `${projectId}|${periodStart}|${periodEnd}`;

  const reconciliationPeriod = () => ({
    projectId: selectedProjectId || activeBatch?.projectId || "",
    periodStart: activeBatch?.periodStart || batchDraft.periodStart || "",
    periodEnd: activeBatch?.periodEnd || batchDraft.periodEnd || "",
  });

  const runReconciliation = () =>
    runSettlementAction("reconcile", async () => {
      const { projectId, periodStart, periodEnd } = reconciliationPeriod();
      if (!projectId || !periodStart || !periodEnd) {
        setSettlementMessage("请先选择项目并设置结算周期再运行校验");
        return false;
      }
      const result = await actions.fetchSettlementReconciliation?.({
        projectId,
        periodStart,
        periodEnd,
      });
      setReconciliation(result ?? null);
      setReconciliationKey(
        reconciliationKeyOf(projectId, periodStart, periodEnd),
      );
      setSettlementMessage("");
      return false;
    });

  // Gate the active batch's lock on the §3.4 reconciliation verdict: the check
  // must have been run for this batch's exact project + period and must not be
  // blocking. Keying on project + period prevents a stale verdict from another
  // period of the same project from gating this batch.
  const activeReconciliation =
    activeBatch &&
    reconciliationKey ===
      reconciliationKeyOf(
        activeBatch.projectId,
        activeBatch.periodStart,
        activeBatch.periodEnd,
      )
      ? reconciliation
      : null;
  const activeGate = reconciliationGate(activeReconciliation);
  const reconciliationMeta = reconciliation
    ? reconciliationRunMeta(reconciliation)
    : null;
  const reconciliationGroups = reconciliation
    ? buildReconciliationCheckGroups(reconciliation)
    : [];

  React.useEffect(() => {
    if (reconciliationGate(reconciliation).hasBlocking) {
      reconciliationBlockingHeadingRef.current?.focus();
    }
  }, [reconciliation]);

  const updateBatchDraft = (field) => (event) => {
    setBatchDraft((draft) => ({ ...draft, [field]: event.target.value }));
  };
  const updateManualDraft = (field) => (event) => {
    setManualDraft((draft) => ({ ...draft, [field]: event.target.value }));
  };
  const updateRuleDraft = (field) => (event) => {
    setRuleDraft((draft) => ({ ...draft, [field]: event.target.value }));
  };

  const createBatch = (event) => {
    event?.preventDefault?.();
    return runSettlementAction("create", async () => {
      const { projectId, periodStart, periodEnd, batchType, title } =
        batchDraft;
      if (!projectId || !periodStart || !periodEnd || !batchType) {
        setSettlementMessage("请填写完整结算批次信息");
        return false;
      }
      if (poolStreamers.length > 0 && selectedBatchStreamerIds.length === 0) {
        setSettlementMessage("请至少勾选一位参与本次结算的主播");
        return false;
      }

      // 勾选了全部主播时不传过滤参数，保持「全量入批」旧语义。
      const isSubsetSelection =
        poolStreamers.length > 0 &&
        selectedBatchStreamerIds.length < poolStreamers.length;
      await actions.createSettlementBatch?.({
        projectId,
        periodStart,
        periodEnd,
        batchType,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(isSubsetSelection ? { streamerIds: selectedBatchStreamerIds } : {}),
      });
      setBatchFormOpen(false);
      setBatchStreamerIds(null);
      setBatchDraft((draft) => ({ ...draft, title: "" }));
      setSettlementMessage("");
      return false;
    });
  };

  const addManualItem = (event) => {
    event?.preventDefault?.();
    return runSettlementAction("manual", async () => {
      if (!activeBatch) return false;
      const manualAmount = Number(manualDraft.manualAmount);
      if (!manualDraft.itemType || !manualAmount || !manualDraft.reason) {
        setSettlementMessage("请填写完整人工调整信息");
        return false;
      }

      await actions.addManualSettlementItem?.(activeBatch.id, {
        itemType: manualDraft.itemType,
        manualAmount,
        evidenceLevel:
          manualDraft.evidenceLevel === "yellow" ? "yellow" : "red",
        reason: manualDraft.reason,
        projectId: activeBatch.projectId,
      });
      setManualFormOpen(false);
      setSettlementMessage("");
      return false;
    });
  };

  const lockBatch = () =>
    runSettlementAction("lock", async () => {
      if (!activeBatch) return false;
      if (!activeGate.evaluated) {
        setSettlementMessage("锁定前请先为本批次周期运行「单项目结算校验」");
        return false;
      }
      if (!activeGate.canLock) {
        setSettlementMessage(reconciliationBlockMessage(activeReconciliation));
        return false;
      }
      const reason = lockReason.trim();
      if (!reason) {
        setSettlementMessage(
          activeBatchHasRedEvidence
            ? "锁定前请填写红证据确认原因"
            : "锁定前请填写锁定原因",
        );
        return false;
      }
      await actions.lockSettlementBatch?.(activeBatch.id, {
        reason,
      });
      return false;
    });

  const reopenBatch = () =>
    runSettlementAction("reopen", async () => {
      if (!activeBatch) return false;
      await actions.reopenSettlementBatch?.(activeBatch.id, {
        reason: "需要修正结算金额",
      });
      return false;
    });

  const confirmBatch = () =>
    runSettlementAction("confirm", async () => {
      if (!activeBatch) return false;
      if (!activeGate.evaluated) {
        setSettlementMessage("确认前请先为本批次周期运行「单项目结算校验」");
        return false;
      }
      if (!activeGate.canLock) {
        setSettlementMessage(reconciliationBlockMessage(activeReconciliation));
        return false;
      }
      const reason = globalThis.prompt?.(
        activeBatchHasRedEvidence ? "红证据确认原因" : "财务确认原因",
      );
      if (!reason || !reason.trim()) {
        setSettlementMessage("操作已取消：财务确认需填写原因");
        return false;
      }
      await actions.confirmSettlementBatch?.(activeBatch.id, {
        reason: reason.trim(),
      });
      setSettlementMessage("结算批次已财务确认");
      return false;
    });

  const notifyBatchStreamers = () =>
    runSettlementAction("notify", async () => {
      if (!activeBatch) return false;
      const result = await actions.notifySettlementBatchStreamers?.(
        activeBatch.id,
      );
      setSettlementMessage(
        result
          ? `薪资明细已发送给 ${result.notified} 位主播${
              result.skipped ? `，${result.skipped} 位未绑定登录账号已跳过` : ""
            }`
          : "薪资明细已发送",
      );
      return false;
    });

  // 结算完成 → 归档引导：当前项目的批次全部锁定（或作废）且项目状态
  // 允许流转到「已归档」时，展示一键归档提示条。
  const selectedProjectRecord = React.useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const archiveGuide = React.useMemo(() => {
    if (!selectedProjectRecord || projectBatches.length === 0) {
      return null;
    }
    const allFinalized = projectBatches.every(
      (batch) => batch.status === "locked" || batch.status === "voided",
    );
    if (!allFinalized || selectedProjectRecord.status === "archived") {
      return null;
    }
    const allowed =
      getAllowedProjectStatusTransitions(selectedProjectRecord.status) || [];
    if (!allowed.includes("archived")) {
      return null;
    }
    return {
      projectId: selectedProjectRecord.id,
      name: selectedProjectRecord.name,
    };
  }, [selectedProjectRecord, projectBatches]);
  const archiveSettledProject = () =>
    runSettlementAction("archive", async () => {
      if (!archiveGuide) return false;
      await actions.updateProjectBasics?.(archiveGuide.projectId, {
        status: "archived",
      });
      setSettlementMessage(`项目「${archiveGuide.name}」已归档`);
      return false;
    });
  const saveProjectRule = (event) => {
    event?.preventDefault?.();
    return runSettlementAction("project-rule", async () => {
      if (!selectedProjectId) {
        setSettlementMessage("请选择结算项目");
        return false;
      }
      await actions.updateProjectSettlementRule?.(selectedProjectId, {
        defaultSettlementMethod: ruleDraft.defaultSettlementMethod,
        defaultHourlyRate: draftNumber(ruleDraft.defaultHourlyRate),
        defaultBaseSalary: draftNumber(ruleDraft.defaultBaseSalary),
        defaultSettlementRule: serializeBuilderRule(
          ruleDraft.defaultSettlementRule,
        ),
        reason: "结算中心项目规则调整",
      });
      setSettlementMessage("项目结算规则已保存");
      return false;
    });
  };
  const updateStreamerRuleDraft = (field) => (event) => {
    setStreamerRuleDraft((draft) => ({
      ...draft,
      [field]: event.target.value,
    }));
  };
  const streamerRuleOptions = React.useMemo(
    () =>
      (Array.isArray(streamers) ? streamers : [])
        .map((streamer) => ({
          id: streamer?.id,
          name:
            streamer?.alias ||
            streamer?.name ||
            streamer?.displayName ||
            streamer?.id,
        }))
        .filter((option) => option.id),
    [streamers],
  );
  const saveStreamerRule = (event) => {
    event?.preventDefault?.();
    return runSettlementAction("streamer-rule", async () => {
      if (!selectedProjectId) {
        setSettlementMessage("请选择结算项目");
        return false;
      }
      if (!streamerRuleDraft.streamerId) {
        setSettlementMessage("请选择主播");
        return false;
      }
      await actions.updateProjectStreamerSettlementRule?.(
        selectedProjectId,
        streamerRuleDraft.streamerId,
        {
          settlementMethod: streamerRuleDraft.settlementMethod,
          hourlyRate: draftNumber(streamerRuleDraft.hourlyRate),
          baseSalary: draftNumber(streamerRuleDraft.baseSalary),
          cpsRateBps: draftPercentToBps(streamerRuleDraft.cpsRatePercent),
          reason:
            streamerRuleDraft.reason?.trim() || "结算中心主播应付规则调整",
        },
      );
      setSettlementMessage("主播应付规则已保存");
      return false;
    });
  };
  const saveProjectFinancials = (event) => {
    event?.preventDefault?.();
    return runSettlementAction("project-financials", async () => {
      if (!selectedProjectId) {
        setSettlementMessage("请选择结算项目");
        return false;
      }
      await actions.updateProjectFinancialSettings?.(selectedProjectId, {
        ...serializeFinancialDraft(financialDraft),
        reason: "结算中心项目财务设置调整",
      });
      setSettlementMessage("项目财务设置已保存");
      return false;
    });
  };
  const exportBatches = () =>
    runSettlementAction("export", async () => {
      await actions.createGovernedExport?.({
        kind: "settlement_batch",
        rows: filtered.map((batch) => ({
          batchName: batch.name,
          payableAmountCents:
            batch.type === "streamer_payable" ? batch.amount * 100 : 0,
          vendorReceivableCents:
            batch.type === "vendor_receivable" ? batch.amount * 100 : 0,
        })),
      });
      setSettlementMessage("结算批次导出已生成");
      return false;
    });

  return (
    <>
      <PageHeader
        title="结算中心"
        actions={
          <>
            <Button
              kind="default"
              icon={<Icon.Upload size={14} />}
              onClick={() => {
                setManualFormOpen((value) => !value);
                setSettlementMessage("");
              }}
              disabled={!!busyAction}
            >
              {busyAction === "manual" ? "处理中…" : "导入 CPA / CPS 数据"}
            </Button>
            <Button
              kind="default"
              icon={<Icon.Export size={14} />}
              onClick={exportBatches}
              disabled={!!busyAction}
            >
              {busyAction === "export" ? "导出中…" : "批次导出"}
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Plus size={14} stroke="#fff" />}
              onClick={() => {
                setBatchFormOpen((value) => !value);
                setSettlementMessage("");
              }}
              disabled={!!busyAction}
            >
              新建结算批次
            </Button>
          </>
        }
      />

      <div
        className="ops-settlement-content"
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Grouped settlement strip — primary 预估毛利 + compact secondaries */}
        <Card
          padded={false}
          bodyStyle={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            padding: "16px 18px",
            flexWrap: "wrap",
            rowGap: 12,
          }}
        >
          <div
            style={{
              paddingRight: 24,
              borderRight: "1px solid var(--line)",
              minWidth: 160,
            }}
          >
            <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
              本月预估毛利
            </div>
            <div
              className="num"
              style={{
                fontSize: 26,
                fontWeight: 600,
                color: "var(--blue-600)",
                letterSpacing: "-0.02em",
                marginTop: 4,
                whiteSpace: "nowrap",
              }}
            >
              {formatSettlementCurrency(settlementSummary.gross)}
            </div>
            <div
              style={{
                fontSize: 12,
                marginTop: 4,
                color:
                  settlementSummary.gross >= 0
                    ? "var(--ok-600)"
                    : "var(--danger-600)",
              }}
            >
              毛利率 {settlementSummary.marginRate.toFixed(1)}%
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 28,
              flex: 1,
              flexWrap: "wrap",
              rowGap: 12,
            }}
          >
            <MiniStat
              label="本月厂家应收 (草稿)"
              value={formatSettlementCurrency(
                settlementSummary.vendorReceivable,
              )}
              hint={settlementBatchHint(
                settlementSummary.vendorBatchCount,
                "应收",
              )}
            />
            <MiniStat
              label="本月主播应付 (锁定)"
              value={formatSettlementCurrency(settlementSummary.lockedPayable)}
              hint={settlementBatchHint(
                settlementSummary.lockedPayableBatchCount,
                "锁定",
              )}
            />
            <MiniStat
              label="可结算池 · 报数"
              value={String(poolCount)}
              unit="条"
              hint="审核通过 · 待入批次"
            />
          </div>
        </Card>

        <Card
          title="单项目结算校验 · §3.4"
          extra={
            reconciliation ? (
              <Badge
                tone={
                  reconciliationGate(reconciliation).hasBlocking
                    ? "red"
                    : reconciliationGate(reconciliation).warnings.length > 0
                      ? "amber"
                      : "green"
                }
              >
                {reconciliationGate(reconciliation).hasBlocking
                  ? "校验未通过"
                  : reconciliationGate(reconciliation).warnings.length > 0
                    ? "通过 · 有告警"
                    : "校验通过"}
              </Badge>
            ) : (
              <Badge tone="neutral">未运行</Badge>
            )
          }
          padded={true}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              className="ops-settlement-reconciliation-header"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
                合并 应收 / 成本 / 税费，输出毛利与可结判定（锁定前必须通过）
              </div>
              <Button
                kind="default"
                onClick={runReconciliation}
                disabled={!!busyAction}
              >
                {busyAction === "reconcile" ? "校验中…" : "运行校验"}
              </Button>
            </div>

            {reconciliation ? (
              <section
                role="region"
                aria-label="单项目结算校验结果"
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                    fontSize: 12,
                    color: "var(--ink-500)",
                  }}
                >
                  <span>{reconciliationMeta?.runAtLabel}</span>
                  <Badge tone={reconciliationMeta?.stale ? "amber" : "green"}>
                    {reconciliationMeta?.freshnessLabel}
                  </Badge>
                </div>
                <div
                  className="ops-settlement-reconciliation-metrics"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 10,
                  }}
                >
                  {buildReconciliationRows(reconciliation).map((row) => (
                    <div
                      key={row.key}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        padding: "6px 10px",
                        borderRadius: 8,
                        background: "var(--ink-50, #f6f7f9)",
                      }}
                    >
                      <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
                        {row.label}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color:
                            row.tone === "red"
                              ? "var(--red-600, #d92d20)"
                              : "var(--ink-800)",
                        }}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>

                {reconciliationGroups.length ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {activeGate.hasBlocking ? (
                      <div
                        role="alert"
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid rgba(217,45,32,0.24)",
                          background: "rgba(217,45,32,0.06)",
                          color: "var(--danger-700)",
                        }}
                      >
                        <h3
                          ref={reconciliationBlockingHeadingRef}
                          tabIndex={-1}
                          style={{
                            margin: 0,
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          阻断项
                        </h3>
                        <div style={{ marginTop: 4, fontSize: 12 }}>
                          {activeGate.disabledReasons.join("；")}
                        </div>
                      </div>
                    ) : null}
                    {reconciliationGroups.map((group) => (
                      <div
                        key={group.key}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "120px minmax(0, 1fr)",
                          gap: 8,
                          alignItems: "start",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: "var(--ink-700)",
                          }}
                        >
                          {group.label}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            minWidth: 0,
                          }}
                        >
                          {group.checks.map((check) => (
                            <div
                              key={check.key}
                              aria-label={check.accessibleText}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                flexWrap: "wrap",
                                fontSize: 12,
                              }}
                            >
                              <Badge
                                tone={reconciliationSeverityTone(
                                  check.severity,
                                )}
                              >
                                {check.severityLabel}
                              </Badge>
                              {check.categoryLabel ? (
                                <Badge tone="neutral">
                                  {check.categoryLabel}
                                </Badge>
                              ) : null}
                              <span style={{ color: "var(--ink-700)" }}>
                                {check.message}
                              </span>
                              {check.ruleVersionLabel &&
                              check.ruleVersion?.id ? (
                                <a
                                  href={`/ops/internal/settlement-rules/${check.ruleVersion.id}`}
                                  style={{
                                    color: "var(--blue-600)",
                                    textDecoration: "none",
                                    fontWeight: 600,
                                  }}
                                >
                                  {check.ruleVersionLabel}
                                </a>
                              ) : check.ruleVersionLabel ? (
                                <span style={{ color: "var(--ink-500)" }}>
                                  {check.ruleVersionLabel}
                                </span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{ fontSize: 12, color: "var(--green-600, #079455)" }}
                  >
                    无阻断或告警项
                  </div>
                )}
              </section>
            ) : (
              <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
                点击「运行校验」生成本期对账单与可结判定
              </div>
            )}
          </div>
        </Card>

        {complexCost?.enabled ? (
          <Card
            title="复杂成本规则"
            extra={<Badge tone="green">已开通</Badge>}
            padded={true}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 13, color: "var(--ink-700)" }}>
                  已用 {Number(complexCost.usedProjects ?? 0)} /{" "}
                  {Number(complexCost.includedProjects ?? 0)} 个项目额度
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-400)",
                    marginTop: 4,
                  }}
                >
                  CPA/CPS/礼物/投流/供应商费用需导入或人工确认后进入批次
                </div>
              </div>
              <Button
                kind="default"
                onClick={() =>
                  setSettlementMessage("复杂成本规则配置请在项目设置中维护。")
                }
              >
                成本规则设置
              </Button>
            </div>
          </Card>
        ) : null}

        <Card padded={false}>
          <div
            className="ops-settlement-project-header"
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--ink-900)",
                }}
              >
                项目结算详情
              </div>
              <div
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 3 }}
              >
                {selectedProjectId || "no-project-selected"}
              </div>
            </div>
            <div
              className="ops-settlement-period-controls"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              {settlementPeriod.start &&
              settlementPeriod.end &&
              settlementPeriod.start > settlementPeriod.end ? (
                <span
                  className="ops-settlement-period-error"
                  style={{ fontSize: 12, color: "var(--danger-600)" }}
                >
                  周期开始需早于结束
                </span>
              ) : null}
              <input
                type="date"
                aria-label="结算周期开始"
                value={settlementPeriod.start}
                onChange={changeSettlementPeriod("start")}
                style={{ ...taskInputStyle, width: 150 }}
              />
              <span style={{ fontSize: 12, color: "var(--ink-400)" }}>→</span>
              <input
                type="date"
                aria-label="结算周期结束"
                value={settlementPeriod.end}
                onChange={changeSettlementPeriod("end")}
                style={{ ...taskInputStyle, width: 150 }}
              />
              <select
                aria-label="结算项目"
                value={selectedProjectId}
                onChange={selectProject}
                style={{ ...taskInputStyle, width: 260 }}
              >
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div
            className="ops-settlement-tabs-scroll"
            style={{
              padding: "0 16px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <Tabs
              value={detailTab}
              onChange={setDetailTab}
              items={[
                { key: "summary", label: "结算详情" },
                { key: "finance", label: "项目财务设置" },
                { key: "payable", label: "主播应付规则" },
                { key: "cost", label: "项目开支" },
                ...(customRulesEnabled
                  ? [{ key: "custom_rules", label: "AI 自定义规则" }]
                  : []),
              ]}
            />
          </div>
          {detailTab === "summary" && (
            <div
              className="ops-settlement-summary-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 1.35fr)",
                gap: 16,
                padding: 16,
              }}
            >
              <div>
                <KV label="项目名称">{selectedProject?.name || "暂无项目"}</KV>
                <KV label="项目编号">
                  <span className="mono">
                    {selectedProject?.code || selectedProjectId || "未设置"}
                  </span>
                </KV>
                <KV label="结算方式">
                  <Badge tone="blue">
                    {SETTLEMENT_METHOD_OPTIONS.find(
                      (option) =>
                        option.value === ruleDraft.defaultSettlementMethod,
                    )?.label || ruleDraft.defaultSettlementMethod}
                  </Badge>
                </KV>
                <KV label="项目周期">
                  {selectedProject?.start || selectedProject?.end
                    ? `${selectedProject?.start || "未设置"} → ${
                        selectedProject?.end || "未设置"
                      }`
                    : "未设置"}
                </KV>
                <KV label="待入池">
                  <span className="num">{projectSettlementPool.length}</span> 条
                </KV>
                <KV label="批次数">
                  <span className="num">{projectBatches.length}</span> 个
                </KV>
              </div>
              <form
                onSubmit={saveProjectRule}
                style={{
                  display: "grid",
                  // auto-fit：右栏在窄容器（视口 − 侧边栏后约 400px）时字段
                  // 自动换行，而不是固定四列把「保存项目规则」顶出卡片右缘。
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 10,
                  alignItems: "end",
                  minWidth: 0,
                }}
              >
                <TaskFormLabel label="默认结算">
                  <select
                    value={ruleDraft.defaultSettlementMethod}
                    onChange={updateRuleDraft("defaultSettlementMethod")}
                    style={taskInputStyle}
                  >
                    {SETTLEMENT_METHOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </TaskFormLabel>
                <TaskFormLabel label="厂家单价（CPT 小时单价）">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={ruleDraft.defaultHourlyRate}
                    onChange={updateRuleDraft("defaultHourlyRate")}
                    style={taskInputStyle}
                  />
                </TaskFormLabel>
                <TaskFormLabel label="底薪">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={ruleDraft.defaultBaseSalary}
                    onChange={updateRuleDraft("defaultBaseSalary")}
                    style={taskInputStyle}
                  />
                </TaskFormLabel>
                <Button
                  kind="primary"
                  type="submit"
                  disabled={!!busyAction || !selectedProjectId}
                >
                  {busyAction === "project-rule" ? "保存中…" : "保存项目规则"}
                </Button>
                <div style={{ gridColumn: "1 / -1" }}>
                  <CollapsibleSection
                    title="进阶结算规则"
                    hint="阶梯小时单价 / 扣罚 / 保底封顶"
                  >
                    <SettlementRuleBuilder
                      value={ruleDraft.defaultSettlementRule}
                      onChange={(next) =>
                        setRuleDraft((draft) => ({
                          ...draft,
                          defaultSettlementRule: next,
                        }))
                      }
                      flatHourlyRate={
                        draftNumber(ruleDraft.defaultHourlyRate) || 0
                      }
                      method={ruleDraft.defaultSettlementMethod}
                    />
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 12,
                        color: "var(--ink-400)",
                      }}
                    >
                      进阶规则随上方「保存项目规则」一并保存。
                    </div>
                  </CollapsibleSection>
                </div>
              </form>
            </div>
          )}

          {detailTab === "finance" && (
            <div style={{ padding: 16 }}>
              <form
                onSubmit={saveProjectFinancials}
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <ProjectFinancialSettings
                  value={financialDraft}
                  onChange={setFinancialDraft}
                  expectedReceivableCents={Math.round(
                    (settlementSummary.vendorReceivable || 0) * 100,
                  )}
                />
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button
                    kind="primary"
                    type="submit"
                    disabled={!!busyAction || !selectedProjectId}
                  >
                    {busyAction === "project-financials"
                      ? "保存中…"
                      : "保存财务设置"}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {detailTab === "payable" && (
            <div style={{ padding: 16 }}>
              <form
                onSubmit={saveStreamerRule}
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 10,
                    alignItems: "end",
                    minWidth: 0,
                  }}
                >
                  <TaskFormLabel label="主播">
                    <select
                      value={streamerRuleDraft.streamerId}
                      onChange={updateStreamerRuleDraft("streamerId")}
                      style={taskInputStyle}
                    >
                      <option value="">选择主播</option>
                      {streamerRuleOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </TaskFormLabel>
                  <TaskFormLabel label="结算方式">
                    <select
                      value={streamerRuleDraft.settlementMethod}
                      onChange={updateStreamerRuleDraft("settlementMethod")}
                      style={taskInputStyle}
                    >
                      {SETTLEMENT_METHOD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </TaskFormLabel>
                  <TaskFormLabel label="小时单价">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={streamerRuleDraft.hourlyRate}
                      onChange={updateStreamerRuleDraft("hourlyRate")}
                      style={taskInputStyle}
                    />
                  </TaskFormLabel>
                  <TaskFormLabel label="底薪">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={streamerRuleDraft.baseSalary}
                      onChange={updateStreamerRuleDraft("baseSalary")}
                      style={taskInputStyle}
                    />
                  </TaskFormLabel>
                  <TaskFormLabel label="CPS 比例(%)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={streamerRuleDraft.cpsRatePercent}
                      onChange={updateStreamerRuleDraft("cpsRatePercent")}
                      style={taskInputStyle}
                    />
                  </TaskFormLabel>
                  <TaskFormLabel label="原因">
                    <input
                      type="text"
                      value={streamerRuleDraft.reason}
                      onChange={updateStreamerRuleDraft("reason")}
                      style={taskInputStyle}
                      placeholder="可选，默认记为规则调整"
                    />
                  </TaskFormLabel>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button
                    kind="primary"
                    type="submit"
                    disabled={
                      !!busyAction ||
                      !selectedProjectId ||
                      !streamerRuleDraft.streamerId
                    }
                  >
                    {busyAction === "streamer-rule"
                      ? "保存中…"
                      : "保存主播应付规则"}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {detailTab === "cost" && (
            <div style={{ padding: 16 }}>
              <form
                onSubmit={submitCostItem}
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: 10,
                    alignItems: "end",
                    minWidth: 0,
                  }}
                >
                  <TaskFormLabel label="成本类型">
                    <select
                      value={costDraft.itemType}
                      onChange={updateCostDraft("itemType")}
                      style={taskInputStyle}
                    >
                      {COST_ITEM_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </TaskFormLabel>
                  <TaskFormLabel label="金额(元)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={costDraft.amountYuan}
                      onChange={updateCostDraft("amountYuan")}
                      style={taskInputStyle}
                    />
                  </TaskFormLabel>
                  <TaskFormLabel label="方向">
                    <select
                      value={costDraft.direction}
                      onChange={updateCostDraft("direction")}
                      style={taskInputStyle}
                    >
                      {COST_DIRECTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </TaskFormLabel>
                  <TaskFormLabel label="证据等级">
                    <select
                      value={costDraft.evidenceLevel}
                      onChange={updateCostDraft("evidenceLevel")}
                      style={taskInputStyle}
                    >
                      {COST_EVIDENCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </TaskFormLabel>
                  <TaskFormLabel label="原因">
                    <input
                      type="text"
                      value={costDraft.reason}
                      onChange={updateCostDraft("reason")}
                      style={taskInputStyle}
                      placeholder="必填，记入审计"
                    />
                  </TaskFormLabel>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                  }}
                >
                  <Button
                    kind="default"
                    onClick={loadCostItems}
                    disabled={
                      !!busyAction ||
                      !(selectedProjectId || selectedProject?.id)
                    }
                  >
                    {busyAction === "cost-load" ? "加载中…" : "加载/刷新"}
                  </Button>
                  <Button
                    kind="primary"
                    type="submit"
                    disabled={!!busyAction || !selectedProjectId}
                  >
                    {busyAction === "cost-create" ? "录入中…" : "录入外部成本"}
                  </Button>
                </div>
              </form>

              {costItemsLoadedFor === selectedProjectId ? (
                costItems.length ? (
                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {costItems.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--line)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 12,
                          }}
                        >
                          <Badge tone={costStatusTone(item.status)}>
                            {costStatusLabel(item.status)}
                          </Badge>
                          <span style={{ color: "var(--ink-700)" }}>
                            {item.itemType} · {item.direction} ·{" "}
                            {formatYuanFromCents(item.amountCents)}
                          </span>
                          <span style={{ color: "var(--ink-400)" }}>
                            {item.reason}
                          </span>
                          {item.sourceRuleVersionId ? (
                            <span style={{ color: "var(--ink-500)" }}>
                              规则版本 {item.sourceRuleVersionId}
                            </span>
                          ) : null}
                          {item.sourceExecutionKey ? (
                            <span
                              className="mono"
                              style={{ color: "var(--ink-400)" }}
                            >
                              {item.sourceExecutionKey}
                            </span>
                          ) : null}
                          {item.sourceExplanation ? (
                            <span style={{ color: "var(--ink-500)" }}>
                              {item.sourceExplanation}
                            </span>
                          ) : null}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {canConfirmCostItem(item.status) ? (
                            <Button
                              kind="default"
                              onClick={() =>
                                reviewCostItem(item.id, "confirmed")
                              }
                              disabled={!!busyAction}
                            >
                              确认
                            </Button>
                          ) : null}
                          {canVoidCostItem(item.status) ? (
                            <Button
                              kind="ghost"
                              onClick={() => reviewCostItem(item.id, "voided")}
                              disabled={!!busyAction}
                            >
                              作废
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : costRuleExceptions.length > 0 ? (
                  <div
                    style={{
                      marginTop: 12,
                      fontSize: 12,
                      color: "var(--ink-500)",
                    }}
                  >
                    尚未生成项目成本项，请先处理下方导入行异常
                  </div>
                ) : (
                  <div
                    style={{
                      marginTop: 12,
                      fontSize: 12,
                      color: "var(--ink-400)",
                    }}
                  >
                    本项目暂无外部成本记录
                  </div>
                )
              ) : (
                <div
                  style={{
                    marginTop: 12,
                    fontSize: 12,
                    color: "var(--ink-400)",
                  }}
                >
                  点击「加载/刷新」查看本项目已录入的外部成本
                </div>
              )}

              {costItemsLoadedFor === selectedProjectId &&
              costRuleExceptions.length > 0 ? (
                <div
                  aria-label="导入行异常待审核"
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    background: "var(--bg-soft)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      导入行异常复核
                    </div>
                    <Badge tone="amber">
                      {costRuleExceptions.length} 个待审核
                    </Badge>
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {costRuleExceptions.map((exception) => {
                      const draft = costExceptionDrafts[exception.id] ?? {
                        valueType: "money_cents",
                        reviewedValue: "",
                        reason: "",
                      };
                      return (
                        <div
                          key={exception.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "minmax(0, 1fr) minmax(360px, 1fr)",
                            gap: 10,
                            alignItems: "end",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div
                              className="mono"
                              style={{
                                fontSize: 11,
                                color: "var(--ink-500)",
                                wordBreak: "break-all",
                              }}
                            >
                              {exception.id} · batch {exception.importBatchId}
                            </div>
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: 12,
                                color: "var(--ink-700)",
                              }}
                            >
                              第 {Number(exception.rowIndex) + 1} 行 ·{" "}
                              {exception.variableName} · {exception.policy}
                            </div>
                            {exception.sourceRefs?.ruleVersionId ||
                            exception.sourceRefs?.sourceContextHash ? (
                              <div
                                className="mono"
                                style={{
                                  marginTop: 4,
                                  fontSize: 10.5,
                                  color: "var(--ink-400)",
                                  wordBreak: "break-all",
                                }}
                              >
                                {exception.sourceRefs?.ruleVersionId
                                  ? `rule ${exception.sourceRefs.ruleVersionId}`
                                  : ""}
                                {exception.sourceRefs?.sourceContextHash
                                  ? ` · ${exception.sourceRefs.sourceContextHash}`
                                  : ""}
                              </div>
                            ) : null}
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "110px 1fr 1fr auto",
                              gap: 8,
                              alignItems: "end",
                            }}
                          >
                            <TaskFormLabel label="复核类型">
                              <select
                                aria-label={`复核类型 ${exception.id}`}
                                value={draft.valueType}
                                onChange={updateCostExceptionDraft(
                                  exception.id,
                                  "valueType",
                                )}
                                style={taskInputStyle}
                              >
                                <option value="money_cents">金额(元)</option>
                                <option value="rate_bps">比例(%)</option>
                                <option value="integer">整数</option>
                                <option value="number">数字</option>
                                <option value="string">文本</option>
                                <option value="boolean">布尔</option>
                                <option value="timestamp">时间</option>
                              </select>
                            </TaskFormLabel>
                            <TaskFormLabel label="复核值">
                              <input
                                aria-label={`复核值 ${exception.id}`}
                                value={draft.reviewedValue}
                                onChange={updateCostExceptionDraft(
                                  exception.id,
                                  "reviewedValue",
                                )}
                                style={taskInputStyle}
                              />
                            </TaskFormLabel>
                            <TaskFormLabel label="复核原因">
                              <input
                                aria-label={`复核原因 ${exception.id}`}
                                value={draft.reason}
                                onChange={updateCostExceptionDraft(
                                  exception.id,
                                  "reason",
                                )}
                                style={taskInputStyle}
                              />
                            </TaskFormLabel>
                            <Button
                              kind="default"
                              onClick={() =>
                                resolveCostRuleException(exception)
                              }
                              disabled={!!busyAction}
                            >
                              提交复核
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {customRulesEnabled && detailTab === "custom_rules" ? (
            <div style={{ padding: "0 16px 16px", minWidth: 0 }}>
              <CustomSettlementRuleWorkspace
                project={selectedProject}
                period={settlementPeriod}
                target={CUSTOM_RULE_PROJECT_TARGET}
              />
            </div>
          ) : null}
        </Card>

        {settlementMessage ? (
          <div
            aria-live="polite"
            style={{
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
              color: settlementMessage.includes("失败")
                ? "var(--danger-600)"
                : "var(--ink-700)",
              fontSize: 12,
            }}
          >
            {settlementMessage}
          </div>
        ) : null}

        {batchFormOpen ? (
          <form
            className="ops-settlement-new-batch-form"
            onSubmit={createBatch}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: 14,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
            }}
          >
            <div
              className="ops-settlement-new-batch-grid"
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(160px, 1fr) minmax(160px, 1fr) 150px 150px 160px",
                alignItems: "end",
                gap: 10,
              }}
            >
              <TaskFormLabel label="结算项目 ID">
                <input
                  value={batchDraft.projectId}
                  onChange={updateBatchDraft("projectId")}
                  style={taskInputStyle}
                />
              </TaskFormLabel>
              <TaskFormLabel label="批次名称（可选）">
                <input
                  value={batchDraft.title}
                  onChange={updateBatchDraft("title")}
                  placeholder="例如 六月主播应付 · 第一批"
                  style={taskInputStyle}
                />
              </TaskFormLabel>
              <TaskFormLabel label="周期开始">
                <input
                  type="date"
                  value={batchDraft.periodStart}
                  onChange={updateBatchDraft("periodStart")}
                  style={taskInputStyle}
                />
              </TaskFormLabel>
              <TaskFormLabel label="周期结束">
                <input
                  type="date"
                  value={batchDraft.periodEnd}
                  onChange={updateBatchDraft("periodEnd")}
                  style={taskInputStyle}
                />
              </TaskFormLabel>
              <TaskFormLabel label="批次类型">
                <select
                  value={batchDraft.batchType}
                  onChange={updateBatchDraft("batchType")}
                  style={taskInputStyle}
                >
                  <option value="payable">主播应付</option>
                  <option value="receivable">厂家应收</option>
                </select>
              </TaskFormLabel>
            </div>
            {poolStreamers.length > 0 ? (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--ink-700)",
                    }}
                  >
                    参与本次结算的主播（{selectedBatchStreamerIds.length}/
                    {poolStreamers.length}）
                  </span>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() =>
                      setBatchStreamerIds(
                        selectedBatchStreamerIds.length === poolStreamers.length
                          ? []
                          : null,
                      )
                    }
                  >
                    {selectedBatchStreamerIds.length === poolStreamers.length
                      ? "清空"
                      : "全选"}
                  </Button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {poolStreamers.map((streamer) => {
                    const checked = selectedBatchStreamerIds.includes(
                      streamer.id,
                    );
                    return (
                      <label
                        key={streamer.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "5px 10px",
                          border: `1px solid ${
                            checked ? "var(--blue-300)" : "var(--line-strong)"
                          }`,
                          borderRadius: 8,
                          background: checked ? "var(--blue-50)" : "#fff",
                          fontSize: 12,
                          color: checked ? "var(--blue-700)" : "var(--ink-700)",
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBatchStreamer(streamer.id)}
                          style={{ margin: 0 }}
                        />
                        {streamer.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
                当前周期可结算池为空，无可勾选的参与主播。
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button kind="primary" type="submit" disabled={!!busyAction}>
                确认新建批次
              </Button>
            </div>
          </form>
        ) : null}

        {manualFormOpen ? (
          <form
            className="ops-settlement-manual-form"
            onSubmit={addManualItem}
            style={{
              display: "grid",
              gridTemplateColumns: "140px 140px 140px minmax(220px, 1fr) auto",
              alignItems: "end",
              gap: 10,
              padding: 14,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
            }}
          >
            <TaskFormLabel label="人工项目类型">
              <select
                value={manualDraft.itemType}
                onChange={updateManualDraft("itemType")}
                style={taskInputStyle}
              >
                <option value="cpa">CPA</option>
                <option value="cps">CPS</option>
                <option value="gift">礼物</option>
                <option value="manual">手工</option>
              </select>
            </TaskFormLabel>
            <TaskFormLabel label="人工金额">
              <input
                value={manualDraft.manualAmount}
                onChange={updateManualDraft("manualAmount")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <TaskFormLabel label="证据等级">
              <select
                value={manualDraft.evidenceLevel}
                onChange={updateManualDraft("evidenceLevel")}
                style={taskInputStyle}
              >
                <option value="red">red</option>
                <option value="yellow">yellow</option>
              </select>
            </TaskFormLabel>
            <TaskFormLabel label="人工原因">
              <input
                value={manualDraft.reason}
                onChange={updateManualDraft("reason")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <Button kind="primary" type="submit" disabled={!!busyAction}>
              确认导入人工金额
            </Button>
          </form>
        ) : null}

        <SettlementPoolPreview
          rows={projectSettlementPool}
          period={settlementPeriod}
        />

        {archiveGuide ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              border: "1px solid var(--ok-600)",
              borderRadius: 8,
              background: "var(--ok-50)",
            }}
          >
            <div style={{ flex: 1, fontSize: 12.5, color: "var(--ink-700)" }}>
              <strong style={{ color: "var(--ok-600)" }}>结算已完成：</strong>
              项目「{archiveGuide.name}
              」的结算批次已全部锁定，可以归档该项目收尾。
            </div>
            <Button
              kind="default"
              size="sm"
              onClick={archiveSettledProject}
              disabled={!!busyAction}
            >
              {busyAction === "archive" ? "归档中" : "归档项目"}
            </Button>
          </div>
        ) : null}

        <div
          className="ops-settlement-batch-layout"
          style={{
            display: "grid",
            // minmax(0,…)：批次详情里的明细表格/UUID 等宽内容不允许把列的
            // min-content 顶过容器（会造成整页横向溢出、右缘被裁切）。
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)",
            gap: 20,
            alignItems: "flex-start",
          }}
        >
          <Card padded={false}>
            <div
              className="ops-settlement-tabs-scroll"
              style={{
                padding: "0 12px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <Tabs
                value={type}
                onChange={setType}
                items={[
                  { key: "all", label: "全部", count: projectBatches.length },
                  {
                    key: "vendor_receivable",
                    label: "厂家应收",
                    count: projectBatches.filter(
                      (b) => b.type === "vendor_receivable",
                    ).length,
                  },
                  {
                    key: "streamer_payable",
                    label: "主播应付",
                    count: projectBatches.filter(
                      (b) => b.type === "streamer_payable",
                    ).length,
                  },
                ]}
              />
            </div>

            {(() => {
              const batchListColumns = [
                {
                  title: "批次",
                  render: (r) => (
                    <div>
                      <div
                        className="mono"
                        style={{ fontSize: 11, color: "var(--ink-400)" }}
                      >
                        {displayRecordId(r.id, "结算批次")}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--ink-900)",
                          marginTop: 2,
                        }}
                      >
                        {r.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--ink-400)",
                          marginTop: 2,
                        }}
                      >
                        {r.period}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "类型",
                  render: (r) => (
                    <Badge
                      tone={r.type === "vendor_receivable" ? "blue" : "teal"}
                    >
                      {r.type === "vendor_receivable" ? "应收" : "应付"}
                    </Badge>
                  ),
                },
                {
                  title: "金额",
                  align: "right",
                  render: (r) => (
                    <span
                      className="num"
                      style={{
                        fontWeight: 600,
                        color: "var(--ink-900)",
                        fontSize: 14,
                      }}
                    >
                      ¥{r.amount.toLocaleString()}
                    </span>
                  ),
                },
                {
                  title: "状态",
                  render: (r) => {
                    const status = batchStatusMeta(r.status);
                    return (
                      <Badge tone={status.tone} dot>
                        {status.label}
                      </Badge>
                    );
                  },
                },
              ];
              const pools = settlementBatchPools(filtered);
              if (pools.length === 0) {
                return <DataTable columns={batchListColumns} rows={[]} />;
              }
              // 分池视图：按 待审核 → 待结算 → 已结算 分节展示批次，
              // 对齐结算流程「审核后进待结算池，锁定后进已结算」的口径。
              return pools.map((pool) => (
                <div key={pool.key}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 14px 4px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--ink-700)",
                      }}
                    >
                      {pool.label}
                    </span>
                    <Badge tone={pool.tone}>{pool.rows.length}</Badge>
                  </div>
                  <DataTable
                    activeRowId={activeId}
                    onRowClick={(r) => setActiveId(r.id)}
                    columns={batchListColumns}
                    rows={pool.rows}
                  />
                </div>
              ));
            })()}
          </Card>

          {/* Batch detail */}
          <BatchDetail
            id={activeId}
            batches={projectBatches}
            batchDetails={batchDetails}
            onAddManualItem={() => {
              setManualFormOpen(true);
              setSettlementMessage("");
            }}
            onLockBatch={lockBatch}
            onReopenBatch={reopenBatch}
            onConfirmBatch={confirmBatch}
            onNotifyStreamers={notifyBatchStreamers}
            lockGate={activeGate}
            lockBlockMessage={reconciliationBlockMessage(activeReconciliation)}
            lockReason={lockReason}
            onLockReasonChange={setLockReason}
            requiresDiscrepancyReason={activeBatchHasRedEvidence}
            busyAction={busyAction}
          />
        </div>
      </div>
    </>
  );
}

function sumSettlementBatchAmounts(batches) {
  return batches.reduce((sum, batch) => sum + Number(batch.amount ?? 0), 0);
}

// 批次分池：按状态把批次归入 待审核 / 待结算 / 已结算 / 已作废，对齐口述
// 结算流程「审核后进入待结算池，结算后手动确认进入已结算」的心智模型。
const SETTLEMENT_BATCH_POOLS = [
  {
    key: "review",
    label: "待审核",
    tone: "amber",
    statuses: ["draft", "generated", "pending_confirm", "reopened"],
  },
  {
    key: "pending_settle",
    label: "待结算",
    tone: "blue",
    statuses: ["confirmed"],
  },
  { key: "settled", label: "已结算", tone: "teal", statuses: ["locked"] },
  { key: "voided", label: "已作废", tone: "neutral", statuses: ["voided"] },
];

function settlementBatchPools(rows) {
  const known = new Set(
    SETTLEMENT_BATCH_POOLS.flatMap((pool) => pool.statuses),
  );
  const pools = SETTLEMENT_BATCH_POOLS.map((pool) => ({
    ...pool,
    rows: rows.filter((row) => pool.statuses.includes(row.status)),
  }));
  const other = rows.filter((row) => !known.has(row.status));
  if (other.length > 0) {
    pools.push({
      key: "other",
      label: "其他",
      tone: "neutral",
      statuses: [],
      rows: other,
    });
  }
  return pools.filter((pool) => pool.rows.length > 0);
}

function formatSettlementCurrency(value) {
  const amount = Math.round(Number(value) || 0);
  const prefix = amount < 0 ? "-¥" : "¥";
  return `${prefix}${Math.abs(amount).toLocaleString()}`;
}

function settlementBatchHint(count, label) {
  return count > 0 ? `${count} 个${label}批次` : `暂无${label}批次`;
}

function SettlementPoolPreview({ rows, period }) {
  return (
    <Card padded={false}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-700)" }}
          >
            可结算池预览
          </div>
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 3 }}
          >
            {period?.start && period?.end
              ? `${period.start} → ${period.end}`
              : "等待审核通过报数进入池子"}
          </div>
        </div>
        <Badge tone={rows.length > 0 ? "green" : "neutral"} dot>
          {rows.length > 0 ? `${rows.length} 条待入批次` : "暂无待入批次"}
        </Badge>
      </div>
      <DataTable
        dense
        emptyText="暂无审核通过且未入批次的报数"
        columns={[
          {
            title: "报数",
            render: (r) => (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar name={r.streamer} size={26} />
                <div>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--ink-900)",
                    }}
                  >
                    {r.streamer}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 10.5, color: "var(--ink-400)" }}
                  >
                    {displayRecordId(r.id, "结算项")}
                  </div>
                </div>
              </div>
            ),
          },
          {
            title: "项目",
            render: (r) => <span style={{ fontSize: 12 }}>{r.project}</span>,
          },
          {
            title: "有效时长",
            align: "right",
            render: (r) => <span className="num">{r.hours.toFixed(1)} h</span>,
          },
          {
            title: "证据",
            render: (r) => (
              <Badge tone={settlementEvidenceTone(r.evidence)}>
                {r.evidence}
              </Badge>
            ),
          },
          {
            title: "规则",
            render: (r) => <Badge tone="blue">{r.rule}</Badge>,
          },
          {
            title: "预计金额",
            align: "right",
            render: (r) => (
              <span
                className="num"
                style={{ fontWeight: 700, color: "var(--ink-900)" }}
              >
                ¥{r.expected.toLocaleString()}
              </span>
            ),
          },
          {
            title: "审核时间",
            align: "right",
            render: (r) => (
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-400)" }}
              >
                {r.approvedAt}
              </span>
            ),
          },
        ]}
        rows={rows}
      />
    </Card>
  );
}

function settlementEvidenceTone(value) {
  if (String(value).startsWith("green")) return "green";
  if (String(value).startsWith("yellow")) return "amber";
  if (String(value).startsWith("red")) return "red";
  return "neutral";
}

function hasSettlementDiscrepancy(row) {
  const evidenceLevel = String(row?.evidenceLevel ?? "").toLowerCase();
  return (
    evidenceLevel === "yellow" ||
    evidenceLevel === "red" ||
    (Array.isArray(row?.riskFlags) && row.riskFlags.length > 0)
  );
}

function settlementDiscrepancyLabels(row) {
  const labels = [];
  const evidenceLevel = String(row?.evidenceLevel ?? "").toLowerCase();
  if (evidenceLevel === "yellow") labels.push("黄证据");
  if (evidenceLevel === "red") labels.push("红证据");
  if (Array.isArray(row?.riskFlags)) {
    labels.push(...row.riskFlags.map(riskFlagLabel));
  }
  return labels;
}

function buildSettlementBreakdownMeaning(row) {
  const breakdown = row?.ruleBreakdown;
  if (!breakdown) return "";
  const components = Array.isArray(breakdown.components)
    ? breakdown.components
        .map(
          (component) =>
            `${component.label} ${formatYuanFromCents(component.amountCents)}`,
        )
        .join("、")
    : "";
  const appliedVersions = Array.isArray(breakdown.appliedVersionLabels)
    ? breakdown.appliedVersionLabels.join("、")
    : "";
  const missingDataCount = Array.isArray(breakdown.missingDataDecisions)
    ? breakdown.missingDataDecisions.length
    : 0;
  const parts = [];
  if (appliedVersions) parts.push(`命中的规则版本：${appliedVersions}。`);
  if (components) parts.push(`金额由 ${components} 组成。`);
  if (breakdown.sourceReportCount) {
    parts.push(`本项引用 ${breakdown.sourceReportCount} 条来源报数。`);
  }
  if (missingDataCount > 0) {
    parts.push(
      `有 ${missingDataCount} 个缺失数据决策，需要在异常队列继续处理。`,
    );
  }
  if (breakdown.explanationZh) parts.push(breakdown.explanationZh);
  return parts.join(" ");
}

function BatchDetail({
  id,
  batches = BATCHES,
  batchDetails = {},
  onAddManualItem,
  onLockBatch,
  onReopenBatch,
  onConfirmBatch,
  onNotifyStreamers,
  lockGate = { evaluated: false, hasBlocking: false },
  lockBlockMessage = "",
  lockReason = "",
  onLockReasonChange,
  requiresDiscrepancyReason = false,
  busyAction,
}) {
  const [detailMessage, setDetailMessage] = React.useState("");
  const [auditBusy, setAuditBusy] = React.useState(false);
  const [showDiscrepancyRowsOnly, setShowDiscrepancyRowsOnly] =
    React.useState(false);
  const [openBreakdownMeaningId, setOpenBreakdownMeaningId] =
    React.useState(null);
  const auditEntries = useOpsAuditEntries();
  const currentUser = useOpsCurrentUser();
  const actions = useOpsLiveActions();
  const b = batches.find((x) => x.id === id) || batches[0] || BATCHES[1];
  if (!b) {
    return (
      <div
        className="ops-settlement-batch-detail"
        style={{
          position: "sticky",
          top: 76,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <Card>
          <EmptyHint title="暂无结算批次" hint="结算批次会在后端返回后展示。" />
        </Card>
      </div>
    );
  }

  const isPayable = b.type === "streamer_payable";
  const isLocked = b.status === "locked";
  const confirmBlockMessage = !lockGate?.evaluated
    ? "确认前请先运行「单项目结算校验」"
    : lockBlockMessage.replace("无法锁定", "无法确认");
  const lockTitle = !lockGate?.canLock
    ? lockBlockMessage
    : lockGate?.evaluated
      ? undefined
      : "锁定前请先运行「单项目结算校验」";
  const confirmTitle = !lockGate?.canLock ? confirmBlockMessage : undefined;
  const batchStatus = BATCH_STATUS[b.status] || BATCH_STATUS.pending_confirm;
  const isReferenceBatch = BATCHES.some((x) => x.id === b.id);
  const apiDetailRows = Array.isArray(batchDetails[b.id])
    ? batchDetails[b.id]
    : null;
  const detailRows = apiDetailRows?.length
    ? apiDetailRows
    : isReferenceBatch
      ? BATCH_DETAIL_ITEMS
      : [
          {
            streamer: "批次汇总",
            id: String(b.id).slice(0, 8),
            rule: isPayable ? "主播应付汇总" : "厂家应收汇总",
            hours: 0,
            qty: "API 批次",
            base: 0,
            variable: b.amount,
            adjust: 0,
            total: b.amount,
          },
        ];

  const total = detailRows.reduce((s, x) => s + x.total, 0);
  const baseSum = detailRows.reduce((s, x) => s + x.base, 0);
  const varSum = detailRows.reduce((s, x) => s + x.variable, 0);
  const adjSum = detailRows.reduce((s, x) => s + x.adjust, 0);
  const discrepancyRows = detailRows.filter(hasSettlementDiscrepancy);
  const redEvidenceRows = detailRows.filter(
    (row) => String(row.evidenceLevel).toLowerCase() === "red",
  );
  const visibleDetailRows = showDiscrepancyRowsOnly
    ? discrepancyRows
    : detailRows;
  const ruleBreakdownRows = detailRows.filter((row) => row.ruleBreakdown);
  const openRuleExceptions = detailRows.flatMap((row) =>
    Array.isArray(row.openExceptions)
      ? row.openExceptions.map((exception) => ({
          ...exception,
          itemId: row.id,
          streamer: row.streamer,
        }))
      : [],
  );
  const showPendingDetail = (message) => {
    setDetailMessage(message);
  };
  const batchAudit = auditEntries.filter(
    (entry) =>
      entry.objectType === "settlement_batch" && entry.objectId === b.id,
  );
  const loadBatchAudit = async () => {
    if (auditBusy) return;
    setDetailMessage("");
    if (!actions.refreshAuditEntries) {
      setDetailMessage("审计明细需要登录后台后查看。");
      return;
    }
    setAuditBusy(true);
    try {
      await actions.refreshAuditEntries({
        objectType: "settlement_batch",
        objectId: b.id,
        limit: 100,
      });
      setDetailMessage("批次审计明细已刷新，见下方审计轨迹。");
    } catch (error) {
      setDetailMessage(error?.message || "审计明细刷新失败，请稍后重试。");
    } finally {
      setAuditBusy(false);
    }
  };

  return (
    <div
      className="ops-settlement-batch-detail"
      style={{
        position: "sticky",
        top: 76,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <Card padded={false}>
        {/* Header */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div
            className="ops-settlement-batch-header"
            style={{ display: "flex", alignItems: "flex-start", gap: 12 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-400)" }}
              >
                {displayRecordId(b.id, "结算批次")}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--ink-900)",
                  marginTop: 2,
                }}
              >
                {b.name}
              </div>
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <Badge tone={isPayable ? "teal" : "blue"}>
                  {isPayable ? "主播应付" : "厂家应收"}
                </Badge>
                <Badge tone={batchStatus.tone} dot>
                  {batchStatus.label}
                </Badge>
                {isLocked && (
                  <Badge tone="ink" soft={true}>
                    <Icon.Lock size={11} /> 已锁定
                  </Badge>
                )}
              </div>
            </div>
            <div
              className="ops-settlement-batch-total"
              style={{ textAlign: "right" }}
            >
              <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                合计金额
              </div>
              <div
                className="num"
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "var(--ink-900)",
                  letterSpacing: "-0.02em",
                }}
              >
                ¥{total.toLocaleString()}
              </div>
            </div>
          </div>

          <div
            className="ops-settlement-batch-meta"
            style={{
              marginTop: 12,
              display: "grid",
              // minmax(0,…) + break-all：创建人是 36 位 UUID 这类不可断词的
              // 长串，1fr 的 min-content 会把批次详情卡撑出容器右缘。
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 12,
              paddingTop: 12,
              borderTop: "1px dashed var(--line)",
            }}
          >
            <KV label="结算周期" w={60}>
              <span className="num">{b.period}</span>
            </KV>
            <KV label="项目" w={36}>
              <span className="mono">{b.project}</span>
            </KV>
            <KV label="创建人" w={50}>
              <span style={{ wordBreak: "break-all" }}>{b.creator}</span>
            </KV>
            <KV label="更新" w={36}>
              <span className="num" style={{ fontSize: 11.5 }}>
                {b.updated}
              </span>
            </KV>
          </div>
        </div>

        {/* Items */}
        <div
          className="ops-settlement-batch-items-header"
          style={{
            padding: "12px 16px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-700)" }}
          >
            结算明细
          </div>
          <div
            className="ops-settlement-batch-items-summary"
            style={{
              display: "flex",
              gap: 6,
              fontSize: 11,
              color: "var(--ink-400)",
            }}
          >
            <span>
              底薪{" "}
              <span
                className="num"
                style={{ color: "var(--ink-700)", fontWeight: 600 }}
              >
                ¥{baseSum.toLocaleString()}
              </span>
            </span>
            <span>·</span>
            <span>
              变动{" "}
              <span
                className="num"
                style={{ color: "var(--ink-700)", fontWeight: 600 }}
              >
                ¥{varSum.toLocaleString()}
              </span>
            </span>
            <span>·</span>
            <span>
              调整{" "}
              <span
                className="num"
                style={{
                  color: adjSum >= 0 ? "var(--ink-700)" : "var(--danger-600)",
                  fontWeight: 600,
                }}
              >
                {adjSum >= 0 ? "+" : ""}
                {adjSum}
              </span>
            </span>
          </div>
        </div>

        {discrepancyRows.length > 0 ? (
          <div
            style={{
              margin: "10px 16px 0",
              padding: "9px 10px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Badge tone={redEvidenceRows.length > 0 ? "red" : "amber"} dot>
              {detailRows.length} 项中 {discrepancyRows.length} 项证据存在差异
            </Badge>
            <span
              style={{
                flex: 1,
                minWidth: 180,
                fontSize: 12,
                color: "var(--ink-500)",
              }}
            >
              建议先复核黄/红证据与风控标记，再确认或锁定批次
            </span>
            <Button
              kind={showDiscrepancyRowsOnly ? "primary" : "default"}
              icon={
                <Icon.Audit
                  size={14}
                  stroke={showDiscrepancyRowsOnly ? "#fff" : undefined}
                />
              }
              onClick={() => setShowDiscrepancyRowsOnly((value) => !value)}
            >
              {showDiscrepancyRowsOnly ? "显示全部" : "只看差异"}
            </Button>
          </div>
        ) : null}

        <DataTable
          dense
          columns={[
            {
              title: "主播",
              render: (r) => (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar name={r.streamer} size={26} />
                  <div>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--ink-900)",
                      }}
                    >
                      {r.streamer}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 10.5, color: "var(--ink-400)" }}
                    >
                      {displayRecordId(r.id, "结算项")}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              title: "结算规则",
              render: (r) => <Badge tone="blue">{r.rule}</Badge>,
            },
            {
              title: "有效时长",
              align: "right",
              render: (r) => (
                <span className="num">{r.hours.toFixed(1)} h</span>
              ),
            },
            {
              title: "其他口径",
              align: "right",
              render: (r) => (
                <div
                  style={{
                    display: "inline-flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                    {r.qty}
                  </span>
                  {hasSettlementDiscrepancy(r) ? (
                    <div
                      style={{
                        display: "inline-flex",
                        gap: 4,
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                      }}
                    >
                      {settlementDiscrepancyLabels(r)
                        .slice(0, 2)
                        .map((label) => (
                          <Badge
                            key={`${r.id}-${label}`}
                            tone={settlementEvidenceTone(r.evidenceLevel)}
                          >
                            {label}
                          </Badge>
                        ))}
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              title: "底薪",
              align: "right",
              render: (r) => (
                <span className="num">
                  {r.base ? "¥" + r.base.toLocaleString() : "—"}
                </span>
              ),
            },
            {
              title: "变动",
              align: "right",
              render: (r) => (
                <span className="num">¥{r.variable.toLocaleString()}</span>
              ),
            },
            {
              title: "调整",
              align: "right",
              render: (r) => (
                <span
                  className="num"
                  style={{
                    color:
                      r.adjust === 0
                        ? "var(--ink-400)"
                        : r.adjust > 0
                          ? "var(--ok-600)"
                          : "var(--danger-600)",
                  }}
                >
                  {r.adjust === 0 ? "—" : (r.adjust > 0 ? "+" : "") + r.adjust}
                </span>
              ),
            },
            {
              title: "小计",
              align: "right",
              render: (r) => (
                <span
                  className="num"
                  style={{ fontWeight: 700, color: "var(--ink-900)" }}
                >
                  ¥{r.total.toLocaleString()}
                </span>
              ),
            },
          ]}
          rows={visibleDetailRows}
        />

        {ruleBreakdownRows.length > 0 || openRuleExceptions.length > 0 ? (
          <div
            style={{
              padding: "12px 16px",
              borderTop: "1px solid var(--line)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {ruleBreakdownRows.length > 0 ? (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink-700)",
                    }}
                  >
                    规则拆解
                  </div>
                  <Badge tone="neutral">{ruleBreakdownRows.length} 项</Badge>
                </div>

                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {ruleBreakdownRows.map((row) => {
                    const breakdownMeaningOpen =
                      openBreakdownMeaningId === row.id;
                    const breakdownMeaning =
                      buildSettlementBreakdownMeaning(row);
                    return (
                      <div
                        key={row.id}
                        style={{
                          paddingTop: 10,
                          borderTop: "1px dashed var(--line)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: "var(--ink-800)",
                            }}
                          >
                            {row.streamer}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              flexWrap: "wrap",
                              justifyContent: "flex-end",
                            }}
                          >
                            {breakdownMeaning ? (
                              <button
                                type="button"
                                aria-label={`这是什么意思：${row.streamer}`}
                                aria-expanded={breakdownMeaningOpen}
                                onClick={() =>
                                  setOpenBreakdownMeaningId((current) =>
                                    current === row.id ? null : row.id,
                                  )
                                }
                                style={{
                                  border: 0,
                                  background: "transparent",
                                  color: "var(--brand-600)",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  padding: 0,
                                  cursor: "pointer",
                                }}
                              >
                                这是什么意思
                              </button>
                            ) : null}
                            {row.ruleBreakdown.appliedVersionLabels.map(
                              (label) => (
                                <Badge key={`${row.id}-${label}`} tone="blue">
                                  {label}
                                </Badge>
                              ),
                            )}
                            {row.ruleBreakdown.executionGrain ? (
                              <Badge tone="neutral">
                                {row.ruleBreakdown.executionGrain}
                              </Badge>
                            ) : null}
                            <Badge tone="neutral">
                              来源报数 {row.ruleBreakdown.sourceReportCount} 条
                            </Badge>
                          </div>
                        </div>

                        <div
                          style={{
                            marginTop: 8,
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit, minmax(120px, 1fr))",
                            gap: 8,
                          }}
                        >
                          {row.ruleBreakdown.components.map((component) => (
                            <div
                              key={`${row.id}-${component.key}`}
                              style={{
                                padding: "8px 10px",
                                border: "1px solid var(--line)",
                                borderRadius: 8,
                                background: "var(--bg-soft)",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--ink-400)",
                                }}
                              >
                                {component.label}
                              </div>
                              <div
                                className="num"
                                style={{
                                  marginTop: 2,
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: "var(--ink-900)",
                                }}
                              >
                                {formatYuanFromCents(component.amountCents)}
                              </div>
                            </div>
                          ))}
                        </div>

                        {breakdownMeaningOpen ? (
                          <div
                            role="note"
                            style={{
                              marginTop: 8,
                              padding: "8px 10px",
                              border: "1px solid var(--line)",
                              borderRadius: 8,
                              background: "var(--bg-soft)",
                              fontSize: 12,
                              color: "var(--ink-600)",
                              lineHeight: 1.5,
                            }}
                          >
                            {breakdownMeaning}
                          </div>
                        ) : null}

                        {row.ruleBreakdown.explanationZh ? (
                          <div
                            style={{
                              marginTop: 8,
                              fontSize: 12,
                              color: "var(--ink-600)",
                              lineHeight: 1.5,
                            }}
                          >
                            {row.ruleBreakdown.explanationZh}
                          </div>
                        ) : null}

                        {row.ruleBreakdown.missingDataDecisions.length > 0 ? (
                          <div style={{ marginTop: 10 }}>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--ink-700)",
                              }}
                            >
                              缺失数据决策
                            </div>
                            <div
                              style={{
                                marginTop: 6,
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                              }}
                            >
                              {row.ruleBreakdown.missingDataDecisions.map(
                                (decision) => (
                                  <div
                                    key={`${row.id}-${decision.variableName}-${decision.policy}-${decision.decision}`}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      flexWrap: "wrap",
                                      fontSize: 12,
                                      color: "var(--ink-500)",
                                    }}
                                  >
                                    <span className="mono">
                                      {decision.variableName}
                                    </span>
                                    <Badge tone="amber">
                                      {decision.policy}
                                    </Badge>
                                    <span>{decision.decision}</span>
                                  </div>
                                ),
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink-700)",
                  }}
                >
                  异常队列
                </div>
                <Badge tone={openRuleExceptions.length ? "amber" : "green"}>
                  {openRuleExceptions.length
                    ? `${openRuleExceptions.length} 个待处理`
                    : "无待处理异常"}
                </Badge>
              </div>
              {openRuleExceptions.length > 0 ? (
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {openRuleExceptions.map((exception) => (
                    <div
                      key={exception.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto",
                        gap: 8,
                        alignItems: "center",
                        padding: "7px 0",
                        borderTop: "1px dashed var(--line)",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          className="mono"
                          style={{
                            fontSize: 11,
                            color: "var(--ink-700)",
                            wordBreak: "break-all",
                          }}
                        >
                          {exception.id}
                        </div>
                        <div
                          style={{
                            marginTop: 2,
                            fontSize: 12,
                            color: "var(--ink-500)",
                            wordBreak: "break-word",
                          }}
                        >
                          {exception.streamer} · {exception.variableName}
                          {exception.liveReportId
                            ? ` · ${exception.liveReportId}`
                            : ""}
                        </div>
                      </div>
                      <Badge tone="amber">{exception.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: "var(--ink-400)",
                  }}
                >
                  当前批次没有待处理的规则异常。
                </div>
              )}
            </div>
          </div>
        ) : null}
        {detailMessage ? (
          <div
            aria-live="polite"
            style={{
              padding: "10px 12px 0",
              fontSize: 12,
              color: "var(--ink-500)",
            }}
          >
            {detailMessage}
          </div>
        ) : null}

        {/* Footer: actions（窄容器下按钮换行而不是把卡片顶出右缘） */}
        <div
          className="ops-settlement-batch-actions"
          style={{
            padding: 12,
            borderTop: "1px solid var(--line)",
            background: "var(--bg-soft)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "flex-end",
            rowGap: 8,
          }}
        >
          {isLocked && (
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-500)",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon.Lock size={12} stroke="var(--ink-500)" />
              本批次已锁定 · 由 {b.creator} 于 {b.updated}
            </div>
          )}
          <div style={{ flex: 1 }} />
          {isLocked ? (
            <>
              <Button
                kind="ghost"
                icon={<Icon.History size={14} />}
                onClick={loadBatchAudit}
                disabled={auditBusy}
              >
                {auditBusy ? "刷新中…" : "查看审计"}
              </Button>
              {isPayable && onNotifyStreamers ? (
                <Button
                  kind="default"
                  icon={<Icon.Bell size={14} />}
                  onClick={onNotifyStreamers}
                  disabled={!!busyAction}
                >
                  {busyAction === "notify" ? "发送中…" : "发送薪资明细"}
                </Button>
              ) : null}
              <Button
                kind="default"
                icon={<Icon.Export size={14} />}
                onClick={() => showPendingDetail("批次 PDF 导出后台暂未接入。")}
              >
                导出 PDF
              </Button>
              <Button
                kind="danger"
                icon={<Icon.Unlock size={14} />}
                onClick={onReopenBatch}
                disabled={!!busyAction}
              >
                {busyAction === "reopen" ? "处理中…" : "重新打开"}
              </Button>
            </>
          ) : (
            <>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  minWidth: 220,
                  flex: "1 1 260px",
                  fontSize: 11,
                  color: "var(--ink-500)",
                }}
              >
                锁定原因
                {requiresDiscrepancyReason ? "（红证据确认）" : ""}
                <input
                  value={lockReason}
                  onChange={(event) => onLockReasonChange?.(event.target.value)}
                  disabled={!!busyAction}
                  style={{
                    height: 32,
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    padding: "0 10px",
                    fontSize: 12,
                    color: "var(--ink-800)",
                    background: "#fff",
                  }}
                />
              </label>
              <Button
                kind="ghost"
                onClick={() =>
                  showPendingDetail("批次编辑已取消，未提交后台变更。")
                }
              >
                取消
              </Button>
              <Button
                kind="default"
                icon={<Icon.Plus size={14} />}
                onClick={onAddManualItem}
                disabled={!!busyAction}
              >
                {busyAction === "manual" ? "处理中…" : "添加人工调整"}
              </Button>
              <Button
                kind="default"
                onClick={() =>
                  showPendingDetail(
                    "复杂成本项需导入或人工确认后，再附加到结算批次。",
                  )
                }
              >
                添加复杂成本项
              </Button>
              <Button
                kind="default"
                onClick={() => showPendingDetail("批次草稿保存后台暂未接入。")}
              >
                保存为草稿
              </Button>
              {canFinanceConfirmSettlementBatch(currentUser.role, b.status) ? (
                <Button
                  kind="default"
                  icon={<Icon.Check size={14} />}
                  onClick={onConfirmBatch}
                  disabled={!!busyAction || !lockGate?.canLock}
                  title={confirmTitle}
                >
                  {busyAction === "confirm"
                    ? "处理中…"
                    : !lockGate?.canLock && lockGate?.evaluated
                      ? "校验未通过 · 不可确认"
                      : "财务确认"}
                </Button>
              ) : null}
              {isPayable && b.status === "confirmed" && onNotifyStreamers ? (
                <Button
                  kind="default"
                  icon={<Icon.Bell size={14} />}
                  onClick={onNotifyStreamers}
                  disabled={!!busyAction}
                >
                  {busyAction === "notify" ? "发送中…" : "发送薪资明细"}
                </Button>
              ) : null}
              <Button
                kind="primary"
                icon={<Icon.Lock size={14} stroke="#fff" />}
                onClick={onLockBatch}
                disabled={!!busyAction || !lockGate?.canLock}
                title={lockTitle}
              >
                {busyAction === "lock"
                  ? "处理中…"
                  : !lockGate?.canLock && lockGate?.evaluated
                    ? "校验未通过 · 不可锁定"
                    : "确认并锁定"}
              </Button>
            </>
          )}
        </div>
      </Card>

      {/* Audit timeline */}
      <Card
        title="批次审计轨迹"
        extra={
          batchAudit.length ? (
            <Badge tone="neutral">{batchAudit.length} 条</Badge>
          ) : null
        }
        padded={true}
      >
        {batchAudit.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {batchAudit.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  gap: 10,
                  paddingBottom: 10,
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <Avatar
                  name={entry.actorName || entry.actorRole || "系统"}
                  size={26}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--ink-900)",
                      }}
                    >
                      {entry.actorName || "系统"}
                    </span>
                    <Badge tone={auditModuleTone(entry.module)}>
                      {auditModuleLabel(entry.module)} / {entry.action}
                    </Badge>
                    <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                      {formatOpsMinute(entry.createdAt)}
                    </span>
                  </div>
                  {entry.reason ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--ink-500)",
                        marginTop: 2,
                      }}
                    >
                      原因：{entry.reason}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyHint
            title="暂无审计轨迹"
            hint="对该批次执行锁定/解锁/调整后，操作会记录在这里。点击上方「查看审计」可刷新。"
          />
        )}
      </Card>
    </div>
  );
}

// ===== src\screen-tasks.jsx =====
// ——— Screen: 排班与任务 ————————————————————————
