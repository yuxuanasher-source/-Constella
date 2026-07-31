import { PassThrough } from "node:stream";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

describe("production dependency runtime compatibility", () => {
  it("writes and commits a streaming ExcelJS workbook", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output });
    const worksheet = workbook.addWorksheet("结算明细");
    worksheet.addRow(["主播", "结算金额"]).commit();
    worksheet.addRow(["主播甲", 128.5]).commit();
    worksheet.commit();

    await workbook.commit();

    expect(Buffer.concat(chunks).subarray(0, 2).toString("hex")).toBe("504b");
  });
});
