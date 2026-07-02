import type { RoleHomeDashboardDto } from "@/features/dashboards/role-home";
import type { AuthContext } from "@/lib/auth/context";
import {
  buildProjectHealth,
  buildSuggestedActions,
  type BusinessCopilotProjectHealth,
  type BusinessCopilotSuggestedAction,
} from "./business-copilot-agent";

export type DashboardChatFact = {
  label: string;
  value?: string;
  detail?: string;
  source: string;
  tone?: string;
  target?: unknown;
};

export type DashboardChatGrounding = {
  profile: {
    role: AuthContext["role"];
    organizationId: string;
    organizationName: string;
    scopeLabel: string;
  };
  generatedAt: string;
  facts: DashboardChatFact[];
  projectHealth: BusinessCopilotProjectHealth;
  suggestedActions: BusinessCopilotSuggestedAction[];
  missingData: string[];
  promptText: string;
};

export type StreamerProfileInsightGrounding = {
  id: string;
  streamerId: string;
  streamerName: string;
  title: string;
  summary: string;
  strengths?: string[];
  risks?: string[];
  recommendations?: string[];
  tags?: string[];
  sourceRef: string;
  confirmedAt?: string | null;
};

export function buildDashboardChatGrounding({
  dashboard,
  auth,
  streamerProfileInsights = [],
}: {
  dashboard: RoleHomeDashboardDto;
  auth: AuthContext;
  streamerProfileInsights?: StreamerProfileInsightGrounding[];
}): DashboardChatGrounding {
  const facts = [
    ...kpiFacts(dashboard),
    ...queueFacts("queue", dashboard.queue),
    ...queueFacts("risks", dashboard.risks),
    ...queueFacts("drilldowns", dashboard.drilldowns),
    ...panelFacts(dashboard),
    ...profileInsightFacts(streamerProfileInsights),
  ];
  const projectHealth = buildProjectHealth(dashboard);
  const suggestedActions = buildSuggestedActions(projectHealth);
  const missingData = missingDataNotes(dashboard, facts);
  const grounding: Omit<DashboardChatGrounding, "promptText"> = {
    profile: {
      role: auth.role,
      organizationId: auth.organizationId,
      organizationName: auth.organizationName,
      scopeLabel: dashboard.profile.scopeLabel,
    },
    generatedAt: dashboard.generatedAt,
    facts,
    projectHealth,
    suggestedActions,
    missingData,
  };

  return {
    ...grounding,
    promptText: buildPromptText(grounding),
  };
}

function kpiFacts(dashboard: RoleHomeDashboardDto): DashboardChatFact[] {
  return dashboard.kpis.map((kpi) => ({
    label: kpi.label,
    value: formatValue(kpi.value, kpi.unit),
    detail: kpi.hint,
    source: `dashboard.kpis.${kpi.key}`,
    tone: kpi.tone,
  }));
}

function queueFacts(
  kind: "queue" | "risks" | "drilldowns",
  items: RoleHomeDashboardDto["queue"],
): DashboardChatFact[] {
  return items.map((item) => ({
    label: item.title,
    detail: item.subtitle,
    source: `dashboard.${kind}.${item.key}`,
    tone: item.tone,
    target: item.target,
  }));
}

function panelFacts(dashboard: RoleHomeDashboardDto): DashboardChatFact[] {
  const panels = dashboard.panels;
  if (!panels) {
    return [];
  }

  return [
    ...funnelFacts("admissionFunnel", panels.admissionFunnel),
    ...funnelFacts("settlementFunnel", panels.settlementFunnel),
    ...batchLaneFacts(panels.batchLanes),
    ...amountRiskFacts(panels.amountRisks),
    ...rankingFacts(panels.projectRanking),
  ];
}

function profileInsightFacts(
  insights: StreamerProfileInsightGrounding[],
): DashboardChatFact[] {
  return insights.slice(0, 10).map((insight) => ({
    label: `主播画像：${insight.streamerName || insight.streamerId} · ${
      insight.title
    }`,
    detail: profileInsightDetail(insight),
    source: `streamer_profile_insights.${insight.id}`,
    tone: insight.risks?.length ? "amber" : "violet",
    target: {
      route: "streamers",
      id: insight.streamerId,
      sourceRef: insight.sourceRef,
    },
  }));
}

