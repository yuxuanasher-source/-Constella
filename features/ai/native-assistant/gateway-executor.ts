import type {
  ConversationGatewayContext,
  ConversationResponseOutcome,
  ConversationStreamEvent,
} from "../conversation-contracts";
import type { AiAttachment, AiProviderName } from "../contracts";
import type {
  ConversationTurnExecutor,
  ConversationTurnExecutorInput,
} from "../conversation-stream-adapter";
import type { CreatedConversationTurn } from "../conversation-repository";
import type { ConversationActor } from "../conversation-service";
import { HERMES_PROTOCOL_VERSION } from "../hermes/contracts";
import {
  createHermesActorAssertionForRun,
  resolveHermesRuntimeConfig,
  type HermesRuntimeConfig,
} from "../hermes/runtime-client";
import type { HermesActorProfile } from "../hermes/contracts";
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
  ): Promise<Array<Parameters<typeof buildGatewayNativeAssistantContext>[0]["messages"][number]>>;
  getGatewayState?(
    actor: ConversationActor,
    conversationId: string,
  ): Promise<{
    generation: number;
    sessionId?: string;
    summary?: Record<string, unknown>;
    summaryVersion?: number;
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
  renewLeaseV2?(actor: ConversationActor, turnId: string): Promise<void>;
};

type GatewayClient = {
  createSession(input: Record<string, unknown>): Promise<{ sessionId: string }>;
  branchSession?(input: Record<string, unknown>): Promise<{ sessionId: string }>;
  submitPrompt(input: Record<string, unknown>): AsyncIterable<GatewayRuntimeEvent>;
};

type GatewayRuntimeEvent =
  | {
      type: "activity";
      label?: unknown;
      status?: unknown;
      reasoning?: unknown;
    }
  | {
      type: "tool.started";
      toolCallId?: unknown;
      toolName?: unknown;
      label?: unknown;
    }
  | {
      type: "tool.completed";
      toolCallId?: unknown;
      toolName?: unknown;
      status?: unknown;
      label?: unknown;
      evidenceRefs?: unknown;
      missing?: unknown;
      observedAt?: unknown;
      critical?: unknown;
    }
  | {
      type: "tool.call";
      id?: unknown;
      name?: unknown;
      label?: unknown;
    }
  | {
      type: "tool.complete";
      id?: unknown;
      name?: unknown;
      status?: unknown;
      label?: unknown;
      metadata?: unknown;
    }
  | { type: "text.delta"; delta?: unknown }
  | { type: "response.output_text.delta"; delta?: unknown }
  | { type: "completed"; sessionId?: unknown; summary?: unknown }
  | { type: "turn.terminal"; status?: unknown; code?: unknown; summary?: unknown }
  | { type: "failed"; code?: unknown; retryable?: unknown }
  | { type: "cancelled"; invocationId?: unknown };

export type GatewayCheckpoint = {
  sessionId: string;
  checkpointId?: string;
  turnId: string;
  conversationId: string;
  organizationId: string;
  ownerUserId: string;
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
};

