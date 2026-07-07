import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { KnowledgeAssetDocument } from "@/features/ai/knowledge-asset-index";

import {
  formatTranscriptTimestamp,
  type AnnotatedTranscript,
  type TranscriptSegment,
  type TranscriptSummary,
} from "./recording-transcript";

/**
 * 逐字稿导出的三种产物构建器：企业知识库 markdown / Word(docx) / PDF。
 * 标注口径全部来自 buildAnnotatedTranscript（复用录屏风险词典），
 * violation → 红、warning → 深黄。导出内容只含逐字稿与风险摘要，
 * 不携带成本 / 毛利等敏感经营字段。
 */

export type TranscriptExportInput = {
  assetTitle: string;
  asrProvider: string | null;
  exportedAtLabel: string;
  transcript: AnnotatedTranscript;
  includeTimestamps: boolean;
};

// ---------------------------------------------------------------------------
// 共享摘要文案
// ---------------------------------------------------------------------------

export function transcriptSummaryLabel(summary: TranscriptSummary): string {
  const keywordLabel = summary.keywords.length
    ? summary.keywords
        .map(
          (item) =>
            `${item.tone === "violation" ? "违规" : "风险"}「${item.keyword}」×${item.count}`,
        )
        .join("、")
    : "无";
  return `违规命中 ${summary.violationCount} 处 · 风险命中 ${summary.warningCount} 处 · 命中词：${keywordLabel}`;
}

function utteranceLinePrefix(
  startSeconds: number,
  includeTimestamps: boolean,
): string {
  return includeTimestamps
    ? `[${formatTranscriptTimestamp(startSeconds)}] `
    : "";
}

// ---------------------------------------------------------------------------
// 知识库 markdown
// ---------------------------------------------------------------------------

export function buildTranscriptKnowledgeDocument({
  organizationId,
  analysisId,
  assetTitle,
  asrProvider,
  exportedAtLabel,
  transcript,
  includeTimestamps,
  createdBy,
}: TranscriptExportInput & {
  organizationId: string;
  analysisId: string;
  createdBy: string;
}): KnowledgeAssetDocument {
  const title = `逐字稿：${assetTitle}·${exportedAtLabel}`;
  const sourceRef = `recording_transcript:${analysisId}`;

  const lines = [
    `# ${title}`,
    "",
    `Source: ${sourceRef}`,
    `ASR provider: ${asrProvider ?? "unknown"}`,
    "",
    "## 风险摘要",
    "",
    `- ${transcriptSummaryLabel(transcript.summary)}`,
    "",
    "## 正文",
    "",
  ];

  for (const utterance of transcript.utterances) {
    const prefix = utteranceLinePrefix(
      utterance.startSeconds,
      includeTimestamps,
    );
    lines.push(`- ${prefix}${segmentsToMarkedText(utterance.segments)}`);
  }

  return {
    organizationId,
    docType: "manual",
    title,
    body: lines.join("\n").trim() + "\n",
    sourceRef,
    tags: ["recording_transcript", "逐字稿", assetTitle.slice(0, 40)],
    createdBy,
    metadata: { source: "recording_transcript" },
  };
}

function segmentsToMarkedText(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.tone === "violation") return `【违规:${segment.text}】`;
      if (segment.tone === "warning") return `【风险:${segment.text}】`;
      return segment.text;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Word（docx）
// ---------------------------------------------------------------------------

// Word 主题色：违规红 / 深黄（十六进制不带 #）。
const DOCX_VIOLATION_COLOR = "C00000";
const DOCX_WARNING_COLOR = "BF8F00";
const DOCX_TIMESTAMP_COLOR = "808080";

