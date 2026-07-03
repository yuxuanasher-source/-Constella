// 星耀 AI 助手 · 自然语言诊断编排（L1 感知 / L2 草稿）。
// 支持运营用口语化提问（如「上周《天使之战》ROI 为什么下滑？」），
// 确定性地完成：意图识别 → 实体定位 → 调用归因引擎 / 风险雷达 →
// 产出结构化归因分析报告（AgentOutput 契约，数字仅出现在 facts）。
// 同时提供 buildXingyaoChatGrounding，把组织级诊断事实注入星耀聊天，
// 让对话模型只基于真实业务事实作答。

import type { AgentOutput } from "./contracts";
import { validateAgentOutput } from "./agent-output-contract";
import type { DashboardChatFact } from "./dashboard-chat-grounding";
import {
  attributeProjectRoiGap,
  attributeStreamerShowRate,
  buildRoiAttributionAgentOutput,
  buildShowRateAttributionAgentOutput,
  type XingyaoRoiAttribution,
  type XingyaoShowRateAttribution,
} from "./xingyao-attribution-engine";
import {
  DEFAULT_XINGYAO_RISK_WEIGHTS,
  runXingyaoRiskRadar,
  XINGYAO_RISK_LEVEL_LABELS,
  XINGYAO_RISK_MODEL_LABELS,
  type XingyaoRiskPrediction,
  type XingyaoRiskWeights,
} from "./xingyao-risk-radar";
import type {
  XingyaoFeatureStore,
  XingyaoProjectFeature,
  XingyaoStreamerFeature,
} from "./xingyao-feature-store";

export type XingyaoIntent =
  | "roi_attribution"
  | "show_rate_attribution"
  | "risk_forecast"
  | "org_overview"
  | "unsupported";

const RAW_SQL_PATTERN =
  /\b(select|insert|update|delete|drop|alter|truncate)\b/i;

// 与 business-copilot 相同的关键词分类思路；顺序即优先级：
// 风险预测类词优先于 ROI（「达标率预测」应走风险雷达而非归因）。
export function classifyXingyaoIntent(question: string): XingyaoIntent {
  const text = question.trim().toLowerCase();
  if (!text || RAW_SQL_PATTERN.test(text)) return "unsupported";

  if (
    /预测|预警|风险|封禁|封号|逾期|回款|留存|流失|达标率|forecast|risk/.test(
      text,
    )
  ) {
    return "risk_forecast";
  }
  if (/roi|投产比|不达标|毛利|利润|投放|转化.*(差|弱|下滑)/.test(text)) {
    return "roi_attribution";
  }
  if (/上播|开播率|缺勤|没开播|不开播|排班/.test(text)) {
    return "show_rate_attribution";
  }
  if (/大盘|整体|总览|概览|经营(情况|状况)|健康度|卡点/.test(text)) {
    return "org_overview";
  }
  if (/为什么|原因|归因|下滑|下降/.test(text)) {
    return "roi_attribution";
  }
  return "unsupported";
}

export type XingyaoEntityMatch = {
  project: XingyaoProjectFeature | null;
  streamer: XingyaoStreamerFeature | null;
  periodHint: string | null;
};

// 实体定位：优先书名号《…》精确匹配项目名，再做名称包含匹配；
// 主播按名称包含匹配。时间口径只做提示（快照固定为当期）。
export function resolveXingyaoEntities(
  question: string,
  store: XingyaoFeatureStore,
): XingyaoEntityMatch {
  const quoted = question.match(/《([^》]+)》/)?.[1]?.trim() ?? null;
  let project: XingyaoProjectFeature | null = null;
  if (quoted) {
    project =
      store.projects.find((item) => item.name === quoted) ??
      store.projects.find((item) => item.name.includes(quoted)) ??
      null;
  }
  if (!project) {
    project =
      store.projects.find(
        (item) => item.name.length >= 2 && question.includes(item.name),
      ) ?? null;
  }

  const streamer =
    store.streamers.find(
      (item) => item.name.length >= 2 && question.includes(item.name),
    ) ?? null;

  const periodHint =
    question.match(/上周|本周|上月|本月|昨天|今天|近\S*天/)?.[0] ?? null;

  return { project, streamer, periodHint };
}

export type XingyaoAssistantReport = {
  roiAttribution?: XingyaoRoiAttribution;
  showRateAttribution?: XingyaoShowRateAttribution;
  riskAlerts?: XingyaoRiskPrediction[];
  overview?: {
    projectCount: number;
    unhealthyProjectCount: number;
    alertCount: number;
    missingData: string[];
  };
};

