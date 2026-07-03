import { describe, expect, it } from "vitest";

import type { RecordingQualityMetrics } from "./recording-quality-analysis";
import {
  analyzeRecordingScript,
  type RecordingScriptInsights,
} from "./recording-script-analysis";
import type { RecordingRiskAlert } from "./recording-risk-detection";
import {
  defaultCapabilityWeights,
  scoreStreamerCapability,
  type StreamerHistoryStats,
} from "./streamer-capability-scoring";

function qualityFixture(
  overrides: Partial<RecordingQualityMetrics> = {},
): RecordingQualityMetrics {
  return {
    durationSeconds: 3600,
    effectiveSeconds: 3400,
    idleSeconds: 200,
    gameScreenRatioBps: 9000,
    faceVisibleRatioBps: 8000,
    effectiveRatioBps: 9400,
    effectivenessVerdict: "effective",
    complianceVerdict: "pass",
    findings: [],
    signalSource: "uploaded",
    ...overrides,
  };
}

function richScriptInsights(): RecordingScriptInsights {
  return analyzeRecordingScript({
    durationSeconds: 3600,
    transcript: [
      ...Array.from({ length: 12 }, (_, i) => ({
        atSeconds: i * 60,
        text: "点关注领新人福利",
      })),
      ...Array.from({ length: 22 }, (_, i) => ({
        atSeconds: 800 + i * 60,
        text: "这个技能循环和出装思路",
      })),
      ...Array.from({ length: 26 }, (_, i) => ({
        atSeconds: 2200 + i * 30,
        text: "欢迎宝子们扣个 1",
      })),
    ],
  });
}

function historyFixture(
  overrides: Partial<StreamerHistoryStats> = {},
): StreamerHistoryStats {
  return {
    uploadCount: 8,
    goLiveRateBps: 9000,
    liveTestPassRateBps: 8500,
    ...overrides,
  };
}

const highRiskAlert: RecordingRiskAlert = {
  category: "sensitive_word",
  severity: "high",
  term: "赌博",
  atSeconds: 60,
  message: "话术命中敏感词",
  evidence: {},
};

describe("scoreStreamerCapability", () => {
  it("scores a strong performer across all four dimensions", () => {
    const report = scoreStreamerCapability({
      quality: qualityFixture(),
      script: richScriptInsights(),
      history: historyFixture(),
    });

    expect(report.dimensions.map((dimension) => dimension.key)).toEqual([
      "game_proficiency",
      "script_fluency",
      "interaction_activity",
      "conversion_guidance",
    ]);
    for (const dimension of report.dimensions) {
      expect(dimension.score).toBeGreaterThanOrEqual(75);
    }
    expect(report.overallScore).toBeGreaterThanOrEqual(80);
    expect(["S", "A"]).toContain(report.grade);
    expect(report.growthAdvice).toEqual([
      "各维度均衡且历史履约健康，可作为高 ROI 话术模板的采集对象。",
    ]);
  });

  it("falls back to conservative scores without a transcript", () => {
    const report = scoreStreamerCapability({
      quality: qualityFixture(),
      script: analyzeRecordingScript({
        durationSeconds: 3600,
        transcript: [],
      }),
      history: historyFixture(),
    });

    const scriptFluency = report.dimensions.find(
      (dimension) => dimension.key === "script_fluency",
    );
    expect(scriptFluency?.score).toBe(40);
    expect(scriptFluency?.finding).toContain("缺少语音转写");
  });

  it("penalizes high-risk alerts and surfaces compliance advice", () => {
    const clean = scoreStreamerCapability({
      quality: qualityFixture(),
      script: richScriptInsights(),
      history: historyFixture(),
    });
    const risky = scoreStreamerCapability({
      quality: qualityFixture(),
      script: richScriptInsights(),
      riskAlerts: [highRiskAlert, { ...highRiskAlert, atSeconds: 200 }],
      history: historyFixture(),
    });

    expect(risky.overallScore).toBe(clean.overallScore - 20);
    expect(
      risky.growthAdvice.some((advice) => advice.includes("高危告警")),
    ).toBe(true);
  });

  it("folds weak history stats into growth advice", () => {
    const report = scoreStreamerCapability({
      quality: qualityFixture(),
      script: richScriptInsights(),
      history: historyFixture({
        uploadCount: 0,
        goLiveRateBps: 4000,
        liveTestPassRateBps: 3000,
      }),
    });

    expect(
      report.growthAdvice.some((advice) => advice.includes("上播率")),
    ).toBe(true);
    expect(
      report.growthAdvice.some((advice) => advice.includes("上播测试通过率")),
    ).toBe(true);
    expect(
      report.growthAdvice.some((advice) => advice.includes("录屏上传记录")),
    ).toBe(true);
  });

  it("shifts the overall score when calibrated weights emphasize a dimension", () => {
    const script = analyzeRecordingScript({
      durationSeconds: 3600,
      // 只有讲解和互动，没有任何转化引导话术。
      transcript: [
        ...Array.from({ length: 20 }, (_, i) => ({
          atSeconds: i * 60,
          text: "技能出装讲解",
        })),
        ...Array.from({ length: 20 }, (_, i) => ({
          atSeconds: 1300 + i * 60,
          text: "欢迎宝子们",
        })),
      ],
    });

    const balanced = scoreStreamerCapability({
      quality: qualityFixture(),
      script,
      history: historyFixture(),
      weights: defaultCapabilityWeights,
    });
    const conversionHeavy = scoreStreamerCapability({
      quality: qualityFixture(),
      script,
      history: historyFixture(),
      weights: {
        game_proficiency: 1500,
        script_fluency: 1500,
        interaction_activity: 1500,
        conversion_guidance: 5500,
      },
    });

    expect(conversionHeavy.overallScore).toBeLessThan(balanced.overallScore);
    expect(
      balanced.growthAdvice.some((advice) =>
        advice.includes("转化引导能力"),
      ),
    ).toBe(true);
  });
});
