import type { AppRole } from "@/lib/rbac/roles";

const DEFAULT_DASHBOARD_TIME_ZONE = "Asia/Shanghai";

export type DashboardStaffRole = Extract<
  AppRole,
  "owner" | "ops_manager" | "operator_business" | "finance"
>;

type DashboardTone = "neutral" | "blue" | "green" | "amber" | "red" | "violet";

export type DashboardProjectInput = {
  id: string;
  name: string;
  status: string;
  leadOps?: string | null;
  ownerId?: string | null;
  metrics?: {
    plannedHours?: number;
    doneHours?: number;
    audience?: number;
    reportedPending?: number;
    anomalies?: number;
    receivable?: number;
    payable?: number;
    gross?: number;
    margin?: number;
  };
  streamers?: {
    active?: number;
    candidate?: number;
    pendingReview?: number;
  };
  risk?: "low" | "medium" | "high";
};

export type DashboardTaskInput = {
  id: string;
  project?: string | null;
  projectName?: string | null;
  streamerName?: string | null;
  status: string;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  anomaly?: boolean;
};

export type DashboardReportInput = {
  id: string;
  project?: string | null;
  streamer?: string | null;
  status: string;
  source?: string;
  duration?: number;
  audience?: number;
};

export type DashboardSettlementPoolInput = {
  id: string;
  projectName?: string | null;
  streamerName?: string | null;
  expectedAmount?: number;
  evidenceLevel?: "green" | "yellow" | "red" | null;
  timeSource?: string | null;
};

export type DashboardBatchInput = {
  id: string;
  status: string;
  projectName?: string | null;
  totalAmount?: number;
  itemCount?: number;
};

export type DashboardNotificationInput = {
  id: string;
  title: string;
  type: string;
  status: string;
  isHighRisk?: boolean;
  objectType?: string | null;
  objectId?: string | null;
  createdAt?: string | null;
};

export type DashboardSourceData = {
  now: string;
  timeZone?: string;
  projects: DashboardProjectInput[];
  tasks: DashboardTaskInput[];
  reports: DashboardReportInput[];
  settlementPool: DashboardSettlementPoolInput[];
  batches: DashboardBatchInput[];
  notifications: DashboardNotificationInput[];
  auditEntries: DashboardNotificationInput[];
};

export type DashboardKpi = {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  tone?: DashboardTone;
  hint?: string;
};

export type DashboardTarget = {
  route:
    | "projects"
    | "project"
    | "tasks"
    | "reports"
    | "settle"
    | "audit"
    | "notifications";
  id?: string;
};

export type DashboardQueueItem = {
  key: string;
  title: string;
  subtitle: string;
  tone: DashboardTone;
  target: DashboardTarget;
};

export type DashboardActionItem = {
  key: string;
  label: string;
  value: number;
  tone: DashboardTone;
  target?: DashboardTarget;
};

export type DashboardActionGroup = {
  key: string;
  title: string;
  items: DashboardActionItem[];
};

export type DashboardPersonalSummaryItem = {
  key: string;
  label: string;
  value: number;
  tone: DashboardTone;
  attention?: boolean;
  series?: number[];
};

export type DashboardPersonalRecommendation = {
  key: string;
  icon: string;
  text: string;
  sub: string;
  tone: DashboardTone;
  cta: string;
  target?: DashboardTarget;
};

export type DashboardPersonalTodo = {
  key: string;
  text: string;
  count?: number;
  tone: DashboardTone;
  target?: DashboardTarget;
};

export type DashboardPersonalPanel = {
  summary: DashboardPersonalSummaryItem[];
  recommendations: DashboardPersonalRecommendation[];
  todos: DashboardPersonalTodo[];
};

export type DashboardFunnelStage = {
  key: string;
  label: string;
  value: number;
  rate?: number;
  tone?: DashboardTone;
};

export type DashboardFunnel = {
  title: string;
  subtitle?: string;
  unit?: string;
  stages: DashboardFunnelStage[];
  target?: DashboardTarget;
};

export type DashboardLane = {
  key: string;
  label: string;
  count: number;
  amount: number;
  tone?: DashboardTone;
};

export type DashboardRankRow = {
  key: string;
  title: string;
  value: number;
  hint?: string;
  tone?: DashboardTone;
  target?: DashboardTarget;
};

export type DashboardAmountRisk = {
  key: string;
  label: string;
  amount: number;
  hint?: string;
  tone?: DashboardTone;
  target?: DashboardTarget;
};

export type RoleHomeDashboardPanels = {
  admissionFunnel?: DashboardFunnel;
  settlementFunnel?: DashboardFunnel;
  batchLanes?: {
    title: string;
    subtitle?: string;
    lanes: DashboardLane[];
    target?: DashboardTarget;
  };
  amountRisks?: {
    title: string;
    subtitle?: string;
    rows: DashboardAmountRisk[];
    target?: DashboardTarget;
  };
  projectRanking?: {
    title: string;
    subtitle?: string;
    rows: DashboardRankRow[];
  };
};

