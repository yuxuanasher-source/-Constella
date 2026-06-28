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

export type BusinessCopilotEvidence = {
  sourceTool: "role_home_dashboard";
  sourceId: string;
};

export type BusinessCopilotSourceSummary = {
  sourceTool: "role_home_dashboard";
  scopeLabel: string;
  generatedAt: string;
  readableAreas: Array<"kpis" | "queue" | "risks" | "drilldowns">;
};

export type BusinessCopilotConfidence = {
  level: "low" | "medium" | "high";
  label: string;
  reason: string;
};

export type BusinessCopilotAnswer = {
  question: string;
  intent: BusinessCopilotIntent;
  answer: string;
  facts: BusinessCopilotFact[];
  findings: Array<{
    summary: string;
    evidence: BusinessCopilotEvidence[];
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
  projectHealth: BusinessCopilotProjectHealth;
  suggestedActions: BusinessCopilotSuggestedAction[];
  generatedAt: string;
  sourceSummary: BusinessCopilotSourceSummary;
  confidence: BusinessCopilotConfidence;
  requiresHumanConfirmation: true;
};

export type BusinessCopilotProjectHealthItem = {
  projectId?: string;
  projectName: string;
  priority: "high" | "medium" | "low";
  score: number;
  reasons: string[];
  evidence: BusinessCopilotEvidence[];
  target?: DashboardQueueItem["target"];
};

export type BusinessCopilotProjectHealth = {
  summary: string;
  topProjects: BusinessCopilotProjectHealthItem[];
};

export type BusinessCopilotSuggestedAction = {
  actionId: string;
  projectId?: string;
  projectName: string;
  priority: BusinessCopilotProjectHealthItem["priority"];
  title: string;
  rationale: string;
  evidence: BusinessCopilotEvidence[];
  target?: DashboardQueueItem["target"];
  requiresHumanApproval: true;
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

  if (/(priority|today|operations?|handle|todo|action|first)/i.test(normalized)) {
    return "operations_priority";
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
  const sourceSummary = sourceSummaryForDashboard(input.dashboard);
  const projectHealth = buildProjectHealth(input.dashboard);
  const base = {
    question: input.question.trim(),
    intent,
    generatedAt: input.dashboard.generatedAt,
    sourceSummary,
    projectHealth,
    requiresHumanConfirmation: true as const,
  };

  if (intent === "unsupported") {
    const facts: BusinessCopilotFact[] = [];

    return {
      ...base,
      answer: "这个问题不在当前经营问答的安全范围内。",
      facts,
      findings: [],
      recommendations: [
        {
          proposal: "请改问经营健康、今日优先级、结算风险或证据质量。",
          requiresHumanApproval: true,
        },
      ],
      suggestedActions: [],
      drilldowns: [],
      caveats: ["经营问答不会执行 SQL、跨组织查询或生产写动作。"],
      confidence: confidenceForAnswer({ intent, facts }),
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
    recommendations: recommendationsForIntent(
      intent,
      input.dashboard,
      projectHealth,
    ),
    suggestedActions: buildSuggestedActions(projectHealth),
    drilldowns: collectDrilldowns(input.dashboard),
    caveats: caveatsForDashboard(input.dashboard),
    confidence: confidenceForAnswer({ intent, facts }),
  };
}

export function buildProjectHealth(
  dashboard: RoleHomeDashboardDto,
): BusinessCopilotProjectHealth {
  const byProject = new Map<string, BusinessCopilotProjectHealthItem>();

  for (const row of dashboard.panels?.projectRanking?.rows ?? []) {
    const item = ensureProjectHealthItem(byProject, {
      key: row.key,
      title: row.title,
      target: row.target,
    });
    if (!item) continue;

    addProjectEvidence(item, {
      sourceTool: "role_home_dashboard",
      sourceId: `panel:projectRanking:${row.key}`,
    });

    if (row.value < 0) {
      addProjectReason(item, "Negative gross profit in project ranking");
      item.score += 45;
    } else if (row.tone === "red") {
      addProjectReason(item, "Red project ranking signal");
      item.score += 35;
    } else if (row.tone === "amber") {
      addProjectReason(item, "Low margin signal in project ranking");
      item.score += 25;
    }

    if (typeof row.hint === "string" && /-\d/.test(row.hint)) {
      addProjectReason(item, "Negative margin hint in project ranking");
      item.score += 10;
    }
  }

  for (const item of dashboard.risks) {
    const project = ensureProjectHealthItem(byProject, item);
    if (!project) continue;
    addProjectReason(project, "Matched current risk queue");
    addProjectEvidence(project, {
      sourceTool: "role_home_dashboard",
      sourceId: `risk:${item.key}`,
    });
    project.score += item.tone === "red" ? 45 : 30;
  }

  for (const item of dashboard.queue) {
    const project = ensureProjectHealthItem(byProject, item);
    if (!project) continue;
    addProjectReason(project, "Matched current operations queue");
    addProjectEvidence(project, {
      sourceTool: "role_home_dashboard",
      sourceId: `queue:${item.key}`,
    });
    project.score += item.tone === "red" ? 35 : 25;
  }

  for (const item of dashboard.drilldowns) {
    const project = ensureProjectHealthItem(byProject, item);
    if (!project) continue;
    addProjectReason(project, "Available dashboard drilldown");
    addProjectEvidence(project, {
      sourceTool: "role_home_dashboard",
      sourceId: `drilldown:${item.key}`,
    });
    project.score += 10;
  }

  const topProjects = [...byProject.values()]
    .filter((item) => item.score > 0)
    .map((item) => ({
      ...item,
      priority: priorityForProjectScore(item.score),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    summary: topProjects.length
      ? `Found ${topProjects.length} prioritized project(s) from dashboard ranking and queues.`
      : "No project-level health signals are available in the current dashboard.",
    topProjects,
  };
}

export function buildSuggestedActions(
  projectHealth: BusinessCopilotProjectHealth,
): BusinessCopilotSuggestedAction[] {
  return projectHealth.topProjects.flatMap((project) => {
    const actions: BusinessCopilotSuggestedAction[] = [];
    const projectKey =
      project.projectId ?? normalizeProjectKey(project.projectName) ?? "project";

    if (project.reasons.some((reason) => /margin|gross profit/i.test(reason))) {
      actions.push(
        buildSuggestedAction(project, {
          projectKey,
          suffix: "margin-review",
          title: "Review margin and cost assumptions",
          rationale:
            "The project has margin or gross-profit signals that need a human review before operational changes.",
          evidenceMatch: /projectRanking/i,
        }),
      );
    }

    if (project.reasons.some((reason) => /risk/i.test(reason))) {
      actions.push(
        buildSuggestedAction(project, {
          projectKey,
          suffix: "risk-validation",
          title: "Validate high-risk notice",
          rationale:
            "The project is present in the current risk queue and should be validated before follow-up actions.",
          evidenceMatch: /^risk:/i,
        }),
      );
    }

    if (project.reasons.some((reason) => /operations queue/i.test(reason))) {
      actions.push(
        buildSuggestedAction(project, {
          projectKey,
          suffix: "queue-clearance",
          title: "Clear blocking operations queue",
          rationale:
            "The project has blocking queue evidence that may delay reporting, settlement, or delivery.",
          evidenceMatch: /^queue:/i,
        }),
      );
    }

    return actions;
  });
}

export function sourceSummaryForDashboard(
  dashboard: RoleHomeDashboardDto,
): BusinessCopilotSourceSummary {
  return {
    sourceTool: "role_home_dashboard",
    scopeLabel: dashboard.profile.scopeLabel,
    generatedAt: dashboard.generatedAt,
    readableAreas: ["kpis", "queue", "risks", "drilldowns"],
  };
}

export function confidenceForAnswer({
  intent,
  facts,
}: {
  intent: BusinessCopilotIntent;
  facts: BusinessCopilotFact[];
}): BusinessCopilotConfidence {
  if (intent === "unsupported" || facts.length === 0) {
    return {
      level: "low",
      label: "低置信度",
      reason: "问题不在当前经营问答范围内，或没有可引用的角色看板事实。",
    };
  }

  if (facts.length >= 3) {
    return {
      level: "high",
      label: "高置信度",
      reason: "回答引用了三项以上当前角色看板事实。",
    };
  }

  return {
    level: "medium",
    label: "中等置信度",
    reason: "回答引用了当前角色看板事实，但仍需要人工确认业务后果。",
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
  projectHealth: BusinessCopilotProjectHealth,
) {
  const primaryTarget =
    projectHealth.topProjects[0]?.target ??
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

function ensureProjectHealthItem(
  byProject: Map<string, BusinessCopilotProjectHealthItem>,
  seed: {
    key: string;
    title: string;
    target?: DashboardQueueItem["target"];
  },
) {
  if (seed.target && seed.target.route !== "project") return null;

  const projectId = seed.target?.id;
  const projectKey = projectId ?? normalizeProjectKey(seed.title) ?? seed.key;
  const existing = byProject.get(projectKey);
  if (existing) {
    if (!existing.target && seed.target) existing.target = seed.target;
    return existing;
  }

  const item: BusinessCopilotProjectHealthItem = {
    projectName: seed.title,
    priority: "low",
    score: 0,
    reasons: [],
    evidence: [],
  };

  if (projectId) item.projectId = projectId;
  if (seed.target) item.target = seed.target;

  byProject.set(projectKey, item);
  return item;
}

function normalizeProjectKey(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.length ? normalized : null;
}

function addProjectReason(
  item: BusinessCopilotProjectHealthItem,
  reason: string,
) {
  if (!item.reasons.includes(reason)) item.reasons.push(reason);
}

function addProjectEvidence(
  item: BusinessCopilotProjectHealthItem,
  evidence: BusinessCopilotEvidence,
) {
  if (!item.evidence.some((entry) => entry.sourceId === evidence.sourceId)) {
    item.evidence.push(evidence);
  }
}

function buildSuggestedAction(
  project: BusinessCopilotProjectHealthItem,
  input: {
    projectKey: string;
    suffix: string;
    title: string;
    rationale: string;
    evidenceMatch: RegExp;
  },
): BusinessCopilotSuggestedAction {
  const matchedEvidence = project.evidence.filter((entry) =>
    input.evidenceMatch.test(entry.sourceId),
  );

  return {
    actionId: `${input.projectKey}:${input.suffix}`,
    ...(project.projectId ? { projectId: project.projectId } : {}),
    projectName: project.projectName,
    priority: project.priority,
    title: input.title,
    rationale: input.rationale,
    evidence: matchedEvidence.length ? matchedEvidence : project.evidence,
    ...(project.target ? { target: project.target } : {}),
    requiresHumanApproval: true,
  };
}

function priorityForProjectScore(
  score: number,
): BusinessCopilotProjectHealthItem["priority"] {
  if (score >= 60) return "high";
  if (score >= 25) return "medium";
  return "low";
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
