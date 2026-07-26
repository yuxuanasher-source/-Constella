import { randomUUID } from "node:crypto";

import WebSocket from "ws";

import { createHermesActorFingerprint } from "./actor-fingerprint";
import type { HermesActorProfile } from "./contracts";
import {
  HERMES_GATEWAY_EVENT_TYPES,
  HERMES_GATEWAY_METHODS,
  parseHermesGatewayEvent,
  type HermesGatewayCommand,
  type HermesGatewayEvent,
} from "./gateway-contracts";

export const HERMES_GATEWAY_CLIENT_METHODS = HERMES_GATEWAY_METHODS;
export const HERMES_GATEWAY_CLIENT_EVENT_TYPES = HERMES_GATEWAY_EVENT_TYPES;

export type HermesGatewayTimeouts = {
  connectMs: number;
  readyMs: number;
  rpcMs: number;
  idleMs: number;
  heartbeatMs: number;
};

export type HermesGatewayClientConfig = {
  url: string;
  serviceToken: string;
  timeouts: HermesGatewayTimeouts;
  opaqueCapability?: string;
};

export type HermesGatewaySessionOptions = {
  config: HermesGatewayClientConfig;
  actor: HermesActorProfile;
  actorAssertion: string;
  invocationCapability: string;
  conversationId: string;
  sessionId?: string;
  prompt?: string;
  mode?: "fast" | "deep";
};

export type HermesGatewayByteAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array | Buffer;
};

export type HermesGatewaySession = {
  readonly sessionId: string;
  readonly events: AsyncIterable<HermesGatewayEvent>;
  info(): Promise<unknown>;
  list(): Promise<unknown>;
  branch(conversationId: string): Promise<unknown>;
  compress(): Promise<unknown>;
  respondToClarify(input: {
    requestId: string;
    answer: string;
  }): Promise<unknown>;
  interrupt(): Promise<unknown>;
  waitForAccepted(): Promise<void>;
  recover(): Promise<void>;
  close(): void;
  listenerCount(): number;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code?: string; message?: string };
};

const DEFAULT_TIMEOUTS: HermesGatewayTimeouts = {
  connectMs: 2_000,
  readyMs: 2_000,
  rpcMs: 15_000,
  idleMs: 120_000,
  heartbeatMs: 30_000,
};
const XINGYAO_GATEWAY_WS_PATH = "/api/xingyao/ws";
const XINGYAO_LOOPBACK_WS_URL =
  /^ws:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?(?:\/|\/api\/xingyao\/ws)?$/i;

export function resolveHermesGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): HermesGatewayClientConfig | null {
  const url = normalizeLoopbackWsUrl(env.XINGYAO_HERMES_GATEWAY_URL ?? "");
  const serviceToken =
    env.XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN?.trim() ??
    env.HERMES_XINGYAO_GATEWAY_SERVICE_TOKEN?.trim() ??
    "";
  if (!url || serviceToken.length < 32) {
    return null;
  }
  return { url, serviceToken, timeouts: DEFAULT_TIMEOUTS };
}

export async function createHermesGatewaySession(
  options: HermesGatewaySessionOptions,
): Promise<HermesGatewaySession> {
  const client = new HermesGatewayClient(options);
  try {
    await client.start();
    return client.session();
  } catch (error) {
    client.close();
    throw error;
  }
}

export async function attachHermesGatewayBytes(
  session: HermesGatewaySession,
  attachment: HermesGatewayByteAttachment,
): Promise<unknown> {
  if (!isByteAttachment(attachment)) {
    throw gatewayError("hermes_gateway_attachment_requires_bytes");
  }
  const method =
    attachment.mimeType === "application/pdf"
      ? "pdf.attach"
      : attachment.mimeType.startsWith("image/")
        ? "image.attach_bytes"
        : "file.attach";
  return (session as HermesGatewayClient).rpc(method, {
    attachmentId: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    contentBase64: Buffer.from(attachment.bytes).toString("base64"),
  });
}

