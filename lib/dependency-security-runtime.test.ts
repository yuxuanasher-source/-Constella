import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

type ResolvedArchiver = {
  finalize(): Promise<void>;
  glob(pattern: string, options: { cwd: string }): void;
  on(event: "entry", listener: (entry: { name: string }) => void): void;
  pipe(output: PassThrough): void;
};

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

  it("archives a brace glob through Archiver's real ExcelJS dependency", async () => {
    const fixtureDirectory = mkdtempSync(
      join(tmpdir(), "jingying-archiver-glob-"),
    );

    try {
      writeFileSync(join(fixtureDirectory, "package.json"), "{}\n", "utf8");
      writeFileSync(join(fixtureDirectory, "pnpm-lock.json"), "{}\n", "utf8");

      const requireFromProject = createRequire(
        resolve(process.cwd(), "package.json"),
      );
      const exceljsPackageJson = requireFromProject.resolve(
        "exceljs/package.json",
      );
      const requireFromExceljs = createRequire(exceljsPackageJson);
      const createArchive = requireFromExceljs("archiver") as (
        format: "zip",
      ) => ResolvedArchiver;
      const archive = createArchive("zip");
      const output = new PassThrough();
      const chunks: Buffer[] = [];
      const entryNames: string[] = [];
      output.on("data", (chunk: Buffer) => chunks.push(chunk));
      archive.on("entry", (entry) => entryNames.push(entry.name));
      archive.pipe(output);
      const outputFinished = finished(output);

      archive.glob("{package,pnpm-lock}.json", { cwd: fixtureDirectory });
      await archive.finalize();
      await outputFinished;

      expect(entryNames.sort()).toEqual(["package.json", "pnpm-lock.json"]);
      expect(Buffer.concat(chunks).subarray(0, 2).toString("hex")).toBe("504b");
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });
});
