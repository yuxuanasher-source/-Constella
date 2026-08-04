#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, win32 as pathWin32 } from "node:path";
import { fileURLToPath } from "node:url";

const localHostnames = new Set(["127.0.0.1", "::1", "localhost"]);
const containerPattern = /^supabase_db_[A-Za-z0-9_.-]+$/;
const projectPattern = /^[A-Za-z0-9_.-]+$/;
const dockerContextPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const localDockerEndpointPattern = /^(?:npipe|unix):\/\//;

export function parseResilienceArgs(argv) {
  const parsed = {
    appUrl: "http://127.0.0.1:3000",
    dbContainer: process.env.HERMES_RESILIENCE_DB_CONTAINER ?? "",
    dbProject: process.env.HERMES_RESILIENCE_SUPABASE_PROJECT ?? "",
    gatewayWorktree: process.env.XINGYAO_HERMES_GATEWAY_WORKTREE ?? "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      const value = argv[index];
      if (!value) throw new Error(`missing_value:${arg}`);
      return value;
    };

    switch (arg) {
      case "--app-url":
        parsed.appUrl = next();
        break;
      case "--local-db-container":
        parsed.dbContainer = next();
        break;
      case "--local-supabase-project":
        parsed.dbProject = next();
        break;
      case "--gateway-worktree":
        parsed.gatewayWorktree = next();
        break;
      case "--help":
        parsed.help = true;
        break;
      default:
        throw new Error(`unknown_option:${arg}`);
    }
  }

  if (parsed.help) return parsed;

  let appUrl;
  try {
    appUrl = new URL(parsed.appUrl);
  } catch {
    throw new Error("invalid_app_url");
  }
  if (!localHostnames.has(appUrl.hostname)) {
    throw new Error("remote_app_url_refused");
  }
  if (!containerPattern.test(parsed.dbContainer)) {
    throw new Error("invalid_local_db_container");
  }
  if (!projectPattern.test(parsed.dbProject)) {
    throw new Error("invalid_local_supabase_project");
  }

  return parsed;
}

export function buildResilienceGates({ dbContainer, gatewayWorktree = "" }) {
  if (!containerPattern.test(dbContainer)) {
    throw new Error("invalid_local_db_container");
  }

  const pnpm = resolvePnpmInvocation();
  const gates = [
    {
      name: "postgres_recovery_and_memory",
      command: pnpm.command,
      args: [
        ...pnpm.argsPrefix,
        "exec",
        "vitest",
        "run",
        "lib/db/xingyao-hermes-native-schema-contract.test.ts",
      ],
      env: {
        HERMES_STRUCTURED_MEMORY_DB_REGRESSION_CONTAINER: dbContainer,
        HERMES_TURN_RECOVERY_DB_REGRESSION_CONTAINER: dbContainer,
      },
      evidence: "real_local_postgres",
    },
    {
      name: "product_turn_recovery",
      command: pnpm.command,
      args: [
        ...pnpm.argsPrefix,
        "exec",
        "vitest",
        "run",
        "features/ai/conversation-stream-adapter.test.ts",
        "features/ai/native-assistant/context-engine.test.ts",
        "features/ai/native-assistant/token-budget.test.ts",
        "features/ai/native-assistant/gateway-executor.test.ts",
        "app/api/ai/conversations/[conversationId]/turns/[turnId]/status/route.test.ts",
        "app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.test.ts",
        "app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.test.ts",
      ],
      evidence: "real_product_modules",
    },
    {
      name: "browser_reattach_and_batching",
      command: pnpm.command,
      args: [
        ...pnpm.argsPrefix,
        "exec",
        "vitest",
        "run",
        "features/ai/conversation-stream-buffer.test.ts",
        "components/dashboard/overview-board.test.jsx",
      ],
      evidence: "real_browser_components",
    },
  ];

  if (gatewayWorktree) {
    gates.push({
      name: "gateway_session_lifecycle",
      command: process.platform === "win32" ? "uv.exe" : "uv",
      args: [
        "run",
        "pytest",
        "-q",
        "tests/xingyao/test_gateway_session_binding.py",
        "tests/xingyao/test_gateway_ws_transport.py",
        "tests/xingyao/test_gateway_protocol.py",
        "tests/gateway/test_agent_cache.py",
        "tests/test_tui_gateway_server.py",
      ],
      cwd: gatewayWorktree,
      evidence: "real_gateway_pytest",
    });
  }

  return gates;
}

