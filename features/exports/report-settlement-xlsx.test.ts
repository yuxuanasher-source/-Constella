import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildReportSettlementXlsx,
  screenshotExtensionFromPath,
  type ReportScreenshot,
} from "./report-settlement-xlsx";

// 1x1 PNG，用于断言图片被真实嵌入工作簿。
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe("buildReportSettlementXlsx", () => {
  it("embeds the real screenshot image into the 下播截图 column", async () => {
    const screenshotByReportId = new Map<string, ReportScreenshot>([
      ["report-1", { buffer: PNG_1X1, extension: "png" }],
    ]);

    const buffer = await buildReportSettlementXlsx({
      role: "owner",
      rows: [
        {
          reportId: "report-1",
          guildOrIndividual: "星辰公会",
          gameProduct: "Game A",
          streamerName: "Streamer A",
          liveDate: "2026-06-02",
          liveTime: "20:00-22:00",
          duration: "2 小时",
          hourlyRate: "¥100",
          talentFee: "¥200.00",
          screenshot: "1 张",
        },
      ],
      screenshotByReportId,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Buffer & ArrayBuffer);
    const worksheet = workbook.getWorksheet("报数明细");
    expect(worksheet).toBeTruthy();
    // 真实嵌入了一张图片。
    expect(workbook.model.media?.length ?? 0).toBe(1);
    expect(worksheet?.getImages().length ?? 0).toBe(1);
  });

  it("writes 无截图 when a row has no screenshot", async () => {
    const buffer = await buildReportSettlementXlsx({
      role: "owner",
      rows: [
        {
          reportId: "report-missing",
          guildOrIndividual: "星辰公会",
          gameProduct: "Game B",
          streamerName: "Streamer B",
          liveDate: "2026-06-03",
          liveTime: "—",
          duration: "1 小时",
          hourlyRate: "—",
          talentFee: "—",
          screenshot: "0 张",
        },
      ],
      screenshotByReportId: new Map(),
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Buffer & ArrayBuffer);
    const worksheet = workbook.getWorksheet("报数明细");
    const headerCells = worksheet
      ?.getRow(1)
      .values?.toString();
    expect(headerCells).toContain("下播截图");
    expect(worksheet?.getImages().length ?? 0).toBe(0);
    // 数据行最后一列写入「无截图」。
    const dataRow = worksheet?.getRow(2);
    const rowText = dataRow?.values?.toString() ?? "";
    expect(rowText).toContain("无截图");
  });

  it("drops finance-sensitive columns for non-finance roles", async () => {
    const buffer = await buildReportSettlementXlsx({
      role: "operator_business",
      rows: [
        {
          reportId: "report-2",
          guildOrIndividual: "星辰公会",
          gameProduct: "Game C",
          streamerName: "Streamer C",
          liveDate: "2026-06-04",
          liveTime: "—",
          duration: "3 小时",
          screenshot: "2 张",
        },
      ],
      screenshotByReportId: new Map(),
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Buffer & ArrayBuffer);
    const worksheet = workbook.getWorksheet("报数明细");
    const headerText = worksheet?.getRow(1).values?.toString() ?? "";
    expect(headerText).not.toContain("小时单价");
    expect(headerText).not.toContain("达人费用");
  });
});

describe("screenshotExtensionFromPath", () => {
  it("maps known image suffixes to exceljs extensions", () => {
    expect(screenshotExtensionFromPath("a/b/c.png")).toBe("png");
    expect(screenshotExtensionFromPath("a/b/c.PNG")).toBe("png");
    expect(screenshotExtensionFromPath("a/b/c.jpg")).toBe("jpeg");
    expect(screenshotExtensionFromPath("a/b/c.jpeg")).toBe("jpeg");
    expect(screenshotExtensionFromPath("a/b/c.gif")).toBe("gif");
    expect(screenshotExtensionFromPath("a/b/c.webp")).toBe("png");
  });
});