class HermesGatewayClient implements HermesGatewaySession {
  sessionId = "";
  readonly events: AsyncIterable<HermesGatewayEvent>;
  private readonly options: HermesGatewaySessionOptions;
  private readonly actorFingerprint: string;
  private socket: WebSocket | null = null;
  private closed = false;
  private fatalError: Error | null = null;
  private accepted = false;
  private promptSubmitAttempted = false;
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private eventQueue: HermesGatewayEvent[] = [];
  private pendingTextDelta: HermesGatewayEvent | null = null;
  private eventError: Error | null = null;
  private eventWaiters: Array<{
    resolve: (value: IteratorResult<HermesGatewayEvent>) => void;
    reject: (error: Error) => void;
  }> = [];
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private closeHandler: ((code: number) => void) | null = null;
  private messageHandler: ((data: WebSocket.RawData) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;

  constructor(options: HermesGatewaySessionOptions) {
    const url = normalizeLoopbackWsUrl(options.config.url);
    if (!url) {
      throw gatewayError("hermes_gateway_invalid_loopback_url");
    }
    this.options = {
      ...options,
      config: { ...options.config, url },
    };
    this.actorFingerprint = createHermesActorFingerprint(options.actor);
    this.events = {
      [Symbol.asyncIterator]: () => ({
        next: () => this.nextEvent(),
      }),
    };
  }

  async start(): Promise<void> {
    await this.connect();
    if (this.options.sessionId) {
      this.sessionId = this.options.sessionId;
      const result = await this.rpc("session.resume", {
        conversationId: this.options.conversationId,
      });
      this.validateSessionResult(result, this.options.sessionId, true);
    } else {
      const result = await this.rpc("session.create", {
        conversationId: this.options.conversationId,
      });
      this.validateSessionResult(result);
    }

    if (this.options.prompt) {
      await this.submitPromptWithRetry();
    }
  }

  session(): HermesGatewaySession {
    return this;
  }

  info(): Promise<unknown> {
    return this.rpc("session.info", {}).then((result) => {
      this.validateSessionResult(result);
      return result;
    });
  }

  list(): Promise<unknown> {
    return this.rpc("session.list", {});
  }

  branch(conversationId: string): Promise<unknown> {
    return this.rpc("session.branch", { conversationId });
  }

  compress(): Promise<unknown> {
    return this.rpc("session.compress", {});
  }

  respondToClarify(input: {
    requestId: string;
    answer: string;
  }): Promise<unknown> {
    return this.rpc("clarify.respond", input);
  }

  interrupt(): Promise<unknown> {
    return this.rpc("session.interrupt", {});
  }

  async waitForAccepted(): Promise<void> {
    if (this.accepted) return;
    throw this.error("hermes_gateway_prompt_not_accepted");
  }

  async recover(): Promise<void> {
    this.assertCanReconnect();
    await this.resumeAndLoadInvocationStatus();
  }

  close(): void {
    this.closed = true;
    this.detachSocket();
    this.socket?.close();
    this.socket = null;
    this.clearAllTimers();
    for (const pending of this.pending.values()) {
      pending.reject(this.error("hermes_gateway_closed"));
    }
    this.pending.clear();
    for (const waiter of this.eventWaiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  listenerCount(): number {
    const socketListeners = this.socket
      ? this.socket.listenerCount("message") +
        this.socket.listenerCount("close") +
        this.socket.listenerCount("error")
      : 0;
    return socketListeners + this.eventWaiters.length + this.pending.size;
  }

  async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.fatalError) {
      throw this.fatalError;
    }
    if (this.closed) {
      throw this.error("hermes_gateway_closed");
    }
    if (!HERMES_GATEWAY_METHODS.includes(method as never)) {
      throw this.error("hermes_gateway_unsupported_method");
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw this.error("hermes_gateway_not_connected");
    }

    const id = randomUUID();
    const command = this.command(id, method, params);
    return new Promise<unknown>((resolve, reject) => {
      const timer = this.timeout("rpc", () => {
        this.pending.delete(id);
        reject(this.error("hermes_gateway_rpc_timeout"));
      });
      this.pending.set(id, { resolve, reject, timer });
      this.socket?.send(JSON.stringify(command), (error) => {
        if (error) {
          this.clearTrackedTimer(timer);
          this.pending.delete(id);
          reject(this.error("hermes_gateway_send_failed"));
        }
      });
    });
  }

  private async submitPromptWithRetry(): Promise<void> {
    try {
      await this.submitPrompt();
    } catch (error) {
      if (this.accepted || this.closed) {
        throw this.redactError(error, "hermes_gateway_error");
      }
      if (this.promptSubmitAttempted) {
        await this.resumeAndLoadInvocationStatus();
        return;
      }
      await this.connect();
      const result = await this.rpc("session.create", {
        conversationId: this.options.conversationId,
      });
      this.validateSessionResult(result);
      await this.submitPrompt();
    }
  }

  private async submitPrompt(): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw this.error("hermes_gateway_not_connected");
    }
    this.promptSubmitAttempted = true;
    const result = await this.rpc("prompt.submit", {
      conversationId: this.options.conversationId,
      text: this.options.prompt ?? "",
      mode: this.options.mode ?? "fast",
    });
    if (isRecord(result) && result.accepted === true) {
      this.accepted = true;
      return;
    }
    throw this.error("hermes_gateway_prompt_not_accepted");
  }

  private validateSessionResult(
    result: unknown,
    expectedSessionId = this.sessionId,
    requireIdentity = false,
  ): void {
    if (!isRecord(result)) {
      throw this.error("hermes_gateway_session_mismatch");
    }
    const sessionId = resultSessionId(result);
    if (!sessionId || (expectedSessionId && sessionId !== expectedSessionId)) {
      throw this.error("hermes_gateway_session_mismatch");
    }
    this.sessionId = sessionId;
    if (
      typeof result.invocationId === "string" &&
      result.invocationId !== this.options.actor.invocationId
    ) {
      throw this.error("hermes_gateway_actor_mismatch");
    }
    if (
      requireIdentity &&
      result.invocationId !== this.options.actor.invocationId
    ) {
      throw this.error("hermes_gateway_actor_mismatch");
    }
    if (
      typeof result.actorFingerprint === "string" &&
      result.actorFingerprint !== this.actorFingerprint
    ) {
      throw this.error("hermes_gateway_actor_mismatch");
    }
    if (requireIdentity && result.actorFingerprint !== this.actorFingerprint) {
      throw this.error("hermes_gateway_actor_mismatch");
    }
  }

  private async resumeAndLoadInvocationStatus(): Promise<void> {
    this.assertCanReconnect();
    await this.connect();
    const resumeResult = await this.rpc("session.resume", {
      conversationId: this.options.conversationId,
    });
    this.validateSessionResult(resumeResult, this.sessionId, true);
    const infoResult = await this.rpc("session.info", {});
    this.validateSessionResult(infoResult, this.sessionId, true);
    if (isRecord(infoResult) && infoResult.status === "accepted") {
      this.accepted = true;
      return;
    }
    if (!this.promptSubmitAttempted && this.options.prompt) {
      await this.submitPrompt();
      return;
    }
    throw this.error("hermes_gateway_prompt_not_accepted");
  }

  private async connect(): Promise<void> {
    this.assertCanReconnect();
    this.detachSocket();
    this.socket?.close();
    const socket = new WebSocket(this.options.config.url, {
      headers: {
        Authorization: `Bearer ${this.options.config.serviceToken}`,
      },
    });
    this.socket = socket;
    const readyResult = this.waitForReady(socket).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const openResult = await new Promise<
      { ok: true } | { ok: false; error: Error }
    >((resolve) => {
      const timer = this.timeout("connect", () => {
        socket.terminate();
        resolve({
          ok: false,
          error: this.error("hermes_gateway_connect_timeout"),
        });
      });
      socket.once("open", () => {
        this.clearTrackedTimer(timer);
        resolve({ ok: true });
      });
      socket.once("error", (error) => {
        this.clearTrackedTimer(timer);
        resolve({
          ok: false,
          error: this.redactError(error, "hermes_gateway_connect_failed"),
        });
      });
    });
    if (!openResult.ok) {
      socket.terminate();
      await readyResult;
      throw openResult.error;
    }

    const ready = await readyResult;
    if (!ready.ok) {
      throw ready.error;
    }
    if (!this.messageHandler) {
      this.attachSocket(socket);
    }
    this.scheduleHeartbeat();
    this.scheduleIdle();
  }

  private waitForReady(socket: WebSocket): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = this.timeout("ready", () => {
        cleanup();
        const error = this.error("hermes_gateway_ready_timeout");
        this.fatalProtocolFailure(error);
        reject(error);
      });
      const cleanup = () => {
        this.clearTrackedTimer(timer);
        socket.off("message", onMessage);
        socket.off("close", onClose);
        socket.off("error", onError);
      };
      const onMessage = (data: WebSocket.RawData) => {
        const value = parseJson(data);
        const event = parseHermesGatewayEvent(value);
        if (!event || event.params.type !== "gateway.ready") {
          cleanup();
          const error = this.error("hermes_gateway_ready_mismatch");
          this.fatalProtocolFailure(error);
          reject(error);
          return;
        }
        cleanup();
        this.attachSocket(socket);
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(this.error("hermes_gateway_connection_closed"));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(this.redactError(error, "hermes_gateway_connect_failed"));
      };
      socket.on("message", onMessage);
      socket.once("close", onClose);
      socket.once("error", onError);
    });
  }

  private attachSocket(socket: WebSocket): void {
    this.messageHandler = (data) => this.handleMessage(data);
    this.closeHandler = () =>
      this.rejectPending("hermes_gateway_connection_closed");
    this.errorHandler = (error) =>
      this.fatalProtocolFailure(
        this.redactError(error, "hermes_gateway_connection_failed"),
      );
    socket.on("message", this.messageHandler);
    socket.on("close", this.closeHandler);
    socket.on("error", this.errorHandler);
  }

  private detachSocket(): void {
    if (!this.socket) return;
    if (this.messageHandler) {
      this.socket.off("message", this.messageHandler);
    }
    if (this.closeHandler) {
      this.socket.off("close", this.closeHandler);
    }
    if (this.errorHandler) {
      this.socket.off("error", this.errorHandler);
    }
    this.messageHandler = null;
    this.closeHandler = null;
    this.errorHandler = null;
  }

  private handleMessage(data: WebSocket.RawData): void {
    if (this.closed || this.fatalError) {
      this.socket?.terminate();
      return;
    }
    this.scheduleIdle();
    const value = parseJson(data);
    if (isResponse(value)) {
      this.handleResponse(value);
      return;
    }
    const event = parseHermesGatewayEvent(value);
    if (!event) {
      this.fatalProtocolFailure(
        this.error("hermes_gateway_event_schema_mismatch"),
      );
      return;
    }
    if (event.params.type === "gateway.ready") {
      return;
    }
    if (
      this.sessionId &&
      "sessionId" in event.params &&
      event.params.sessionId !== this.sessionId
    ) {
      this.fatalProtocolFailure(this.error("hermes_gateway_session_mismatch"));
      return;
    }
    if (
      "invocationId" in event.params &&
      event.params.invocationId !== this.options.actor.invocationId
    ) {
      this.fatalProtocolFailure(this.error("hermes_gateway_actor_mismatch"));
      return;
    }
    this.enqueueEvent(event);
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    this.clearTrackedTimer(pending.timer);
    if (response.error) {
      pending.reject(this.error(safeRpcErrorCode(response.error)));
      return;
    }
    pending.resolve(response.result);
  }

  private enqueueEvent(event: HermesGatewayEvent): void {
    if (event.params.type === "message.delta") {
      if (this.pendingTextDelta?.params.type === "message.delta") {
        this.pendingTextDelta.params.payload.text += event.params.payload.text;
      } else {
        this.pendingTextDelta = event;
      }
      return;
    }
    this.flushTextDelta();
    this.deliverEvent(event);
  }

  private flushTextDelta(): void {
    if (!this.pendingTextDelta) return;
    const event = this.pendingTextDelta;
    this.pendingTextDelta = null;
    this.deliverEvent(event);
  }

  private deliverEvent(event: HermesGatewayEvent): void {
    const waiter = this.eventWaiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: event });
    } else {
      this.eventQueue.push(event);
    }
  }

  private nextEvent(): Promise<IteratorResult<HermesGatewayEvent>> {
    this.flushTextDelta();
    if (this.eventQueue.length) {
      return Promise.resolve({
        done: false,
        value: this.eventQueue.shift()!,
      });
    }
    if (this.eventError) {
      return Promise.reject(this.eventError);
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve, reject) => {
      this.eventWaiters.push({ resolve, reject });
    });
  }

  private failEvents(error: Error): void {
    this.eventError = error;
    for (const waiter of this.eventWaiters.splice(0)) {
      waiter.reject(error);
    }
    this.pendingTextDelta = null;
  }

  private rejectPending(code: string): void {
    this.rejectPendingError(this.error(code));
  }

  private rejectPendingError(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      this.clearTrackedTimer(pending.timer);
      pending.reject(error);
    }
  }

  private fatalProtocolFailure(error: Error): void {
    this.fatalError = error;
    this.closed = true;
    this.eventError = error;
    this.detachSocket();
    this.socket?.terminate();
    this.socket = null;
    this.clearAllTimers();
    this.rejectPendingError(error);
    this.eventQueue.length = 0;
    for (const waiter of this.eventWaiters.splice(0)) {
      waiter.reject(error);
    }
    this.pendingTextDelta = null;
  }

  private assertCanReconnect(): void {
    if (this.fatalError) {
      throw this.fatalError;
    }
    if (this.closed) {
      throw this.error("hermes_gateway_closed");
    }
  }

  private command(
    id: string,
    method: string,
    params: Record<string, unknown>,
  ): HermesGatewayCommand {
    const actorParams = { actorAssertion: this.options.actorAssertion };
    const invocationParams = {
      ...actorParams,
      invocationId: this.options.actor.invocationId,
      invocationCapability: this.options.invocationCapability,
    };
    const sessionParams = { ...invocationParams, sessionId: this.sessionId };
    const fullParams =
      method === "session.create"
        ? { ...invocationParams, ...params }
        : method === "session.info"
          ? { ...actorParams, sessionId: this.sessionId, ...params }
          : method === "session.list"
            ? actorParams
            : { ...sessionParams, ...params };
    return {
      jsonrpc: "2.0",
      id,
      method,
      params: fullParams,
    } as HermesGatewayCommand;
  }

  private timeout(
    type: "connect" | "ready" | "rpc" | "idle" | "heartbeat",
    callback: () => void,
  ): ReturnType<typeof setTimeout> {
    const duration = this.options.config.timeouts[`${type}Ms`];
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, duration);
    this.timers.add(timer);
    return timer;
  }

  private scheduleHeartbeat(): void {
    if (this.heartbeatTimer) {
      this.clearTrackedTimer(this.heartbeatTimer);
    }
    this.heartbeatTimer = this.timeout("heartbeat", () => {
      this.heartbeatTimer = null;
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.ping();
        this.scheduleHeartbeat();
      }
    });
  }

  private scheduleIdle(): void {
    if (this.idleTimer) {
      this.clearTrackedTimer(this.idleTimer);
    }
    this.idleTimer = this.timeout("idle", () => {
      this.idleTimer = null;
      this.rejectPending("hermes_gateway_idle_timeout");
      this.socket?.close();
    });
  }

  private clearTrackedTimer(timer: ReturnType<typeof setTimeout>): void {
    clearTimeout(timer);
    this.timers.delete(timer);
  }

  private clearAllTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.heartbeatTimer = null;
    this.idleTimer = null;
  }

  private error(code: string): Error {
    return new Error(redactText(code, this.sensitiveValues()));
  }

  private redactError(error: unknown, fallbackCode: string): Error {
    if (!(error instanceof Error)) {
      return this.error(fallbackCode);
    }
    const redacted = redactText(error.message, this.sensitiveValues());
    return this.error(redacted === error.message ? fallbackCode : redacted);
  }

  private sensitiveValues(): string[] {
    return [
      this.options.config.serviceToken,
      this.options.config.opaqueCapability,
      this.options.actorAssertion,
      this.options.invocationCapability,
    ].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  }
}

