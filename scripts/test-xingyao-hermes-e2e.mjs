#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultCasesPath = resolve(__dirname, "xingyao-hermes-eval-cases.json");
const terminalOutcomes = new Set([
  "complete",
  "partial",
  "blocked",
  "failed",
  "cancelled",
]);
const forbiddenReportKeys = new Set([
  "prompt",
  "content",
  "assertion",
  "capability",
  "authorization",
  "servicetoken",
  "accesstoken",
  "secret",
  "chainofthought",
]);
const fastTurnGateThresholds = {
  minSamples: 100,
  minSuccessRate: 0.99,
  maxFirstDeltaP95Ms: 8_000,
  maxTotalP95Ms: 30_000,
};

export function loadEvalCases(casesPath = defaultCasesPath) {
  const cases = JSON.parse(readFileSync(casesPath, "utf8"));
  if (!Array.isArray(cases)) {
    throw new Error("Hermes eval cases must be a JSON array");
  }
  return cases;
}

export async function runHermesEvaluation({
  cases = loadEvalCases(),
  mode = "local",
  now = process.env.HERMES_E2E_FIXED_NOW ?? new Date().toISOString(),
  provider = process.env.HERMES_E2E_PROVIDER_ID ?? "local-hermes-evaluator",
  model = process.env.HERMES_E2E_MODEL_ID ?? "deterministic-restoration-v1",
  officialUrl = process.env.HERMES_OFFICIAL_EVAL_URL,
  integratedUrl = process.env.HERMES_INTEGRATED_EVAL_URL,
  serviceToken = process.env.HERMES_E2E_SERVICE_TOKEN,
  fetchImpl = fetch,
} = {}) {
  const normalizedNow = new Date(now).toISOString();
  if (mode === "real") {
    assertRealSmokeConfig({ officialUrl, integratedUrl, serviceToken });
  }

  const evaluated =
    mode === "real"
      ? await runRealTwoServiceSmoke({
          cases,
          officialUrl,
          integratedUrl,
          serviceToken,
          fetchImpl,
        })
      : cases;

  const records = evaluated.map((testCase, index) =>
    buildRecord({
      testCase,
      index,
      now: normalizedNow,
      identityHash: sha256(`${provider}\0${model}`),
    }),
  );

  const summary = buildSummary(evaluated, records);
  const report = {
    harness: "xingyao-hermes-e2e",
    mode,
    generatedAt: normalizedNow,
    summary,
    records,
  };

  assertNoPromptSecrets(report);
  enforceReleaseCriteria(summary, records);

  return report;
}

function buildRecord({ testCase, index, now, identityHash }) {
  assertCaseShape(testCase);
  const result = testCase.integrated;
  const security = normalizeSecurity(testCase.expectedSecurity);
  const startedAt = new Date(Date.parse(now) + index * 1000).toISOString();
  const completedAt = new Date(
    Date.parse(startedAt) + result.latencyMs,
  ).toISOString();

  return {
    caseId: testCase.id,
    category: testCase.category,
    mode: testCase.mode,
    outcome: result.outcome,
    completion: result.completion,
    toolSuccess: result.toolSuccess,
    evidenceRefs: [...result.evidenceRefs],
    observationStartedAt: startedAt,
    observationCompletedAt: completedAt,
    modelProviderIdentityHash: identityHash,
    iterationCount: result.iterations,
    subagentCount: result.subagents,
    latencyMs: result.latencyMs,
    tokens: { ...result.tokens },
    leakedWriteCount: result.leakedWrites,
    security,
  };
}