export type RoleHomeDashboardDto = {
  profile: {
    role: DashboardStaffRole;
    title: string;
    subtitle: string;
    scopeLabel: string;
  };
  kpis: DashboardKpi[];
  queue: DashboardQueueItem[];
  risks: DashboardQueueItem[];
  drilldowns: DashboardQueueItem[];
  actionGroups?: DashboardActionGroup[];
  personal?: DashboardPersonalPanel;
  panels?: RoleHomeDashboardPanels;
  emptyState?: {
    title: string;
    hint: string;
  };
  generatedAt: string;
};

/**
 * Pure projection input for role home dashboards.
 *
 * `userId` and `organizationId` are retained for loader/API contract parity,
 * but this function does not perform authorization or filtering. The loader
 * must pass `source` data that is already scoped to the supplied user and org.
 */
export type BuildRoleHomeDashboardInput = {
  role: DashboardStaffRole;
  userId: string;
  organizationId: string;
  source: DashboardSourceData;
};

export function buildRoleHomeDashboard(
  input: BuildRoleHomeDashboardInput,
): RoleHomeDashboardDto {
  const facts = collectFacts(input.source);
  const dashboard = projectFactsForRole(input.role, facts, input.source.now);

  return withOverviewWidgets(withEmptyState(dashboard), input.role, facts);
}

function collectFacts(source: DashboardSourceData) {
  const timeZone = source.timeZone ?? DEFAULT_DASHBOARD_TIME_ZONE;
  const activeProjects = source.projects.filter((project) =>
    ["recruiting", "pending_start", "active", "paused", "settling"].includes(
      project.status,
    ),
  );
  const totalReceivable = sumBy(
    source.projects,
    (project) => project.metrics?.receivable,
  );
  const totalGross = sumBy(
    source.projects,
    (project) => project.metrics?.gross,
  );
  const plannedHours = sumBy(
    source.projects,
    (project) => project.metrics?.plannedHours,
  );
  const doneHours = sumBy(
    source.projects,
    (project) => project.metrics?.doneHours,
  );
  const pendingReportCount = sumBy(
    source.projects,
    (project) => project.metrics?.reportedPending,
  );
  const projectAnomalyCount = sumBy(
    source.projects,
    (project) => project.metrics?.anomalies,
  );
  const grossMarginRate =
    totalReceivable > 0
      ? Number(((totalGross / totalReceivable) * 100).toFixed(1))
      : 0;
  const lowMarginProjects = source.projects.filter(
    (project) =>
      typeof project.metrics?.margin === "number" &&
      project.metrics.margin < 20,
  );
  const pendingReports = source.reports.filter((report) =>
    ["pending_review", "pending_adjudication"].includes(report.status),
  );
  const anomalyTasks = source.tasks.filter(
    (task) => task.anomaly || task.status === "abnormal",
  );
  const todayTasks = source.tasks.filter((task) =>
    isTaskForToday(task, source.now, timeZone),
  );
  const notStartedTasks = todayTasks.filter((task) =>
    ["pending_live", "not_started", "scheduled"].includes(task.status),
  );
  const weakSettlementPool = source.settlementPool.filter(
    (item) => item.evidenceLevel === "yellow" || item.evidenceLevel === "red",
  );
  const highRiskNotices = source.notifications.filter(
    (item) => item.isHighRisk || item.type === "high_risk",
  );
  const draftBatches = source.batches.filter(
    (batch) => batch.status === "draft",
  );
  const reopenedBatches = source.batches.filter(
    (batch) => batch.status === "reopened",
  );

  return {
    allProjects: source.projects,
    reports: source.reports,
    batches: source.batches,
    draftBatches,
    reopenedBatches,
    activeProjects,
    totalReceivable,
    totalGross,
    plannedHours,
    doneHours,
    pendingReportCount,
    projectAnomalyCount,
    grossMarginRate,
    lowMarginProjects,
    pendingReports,
    anomalyTasks,
    todayTasks,
    notStartedTasks,
    weakSettlementPool,
    highRiskNotices,
    settlementPool: source.settlementPool,
    settlementPoolAmount: sumBy(
      source.settlementPool,
      (item) => item.expectedAmount,
    ),
    weakEvidenceAmount: sumBy(
      weakSettlementPool,
      (item) => item.expectedAmount,
    ),
    draftBatchCount: draftBatches.length,
    reopenedBatchCount: reopenedBatches.length,
    recordingPendingCount: sumBy(
      source.projects,
      (project) => project.streamers?.pendingReview,
    ),
    streamerGapProjectCount: source.projects.filter(
      (project) => (project.streamers?.candidate ?? 0) > 0,
    ).length,
  };
}

function projectFactsForRole(
  role: DashboardStaffRole,
  facts: ReturnType<typeof collectFacts>,
  generatedAt: string,
): RoleHomeDashboardDto {
  switch (role) {
    case "owner":
      return ownerDashboard(role, facts, generatedAt);
    case "ops_manager":
      return opsManagerDashboard(role, facts, generatedAt);
    case "operator_business":
      return operatorDashboard(role, facts, generatedAt);
    case "finance":
      return financeDashboard(role, facts, generatedAt);
    default:
      return rejectUnsupportedRole(role);
  }
}

