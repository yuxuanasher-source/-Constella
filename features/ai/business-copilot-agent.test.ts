import { describe, expect, it } from "vitest";

import type { RoleHomeDashboardDto } from "@/features/dashboards/role-home";

import {
  classifyBusinessCopilotIntent,
  runBusinessCopilotAgent,
} from "./business-copilot-agent";

const ownerDashboard: RoleHomeDashboardDto = {
  profile: {
    role: "owner",
    title: "经营总览看板",
    subtitle: "关注收入、毛利、履约和高风险动作",
    scopeLabel: "全组织",
  },
  kpis: [
    { key: "activeProjects", label: "进行中项目", value: 3 },
    {
      key: "vendorReceivable",
      label: "本月厂家应收",
      value: 120000,
      unit: "元",
    },
    { key: "estimatedGross", label: "预估毛利", value: 36000, unit: "元" },
    { key: "grossMarginRate", label: "毛利率", value: 30, unit: "%" },
    { key: "highRiskItems", label: "高风险事项", value: 2 },
  ],
  queue: [
    {
      key: "project-alpha",
      title: "Alpha Launch",
      subtitle: "项目执行中",
      tone: "blue",
      target: { route: "project", id: "project-alpha" },
    },
  ],
  risks: [
    {
      key: "reopenedBatches",
      title: "结算批次重开",
      subtitle: "需要负责人关注",
      tone: "red",
      target: { route: "settle", id: "batch-1" },
    },
  ],
  drilldowns: [
    {
      key: "audit",
      title: "查看审计",
      subtitle: "高风险动作记录",
      tone: "neutral",
      target: { route: "audit" },
    },
  ],
  generatedAt: "2026-06-18T04:00:00.000Z",
};

const financeDashboard: RoleHomeDashboardDto = {
  profile: {
    role: "finance",
    title: "结算安全看板",
    subtitle: "关注可结算金额和证据风险",
    scopeLabel: "授权项目",
  },
  kpis: [
    {
      key: "settlementPoolAmount",
      label: "可结算池金额",
      value: 88000,
      unit: "元",
    },
    { key: "settlementPoolCount", label: "可结算报数", value: 14 },
    { key: "draftBatches", label: "待生成批次", value: 2 },
    {
      key: "weakEvidenceAmount",
      label: "弱证据金额",
      value: 12000,
      unit: "元",
    },
    { key: "reopenedBatches", label: "重开批次", value: 1 },
  ],
  queue: [],
  risks: [
    {
      key: "weakEvidence",
      title: "弱证据金额偏高",
      subtitle: "先复核黄红证据",
      tone: "amber",
      target: { route: "settle" },
    },
  ],
  drilldowns: [],
  generatedAt: "2026-06-18T04:00:00.000Z",
};

describe("business copilot agent", () => {
  it("classifies common Chinese business questions deterministically", () => {
    expect(classifyBusinessCopilotIntent("这个月经营健康吗")).toBe(
      "executive_health",
    );
    expect(classifyBusinessCopilotIntent("今天团队先处理什么")).toBe(
      "operations_priority",
    );
    expect(classifyBusinessCopilotIntent("哪些金额可以安全结算")).toBe(
      "settlement_risk",
    );
    expect(classifyBusinessCopilotIntent("哪些截图证据需要复核")).toBe(
      "evidence_quality",
    );
    expect(classifyBusinessCopilotIntent("帮我写一首歌")).toBe("unsupported");
  });

  it("answers owner executive health questions with sourced dashboard facts", () => {
    const result = runBusinessCopilotAgent({
      question: "这个月经营健康吗",
      dashboard: ownerDashboard,
    });

    expect(result).toMatchObject({
      intent: "executive_health",
      answer: "经营健康判断已基于当前角色看板生成。",
      generatedAt: "2026-06-18T04:00:00.000Z",
      sourceSummary: {
        sourceTool: "role_home_dashboard",
        scopeLabel: ownerDashboard.profile.scopeLabel,
        generatedAt: "2026-06-18T04:00:00.000Z",
        readableAreas: ["kpis", "queue", "risks", "drilldowns"],
      },
      confidence: {
        level: "high",
        label: "高置信度",
        reason: "回答引用了三项以上当前角色看板事实。",
      },
      requiresHumanConfirmation: true,
    });
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "本月厂家应收",
          value: 120000,
          sourceTool: "role_home_dashboard",
          sourceId: "kpi:vendorReceivable",
        }),
        expect.objectContaining({
          label: "毛利率",
          value: 30,
          sourceId: "kpi:grossMarginRate",
        }),
      ]),
    );
    expect(result.findings[0]?.evidence).toEqual(
      expect.arrayContaining([
        { sourceTool: "role_home_dashboard", sourceId: "kpi:grossMarginRate" },
      ]),
    );
    expect(result.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requiresHumanApproval: true }),
      ]),
    );
  });

  it("answers finance settlement risk without owner-only financial keys", () => {
    const result = runBusinessCopilotAgent({
      question: "弱证据金额有多少",
      dashboard: financeDashboard,
    });
    const serialized = JSON.stringify(result);

    expect(result.intent).toBe("settlement_risk");
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: "kpi:weakEvidenceAmount" }),
        expect.objectContaining({ sourceId: "kpi:settlementPoolAmount" }),
      ]),
    );
    expect(serialized).not.toContain("vendorReceivable");
    expect(serialized).not.toContain("estimatedGross");
    expect(serialized).not.toContain("supplierCost");
    expect(serialized).not.toContain("internalRisk");
  });

  it("does not run SQL-looking questions and returns unsupported safely", () => {
    const result = runBusinessCopilotAgent({
      question: "select * from settlement_batches",
      dashboard: ownerDashboard,
    });

    expect(result.intent).toBe("unsupported");
    expect(result.facts).toEqual([]);
    expect(result.sourceSummary).toEqual({
      sourceTool: "role_home_dashboard",
      scopeLabel: ownerDashboard.profile.scopeLabel,
      generatedAt: "2026-06-18T04:00:00.000Z",
      readableAreas: ["kpis", "queue", "risks", "drilldowns"],
    });
    expect(result.confidence).toEqual({
      level: "low",
      label: "低置信度",
      reason: "问题不在当前经营问答范围内，或没有可引用的角色看板事实。",
    });
    expect(result.requiresHumanConfirmation).toBe(true);
    expect(JSON.stringify(result)).not.toContain("sql");
  });
});
