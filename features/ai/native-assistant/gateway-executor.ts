import type {
  ConversationGatewayContext,
  ConversationResponseOutcome,
  ConversationSessionAction,
  ConversationStreamEvent,
  ConversationTurnStage,
} from "../conversation-contracts";
import type { AiAttachment, AiProviderName } from "../contracts";
import type {
  ConversationTurnExecutor,
  ConversationTurnExecutorInput,
} from "../conversation-stream-adapter";
import type { CreatedConversationTurn } from "../conversation-repository";
import type { ConversationActor } from "../conversation-service";
import type { HermesActorProfile } from "../hermes/contracts";
import {
  attachHermesGatewayBytes,
  createHermesGatewaySession as openHermesGatewaySession,
  HermesGatewayError,
  isAmbiguousHermesGatewayTransportError,
  resolveHermesGatewayConfig as resolveOfficialHermesGatewayConfig,
  type HermesGatewayByteAttachment,
  type HermesGatewayClientConfig,
  type HermesGatewaySession,
} from "../hermes/gateway-client";
import {
  parseHermesGatewayEvent,
  type HermesGatewayEvent,
  type HermesToolResultMetadata,
} from "../hermes/gateway-contracts";
import { activeHermesRunRegistry } from "../hermes/active-run-registry";
import { HermesStateRepositoryError } from "../hermes/hermes-state-repository";
import { HERMES_READ_ENDPOINTS } from "../hermes/read-api";
import {
  createHermesActorAssertionForRun,
  resolveHermesRuntimeConfig,
  type HermesRuntimeConfig,
} from "../hermes/runtime-client";
import {
  HERMES_MEMORY_TOOL_NAMES,
  HERMES_SKILL_TOOL_NAMES,
} from "../hermes/tool-broker-contracts";
import { buildGatewayNativeAssistantContext } from "./context-engine";

