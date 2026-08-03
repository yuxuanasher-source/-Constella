import { NextResponse } from "next/server";

import {
  conversationRouteErrorResponse,
  getAiConversationRouteContext,
  type AiConversationRouteContext,
} from "@/app/api/ai/conversation-route-context";
import { activeHermesRunRegistry } from "@/features/ai/hermes/active-run-registry";
import {
  createHermesGatewaySession,
  resolveHermesGatewayConfig,
  type HermesGatewaySession,
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
    const turn = await requireOwnedTurn(
      context.service,
      context.actor,
      conversationId,
      turnId,
    );
    const turnIsActive = [
      "accepted",
      "grounding",
      "generating",
      "validating",
    ].includes(String(turn.status));
    const state = await context.service.getGatewayState(
      context.actor,
      conversationId,
    );
    const recoveryControl = await getRecoveryControlState(
      context.service,
      context.actor,
      conversationId,
      turnId,
    );
    const recoveryChildSessionIds = recoveryControl.available
      ? stringList(recoveryControl.controlState?.childSessionIds)
      : null;
    const runIdentity = {
      actor: context.actor,
      conversationId,
      turnId,
    };
    const localSessionIds = new Set(
      activeHermesRunRegistry.treeSessionIds(runIdentity),
    );
    const durableSessionIds = [
      ...(recoveryChildSessionIds ??
        childControlSessions([state], state?.sessionId)),
      ...(state?.sessionId ? [state.sessionId] : []),
    ].filter((sessionId) => !localSessionIds.has(sessionId));
    const preparedSessions = turnIsActive
      ? await prepareControlSessions({
          context,
          conversationId,
          turnId,
          turn,
          sessionIds: durableSessionIds,
        })
      : new Map<string, PreparedControlSession>();

    try {
      const cancelled = await context.service.cancelTurn(
        context.actor,
        conversationId,
        turnId,
      );
      if (cancelled.alreadyTerminal && cancelled.status !== "cancelled") {
        return NextResponse.json({ ...cancelled, interrupted: false });
      }
      const cancelRecoveryPersisted = await persistCancelMilestone(
        context.service,
        context.actor,
        conversationId,
        turnId,
        durableSessionIds,
      );

      const local = await activeHermesRunRegistry.interruptTree(runIdentity);
      const interruptedLocalSessionIds = new Set([
        ...local.interruptedSessionIds,
      ]);
      const childSessions =
        recoveryChildSessionIds ??
        childControlSessions([state, cancelled], state?.sessionId);
      let interrupted = local.interrupted;
      let recoveryRequired = (local.failedSessionIds?.length ?? 0) > 0;
      for (const childSessionId of childSessions) {
        if (interruptedLocalSessionIds.has(childSessionId)) continue;
        const childInterrupt = await interruptPreparedSession(
          preparedSessions,
          childSessionId,
        );
        if (childInterrupt.interrupted) {
          interrupted += 1;
        }
        recoveryRequired ||= childInterrupt.recoveryRequired;
      }
      if (state?.sessionId && !local.parentInterrupted) {
        const parentInterrupted = await interruptPreparedSession(
          preparedSessions,
          state.sessionId,
        );
        recoveryRequired ||= parentInterrupted.recoveryRequired;
        if (parentInterrupted.interrupted) interrupted += 1;
      }
      if (
        recoveryRequired ||
        (state?.sessionId && !local.parentInterrupted && interrupted === 0)
      ) {
        return recoveryResponse(
          context.service,
          context.actor,
          conversationId,
          turnId,
          cancelled,
          interrupted > 0,
          childSessions,
          cancelRecoveryPersisted,
        );
      }

      return NextResponse.json({
        ...cancelled,
        interrupted: interrupted > 0,
        revokedCapabilityIds: stringList(
          recordValue(cancelled, "revokedCapabilityIds"),
        ),
        recoveryStatePersisted: cancelRecoveryPersisted,
      });
    } finally {
      closePreparedSessions(preparedSessions);
    }
  } catch (error) {
    return conversationRouteErrorResponse(error);
  }
}

type PreparedControlSession =
  | { status: "ready"; session: HermesGatewaySession }
  | { status: "error"; error: unknown };

async function prepareControlSessions(input: {
  context: AiConversationRouteContext;
  conversationId: string;
  turnId: string;
  turn: { mode?: "fast" | "deep" };
  sessionIds: string[];
}): Promise<Map<string, PreparedControlSession>> {
  const prepared = new Map<string, PreparedControlSession>();
  const sessionIds = [...new Set(input.sessionIds)];
  if (sessionIds.length === 0) return prepared;

  let shared:
    | {
        actor: ReturnType<typeof buildControlActor>;
        invocationCapability: string;
        config: NonNullable<ReturnType<typeof resolveHermesGatewayConfig>>;
        actorAssertionConfig: NonNullable<
          ReturnType<typeof resolveHermesRuntimeConfig>
        >;
      }
    | undefined;
  try {
    const actor = buildControlActor(
      input.context.auth,
      input.conversationId,
      input.turnId,
      input.turn.mode ?? "fast",
    );
    const capability = await input.context.service.issueGatewayRootCapability(
      input.context.actor,
      {
        actor,
        mode: input.turn.mode ?? "fast",
        turn: { id: input.turnId, conversationId: input.conversationId },
        serverAllowedTools: [],
        approvedSkillDraftIds: [],
        aiStateWritesAllowed: false,
      },
    );
    const config = resolveHermesGatewayConfig();
    const actorAssertionConfig = resolveHermesRuntimeConfig();
    if (!config || !actorAssertionConfig) {
      throw new Error("gateway_config_missing");
    }
    shared = {
      actor,
      invocationCapability: capability.invocationCapability,
      config,
      actorAssertionConfig,
    };
  } catch (error) {
    for (const sessionId of sessionIds) {
      prepared.set(sessionId, { status: "error", error });
    }
    return prepared;
  }

  for (const sessionId of sessionIds) {
    try {
      prepared.set(sessionId, {
        status: "ready",
        session: await createHermesGatewaySession({
          config: shared.config,
          actor: shared.actor,
          actorAssertion: await createHermesActorAssertionForRun({
            actor: shared.actor,
            config: shared.actorAssertionConfig,
            runtime: "gateway",
          }),
          invocationCapability: shared.invocationCapability,
          conversationId: input.conversationId,
          sessionId,
        }),
      });
    } catch (error) {
      prepared.set(sessionId, { status: "error", error });
    }
  }
  return prepared;
}

