import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { HERMES_MODE_BUDGETS } from "./contracts";
import {
  evaluateFastTurnGate,
  type FastTurnPerformanceSample,
} from "./performance-statistics";

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
  harness: string;
  mode: "local" | "real";
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
    mode: "fast" | "deep";
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

type PerformanceInputSample = {
  mode: "fast" | "deep";
  success: unknown;
  firstDeltaMs: unknown;
  totalMs: unknown;
  tokens?: { input: number; output: number };
};

type PerformanceReportOutput = {
  harness: string;
  mode: "performance-report";
  sampleCount: number;
  fastSampleCount: number;
  totalSamples: number;
  successfulSamples: number;
  firstDeltaSamples: number;
  totalLatencySamples: number;
  metrics: {
    successRate: number;
    firstDeltaP95Ms: number | null;
    totalP95Ms: number | null;
  };
  gate: { ok: boolean; failures: string[] };
};

const root = process.cwd();
const casesPath = join(root, "scripts", "xingyao-hermes-eval-cases.json");
const runnerPath = join(root, "scripts", "test-xingyao-hermes-e2e.mjs");
const temporaryDirectories: string[] = [];
const gateThresholds = {
  minSamples: 100,
  minSuccessRate: 0.99,
  maxFirstDeltaP95Ms: 8_000,
  maxTotalP95Ms: 30_000,
};
const forbiddenFixtureClaimKeys = [
  "gate",
  "releasegate",
  "productioncompliance",
  "productionslocompliance",
  "slocompliance",
];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Hermes native restoration schema and safety fixture", () => {
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

  it.each([
    "Bearer should-not-be-emitted",
    "sk-should-not-be-emitted",
    "credential should-not-be-emitted",
    "password=should-not-be-emitted",
    "api_key=should-not-be-emitted",
    "authorization should-not-be-emitted",
    "chain-of-thought should-not-be-emitted",
    "secret should-not-be-emitted",
  ])(
    "rejects sensitive generated output values matching %s",
    (sensitiveValue) => {
      const cases = readCases();
      cases[0].integrated.evidenceRefs = [sensitiveValue];
      const result = runLocalFixture(writeTemporaryJson(cases, "cases.json"));

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe(
        "Hermes evaluation report contains a forbidden sensitive value",
      );
      expect(result.stderr).not.toContain(sensitiveValue);
    },
  );

  it("allows harmless token prose and numeric token-count fields in generated output", () => {
    const cases = readCases();
    cases[0].integrated.evidenceRefs = ["token budget count is within limits"];
    const result = runLocalFixture(writeTemporaryJson(cases, "cases.json"));
    const report = JSON.parse(result.stdout) as EvaluationReport;

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(report.records[0].evidenceRefs).toEqual([
      "token budget count is within limits",
    ]);
    expect(report.records[0].tokens).toEqual({ input: 92, output: 188 });
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

  it("keeps deterministic fixture latency within mode budgets without claiming production SLO evidence", () => {
    const report = runLocalEvaluation();

    for (const record of report.records) {
      expect(record.latencyMs).toBeLessThanOrEqual(
        HERMES_MODE_BUDGETS[record.mode].wallClockMs,
      );
    }
  });

  it("identifies the local schema fixture without release-gate or production-compliance claims", () => {
    const report = runLocalEvaluation();

    expect(report).toMatchObject({
      harness: "xingyao-hermes-e2e",
      mode: "local",
    });
    expectNoFixtureProductionClaims(report);
  });

  it.each(forbiddenFixtureClaimKeys)(
    "rejects a local fixture carrying the single claim field %s",
    (forbiddenKey) => {
      expect(() =>
        expectNoFixtureProductionClaims({ [forbiddenKey]: true }),
      ).toThrow();
    },
  );
});