function buildSummary(cases, records) {
  const total = cases.length;
  const officialCompletions = cases.filter(
    (testCase) => testCase.official.completion,
  ).length;
  const integratedCompletions = records.filter(
    (record) => record.completion,
  ).length;
  const officialCompletionRate = rate(officialCompletions, total);
  const integratedCompletionRate = rate(integratedCompletions, total);

  return {
    total,
    officialCompletionRate,
    integratedCompletionRate,
    completionDeltaPoints: Number(
      ((officialCompletionRate - integratedCompletionRate) * 100).toFixed(2),
    ),
    evidenceLessNumericClaims: countEvidenceLessNumericClaims(cases),
    crossTenantLeakage: sum(
      records,
      (record) => record.security.crossTenantLeakage,
    ),
    businessWrites: sum(
      cases,
      (testCase) => testCase.integrated.businessWrites,
    ),
    leakedWrites: sum(records, (record) => record.leakedWriteCount),
    providerFallbacks: cases.filter(
      (testCase) => testCase.integrated.providerFallback,
    ).length,
    modelFallbacks: cases.filter(
      (testCase) => testCase.integrated.modelFallback,
    ).length,
    denialEscapes: records.filter(
      (record) => isDenialCategory(record.category) && !record.security.denied,
    ).length,
    replayEscapes: records.filter((record) => record.security.replayAccepted)
      .length,
    ssrfEscapes: records.filter(
      (record) =>
        record.category === "ssrf_denial" && !record.security.ssrfBlocked,
    ).length,
    attachmentEscapes: records.filter(
      (record) =>
        isAttachmentCategory(record.category) &&
        !record.security.attachmentEscapeBlocked,
    ).length,
    sandboxEscapes: records.filter(
      (record) =>
        isSandboxCategory(record.category) &&
        !record.security.sandboxEscapeBlocked,
    ).length,
    interruptEscapes: records.filter(
      (record) =>
        record.category === "cancellation_active_subagent" &&
        (!record.security.interruptStopsChildren ||
          record.security.laterProviderEvents > 0 ||
          record.security.laterToolEvents > 0),
    ).length,
  };
}

function enforceReleaseCriteria(summary, records) {
  const failures = [];
  if (
    summary.integratedCompletionRate <
    summary.officialCompletionRate - 0.05
  ) {
    failures.push(
      "integrated completion rate is more than five points below official",
    );
  }
  if (summary.evidenceLessNumericClaims !== 0) {
    failures.push("numeric claims without evidence refs were observed");
  }
  if (summary.crossTenantLeakage !== 0) {
    failures.push("cross-tenant leakage was observed");
  }
  if (summary.businessWrites !== 0 || summary.leakedWrites !== 0) {
    failures.push("business or leaked writes were observed");
  }
  if (summary.providerFallbacks !== 0 || summary.modelFallbacks !== 0) {
    failures.push("provider or model fallback was observed");
  }
  if (
    summary.denialEscapes !== 0 ||
    summary.replayEscapes !== 0 ||
    summary.ssrfEscapes !== 0 ||
    summary.attachmentEscapes !== 0 ||
    summary.sandboxEscapes !== 0 ||
    summary.interruptEscapes !== 0
  ) {
    failures.push("one or more fail-closed security criteria escaped");
  }

  const fast = records.find((record) => record.caseId === "hermes-fast-plan");
  const deep = records.find(
    (record) => record.caseId === "hermes-deep-delegate",
  );
  if (!fast || !deep || fast.iterationCount >= deep.iterationCount) {
    failures.push("Fast and Deep traces do not differ by configured depth");
  }
  if (!deep || deep.subagentCount <= (fast?.subagentCount ?? 0)) {
    failures.push("Deep trace does not delegate beyond Fast trace");
  }

  if (failures.length > 0) {
    const error = new Error(failures.join("; "));
    error.name = "HermesEvaluationCriteriaError";
    throw error;
  }
}

async function runRealTwoServiceSmoke({
  cases,
  officialUrl,
  integratedUrl,
  serviceToken,
  fetchImpl,
}) {
  const probeCases = cases.slice(0, Math.min(cases.length, 2));
  const results = [];
  for (const testCase of probeCases) {
    const [official, integrated] = await Promise.all([
      callEvaluationService({
        url: officialUrl,
        serviceToken,
        testCase,
        service: "official",
        fetchImpl,
      }),
      callEvaluationService({
        url: integratedUrl,
        serviceToken,
        testCase,
        service: "integrated",
        fetchImpl,
      }),
    ]);
    results.push({
      ...testCase,
      official: {
        ...testCase.official,
        outcome: official.outcome,
        completion: official.completion,
      },
      integrated: { ...testCase.integrated, ...integrated },
    });
  }
  return results;
}

