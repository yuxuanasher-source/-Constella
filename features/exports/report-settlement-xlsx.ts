import ExcelJS from "exceljs";

import { getAllowedExportFields } from "./export-definitions";
import type { AppRole } from "@/lib/rbac/roles";

export type ReportSettlementXlsxRow = Record<string, unknown> & {
  reportId?: string | null;
};

export type ReportScreenshot = {
  buffer: Buffer;
  extension: "png" | "jpeg" | "gif";
};

const SCREENSHOT_FIELD_KEY = "screenshot";
const SCREENSHOT_CELL_WIDTH = 26; // 列宽（字符）
const SCREENSHOT_ROW_HEIGHT = 96; // 行高（pt）
const SCREENSHOT_IMG_WIDTH = 160; // 图片显示宽（px）
const SCREENSHOT_IMG_HEIGHT = 90; // 图片显示高（px）

// 把报数明细行渲染为 xlsx，并把每行的下播截图真实嵌入「下播截图」列。
// 列与脱敏沿用 report_settlement_details 的字段定义（按角色门控）。
export async function buildReportSettlementXlsx({
  role,
  rows,
  screenshotByReportId,
}: {
  role: AppRole;
  rows: ReportSettlementXlsxRow[];
  screenshotByReportId: Map<string, ReportScreenshot>;
}): Promise<Buffer> {
  const fields = getAllowedExportFields("report_settlement_details", role);
  const screenshotColIndex = fields.findIndex(
    (field) => field.key === SCREENSHOT_FIELD_KEY,
  );

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("报数明细");

  worksheet.columns = fields.map((field) => ({
    header: field.label,
    key: field.key,
    width: field.key === SCREENSHOT_FIELD_KEY ? SCREENSHOT_CELL_WIDTH : 18,
  }));
  worksheet.getRow(1).font = { bold: true };

  rows.forEach((row) => {
    const values = fields.map((field) =>
      field.key === SCREENSHOT_FIELD_KEY ? "" : (row[field.key] ?? ""),
    );
    const excelRow = worksheet.addRow(values);
    const rowIndex = excelRow.number; // 1-based

    const screenshot = row.reportId
      ? screenshotByReportId.get(row.reportId)
      : undefined;

    if (screenshot && screenshotColIndex >= 0) {
      const imageId = workbook.addImage({
        // exceljs 的 Buffer 类型与 @types/node 的泛型 Buffer 存在差异，强制对齐。
        buffer: screenshot.buffer as unknown as Buffer & ArrayBuffer,
        extension: screenshot.extension,
      });
      excelRow.height = SCREENSHOT_ROW_HEIGHT;
      worksheet.addImage(imageId, {
        tl: { col: screenshotColIndex + 0.1, row: rowIndex - 1 + 0.1 },
        ext: { width: SCREENSHOT_IMG_WIDTH, height: SCREENSHOT_IMG_HEIGHT },
        editAs: "oneCell",
      });
    } else if (screenshotColIndex >= 0) {
      excelRow.getCell(screenshotColIndex + 1).value = "无截图";
    }
  });

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

// 从存储路径推断图片扩展名（exceljs 仅支持 png/jpeg/gif）。
export function screenshotExtensionFromPath(
  path: string,
): ReportScreenshot["extension"] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpeg";
  if (lower.endsWith(".gif")) return "gif";
  return "png";
}
