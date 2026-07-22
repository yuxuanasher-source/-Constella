import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type EvalCase = {
  id: string;
  category: string;
  mode: "fast" | "deep";
  prompt: string;
  official: { outcome: string; completion: boolean };
  integrated: {
    outcome: string;
    completion: boolean;
    evidenceRefs: string[];
    toolSuccess: boolean;
    numericClaims: { value: number; evidenceRefs: string[] }[];
    businessWrites: number;
    providerFallback: boolean;
    modelFallback: boolean;
    iterations: number;
    subagents: number;
    latencyMs: number;
    tokens: { input: number; output: number };
    leakedWrites: number;
  };
};

type EvaluationReport = {
  summary: {
    total: number;
    officialCompletionRate: number;
    integratedCompletionRate: number;
    completionDeltaPoints: number;
    evidenceLessNumericClaims: number;
    businessWrites: number;
    providerFallbacks: number;
    modelFallbacks: number;
  };
  records: Array<{
    caseId: string;
    category: string;
    outcome: string;
    completion: boolean;
    toolSuccess: boolean;
    evidenceRefs: string[];
    observationStartedAt: string;
    observationCompletedAt: string;
    modelProviderIdentityHash: string;
    iterationCount: number;
    subagentCount: number;
    latencyMs: number;
    tokens: { input: number; output: number };
    leakedWriteCount: number;
  }>;
};

const root = process.cwd();
const casesPath = join(root, "scripts", "xingyao-hermes-eval-cases.json");
const runnerPath = join(root, "scripts", "test-xingyao-hermes-e2e.mjs");

describe("Hermes native restoration performance contract", () => {
  it("defines at least 20 fixed prompts across the required product categories", () => {
    const cases = readCases();
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
    expect(cases.every((item) => item.prompt.trim().length > 0)).toBe(true);
    expect(cases.map((item) => item.category)).toEqual(
      expect.arrayContaining([
        "general_reasoning_no_tools",
        "context_project",
        "project_search",
        "project_detail",
        "streamer",
        "reports",
        "recording",
        "knowledge",
        "settlement",
        "one_tool_failure_with_evidence",
        "all_critical_missing",
        "fast_planning",
        "deep_delegation",
        "todo_clarify",
        "session_resume",
        "session_search_summary",
        "session_compression",
        "cache_rebuild",
      ]),
    );
  });

  it("records completion, evidence, timing, identity, work, latency, token, and leak metrics without prompt text", () => {
    const cases = readCases();
    const report = runLocalEvaluation();

    expect(report.summary.total).toBe(cases.length);
    expect(report.summary.integratedCompletionRate).toBeGreaterThanOrEqual(
      report.summary.officialCompletionRate - 0.05,
    );
    expect(report.summary.evidenceLessNumericClaims).toBe(0);
    expect(report.summary.businessWrites).toBe(0);
    expect(report.summary.providerFallbacks).toBe(0);
    expect(report.summary.modelFallbacks).toBe(0);

    for (const record of report.records) {
      expect(record).not.toHaveProperty("prompt");
      expect(record).not.toHaveProperty("chainOfThought");
      expect(record.caseId).toMatch(/^hermes-[a-z0-9-]+$/);
      expect([
        "complete",
        "partial",
        "blocked",
        "failed",
        "cancelled",
      ]).toContain(record.outcome);
      expect(typeof record.toolSuccess).toBe("boolean");
      expect(Array.isArray(record.evidenceRefs)).toBe(true);
      expect(new Date(record.observationStartedAt).toISOString()).toBe(
        record.observationStartedAt,
      );
      expect(new Date(record.observationCompletedAt).toISOString()).toBe(
        record.observationCompletedAt,
      );
      expect(record.modelProviderIdentityHash).toMatch(/^[a-f0-9]{64}$/);
      expect(record.iterationCount).toBeGreaterThanOrEqual(1);
      expect(record.subagentCount).toBeGreaterThanOrEqual(0);
      expect(record.latencyMs).toBeGreaterThan(0);
      expect(record.tokens.input).toBeGreaterThan(0);
      expect(record.tokens.output).toBeGreaterThan(0);
      expect(record.leakedWriteCount).toBe(0);
    }
  });

  it("retains surviving evidence when one tool fails and blocks cleanly when all critical sources are missing", () => {
    const report = runLocalEvaluation();
    const oneToolFailure = report.records.find(
      (item) => item.caseId === "hermes-one-tool-failure",
    );
    const allMissing = report.records.find(
      (item) => item.caseId === "hermes-all-critical-missing",
    );

    expect(oneToolFailure).toMatchObject({
      completion: true,
      outcome: "partial",
      toolSuccess: false,
    });
    expect(oneToolFailure?.evidenceRefs.length).toBeGreaterThan(0);
    expect(allMissing).toMatchObject({
      completion: false,
      outcome: "blocked",
      toolSuccess: false,
      evidenceRefs: [],
    });
  });

  it("keeps Fast and Deep planning traces different by budget and delegation", () => {
    const report = runLocalEvaluation();
    const fast = report.records.find(
      (item) => item.caseId === "hermes-fast-plan",
    );
    const deep = report.records.find(
      (item) => item.caseId === "hermes-deep-delegate",
    );

    expect(fast).toMatchObject({
      iterationCount: 6,
      subagentCount: 0,
    });
    expect(deep).toMatchObject({
      iterationCount: 18,
      subagentCount: 2,
    });
  });
});

function readCases(): EvalCase[] {
  return JSON.parse(readFileSync(casesPath, "utf8")) as EvalCase[];
}

function runLocalEvaluation(): EvaluationReport {
  const stdout = execFileSync(process.execPath, [runnerPath, "--local"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HERMES_E2E_FIXED_NOW: "2026-07-22T00:00:00.000Z" },
  });
  return JSON.parse(stdout) as EvaluationReport;
}
