import { writeAuditLog } from "@/lib/audit/audit";
import type { AuthContext } from "@/lib/auth/context";

import { getAllowedExportFields, type ExportKind } from "./export-definitions";

type ExportClient = {
  from(table: "audit_logs"): unknown;
};

export type GovernedExportResult = {
  kind: ExportKind;
  filename: string;
  content: string;
  fieldCount: number;
  rowCount: number;
};

export async function createGovernedExport({
  client,
  actor,
  kind,
  rows = [],
  now = new Date().toISOString(),
}: {
  client: ExportClient;
  actor: Pick<AuthContext, "userId" | "name" | "role" | "organizationId">;
  kind: ExportKind;
  rows?: Array<Record<string, unknown>>;
  now?: string;
}): Promise<GovernedExportResult> {
  const fields = getAllowedExportFields(kind, actor.role);
  const content = toCsv(fields, rows);
  const result = {
    kind,
    filename: `${kind}-${now.slice(0, 10)}.csv`,
    content,
    fieldCount: fields.length,
    rowCount: rows.length,
  };

  await writeAuditLog(client as Parameters<typeof writeAuditLog>[0], {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "export",
    module: "export",
    objectType: "export_job",
    objectName: result.filename,
    after: {
      kind,
      rowCount: rows.length,
      fieldCount: fields.length,
    },
    changedFields: ["export_kind", "row_count"],
  });

  return result;
}

function toCsv(
  fields: ReturnType<typeof getAllowedExportFields>,
  rows: Array<Record<string, unknown>>,
): string {
  const header = fields.map((field) => csvCell(field.label)).join(",");
  const lines = rows.map((row) =>
    fields.map((field) => csvCell(row[field.key])).join(","),
  );
  return [header, ...lines].join("\n");
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // Neutralize spreadsheet formula injection: a leading =, +, -, @, tab or CR
  // makes Excel/Sheets evaluate the cell as a formula when the export is opened.
  // Prefix such values with a single quote so they are treated as plain text.
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (text.includes(",") || text.includes("\n") || text.includes('"')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