export async function buildTranscriptDocx(
  input: TranscriptExportInput,
): Promise<Buffer> {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: `逐字稿：${input.assetTitle}` })],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `资产：${input.assetTitle} · ASR 引擎：${input.asrProvider ?? "unknown"} · 导出日期：${input.exportedAtLabel}`,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: transcriptSummaryLabel(input.transcript.summary),
          bold: true,
        }),
      ],
    }),
    new Paragraph({ children: [] }),
  ];

  for (const utterance of input.transcript.utterances) {
    const children: TextRun[] = [];
    const prefix = utteranceLinePrefix(
      utterance.startSeconds,
      input.includeTimestamps,
    );
    if (prefix) {
      children.push(new TextRun({ text: prefix, color: DOCX_TIMESTAMP_COLOR }));
    }
    for (const segment of utterance.segments) {
      if (segment.tone === "violation") {
        children.push(
          new TextRun({
            text: segment.text,
            bold: true,
            color: DOCX_VIOLATION_COLOR,
          }),
        );
      } else if (segment.tone === "warning") {
        children.push(
          new TextRun({
            text: segment.text,
            bold: true,
            color: DOCX_WARNING_COLOR,
          }),
        );
      } else {
        children.push(new TextRun({ text: segment.text }));
      }
    }
    paragraphs.push(new Paragraph({ children, spacing: { after: 120 } }));
  }

  const document = new Document({
    sections: [{ children: paragraphs }],
  });
  return Packer.toBuffer(document);
}

// ---------------------------------------------------------------------------
// PDF（pdf-lib + Noto Sans CJK SC，保证中文可渲染）
// ---------------------------------------------------------------------------

export class TranscriptPdfFontUnavailableError extends Error {
  constructor(message = "Transcript PDF font is unavailable") {
    super(message);
    this.name = "TranscriptPdfFontUnavailableError";
  }
}

const TRANSCRIPT_PDF_FONT_PATH = path.join(
  process.cwd(),
  "assets",
  "fonts",
  "NotoSansCJKsc-Regular.otf",
);

// 字体模块级缓存：16MB 的 OTF 只读一次；读失败时清空缓存以便下次重试。
let fontBytesPromise: Promise<Uint8Array> | null = null;

function loadTranscriptPdfFontBytes(): Promise<Uint8Array> {
  if (!fontBytesPromise) {
    fontBytesPromise = readFile(TRANSCRIPT_PDF_FONT_PATH)
      .then((buffer) => new Uint8Array(buffer))
      .catch((error) => {
        fontBytesPromise = null;
        throw new TranscriptPdfFontUnavailableError(
          error instanceof Error ? error.message : undefined,
        );
      });
  }
  return fontBytesPromise;
}

const PDF_PAGE_WIDTH = 595.28; // A4
const PDF_PAGE_HEIGHT = 841.89;
const PDF_MARGIN = 48;
const PDF_BODY_SIZE = 10.5;
const PDF_TITLE_SIZE = 16;
const PDF_LINE_HEIGHT = 16;

const PDF_COLOR_PLAIN = rgb(0.13, 0.13, 0.13);
const PDF_COLOR_TIMESTAMP = rgb(0.45, 0.45, 0.45);
const PDF_COLOR_VIOLATION = rgb(0.75, 0.05, 0.05);
const PDF_COLOR_WARNING = rgb(0.72, 0.55, 0.02);

type PdfRun = {
  text: string;
  color: ReturnType<typeof rgb>;
};