export type XingyaoAssistantResult = {
  intent: XingyaoIntent;
  answer: string;
  entity: {
    projectId: string | null;
    projectName: string | null;
    streamerId: string | null;
    streamerName: string | null;
    periodHint: string | null;
  };
  report: XingyaoAssistantReport;
  output: AgentOutput;
  validation: ReturnType<typeof validateAgentOutput>;
};

function insufficientDataOutput(store: XingyaoFeatureStore): AgentOutput {
  return {
    facts: [],
    findings: [],
    caveats: [
      {
        summary: `当前缺少可用业务快照（${
          store.missingData.join("；") || "数据接入待完成"
        }），无法给出可靠归因`,
        unverifiedExternalFactor: true,
      },
    ],
    recommendations: [
      {
        proposal: "先完成对应模块的数据接入或等待当期数据产生，再运行诊断",
        expectedImpact: "让归因和预测建立在真实留痕数据上",
        requiresHumanApproval: true,
      },
    ],
  };
}

function withPeriodCaveat(
  output: AgentOutput,
  periodHint: string | null,
): AgentOutput {
  if (!periodHint || periodHint === "本月") return output;
  // 口径提示必须保持定性描述（caveat 文本禁止出现数字），
  // 因此不回显具体周期标签，只说明按当期快照口径作答。
  return {
    ...output,
    caveats: [
      ...output.caveats,
      {
        summary:
          "提问的时间口径与快照口径不同：诊断快照固定为当期自然月，结论按当期口径给出",
        unverifiedExternalFactor: true,
      },
    ],
  };
}

function worstRoiProject(
  store: XingyaoFeatureStore,
): XingyaoProjectFeature | null {
  if (store.projects.length === 0) return null;
  return [...store.projects].sort((a, b) => b.roiGapBps - a.roiGapBps)[0];
}

function worstShowRateStreamer(
  store: XingyaoFeatureStore,
): XingyaoStreamerFeature | null {
  const candidates = store.streamers.filter(
    (streamer) => streamer.scheduledSessions > 0,
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.showRateBps - b.showRateBps)[0];
}