async function interruptPreparedSession(
  prepared: Map<string, PreparedControlSession>,
  sessionId: string,
): Promise<{ interrupted: boolean; recoveryRequired: boolean }> {
  const control = prepared.get(sessionId);
  if (!control) return { interrupted: false, recoveryRequired: true };
  if (control.status === "error") {
    return { interrupted: false, recoveryRequired: true };
  }
  try {
    await control.session.interrupt();
    return { interrupted: true, recoveryRequired: false };
  } catch {
    return { interrupted: false, recoveryRequired: true };
  }
}

function closePreparedSessions(
  prepared: Map<string, PreparedControlSession>,
): void {
  for (const control of prepared.values()) {
    if (control.status !== "ready") continue;
    try {
      control.session.close?.();
    } catch {
      // Cancellation is already durable; closing the control socket is best effort.
    }
  }
}

async function requireOwnedTurn(
  service: AiConversationRouteContext["service"],
  actor: AiConversationRouteContext["actor"],
  conversationId: string,
  turnId: string,
) {
  const history = await service.getHistory(actor, conversationId);
  const turn = Array.isArray(history?.turns)
    ? history.turns.find((item) => item.id === turnId)
    : null;
  if (!turn) throw new Error("Turn not found");
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
  service: AiConversationRouteContext["service"],
  actor: AiConversationRouteContext["actor"],
  conversationId: string,
  turnId: string,
  cancelled: Record<string, unknown>,
  interrupted: boolean,
  childSessionIds: string[],
  recoveryAlreadyPersisted: boolean,
) {
  const recoveryStatePersisted =
    recoveryAlreadyPersisted ||
    (await persistCancelMilestone(
      service,
      actor,
      conversationId,
      turnId,
      childSessionIds,
      { recoveryRequired: true },
    ));
  return NextResponse.json(
    {
      ...cancelled,
      interrupted,
      recoveryRequired: true,
      recoveryStatePersisted,
      recovery: "rebuild_required",
    },
    { status: 202 },
  );
}

async function persistCancelMilestone(
  service: AiConversationRouteContext["service"],
  actor: AiConversationRouteContext["actor"],
  conversationId: string,
  turnId: string,
  childSessionIds: string[],
  options: { recoveryRequired?: boolean } = {},
) {
  const appendRecoveryEvent = recoveryService(service).appendRecoveryEvent;
  if (!appendRecoveryEvent) return false;
  try {
    await appendRecoveryEvent.call(service, actor, conversationId, turnId, {
      eventName: "cancel_requested",
      payload: options.recoveryRequired
        ? {
            recovery: "rebuild_required",
            reason: "gateway_session_missing",
          }
        : { requested: true },
      controlState: { childSessionIds },
    });
    return true;
  } catch {
    return false;
  }
}

function recordValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function childControlSessions(
  values: unknown[],
  parentSessionId?: string,
): string[] {
  return [
    ...new Set(
      values.flatMap((value) =>
        stringList(recordValue(value, "childSessions")).filter(
          (sessionId) => sessionId !== parentSessionId,
        ),
      ),
    ),
  ];
}

type RecoveryControlState = {
  childSessionIds?: unknown;
};

type RecoveryCompatibleService = {
  getRecoverySnapshot?: (
    actor: AiConversationRouteContext["actor"],
    conversationId: string,
    turnId: string,
  ) => Promise<unknown>;
  appendRecoveryEvent?: (
    actor: AiConversationRouteContext["actor"],
    conversationId: string,
    turnId: string,
    event: Record<string, unknown>,
  ) => Promise<unknown>;
};

async function getRecoveryControlState(
  service: AiConversationRouteContext["service"],
  actor: AiConversationRouteContext["actor"],
  conversationId: string,
  turnId: string,
): Promise<
  | { available: true; controlState: RecoveryControlState | null }
  | { available: false; controlState: null }
> {
  const getRecoverySnapshot = recoveryService(service).getRecoverySnapshot;
  if (!getRecoverySnapshot) return { available: false, controlState: null };
  const snapshot = await getRecoverySnapshot.call(
    service,
    actor,
    conversationId,
    turnId,
  );
  if (
    !isRecord(snapshot) ||
    !isRecord(snapshot.controlState) ||
    (snapshot.eventSequence === 0 &&
      Object.keys(snapshot.controlState).length === 0)
  ) {
    return { available: false, controlState: null };
  }
  return {
    available: true,
    controlState: snapshot.controlState,
  };
}

function recoveryService(
  service: AiConversationRouteContext["service"],
): RecoveryCompatibleService {
  return service as unknown as RecoveryCompatibleService;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