function normalizeLoopbackWsUrl(value: string): string | null {
  const configuredValue = value.trim();
  if (!XINGYAO_LOOPBACK_WS_URL.test(configuredValue)) {
    return null;
  }

  try {
    const url = new URL(configuredValue);
    const configuredPath = url.pathname === "/" ? "" : url.pathname;
    if (
      url.protocol !== "ws:" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (configuredPath !== "" &&
        configuredPath !== XINGYAO_GATEWAY_WS_PATH)
    ) {
      return null;
    }
    url.pathname = XINGYAO_GATEWAY_WS_PATH;
    return url.href;
  } catch {
    return null;
  }
}

function isByteAttachment(
  value: unknown,
): value is HermesGatewayByteAttachment {
  return (
    isRecord(value) &&
    ArrayBuffer.isView(value.bytes) &&
    typeof value.attachmentId === "string" &&
    typeof value.filename === "string" &&
    typeof value.mimeType === "string" &&
    !("path" in value)
  );
}

function parseJson(data: WebSocket.RawData): unknown {
  try {
    return JSON.parse(data.toString()) as unknown;
  } catch {
    return null;
  }
}

function isResponse(value: unknown): value is JsonRpcResponse {
  return (
    isRecord(value) &&
    value.jsonrpc === "2.0" &&
    typeof value.id === "string" &&
    ("result" in value || "error" in value)
  );
}

function resultSessionId(value: unknown): string | null {
  return isRecord(value) && typeof value.sessionId === "string"
    ? value.sessionId
    : null;
}

function gatewayError(code: string): Error {
  return new Error(redactText(code));
}

function safeRpcErrorCode(error: { code?: string; message?: string }): string {
  return isSafeSymbolicErrorCode(error.code)
    ? error.code
    : "hermes_gateway_rpc_failed";
}

function isSafeSymbolicErrorCode(value: unknown): value is string {
  return (
    typeof value === "string" && /^hermes_gateway_[a-z0-9_]{1,80}$/.test(value)
  );
}

function redactText(
  value: string,
  sensitiveValues: readonly string[] = [],
): string {
  let redacted = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /[A-Za-z0-9._~+/=-]*capability[A-Za-z0-9._~+/=-]*/gi,
      "[REDACTED]",
    );
  for (const sensitive of sensitiveValues) {
    redacted = redacted.split(sensitive).join("[REDACTED]");
  }
  return redacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