export function createGatewayTurnExecutor(
  options: GatewayExecutorOptions,
): ConversationTurnExecutor<Omit<GatewayService, "listMessages">> {
  const gateway = options.gateway ?? createHermesGatewayClient();
  return {
    async *execute(input: ConversationTurnExecutorInput<Omit<GatewayService, "listMessages">>) {
      const service = options.service;
      const now = options.now ?? (() => new Date());
      let content = "";
      let state: Awaited<ReturnType<NonNullable<GatewayService["getGatewayState"]>>> | null = null;

      yield started(input.turn);

      try {
        const prepared = await service.prepareTurn(
          input.actor,
          input.turn.turnId,
          [],
        );
        state =
          (await service.getGatewayState?.(
            input.actor,
            input.turn.conversationId,
          )) ?? { generation: 0, summary: {}, summaryVersion: prepared.snapshot.summaryVersion };
        const frozen = frozenGatewayContext(prepared.snapshot.gatewayContext);
        const sessionSetup = frozen
          ? {
              context: frozen,
              session: {
                sessionId:
                  stringValue(frozen.invocationMetadata.sessionId) ??
                  stringValue(
                    recordValue(
                      frozen.invocationMetadata.gatewayCheckpoint,
                      "sessionId",
                    ),
                  ) ??
                  state.sessionId ??
                  "",
              },
              checkpoint: checkpointFromMetadata(
                frozen.invocationMetadata.gatewayCheckpoint,
              ),
              captured: true,
            }
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

        yield {
          type: "context.ready",
          conversationId: input.turn.conversationId,
          turnId: input.turn.turnId,
          snapshotVersion: prepared.snapshot.version,
        };

        if (!sessionSetup.captured) {
          throw new GatewayExecutionError("gateway_context_not_frozen");
        }

        if (!frozen) {
          const nextGeneration = state.generation + 1;
          try {
            await service.compareAndSwapGatewayState(
              input.actor,
              input.turn.conversationId,
              state.generation,
              {
                generation: nextGeneration,
                sessionId: sessionSetup.session.sessionId,
                provider: options.provider,
                model: options.model,
                rebuiltAt: now().toISOString(),
                checkpoint: sessionSetup.checkpoint,
              },
            );
          } catch {
            throw new GatewayExecutionError("gateway_state_conflict");
          }
        }

        const observations: ToolObservation[] = [];
        try {
          for await (const gatewayEvent of gateway.submitPrompt({
            sessionId: sessionSetup.session.sessionId,
            prompt: sessionSetup.context.lastUserMessage,
            actor:
              recordValue(sessionSetup.context.invocationMetadata, "actor") ??
              options.auth,
            provider: options.provider,
            model: options.model,
          })) {
            const terminal = terminalGatewayEvent(gatewayEvent);
            if (terminal) {
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
                const code = gatewayTraceCode(terminal.code ?? "provider_failed");
                await persistTerminalFailure({
                  service,
                  actor: input.actor,
                  turn: input.turn,
                  content,
                  provider: options.provider,
                  model: options.model,
                  code,
                  retryable: true,
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
                state,
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
            if (event.type === "response.delta") content += event.delta;
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
          throw new GatewayExecutionError("gateway_stream_failed");
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
          });
        } catch {
          throw new Error("AI terminal state could not be persisted");
        }
        yield failedEvent(input.turn, code, true);
      }
    },
  };
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
  state: NonNullable<
    Awaited<ReturnType<NonNullable<GatewayService["getGatewayState"]>>>
  >;
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
  if (sourceTurnId && !isUsableCheckpoint(sourceCheckpoint, input.actor, input.turn.conversationId)) {
    throw new GatewayExecutionError("gateway_checkpoint_invalid");
  }

  let session: { sessionId: string };
  try {
    session =
      sourceCheckpoint && input.turn.attempt > 1 && gateway.branchSession
        ? await gateway.branchSession({
            sessionId: sourceCheckpoint.sessionId,
            actor: context.actor,
            checkpoint: {
              ...sourceCheckpoint,
              sourceTurnId,
            },
          })
        : await gateway.createSession({
            actor: context.actor,
            budget: context.budget,
            personalMemoryRevision: context.personalMemoryRevision,
            transcript: context.ledgerTranscript,
            attachments: normalizeAttachmentUpload(input.attachments),
          });
  } catch {
    throw new GatewayExecutionError("gateway_session_create_failed");
  }

  const checkpoint: GatewayCheckpoint = {
    sessionId: session.sessionId,
    checkpointId: sourceCheckpoint?.checkpointId,
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
      sessionId: session.sessionId,
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
  return { context: gatewayContext, session, checkpoint, captured: true };
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
  state,
}: {
  service: GatewayService;
  actor: ConversationActor;
  turn: CreatedConversationTurn;
  content: string;
  provider: AiProviderName;
  model: string;
  observations: ToolObservation[];
  summary: unknown;
  state: Awaited<ReturnType<NonNullable<GatewayService["getGatewayState"]>>> | null;
}): Promise<
  | { type: "completed"; event: ConversationStreamEvent }
  | { type: "failed"; code: string }
> {
  const outcome = classifyOutcome(observations);
  const metadata = completionMetadata({ observations, provider, model });
  let summaryAdvanced = false;
  const expectedSummaryVersion =
    state?.summaryVersion ?? 0;
  if (isRecord(summary) && service.syncConversationSummary) {
    try {
      await service.syncConversationSummary(actor, turn.conversationId, {
        expectedSummaryVersion,
        summary,
      });
      summaryAdvanced = true;
    } catch {
      await persistTerminalFailure({
        service,
        actor,
        turn,
        content,
        provider,
        model,
        code: "gateway_summary_conflict",
        retryable: true,
      });
      return { type: "failed", code: "gateway_summary_conflict" };
    }
  }
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
  } catch {
    if (summaryAdvanced && service.syncConversationSummary) {
      await service.syncConversationSummary(actor, turn.conversationId, {
        expectedSummaryVersion: expectedSummaryVersion + 1,
        summary: state?.summary ?? {},
      });
    }
    await persistTerminalFailure({
      service,
      actor,
      turn,
      content,
      provider,
      model,
      code: "gateway_terminal_persist_failed",
      retryable: true,
    });
    return { type: "failed", code: "gateway_terminal_persist_failed" };
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
}: {
  service: GatewayService;
  actor: ConversationActor;
  turn: CreatedConversationTurn;
  content: string;
  provider: AiProviderName;
  model: string;
  code: string;
  retryable: boolean;
}) {
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
}

function terminalGatewayEvent(event: GatewayRuntimeEvent):
  | { status: "completed"; summary?: unknown; code?: string }
  | { status: "failed"; summary?: unknown; code?: string }
  | { status: "cancelled"; summary?: unknown; code?: string }
  | null {
  if (event.type === "completed") {
    return { status: "completed", summary: event.summary };
  }
  if (event.type === "failed") {
    return { status: "failed", code: sanitizeTraceCode(event.code) ?? undefined };
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
  if (!sessionId || !turnId || !conversationId || !organizationId || !ownerUserId) {
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

export function resolveHermesGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): HermesRuntimeConfig | null {
  return resolveHermesRuntimeConfig(env);
}

export function createHermesGatewayClient({
  config = resolveHermesGatewayConfig(),
  fetchImpl = fetch,
}: {
  config?: HermesRuntimeConfig | null;
  fetchImpl?: typeof fetch;
} = {}): GatewayClient {
  return {
    createSession(input) {
      return createHermesGatewaySession({
        config,
        fetchImpl,
        path: "/v1/xingyao/gateway/sessions",
        input,
      });
    },
    branchSession(input) {
      const sourceSessionId = stringValue(input.sessionId);
      if (!sourceSessionId) {
        throw new GatewayExecutionError("gateway_checkpoint_invalid");
      }
      return createHermesGatewaySession({
        config,
        fetchImpl,
        path: `/v1/xingyao/gateway/sessions/${encodeURIComponent(sourceSessionId)}/branch`,
        input,
      });
    },
    async *submitPrompt(input) {
      const resolvedConfig = requireGatewayConfig(config);
      const actor = gatewayActor(input);
      const sessionId = stringValue(input.sessionId);
      if (!sessionId) {
        throw new GatewayExecutionError("gateway_checkpoint_invalid");
      }
      const actorAssertion = await createHermesActorAssertionForRun({
        actor,
        config: resolvedConfig,
      });
      const response = await fetchImpl(
        `${resolvedConfig.baseUrl}/v1/xingyao/gateway/sessions/${encodeURIComponent(sessionId)}/prompt`,
        {
          method: "POST",
          headers: gatewayHeaders(resolvedConfig, actorAssertion, {
            "Idempotency-Key": actor.invocationId,
          }),
          body: JSON.stringify({
            protocolVersion: HERMES_PROTOCOL_VERSION,
            prompt: input.prompt,
            provider: input.provider,
            model: input.model,
          }),
        },
      );
      if (!response.ok) {
        throw new GatewayExecutionError("gateway_provider_failed");
      }
      yield* readGatewayEvents(response);
    },
  };
}

export async function createHermesGatewaySession({
  config,
  fetchImpl = fetch,
  path,
  input,
}: {
  config?: HermesRuntimeConfig | null;
  fetchImpl?: typeof fetch;
  path: string;
  input: Record<string, unknown>;
}): Promise<{ sessionId: string }> {
  const resolvedConfig = requireGatewayConfig(config);
  const actor = gatewayActor(input);
  const actorAssertion = await createHermesActorAssertionForRun({
    actor,
    config: resolvedConfig,
  });
  const response = await fetchImpl(`${resolvedConfig.baseUrl}${path}`, {
    method: "POST",
    headers: gatewayHeaders(resolvedConfig, actorAssertion, {
      "Idempotency-Key": actor.invocationId,
    }),
    body: JSON.stringify({
      ...input,
      protocolVersion: HERMES_PROTOCOL_VERSION,
    }),
  });
  const payload = await readJsonPayload(response);
  const sessionId = isRecord(payload) ? stringValue(payload.sessionId) : null;
  if (!response.ok || !sessionId) {
    throw new GatewayExecutionError("gateway_session_create_failed");
  }
  return { sessionId };
}

function requireGatewayConfig(
  config: HermesRuntimeConfig | null | undefined,
): HermesRuntimeConfig {
  if (!config) {
    throw new GatewayExecutionError("gateway_config_missing");
  }
  return config;
}

function gatewayActor(input: Record<string, unknown>): HermesActorProfile {
  const actor = recordValue(input, "actor");
  if (!actor) {
    throw new GatewayExecutionError("gateway_actor_invalid");
  }
  return actor as unknown as HermesActorProfile;
}

function gatewayHeaders(
  config: HermesRuntimeConfig,
  actorAssertion: string,
  extra: Record<string, string> = {},
): Headers {
  return new Headers({
    Authorization: `Bearer ${config.serviceToken}`,
    "X-Xingyao-Actor": actorAssertion,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...extra,
  });
}

async function* readGatewayEvents(
  response: Response,
): AsyncGenerator<GatewayRuntimeEvent> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await readJsonPayload(response);
    const events = isRecord(payload) && Array.isArray(payload.events)
      ? payload.events
      : [];
    for (const event of events) {
      if (isRecord(event) && isString(event.type)) {
        yield event as GatewayRuntimeEvent;
      }
    }
    return;
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseGatewayEventBlock(block);
      if (event) yield event;
    }
    if (done) break;
  }
  const finalEvent = parseGatewayEventBlock(buffer);
  if (finalEvent) yield finalEvent;
}