function withOverviewWidgets(
  dashboard: RoleHomeDashboardDto,
  role: DashboardStaffRole,
  facts: ReturnType<typeof collectFacts>,
): RoleHomeDashboardDto {
  const actionGroups = buildActionGroups(role, facts);

  return {
    ...dashboard,
    actionGroups,
    personal: buildPersonalPanel(dashboard, facts, actionGroups),
  };
}

function buildActionGroups(
  role: DashboardStaffRole,
  facts: ReturnType<typeof collectFacts>,
): DashboardActionGroup[] {
  const batchCount = (...statuses: string[]) =>
    facts.batches.filter((batch) => statuses.includes(batch.status)).length;
  const anomalyCount = facts.anomalyTasks.length + facts.projectAnomalyCount;
  const recruitingCount = facts.activeProjects.filter(
    (project) => project.status === "recruiting",
  ).length;
  const highRiskCount =
    facts.highRiskNotices.length +
    facts.allProjects.filter((project) => project.risk === "high").length;

  if (role === "operator_business") {
    return [
      actionGroup("todayTasks", "今日任务", [
        actionItem(
          "open",
          "待处理",
          facts.todayTasks.filter((task) => task.status !== "completed").length,
          "blue",
          "tasks",
        ),
        actionItem(
          "completed",
          "已完成",
          facts.todayTasks.filter((task) => task.status === "completed").length,
          "green",
          "tasks",
        ),
      ]),
      actionGroup("liveTasks", "直播待办", [
        actionItem(
          "notStarted",
          "未开播",
          facts.notStartedTasks.length,
          facts.notStartedTasks.length > 0 ? "red" : "neutral",
          "tasks",
        ),
        actionItem(
          "anomaly",
          "异常",
          anomalyCount,
          anomalyCount > 0 ? "red" : "neutral",
          "tasks",
        ),
      ]),
      actionGroup("reports", "报数待办", [
        actionItem(
          "pendingReports",
          "待审核",
          facts.pendingReports.length,
          facts.pendingReports.length > 0 ? "amber" : "neutral",
          "reports",
        ),
        actionItem(
          "allReports",
          "总报数",
          facts.reports.length,
          "neutral",
          "reports",
        ),
      ]),
      actionGroup("admission", "准入待办", [
        actionItem(
          "recordings",
          "录屏待审",
          facts.recordingPendingCount,
          facts.recordingPendingCount > 0 ? "amber" : "neutral",
          "projects",
        ),
        actionItem(
          "streamerGap",
          "主播缺口",
          facts.streamerGapProjectCount,
          facts.streamerGapProjectCount > 0 ? "red" : "neutral",
          "projects",
        ),
      ]),
    ];
  }

  if (role === "finance") {
    return [
      actionGroup("batches", "批次待办", [
        actionItem(
          "draft",
          "待生成",
          facts.draftBatchCount,
          "neutral",
          "settle",
        ),
        actionItem(
          "pendingConfirm",
          "待确认",
          batchCount("pending_confirm", "generated"),
          batchCount("pending_confirm", "generated") > 0 ? "amber" : "neutral",
          "settle",
        ),
      ]),
      actionGroup("locked", "锁定待办", [
        actionItem("locked", "已锁定", batchCount("locked"), "green", "settle"),
        actionItem(
          "exported",
          "已导出",
          batchCount("exported"),
          "neutral",
          "settle",
        ),
      ]),
      actionGroup("risks", "风险待办", [
        actionItem(
          "reopened",
          "重开",
          facts.reopenedBatchCount,
          facts.reopenedBatchCount > 0 ? "red" : "neutral",
          "settle",
        ),
        actionItem(
          "weakEvidence",
          "弱证据",
          facts.weakSettlementPool.length,
          facts.weakSettlementPool.length > 0 ? "amber" : "neutral",
          "settle",
        ),
      ]),
      actionGroup("reports", "报数待办", [
        actionItem(
          "pendingReports",
          "待审核",
          facts.pendingReports.length,
          facts.pendingReports.length > 0 ? "amber" : "neutral",
          "reports",
        ),
        actionItem(
          "pool",
          "可结算",
          facts.settlementPool.length,
          "neutral",
          "settle",
        ),
      ]),
    ];
  }

  if (role === "ops_manager") {
    return [
      actionGroup("projects", "项目待办", [
        actionItem(
          "active",
          "执行中",
          facts.activeProjects.length,
          "blue",
          "projects",
        ),
        actionItem(
          "recruiting",
          "招募中",
          recruitingCount,
          "neutral",
          "projects",
        ),
      ]),
      actionGroup("admission", "准入待办", [
        actionItem(
          "recordings",
          "录屏待审",
          facts.recordingPendingCount,
          facts.recordingPendingCount > 0 ? "amber" : "neutral",
          "projects",
        ),
        actionItem(
          "streamerGap",
          "主播缺口",
          facts.streamerGapProjectCount,
          facts.streamerGapProjectCount > 0 ? "red" : "neutral",
          "projects",
        ),
      ]),
      actionGroup("liveTasks", "直播待办", [
        actionItem(
          "today",
          "今日排班",
          facts.todayTasks.length,
          "green",
          "tasks",
        ),
        actionItem(
          "anomaly",
          "异常",
          anomalyCount,
          anomalyCount > 0 ? "red" : "neutral",
          "tasks",
        ),
      ]),
      actionGroup("reports", "报数待办", [
        actionItem(
          "pendingReports",
          "待审核",
          facts.pendingReports.length,
          facts.pendingReports.length > 0 ? "amber" : "neutral",
          "reports",
        ),
        actionItem(
          "notStarted",
          "未开播",
          facts.notStartedTasks.length,
          facts.notStartedTasks.length > 0 ? "red" : "neutral",
          "tasks",
        ),
      ]),
    ];
  }

  return [
    actionGroup("projects", "项目待办", [
      actionItem(
        "active",
        "进行中",
        facts.activeProjects.length,
        "blue",
        "projects",
      ),
      actionItem(
        "recruiting",
        "招募中",
        recruitingCount,
        "neutral",
        "projects",
      ),
    ]),
    actionGroup("reviews", "复盘待办", [
      actionItem(
        "lowMargin",
        "低毛利",
        facts.lowMarginProjects.filter((project) => {
          const margin = project.metrics?.margin;
          return typeof margin === "number" && margin >= 0;
        }).length,
        "amber",
        "projects",
      ),
      actionItem(
        "negativeMargin",
        "负毛利",
        facts.lowMarginProjects.filter((project) => {
          const margin = project.metrics?.margin;
          return typeof margin === "number" && margin < 0;
        }).length,
        "red",
        "projects",
      ),
    ]),
    actionGroup("settlement", "结算待办", [
      actionItem("draft", "待生成", facts.draftBatchCount, "neutral", "settle"),
      actionItem(
        "pendingConfirm",
        "待确认",
        batchCount("pending_confirm", "generated"),
        batchCount("pending_confirm", "generated") > 0 ? "amber" : "neutral",
        "settle",
      ),
    ]),
    actionGroup("audit", "审计待办", [
      actionItem(
        "highRisk",
        "高风险",
        highRiskCount,
        highRiskCount > 0 ? "red" : "neutral",
        "audit",
      ),
      actionItem(
        "reopened",
        "重开",
        facts.reopenedBatchCount,
        facts.reopenedBatchCount > 0 ? "red" : "neutral",
        "settle",
      ),
    ]),
  ];
}

