import type {
  DashboardQueueItem,
  RoleHomeDashboardDto,
} from "@/features/dashboards/role-home";

export type BusinessCopilotIntent =
  | "executive_health"
  | "operations_priority"
  | "settlement_risk"
  | "evidence_quality"
  | "unsupported";

export type BusinessCopilotFact = {
  label: string;
  value: number | string;
  unit?: string;
  sourceTool: "role_home_dashboard";
  sourceId: string;
};

export type BusinessCopilotAnswer = {
  question: string;
  intent: BusinessCopilotIntent;
  answer: string;
  facts: BusinessCopilotFact[];
  findings: Array<{
    summary: string;
    evidence: Array<{ sourceTool: "role_home_dashboard"; sourceId: string }>;
  }>;
  recommendations: Array<{
    proposal: string;
    requiresHumanApproval: true;
    target?: DashboardQueueItem["target"];
  }>;
  drilldowns: Array<{
    label: string;
    target: DashboardQueueItem["target"];
  }>;
  caveats: string[];
  generatedAt: string;
};

export function classifyBusinessCopilotIntent(
  question: string,
): BusinessCopilotIntent {
  const normalized = question.trim().toLowerCase();

  if (!normalized || looksLikeRawSql(normalized)) return "unsupported";

  if (
    /(结算|金额|财务|批次|应付|弱证据|重开|settlement|finance)/i.test(normalized)
  ) {
    return "settlement_risk";
  }

  if (
    /(ocr|截图|证据|黄|红|复核|时长|evidence|screenshot)/i.test(normalized)
  ) {
    return "evidence_quality";
  }

  if (
    /(今天|优先|待办|卡住|排班|报数|异常|处理|priority)/i.test(normalized)
  ) {
    return "operations_priority";
  }

  if (
    /(健康|毛利|利润|收入|风险|老板|经营|margin|revenue|profit)/i.test(normalized)
  ) {
    return "executive_health";
  }

  return "unsupported";
}

export function runBusinessCopilotAgent(input: {
  question: string;
  dashboard: RoleHomeDashboardDto;
}): BusinessCopilotAnswer {
  const intent = classifyBusinessCopilotIntent(input.question);
  const base = {
    question: input.question.trim(),
    intent,
    generatedAt: input.dashboard.generatedAt,
  };

  if (intent === "unsupported") {
    return {
      ...base,
      answer: "这个问题不在当前经营问答的安全范围内。",
      facts: [],
      findings: [],
      recommendations: [
        {
          proposal: "请改问经营健康、今日优先级、结算风险或证据质量。",
          requiresHumanApproval: true,
        },
      ],
      drilldowns: [],
      caveats: ["经营问答不会执行 SQL、跨组织查询或生产写动作。"],
    };
  }

  const facts = factsForIntent(intent, input.dashboard);

  return {
    ...base,
    answer: answerForIntent(intent),
    facts,
    findings: facts.length
      ? [
          {
            summary: findingForIntent(intent),
            evidence: facts.map((fact) => ({
              sourceTool: fact.sourceTool,
              sourceId: fact.sourceId,
            })),
          },
        ]
      : [],
    recommendations: recommendationsForIntent(intent, input.dashboard),
    drilldowns: collectDrilldowns(input.dashboard),
    caveats: caveatsForDashboard(input.dashboard),
  };
}

function looksLikeRawSql(value: string) {
  return /\b(select|insert|update|delete|drop|alter|truncate)\b/i.test(value);
}

function factsForIntent(
  intent: Exclude<BusinessCopilotIntent, "unsupported">,
  dashboard: RoleHomeDashboardDto,
): BusinessCopilotFact[] {
  const keysByIntent: Record<typeof intent, string[]> = {
    executive_health: [
      "activeProjects",
      "vendorReceivable",
      "estimatedGross",
      "grossMarginRate",
      "highRiskItems",
    ],
    operations_priority: [
      "myTodayTasks",
      "notStartedTasks",
      "pendingReports",
      "streamerReminders",
      "activeProjects",
      "anomalyTasks",
    ],
    settlement_risk: [
      "settlementPoolAmount",
      "settlementPoolCount",
      "draftBatches",
      "weakEvidenceAmount",
      "reopenedBatches",
    ],
    evidence_quality: [
      "pendingReports",
      "weakEvidenceAmount",
      "highRiskItems",
      "reopenedBatches",
    ],
  };
  const allowedKeys = new Set(keysByIntent[intent]);

  return dashboard.kpis
    .filter((kpi) => allowedKeys.has(kpi.key))
    .map((kpi) => ({
      label: kpi.label,
      value: kpi.value,
      unit: kpi.unit,
      sourceTool: "role_home_dashboard" as const,
      sourceId: `kpi:${kpi.key}`,
    }));
}

function answerForIntent(
  intent: Exclude<BusinessCopilotIntent, "unsupported">,
) {
  const answers: Record<typeof intent, string> = {
    executive_health: "经营健康判断已基于当前角色看板生成。",
    operations_priority: "今日优先级已基于当前待办和风险队列生成。",
    settlement_risk: "结算风险已基于当前结算安全看板生成。",
    evidence_quality: "证据质量判断已基于当前报数和结算风险生成。",
  };

  return answers[intent];
}

function findingForIntent(
  intent: Exclude<BusinessCopilotIntent, "unsupported">,
) {
  const findings: Record<typeof intent, string> = {
    executive_health: "需要同时关注经营结果和高风险事项。",
    operations_priority: "优先处理会阻塞交付和报数闭环的事项。",
    settlement_risk: "结算前应先复核弱证据和重开批次。",
    evidence_quality: "证据不足会影响审核可信度和结算安全。",
  };

  return findings[intent];
}

function recommendationsForIntent(
  intent: Exclude<BusinessCopilotIntent, "unsupported">,
  dashboard: RoleHomeDashboardDto,
) {
  const primaryTarget =
    dashboard.risks[0]?.target ??
    dashboard.queue[0]?.target ??
    dashboard.drilldowns[0]?.target;
  const proposalByIntent: Record<typeof intent, string> = {
    executive_health: "先打开风险最高的项目或审计记录复核。",
    operations_priority: "先处理优先队列顶部事项，再进入对应模块。",
    settlement_risk: "先复核弱证据和重开批次，再推进结算动作。",
    evidence_quality: "先核对截图、系统时长和人工复核原因。",
  };

  return [
    {
      proposal: proposalByIntent[intent],
      requiresHumanApproval: true as const,
      ...(primaryTarget ? { target: primaryTarget } : {}),
    },
  ];
}

function collectDrilldowns(dashboard: RoleHomeDashboardDto) {
  return [...dashboard.risks, ...dashboard.queue, ...dashboard.drilldowns]
    .filter((item) => item.target?.route)
    .slice(0, 5)
    .map((item) => ({ label: item.title, target: item.target }));
}

function caveatsForDashboard(dashboard: RoleHomeDashboardDto) {
  const caveats = [
    `数据范围：${dashboard.profile.scopeLabel}`,
    "回答仅基于当前角色可见的经营看板事实。",
  ];

  if (dashboard.emptyState) {
    caveats.push(dashboard.emptyState.hint);
  }

  return caveats;
}