describe("Hermes sanitized performance report gate", () => {
  it("evaluates only Fast samples and permits numeric token counts", () => {
    const samples: Array<{
      mode: "fast" | "deep";
      success: boolean;
      firstDeltaMs: number | null;
      totalMs: number;
      tokens: { input: number; output: number };
    }> = Array.from({ length: 100 }, (_, index) => ({
      mode: "fast",
      success: true,
      firstDeltaMs: 1_000 + index,
      totalMs: 10_000 + index,
      tokens: { input: 100 + index, output: 200 + index },
    }));
    samples.push({
      mode: "deep",
      success: false,
      firstDeltaMs: null,
      totalMs: 60_000,
      tokens: { input: 1_000, output: 2_000 },
    });
    const reportPath = writePerformanceReport({ samples });

    const result = runPerformanceReport(reportPath);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(output).toEqual({
      harness: "xingyao-hermes-e2e",
      mode: "performance-report",
      sampleCount: 101,
      fastSampleCount: 100,
      totalSamples: 100,
      successfulSamples: 100,
      firstDeltaSamples: 100,
      totalLatencySamples: 100,
      metrics: {
        successRate: 1,
        firstDeltaP95Ms: 1_094,
        totalP95Ms: 10_094,
      },
      gate: { ok: true, failures: [] },
    });
    expect(result.stdout).not.toContain(reportPath);
  });

  it("uses nearest-rank ceil behavior when ranks 95 and 96 differ", () => {
    const samples: PerformanceInputSample[] = Array.from(
      { length: 101 },
      (_, index) => ({
        mode: "fast",
        success: true,
        firstDeltaMs: index < 95 ? 8_000 : 8_001,
        totalMs: index < 95 ? 30_000 : 30_001,
      }),
    );

    const { result, output } = runParityReport(samples);

    expect(result.status).toBe(1);
    expect(output.metrics).toMatchObject({
      firstDeltaP95Ms: 8_001,
      totalP95Ms: 30_001,
    });
    expect(output).toMatchObject({
      totalSamples: 101,
      successfulSamples: 101,
      firstDeltaSamples: 101,
      totalLatencySamples: 101,
    });
    expect(output.gate.failures).toEqual([
      "first_delta_p95_exceeded",
      "total_p95_exceeded",
    ]);
  });

  it("matches the exact 0.99 success boundary with the TypeScript gate", () => {
    const samples: PerformanceInputSample[] = [
      ...Array.from({ length: 99 }, () => ({
        mode: "fast" as const,
        success: true,
        firstDeltaMs: 1_000,
        totalMs: 10_000,
      })),
      {
        mode: "fast",
        success: false,
        firstDeltaMs: null,
        totalMs: 10_000,
      },
    ];

    const { result, output } = runParityReport(samples);

    expect(result.status).toBe(0);
    expect(output.metrics.successRate).toBe(0.99);
    expect(output).toMatchObject({
      successfulSamples: 99,
      firstDeltaSamples: 99,
      totalLatencySamples: 99,
    });
  });

  it("does not round a failing success rate up to 0.99", () => {
    const samples: PerformanceInputSample[] = [
      ...Array.from({ length: 19_799 }, () => ({
        mode: "fast" as const,
        success: true,
        firstDeltaMs: 1_000,
        totalMs: 10_000,
      })),
      ...Array.from({ length: 201 }, () => ({
        mode: "fast" as const,
        success: false,
        firstDeltaMs: null,
        totalMs: 10_000,
      })),
    ];

    const { result, output } = runParityReport(samples);

    expect(result.status).toBe(1);
    expect(output.metrics.successRate).toBe(19_799 / 20_000);
    expect(output.metrics.successRate).toBeLessThan(0.99);
    expect(output.gate.failures).toEqual(["success_rate_below_minimum"]);
  });

  it("matches latency and success-rate failure codes with the TypeScript gate", () => {
    const slowSamples: PerformanceInputSample[] = Array.from(
      { length: 100 },
      () => ({
        mode: "fast",
        success: true,
        firstDeltaMs: 8_001,
        totalMs: 30_001,
      }),
    );
    const lowSuccessSamples: PerformanceInputSample[] = [
      ...Array.from({ length: 98 }, () => ({
        mode: "fast" as const,
        success: true,
        firstDeltaMs: 1_000,
        totalMs: 10_000,
      })),
      ...Array.from({ length: 2 }, () => ({
        mode: "fast" as const,
        success: false,
        firstDeltaMs: null,
        totalMs: 10_000,
      })),
    ];

    const slow = runParityReport(slowSamples);
    const lowSuccess = runParityReport(lowSuccessSamples);

    expect(slow.result.status).toBe(1);
    expect(slow.output.gate.failures).toEqual([
      "first_delta_p95_exceeded",
      "total_p95_exceeded",
    ]);
    expect(lowSuccess.result.status).toBe(1);
    expect(lowSuccess.output.gate.failures).toEqual([
      "success_rate_below_minimum",
    ]);
  });

  it.each([
    {
      name: "negative first delta",
      sample: {
        mode: "fast",
        success: true,
        firstDeltaMs: -1,
        totalMs: 10_000,
      },
    },
    {
      name: "negative total latency",
      sample: {
        mode: "fast",
        success: true,
        firstDeltaMs: 0,
        totalMs: -1,
      },
    },
    {
      name: "null first delta on success",
      sample: {
        mode: "fast",
        success: true,
        firstDeltaMs: null,
        totalMs: 10_000,
      },
    },
    {
      name: "first delta beyond total on success",
      sample: {
        mode: "fast",
        success: true,
        firstDeltaMs: 10_001,
        totalMs: 10_000,
      },
    },
    {
      name: "first delta beyond total on failure",
      sample: {
        mode: "fast",
        success: false,
        firstDeltaMs: 10_001,
        totalMs: 10_000,
      },
    },
    {
      name: "non-boolean success",
      sample: {
        mode: "fast",
        success: "true",
        firstDeltaMs: 1_000,
        totalMs: 10_000,
      },
    },
  ])("matches invalid_samples for $name", ({ sample }) => {
    const { result, output } = runParityReport([
      sample as PerformanceInputSample,
    ]);

    expect(result.status).toBe(1);
    expect(output.gate.failures).toEqual(["invalid_samples"]);
  });

  it("rejects nonfinite JSON and malformed report shapes before gate evaluation", () => {
    const nonfinitePath = writeTemporaryRaw(
      '{"samples":[{"mode":"fast","success":true,"firstDeltaMs":NaN,"totalMs":1000}]}',
      "nonfinite.json",
    );
    const malformedSamplePath = writePerformanceReport({
      samples: [{ success: true, firstDeltaMs: 1_000, totalMs: 10_000 }],
    });

    const nonfinite = runPerformanceReport(nonfinitePath);
    const malformed = runPerformanceReport(malformedSamplePath);

    expect(nonfinite.status).toBe(1);
    expect(nonfinite.stderr.trim()).toBe(
      "Hermes performance report rejected: invalid_json",
    );
    expect(malformed.status).toBe(1);
    expect(malformed.stderr.trim()).toBe(
      "Hermes performance report rejected: invalid_shape",
    );
  });

  it.each(["firstDeltaMs", "totalMs"])(
    "matches invalid_samples when JSON overflow makes %s nonfinite",
    (field) => {
      const rawSample = {
        mode: "fast",
        success: true,
        firstDeltaMs: field === "firstDeltaMs" ? "1e400" : "1000",
        totalMs: field === "totalMs" ? "1e400" : "10000",
      };
      const reportPath = writeTemporaryRaw(
        `{"samples":[{"mode":"${rawSample.mode}","success":${rawSample.success},"firstDeltaMs":${rawSample.firstDeltaMs},"totalMs":${rawSample.totalMs}}]}`,
        `${field}-overflow.json`,
      );
      const result = runPerformanceReport(reportPath);
      const output = JSON.parse(result.stdout) as PerformanceReportOutput;
      const gateSample: FastTurnPerformanceSample = {
        success: true,
        firstDeltaMs:
          field === "firstDeltaMs" ? Number.POSITIVE_INFINITY : 1_000,
        totalMs: field === "totalMs" ? Number.POSITIVE_INFINITY : 10_000,
      };

      expect(result.status).toBe(1);
      expect(output.gate).toEqual(
        evaluateFastTurnGate({
          samples: [gateSample],
          ...gateThresholds,
        }),
      );
      expect(output.gate.failures).toEqual(["invalid_samples"]);
    },
  );

  it("prints a sanitized report and exits nonzero when the gate fails", () => {
    const reportPath = writePerformanceReport({
      samples: [
        {
          mode: "fast",
          success: true,
          firstDeltaMs: 1_000,
          totalMs: 10_000,
        },
      ],
    });

    const result = runPerformanceReport(reportPath);
    const output = JSON.parse(result.stdout) as {
      mode: string;
      fastSampleCount: number;
      gate: { ok: boolean; failures: string[] };
    };

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("Hermes performance gate failed");
    expect(output.mode).toBe("performance-report");
    expect(output.fastSampleCount).toBe(1);
    expect(output.gate.ok).toBe(false);
    expect(output.gate.failures).toContain("insufficient_samples");
  });

  it.each([
    "prompt",
    "content",
    "assertion",
    "capability",
    "authorization",
    "serviceToken",
    "accessToken",
    "secret",
    "chainOfThought",
  ])("rejects a recursively nested forbidden %s field", (forbiddenKey) => {
    const sensitiveValue = `must-not-echo-${forbiddenKey}`;
    const reportPath = writePerformanceReport({
      samples: [],
      metadata: { nested: [{ [forbiddenKey]: sensitiveValue }] },
    });

    const result = runPerformanceReport(reportPath);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(
      "Hermes performance report rejected: forbidden_field",
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(sensitiveValue);
  });

  it("normalizes forbidden key names without substring matching legitimate metrics", () => {
    const reportPath = writePerformanceReport({
      samples: [],
      metadata: { nested: { "Service-Token": "must-not-echo" } },
    });

    const result = runPerformanceReport(reportPath);

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(
      "Hermes performance report rejected: forbidden_field",
    );
    expect(result.stderr).not.toContain("must-not-echo");
  });

  it("handles missing, malformed, and invalid reports with stable sanitized errors", () => {
    const directory = createTemporaryDirectory();
    const missingPath = join(directory, "missing.json");
    const malformedPath = join(directory, "malformed.json");
    const invalidPath = join(directory, "invalid.json");
    writeFileSync(malformedPath, '{"samples":["raw-sensitive-marker"', "utf8");
    writeFileSync(invalidPath, JSON.stringify({ records: [] }), "utf8");

    const missing = runPerformanceReport(missingPath);
    const malformed = runPerformanceReport(malformedPath);
    const invalid = runPerformanceReport(invalidPath);
    const noArgument = spawnSync(
      process.execPath,
      [runnerPath, "--performance-report"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );

    expect(missing.status).toBe(1);
    expect(missing.stderr.trim()).toBe(
      "Hermes performance report rejected: unreadable",
    );
    expect(malformed.status).toBe(1);
    expect(malformed.stderr.trim()).toBe(
      "Hermes performance report rejected: invalid_json",
    );
    expect(`${malformed.stdout}${malformed.stderr}`).not.toContain(
      "raw-sensitive-marker",
    );
    expect(invalid.status).toBe(1);
    expect(invalid.stderr.trim()).toBe(
      "Hermes performance report rejected: invalid_shape",
    );
    expect(noArgument.status).toBe(1);
    expect(noArgument.stderr.trim()).toBe(
      "Hermes performance report rejected: missing_path",
    );
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

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "hermes-performance-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writePerformanceReport(report: unknown): string {
  return writeTemporaryJson(report, "report.json");
}

function writeTemporaryJson(value: unknown, filename: string): string {
  const path = join(createTemporaryDirectory(), filename);
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
}

function writeTemporaryRaw(value: string, filename: string): string {
  const path = join(createTemporaryDirectory(), filename);
  writeFileSync(path, value, "utf8");
  return path;
}

function runPerformanceReport(reportPath: string) {
  return spawnSync(
    process.execPath,
    [runnerPath, "--performance-report", reportPath],
    { cwd: root, encoding: "utf8" },
  );
}

function runLocalFixture(customCasesPath: string) {
  return spawnSync(
    process.execPath,
    [runnerPath, "--local", "--cases", customCasesPath],
    { cwd: root, encoding: "utf8" },
  );
}

function runParityReport(samples: PerformanceInputSample[]) {
  const result = runPerformanceReport(writePerformanceReport({ samples }));
  const output = JSON.parse(result.stdout) as PerformanceReportOutput;
  const gateSamples = samples
    .filter((sample) => sample.mode === "fast")
    .map((sample) => ({
      success: sample.success,
      firstDeltaMs: sample.firstDeltaMs,
      totalMs: sample.totalMs,
    })) as FastTurnPerformanceSample[];

  expect(output.gate).toEqual(
    evaluateFastTurnGate({ samples: gateSamples, ...gateThresholds }),
  );
  return { result, output };
}

function collectNormalizedKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectNormalizedKeys);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, nestedValue]) => [
    key.toLowerCase().replace(/[^a-z0-9]/g, ""),
    ...collectNormalizedKeys(nestedValue),
  ]);
}

function expectNoFixtureProductionClaims(value: unknown): void {
  const normalizedKeys = collectNormalizedKeys(value);
  for (const forbiddenKey of forbiddenFixtureClaimKeys) {
    expect(normalizedKeys).not.toContain(forbiddenKey);
  }
}