function buildPersonalPanel(
  dashboard: RoleHomeDashboardDto,
  facts: ReturnType<typeof collectFacts>,
  actionGroups: DashboardActionGroup[],
): DashboardPersonalPanel {
  const actionTotal = actionGroups.reduce(
    (groupTotal, group) =>
      groupTotal +
      group.items.reduce((itemTotal, item) => itemTotal + item.value, 0),
    0,
  );
  const riskCount = dashboard.risks.length + dashboard.drilldowns.length;
  const anomalyCount = facts.anomalyTasks.length + facts.projectAnomalyCount;
  const recommendations = buildPersonalRecommendations(
    dashboard,
    facts,
    anomalyCount,
  );
  const todos = buildPersonalTodos(facts, anomalyCount);

  return {
    summary: [
      personalSummary(
        "activeProjects",
        "在营项目",
        facts.activeProjects.length,
        "blue",
      ),
      personalSummary("todoTotal", "待办合计", actionTotal, "violet"),
      personalSummary(
        "risks",
        "风险数",
        riskCount,
        riskCount > 0 ? "amber" : "neutral",
        riskCount > 0,
      ),
      personalSummary(
        "todayTasks",
        "今日场次",
        facts.todayTasks.length,
        "green",
      ),
    ],
    recommendations,
    todos,
  };
}

function buildPersonalRecommendations(
  dashboard: RoleHomeDashboardDto,
  facts: ReturnType<typeof collectFacts>,
  anomalyCount: number,
): DashboardPersonalRecommendation[] {
  const recommendations: DashboardPersonalRecommendation[] = [];

  if (facts.highRiskNotices.length > 0) {
    recommendations.push(
      personalRecommendation(
        "highRiskNotices",
        "险",
        "处理高风险通知",
        `${facts.highRiskNotices.length} 条待核验`,
        "amber",
        "去处理",
        "audit",
      ),
    );
  }
  if (facts.recordingPendingCount > 0) {
    recommendations.push(
      personalRecommendation(
        "recordings",
        "录",
        "优先处理录屏审核",
        `${facts.recordingPendingCount} 条待审`,
        "amber",
        "去审核",
        "projects",
      ),
    );
  }
  if (anomalyCount > 0) {
    recommendations.push(
      personalRecommendation(
        "anomalies",
        "异",
        "跟进异常直播任务",
        `${anomalyCount} 个异常`,
        "amber",
        "去处理",
        "tasks",
      ),
    );
  }
  if (facts.lowMarginProjects.length > 0) {
    recommendations.push(
      personalRecommendation(
        "lowMargin",
        "复",
        "复盘低毛利项目",
        `${facts.lowMarginProjects.length} 个低于阈值`,
        "amber",
        "去复盘",
        "projects",
      ),
    );
  }
  if (facts.pendingReports.length > 0) {
    recommendations.push(
      personalRecommendation(
        "pendingReports",
        "审",
        "清理待审报数",
        `${facts.pendingReports.length} 条`,
        "blue",
        "去审核",
        "reports",
      ),
    );
  }

  const rankingCount = dashboard.panels?.projectRanking?.rows.length ?? 0;
  if (recommendations.length === 0 && rankingCount > 0) {
    recommendations.push(
      personalRecommendation(
        "projectRanking",
        "看",
        "查看项目经营排行",
        `${rankingCount} 个项目有毛利数据`,
        "blue",
        "查看",
        "projects",
      ),
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      personalRecommendation(
        "overview",
        "稳",
        "关注经营总览",
        "暂无紧急风险",
        "neutral",
        "查看",
        "projects",
      ),
    );
  }

  return recommendations.slice(0, 3);
}

