import { describe, expect, it } from "vitest";

import { parseLiveReportOcrText } from "./ocr-template-parser";

describe("parseLiveReportOcrText", () => {
  it("extracts live duration and viewer count from common Tencent OCR lines", () => {
    expect(
      parseLiveReportOcrText(["直播时长 1小时20分钟", "观看人数 320"]),
    ).toMatchObject({
      status: "trusted",
      extractedDuration: 80,
      extractedViewers: 320,
    });
  });

  it("supports minute-only duration and comma-separated viewers", () => {
    expect(
      parseLiveReportOcrText(["时长：95分钟", "场观 1,280 人"]),
    ).toMatchObject({
      status: "trusted",
      extractedDuration: 95,
      extractedViewers: 1280,
    });
  });

  it("parses viewer decimals and ten-thousand unit formats", () => {
    expect(
      parseLiveReportOcrText(["直播时长 60分钟", "场观 1.2万"]),
    ).toMatchObject({
      status: "trusted",
      extractedViewers: 12000,
    });
    expect(
      parseLiveReportOcrText(["直播时长 60分钟", "观看人数 12,345"]),
    ).toMatchObject({
      status: "trusted",
      extractedViewers: 12345,
    });
    expect(
      parseLiveReportOcrText(["直播时长 60分钟", "观众 1234.5"]),
    ).toMatchObject({
      status: "trusted",
      extractedViewers: 1235,
    });
  });

  it("requires human confirmation when extracted duration conflicts with expected duration", () => {
    expect(
      parseLiveReportOcrText(["时长 20分钟", "观看人数 300"], {
        expectedDuration: 120,
      }),
    ).toMatchObject({
      status: "needs_confirmation",
      extractedDuration: 20,
      reasons: expect.arrayContaining(["duration_conflict"]),
    });
  });

  it("reads a Douyin live-companion recap with stacked label/value and 共N小时", () => {
    expect(
      parseLiveReportOcrText([
        "直播已结束",
        "09:29~12:30 共3小时",
        "数据汇总",
        "观众人数",
        "2,488",
      ]),
    ).toMatchObject({
      status: "trusted",
      extractedDuration: 180,
      extractedViewers: 2488,
    });
  });

  it("derives duration from a start-end time range when hours are absent", () => {
    expect(
      parseLiveReportOcrText(["直播 09:00~10:30", "观看人数 100"]),
    ).toMatchObject({
      extractedDuration: 90,
      extractedViewers: 100,
    });
  });

  it("extracts date, start/end time, PCU and ACU from a single-stream recap", () => {
    expect(
      parseLiveReportOcrText([
        "直播日期 2026-07-16",
        "开播时间 09:29",
        "下播时间 12:30",
        "场观 2,488",
        "PCU 320",
        "ACU 86",
      ]),
    ).toMatchObject({
      status: "trusted",
      extractedDate: "2026-07-16",
      extractedStartedAt: "09:29",
      extractedEndedAt: "12:30",
      extractedDuration: 181,
      extractedViewers: 2488,
      metricCandidates: expect.arrayContaining([
        expect.objectContaining({ key: "pcu", value: 320 }),
        expect.objectContaining({ key: "acu", value: 86 }),
        expect.objectContaining({ key: "viewers", value: 2488 }),
      ]),
    });
  });

  it("pairs stacked operational metric labels with nearby values", () => {
    expect(
      parseLiveReportOcrText(["峰值在线", "平均在线", "1,280", "430"], {
        items: [
          { text: "峰值在线", x: 100, y: 100, width: 80, height: 20 },
          { text: "平均在线", x: 240, y: 100, width: 80, height: 20 },
          { text: "1,280", x: 100, y: 130, width: 60, height: 24 },
          { text: "430", x: 240, y: 130, width: 50, height: 24 },
        ],
      }),
    ).toMatchObject({
      metricCandidates: expect.arrayContaining([
        expect.objectContaining({ key: "pcu", value: 1280 }),
        expect.objectContaining({ key: "acu", value: 430 }),
      ]),
    });
  });

  it("pairs a grid viewer label with the value directly below it using coordinates", () => {
    expect(
      parseLiveReportOcrText(
        [
          "近7目观众评论率指标比同水平主播低",
          "观众人数",
          "送礼人数",
          "2 488",
          "79",
        ],
        {
          items: [
            {
              text: "近7目观众评论率指标比同水平主播低",
              x: 60,
              y: 120,
              width: 600,
              height: 24,
            },
            { text: "观众人数", x: 448, y: 265, width: 96, height: 22 },
            { text: "送礼人数", x: 620, y: 265, width: 96, height: 22 },
            { text: "2 488", x: 448, y: 291, width: 80, height: 26 },
            { text: "79", x: 620, y: 291, width: 40, height: 26 },
          ],
        },
      ),
    ).toMatchObject({
      extractedViewers: 2488,
    });
  });

  it("does not extract a viewer count from a sentence containing 观众 and a leading number", () => {
    expect(
      parseLiveReportOcrText(["近7目观众评论率指标比同水平主播低"]),
    ).toMatchObject({
      extractedViewers: null,
    });
  });

  it("does not pair a viewer label with an adjacent non-numeric label", () => {
    expect(
      parseLiveReportOcrText(["观众人数", "送礼人数", "评论人数"]),
    ).toMatchObject({
      extractedViewers: null,
    });
  });

  it("fails when OCR returns no useful live report facts", () => {
    expect(parseLiveReportOcrText(["hello", "world"])).toMatchObject({
      status: "failed",
      reasons: expect.arrayContaining(["no_live_report_fields"]),
    });
  });
});