export function assertLocalDockerEndpoint({
  spawnSyncImpl = spawnSync,
  env = process.env,
} = {}) {
  const explicitContext = env.DOCKER_CONTEXT?.trim();
  const explicitEndpoint = env.DOCKER_HOST?.trim();
  if (!explicitContext && explicitEndpoint) {
    if (!localDockerEndpointPattern.test(explicitEndpoint)) {
      throw new Error("remote_docker_endpoint_refused");
    }
    return explicitEndpoint;
  }

  if (explicitContext && !dockerContextPattern.test(explicitContext)) {
    throw new Error("invalid_docker_context");
  }

  const result = spawnSyncImpl(
    "docker",
    [
      "context",
      "inspect",
      ...(explicitContext ? [explicitContext] : []),
      "--format",
      "{{json .Endpoints.docker.Host}}",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.error || result.status !== 0) {
    throw new Error("docker_context_unavailable");
  }

  let endpoint;
  try {
    endpoint = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("docker_context_invalid");
  }
  if (
    typeof endpoint !== "string" ||
    !localDockerEndpointPattern.test(endpoint)
  ) {
    throw new Error("remote_docker_endpoint_refused");
  }
  return endpoint;
}

export function assertLocalDatabaseContainer({
  container,
  expectedProject,
  spawnSyncImpl = spawnSync,
}) {
  if (
    !containerPattern.test(container) ||
    !projectPattern.test(expectedProject)
  ) {
    throw new Error("local_database_identity_invalid");
  }

  const result = spawnSyncImpl(
    "docker",
    ["inspect", container, "--format", "{{json .Config.Labels}}"],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.error || result.status !== 0) {
    throw new Error("local_database_identity_unavailable");
  }

  let labels;
  try {
    labels = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("local_database_identity_invalid");
  }
  if (
    labels?.["com.supabase.cli.project"] !== expectedProject ||
    labels?.["com.docker.compose.project"] !== expectedProject
  ) {
    throw new Error("local_database_identity_mismatch");
  }
  return expectedProject;
}

export function resolvePnpmInvocation({
  platform = process.platform,
  env = process.env,
  existsSyncImpl = existsSync,
  nodeExecutable = process.execPath,
} = {}) {
  if (platform !== "win32") {
    return { command: "pnpm", argsPrefix: [] };
  }

  const candidates = [
    env.npm_execpath,
    env.APPDATA
      ? pathWin32.join(
          env.APPDATA,
          "npm",
          "node_modules",
          "pnpm",
          "bin",
          "pnpm.cjs",
        )
      : "",
  ].filter(Boolean);
  const pnpmCli = candidates.find((candidate) => existsSyncImpl(candidate));
  if (!pnpmCli) throw new Error("pnpm_cli_not_found");

  return { command: nodeExecutable, argsPrefix: [pnpmCli] };
}

export function runResilienceGates(
  gates,
  { spawnSyncImpl = spawnSync, logger = console } = {},
) {
  const completed = [];
  for (const gate of gates) {
    logger.log(
      `RESILIENCE_GATE_START name=${gate.name} evidence=${gate.evidence}`,
    );
    const result = spawnSyncImpl(gate.command, gate.args, {
      cwd: gate.cwd ?? process.cwd(),
      env: { ...process.env, ...gate.env },
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) {
      throw new Error(
        `resilience_gate_spawn_failed:${gate.name}:${result.error.code ?? result.error.message}`,
      );
    }
    const status = result.status ?? 1;
    if (status !== 0) {
      throw new Error(`resilience_gate_failed:${gate.name}:${status}`);
    }
    completed.push({ name: gate.name, evidence: gate.evidence });
    logger.log(
      `RESILIENCE_GATE_OK name=${gate.name} evidence=${gate.evidence}`,
    );
  }
  return completed;
}

function helpText() {
  return `AI conversation resilience contract gate

Usage:
  node scripts/test-ai-conversation-resilience.mjs \\
    --local-db-container supabase_db_<project> \\
    --local-supabase-project <project> \\
    [--gateway-worktree <local-path>]

The command accepts localhost application URLs only. It executes real Product,
PostgreSQL, browser-component, and optional Gateway suites. It does not create
synthetic performance samples or claim production restart/canary evidence.`;
}

function main(argv) {
  const options = parseResilienceArgs(argv);
  if (options.help) {
    console.log(helpText());
    return;
  }
  assertLocalDockerEndpoint();
  assertLocalDatabaseContainer({
    container: options.dbContainer,
    expectedProject: options.dbProject,
  });
  const gates = buildResilienceGates(options);
  const completed = runResilienceGates(gates);
  console.log(
    `AI_CONVERSATION_RESILIENCE_CONTRACT_OK gates=${completed.length} gateway=${Boolean(options.gatewayWorktree)}`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
