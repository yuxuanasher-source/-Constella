import { describe, expect, it } from "vitest";

import {
  analyzeRecordingQuality,
  defaultRecordingQualityThresholds,
  deriveQualitySignalsFromAsset,
  type RecordingFrameSignal,
  type RecordingQualitySignals,
} from "./recording-quality-analysis";

function frames(
  count: number,
  interval: number,
  build: (index: number) => Partial<RecordingFrameSignal>,
): RecordingFrameSignal[] {
  return Array.from({ length: count }, (_, index) => ({
    atSeconds: index * interval,
    isGameScreen: true,
    isFaceVisible: true,
    isIdle: false,
    ...build(index),
  }));
}

function signalsFixture(
  overrides: Partial<RecordingQualitySignals> = {},
): RecordingQualitySignals {
  return {
    durationSeconds: 3600,
    sampleIntervalSeconds: 60,
    frames: frames(60, 60, () => ({})),
    source: "uploaded",
    ...overrides,
  };
}

describe("analyzeRecordingQuality", () => {
  it("judges a fully active game stream as effective and compliant", () => {
    const metrics = analyzeRecordingQuality({ signals: signalsFixture() });

    expect(metrics).toMatchObject({
      durationSeconds: 3600,
      effectiveSeconds: 3600,
      idleSeconds: 0,
      gameScreenRatioBps: 10000,
      faceVisibleRatioBps: 10000,
      effectiveRatioBps: 10000,
      effectivenessVerdict: "effective",
      complianceVerdict: "pass",
      signalSource: "uploaded",
    });
    expect(metrics.findings).toEqual([
      "有效时长、画面占比与露脸占比均达标。",
    ]);
  });

  it("quantifies idle time and downgrades the effectiveness verdict", () => {
    const metrics = analyzeRecordingQuality({
      signals: signalsFixture({
        // 60 帧里 12 帧挂机 => 挂机 20%，有效占比 80%。
        frames: frames(60, 60, (index) => ({ isIdle: index % 5 === 0 })),
      }),
    });

    expect(metrics.idleSeconds).toBe(720);
    expect(metrics.effectiveSeconds).toBe(2880);
    expect(metrics.effectivenessVerdict).toBe("below_standard");
    expect(
      metrics.findings.some((finding) => finding.includes("挂机占比")),
    ).toBe(true);
  });

  it("flags low game-screen and face ratios for review", () => {
    const metrics = analyzeRecordingQuality({
      signals: signalsFixture({
        frames: frames(60, 60, (index) => ({
          isGameScreen: index < 30,
          isFaceVisible: index < 12,
        })),
      }),
    });

    expect(metrics.gameScreenRatioBps).toBe(5000);
    expect(metrics.faceVisibleRatioBps).toBe(2000);
    expect(metrics.complianceVerdict).toBe("needs_review");
    expect(
      metrics.findings.some((finding) => finding.includes("游戏画面占比")),
    ).toBe(true);
    expect(
      metrics.findings.some((finding) => finding.includes("露脸占比")),
    ).toBe(true);
  });

  it("treats streams under the effective floor as invalid", () => {
    const metrics = analyzeRecordingQuality({
      signals: signalsFixture({
        durationSeconds: 900,
        frames: frames(15, 60, () => ({})),
      }),
    });

    expect(metrics.effectivenessVerdict).toBe("invalid");
    expect(metrics.complianceVerdict).toBe("needs_review");
  });

  it("marks the stream as violation when a compliance risk signal exists", () => {
    const metrics = analyzeRecordingQuality({
      signals: signalsFixture(),
      hasComplianceRiskSignal: true,
    });

    expect(metrics.complianceVerdict).toBe("violation");
  });

  it("requires human review when no frame samples are available", () => {
    const metrics = analyzeRecordingQuality({
      signals: signalsFixture({ frames: [] }),
    });

    expect(metrics.effectivenessVerdict).toBe("invalid");
    expect(
      metrics.findings.some((finding) => finding.includes("缺少帧级采样")),
    ).toBe(true);
  });
});

describe("deriveQualitySignalsFromAsset", () => {
  it("builds one derived frame per minute with visible opening and ending", () => {
    const signals = deriveQualitySignalsFromAsset({
      durationSeconds: 3600,
      reviewStatus: "approved",
    });

    expect(signals.source).toBe("derived");
    expect(signals.frames).toHaveLength(60);
    expect(signals.frames[0]).toMatchObject({
      isFaceVisible: true,
      isIdle: false,
    });
    expect(signals.frames[30]).toMatchObject({ isFaceVisible: false });
    expect(signals.frames[59]).toMatchObject({ isFaceVisible: true });
  });

  it("marks midway idle samples for rejected assets so metrics stay conservative", () => {
    const signals = deriveQualitySignalsFromAsset({
      durationSeconds: 3600,
      reviewStatus: "rejected",
    });

    expect(signals.frames.some((frame) => frame.isIdle)).toBe(true);

    const metrics = analyzeRecordingQuality({
      signals,
      thresholds: defaultRecordingQualityThresholds,
    });
    expect(metrics.effectivenessVerdict).not.toBe("effective");
    expect(metrics.findings[0]).toContain("兜底信号");
  });

  it("returns empty frames for assets without duration", () => {
    const signals = deriveQualitySignalsFromAsset({
      durationSeconds: null,
      reviewStatus: "submitted",
    });

    expect(signals.frames).toHaveLength(0);
    expect(signals.durationSeconds).toBe(0);
  });
});
