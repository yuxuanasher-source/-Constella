import { NextResponse } from "next/server";

import { upsertKnowledgeAssetDocument } from "@/features/ai/knowledge-asset-index";
import {
  buildAnnotatedTranscript,
  loadRecordingTranscriptContext,
  type AnnotatedTranscript,
} from "@/features/recordings/recording-transcript";
import {
  buildTranscriptDocx,
  buildTranscriptKnowledgeDocument,
  buildTranscriptPdf,
  TranscriptPdfFontUnavailableError,
} from "@/features/recordings/recording-transcript-export";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

const EXPORT_FORMATS = ["knowledge", "docx", "pdf"] as const;

type TranscriptExportFormat = (typeof EXPORT_FORMATS)[number];

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_CONTENT_TYPE = "application/pdf";

/**
 * POST /api/recording-assets/[assetId]/transcript/export
 * body: { format: "knowledge" | "docx" | "pdf", includeTimestamps: boolean }
 * - knowledge：沉淀为企业知识库文档（标注用【违规:词】/【风险:词】内联标记）
 * - docx / pdf：二进制附件（违规红 / 风险深黄），附 UTF-8 文件名。
 * 三种导出都写审计日志；导出内容只含逐字稿与风险摘要，无经营敏感字段。
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can export recording transcripts" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      format?: unknown;
      includeTimestamps?: unknown;
    };
    const format = body.format;
    if (!isExportFormat(format)) {
      return NextResponse.json(
        { error: "Unsupported export format" },
        { status: 400 },
      );
    }
    // 缺省带时间戳（逐字稿的默认阅读形态）；只有显式 false 才关闭。
    const includeTimestamps = body.includeTimestamps !== false;

    const { assetId } = await context.params;
    const { asset, transcript } = await loadRecordingTranscriptContext({
      client: supabase as never,
      organizationId: auth.organizationId,
      assetId,
    });

    if (!asset) {
      return NextResponse.json(
        { error: "Recording asset not found" },
        { status: 404 },
      );
    }

    if (!transcript) {
      return NextResponse.json(
        {
          error: "该录屏资产暂无可导出的转写内容",
          errorCode: "transcript_unavailable",
        },
        { status: 409 },
      );
    }

    const annotated = buildAnnotatedTranscript({
      utterances: transcript.utterances,
    });
    const exportedAtLabel = new Date().toISOString().slice(0, 10);
    const exportInput = {
      assetTitle: asset.title,
      asrProvider: transcript.asrProvider,
      exportedAtLabel,
      transcript: annotated,
      includeTimestamps,
    };

    const audit = (input: {
      kind: string;
      objectName: string;
      documentId?: string;
    }) =>
      writeTranscriptExportAudit({
        client: supabase,
        auth,
        assetId: asset.id,
        annotated,
        includeTimestamps,
        ...input,
      });

    if (format === "knowledge") {
      const doc = buildTranscriptKnowledgeDocument({
        ...exportInput,
        organizationId: auth.organizationId,
        analysisId: transcript.analysisId,
        createdBy: auth.userId,
      });
      const { id } = await upsertKnowledgeAssetDocument(supabase as never, doc);
      await audit({
        kind: "recording_transcript_knowledge",
        objectName: doc.title,
        documentId: id,
      });
      return NextResponse.json(
        { document: { id, title: doc.title } },
        { status: 201 },
      );
    }

    if (format === "docx") {
      const buffer = await buildTranscriptDocx(exportInput);
      const filename = exportFilename(asset.title, exportedAtLabel, "docx");
      await audit({ kind: "recording_transcript_docx", objectName: filename });
      return attachmentResponse(buffer, DOCX_CONTENT_TYPE, filename);
    }

    // format === "pdf"
    let bytes: Uint8Array;
    try {
      bytes = await buildTranscriptPdf(exportInput);
    } catch (error) {
      if (error instanceof TranscriptPdfFontUnavailableError) {
        // 中文字体不可用时明确降级，避免导出乱码 PDF。
        return NextResponse.json(
          {
            error: "PDF 中文字体不可用，暂无法导出 PDF",
            errorCode: "pdf_font_unavailable",
          },
          { status: 501 },
        );
      }
      throw error;
    }
    const filename = exportFilename(asset.title, exportedAtLabel, "pdf");
    await audit({ kind: "recording_transcript_pdf", objectName: filename });
    return attachmentResponse(bytes, PDF_CONTENT_TYPE, filename);
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }

    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

function isExportFormat(value: unknown): value is TranscriptExportFormat {
  return (
    typeof value === "string" &&
    (EXPORT_FORMATS as readonly string[]).includes(value)
  );
}

async function writeTranscriptExportAudit({
  client,
  auth,
  assetId,
  annotated,
  includeTimestamps,
  kind,
  objectName,
  documentId,
}: {
  client: Parameters<typeof writeAuditLog>[0];
  auth: AuthContext;
  assetId: string;
  annotated: AnnotatedTranscript;
  includeTimestamps: boolean;
  kind: string;
  objectName: string;
  documentId?: string;
}): Promise<void> {
  await writeAuditLog(client, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    actorName: auth.name,
    actorRole: auth.role,
    action: "export",
    module: "export",
    objectType: "export_job",
    objectId: assetId,
    objectName,
    after: {
      kind,
      includeTimestamps,
      rowCount: annotated.utterances.length,
      violationCount: annotated.summary.violationCount,
      warningCount: annotated.summary.warningCount,
      ...(documentId ? { knowledgeDocumentId: documentId } : {}),
    },
    changedFields: ["export_kind", "row_count"],
  });
}

function exportFilename(
  assetTitle: string,
  dateLabel: string,
  extension: "docx" | "pdf",
): string {
  const safeTitle =
    assetTitle
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 60) || "未命名录屏";
  return `逐字稿-${safeTitle}-${dateLabel}.${extension}`;
}

function attachmentResponse(
  bytes: Uint8Array,
  contentType: string,
  filename: string,
): NextResponse {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_");
  const body = new Uint8Array(bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

// RFC 5987 ext-value：encodeURIComponent 之外还要转义 ! ' ( ) *。
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
