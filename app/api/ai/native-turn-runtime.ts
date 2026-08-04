import { NextResponse } from "next/server";

import {
  HermesRuntimeSelectionConfigError,
  parseHermesRuntimeSelectionConfig,
  selectHermesRuntime,
  type HermesRuntimeSelectionConfig,
  type SelectedHermesRuntime,
} from "@/features/ai/hermes/runtime-selection";
import {
  createGatewayTurnExecutor,
  createHermesGatewayClient,
} from "@/features/ai/native-assistant/gateway-executor";
import type { ConversationTurnExecutor } from "@/features/ai/conversation-stream-adapter";
import {
  createLegacyTurnExecutor,
  type LegacyConversationTurnService,
} from "@/features/ai/native-assistant/legacy-turn-executor";
import type { ConversationActor } from "@/features/ai/conversation-service";

type GatewayTurnExecutorOptions = Parameters<
  typeof createGatewayTurnExecutor
>[0];
type NativeTurnService = GatewayTurnExecutorOptions["service"] &
  LegacyConversationTurnService;

export type SelectedNativeTurnRuntime = {
  kind: "selected";
  runtimeConfig: HermesRuntimeSelectionConfig;
  selection: SelectedHermesRuntime;
  runtimeOption: {
    runtimeSelection: {
      runtime: "gateway" | "legacy";
      protocol: string;
      profile: string;
    };
  };
};

export function selectNativeTurnRuntime(
  actor: ConversationActor,
): SelectedNativeTurnRuntime | NextResponse<{ error: string }> {
  let runtimeConfig: HermesRuntimeSelectionConfig;
  try {
    runtimeConfig = parseHermesRuntimeSelectionConfig(process.env);
  } catch (error) {
    if (error instanceof HermesRuntimeSelectionConfigError) {
      return NextResponse.json(
        { error: "runtime_configuration_invalid" },
        { status: 503 },
      );
    }
    throw error;
  }

  const selection = selectHermesRuntime(runtimeConfig, actor);
  if (selection.kind === "failure") {
    return NextResponse.json(
      { error: selection.code },
      { status: selection.status },
    );
  }

  return {
    kind: "selected",
    runtimeConfig,
    selection,
    runtimeOption: {
      runtimeSelection: {
        runtime: selection.runtime,
        protocol: selection.protocol,
        profile: selection.profile,
      },
    },
  };
}

export function createSelectedNativeTurnExecutor({
  selected,
  service,
  auth,
  sourceTurnId,
}: {
  selected: SelectedNativeTurnRuntime;
  service: NativeTurnService;
  auth: {
    userId: string;
    organizationId: string;
    role: string;
  };
  sourceTurnId?: string;
}): ConversationTurnExecutor<NativeTurnService> {
  if (selected.selection.runtime === "legacy") {
    return createLegacyTurnExecutor();
  }

  return createGatewayTurnExecutor({
    service,
    auth,
    provider: "hermes",
    model: "hermes-official-gateway",
    ...(sourceTurnId ? { sourceTurnId } : {}),
    gateway: createHermesGatewayClient({
      config: {
        url: selected.runtimeConfig.XINGYAO_HERMES_GATEWAY_BASE_URL!,
        serviceToken:
          selected.runtimeConfig.XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN!,
        timeouts: {
          connectMs: 2_000,
          readyMs: 2_000,
          rpcMs: 15_000,
          idleMs: 180_000,
          heartbeatMs: 30_000,
        },
      },
    }),
  });
}
