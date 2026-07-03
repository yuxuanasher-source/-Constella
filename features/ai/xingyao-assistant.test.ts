import { describe, expect, it } from "vitest";

import { validateAgentOutput } from "./agent-output-contract";
import {
  buildXingyaoChatGrounding,
  classifyXingyaoIntent,
  resolveXingyaoEntities,
  runXingyaoAssistant,
} from "./xingyao-assistant";
import { buildXingyaoFeatureStore } from "./xingyao-feature-store";
import {
  createInput,
  createProjectSlice,
  createStreamerSlice,
} from "./xingyao-test-fixtures";

describe("classifyXingyaoIntent", () => {
  it("routes colloquial questions onto the right diagnosis intent", () => {
    expect(classifyXingyaoIntent("上周《天使之战》ROI 为什么下滑？")).toBe(
      "roi_attribution",
    );
    expect(classifyXingyaoIntent("小美最近上播率怎么这么低")).toBe(
      "show_rate_attribution",
    );
    expect(classifyXingyaoIntent("预测一下本月哪些账号有封禁风险")).toBe(
      "risk_forecast",
    );
    expect(classifyXingyaoIntent("这个月回款有没有逾期风险")).toBe(
      "risk_forecast",
    );
    expect(classifyXingyaoIntent("整体经营情况怎么样")).toBe("org_overview");
    expect(classifyXingyaoIntent("这个项目为什么数据下滑了")).toBe(
      "roi_attribution",
    );
  });

  it("rejects raw SQL and unrelated questions", () => {
    expect(classifyXingyaoIntent("select * from projects")).toBe("unsupported");
    expect(classifyXingyaoIntent("今天天气如何")).toBe("unsupported");
    expect(classifyXingyaoIntent("")).toBe("unsupported");
  });
});

describe("resolveXingyaoEntities", () => {
  const store = buildXingyaoFeatureStore(createInput());

  it("matches quoted project names, streamer names and period hints", () => {
    const entities = resolveXingyaoEntities(
      "上周《天使之战》里小美的转化怎么样",
      store,
    );
    expect(entities.project?.id).toBe("p-1");
    expect(entities.streamer?.id).toBe("s-1");
    expect(entities.periodHint).toBe("上周");
  });

  it("falls back to name inclusion without book quotes", () => {
    const entities = resolveXingyaoEntities("天使之战的 ROI 如何", store);
    expect(entities.project?.id).toBe("p-1");
    expect(entities.streamer).toBeNull();
  });
});

describe("runXingyaoAssistant", () => {
  const store = buildXingyaoFeatureStore(createInput());

  it("answers a ROI question with a structured attribution report", () => {
    const result = runXingyaoAssistant({
      question: "上周《天使之战》ROI 为什么下滑？",
      store,
    });

    expect(result.intent).toBe("roi_attribution");
    expect(result.entity.projectId).toBe("p-1");
    expect(result.answer).toContain("开播率不足");
    expect(result.report.roiAttribution?.primaryCause).toBe(
      "broadcast_shortfall",
    );
    expect(result.validation).toEqual({ valid: true, errors: [] });
    // 提问口径与快照口径不同时必须挂出风险提示。
    expect(
      result.output.caveats.some((caveat) =>
        caveat.summary.includes("时间口径"),
      ),
    ).toBe(true);
  });

  it("auto-picks the worst ROI project and flags the assumption", () => {
    const result = runXingyaoAssistant({
      question: "为什么项目利润下滑了",
      store,
    });

    expect(result.intent).toBe("roi_attribution");
    expect(result.report.roiAttribution?.projectId).toBe("p-1");
    expect(
      result.output.caveats.some((caveat) =>
        caveat.summary.includes("自动选择"),
      ),
    ).toBe(true);
  });

  it("answers a show-rate question and names the primary cause", () => {
    const result = runXingyaoAssistant({
      question: "小美上播率为什么低",
      store,
    });

    expect(result.intent).toBe("show_rate_attribution");
    expect(result.entity.streamerId).toBe("s-1");
    expect(result.answer).toContain("历史缺勤规律");
    expect(result.validation.valid).toBe(true);
  });

  it("answers risk forecast questions with radar alerts", () => {
    const result = runXingyaoAssistant({
      question: "预测一下封禁和回款风险",
      store,
    });

    expect(result.intent).toBe("risk_forecast");
    expect(result.report.riskAlerts?.length).toBeGreaterThan(0);
    expect(result.answer).toContain("中高风险对象");
    expect(result.validation.valid).toBe(true);
  });

  it("builds an org overview combining radar and worst-project attribution", () => {
    const result = runXingyaoAssistant({
      question: "整体经营情况怎么样",
      store,
    });

    expect(result.intent).toBe("org_overview");
    expect(result.report.overview).toMatchObject({
      projectCount: 1,
      unhealthyProjectCount: 1,
    });
    expect(result.report.roiAttribution?.projectId).toBe("p-1");
    expect(result.validation.valid).toBe(true);
    expect(validateAgentOutput(result.output).valid).toBe(true);
  });

  it("degrades gracefully when the store has no usable data", () => {
    const emptyStore = buildXingyaoFeatureStore(
      createInput({
        projects: [],
        streamers: [],
        accounts: [],
        settlements: [],
        timeslots: [],
        knowledge: undefined,
        recordings: undefined,
      }),
    );
    const result = runXingyaoAssistant({
      question: "《天使之战》ROI 为什么下滑",
      store: emptyStore,
    });

    expect(result.report.roiAttribution).toBeUndefined();
    expect(result.answer).toContain("没有可诊断的项目数据");
    expect(result.validation.valid).toBe(true);
  });

  it("guides the user on unsupported questions without fabricating output", () => {
    const result = runXingyaoAssistant({ question: "帮我写首诗", store });
    expect(result.intent).toBe("unsupported");
    expect(result.output.facts).toHaveLength(0);
    expect(result.validation.valid).toBe(true);
  });
});

describe("buildXingyaoChatGrounding", () => {
  it("packs ROI attribution and risk alerts into sourced chat facts", () => {
    const store = buildXingyaoFeatureStore(createInput());
    const grounding = buildXingyaoChatGrounding({ store });

    expect(grounding.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "xingyao.roi_attribution.p-1",
          tone: "red",
        }),
        expect.objectContaining({
          source: expect.stringContaining("xingyao.risk_radar.account_ban"),
        }),
      ]),
    );
    expect(grounding.promptText).toContain("星耀组织级诊断事实包");
    expect(grounding.promptText).toContain("人工确认");
  });

  it("reports a healthy posture when nothing is wrong", () => {
    const store = buildXingyaoFeatureStore(
      createInput({
        projects: [createProjectSlice({ receivableCents: 700_000 })],
        streamers: [
          createStreamerSlice({
            startedSessions: 10,
            previousStartedSessions: 10,
            absenceCount30d: 0,
            consecutiveAbsences: 0,
            recentAbsenceDates: [],
            trainingCompletedRatioBps: 10_000,
            testPassed: true,
            disputeCount: 0,
            daysSinceLastLive: 1,
            incomeCents: 200_000,
          }),
        ],
        accounts: [],
        settlements: [],
      }),
    );
    const grounding = buildXingyaoChatGrounding({ store });

    expect(grounding.facts).toEqual([
      expect.objectContaining({ source: "xingyao.overview.healthy" }),
    ]);
    expect(grounding.missingData.join(" ")).toContain("账号库数据");
  });
});