function buildPersonalTodos(
  facts: ReturnType<typeof collectFacts>,
  anomalyCount: number,
): DashboardPersonalTodo[] {
  const pendingConfirmCount = facts.batches.filter((batch) =>
    ["pending_confirm", "generated"].includes(batch.status),
  ).length;
  const todos: DashboardPersonalTodo[] = [];

  if (facts.highRiskNotices.length > 0) {
    todos.push(
      personalTodo(
        "highRiskNotices",
        "核验高风险通知",
        facts.highRiskNotices.length,
        "amber",
        "audit",
      ),
    );
  }
  if (facts.pendingReports.length > 0) {
    todos.push(
      personalTodo(
        "pendingReports",
        "审核待审报数",
        facts.pendingReports.length,
        "amber",
        "reports",
      ),
    );
  }
  if (anomalyCount > 0) {
    todos.push(
      personalTodo(
        "anomalies",
        "处理异常直播任务",
        anomalyCount,
        "amber",
        "tasks",
      ),
    );
  }
  if (facts.recordingPendingCount > 0) {
    todos.push(
      personalTodo(
        "recordings",
        "核验录屏待审",
        facts.recordingPendingCount,
        "amber",
        "projects",
      ),
    );
  }
  if (facts.draftBatchCount > 0) {
    todos.push(
      personalTodo(
        "draftBatches",
        "生成结算批次",
        facts.draftBatchCount,
        "neutral",
        "settle",
      ),
    );
  }
  if (pendingConfirmCount > 0) {
    todos.push(
      personalTodo(
        "pendingConfirmBatches",
        "确认待确认批次",
        pendingConfirmCount,
        "amber",
        "settle",
      ),
    );
  }
  if (facts.reopenedBatchCount > 0) {
    todos.push(
      personalTodo(
        "reopenedBatches",
        "复核重开批次",
        facts.reopenedBatchCount,
        "red",
        "settle",
      ),
    );
  }
  if (todos.length === 0) {
    todos.push({
      key: "none",
      text: "暂无紧急待办，保持关注经营总览",
      tone: "neutral",
      target: { route: "projects" },
    });
  }

  return todos.slice(0, 5);
}

function actionGroup(
  key: string,
  title: string,
  items: DashboardActionItem[],
): DashboardActionGroup {
  return { key, title, items };
}

function actionItem(
  key: string,
  label: string,
  value: number,
  tone: DashboardTone,
  route?: DashboardTarget["route"],
): DashboardActionItem {
  return {
    key,
    label,
    value,
    tone,
    ...(route ? { target: { route } } : {}),
  };
}

function personalSummary(
  key: string,
  label: string,
  value: number,
  tone: DashboardTone,
  attention = false,
): DashboardPersonalSummaryItem {
  return { key, label, value, tone, ...(attention ? { attention } : {}) };
}

function personalRecommendation(
  key: string,
  icon: string,
  text: string,
  sub: string,
  tone: DashboardTone,
  cta: string,
  route: DashboardTarget["route"],
): DashboardPersonalRecommendation {
  return { key, icon, text, sub, tone, cta, target: { route } };
}

function personalTodo(
  key: string,
  text: string,
  count: number,
  tone: DashboardTone,
  route: DashboardTarget["route"],
): DashboardPersonalTodo {
  return { key, text, count, tone, target: { route } };
}

function ownerDashboard(
  role: DashboardStaffRole,
  facts: ReturnType<typeof collectFacts>,
  generatedAt: string,
): RoleHomeDashboardDto {
  return {
    profile: {
      role,
      title: "经营总览看板",
      subtitle: "关注收入、毛利、履约和高风险动作",
      scopeLabel: "全组织",
    },
    kpis: [
      kpi("activeProjects", "进行中项目", facts.activeProjects.length, "个"),
      kpi("vendorReceivable", "本月厂家应收", facts.totalReceivable, "元"),
      kpi("estimatedGross", "预计毛利", facts.totalGross, "元"),
      kpi("grossMarginRate", "预计毛利率", facts.grossMarginRate, "%"),
      kpi(
        "highRiskItems",
        "高风险事项",
        facts.highRiskNotices.length,
        "项",
        "red",
      ),
    ],
    queue: projectQueue(facts.activeProjects, "project"),
    risks: [
      ...(facts.lowMarginProjects.length > 0
        ? [
            riskItem(
              "lowMarginProjects",
              "低毛利项目",
              `${facts.lowMarginProjects.length} 个项目毛利率低于 20%`,
              "projects",
            ),
          ]
        : []),
      ...(facts.reopenedBatchCount > 0
        ? [
            riskItem(
              "reopenedBatches",
              "重开批次",
              `${facts.reopenedBatchCount} 个结算批次被重开`,
              "settle",
            ),
          ]
        : []),
    ],
    drilldowns: highRiskQueue(facts.highRiskNotices),
    panels: {
      projectRanking: buildProjectRanking(facts.allProjects),
      admissionFunnel: buildAdmissionFunnel(facts.allProjects),
      settlementFunnel: buildSettlementFunnel(facts),
      batchLanes: buildBatchLanes(facts),
      amountRisks: buildAmountRisks(facts),
    },
    generatedAt,
  };
}

