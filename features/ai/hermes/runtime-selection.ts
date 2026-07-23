import {
  HERMES_PROFILE_VERSION,
  HERMES_PROTOCOL_VERSION,
  LEGACY_HERMES_PROFILE_VERSION,
  isUuid,
} from "./contracts";

export const LEGACY_HERMES_PROTOCOL_VERSION = "xingyao-legacy-chat-v1";

export type HermesRuntimeSelectionEnv = {
  XINGYAO_HERMES_GATEWAY_ENABLED: boolean;
  XINGYAO_HERMES_GATEWAY_ALLOWLIST: string;
  XINGYAO_HERMES_GATEWAY_BASE_URL: string | null;
  XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN: string | null;
  XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: boolean;
};

export type HermesRuntimeAllowlistEntry = {
  organizationId: string;
  userId: string | "*";
};

export type HermesRuntimeSelectionConfig = HermesRuntimeSelectionEnv & {
  gatewayAllowlistEntries: HermesRuntimeAllowlistEntry[];
};

export type SelectedHermesRuntime = {
  kind: "selected";
  runtime: "gateway" | "legacy";
  protocol: string;
  profile: string;
};

export type HermesRuntimeSelectionFailure = {
  kind: "failure";
  code: "runtime_disabled";
  status: 503;
};

export type HermesRuntimeSelection =
  | SelectedHermesRuntime
  | HermesRuntimeSelectionFailure;

export type HermesRuntimeHealth = {
  gatewayEnabled: boolean;
  gatewayConfigured: boolean;
  gatewayAllowlistConfigured: boolean;
  legacyEnabled: boolean;
  compatibilityStatus:
    | "gateway_v2_ready"
    | "legacy_ready"
    | "runtime_disabled"
    | "configuration_error";
};

export class HermesRuntimeSelectionConfigError extends Error {
  readonly code = "runtime_configuration_invalid";

  constructor(message = "Hermes runtime configuration is invalid") {
    super(message);
    this.name = "HermesRuntimeSelectionConfigError";
  }
}

export function parseHermesRuntimeSelectionConfig(
  env: Record<string, string | undefined>,
): HermesRuntimeSelectionConfig {
  const gatewayEnabled = parseStrictBoolean(
    env.XINGYAO_HERMES_GATEWAY_ENABLED,
    "XINGYAO_HERMES_GATEWAY_ENABLED",
  );
  const legacyEnabled = parseStrictBoolean(
    env.XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED,
    "XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED",
  );
  const allowlist = normalizeOptionalString(
    env.XINGYAO_HERMES_GATEWAY_ALLOWLIST,
  );
  const gatewayAllowlistEntries = parseGatewayAllowlist(allowlist);
  const baseUrl = parseGatewayBaseUrl(env.XINGYAO_HERMES_GATEWAY_BASE_URL);
  const serviceToken = parseGatewayServiceToken(
    env.XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN,
  );

  if (gatewayEnabled && (!baseUrl || !serviceToken)) {
    throw new HermesRuntimeSelectionConfigError();
  }

  return {
    XINGYAO_HERMES_GATEWAY_ENABLED: gatewayEnabled,
    XINGYAO_HERMES_GATEWAY_ALLOWLIST: allowlist,
    XINGYAO_HERMES_GATEWAY_BASE_URL: baseUrl,
    XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN: serviceToken,
    XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: legacyEnabled,
    gatewayAllowlistEntries,
  };
}

export function selectHermesRuntime(
  config: HermesRuntimeSelectionConfig,
  actor: { organizationId: string; userId: string },
): HermesRuntimeSelection {
  if (
    config.XINGYAO_HERMES_GATEWAY_ENABLED &&
    isActorGatewayAllowlisted(config.gatewayAllowlistEntries, actor)
  ) {
    return {
      kind: "selected",
      runtime: "gateway",
      protocol: HERMES_PROTOCOL_VERSION,
      profile: HERMES_PROFILE_VERSION,
    };
  }

  if (config.XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED) {
    return {
      kind: "selected",
      runtime: "legacy",
      protocol: LEGACY_HERMES_PROTOCOL_VERSION,
      profile: LEGACY_HERMES_PROFILE_VERSION,
    };
  }

  return {
    kind: "failure",
    code: "runtime_disabled",
    status: 503,
  };
}

export function summarizeHermesRuntimeHealth(
  config: HermesRuntimeSelectionConfig,
): HermesRuntimeHealth {
  const gatewayConfigured =
    !!config.XINGYAO_HERMES_GATEWAY_BASE_URL &&
    !!config.XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN;
  return {
    gatewayEnabled: config.XINGYAO_HERMES_GATEWAY_ENABLED,
    gatewayConfigured,
    gatewayAllowlistConfigured: config.gatewayAllowlistEntries.length > 0,
    legacyEnabled: config.XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED,
    compatibilityStatus:
      config.XINGYAO_HERMES_GATEWAY_ENABLED &&
      gatewayConfigured &&
      config.gatewayAllowlistEntries.length > 0
        ? "gateway_v2_ready"
        : config.XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED
          ? "legacy_ready"
          : "runtime_disabled",
  };
}

export function hermesRuntimeConfigurationErrorHealth(): HermesRuntimeHealth {
  return {
    gatewayEnabled: false,
    gatewayConfigured: false,
    gatewayAllowlistConfigured: false,
    legacyEnabled: false,
    compatibilityStatus: "configuration_error",
  };
}

function parseStrictBoolean(
  raw: string | undefined,
  name: string,
): boolean {
  const normalized = raw?.trim();
  if (!normalized) return false;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new HermesRuntimeSelectionConfigError(`${name} must be true or false`);
}

function parseGatewayAllowlist(raw: string): HermesRuntimeAllowlistEntry[] {
  if (!raw) return [];
  return raw.split(",").map((part) => {
    const item = part.trim();
    const [organizationId, userId, ...extra] = item.split("/");
    if (
      extra.length > 0 ||
      !organizationId ||
      !userId ||
      !isUuid(organizationId) ||
      (userId !== "*" && !isUuid(userId))
    ) {
      throw new HermesRuntimeSelectionConfigError();
    }
    return { organizationId, userId };
  });
}

function parseGatewayBaseUrl(raw: string | undefined): string | null {
  const normalized = normalizeOptionalString(raw);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (
      !["http:", "https:", "ws:", "wss:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      throw new HermesRuntimeSelectionConfigError();
    }
    return url.href.endsWith("/") ? url.href.slice(0, -1) : url.href;
  } catch (error) {
    if (error instanceof HermesRuntimeSelectionConfigError) throw error;
    throw new HermesRuntimeSelectionConfigError();
  }
}

function parseGatewayServiceToken(raw: string | undefined): string | null {
  const normalized = normalizeOptionalString(raw);
  if (!normalized) return null;
  if (normalized.length < 32) {
    throw new HermesRuntimeSelectionConfigError();
  }
  return normalized;
}

function normalizeOptionalString(raw: string | undefined): string {
  return raw?.trim() ?? "";
}

function isActorGatewayAllowlisted(
  entries: HermesRuntimeAllowlistEntry[],
  actor: { organizationId: string; userId: string },
): boolean {
  return entries.some(
    (entry) =>
      entry.organizationId === actor.organizationId &&
      (entry.userId === "*" || entry.userId === actor.userId),
  );
}