export async function buildTranscriptPdf(
  input: TranscriptExportInput,
): Promise<Uint8Array> {
  const fontBytes = await loadTranscriptPdfFontBytes();

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // 优先子集化嵌入（导出文件体积可控）；个别环境子集化失败时退回整包嵌入。
  let font: PDFFont;
  try {
    font = await pdf.embedFont(fontBytes, { subset: true });
  } catch {
    font = await pdf.embedFont(fontBytes);
  }

  const writer = new PdfWriter(pdf, font);

  writer.drawParagraph(
    [{ text: `逐字稿：${input.assetTitle}`, color: PDF_COLOR_PLAIN }],
    PDF_TITLE_SIZE,
  );
  writer.blankLine(0.4);
  writer.drawParagraph(
    [
      {
        text: `资产：${input.assetTitle} · ASR 引擎：${input.asrProvider ?? "unknown"} · 导出日期：${input.exportedAtLabel}`,
        color: PDF_COLOR_TIMESTAMP,
      },
    ],
    PDF_BODY_SIZE,
  );
  writer.drawParagraph(
    [
      {
        text: transcriptSummaryLabel(input.transcript.summary),
        color: PDF_COLOR_PLAIN,
      },
    ],
    PDF_BODY_SIZE,
  );
  writer.blankLine(0.8);

  for (const utterance of input.transcript.utterances) {
    const runs: PdfRun[] = [];
    const prefix = utteranceLinePrefix(
      utterance.startSeconds,
      input.includeTimestamps,
    );
    if (prefix) {
      runs.push({ text: prefix, color: PDF_COLOR_TIMESTAMP });
    }
    for (const segment of utterance.segments) {
      runs.push({
        text: segment.text,
        color:
          segment.tone === "violation"
            ? PDF_COLOR_VIOLATION
            : segment.tone === "warning"
              ? PDF_COLOR_WARNING
              : PDF_COLOR_PLAIN,
      });
    }
    writer.drawParagraph(runs, PDF_BODY_SIZE);
    writer.blankLine(0.25);
  }

  return pdf.save();
}

/**
 * 顺排 + 自动换行 + 分页的极简排版器。中文没有空格分词，
 * 直接按字符累计宽度换行；字符宽度带缓存避免重复计算。
 */
class PdfWriter {
  private page: PDFPage;
  private y: number;
  private readonly widthCache = new Map<string, number>();
  private readonly maxWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2;

  constructor(
    private readonly pdf: PDFDocument,
    private readonly font: PDFFont,
  ) {
    this.page = pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
    this.y = PDF_PAGE_HEIGHT - PDF_MARGIN;
  }

  blankLine(factor: number): void {
    this.y -= PDF_LINE_HEIGHT * factor;
  }

  drawParagraph(runs: PdfRun[], size: number): void {
    let line: PdfRun[] = [];
    let lineWidth = 0;
    let current: PdfRun | null = null;

    const flushLine = () => {
      if (current && current.text) {
        line.push(current);
        current = null;
      }
      this.drawLine(line, size);
      line = [];
      lineWidth = 0;
    };

    for (const run of runs) {
      current = { text: "", color: run.color };
      for (const char of sanitizePdfText(run.text)) {
        const charWidth = this.charWidth(char, size);
        if (lineWidth + charWidth > this.maxWidth && lineWidth > 0) {
          flushLine();
          current = { text: "", color: run.color };
        }
        current.text += char;
        lineWidth += charWidth;
      }
      if (current.text) {
        line.push(current);
      }
      current = null;
    }
    if (line.length) {
      this.drawLine(line, size);
    } else if (!runs.length) {
      this.blankLine(1);
    }
  }

  private drawLine(runs: PdfRun[], size: number): void {
    const lineHeight = Math.max(PDF_LINE_HEIGHT, size * 1.4);
    if (this.y - lineHeight < PDF_MARGIN) {
      this.page = this.pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
      this.y = PDF_PAGE_HEIGHT - PDF_MARGIN;
    }
    this.y -= lineHeight;

    let x = PDF_MARGIN;
    for (const run of runs) {
      if (!run.text) continue;
      this.page.drawText(run.text, {
        x,
        y: this.y,
        size,
        font: this.font,
        color: run.color,
      });
      x += this.font.widthOfTextAtSize(run.text, size);
    }
  }

  private charWidth(char: string, size: number): number {
    const key = `${char}:${size}`;
    const cached = this.widthCache.get(key);
    if (cached !== undefined) return cached;
    const width = this.font.widthOfTextAtSize(char, size);
    this.widthCache.set(key, width);
    return width;
  }
}

// 去掉控制字符（换行转空格），避免个别脏字符导致 drawText 抛错。
function sanitizePdfText(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "");
}