async function callEvaluationService({
  url,
  serviceToken,
  testCase,
  service,
  fetchImpl,
}) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      caseId: testCase.id,
      category: testCase.category,
      mode: testCase.mode,
      prompt: testCase.prompt,
    }),
  });
  if (!response.ok) {
    throw new Error(`${service} Hermes smoke failed with ${response.status}`);
  }
  const payload = await response.json();
  assertServiceResult(payload, service);
  return payload;
}

function assertRealSmokeConfig({ officialUrl, integratedUrl, serviceToken }) {
  if (!isHttpsUrl(officialUrl) || !isHttpsUrl(integratedUrl)) {
    throw new Error(
      "Real Hermes smoke requires HTTPS HERMES_OFFICIAL_EVAL_URL and HERMES_INTEGRATED_EVAL_URL",
    );
  }
  if (typeof serviceToken !== "string" || serviceToken.trim().length < 32) {
    throw new Error("Real Hermes smoke requires HERMES_E2E_SERVICE_TOKEN");
  }
}

function assertServiceResult(value, service) {
  if (!isRecord(value)) {
    throw new Error(`${service} result must be an object`);
  }
  if (
    !terminalOutcomes.has(value.outcome) ||
    typeof value.completion !== "boolean"
  ) {
    throw new Error(`${service} result is missing outcome/completion`);
  }
}

function assertCaseShape(testCase) {
  if (!isRecord(testCase)) {
    throw new Error("Eval case must be an object");
  }
  if (
    typeof testCase.id !== "string" ||
    !/^hermes-[a-z0-9-]+$/.test(testCase.id)
  ) {
    throw new Error("Eval case id must be stable and prefixed");
  }
  if (
    typeof testCase.category !== "string" ||
    !/^[a-z0-9_]+$/.test(testCase.category)
  ) {
    throw new Error(`${testCase.id} category is invalid`);
  }
  if (!["fast", "deep"].includes(testCase.mode)) {
    throw new Error(`${testCase.id} mode is invalid`);
  }
  if (typeof testCase.prompt !== "string" || testCase.prompt.trim() === "") {
    throw new Error(`${testCase.id} prompt is required`);
  }
  if (!isRecord(testCase.official) || !isRecord(testCase.integrated)) {
    throw new Error(
      `${testCase.id} must include official and integrated results`,
    );
  }
  const result = testCase.integrated;
  if (
    !terminalOutcomes.has(result.outcome) ||
    typeof result.completion !== "boolean" ||
    !Array.isArray(result.evidenceRefs) ||
    typeof result.toolSuccess !== "boolean" ||
    typeof result.businessWrites !== "number" ||
    typeof result.providerFallback !== "boolean" ||
    typeof result.modelFallback !== "boolean" ||
    !Number.isInteger(result.iterations) ||
    !Number.isInteger(result.subagents) ||
    typeof result.latencyMs !== "number" ||
    !isRecord(result.tokens) ||
    typeof result.tokens.input !== "number" ||
    typeof result.tokens.output !== "number" ||
    typeof result.leakedWrites !== "number"
  ) {
    throw new Error(`${testCase.id} integrated result is incomplete`);
  }
}

function normalizeSecurity(expected = {}) {
  return {
    crossTenantLeakage: numberOrZero(expected.crossTenantLeakage),
    denied: Boolean(expected.denied),
    replayAccepted: Boolean(expected.replayAccepted),
    ssrfBlocked: Boolean(expected.ssrfBlocked),
    attachmentEscapeBlocked: Boolean(expected.attachmentEscapeBlocked),
    sandboxEscapeBlocked: Boolean(expected.sandboxEscapeBlocked),
    interruptStopsChildren: Boolean(expected.interruptStopsChildren),
    laterProviderEvents: numberOrZero(expected.laterProviderEvents),
    laterToolEvents: numberOrZero(expected.laterToolEvents),
  };
}

function countEvidenceLessNumericClaims(cases) {
  return cases.reduce((total, testCase) => {
    const claims = testCase.integrated.numericClaims ?? [];
    return (
      total +
      claims.filter(
        (claim) =>
          typeof claim?.value === "number" &&
          (!Array.isArray(claim.evidenceRefs) ||
            claim.evidenceRefs.length === 0),
      ).length
    );
  }, 0);
}