function profileInsightDetail(insight: StreamerProfileInsightGrounding) {
  const summary = insight.summary.trim();
  const parts: string[] = [];
  const strengths = cleanInsightList(insight.strengths);
  const risks = cleanInsightList(insight.risks);
  const recommendations = cleanInsightList(insight.recommendations);

  if (strengths.length) {
    parts.push(`优势：${strengths.join("、")}`);
  }
  if (risks.length) {
    parts.push(`风险：${risks.join("、")}`);
  }
  if (recommendations.length) {
    parts.push(`建议：${recommendations.join("、")}`);
  }
  if (insight.sourceRef) {
    parts.push(`原始来源：${insight.sourceRef}`);
  }

  return [summary, parts.join("；")].filter(Boolean).join(" ");
}

function cleanInsightList(values?: string[]) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function funnelFacts(
  key: "admissionFunnel" | "settlementFunnel",
  funnel: NonNullable<RoleHomeDashboardDto["panels"]>["admissionFunnel"],
): DashboardChatFact[] {
  if (!funnel?.stages?.length) {
    return [];
  }

  return funnel.stages.map((stage) => ({
    label: `${funnel.title}：${stage.label}`,
    value: formatValue(stage.value, funnel.unit),
    detail:
      stage.rate === undefined
        ? funnel.subtitle
        : `${funnel.subtitle ?? ""} 转化率 ${stage.rate}%`.trim(),
    source: `dashboard.panels.${key}.${stage.key}`,
    tone: stage.tone,
    target: funnel.target,
  }));
}

function batchLaneFacts(
  panel: NonNullable<RoleHomeDashboardDto["panels"]>["batchLanes"],
): DashboardChatFact[] {
  if (!panel?.lanes?.length) {
    return [];
  }

  return panel.lanes.map((lane) => ({
    label: `${panel.title}：${lane.label}`,
    value: `${lane.count} 项 / ${lane.amount} 元`,
    detail: panel.subtitle,
    source: `dashboard.panels.batchLanes.${lane.key}`,
    tone: lane.tone,
    target: panel.target,
  }));
}

function amountRiskFacts(
  panel: NonNullable<RoleHomeDashboardDto["panels"]>["amountRisks"],
): DashboardChatFact[] {
  if (!panel?.rows?.length) {
    return [];
  }

  return panel.rows.map((row) => ({
    label: `${panel.title}：${row.label}`,
    value: `${row.amount} 元`,
    detail: row.hint ?? panel.subtitle,
    source: `dashboard.panels.amountRisks.${row.key}`,
    tone: row.tone,
    target: row.target ?? panel.target,
  }));
}

function rankingFacts(
  panel: NonNullable<RoleHomeDashboardDto["panels"]>["projectRanking"],
): DashboardChatFact[] {
  if (!panel?.rows?.length) {
    return [];
  }

  return panel.rows.map((row) => ({
    label: `${panel.title}：${row.title}`,
    value: String(row.value),
    detail: row.hint ?? panel.subtitle,
    source: `dashboard.panels.projectRanking.${row.key}`,
    tone: row.tone,
    target: row.target,
  }));
}

function missingDataNotes(
  dashboard: RoleHomeDashboardDto,
  facts: DashboardChatFact[],
): string[] {
  const notes: string[] = [];

  if (dashboard.kpis.length === 0) {
    notes.push("当前看板没有可用 KPI 事实");
  }
  if (
    dashboard.queue.length === 0 &&
    dashboard.risks.length === 0 &&
    dashboard.drilldowns.length === 0
  ) {
    notes.push("当前看板没有待办或风险事实");
  }
  if (facts.length === 0) {
    notes.push("当前没有足够的结构化业务事实支持深入分析");
  }
  if (dashboard.emptyState) {
    notes.push(`${dashboard.emptyState.title}：${dashboard.emptyState.hint}`);
  }

  return notes;
}

function buildPromptText(
  grounding: Omit<DashboardChatGrounding, "promptText">,
): string {
  return [
    "真实业务事实包：",
    JSON.stringify(
      {
        profile: grounding.profile,
        generatedAt: grounding.generatedAt,
        facts: grounding.facts,
        projectHealth: grounding.projectHealth,
        suggestedActions: grounding.suggestedActions,
        missingData: grounding.missingData,
      },
      null,
      2,
    ),
    "",
    "回答规则：",
    "1. 只能基于 facts 中的真实业务事实回答。",
    "2. 不得编造 facts 中不存在的数字、项目、达人、主播、收入、成本或环比。",
    "3. 如果用户问到缺失指标，必须明确说明缺失数据，不能用行业常识补齐。",
    "4. 每个关键结论都要引用 source，格式如（来源：dashboard.kpis.receivable）。",
    "5. 高风险动作只能给建议和核对路径，必须由人工确认后执行。",
  ].join("\n");
}

function formatValue(value: number | string, unit?: string): string {
  return unit ? `${value} ${unit}` : String(value);
}
