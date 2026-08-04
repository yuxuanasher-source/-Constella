import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createGatewayTurnExecutorMock,
  createHermesGatewayClientMock,
  createLegacyTurnExecutorMock,
} = vi.hoisted(() => ({
  createGatewayTurnExecutorMock: vi.fn(),
  createHermesGatewayClientMock: vi.fn(),
  createLegacyTurnExecutorMock: vi.fn(),
}));

vi.mock("@/features/ai/native-assistant/gateway-executor", () => ({
  createGatewayTurnExecutor: createGatewayTurnExecutorMock,
  createHermesGatewayClient: createHermesGatewayClientMock,
}));

vi.mock("@/features/ai/native-assistant/legacy-turn-executor", () => ({
  createLegacyTurnExecutor: createLegacyTurnExecutorMock,
}));

import { createSelectedNativeTurnExecutor } from "./native-turn-runtime";

describe("native turn runtime", () => {
  beforeEach(() => {
    createGatewayTurnExecutorMock.mockReset();
    createHermesGatewayClientMock.mockReset();
    createLegacyTurnExecutorMock.mockReset();
    createHermesGatewayClientMock.mockReturnValue({
      createSession: vi.fn(),
      submitPrompt: vi.fn(),
    });
    createGatewayTurnExecutorMock.mockReturnValue({
      runtime: "gateway",
      execute: vi.fn(),
    });
  });

  it("constructs the production Gateway client with the approved timeouts", () => {
    createSelectedNativeTurnExecutor({
      selected: {
        kind: "selected",
        runtimeConfig: {
          XINGYAO_HERMES_GATEWAY_ENABLED: true,
          XINGYAO_HERMES_GATEWAY_ALLOWLIST: "",
          XINGYAO_HERMES_GATEWAY_BASE_URL: "ws://127.0.0.1:8788",
          XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN:
            "gateway-service-token-that-is-long-enough",
          XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: true,
          gatewayAllowlistEntries: [],
        },
        selection: {
          kind: "selected",
          runtime: "gateway",
          protocol: "xingyao-hermes-gateway-v2",
          profile: "hermes-xingyao-v2",
        },
        runtimeOption: {
          runtimeSelection: {
            runtime: "gateway",
            protocol: "xingyao-hermes-gateway-v2",
            profile: "hermes-xingyao-v2",
          },
        },
      },
      service: {} as never,
      auth: {
        userId: "11111111-1111-4111-8111-111111111111",
        organizationId: "22222222-2222-4222-8222-222222222222",
        role: "finance",
      },
    });

    expect(createHermesGatewayClientMock).toHaveBeenCalledWith({
      config: {
        url: "ws://127.0.0.1:8788",
        serviceToken: "gateway-service-token-that-is-long-enough",
        timeouts: {
          connectMs: 2_000,
          readyMs: 2_000,
          rpcMs: 15_000,
          idleMs: 180_000,
          heartbeatMs: 30_000,
        },
      },
    });
  });
});
