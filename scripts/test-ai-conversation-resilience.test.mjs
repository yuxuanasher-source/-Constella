import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  assertLocalDatabaseContainer,
  assertLocalDockerEndpoint,
  buildResilienceGates,
  parseResilienceArgs,
  resolvePnpmInvocation,
  runResilienceGates,
} from "./test-ai-conversation-resilience.mjs";

describe("AI conversation resilience gate", () => {
  it("is exposed as a package gate without supplying a production target", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    expect(packageJson.scripts["test:ai-resilience"]).toBe(
      "vitest run scripts/test-ai-conversation-resilience.test.mjs && node scripts/test-ai-conversation-resilience.mjs",
    );
  });

  it("documents contract evidence separately from production canary evidence", () => {
    const runbook = readFileSync(
      "docs/runbooks/ai-conversation-performance-rollout.md",
      "utf8",
    );
    const normalizedRunbook = runbook.replace(/\s+/g, " ");

    expect(runbook).toContain("CONTRACT_ONLY_NOT_PRODUCTION_CANARY");
    expect(runbook).toContain("XINGYAO_HERMES_GATEWAY_ENABLED=false");
    expect(runbook).toContain("XINGYAO_HERMES_GATEWAY_ALLOWLIST=");
    expect(runbook).toContain("No per-phase runtime flags exist");
    expect(runbook).toContain("duplicate submit count is not yet persisted");
    expect(runbook).toContain("outcome = 'complete'");
    expect(runbook).toContain("independent of the 24-hour SLO window");
    expect(normalizedRunbook).toContain(
      "production tenant/capability violation count is not yet persisted",
    );
  });

  it("builds gates from real Product, PostgreSQL, browser, and optional Gateway suites", () => {
    const gates = buildResilienceGates({
      dbContainer: "supabase_db_jingying-cabin",
      gatewayWorktree: "C:/work/xingyao-hermes-agent",
    });

    expect(gates.map((gate) => gate.name)).toEqual([
      "postgres_recovery_and_memory",
      "product_turn_recovery",
      "browser_reattach_and_batching",
      "gateway_session_lifecycle",
    ]);
    expect(gates[0]).toMatchObject({
      evidence: "real_local_postgres",
      env: {
        HERMES_STRUCTURED_MEMORY_DB_REGRESSION_CONTAINER:
          "supabase_db_jingying-cabin",
        HERMES_TURN_RECOVERY_DB_REGRESSION_CONTAINER:
          "supabase_db_jingying-cabin",
      },
    });
    expect(gates[0].args.join(" ")).toContain(
      "lib/db/xingyao-hermes-native-schema-contract.test.ts",
    );
    expect(gates[1].args.join(" ")).toContain(
      "features/ai/native-assistant/gateway-executor.test.ts",
    );
    expect(gates[1].args.join(" ")).toContain(
      "turns/[turnId]/status/route.test.ts",
    );
    expect(gates[2].args.join(" ")).toContain(
      "components/dashboard/overview-board.test.jsx",
    );
    expect(gates[3]).toMatchObject({
      evidence: "real_gateway_pytest",
      cwd: "C:/work/xingyao-hermes-agent",
    });
    expect(gates[3].args).toContain("tests/gateway/test_agent_cache.py");
  });

  it("keeps Product-only evidence explicit when no Gateway worktree is supplied", () => {
    const gates = buildResilienceGates({
      dbContainer: "supabase_db_jingying-cabin",
    });

    expect(gates).toHaveLength(3);
    expect(gates.some((gate) => gate.name.includes("gateway"))).toBe(false);
  });

  it("invokes the pnpm JavaScript entrypoint directly on Windows", () => {
    const invocation = resolvePnpmInvocation({
      platform: "win32",
      env: { APPDATA: "C:/Users/test/AppData/Roaming" },
      existsSyncImpl: (path) =>
        path ===
        "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs",
      nodeExecutable: "C:/node/node.exe",
    });

    expect(invocation).toEqual({
      command: "C:/node/node.exe",
      argsPrefix: [
        "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs",
      ],
    });
  });

  it("rejects remote targets and unsafe container names", () => {
    expect(() =>
      parseResilienceArgs([
        "--local-db-container",
        "supabase_db_jingying-cabin",
        "--app-url",
        "https://production.example.com",
      ]),
    ).toThrow("remote_app_url_refused");
    expect(() =>
      parseResilienceArgs([
        "--local-db-container",
        "supabase-db; docker rm -f important",
      ]),
    ).toThrow("invalid_local_db_container");
  });

  it("rejects a remote Docker daemon before touching a named container", () => {
    expect(() =>
      assertLocalDockerEndpoint({
        spawnSyncImpl: vi.fn().mockReturnValue({
          status: 0,
          stdout: '"tcp://10.0.0.8:2376"\n',
        }),
      }),
    ).toThrow("remote_docker_endpoint_refused");

    expect(
      assertLocalDockerEndpoint({
        spawnSyncImpl: vi.fn().mockReturnValue({
          status: 0,
          stdout: '"npipe:////./pipe/docker_engine"\n',
        }),
      }),
    ).toBe("npipe:////./pipe/docker_engine");
  });

  it("honors DOCKER_CONTEXT precedence over a local-looking DOCKER_HOST", () => {
    const spawnSyncImpl = vi.fn().mockReturnValue({
      status: 0,
      stdout: '"tcp://10.0.0.8:2376"\n',
    });

    expect(() =>
      assertLocalDockerEndpoint({
        env: {
          DOCKER_HOST: "npipe:////./pipe/docker_engine",
          DOCKER_CONTEXT: "remote-production",
        },
        spawnSyncImpl,
      }),
    ).toThrow("remote_docker_endpoint_refused");
    expect(spawnSyncImpl).toHaveBeenCalledWith(
      "docker",
      [
        "context",
        "inspect",
        "remote-production",
        "--format",
        "{{json .Endpoints.docker.Host}}",
      ],
      { encoding: "utf8", windowsHide: true },
    );
  });

  it("requires the named container to match an explicit Supabase CLI project", () => {
    const spawnSyncImpl = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        "com.docker.compose.project": "jingying-cabin",
        "com.supabase.cli.project": "jingying-cabin",
      }),
    });

    expect(
      assertLocalDatabaseContainer({
        container: "supabase_db_jingying-cabin",
        expectedProject: "jingying-cabin",
        spawnSyncImpl,
      }),
    ).toBe("jingying-cabin");
    expect(() =>
      assertLocalDatabaseContainer({
        container: "supabase_db_jingying-cabin",
        expectedProject: "production",
        spawnSyncImpl,
      }),
    ).toThrow("local_database_identity_mismatch");
  });

  it("runs every real gate and stops at the first failure", () => {
    const spawnSyncImpl = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 7 });
    const gates = [
      { name: "one", command: "one", args: [], evidence: "real" },
      { name: "two", command: "two", args: [], evidence: "real" },
      { name: "three", command: "three", args: [], evidence: "real" },
    ];

    expect(() => runResilienceGates(gates, { spawnSyncImpl })).toThrow(
      "resilience_gate_failed:two:7",
    );
    expect(spawnSyncImpl).toHaveBeenCalledTimes(2);
  });
});
