import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AUTOMATED_CASES,
  assertNoForbiddenKeys,
  assertNoForbiddenText,
  collectObjectKeys,
  extractManualCaseIds,
  selectMutableNotification,
} from "./manual-acceptance-smoke.mjs";

const manualCaseMarkdown = readFileSync(
  "docs/manual-acceptance-test-cases.md",
  "utf8",
);

describe("manual acceptance smoke case mapping", () => {
  it("maps automated checks back to real manual acceptance case ids", () => {
    const manualCaseIds = extractManualCaseIds(manualCaseMarkdown);
    const automatedCaseIds = new Set(
      AUTOMATED_CASES.flatMap((testCase) => testCase.caseIds),
    );

    expect(manualCaseIds.size).toBeGreaterThan(80);
    for (const caseId of automatedCaseIds) {
      expect(manualCaseIds.has(caseId), `${caseId} must exist in manual doc`).toBe(
        true,
      );
    }

    expect(Array.from(automatedCaseIds)).toEqual(
      expect.arrayContaining([
        "E2E-001",
        "E2E-002",
        "E2E-003",
        "E2E-004",
        "M5-011",
        "M6-006",
        "M7-003",
        "M8-002",
        "M9-001",
        "AUTO-001",
        "M10-001",
        "M10-007",
      ]),
    );
  });
});

describe("manual acceptance smoke safety assertions", () => {
  it("collects nested object keys for DTO leakage checks", () => {
    expect(
      collectObjectKeys({
        project: {
          projectId: "project-1",
          items: [{ streamerName: "Ava" }],
        },
      }),
    ).toEqual(["project", "projectId", "items", "streamerName"]);
  });

  it("rejects forbidden DTO keys and sensitive text", () => {
    expect(() =>
      assertNoForbiddenKeys(
        {
          streamerName: "Ava",
          grossMarginCents: 1200,
        },
        "streamer payload",
      ),
    ).toThrow(/grossMarginCents/);

    expect(() =>
      assertNoForbiddenText(
        "候选主播表,主播结算价格,MCN 毛利",
        "vendor export",
      ),
    ).toThrow(/vendor export/);
  });
});

describe("manual acceptance smoke notification selection", () => {
  it("selects a user-addressed notification instead of a role broadcast", () => {
    const selected = selectMutableNotification([
      {
        id: "role-notification",
        title: "Settlement batch reopened",
        objectType: "settlement_batch",
      },
      {
        id: "user-notification",
        title: "Demo data loaded",
        objectType: "organization",
      },
    ]);

    expect(selected.id).toBe("user-notification");
  });
});
