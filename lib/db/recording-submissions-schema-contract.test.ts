import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260602013000_p1_admission_foundation.sql",
  ),
  "utf8",
);
const loader = readFileSync(
  join(
    process.cwd(),
    "features/streamers/streamer-project-review-loader.ts",
  ),
  "utf8",
);

describe("recording submissions schema contract", () => {
  it("declares every recording_submissions column selected by the review loader", () => {
    const tableDefinition = extractCreateTableBody(
      migration,
      "recording_submissions",
    );
    const recordingSubmissionQueries = [
      ...loader.matchAll(
        /\.from\("recording_submissions"\)\s*\.select\("([^"]+)"\)/g,
      ),
    ];
    const selectedColumns = recordingSubmissionQueries.flatMap((match) =>
      match[1].split(",").map((column) => column.trim()),
    );
    const declaredColumns = new Set(extractColumnNames(tableDefinition ?? ""));

    expect(tableDefinition).toBeDefined();
    expect(recordingSubmissionQueries).not.toEqual([]);
    expect(selectedColumns.filter((column) => !declaredColumns.has(column))).toEqual(
      [],
    );
  });
});

function extractCreateTableBody(
  sql: string,
  tableName: string,
): string | undefined {
  const match = new RegExp(
    `create table public\\.${tableName}\\s*\\(`,
    "i",
  ).exec(sql);
  if (!match || match.index === undefined) return undefined;

  const openingParenIndex = match.index + match[0].length - 1;
  let depth = 0;
  for (let index = openingParenIndex; index < sql.length; index += 1) {
    if (sql[index] === "(") depth += 1;
    if (sql[index] === ")") depth -= 1;
    if (depth === 0) return sql.slice(openingParenIndex + 1, index);
  }
  return undefined;
}

function extractColumnNames(tableBody: string): string[] {
  return splitTopLevelDeclarations(tableBody).flatMap((declaration) => {
    const trimmed = declaration.trim();
    if (/^(constraint|primary key|foreign key|unique|check|exclude)\b/i.test(trimmed)) {
      return [];
    }
    const column = /^([a-z_][a-z0-9_]*)\s+/i.exec(trimmed)?.[1];
    return column ? [column] : [];
  });
}

function splitTopLevelDeclarations(tableBody: string): string[] {
  const declarations: string[] = [];
  let depth = 0;
  let declarationStart = 0;
  for (let index = 0; index < tableBody.length; index += 1) {
    if (tableBody[index] === "(") depth += 1;
    if (tableBody[index] === ")") depth -= 1;
    if (tableBody[index] === "," && depth === 0) {
      declarations.push(tableBody.slice(declarationStart, index));
      declarationStart = index + 1;
    }
  }
  declarations.push(tableBody.slice(declarationStart));
  return declarations;
}