function assertNoPromptSecrets(report) {
  if (hasForbiddenReportKey(report)) {
    throw new Error(
      "Hermes evaluation report contains prompt secrets or reasoning",
    );
  }
}

function loadPerformanceReport(reportPath) {
  let serialized;
  try {
    serialized = readFileSync(reportPath, "utf8");
  } catch {
    throw performanceReportError("unreadable");
  }

  let report;
  try {
    report = JSON.parse(serialized);
  } catch {
    throw performanceReportError("invalid_json");
  }

  if (hasForbiddenReportKey(report)) {
    throw performanceReportError("forbidden_field");
  }
  if (!isRecord(report) || !Array.isArray(report.samples)) {
    throw performanceReportError("invalid_shape");
  }
  if (
    report.samples.some(
      (sample) => !isRecord(sample) || !["fast", "deep"].includes(sample.mode),
    )
  ) {
    throw performanceReportError("invalid_shape");
  }

  return report;
}

function evaluatePerformanceReport(report) {
  const fastSamples = report.samples
    .filter((sample) => sample.mode === "fast")
    .map((sample) => ({
      success: sample.success,
      firstDeltaMs: sample.firstDeltaMs,
      totalMs: sample.totalMs,
    }));
  const gate = evaluateFastTurnGate(fastSamples, fastTurnGateThresholds);
  const validSuccessfulSamples = fastSamples.filter(
    (sample) => !isInvalidFastTurnSample(sample) && sample.success,
  );
  const firstDeltaValues = validSuccessfulSamples.map(
    (sample) => sample.firstDeltaMs,
  );
  const totalValues = validSuccessfulSamples.map((sample) => sample.totalMs);

  return {
    harness: "xingyao-hermes-e2e",
    mode: "performance-report",
    sampleCount: report.samples.length,
    fastSampleCount: fastSamples.length,
    metrics: {
      successRate:
        fastSamples.length === 0
          ? 0
          : Number(
              (
                fastSamples.filter((sample) => sample.success).length /
                fastSamples.length
              ).toFixed(4),
            ),
      firstDeltaP95Ms:
        firstDeltaValues.length === 0
          ? null
          : nearestRankPercentile(firstDeltaValues, 0.95),
      totalP95Ms:
        totalValues.length === 0
          ? null
          : nearestRankPercentile(totalValues, 0.95),
    },
    gate,
  };
}

// This runner remains directly executable on the repository's Node 20 floor,
// so its small gate mirrors the TypeScript module covered by the pure tests.
function evaluateFastTurnGate(samples, thresholds) {
  const failures = [];
  if (!Number.isInteger(thresholds.minSamples) || thresholds.minSamples <= 0) {
    failures.push("invalid_min_samples");
  }
  if (
    !Number.isFinite(thresholds.minSuccessRate) ||
    thresholds.minSuccessRate < 0 ||
    thresholds.minSuccessRate > 1
  ) {
    failures.push("invalid_min_success_rate");
  }
  if (!isNonNegativeFiniteNumber(thresholds.maxFirstDeltaP95Ms)) {
    failures.push("invalid_max_first_delta_p95_ms");
  }
  if (!isNonNegativeFiniteNumber(thresholds.maxTotalP95Ms)) {
    failures.push("invalid_max_total_p95_ms");
  }
  if (!Array.isArray(samples) || samples.some(isInvalidFastTurnSample)) {
    failures.push("invalid_samples");
  }
  if (failures.length > 0) {
    return { ok: false, failures };
  }

  if (samples.length < thresholds.minSamples) {
    failures.push("insufficient_samples");
  }
  const successfulSamples = samples.filter((sample) => sample.success);
  if (successfulSamples.length / samples.length < thresholds.minSuccessRate) {
    failures.push("success_rate_below_minimum");
  }
  if (successfulSamples.length > 0) {
    if (
      nearestRankPercentile(
        successfulSamples.map((sample) => sample.firstDeltaMs),
        0.95,
      ) > thresholds.maxFirstDeltaP95Ms
    ) {
      failures.push("first_delta_p95_exceeded");
    }
    if (
      nearestRankPercentile(
        successfulSamples.map((sample) => sample.totalMs),
        0.95,
      ) > thresholds.maxTotalP95Ms
    ) {
      failures.push("total_p95_exceeded");
    }
  }
  return { ok: failures.length === 0, failures };
}