function opsManagerDashboard(
  role: DashboardStaffRole,
  facts: ReturnType<typeof collectFacts>,
  generatedAt: string,
): RoleHomeDashboardDto {
  return {
    profile: {
      role,
      title: "项目推进看板",
      subtitle: "关注招募、录屏、排班、报数和异常卡点",
      scopeLabel: "授权项目",
    },
    kpis: [
      kpi("activeProjects", "招募/执行项目", facts.activeProjects.length, "个"),
      kpi(
        "deliveryProgress",
        "履约进度",
        progressRate(facts.doneHours, facts.plannedHours),
        "%",
      ),
      kpi(
        "streamerGapProjects",
        "主播缺口项目",
        facts.streamerGapProjectCount,
        "个",
      ),
      kpi("recordingsPending", "录屏待审", facts.recordingPendingCount, "条"),
      kpi("pendingReports", "待审核报数", facts.pendingReports.length, "条"),
      kpi(
        "anomalyTasks",
        "异常任务",
        facts.anomalyTasks.length + facts.projectAnomalyCount,
        "项",
        "red",
      ),
    ],
    queue: projectQueue(facts.activeProjects, "tasks"),
    risks: anomalyQueue(facts.anomalyTasks),
    drilldowns: reportQueue(facts.pendingReports),
    panels: {
      admissionFunnel: buildAdmissionFunnel(facts.allProjects),
    },
    generatedAt,
  };
}

function operatorDashboard(
  role: DashboardStaffRole,
  facts: ReturnType<typeof collectFacts>,
  generatedAt: string,
): RoleHomeDashboardDto {
  return {
    profile: {
      role,
      title: "我的今日待办",
      subtitle: "关注自己负责项目的任务、报数和主播提醒",
      scopeLabel: "我的项目",
    },
    kpis: [
      kpi("myTodayTasks", "我的今日任务", facts.todayTasks.length, "项"),
      kpi(
        "notStartedTasks",
        "未开播",
        facts.notStartedTasks.length,
        "项",
        "amber",
      ),
      kpi("pendingReports", "待审核报数", facts.pendingReports.length, "条"),
      kpi(
        "streamerReminders",
        "需联系主播",
        facts.anomalyTasks.length,
        "人",
        "red",
      ),
    ],
    queue: taskQueue(facts.todayTasks),
    risks: anomalyQueue(facts.anomalyTasks),
    drilldowns: reportQueue(facts.pendingReports),
    generatedAt,
  };
}

function financeDashboard(
  role: DashboardStaffRole,
  facts: ReturnType<typeof collectFacts>,
  generatedAt: string,
): RoleHomeDashboardDto {
  return {
    profile: {
      role,
      title: "结算安全看板",
      subtitle: "关注可结算池、弱证据、人工承载和批次状态",
      scopeLabel: "财务授权范围",
    },
    kpis: [
      kpi(
        "settlementPoolAmount",
        "可结算池金额",
        facts.settlementPoolAmount,
        "元",
      ),
      kpi(
        "settlementPoolCount",
        "可结算报数",
        facts.settlementPool.length,
        "条",
      ),
      kpi("draftBatches", "待生成批次", facts.draftBatchCount, "个"),
      kpi(
        "weakEvidenceAmount",
        "弱证据金额",
        facts.weakEvidenceAmount,
        "元",
        "amber",
      ),
      kpi("reopenedBatches", "重开批次", facts.reopenedBatchCount, "个", "red"),
    ],
    queue: settlementQueue(facts.settlementPool),
    risks:
      facts.weakEvidenceAmount > 0
        ? [
            riskItem(
              "weakEvidence",
              "弱证据金额",
              `¥${facts.weakEvidenceAmount.toLocaleString("zh-CN")}`,
              "settle",
            ),
          ]
        : [],
    drilldowns: highRiskQueue(facts.highRiskNotices),
    panels: {
      settlementFunnel: buildSettlementFunnel(facts),
      batchLanes: buildBatchLanes(facts),
      amountRisks: buildAmountRisks(facts),
    },
    generatedAt,
  };
}