export function runXingyaoAssistant({
  question,
  store,
  weights = DEFAULT_XINGYAO_RISK_WEIGHTS,
}: {
  question: string;
  store: XingyaoFeatureStore;
  weights?: XingyaoRiskWeights;
}): XingyaoAssistantResult {
  const intent = classifyXingyaoIntent(question);
  const entities = resolveXingyaoEntities(question, store);
  const entity = {
    projectId: entities.project?.id ?? null,
    projectName: entities.project?.name ?? null,
    streamerId: entities.streamer?.id ?? null,
    streamerName: entities.streamer?.name ?? null,
    periodHint: entities.periodHint,
  };

  const finish = (
    answer: string,
    report: XingyaoAssistantReport,
    output: AgentOutput,
  ): XingyaoAssistantResult => {
    const withCaveat = withPeriodCaveat(output, entities.periodHint);
    return {
      intent,
      answer,
      entity,
      report,
      output: withCaveat,
      validation: validateAgentOutput(withCaveat),
    };
  };

  if (intent === "unsupported") {
    return finish(
      "这个问题超出星耀诊断范围。可以试试：「《项目名》ROI 为什么不达标」「主播 XX 上播率为什么低」「预测本月项目达标风险」。",
      {},
      {
        facts: [],
        findings: [],
        caveats: [
          {
            summary: "提问未命中诊断意图或包含不受支持的查询形式",
            unverifiedExternalFactor: true,
          },
        ],
        recommendations: [
          {
            proposal: "换用业务化表述提问，或从经营驾驶舱进入对应模块查看",
            expectedImpact: "获得可溯源的结构化诊断",
            requiresHumanApproval: true,
          },
        ],
      },
    );
  }

  if (intent === "roi_attribution") {
    const project = entities.project ?? worstRoiProject(store);
    if (!project) {
      return finish(
        "当前没有可诊断的项目数据。",
        {},
        insufficientDataOutput(store),
      );
    }
    const attribution = attributeProjectRoiGap({
      store,
      projectId: project.id,
    });
    if (!attribution) {
      return finish(
        "未找到目标项目，请确认项目名称。",
        {},
        insufficientDataOutput(store),
      );
    }
    const { output } = buildRoiAttributionAgentOutput(attribution);
    const outputWithScope = entities.project
      ? output
      : {
          ...output,
          caveats: [
            ...output.caveats,
            {
              summary: "提问未指明项目，已自动选择 ROI 缺口最大的项目进行归因",
              unverifiedExternalFactor: true,
            },
          ],
        };
    const answer = attribution.healthy
      ? `《${attribution.projectName}》当期 ROI 达标，无核心卡点。`
      : `《${attribution.projectName}》ROI 未达标，最主要卡点是「${
          attribution.causes[0]?.label ?? "待人工核查"
        }」，已定位到具体主播 / 账号 / 时段，详见归因报告。`;
    return finish(answer, { roiAttribution: attribution }, outputWithScope);
  }

  if (intent === "show_rate_attribution") {
    const streamer = entities.streamer ?? worstShowRateStreamer(store);
    if (!streamer) {
      return finish(
        "当前没有可诊断的主播执行数据。",
        {},
        insufficientDataOutput(store),
      );
    }
    const attribution = attributeStreamerShowRate({
      store,
      streamerId: streamer.id,
    });
    if (!attribution) {
      return finish(
        "未找到目标主播，请确认主播名称。",
        {},
        insufficientDataOutput(store),
      );
    }
    const { output } = buildShowRateAttributionAgentOutput(attribution);
    const outputWithScope = entities.streamer
      ? output
      : {
          ...output,
          caveats: [
            ...output.caveats,
            {
              summary: "提问未指明主播，已自动选择上播率最低的主播进行归因",
              unverifiedExternalFactor: true,
            },
          ],
        };
    const answer = attribution.healthy
      ? `主播 ${attribution.streamerName} 上播率健康。`
      : `主播 ${attribution.streamerName} 上播率偏低，核心原因是「${
          attribution.causes[0]?.label ?? "待人工核查"
        }」，详见归因报告。`;
    return finish(
      answer,
      { showRateAttribution: attribution },
      outputWithScope,
    );
  }

  if (intent === "risk_forecast") {
    const radar = runXingyaoRiskRadar({ store, weights });
    const answer =
      radar.alerts.length > 0
        ? `风险雷达发现 ${radar.alerts.length} 个中高风险对象，最高风险：${
            XINGYAO_RISK_MODEL_LABELS[radar.alerts[0].model]
          } · ${radar.alerts[0].objectName}。`
        : "风险雷达扫描完成，暂无中高风险对象。";
    return finish(answer, { riskAlerts: radar.alerts }, radar.output);
  }

  // org_overview：卡点总览 = 风险雷达 + 最大 ROI 缺口项目的归因。
  const radar = runXingyaoRiskRadar({ store, weights });
  const project = worstRoiProject(store);
  const attribution = project
    ? attributeProjectRoiGap({ store, projectId: project.id })
    : null;
  const unhealthyProjectCount = store.projects.filter(
    (item) => item.roiGapBps > 0,
  ).length;

  const overviewFacts: AgentOutput["facts"] = [
    {
      statement: `当期纳入诊断的项目数为 ${store.projects.length}`,
      sourceTool: "xingyao_feature_store",
      sourceId: "org:projectCount",
    },
    {
      statement: `ROI 未达标的项目数为 ${unhealthyProjectCount}`,
      sourceTool: "xingyao_feature_store",
      sourceId: "org:unhealthyProjectCount",
    },
    {
      statement: `风险雷达中高风险对象数为 ${radar.alerts.length}`,
      sourceTool: "xingyao_risk_radar",
      sourceId: "org:alertCount",
    },
  ];

  const attributionResult = attribution
    ? buildRoiAttributionAgentOutput(attribution)
    : null;

  const output: AgentOutput = {
    facts: [...overviewFacts, ...(attributionResult?.output.facts ?? [])],
    findings: [
      {
        summary:
          unhealthyProjectCount > 0 || radar.alerts.length > 0
            ? "组织当期存在待处理卡点，建议按风险分与 ROI 缺口从高到低推进"
            : "组织当期经营健康，未发现显著卡点",
        evidence: [
          { sourceTool: "xingyao_feature_store", sourceId: "org:projectCount" },
          {
            sourceTool: "xingyao_feature_store",
            sourceId: "org:unhealthyProjectCount",
          },
          { sourceTool: "xingyao_risk_radar", sourceId: "org:alertCount" },
        ],
      },
      ...(attributionResult?.output.findings ?? []),
    ],
    caveats: [
      {
        summary: "总览只覆盖已接入模块的数据，未接入模块的风险不可见",
        unverifiedExternalFactor: true,
      },
    ],
    recommendations: [
      ...(attributionResult?.output.recommendations ?? []),
      ...radar.output.recommendations,
    ].slice(0, 4),
  };

  const answer = `经营总览：${store.projects.length} 个项目中 ${unhealthyProjectCount} 个 ROI 未达标，风险雷达发现 ${radar.alerts.length} 个中高风险对象。`;
  return finish(
    answer,
    {
      overview: {
        projectCount: store.projects.length,
        unhealthyProjectCount,
        alertCount: radar.alerts.length,
        missingData: store.missingData,
      },
      roiAttribution: attribution ?? undefined,
      riskAlerts: radar.alerts,
    },
    output,
  );
}