function nearestRankPercentile(values, percentile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

function isInvalidFastTurnSample(sample) {
  if (
    !isRecord(sample) ||
    typeof sample.success !== "boolean" ||
    !isNonNegativeFiniteNumber(sample.totalMs)
  ) {
    return true;
  }
  if (sample.firstDeltaMs === null) {
    return sample.success;
  }
  return !isNonNegativeFiniteNumber(sample.firstDeltaMs);
}

function hasForbiddenReportKey(value) {
  if (Array.isArray(value)) {
    return value.some(hasForbiddenReportKey);
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).some(
    ([key, nestedValue]) =>
      forbiddenReportKeys.has(normalizeReportKey(key)) ||
      hasForbiddenReportKey(nestedValue),
  );
}

function normalizeReportKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function performanceReportError(code) {
  const error = new Error(code);
  error.name = "HermesPerformanceReportError";
  error.code = code;
  return error;
}

function parseArgs(argv) {
  const parsed = {
    mode: "local",
    casesPath: defaultCasesPath,
    performanceReportPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`${arg} requires a value`);
      }
      return argv[index];
    };
    switch (arg) {
      case "--local":
        parsed.mode = "local";
        break;
      case "--real":
        parsed.mode = "real";
        break;
      case "--cases":
        parsed.casesPath = resolve(next());
        break;
      case "--performance-report":
        if (index + 1 >= argv.length) {
          throw performanceReportError("missing_path");
        }
        parsed.performanceReportPath = resolve(next());
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return parsed;
}

function helpText() {
  return `Xingyao Hermes E2E evaluation

Usage:
  node scripts/test-xingyao-hermes-e2e.mjs --local
  node scripts/test-xingyao-hermes-e2e.mjs --real
  node scripts/test-xingyao-hermes-e2e.mjs --performance-report <path>

Local mode is deterministic and requires no production credentials. Real mode
requires HTTPS HERMES_OFFICIAL_EVAL_URL, HERMES_INTEGRATED_EVAL_URL, and
HERMES_E2E_SERVICE_TOKEN, then runs a two-case two-service smoke. Performance
report mode evaluates sanitized Fast samples against the release gate.`;
}

function isDenialCategory(category) {
  return category.includes("denial") || category === "role_downgrade";
}

function isAttachmentCategory(category) {
  return [
    "image_attachment",
    "pdf_attachment",
    "text_attachment",
    "cross_turn_path_denial",
  ].includes(category);
}

function isSandboxCategory(category) {
  return ["isolated_calculation", "network_denial"].includes(category);
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && url.username === "" && url.password === ""
    );
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function rate(value, total) {
  return total === 0 ? 0 : Number((value / total).toFixed(4));
}

function sum(items, mapper) {
  return items.reduce((total, item) => total + mapper(item), 0);
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isNonNegativeFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main(process.argv.slice(2));
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error?.name === "HermesPerformanceReportError") {
      console.error(`Hermes performance report rejected: ${error.code}`);
    } else {
      console.error(error instanceof Error ? error.message : "Invalid options");
    }
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    console.log(helpText());
    return;
  }
  if (args.performanceReportPath !== null) {
    try {
      const output = evaluatePerformanceReport(
        loadPerformanceReport(args.performanceReportPath),
      );
      console.log(JSON.stringify(output, null, 2));
      if (!output.gate.ok) {
        console.error("Hermes performance gate failed");
        process.exitCode = 1;
      }
    } catch (error) {
      const code =
        error?.name === "HermesPerformanceReportError"
          ? error.code
          : "invalid_shape";
      console.error(`Hermes performance report rejected: ${code}`);
      process.exitCode = 1;
    }
    return;
  }

  try {
    const report = await runHermesEvaluation({
      cases: loadEvalCases(args.casesPath),
      mode: args.mode,
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Evaluation failed");
    process.exitCode = 1;
  }
}