function parseGatewayEventBlock(block: string): GatewayRuntimeEvent | null {
  if (!block.trim()) return null;
  let eventName = "";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    const payload = JSON.parse(dataLines.join("\n")) as unknown;
    if (isRecord(payload) && isString(payload.type)) {
      return payload as GatewayRuntimeEvent;
    }
    if (isString(eventName) && isRecord(payload)) {
      return { type: eventName, ...payload } as GatewayRuntimeEvent;
    }
  } catch {
    return null;
  }
  return null;
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

type ToolObservation = {
  status: "completed" | "failed" | "denied";
  evidence: string[];
  missing: string[];
  observedAt?: string;
  critical: boolean;
};

function classifyOutcome(observations: ToolObservation[]): ConversationResponseOutcome {
  if (observations.length === 0) return "complete";
  const successful = observations.some((observation) => observation.status === "completed");
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
}) {
  const evidence = unique(observations.flatMap((observation) => observation.evidence));
  const missing = unique(observations.flatMap((observation) => observation.missing));
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
  event: GatewayRuntimeEvent,
  turn: CreatedConversationTurn,
): ConversationStreamEvent | null {
  if (event.type === "activity") {
    const label = stringValue(event.label);
    if (!label) return null;
    return {
      type: "activity.updated",
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      label,
      status: statusValue(event.status, ["pending", "running", "completed", "failed"]) ?? "running",
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
      status: statusValue(event.status, ["completed", "failed", "denied"]) ?? "completed",
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
      ...(isString(metadata.updatedAt) ? { observedAt: metadata.updatedAt } : {}),
    };
  }
  if (event.type === "text.delta" || event.type === "response.output_text.delta") {
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

function isCriticalToolFailure(event: GatewayRuntimeEvent): boolean {
  if (event.type === "tool.completed") return event.critical === true;
  if (event.type !== "tool.complete") return false;
  const metadata = isRecord(event.metadata) ? event.metadata : {};
  return metadata.critical === true || metadata.taskCritical === true;
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
  const raw = stringValue(value)?.toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
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

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.clone().json()) as unknown;
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function latestUserMessage(
  messages: Array<Parameters<typeof buildGatewayNativeAssistantContext>[0]["messages"][number]>,
): string {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
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
    ? value.filter(isString).map((item) => item.trim()).filter(Boolean)
    : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