type GatewayService = {
  prepareTurn(
    actor: ConversationActor,
    turnId: string,
    groundingRefs?: string[],
  ): Promise<{
    turn: { mode: "fast" | "deep" };
    snapshot: {
      version: number;
      summaryVersion: number;
      messageIds?: string[];
      groundingRefs?: string[];
      assembledAt?: string;
      gatewayContext?: ConversationGatewayContext;
    };
  }>;
  listMessages(
    actor: ConversationActor,
    conversationId: string,
  ): Promise<
    Array<
      Parameters<
        typeof buildGatewayNativeAssistantContext
      >[0]["messages"][number]
    >
  >;
  getGatewayState?(
    actor: ConversationActor,
    conversationId: string,
  ): Promise<{
    generation: number;
    sessionId?: string;
    checkpointId?: string;
    provider?: string;
    model?: string;
    lastUsedAt?: string;
    summary?: Record<string, unknown>;
    summaryVersion?: number;
    childSessions?: string[];
    pendingClarify?: {
      turnId: string;
      clarifyId: string;
      requestId?: string;
      question: string;
      choices: string[];
      allowFreeText: boolean;
      response?: {
        clarifyId: string;
        answerSha256: string;
      };
    };
  } | null>;
  compareAndSwapGatewayState(
    actor: ConversationActor,
    conversationId: string,
    expectedGeneration: number,
    nextState: Record<string, unknown>,
  ): Promise<number>;
  syncConversationSummary?(
    actor: ConversationActor,
    conversationId: string,
    input: { expectedSummaryVersion: number; summary: Record<string, unknown> },
  ): Promise<void>;
  finishTurnV2(
    actor: ConversationActor,
    turnId: string,
    input: {
      invocationId: string;
      outcome: "complete" | "partial" | "blocked" | "failed" | "cancelled";
      content?: string;
      providerName?: AiProviderName | null;
      errorCode?: string | null;
      errorSummary?: string | null;
      retryable: boolean;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void>;
  recordTurnStage?(
    actor: ConversationActor,
    conversationId: string,
    turnId: string,
    input: {
      stage: ConversationTurnStage;
      observedAt: string;
      sessionAction?: ConversationSessionAction;
    },
  ): Promise<unknown>;
  captureGatewayContext?(
    actor: ConversationActor,
    turnId: string,
    snapshot: {
      version: number;
      summaryVersion: number;
      messageIds?: string[];
      groundingRefs?: string[];
      assembledAt?: string;
    },
    gatewayContext: ConversationGatewayContext,
  ): Promise<unknown>;
  getSourceGatewayCheckpoint?(
    actor: ConversationActor,
    sourceTurnId: string,
  ): Promise<GatewayCheckpoint | null>;
  issueGatewayRootCapability?(
    actor: ConversationActor,
    input: GatewayRootCapabilityRequest,
  ): Promise<GatewayIssuedCapability>;
  renewLeaseV2?(actor: ConversationActor, turnId: string): Promise<void>;
};

type GatewayClient = {
  createSession(
    input: Record<string, unknown>,
  ): Promise<{ sessionId: string; checkpointId?: string }>;
  resumeSession?(
    input: Record<string, unknown>,
  ): Promise<{ sessionId: string; checkpointId?: string }>;
  branchSession?(
    input: Record<string, unknown>,
  ): Promise<{ sessionId: string }>;
  submitPrompt(input: Record<string, unknown>): AsyncIterable<unknown>;
  recoverSession?(input: Record<string, unknown>): AsyncIterable<unknown>;
  interruptSession?(input: { sessionId: string }): Promise<unknown>;
  respondToClarify?(input: {
    sessionId: string;
    requestId: string;
    answer: string;
  }): Promise<unknown>;
  closeSession?(input: { sessionId: string }): void;
};

type GatewayConversationState = NonNullable<
  Awaited<ReturnType<NonNullable<GatewayService["getGatewayState"]>>>
>;

type GatewaySessionPreparation = {
  sessionId: string;
  checkpointId?: string;
  action: "resumed" | "rebuilt";
  generation: number;
  state: GatewayConversationState;
};

export type GatewayCheckpoint = {
  sessionId: string;
  checkpointId?: string;
  turnId: string;
  conversationId: string;
  organizationId: string;
  ownerUserId: string;
};

type GatewayIssuedCapability = {
  capabilityId: string;
  invocationCapability: string;
  expiresAt: string;
};

type GatewayRootCapabilityRequest = {
  actor: HermesActorProfile;
  mode: "fast" | "deep";
  turn: { id: string; conversationId: string };
  serverAllowedTools: string[];
  approvedSkillDraftIds: string[];
  aiStateWritesAllowed: boolean;
};

type GatewayExecutorOptions = {
  service: GatewayService;
  gateway?: GatewayClient;
  auth: {
    userId: string;
    organizationId: string;
    role: string;
  };
  provider: AiProviderName;
  model: string;
  personalMemoryRevision?: number;
  sourceTurnId?: string;
  now?: () => Date;
  telemetryTimeoutMs?: number;
  telemetryLogger?: {
    warn(input: {
      code: "conversation_turn_stage_persist_failed";
      stage: ConversationTurnStage;
      turnId: string;
    }): void;
  };
};

const GATEWAY_SESSION_IDLE_TTL_MS = 15 * 60 * 1_000;
const MAX_PROMPT_SUBMIT_ATTEMPTS = 2;

export function createGatewayTurnExecutor(
  options: GatewayExecutorOptions,
): ConversationTurnExecutor<Omit<GatewayService, "listMessages">> {
  const gateway = options.gateway ?? createHermesGatewayClient();
  return {
    async *execute(
      input: ConversationTurnExecutorInput<
        Omit<GatewayService, "listMessages">
      >,
    ) {
      const service = options.service;
      const now = options.now ?? (() => new Date());
      let content = "";
      let state: Awaited<
        ReturnType<NonNullable<GatewayService["getGatewayState"]>>
      > | null = null;
      let unregisterActiveRun: (() => void) | null = null;
      let activeSessionId: string | null = null;
      const telemetry = createBestEffortStageRecorder({
        service,
        actor: input.actor,
        turn: input.turn,
        now,
        logger: options.telemetryLogger,
        timeoutMs: options.telemetryTimeoutMs,
      });

      telemetry.record("accepted");
      yield started(input.turn);

      try {
        const prepared = await service.prepareTurn(
          input.actor,
          input.turn.turnId,
          [],
        );
        telemetry.record("context_ready");
        state = (await service.getGatewayState?.(
          input.actor,
          input.turn.conversationId,
        )) ?? {
          generation: 0,
          summary: {},
          summaryVersion: prepared.snapshot.summaryVersion,
        };
        const frozen = frozenGatewayContext(prepared.snapshot.gatewayContext);
        const sessionSetup = frozen
          ? await resumeFrozenGatewayContext({
              input,
              service,
              gateway,
              context: frozen,
              state,
            })
          : await buildAndCaptureFreshGatewayContext({
              input,
              options,
              service,
              gateway,
              prepared,
              state,
              now,
            });
        if (!sessionSetup.session.sessionId) {
          throw new GatewayExecutionError("gateway_checkpoint_invalid");
        }
        state = sessionSetup.state;
        telemetry.record("session_ready", sessionSetup.action);
        const sessionId = sessionSetup.session.sessionId;
        activeSessionId = sessionId;
        unregisterActiveRun = activeHermesRunRegistry.register({
          actor: input.actor,
          conversationId: input.turn.conversationId,
          turnId: input.turn.turnId,
          sessionId,
          session: {
            interrupt: () =>
              gateway.interruptSession?.({ sessionId }) ?? Promise.resolve(),
            respondToClarify: ({ requestId, answer }) =>
              gateway.respondToClarify?.({ sessionId, requestId, answer }) ??
              Promise.resolve(),
            close: () => gateway.closeSession?.({ sessionId }),
          },
          ...(parentTurnId(input.turn)
            ? { parentTurnId: parentTurnId(input.turn)! }
            : {}),
        });
        yield {
          type: "context.ready",
          conversationId: input.turn.conversationId,
          turnId: input.turn.turnId,
          snapshotVersion: prepared.snapshot.version,
        };

        if (!sessionSetup.captured) {
          throw new GatewayExecutionError("gateway_context_not_frozen");
        }

        const invocationCapability =
          sessionSetup.capability ??
          (await issueGatewayInvocationCapability({
            service,
            actor: input.actor,
            turn: input.turn,
            gatewayContext: sessionSetup.context,
          }));

        const observations: ToolObservation[] = [];
        let promptAccepted = false;
        const promptInput = {
          sessionId: sessionSetup.session.sessionId,
          prompt: buildGatewayPrompt({
            context: sessionSetup.context,
            summary: state.summary ?? {},
          }),
          actor:
            recordValue(sessionSetup.context.invocationMetadata, "actor") ??
            options.auth,
          provider: options.provider,
          model: options.model,
          mode: sessionSetup.context.mode,
          conversationId: input.turn.conversationId,
          invocationCapability: invocationCapability.invocationCapability,
        };
        try {
          for await (const gatewayEvent of streamGatewayPrompt({
            gateway,
            input: promptInput,
            onAccepted: () => {
              promptAccepted = true;
            },
          })) {
            const terminal = terminalGatewayEvent(gatewayEvent);
            if (terminal) {
              telemetry.record("agent_ready");
              if (terminal.message && !content) content = terminal.message;
              if (terminal.observation) observations.push(terminal.observation);
              if (terminal.status === "cancelled") {
                await persistTerminalFailure({
                  service,
                  actor: input.actor,
                  turn: input.turn,
                  content,
                  provider: options.provider,
                  model: options.model,
                  code: "turn_cancelled",
                  retryable: false,
                  telemetry,
                });
                yield {
                  type: "response.cancelled",
                  conversationId: input.turn.conversationId,
                  turnId: input.turn.turnId,
                  messageId: input.turn.assistantMessageId,
                  invocationId: input.turn.turnId,
                };
                return;
              }
              if (terminal.status === "failed") {
                const code = gatewayTraceCode(
                  terminal.code ?? "provider_failed",
                );
                await persistTerminalFailure({
                  service,
                  actor: input.actor,
                  turn: input.turn,
                  content,
                  provider: options.provider,
                  model: options.model,
                  code,
                  retryable: true,
                  telemetry,
                });
                yield failedEvent(input.turn, code, true);
                return;
              }

              const completed = await completeWithCoherentSummary({
                service,
                actor: input.actor,
                turn: input.turn,
                content,
                provider: options.provider,
                model: options.model,
                observations,
                summary: terminal.summary,
                forcedOutcome: terminal.outcome,
                state,
                telemetry,
              });
              if (completed.type === "failed") {
                yield failedEvent(input.turn, completed.code, true);
                return;
              }
              yield completed.event;
              return;
            }

            const event = normalizeGatewayEvent(gatewayEvent, input.turn);
            if (!event) continue;
            telemetry.record("agent_ready");
            if (event.type === "clarify.requested") {
              state = await persistGatewayClarifyRequest({
                service,
                actor: input.actor,
                turn: input.turn,
                state,
                event,
              });
            }
            if (event.type === "response.delta") {
              telemetry.record("first_delta");
              content += event.delta;
            }
            if (event.type === "tool.completed") {
              observations.push({
                status: event.status,
                evidence: event.evidence ?? [],
                missing: event.missing ?? [],
                observedAt: event.observedAt,
                critical: isCriticalToolFailure(gatewayEvent),
              });
            }
            yield event;
          }
        } catch (error) {
          if (error instanceof GatewayExecutionError) throw error;
          throw new GatewayExecutionError(
            promptAccepted
              ? "gateway_stream_recovery_failed"
              : "gateway_stream_failed",
          );
        }

        throw new GatewayExecutionError("gateway_stream_ended");
      } catch (error) {
        const code =
          error instanceof GatewayExecutionError
            ? error.code
            : "gateway_internal_failed";
        try {
          await persistTerminalFailure({
            service,
            actor: input.actor,
            turn: input.turn,
            content,
            provider: options.provider,
            model: options.model,
            code,
            retryable: true,
            telemetry,
          });
        } catch {
          throw new Error("AI terminal state could not be persisted");
        }
        yield failedEvent(input.turn, code, true);
      } finally {
        unregisterActiveRun?.();
        if (activeSessionId) {
          try {
            gateway.closeSession?.({ sessionId: activeSessionId });
          } catch {
            // Best-effort cleanup after terminal persistence or iterator return.
          }
        }
      }
    },
  };
}

async function resumeFrozenGatewayContext({
  input,
  service,
  gateway,
  context,
  state,
}: {
  input: ConversationTurnExecutorInput<Omit<GatewayService, "listMessages">>;
  service: GatewayService;
  gateway: GatewayClient;
  context: ConversationGatewayContext;
  state: GatewayConversationState;
}) {
  const sessionId =
    stringValue(context.invocationMetadata.sessionId) ??
    stringValue(
      recordValue(context.invocationMetadata.gatewayCheckpoint, "sessionId"),
    ) ??
    state.sessionId;
  if (!sessionId) {
    throw new GatewayExecutionError("gateway_checkpoint_invalid");
  }
  const capability = await issueGatewayInvocationCapability({
    service,
    actor: input.actor,
    turn: input.turn,
    gatewayContext: context,
  });
  const resumed = await resumeGatewaySession(gateway, {
    sessionId,
    actor: recordValue(context.invocationMetadata, "actor"),
    conversationId: input.turn.conversationId,
    invocationCapability: capability.invocationCapability,
    attachments: normalizeAttachmentUpload(input.attachments),
  });
  return {
    context,
    session: { sessionId: resumed.sessionId },
    checkpoint: checkpointFromMetadata(
      context.invocationMetadata.gatewayCheckpoint,
    ),
    captured: true,
    capability,
    action: "resumed" as const,
    state,
  };
}

async function prepareGatewaySession({
  service,
  gateway,
  actor,
  conversationId,
  options,
  capability,
  state,
  createInput,
  now,
}: {
  service: GatewayService;
  gateway: GatewayClient;
  actor: ConversationActor;
  conversationId: string;
  options: GatewayExecutorOptions;
  capability: GatewayIssuedCapability;
  state: GatewayConversationState;
  createInput: Record<string, unknown>;
  now: () => Date;
}): Promise<GatewaySessionPreparation> {
  let session: { sessionId: string; checkpointId?: string };
  let action: GatewaySessionPreparation["action"] = "rebuilt";
  if (isReusableGatewaySessionState(state, options, now())) {
    try {
      session = await resumeGatewaySession(gateway, {
        ...createInput,
        sessionId: state.sessionId,
      });
      action = "resumed";
    } catch {
      session = await createGatewaySession(gateway, createInput);
    }
  } else {
    session = await createGatewaySession(gateway, createInput);
  }

  return persistPreparedGatewaySession({
    service,
    gateway,
    actor,
    conversationId,
    options,
    capability,
    state,
    session,
    action,
    resumeInput: createInput,
    now,
  });
}

async function persistPreparedGatewaySession({
  service,
  gateway,
  actor,
  conversationId,
  options,
  capability,
  state,
  session,
  action,
  resumeInput,
  now,
}: {
  service: GatewayService;
  gateway: GatewayClient;
  actor: ConversationActor;
  conversationId: string;
  options: GatewayExecutorOptions;
  capability: GatewayIssuedCapability;
  state: GatewayConversationState;
  session: { sessionId: string; checkpointId?: string };
  action: GatewaySessionPreparation["action"];
  resumeInput?: Record<string, unknown>;
  now: () => Date;
}): Promise<GatewaySessionPreparation> {
  const checkpointId =
    session.checkpointId ??
    (action === "resumed" ? state.checkpointId : undefined);
  const nextState = {
    generation: state.generation + 1,
    sessionId: session.sessionId,
    ...(checkpointId ? { checkpointId } : {}),
    provider: options.provider,
    model: options.model,
    lastUsedAt: now().toISOString(),
    ...copyGatewayTransientControls(state),
  };
  try {
    await service.compareAndSwapGatewayState(
      actor,
      conversationId,
      state.generation,
      nextState,
    );
    return {
      sessionId: session.sessionId,
      ...(checkpointId ? { checkpointId } : {}),
      action,
      generation: nextState.generation,
      state: { ...state, ...nextState },
    };
  } catch (error) {
    if (
      !(error instanceof HermesStateRepositoryError) ||
      error.code !== "state_conflict"
    ) {
      throw new GatewayExecutionError("gateway_state_persist_failed");
    }
    const winner = await service.getGatewayState?.(actor, conversationId);
    if (
      !winner ||
      winner.generation <= state.generation ||
      !isReusableGatewaySessionState(winner, options, now()) ||
      !resumeInput
    ) {
      throw new GatewayExecutionError("gateway_state_conflict");
    }
    gateway.closeSession?.({ sessionId: session.sessionId });
    let resumed: { sessionId: string; checkpointId?: string };
    try {
      resumed = await resumeGatewaySession(gateway, {
        ...resumeInput,
        actor: recordValue(resumeInput, "actor"),
        conversationId,
        invocationCapability: capability.invocationCapability,
        sessionId: winner.sessionId,
      });
    } catch {
      throw new GatewayExecutionError("gateway_session_resume_failed");
    }
    return {
      sessionId: resumed.sessionId,
      ...(winner.checkpointId ? { checkpointId: winner.checkpointId } : {}),
      action: "resumed",
      generation: winner.generation,
      state: winner,
    };
  }
}

function copyGatewayTransientControls(state: GatewayConversationState) {
  const pendingClarify = state.pendingClarify;

  return {
    ...copyGatewayChildSessionControl(state),
    ...(pendingClarify
      ? {
          pendingClarify: {
            turnId: pendingClarify.turnId,
            clarifyId: pendingClarify.clarifyId,
            ...(pendingClarify.requestId
              ? { requestId: pendingClarify.requestId }
              : {}),
            question: pendingClarify.question,
            choices: [...pendingClarify.choices],
            allowFreeText: pendingClarify.allowFreeText,
            ...(pendingClarify.response?.clarifyId ===
              pendingClarify.clarifyId &&
            isSha256(pendingClarify.response.answerSha256)
              ? {
                  response: {
                    clarifyId: pendingClarify.response.clarifyId,
                    answerSha256: pendingClarify.response.answerSha256,
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

function copyGatewayChildSessionControl(state: GatewayConversationState) {
  return state.childSessions ? { childSessions: [...state.childSessions] } : {};
}

function copyGatewayReusableSessionEnvelope(
  state: GatewayConversationState,
  generation: number,
) {
  return {
    generation,
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    ...(state.checkpointId ? { checkpointId: state.checkpointId } : {}),
    ...(state.provider ? { provider: state.provider } : {}),
    ...(state.model ? { model: state.model } : {}),
    ...(state.lastUsedAt ? { lastUsedAt: state.lastUsedAt } : {}),
  };
}

async function createGatewaySession(
  gateway: GatewayClient,
  input: Record<string, unknown>,
) {
  try {
    return await gateway.createSession(input);
  } catch {
    throw new GatewayExecutionError("gateway_session_create_failed");
  }
}

async function resumeGatewaySession(
  gateway: GatewayClient,
  input: Record<string, unknown>,
) {
  if (!gateway.resumeSession) {
    throw new GatewayExecutionError("gateway_session_resume_failed");
  }
  try {
    return await gateway.resumeSession(input);
  } catch {
    throw new GatewayExecutionError("gateway_session_resume_failed");
  }
}

function isReusableGatewaySessionState(
  state: GatewayConversationState,
  options: Pick<GatewayExecutorOptions, "provider" | "model">,
  now: Date,
): state is GatewayConversationState & {
  sessionId: string;
  provider: string;
  model: string;
  lastUsedAt: string;
} {
  const lastUsedAtValue = stringValue(state.lastUsedAt);
  if (
    !stringValue(state.sessionId) ||
    state.provider !== options.provider ||
    state.model !== options.model ||
    !lastUsedAtValue
  ) {
    return false;
  }
  const lastUsedAt = Date.parse(lastUsedAtValue);
  return (
    Number.isFinite(lastUsedAt) &&
    lastUsedAt <= now.getTime() &&
    now.getTime() - lastUsedAt <= GATEWAY_SESSION_IDLE_TTL_MS
  );
}

async function* streamGatewayPrompt({
  gateway,
  input,
  onAccepted,
}: {
  gateway: GatewayClient;
  input: Record<string, unknown>;
  onAccepted: () => void;
}): AsyncIterable<unknown> {
  let promptAccepted = false;
  let submitAttempts = 0;

  while (submitAttempts < MAX_PROMPT_SUBMIT_ATTEMPTS) {
    submitAttempts += 1;
    try {
      for await (const event of gateway.submitPrompt(input)) {
        if (isGatewayPromptAcceptedEvent(event)) {
          promptAccepted = true;
          onAccepted();
          continue;
        }
        yield event;
      }
      return;
    } catch (submitError) {
      if (promptAccepted) throw submitError;
      if (!isAmbiguousHermesGatewayTransportError(submitError)) {
        throw submitError;
      }
      if (!gateway.recoverSession) {
        if (submitAttempts >= MAX_PROMPT_SUBMIT_ATTEMPTS) throw submitError;
        continue;
      }
      try {
        const recoveredBeforeAcceptance: unknown[] = [];
        for await (const event of gateway.recoverSession(input)) {
          if (isGatewayPromptAcceptedEvent(event)) {
            promptAccepted = true;
            onAccepted();
            for (const recovered of recoveredBeforeAcceptance) yield recovered;
            recoveredBeforeAcceptance.length = 0;
            continue;
          }
          if (promptAccepted) yield event;
          else recoveredBeforeAcceptance.push(event);
        }
        if (promptAccepted) return;
      } catch (recoveryError) {
        if (promptAccepted) throw recoveryError;
        if (!isAmbiguousHermesGatewayTransportError(recoveryError)) {
          throw recoveryError;
        }
        if (submitAttempts >= MAX_PROMPT_SUBMIT_ATTEMPTS) throw submitError;
      }
    }
  }

  throw new GatewayExecutionError("gateway_stream_failed");
}

function isGatewayPromptAcceptedEvent(
  value: unknown,
): value is { type: "prompt.accepted" } {
  return isRecord(value) && value.type === "prompt.accepted";
}

type BestEffortStageRecorder = {
  record(
    stage: ConversationTurnStage,
    sessionAction?: ConversationSessionAction,
  ): void;
};

function createBestEffortStageRecorder({
  service,
  actor,
  turn,
  now,
  logger,
  timeoutMs,
}: {
  service: GatewayService;
  actor: ConversationActor;
  turn: CreatedConversationTurn;
  now: () => Date;
  logger?: GatewayExecutorOptions["telemetryLogger"];
  timeoutMs?: number;
}): BestEffortStageRecorder {
  const attempted = new Set<ConversationTurnStage>();
  const boundedTimeoutMs = Math.max(1, Math.min(timeoutMs ?? 1_000, 10_000));
  return {
    record(stage, sessionAction) {
      if (attempted.has(stage)) return;
      attempted.add(stage);
      const observedAt = now().toISOString();
      if (!service.recordTurnStage) return;

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const write = Promise.resolve().then(() =>
        service.recordTurnStage!(actor, turn.conversationId, turn.turnId, {
          stage,
          observedAt,
          ...(sessionAction ? { sessionAction } : {}),
        }),
      );
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("conversation_turn_stage_persist_timeout")),
          boundedTimeoutMs,
        );
      });
      void Promise.race([write, deadline])
        .catch(() => {
          try {
            logger?.warn({
              code: "conversation_turn_stage_persist_failed",
              stage,
              turnId: turn.turnId,
            });
          } catch {
            // Telemetry diagnostics cannot affect the authoritative turn path.
          }
        })
        .finally(() => {
          if (timeout) clearTimeout(timeout);
        });
    },
  };
}

const GATEWAY_CONTEXT_PROMPT_LIMIT = 24_000;
const GATEWAY_SUMMARY_PROMPT_LIMIT = 6_000;

function buildGatewayPrompt({
  context,
  summary,
}: {
  context: ConversationGatewayContext;
  summary: Record<string, unknown>;
}): string {
  const currentRequest = context.lastUserMessage.trim();
  const messages = context.messages.slice();
  const lastMessage = messages.at(-1);
  if (
    lastMessage?.role === "user" &&
    lastMessage.content.trim() === currentRequest
  ) {
    messages.pop();
  }

  const summaryText = Object.keys(summary).length
    ? JSON.stringify(summary).slice(0, GATEWAY_SUMMARY_PROMPT_LIMIT)
    : "";
  const historyLines = messages.map(
    (message) => `${message.role.toUpperCase()}: ${message.content.trim()}`,
  );
  const fixedLength = currentRequest.length + summaryText.length + 256;
  let remaining = Math.max(0, GATEWAY_CONTEXT_PROMPT_LIMIT - fixedLength);
  const recentHistory: string[] = [];
  for (
    let index = historyLines.length - 1;
    index >= 0 && remaining > 0;
    index -= 1
  ) {
    const line = historyLines[index];
    if (!line) continue;
    const kept = line.slice(Math.max(0, line.length - remaining));
    recentHistory.unshift(kept);
    remaining -= kept.length + 1;
  }

  if (!summaryText && recentHistory.length === 0) return currentRequest;

  return [
    "<conversation_context>",
    ...(summaryText ? ["<summary>", summaryText, "</summary>"] : []),
    ...(recentHistory.length
      ? ["<recent_messages>", ...recentHistory, "</recent_messages>"]
      : []),
    "</conversation_context>",
    "<current_request>",
    currentRequest,
    "</current_request>",
  ].join("\n");
}

async function buildAndCaptureFreshGatewayContext({
  input,
  options,
  service,
  gateway,
  prepared,
  state,
  now,
}: {
  input: ConversationTurnExecutorInput<Omit<GatewayService, "listMessages">>;
  options: GatewayExecutorOptions;
  service: GatewayService;
  gateway: GatewayClient;
  prepared: Awaited<ReturnType<GatewayService["prepareTurn"]>>;
  state: GatewayConversationState;
  now: () => Date;
}) {
  const messages = await service.listMessages(
    input.actor,
    input.turn.conversationId,
  );
  const body = await readJsonBody(input.request);
  const context = buildGatewayNativeAssistantContext({
    auth: options.auth,
    conversationId: input.turn.conversationId,
    invocationId: input.turn.turnId,
    clientRequest: {
      message: stringValue(body.message) ?? latestUserMessage(messages),
      mode: body.mode === "deep" ? "deep" : prepared.turn.mode,
      pageContext: body.pageContext,
      attachmentIds: input.attachments
        .map((attachment) => attachment.fileId)
        .filter(isString),
    },
    personalMemoryRevision: options.personalMemoryRevision ?? 0,
    messages,
  });
  if (!context) {
    throw new GatewayExecutionError("gateway_context_invalid");
  }

  const sourceTurnId =
    options.sourceTurnId ??
    stringValue(recordValue(input.turn, "retryOfTurnId")) ??
    stringValue(recordValue(input.turn, "regenerateOfTurnId"));
  const sourceCheckpoint =
    sourceTurnId && service.getSourceGatewayCheckpoint
      ? await service.getSourceGatewayCheckpoint(input.actor, sourceTurnId)
      : null;
  if (
    sourceTurnId &&
    !isUsableCheckpoint(
      sourceCheckpoint,
      input.actor,
      input.turn.conversationId,
    )
  ) {
    throw new GatewayExecutionError("gateway_checkpoint_invalid");
  }

  const capability = await issueGatewayInvocationCapability({
    service,
    actor: input.actor,
    turn: input.turn,
    gatewayContext: {
      messages: [],
      attachments: input.attachments,
      mode: context.mode,
      primaryProvider: options.provider,
      lastUserMessage: context.message,
      responseMetadata: {
        grounding: {},
        knowledge: {},
        retrospectiveDraft: null,
      },
      invocationMetadata: { actor: context.actor },
    },
  });

  let preparation: GatewaySessionPreparation;
  const branchSession =
    sourceCheckpoint !== null && input.turn.attempt > 1
      ? gateway.branchSession
      : undefined;
  const sessionInput = {
    actor: context.actor,
    conversationId: input.turn.conversationId,
    invocationCapability: capability.invocationCapability,
    budget: context.budget,
    personalMemoryRevision: context.personalMemoryRevision,
    transcript: context.ledgerTranscript,
    attachments: normalizeAttachmentUpload(input.attachments),
  };
  try {
    if (sourceCheckpoint && branchSession) {
      const branched = await branchSession({
        sessionId: sourceCheckpoint.sessionId,
        actor: context.actor,
        conversationId: input.turn.conversationId,
        invocationCapability: capability.invocationCapability,
        checkpoint: {
          ...sourceCheckpoint,
          sourceTurnId,
        },
      });
      if (
        !isValidBranchedSessionId(
          branched.sessionId,
          sourceCheckpoint.sessionId,
        )
      ) {
        throw new GatewayExecutionError("gateway_checkpoint_invalid");
      }
      preparation = await persistPreparedGatewaySession({
        service,
        gateway,
        actor: input.actor,
        conversationId: input.turn.conversationId,
        options,
        capability,
        state,
        session: branched,
        action: "rebuilt",
        resumeInput: sessionInput,
        now,
      });
    } else {
      preparation = await prepareGatewaySession({
        service,
        gateway,
        actor: input.actor,
        conversationId: input.turn.conversationId,
        options,
        capability,
        state,
        createInput: sessionInput,
        now,
      });
    }
  } catch (error) {
    if (error instanceof GatewayExecutionError) throw error;
    throw new GatewayExecutionError("gateway_session_create_failed");
  }
  const checkpoint: GatewayCheckpoint = {
    sessionId: preparation.sessionId,
    ...(preparation.checkpointId
      ? { checkpointId: preparation.checkpointId }
      : {}),
    turnId: input.turn.turnId,
    conversationId: input.turn.conversationId,
    organizationId: input.actor.organizationId,
    ownerUserId: input.actor.userId,
  };
  const gatewayContext: ConversationGatewayContext = {
    messages: context.ledgerTranscript.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    attachments: input.attachments,
    mode: context.mode,
    primaryProvider: options.provider,
    lastUserMessage: context.message,
    responseMetadata: {
      grounding: {},
      knowledge: {},
      retrospectiveDraft: null,
    },
    invocationMetadata: {
      actor: context.actor,
      budget: context.budget,
      personalMemoryRevision: context.personalMemoryRevision,
      skillGrantsHash: context.actor.skillGrantsHash,
      capabilityId: capability.capabilityId,
      capabilityExpiresAt: capability.expiresAt,
      sessionId: preparation.sessionId,
      gatewayCheckpoint: checkpoint,
      sourceCheckpoint: sourceCheckpoint ?? null,
      frozenAt: now().toISOString(),
    },
  };
  if (!service.captureGatewayContext) {
    throw new GatewayExecutionError("gateway_context_not_frozen");
  }
  await service.captureGatewayContext(
    input.actor,
    input.turn.turnId,
    {
      version: prepared.snapshot.version,
      summaryVersion: prepared.snapshot.summaryVersion,
      messageIds: prepared.snapshot.messageIds ?? [],
      groundingRefs: prepared.snapshot.groundingRefs ?? [],
      assembledAt: prepared.snapshot.assembledAt ?? now().toISOString(),
    },
    gatewayContext,
  );
  return {
    context: gatewayContext,
    session: { sessionId: preparation.sessionId },
    checkpoint,
    captured: true,
    capability,
    action: preparation.action,
    state: preparation.state,
  };
}

async function issueGatewayInvocationCapability({
  service,
  actor,
  turn,
  gatewayContext,
}: {
  service: GatewayService;
  actor: ConversationActor;
  turn: CreatedConversationTurn;
  gatewayContext: ConversationGatewayContext;
}): Promise<GatewayIssuedCapability> {
  const gatewayActorSnapshot = recordValue(
    gatewayContext.invocationMetadata,
    "actor",
  ) as HermesActorProfile | undefined;
  if (!service.issueGatewayRootCapability || !gatewayActorSnapshot) {
    throw new GatewayExecutionError("gateway_capability_unavailable");
  }
  try {
    return await service.issueGatewayRootCapability(actor, {
      actor: gatewayActorSnapshot,
      mode: gatewayContext.mode,
      turn: { id: turn.turnId, conversationId: turn.conversationId },
      serverAllowedTools: allowedGatewayToolNames(gatewayActorSnapshot),
      approvedSkillDraftIds: approvedSkillDraftIds(gatewayActorSnapshot),
      aiStateWritesAllowed: false,
    });
  } catch {
    throw new GatewayExecutionError("gateway_capability_unavailable");
  }
}

function allowedGatewayToolNames(actor: HermesActorProfile): string[] {
  const scopes = Array.isArray(actor.allowedReadScopes)
    ? actor.allowedReadScopes
    : [];
  const readTools = Object.values(HERMES_READ_ENDPOINTS)
    .filter((endpoint) => scopes.includes(endpoint.requiredScope))
    .map((endpoint) => endpoint.toolName);
  return unique([
    ...readTools,
    HERMES_MEMORY_TOOL_NAMES[0],
    ...HERMES_SKILL_TOOL_NAMES,
  ]).sort();
}

function approvedSkillDraftIds(actor: HermesActorProfile): string[] {
  const skills = Array.isArray(actor.enabledSkillVersions)
    ? actor.enabledSkillVersions
    : [];
  return skills
    .map((skill) => skill.skillId)
    .filter((value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
    )
    .sort();
}

async function completeWithCoherentSummary({
  service,
  actor,
  turn,
  content,
  provider,
  model,
  observations,
  summary,
  forcedOutcome,
  state,
  telemetry,
}: {
  service: GatewayService;
  actor: ConversationActor;
  turn: CreatedConversationTurn;
  content: string;
  provider: AiProviderName;
  model: string;
  observations: ToolObservation[];
  summary: unknown;
  forcedOutcome?: ConversationResponseOutcome;
  state: Awaited<
    ReturnType<NonNullable<GatewayService["getGatewayState"]>>
  > | null;
  telemetry: BestEffortStageRecorder;
}): Promise<
  | { type: "completed"; event: ConversationStreamEvent }
  | { type: "failed"; code: string }
> {
  const outcome = forcedOutcome ?? classifyOutcome(observations);
  const metadata = completionMetadata({ observations, provider, model });
  const expectedSummaryVersion = state?.summaryVersion ?? 0;
  telemetry.record("terminal");
  try {
    await service.finishTurnV2(actor, turn.turnId, {
      invocationId: turn.turnId,
      outcome,
      content,
      providerName: provider,
      errorCode: null,
      errorSummary: null,
      retryable: false,
      metadata,
    });
    telemetry.record("persisted");
  } catch {
    await persistTerminalFailure({
      service,
      actor,
      turn,
      content,
      provider,
      model,
      code: "gateway_terminal_persist_failed",
      retryable: true,
      telemetry,
    });
    return { type: "failed", code: "gateway_terminal_persist_failed" };
  }
  if (isRecord(summary) && service.syncConversationSummary) {
    try {
      await service.syncConversationSummary(actor, turn.conversationId, {
        expectedSummaryVersion,
        summary,
      });
    } catch {
      // Terminal persistence already succeeded. Summary synchronization is
      // retried by later turns; do not mutate the product-visible terminal state.
    }
  }
  return {
    type: "completed",
    event: {
      type: "response.completed",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      messageId: turn.assistantMessageId,
      content,
      outcome,
      evidence: metadata.evidence,
      missing: metadata.missing,
      observationTimes: metadata.observationTimes,
      meta: metadata,
      invocationId: turn.turnId,
    },
  };
}

async function persistTerminalFailure({
  service,
  actor,
  turn,
  content,
  provider,
  model,
  code,
  retryable,
  telemetry,
}: {
  service: GatewayService;
  actor: ConversationActor;
  turn: CreatedConversationTurn;
  content: string;
  provider: AiProviderName;
  model: string;
  code: string;
  retryable: boolean;
  telemetry: BestEffortStageRecorder;
}) {
  telemetry.record("terminal");
  await service.finishTurnV2(actor, turn.turnId, {
    invocationId: turn.turnId,
    outcome: "failed",
    content,
    providerName: provider,
    errorCode: code,
    errorSummary: code,
    retryable,
    metadata: {
      traceCode: code,
      provider,
      model,
    },
  });
  telemetry.record("persisted");
}

function terminalGatewayEvent(event: unknown):
  | {
      status: "completed";
      summary?: unknown;
      code?: string;
      outcome?: ConversationResponseOutcome;
      message?: string;
      observation?: ToolObservation;
    }
  | {
      status: "failed";
      summary?: unknown;
      code?: string;
      outcome?: ConversationResponseOutcome;
      message?: string;
      observation?: ToolObservation;
    }
  | {
      status: "cancelled";
      summary?: unknown;
      code?: string;
      outcome?: ConversationResponseOutcome;
      message?: string;
      observation?: ToolObservation;
    }
  | null {
  const official = parseHermesGatewayEvent(event);
  if (official?.params.type === "turn.terminal") {
    const payload = official.params.payload;
    const status =
      payload.outcome === "failed"
        ? "failed"
        : payload.outcome === "cancelled"
          ? "cancelled"
          : "completed";
    return {
      status,
      code:
        payload.outcome === "failed"
          ? (sanitizeTraceCode(payload.message) ?? "provider_failed")
          : undefined,
      outcome: isConversationOutcome(payload.outcome)
        ? payload.outcome
        : undefined,
      message: payload.message,
      observation: observationFromGatewayMetadata(payload.metadata),
    };
  }
  if (!isRecord(event)) return null;
  if (event.type === "completed") {
    return { status: "completed", summary: event.summary };
  }
  if (event.type === "failed") {
    return {
      status: "failed",
      code: sanitizeTraceCode(event.code) ?? undefined,
    };
  }
  if (event.type === "cancelled") return { status: "cancelled" };
  if (event.type === "turn.terminal") {
    const status =
      event.status === "failed" || event.status === "error"
        ? "failed"
        : event.status === "cancelled"
          ? "cancelled"
          : "completed";
    return {
      status,
      code: sanitizeTraceCode(event.code) ?? undefined,
      summary: event.summary,
    };
  }
  return null;
}

class GatewayExecutionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "GatewayExecutionError";
  }
}

function failedEvent(
  turn: CreatedConversationTurn,
  code: string,
  retryable: boolean,
): ConversationStreamEvent {
  return {
    type: "response.failed",
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    code,
    retryable,
    message: code,
    invocationId: turn.turnId,
  };
}

function frozenGatewayContext(
  value: unknown,
): ConversationGatewayContext | null {
  return isRecord(value) &&
    Array.isArray(value.messages) &&
    typeof value.lastUserMessage === "string" &&
    isRecord(value.invocationMetadata)
    ? (value as ConversationGatewayContext)
    : null;
}

function checkpointFromMetadata(value: unknown): GatewayCheckpoint | null {
  if (!isRecord(value)) return null;
  const sessionId = stringValue(value.sessionId);
  const turnId = stringValue(value.turnId);
  const conversationId = stringValue(value.conversationId);
  const organizationId = stringValue(value.organizationId);
  const ownerUserId = stringValue(value.ownerUserId);
  if (
    !sessionId ||
    !turnId ||
    !conversationId ||
    !organizationId ||
    !ownerUserId
  ) {
    return null;
  }
  return {
    sessionId,
    turnId,
    conversationId,
    organizationId,
    ownerUserId,
    ...(stringValue(value.checkpointId)
      ? { checkpointId: stringValue(value.checkpointId)! }
      : {}),
  };
}

function parentTurnId(turn: CreatedConversationTurn): string | null {
  return (
    stringValue(recordValue(turn, "retryOfTurnId")) ??
    stringValue(recordValue(turn, "regenerateOfTurnId"))
  );
}

function isUsableCheckpoint(
  checkpoint: GatewayCheckpoint | null,
  actor: ConversationActor,
  conversationId: string,
): checkpoint is GatewayCheckpoint {
  return (
    checkpoint !== null &&
    checkpoint.conversationId === conversationId &&
    checkpoint.organizationId === actor.organizationId &&
    checkpoint.ownerUserId === actor.userId
  );
}

function isValidBranchedSessionId(
  branchSessionId: unknown,
  sourceSessionId: string,
): branchSessionId is string {
  const sessionId = stringValue(branchSessionId);
  return !!sessionId && sessionId !== sourceSessionId;
}

export function resolveHermesGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): HermesGatewayClientConfig | null {
  return resolveOfficialHermesGatewayConfig(env);
}

export function createHermesGatewayClient({
  config = resolveHermesGatewayConfig(),
  actorAssertionConfig = resolveHermesRuntimeConfig(),
  openSession = openHermesGatewaySession,
  attachBytes = attachHermesGatewayBytes,
  createActorAssertion = ({ actor, config }) =>
    createHermesActorAssertionForRun({ actor, config, runtime: "gateway" }),
}: {
  config?: HermesGatewayClientConfig | null;
  actorAssertionConfig?: HermesRuntimeConfig | null;
  openSession?: typeof openHermesGatewaySession;
  attachBytes?: typeof attachHermesGatewayBytes;
  createActorAssertion?: (input: {
    actor: HermesActorProfile;
    config: HermesRuntimeConfig;
  }) => Promise<string>;
} = {}): GatewayClient {
  let session:
    | (HermesGatewaySession & {
        rpc?: (
          method: string,
          params: Record<string, unknown>,
        ) => Promise<unknown>;
      })
    | null = null;
  let ambiguousPromptSubmitError: HermesGatewayError | null = null;
  return {
    async createSession(input) {
      session = await openOfficialGatewaySession({
        input,
        config,
        actorAssertionConfig,
        openSession,
        createActorAssertion,
      });
      await attachGatewayBytes(session, input, attachBytes);
      return { sessionId: session.sessionId };
    },
    async resumeSession(input) {
      const sessionId = stringValue(input.sessionId);
      if (!sessionId) {
        throw new GatewayExecutionError("gateway_session_resume_failed");
      }
      session = await openOfficialGatewaySession({
        input,
        config,
        actorAssertionConfig,
        openSession,
        createActorAssertion,
        sessionId,
      });
      await attachGatewayBytes(session, input, attachBytes);
      return { sessionId: session.sessionId };
    },
    async branchSession(input) {
      const sourceSessionId = stringValue(input.sessionId);
      if (!sourceSessionId) {
        throw new GatewayExecutionError("gateway_checkpoint_invalid");
      }
      session = await openOfficialGatewaySession({
        input,
        config,
        actorAssertionConfig,
        openSession,
        createActorAssertion,
        sessionId: sourceSessionId,
      });
      const result = await session.branch(
        stringValue(input.conversationId) ?? gatewayActor(input).conversationId,
      );
      const branchedSessionId = isRecord(result)
        ? stringValue(result.sessionId)
        : null;
      if (!branchedSessionId || branchedSessionId === sourceSessionId) {
        session.close();
        session = null;
        throw new GatewayExecutionError("gateway_checkpoint_invalid");
      }
      session.close();
      session = null;
      session = await openOfficialGatewaySession({
        input,
        config,
        actorAssertionConfig,
        openSession,
        createActorAssertion,
        sessionId: branchedSessionId,
      });
      return { sessionId: branchedSessionId };
    },
    async *submitPrompt(input) {
      const sessionId = stringValue(input.sessionId);
      if (!sessionId || !session || session.sessionId !== sessionId) {
        throw new GatewayExecutionError("gateway_checkpoint_invalid");
      }
      if (!session.rpc) {
        throw new GatewayExecutionError("gateway_protocol_failed");
      }
      let acknowledgement: unknown;
      try {
        acknowledgement = await session.rpc("prompt.submit", {
          conversationId:
            stringValue(input.conversationId) ??
            gatewayActor(input).conversationId,
          text: stringValue(input.prompt) ?? "",
          mode: input.mode === "deep" ? "deep" : "fast",
        });
      } catch (error) {
        ambiguousPromptSubmitError = isAmbiguousHermesGatewayTransportError(
          error,
        )
          ? error
          : null;
        throw error;
      }
      if (!isRecord(acknowledgement) || acknowledgement.accepted !== true) {
        ambiguousPromptSubmitError = null;
        throw new GatewayExecutionError("gateway_prompt_not_accepted");
      }
      ambiguousPromptSubmitError = null;
      yield { type: "prompt.accepted" };
      yield* session.events;
    },
    async *recoverSession(input) {
      const sessionId = stringValue(input.sessionId);
      if (!sessionId || !session || session.sessionId !== sessionId) {
        throw new GatewayExecutionError("gateway_checkpoint_invalid");
      }
      try {
        await session.recover();
        await session.waitForAccepted();
      } catch (error) {
        if (
          ambiguousPromptSubmitError &&
          error instanceof HermesGatewayError &&
          error.code === "hermes_gateway_prompt_not_accepted"
        ) {
          const transportError = ambiguousPromptSubmitError;
          ambiguousPromptSubmitError = null;
          throw transportError;
        }
        ambiguousPromptSubmitError = null;
        throw error;
      }
      ambiguousPromptSubmitError = null;
      yield { type: "prompt.accepted" };
      yield* session.events;
    },
    async interruptSession(input) {
      const sessionId = stringValue(input.sessionId);
      if (!sessionId || !session || session.sessionId !== sessionId) {
        throw new GatewayExecutionError("gateway_checkpoint_invalid");
      }
      return session.interrupt();
    },
    async respondToClarify(input) {
      const sessionId = stringValue(input.sessionId);
      const requestId = stringValue(input.requestId);
      const answer = stringValue(input.answer);
      if (
        !sessionId ||
        !requestId ||
        !answer ||
        !session ||
        session.sessionId !== sessionId
      ) {
        throw new GatewayExecutionError("gateway_checkpoint_invalid");
      }
      return session.respondToClarify({ requestId, answer });
    },
    closeSession(input) {
      const sessionId = stringValue(input.sessionId);
      if (sessionId && session?.sessionId === sessionId) {
        session.close();
        session = null;
      }
    },
  };
}

async function openOfficialGatewaySession({
  input,
  config,
  actorAssertionConfig,
  openSession,
  createActorAssertion,
  sessionId,
}: {
  input: Record<string, unknown>;
  config: HermesGatewayClientConfig | null;
  actorAssertionConfig: HermesRuntimeConfig | null;
  openSession: typeof openHermesGatewaySession;
  createActorAssertion: (input: {
    actor: HermesActorProfile;
    config: HermesRuntimeConfig;
  }) => Promise<string>;
  sessionId?: string;
}): Promise<
  HermesGatewaySession & {
    rpc?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  }
> {
  if (!config || !actorAssertionConfig) {
    throw new GatewayExecutionError("gateway_config_missing");
  }
  const actor = gatewayActor(input);
  const invocationCapability = stringValue(input.invocationCapability);
  if (!invocationCapability) {
    throw new GatewayExecutionError("gateway_capability_unavailable");
  }
  const actorAssertion = await createActorAssertion({
    actor,
    config: actorAssertionConfig,
  });
  return openSession({
    config,
    actor,
    actorAssertion,
    invocationCapability,
    conversationId: stringValue(input.conversationId) ?? actor.conversationId,
    ...(sessionId ? { sessionId } : {}),
  });
}

function gatewayActor(input: Record<string, unknown>): HermesActorProfile {
  const actor = recordValue(input, "actor");
  if (!actor) {
    throw new GatewayExecutionError("gateway_actor_invalid");
  }
  return actor as unknown as HermesActorProfile;
}

async function attachGatewayBytes(
  session: HermesGatewaySession,
  input: Record<string, unknown>,
  attachBytes: typeof attachHermesGatewayBytes,
): Promise<void> {
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  for (const attachment of attachments) {
    const upload = gatewayByteAttachment(attachment);
    if (upload) await attachBytes(session, upload);
  }
}

function gatewayByteAttachment(
  value: unknown,
): HermesGatewayByteAttachment | null {
  if (!isRecord(value)) return null;
  const attachmentId = stringValue(value.fileId);
  const filename = stringValue(value.name);
  const mimeType = stringValue(value.mimeType);
  if (!attachmentId || !filename || !mimeType) return null;
  if (typeof value.data === "string" && value.data.trim()) {
    return {
      attachmentId,
      filename,
      mimeType,
      bytes: Buffer.from(value.data.trim(), "base64"),
    };
  }
  if (typeof value.text === "string" && value.text.trim()) {
    return {
      attachmentId,
      filename,
      mimeType,
      bytes: Buffer.from(value.text, "utf8"),
    };
  }
  return null;
}

type ToolObservation = {
  status: "completed" | "failed" | "denied";
  evidence: string[];
  missing: string[];
  observedAt?: string;
  critical: boolean;
};

function classifyOutcome(
  observations: ToolObservation[],
): ConversationResponseOutcome {
  if (observations.length === 0) return "complete";
  const successful = observations.some(
    (observation) => observation.status === "completed",
  );
  const criticalFailures = observations.filter(
    (observation) =>
      observation.critical &&
      (observation.status === "failed" || observation.status === "denied"),
  );
  if (!successful && criticalFailures.length > 0) return "blocked";
  if (
    observations.some(
      (observation) =>
        observation.status === "failed" ||
        observation.status === "denied" ||
        observation.missing.length > 0,
    )
  ) {
    return "partial";
  }
  return "complete";
}

function completionMetadata({
  observations,
  provider,
  model,
}: {
  observations: ToolObservation[];
  provider: AiProviderName;
  model: string;
}): {
  evidence: string[];
  missing: string[];
  observationTimes: {
    firstObservedAt: string | null;
    lastObservedAt: string | null;
  };
  provider: AiProviderName;
  model: string;
  summarySync?: { status: "synced" | "failed"; expectedSummaryVersion: number };
} {
  const evidence = unique(
    observations.flatMap((observation) => observation.evidence),
  );
  const missing = unique(
    observations.flatMap((observation) => observation.missing),
  );
  const observedAt = observations
    .map((observation) => observation.observedAt)
    .filter(isString)
    .sort();
  return {
    evidence,
    missing,
    observationTimes: {
      firstObservedAt: observedAt[0] ?? null,
      lastObservedAt: observedAt.at(-1) ?? null,
    },
    provider,
    model,
  };
}

function normalizeGatewayEvent(
  event: unknown,
  turn: CreatedConversationTurn,
): ConversationStreamEvent | null {
  const official = parseHermesGatewayEvent(event);
  if (official) return normalizeOfficialGatewayEvent(official, turn);
  if (!isRecord(event)) return null;
  if (event.type === "activity") {
    const label = stringValue(event.label);
    if (!label) return null;
    return {
      type: "activity.updated",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      label,
      status:
        statusValue(event.status, [
          "pending",
          "running",
          "completed",
          "failed",
        ]) ?? "running",
    };
  }
  if (event.type === "tool.call") {
    const toolCallId = stringValue(event.id);
    const toolName = stringValue(event.name);
    if (!toolCallId || !toolName) return null;
    return {
      type: "tool.started",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      toolCallId,
      toolName,
      label: stringValue(event.label) ?? toolName,
    };
  }
  if (event.type === "tool.started") {
    const toolCallId = stringValue(event.toolCallId);
    const toolName = stringValue(event.toolName);
    if (!toolCallId || !toolName) return null;
    return {
      type: "tool.started",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      toolCallId,
      toolName,
      label: stringValue(event.label) ?? toolName,
    };
  }
  if (event.type === "tool.completed") {
    const toolCallId = stringValue(event.toolCallId);
    const toolName = stringValue(event.toolName);
    if (!toolCallId || !toolName) return null;
    return {
      type: "tool.completed",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      toolCallId,
      toolName,
      label: stringValue(event.label) ?? toolName,
      status:
        statusValue(event.status, ["completed", "failed", "denied"]) ??
        "completed",
      evidence: stringList(event.evidenceRefs),
      missing: stringList(event.missing),
      ...(isString(event.observedAt) ? { observedAt: event.observedAt } : {}),
    };
  }
  if (event.type === "tool.complete") {
    const toolCallId = stringValue(event.id);
    const toolName = stringValue(event.name);
    if (!toolCallId || !toolName) return null;
    const metadata = isRecord(event.metadata) ? event.metadata : {};
    const permissionDenials = stringList(metadata.permissionDenials);
    const missingData = stringList(metadata.missingData);
    const status =
      permissionDenials.length > 0
        ? "denied"
        : event.status === "error"
          ? "failed"
          : "completed";
    return {
      type: "tool.completed",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      toolCallId,
      toolName,
      label: stringValue(event.label) ?? toolName,
      status,
      evidence: gatewayEvidence(metadata),
      missing: unique([...missingData, ...permissionDenials]),
      ...(isString(metadata.updatedAt)
        ? { observedAt: metadata.updatedAt }
        : {}),
    };
  }
  if (
    event.type === "text.delta" ||
    event.type === "response.output_text.delta"
  ) {
    return {
      type: "response.delta",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      messageId: turn.assistantMessageId,
      delta: typeof event.delta === "string" ? event.delta : "",
    };
  }
  return null;
}

async function persistGatewayClarifyRequest({
  service,
  actor,
  turn,
  state,
  event,
}: {
  service: GatewayService;
  actor: ConversationActor;
  turn: CreatedConversationTurn;
  state: Awaited<
    ReturnType<NonNullable<GatewayService["getGatewayState"]>>
  > | null;
  event: Extract<ConversationStreamEvent, { type: "clarify.requested" }>;
}) {
  if (!state) throw new GatewayExecutionError("gateway_state_conflict");
  const pendingClarify = {
    turnId: turn.turnId,
    clarifyId: event.clarifyId,
    requestId: event.clarifyId,
    question: event.question,
    choices: event.choices ?? [],
    allowFreeText: event.allowFreeText === true,
  };
  const nextGeneration = state.generation + 1;
  const nextState = {
    ...copyGatewayReusableSessionEnvelope(state, nextGeneration),
    ...copyGatewayChildSessionControl(state),
    pendingClarify,
  };
  try {
    await service.compareAndSwapGatewayState(
      actor,
      turn.conversationId,
      state.generation,
      nextState,
    );
  } catch {
    throw new GatewayExecutionError("gateway_state_conflict");
  }
  activeHermesRunRegistry.setPendingClarify({
    actor,
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    clarifyId: event.clarifyId,
    choices: pendingClarify.choices,
    allowFreeText: pendingClarify.allowFreeText,
  });
  return {
    ...state,
    generation: nextGeneration,
    pendingClarify,
  };
}

function normalizeOfficialGatewayEvent(
  event: HermesGatewayEvent,
  turn: CreatedConversationTurn,
): ConversationStreamEvent | null {
  if (event.params.type === "gateway.ready") return null;
  switch (event.params.type) {
    case "message.delta": {
      const payload = event.params.payload;
      return {
        type: "response.delta",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        messageId: turn.assistantMessageId,
        delta: payload.text,
      };
    }
    case "tool.start": {
      const payload = event.params.payload;
      return {
        type: "tool.started",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        toolCallId: payload.toolCallId,
        toolName: payload.name,
        label: payload.label,
      };
    }
    case "tool.complete": {
      const payload = event.params.payload;
      const metadata = payload.metadata;
      const status =
        metadata.permissionDenials.length > 0
          ? "denied"
          : payload.status === "error"
            ? "failed"
            : "completed";
      return {
        type: "tool.completed",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        toolCallId: payload.toolCallId,
        toolName: payload.name,
        label: payload.summary || payload.name,
        status,
        evidence: metadata.evidenceRefs,
        missing: unique([
          ...metadata.missingData,
          ...metadata.permissionDenials,
        ]),
        observedAt: metadata.updatedAt,
      };
    }
    case "status.update": {
      const payload = event.params.payload;
      return {
        type: "activity.updated",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        label: payload.message,
        status: payload.status === "ready" ? "completed" : "running",
      };
    }
    case "todo.updated": {
      const payload = event.params.payload;
      return {
        type: "todo.updated",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        items: payload.todos.map((todo) => ({
          id: todo.id,
          label: todo.content,
          status:
            todo.status === "completed"
              ? "done"
              : todo.status === "in_progress"
                ? "running"
                : "pending",
        })),
      };
    }
    case "clarify.request": {
      const payload = event.params.payload;
      return {
        type: "clarify.requested",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        clarifyId: payload.requestId,
        question: payload.question,
        choices: payload.choices,
        allowFreeText: payload.allowFreeText === true,
      };
    }
    case "subagent.start": {
      const payload = event.params.payload;
      return {
        type: "subagent.updated",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        subagentId: payload.subagentId,
        label: payload.goal,
        status: "running",
      };
    }
    case "subagent.progress": {
      const payload = event.params.payload;
      return {
        type: "subagent.updated",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        subagentId: payload.subagentId,
        label: payload.summary,
        status: payload.status === "completed" ? "completed" : "running",
      };
    }
    case "subagent.complete": {
      const payload = event.params.payload;
      return {
        type: "subagent.updated",
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        subagentId: payload.subagentId,
        label: payload.summary,
        status: payload.outcome === "failed" ? "failed" : "completed",
      };
    }
    default:
      return null;
  }
}

function isCriticalToolFailure(event: unknown): boolean {
  const official = parseHermesGatewayEvent(event);
  if (official?.params.type === "tool.complete") {
    return (
      official.params.payload.metadata.permissionDenials.length > 0 &&
      official.params.payload.status === "error"
    );
  }
  if (!isRecord(event)) return false;
  if (event.type === "tool.completed") return event.critical === true;
  if (event.type !== "tool.complete") return false;
  const metadata = isRecord(event.metadata) ? event.metadata : {};
  return metadata.critical === true || metadata.taskCritical === true;
}

function observationFromGatewayMetadata(
  metadata: HermesToolResultMetadata,
): ToolObservation {
  const missing = unique([
    ...metadata.missingData,
    ...metadata.permissionDenials,
  ]);
  return {
    status: metadata.permissionDenials.length > 0 ? "denied" : "completed",
    evidence: metadata.evidenceRefs,
    missing,
    observedAt: metadata.updatedAt,
    critical: false,
  };
}

function isConversationOutcome(
  value: unknown,
): value is ConversationResponseOutcome {
  return value === "complete" || value === "partial" || value === "blocked";
}

function gatewayEvidence(metadata: Record<string, unknown>): string[] {
  const evidence = stringList(metadata.evidence);
  return evidence.length ? evidence : stringList(metadata.evidenceRefs);
}

function gatewayTraceCode(value: unknown): string {
  const code = sanitizeTraceCode(value) ?? "provider_failed";
  return code.startsWith("gateway_") ? code : `gateway_${code}`;
}

function sanitizeTraceCode(value: unknown): string | null {
  const raw = stringValue(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_");
  if (!raw) return null;
  return raw.slice(0, 80);
}

function started(turn: CreatedConversationTurn): ConversationStreamEvent {
  return {
    type: "turn.started",
    conversationId: turn.conversationId,
    turnId: turn.turnId,
    userMessageId: turn.userMessageId,
    assistantMessageId: turn.assistantMessageId,
  };
}

function normalizeAttachmentUpload(attachments: AiAttachment[]) {
  return attachments.map((attachment) => ({
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    fileId: attachment.fileId,
  }));
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const body = (await request.clone().json()) as unknown;
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function latestUserMessage(
  messages: Array<
    Parameters<typeof buildGatewayNativeAssistantContext>[0]["messages"][number]
  >,
): string {
  return (
    [...messages].reverse().find((message) => message.role === "user")
      ?.content ?? ""
  );
}

function statusValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter(isString)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
