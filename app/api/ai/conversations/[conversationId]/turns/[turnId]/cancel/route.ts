import { NextResponse } from "next/server";

import {
  conversationRouteErrorResponse,
  getAiConversationRouteContext,
} from "@/app/api/ai/conversation-route-context";
import { activeHermesRunRegistry } from "@/features/ai/hermes/active-run-registry";
import {
  createHermesGatewaySession,
  resolveHermesGatewayConfig,
} from "@/features/ai/hermes/gateway-client";
import {
  createHermesActorAssertionForRun,
  resolveHermesRuntimeConfig,
} from "@/features/ai/hermes/runtime-client";
import { buildNativeAssistantContext } from "@/features/ai/native-assistant/context-engine";

export const maxDuration = 330;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string; turnId: string }> },
) {
  try {
    const context = await getAiConversationRouteContext();
    if (context instanceof Response) return context;
    const { conversationId, turnId } = await params;
    const turn = await requireOwnedTurn(context.service, context.actor, conversationId, turnId);
    const state = await context.service.getGatewayState(context.actor, conversationId);

    const cancelled = await context.service.cancelTurn(
      context.actor,
      conversationId,
      turnId,
    );
    if (cancelled.alreadyTerminal) {
      return NextResponse.json({ ...cancelled, interrupted: false });
    }

    const local = await activeHermesRunRegistry.interruptTree({
      actor: context.actor,
      conversationId,
      turnId,
    });
    const childSessions = stringList(recordValue(cancelled, "childSessions"));
    let interrupted = local.interrupted;
    for (const childSessionId of childSessions) {
      if (
        await interruptDurableSession({
          context,
          conversationId,
          turnId,
          turn,
          state,
          sessionId: childSessionId,
        })
      ) {
        interrupted += 1;
      }
    }
    if (state?.sessionId) {
      const parentInterrupted = await interruptDurableSession({
        context,
        conversationId,
        turnId,
        turn,
        state,
        sessionId: state.sessionId,
      });
      if (!parentInterrupted && interrupted === 0) {
        return recoveryResponse(context.service, context.actor, conversationId, state);
      }
      if (parentInterrupted) interrupted += 1;
    }

    return NextResponse.json({
      ...cancelled,
      interrupted: interrupted > 0,
      revokedCapabilityIds: stringList(recordValue(cancelled, "revokedCapabilityIds")),
    });
  } catch (error) {
    return conversationRouteErrorResponse(error);
  }
}

async function interruptDurableSession(input: {
  context: any;
  conversationId: string;
  turnId: string;
  turn: { mode?: "fast" | "deep" };
  state: { sessionId?: string } | null;
  sessionId: string;
}) {
  try {
    const session = await openControlSession(input);
    try {
      await session.interrupt();
    } finally {
      session.close?.();
    }
    return true;
  } catch (error) {
    if (isMissingGatewaySession(error)) return false;
    throw error;
  }
}

async function openControlSession({
  context,
  conversationId,
  turnId,
  turn,
  sessionId,
}: {
  context: any;
  conversationId: string;
  turnId: string;
  turn: { mode?: "fast" | "deep" };
  sessionId: string;
}) {
  const actor = buildControlActor(context.auth, conversationId, turnId, turn.mode ?? "fast");
  const capability = await context.service.issueGatewayRootCapability(context.actor, {
    actor,
    mode: turn.mode ?? "fast",
    turn: { id: turnId, conversationId },
    serverAllowedTools: [],
    approvedSkillDraftIds: [],
    aiStateWritesAllowed: false,
  });
  const config = resolveHermesGatewayConfig();
  const actorAssertionConfig = resolveHermesRuntimeConfig();
  if (!config || !actorAssertionConfig) throw new Error("gateway_config_missing");
  return createHermesGatewaySession({
    config,
    actor,
    actorAssertion: await createHermesActorAssertionForRun({
      actor,
      config: actorAssertionConfig,
    }),
    invocationCapability: capability.invocationCapability,
    conversationId,
    sessionId,
  });
}

async function requireOwnedTurn(
  service: any,
  actor: { organizationId: string; userId: string },
  conversationId: string,
  turnId: string,
) {
  const history = await service.getHistory(actor, conversationId);
  const turn = Array.isArray(history?.turns)
    ? history.turns.find((item: any) => item?.id === turnId || item?.turnId === turnId)
    : null;
  if (!turn) throw new Error("Turn not found");
  if (!["accepted", "grounding", "generating", "validating"].includes(String(turn.status))) {
    throw new Error("Turn is not active");
  }
  return turn;
}

function buildControlActor(
  auth: { userId: string; organizationId: string; role: string },
  conversationId: string,
  turnId: string,
  mode: "fast" | "deep",
) {
  const context = buildNativeAssistantContext({
    auth,
    conversationId,
    invocationId: turnId,
    runtime: "gateway",
    clientRequest: { message: "control", mode, attachmentIds: [] },
  });
  if (!context) throw new Error("gateway_actor_invalid");
  return context.actor;
}

async function recoveryResponse(
  service: any,
  actor: { organizationId: string; userId: string },
  conversationId: string,
  state: { generation: number; summary?: Record<string, unknown>; summaryVersion?: number },
) {
  await service.compareAndSwapGatewayState(actor, conversationId, state.generation, {
    generation: state.generation + 1,
    summary: state.summary ?? {},
    summaryVersion: state.summaryVersion ?? 0,
    recovery: {
      status: "rebuild_required",
      reason: "gateway_session_missing",
    },
  });
  return NextResponse.json({ recovery: "rebuild_required" }, { status: 202 });
}

function isMissingGatewaySession(error: unknown): boolean {
  return error instanceof Error && /session_(mismatch|missing|not_found)|not_found/i.test(error.message);
}

function recordValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}