const BATCH_LANE_DEFS: { key: string; label: string; tone: DashboardTone }[] = [
  { key: "draft", label: "草稿", tone: "neutral" },
  { key: "generated", label: "已生成", tone: "blue" },
  { key: "pending_confirm", label: "待确认", tone: "amber" },
  { key: "locked", label: "已锁定", tone: "violet" },
  { key: "exported", label: "已导出", tone: "green" },
];

function buildAdmissionFunnel(
  projects: DashboardProjectInput[],
): DashboardFunnel {
  const candidate = sumBy(projects, (p) => p.streamers?.candidate);
  const pendingReview = sumBy(projects, (p) => p.streamers?.pendingReview);
  const active = sumBy(projects, (p) => p.streamers?.active);
  const applied = candidate + pendingReview + active;
  const review = pendingReview + active;
  const rate = (value: number) =>
    applied > 0 ? Number(((value / applied) * 100).toFixed(0)) : 0;
  return {
    title: "准入漏斗 · 录屏到入项",
    subtitle: "候选 → 录屏待审 → 最终入项",
    unit: "人",
    stages: [
      {
        key: "applied",
        label: "报名/候选",
        value: applied,
        rate: 100,
        tone: "blue",
      },
      {
        key: "review",
        label: "录屏待审",
        value: review,
        rate: rate(review),
        tone: "amber",
      },
      {
        key: "admitted",
        label: "最终入项",
        value: active,
        rate: rate(active),
        tone: "green",
      },
    ],
    target: { route: "projects" },
  };
}

function buildSettlementFunnel(
  facts: ReturnType<typeof collectFacts>,
): DashboardFunnel {
  const poolAmount = facts.settlementPoolAmount;
  const draftAmount = sumBy(facts.draftBatches, (b) => b.totalAmount);
  const generatedAmount = sumBy(
    facts.batches.filter((b) => b.status !== "draft"),
    (b) => b.totalAmount,
  );
  const rate = (value: number) =>
    poolAmount > 0 ? Number(((value / poolAmount) * 100).toFixed(0)) : 0;
  return {
    title: "结算池漏斗 · 金额流转",
    subtitle: "已审核进池 → 待生成批次 → 已生成批次",
    unit: "元",
    stages: [
      {
        key: "pool",
        label: "已审核进池",
        value: poolAmount,
        rate: 100,
        tone: "blue",
      },
      {
        key: "draft",
        label: "待生成批次",
        value: draftAmount,
        rate: rate(draftAmount),
        tone: "amber",
      },
      {
        key: "generated",
        label: "已生成批次",
        value: generatedAmount,
        rate: rate(generatedAmount),
        tone: "green",
      },
    ],
    target: { route: "settle" },
  };
}

function buildBatchLanes(facts: ReturnType<typeof collectFacts>) {
  const lanes: DashboardLane[] = BATCH_LANE_DEFS.map((def) => {
    const items = facts.batches.filter((b) => b.status === def.key);
    return {
      key: def.key,
      label: def.label,
      tone: def.tone,
      count: items.length,
      amount: sumBy(items, (b) => b.totalAmount),
    };
  });
  return {
    title: "结算批次泳道",
    subtitle: "草稿 / 已生成 / 待确认 / 已锁定 / 已导出",
    lanes,
    target: { route: "settle" as const },
  };
}

function buildAmountRisks(facts: ReturnType<typeof collectFacts>) {
  const reopenedAmount = sumBy(facts.reopenedBatches, (b) => b.totalAmount);
  const manualPool = facts.settlementPool.filter(
    (i) => i.timeSource === "manual" || i.timeSource === "gift",
  );
  const manualAmount = sumBy(manualPool, (i) => i.expectedAmount);
  const rows: DashboardAmountRisk[] = [];
  if (facts.weakEvidenceAmount > 0) {
    rows.push({
      key: "weak",
      label: "弱证据金额",
      amount: facts.weakEvidenceAmount,
      hint: `${facts.weakSettlementPool.length} 条 · 黄/红`,
      tone: "amber",
      target: { route: "settle" },
    });
  }
  if (manualAmount > 0) {
    rows.push({
      key: "manual",
      label: "人工承载金额",
      amount: manualAmount,
      hint: `${manualPool.length} 条 · 礼物/手工`,
      tone: "violet",
      target: { route: "settle" },
    });
  }
  if (reopenedAmount > 0 || facts.reopenedBatchCount > 0) {
    rows.push({
      key: "reopen",
      label: "重开批次金额",
      amount: reopenedAmount,
      hint: `${facts.reopenedBatchCount} 个批次`,
      tone: "red",
      target: { route: "settle" },
    });
  }
  return {
    title: "金额风险榜",
    subtitle: "弱证据 / 人工承载 / 重开批次",
    rows,
    target: { route: "settle" as const },
  };
}

function buildProjectRanking(projects: DashboardProjectInput[]) {
  const rows: DashboardRankRow[] = [...projects]
    .filter((p) => typeof p.metrics?.gross === "number")
    .sort((a, b) => (b.metrics?.gross ?? 0) - (a.metrics?.gross ?? 0))
    .slice(0, 6)
    .map((p) => ({
      key: `rank:${p.id}`,
      title: p.name,
      value: p.metrics?.gross ?? 0,
      hint:
        typeof p.metrics?.margin === "number"
          ? `毛利率 ${p.metrics.margin.toFixed(1)}%`
          : undefined,
      tone: (p.metrics?.margin ?? 100) < 20 ? "amber" : "neutral",
      target: { route: "project", id: p.id },
    }));
  return {
    title: "项目经营排行",
    subtitle: "按毛利贡献 · 点击进入复盘",
    rows,
  };
}

