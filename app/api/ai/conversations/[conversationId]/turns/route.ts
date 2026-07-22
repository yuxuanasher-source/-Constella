import { NextResponse } from "next/server";

import {
  conversationRouteErrorResponse,
  getAiConversationRouteContext,
} from "@/app/api/ai/conversation-route-context";
import { parseCreateTurnCommand } from "@/features/ai/conversation-contracts";
import { createConversationTurnStream } from "@/features/ai/conversation-stream-adapter";
import {
  HermesRuntimeSelectionConfigError,
  parseHermesRuntimeSelectionConfig,
  selectHermesRuntime,
  type SelectedHermesRuntime,
} from "@/features/ai/hermes/runtime-selection";
import type { CreatedConversationTurn } from "@/features/ai/conversation-repository";
import {
  createGatewayTurnExecutor,
  createHermesGatewayClient,
} from "@/features/ai/native-assistant/gateway-executor";
import { createLegacyTurnExecutor } from "@/features/ai/native-assistant/legacy-turn-executor";

export const maxDuration = 330;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const context = await getAiConversationRouteContext();
    if (context instanceof Response) return context;
    const { conversationId } = await params;
    const command = parseCreateTurnCommand(
      await request.json().catch(() => null),
    );
    if (!conversationId || !command) {
      return NextResponse.json(
        { error: "A valid content, mode and clientRequestId are required" },
        { status: 400 },
      );
    }

    let runtimeConfig;
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
    const runtimeSelection = selectHermesRuntime(runtimeConfig, context.actor);
    if (runtimeSelection.kind === "failure") {
      return NextResponse.json(
        { error: runtimeSelection.code },
        { status: runtimeSelection.status },
      );
    }

    const runtimeSnapshot = {
      runtimeSelection: {
        runtime: runtimeSelection.runtime,
        protocol: runtimeSelection.protocol,
        profile: runtimeSelection.profile,
      },
    };
    const acceptTurnWithRuntimeSnapshot = context.service.acceptTurn as unknown as (
      ...args: unknown[]
    ) => Promise<CreatedConversationTurn>;
    const turn = await acceptTurnWithRuntimeSnapshot(
      context.actor,
      conversationId,
      command,
      runtimeSnapshot,
    );
    if (turn.duplicate) {
      return NextResponse.json(
        { error: "Turn already exists", turn, reloadConversation: true },
        { status: 409 },
      );
    }

    const service = withRuntimeSelectionSnapshot(
      context.service,
      runtimeSelection,
    );
    const executor =
      runtimeSelection.runtime === "gateway"
        ? createGatewayTurnExecutor({
            service,
            auth: context.auth,
            provider: "hermes",
            model: "hermes-official-gateway",
            gateway: createHermesGatewayClient({
              config: {
                url: runtimeConfig.XINGYAO_HERMES_GATEWAY_BASE_URL!,
                serviceToken:
                  runtimeConfig.XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN!,
                timeouts: {
                  connectMs: 2_000,
                  readyMs: 2_000,
                  rpcMs: 15_000,
                  idleMs: 120_000,
                  heartbeatMs: 30_000,
                },
              },
            }),
          })
        : createLegacyTurnExecutor();

    return createConversationTurnStream({
      request,
      actor: context.actor,
      turn,
      attachments: command.attachments,
      service,
      executor,
    });
  } catch (error) {
    return conversationRouteErrorResponse(error);
  }
}

function withRuntimeSelectionSnapshot<TService extends Record<string, unknown>>(
  service: TService,
  selection: SelectedHermesRuntime,
): TService & {
  prepareTurn: (...args: unknown[]) => Promise<unknown>;
  captureGatewayContext: (...args: unknown[]) => Promise<unknown>;
} {
  const runtimeSelection = {
    runtime: selection.runtime,
    protocol: selection.protocol,
    profile: selection.profile,
  };
  const prepareTurn = async (...args: unknown[]) => {
    const prepared = await callServiceMethod(service, "prepareTurn", args);
    if (!isRecord(prepared) || !isRecord(prepared.snapshot)) {
      return prepared;
    }
    return {
      ...prepared,
      snapshot: {
        ...prepared.snapshot,
        runtimeSelection,
      },
    };
  };
  const captureGatewayContext = async (...args: unknown[]) => {
    const snapshot = isRecord(args[2])
      ? { ...args[2], runtimeSelection }
      : args[2];
    return callServiceMethod(service, "captureGatewayContext", [
      args[0],
      args[1],
      snapshot,
      ...args.slice(3),
    ]);
  };

  return {
    ...service,
    prepareTurn,
    captureGatewayContext,
  };
}

async function callServiceMethod(
  service: Record<string, unknown>,
  method: string,
  args: unknown[],
) {
  const fn = service[method];
  if (typeof fn !== "function") {
    throw new Error(`AI conversation service is missing ${method}`);
  }
  return await fn.apply(service, args);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