// —— 星耀聊天 grounding ————————————————————————————————

export type XingyaoChatGrounding = {
  facts: DashboardChatFact[];
  missingData: string[];
  promptText: string;
};

const RISK_TONES: Record<string, string> = {
  high: "red",
  medium: "amber",
  low: "emerald",
};

// 把组织级诊断结论压缩成聊天事实包：ROI 卡点 TOP、风险预警 TOP、
// 数据覆盖情况。与 dashboard-chat-grounding 同构，可直接注入聊天上下文。
export function buildXingyaoChatGrounding({
  store,
  weights = DEFAULT_XINGYAO_RISK_WEIGHTS,
  maxProjects = 3,
  maxAlerts = 5,
}: {
  store: XingyaoFeatureStore;
  weights?: XingyaoRiskWeights;
  maxProjects?: number;
  maxAlerts?: number;
}): XingyaoChatGrounding {
  const facts: DashboardChatFact[] = [];

  const unhealthyProjects = store.projects
    .filter((project) => project.roiGapBps > 0)
    .sort((a, b) => b.roiGapBps - a.roiGapBps)
    .slice(0, maxProjects);
  for (const project of unhealthyProjects) {
    const attribution = attributeProjectRoiGap({
      store,
      projectId: project.id,
    });
    const primaryLabel = attribution?.causes[0]?.label ?? "待人工核查";
    facts.push({
      label: `星耀归因：《${project.name}》ROI 缺口`,
      value: `${project.roiGapBps} bps`,
      detail: `当期 ROI ${project.roiBps} bps / 目标 ${project.targetRoiBpsResolved} bps，最主要卡点「${primaryLabel}」`,
      source: `xingyao.roi_attribution.${project.id}`,
      tone: "red",
    });
  }

  const radar = runXingyaoRiskRadar({ store, weights });
  for (const alert of radar.alerts.slice(0, maxAlerts)) {
    facts.push({
      label: `星耀预警：${XINGYAO_RISK_MODEL_LABELS[alert.model]}`,
      value: `${alert.riskScoreBps} bps（${XINGYAO_RISK_LEVEL_LABELS[alert.level]}）`,
      detail: `${alert.objectName}；建议：${alert.suggestion}`,
      source: `xingyao.risk_radar.${alert.model}.${alert.objectId}`,
      tone: RISK_TONES[alert.level],
    });
  }

  if (facts.length === 0 && store.projects.length > 0) {
    facts.push({
      label: "星耀诊断：当期未发现 ROI 卡点或中高风险对象",
      detail: "各项目 ROI 达标且风险雷达处于安全水位",
      source: "xingyao.overview.healthy",
      tone: "emerald",
    });
  }

  const grounding = {
    facts,
    missingData: store.missingData,
  };

  const promptText = [
    "星耀组织级诊断事实包：",
    JSON.stringify(
      {
        periodLabel: store.periodLabel,
        generatedAt: store.generatedAt,
        facts: grounding.facts,
        missingData: grounding.missingData,
      },
      null,
      2,
    ),
    "",
    "使用规则：",
    "1. 归因与预警结论只能引用上述 facts，并标注 source。",
    "2. 用户追问细节时，引导其查看对应项目 / 主播 / 账号页面核实。",
    "3. 预警属于概率预测，表述时不得写成已发生的事实。",
    "4. 所有处置动作只能给建议，必须由人工确认后执行。",
  ].join("\n");

  return { ...grounding, promptText };
}