function kpi(
  key: string,
  label: string,
  value: number | string,
  unit?: string,
  tone: DashboardTone = "neutral",
): DashboardKpi {
  return { key, label, value, unit, tone };
}

function projectQueue(
  projects: DashboardProjectInput[],
  route: DashboardTarget["route"],
): DashboardQueueItem[] {
  return projects.slice(0, 5).map((project) => ({
    key: `project:${project.id}`,
    title: project.name,
    subtitle: project.leadOps
      ? `${project.status} / ${project.leadOps}`
      : project.status,
    tone: project.risk === "high" ? "red" : "neutral",
    target: { route, id: project.id },
  }));
}

function taskQueue(tasks: DashboardTaskInput[]): DashboardQueueItem[] {
  return tasks.slice(0, 5).map((task) => ({
    key: `task:${task.id}`,
    title: task.projectName || task.project || "未知项目",
    subtitle: `${task.streamerName || "未知主播"} / ${task.status}`,
    tone: task.anomaly ? "red" : "blue",
    target: { route: "tasks", id: task.id },
  }));
}

function reportQueue(reports: DashboardReportInput[]): DashboardQueueItem[] {
  return reports.slice(0, 5).map((report) => ({
    key: `report:${report.id}`,
    title: report.project || "未知项目",
    subtitle: `${report.streamer || "未知主播"} / ${report.status}`,
    tone: report.status === "pending_adjudication" ? "violet" : "blue",
    target: { route: "reports", id: report.id },
  }));
}

function anomalyQueue(tasks: DashboardTaskInput[]): DashboardQueueItem[] {
  return tasks.slice(0, 5).map((task) => ({
    key: `task:${task.id}`,
    title: task.projectName || task.project || "未知项目",
    subtitle: `${task.streamerName || "未知主播"} / ${task.status}`,
    tone: "red",
    target: { route: "tasks", id: task.id },
  }));
}

function highRiskQueue(
  items: DashboardNotificationInput[],
): DashboardQueueItem[] {
  return items.slice(0, 5).map((item) => ({
    key: `notice:${item.id}`,
    title: item.title,
    subtitle: item.type,
    tone: "red",
    target: {
      route: item.objectType === "settlement_batch" ? "settle" : "audit",
      id: item.objectId || item.id,
    },
  }));
}

function settlementQueue(
  items: DashboardSettlementPoolInput[],
): DashboardQueueItem[] {
  return items.slice(0, 5).map((item) => ({
    key: `settlement:${item.id}`,
    title: item.projectName || "未知项目",
    subtitle: `${item.streamerName || "未知主播"} / ${item.evidenceLevel || "unknown"}`,
    tone:
      item.evidenceLevel === "red"
        ? "red"
        : item.evidenceLevel === "yellow"
          ? "amber"
          : "green",
    target: { route: "settle", id: item.id },
  }));
}

function riskItem(
  key: string,
  title: string,
  subtitle: string,
  route: DashboardTarget["route"],
): DashboardQueueItem {
  return {
    key,
    title,
    subtitle,
    tone: "amber",
    target: { route },
  };
}

function progressRate(done: number, planned: number) {
  return planned > 0 ? Number(((done / planned) * 100).toFixed(1)) : 0;
}

function isTaskForToday(
  task: DashboardTaskInput,
  now: string,
  timeZone: string,
) {
  const nowDay = dayKey(now, timeZone);
  const startDay = task.plannedStartAt
    ? dayKey(task.plannedStartAt, timeZone)
    : null;
  const endDay = task.plannedEndAt ? dayKey(task.plannedEndAt, timeZone) : null;

  return startDay === nowDay || endDay === nowDay;
}

function dayKey(value: string, timeZone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const dayParts = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${dayParts.year}-${dayParts.month}-${dayParts.day}`;
}

function rejectUnsupportedRole(role: never): never {
  throw new Error(`Unsupported dashboard role: ${String(role)}`);
}

function sumBy<T>(items: T[], getter: (item: T) => number | null | undefined) {
  return items.reduce((sum, item) => sum + (getter(item) ?? 0), 0);
}

function withEmptyState(dashboard: RoleHomeDashboardDto): RoleHomeDashboardDto {
  const hasContent =
    dashboard.kpis.some(
      (item) => typeof item.value === "number" && item.value > 0,
    ) ||
    dashboard.queue.length > 0 ||
    dashboard.risks.length > 0 ||
    dashboard.drilldowns.length > 0;

  if (hasContent) {
    return dashboard;
  }

  return {
    ...dashboard,
    emptyState: {
      title: "暂无需要处理的项目经营数据",
      hint: "有项目、任务、报数或结算记录后，这里会显示对应看板。",
    },
  };
}
