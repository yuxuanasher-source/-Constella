import { describe, expect, it } from "vitest";

import {
  HermesRuntimeSelectionConfigError,
  parseHermesRuntimeSelectionConfig,
  selectHermesRuntime,
  summarizeHermesRuntimeHealth,
} from "./runtime-selection";
import {
  HERMES_PROFILE_VERSION,
  HERMES_PROTOCOL_VERSION,
  LEGACY_HERMES_PROFILE_VERSION,
} from "./contracts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const otherUserId = "33333333-3333-4333-8333-333333333333";
const baseEnv = {
  XINGYAO_HERMES_GATEWAY_BASE_URL: "ws://127.0.0.1:8788",
  XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN:
    "gateway-service-token-that-is-long-enough",
};

describe("Hermes runtime selection", () => {
  it("selects Gateway v2 for an allowlisted actor without a same-turn legacy fallback", () => {
    const config = parseHermesRuntimeSelectionConfig({
      ...baseEnv,
      XINGYAO_HERMES_GATEWAY_ENABLED: "true",
      XINGYAO_HERMES_GATEWAY_ALLOWLIST: `${organizationId}/${userId}`,
      XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: "true",
    });

    expect(
      selectHermesRuntime(config, { organizationId, userId }),
    ).toEqual({
      kind: "selected",
      runtime: "gateway",
      protocol: HERMES_PROTOCOL_VERSION,
      profile: HERMES_PROFILE_VERSION,
    });
  });

  it("supports organization-wide Gateway allowlist entries", () => {
    const config = parseHermesRuntimeSelectionConfig({
      ...baseEnv,
      XINGYAO_HERMES_GATEWAY_ENABLED: "true",
      XINGYAO_HERMES_GATEWAY_ALLOWLIST: `${organizationId}/*`,
      XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: "false",
    });

    expect(
      selectHermesRuntime(config, { organizationId, userId: otherUserId }),
    ).toMatchObject({ kind: "selected", runtime: "gateway" });
  });

  it("uses Legacy only when Gateway is disabled and the Legacy flag is enabled", () => {
    const config = parseHermesRuntimeSelectionConfig({
      XINGYAO_HERMES_GATEWAY_ENABLED: "false",
      XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: "true",
    });

    expect(
      selectHermesRuntime(config, { organizationId, userId }),
    ).toEqual({
      kind: "selected",
      runtime: "legacy",
      protocol: "xingyao-legacy-chat-v1",
      profile: LEGACY_HERMES_PROFILE_VERSION,
    });
  });

  it("uses Legacy for non-allowlisted actors only when the Legacy flag is enabled", () => {
    const config = parseHermesRuntimeSelectionConfig({
      ...baseEnv,
      XINGYAO_HERMES_GATEWAY_ENABLED: "true",
      XINGYAO_HERMES_GATEWAY_ALLOWLIST: `${organizationId}/${otherUserId}`,
      XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: "true",
    });

    expect(
      selectHermesRuntime(config, { organizationId, userId }),
    ).toMatchObject({ kind: "selected", runtime: "legacy" });
  });

  it("returns a stable runtime_disabled failure when neither path can run", () => {
    const config = parseHermesRuntimeSelectionConfig({
      XINGYAO_HERMES_GATEWAY_ENABLED: "false",
      XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: "false",
    });

    expect(
      selectHermesRuntime(config, { organizationId, userId }),
    ).toEqual({
      kind: "failure",
      code: "runtime_disabled",
      status: 503,
    });
  });

  it("rejects malformed allowlist entries instead of defaulting open", () => {
    expect(() =>
      parseHermesRuntimeSelectionConfig({
        ...baseEnv,
        XINGYAO_HERMES_GATEWAY_ENABLED: "true",
        XINGYAO_HERMES_GATEWAY_ALLOWLIST: `${organizationId},${organizationId}/not-a-user`,
      }),
    ).toThrow(HermesRuntimeSelectionConfigError);
  });

  it("fails explicitly for enabled Gateway when credentials are missing", () => {
    expect(() =>
      parseHermesRuntimeSelectionConfig({
        XINGYAO_HERMES_GATEWAY_ENABLED: "true",
        XINGYAO_HERMES_GATEWAY_ALLOWLIST: `${organizationId}/${userId}`,
        XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: "true",
      }),
    ).toThrow(HermesRuntimeSelectionConfigError);
  });

  it("summarizes health without URL, token, provider, model, or actor data", () => {
    const health = summarizeHermesRuntimeHealth(
      parseHermesRuntimeSelectionConfig({
        ...baseEnv,
        XINGYAO_HERMES_GATEWAY_ENABLED: "true",
        XINGYAO_HERMES_GATEWAY_ALLOWLIST: `${organizationId}/${userId}`,
        XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: "true",
      }),
    );

    expect(health).toEqual({
      gatewayEnabled: true,
      gatewayConfigured: true,
      gatewayAllowlistConfigured: true,
      legacyEnabled: true,
      compatibilityStatus: "gateway_v2_ready",
    });
    expect(JSON.stringify(health)).not.toContain("127.0.0.1");
    expect(JSON.stringify(health)).not.toContain("gateway-service-token");
    expect(JSON.stringify(health)).not.toContain(organizationId);
    expect(JSON.stringify(health)).not.toContain(userId);
  });
});
