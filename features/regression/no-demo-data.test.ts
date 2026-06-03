import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const productionFiles = [
  "supabase/seed.sql",
  "app/(auth)/login/page.tsx",
  "components/reference-ui/ops-reference.jsx",
  "components/reference-ui/streamer-mobile-reference.jsx",
  "components/reference-ui/streamer-desktop-reference.jsx",
  "README.md",
] as const;

const forbiddenDemoMarkers = [
  /jy-demo\.local/i,
  /Password123!/i,
  /Jingying Demo/i,
  /Demo data loaded/i,
  /demo\/reports/i,
  /mock data/i,
  /星河直播/,
  /米哈游/,
  /腾讯游戏/,
  /原神/,
  /王者荣耀/,
  /NIKO/,
  /P-2406/,
  /S-004/,
  /T-1034/,
  /P-2412/,
  /P-2405/,
  /R-08831/,
  /B-2026/,
  /PROJECT_ID/,
  /2026-05/,
  /2025-08-12/,
  /org_galaxy/i,
  /B-001/,
  /P-TEST/i,
  /705235/,
  /b62b7e09/i,
] as const;

const forbiddenDemoText = [
  "\u51b7\u6c5f",
  "\u9752\u7fbd",
  "\u5c0fMei",
  "\u963f\u4e03",
  "\u7cd6\u8c46",
  "\u674e\u73e9",
  "\u672a\u547d\u540d\u4e3b\u64ad",
  "\u672c\u5468\u63d0\u9192",
  "\u8fd1\u671f AI \u590d\u76d8\u8981\u70b9",
  "\u54c1\u7c7b\u5339\u914d\u504f\u5dee",
  "\u793c\u7269\u63d0\u6210\u8f6c\u5316",
  "CPS \u6570\u636e\u7f3a\u53e3",
  "\u5382\u5bb6\u5173\u6ce8\u89d2\u8272\u76f8\u5173\u5185\u5bb9",
  "\u6d4b\u8bd5\u65b0\u5efa\u9879\u76ee",
  "\u672c\u6279\u6b21\u672a\u786e\u8ba4",
  "\u672a\u547d\u540d\u9879\u76ee",
  "\u5143\u68a6\u4e4b\u661f",
  "\u6c38\u52ab\u65e0\u95f4",
  "KPL",
  "\u9ec4\u91d1\u6863",
  "4.7",
  "\u51ef\u8587\u5a1c",
] as const;

describe("production demo data guard", () => {
  it("keeps demo seed accounts and sample business entities out of production-facing files", () => {
    const violations = productionFiles.flatMap((file) => {
      const source = readFileSync(join(root, file), "utf8");
      const regexViolations = forbiddenDemoMarkers
        .filter((marker) => marker.test(source))
        .map((marker) => `${file}: ${marker}`);
      const textViolations = forbiddenDemoText
        .filter((marker) => source.includes(marker))
        .map((marker) => `${file}: ${marker}`);
      return [...regexViolations, ...textViolations];
    });

    expect(violations).toEqual([]);
  });
});
