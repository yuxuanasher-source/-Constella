#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");

const sensitiveLabelPattern =
  /(api[_-]?key|authorization|bearer|credential|password|secret|sk-[a-z0-9_-]+|token)/i;

const requiredFields = [
  "productCommit",
  "forkCommit",
  "upstreamTag",
  "upstreamCommit",
  "protocol",
  "profile",
  "modelIdentifier",
  "schemaMigrationSql",
];

function assertNonEmpty(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
}

function assertSafeLabel(value, name) {
  assertNonEmpty(value, name);
  if (sensitiveLabelPattern.test(value)) {
    throw new Error(`${name} must not contain sensitive material`);
  }
}

function assertCommit(value, name) {
  assertNonEmpty(value, name);
  if (!/^[a-f0-9]{40}$/i.test(value)) {
    throw new Error(`${name} must be a 40 character git commit`);
  }
}

function normalizeTestResult(result) {
  assertSafeLabel(result.name, "test result name");
  assertSafeLabel(result.status, "test result status");

  const outputSource =
    result.output ??
    result.content ??
    `${result.name}:${result.status}:${result.outputSha256 ?? ""}`;

  return {
    name: result.name,
    status: result.status,
    outputSha256: result.outputSha256 ?? sha256(outputSource),
  };
}

function normalizeArtifact(artifact) {
  assertSafeLabel(artifact.name, "artifact name");

  const content =
    artifact.content ??
    (artifact.path ? readFileSync(artifact.path, "utf8") : artifact.sha256);
  assertNonEmpty(content, `artifact ${artifact.name} content`);

  return {
    name: artifact.name,
    sha256: artifact.sha256 ?? sha256(content),
  };
}

export function buildReleaseEvidence(input) {
  for (const field of requiredFields) {
    assertNonEmpty(input[field], field);
  }
  assertCommit(input.productCommit, "productCommit");
  assertCommit(input.forkCommit, "forkCommit");
  assertCommit(input.upstreamCommit, "upstreamCommit");
  assertSafeLabel(input.upstreamTag, "upstreamTag");
  assertSafeLabel(input.protocol, "protocol");
  assertSafeLabel(input.profile, "profile");

  const evidence = {
    release: "xingyao-hermes-gateway",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    productCommit: input.productCommit,
    forkCommit: input.forkCommit,
    upstream: {
      tag: input.upstreamTag,
      commit: input.upstreamCommit,
    },
    protocolProfile: {
      protocol: input.protocol,
      profile: input.profile,
    },
    modelIdentifierHash: sha256(input.modelIdentifier),
    schemaMigrationHash: sha256(input.schemaMigrationSql),
    testResults: (input.testResults ?? []).map(normalizeTestResult),
    artifacts: (input.artifacts ?? []).map(normalizeArtifact),
  };

  const serialized = JSON.stringify(evidence);
  if (sensitiveLabelPattern.test(serialized)) {
    throw new Error("release evidence contains sensitive material");
  }

  return evidence;
}

export function writeReleaseEvidence(evidence, outputPath) {
  assertNonEmpty(outputPath, "outputPath");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
}

function parseArgs(argv) {
  const parsed = {
    testResults: [],
    artifacts: [],
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
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--output":
        parsed.output = next();
        break;
      case "--product-commit":
        parsed.productCommit = next();
        break;
      case "--fork-commit":
        parsed.forkCommit = next();
        break;
      case "--upstream-tag":
        parsed.upstreamTag = next();
        break;
      case "--upstream-commit":
        parsed.upstreamCommit = next();
        break;
      case "--protocol":
        parsed.protocol = next();
        break;
      case "--profile":
        parsed.profile = next();
        break;
      case "--model-identifier":
        parsed.modelIdentifier = next();
        break;
      case "--schema-migration-file":
        parsed.schemaMigrationFile = next();
        break;
      case "--schema-migration":
        parsed.schemaMigrationSql = next();
        break;
      case "--test-result": {
        const value = next();
        const [name, statusAndPath] = value.split("=", 2);
        const [status, outputPath] = (statusAndPath ?? "").split(":", 2);
        parsed.testResults.push({
          name,
          status,
          output: outputPath ? readFileSync(outputPath, "utf8") : status,
        });
        break;
      }
      case "--artifact": {
        const value = next();
        const [name, path] = value.split("=", 2);
        parsed.artifacts.push({ name, path });
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function helpText() {
  return `Xingyao Hermes Gateway release evidence

Usage:
  node scripts/verify-xingyao-hermes-release.mjs --output artifacts/xingyao-hermes-release-evidence.json \\
    --product-commit <40-hex> --fork-commit <40-hex> \\
    --upstream-tag <tag> --upstream-commit <40-hex> \\
    --protocol <protocol> --profile <profile> \\
    --model-identifier <identifier> --schema-migration-file <path> \\
    --test-result "pnpm test:ai-system=passed:path/to/output.log" \\
    --artifact "rollback-script=scripts/create-xingyao-hermes-rollback.sh"

Records commits, upstream reference, protocol/profile, hashed model identifier,
hashed schema migration, test-result output hashes, and artifact SHA-256 values.
Raw model identifiers, migration SQL, command output, env files, and credentials
are not written to the evidence file.`;
}

function main(argv) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(helpText());
    return;
  }

  const schemaMigrationSql =
    args.schemaMigrationSql ??
    (args.schemaMigrationFile
      ? readFileSync(args.schemaMigrationFile, "utf8")
      : undefined);

  const missing = requiredFields.filter((field) => {
    if (field === "schemaMigrationSql") {
      return !schemaMigrationSql;
    }
    return !args[field];
  });
  if (missing.length > 0) {
    throw new Error(`Missing required options: ${missing.join(", ")}`);
  }

  const evidence = buildReleaseEvidence({
    ...args,
    schemaMigrationSql,
  });
  const outputPath =
    args.output ?? "artifacts/xingyao-hermes-release-evidence.json";
  writeReleaseEvidence(evidence, outputPath);

  console.log(`Wrote ${outputPath}`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
