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

  it("fails when OCR returns no useful live report facts", () => {
    expect(parseLiveReportOcrText(["hello", "world"])).toMatchObject({
      status: "failed",
      reasons: expect.arrayContaining(["no_live_report_fields"]),
    });
  });
});
