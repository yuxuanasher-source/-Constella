import {
  LEGACY_HERMES_PROFILE_VERSION,
  type HermesActorProfile,
} from "./contracts";
import {
  signHermesActorAssertion,
  type HermesAssertionRuntime,
} from "./actor-assertion";

export type HermesRuntimeConfig = {
  baseUrl: string;
  serviceToken: string;
  privateKeyPem: string;
  keyId: string;
};

export type HermesConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type HermesRunStarted = {
  runId: string;
  sessionId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
};

export type HermesRunEvent =
  | { event: "run.started"; data: { sessionId?: string } }
  | { event: "message.delta"; data: { delta: string } }
  | { event: "tool.started"; data: { tool: string } }
  | {
      event: "tool.completed";
      data: {
        toolInvocationId?: string;
        traceId?: string;
        evidenceRefs?: string[];
        sourceLabels?: string[];
        permissionDenials?: string[];
        truncated?: boolean;
        duration?: number;
        error?: boolean;
      };
    }
  | { event: "run.completed"; data: Record<string, never> }
  | { event: "run.failed"; data: { code?: string } }
  | { event: "run.cancelled"; data: { code?: string } };

type FetchLike = typeof fetch;

export function resolveHermesRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): HermesRuntimeConfig | null {
  const baseUrl = normalizeRuntimeOrigin(
    env.XINGYAO_HERMES_RUNTIME_BASE_URL ??
      env.HERMES_XINGYAO_RUNTIME_BASE_URL ??
      "",
  );
  const serviceToken = env.HERMES_XINGYAO_SERVICE_TOKEN?.trim() ?? "";
  const privateKeyPem = normalizePem(
    env.XINGYAO_ACTOR_JWS_PRIVATE_KEY ?? env.HERMES_ACTOR_JWS_PRIVATE_KEY ?? "",
  );
  const keyId =
    env.XINGYAO_ACTOR_JWS_KEY_ID?.trim() ??
    env.HERMES_ACTOR_JWS_KEY_ID?.trim() ??
    "";
  if (
    !baseUrl ||
    serviceToken.length < 32 ||
    !privateKeyPem ||
    !keyId
  ) {
    return null;
  }
  return { baseUrl, serviceToken, privateKeyPem, keyId };
}

export async function createHermesActorAssertionForRun({
  actor,
  config,
  now,
  runtime = "legacy",
}: {
  actor: HermesActorProfile;
  config: HermesRuntimeConfig;
  now?: Date;
  runtime?: HermesAssertionRuntime;
}): Promise<string> {
  return signHermesActorAssertion(actor, {
    privateKeyPem: config.privateKeyPem,
    kid: config.keyId,
    now,
    ttlSeconds: 300,
    runtime,
  });
}

export async function startHermesRun({
  actor,
  input,
  conversationHistory,
  sessionId,
  config,
  actorAssertion,
  fetchImpl = fetch,
}: {
  actor: HermesActorProfile;
  input: string;
  conversationHistory: HermesConversationMessage[];
  sessionId?: string;
  config: HermesRuntimeConfig;
  actorAssertion: string;
  fetchImpl?: FetchLike;
}): Promise<HermesRunStarted> {
  const response = await fetchImpl(`${config.baseUrl}/v1/xingyao/runs`, {
    method: "POST",
    headers: hermesHeaders(config, actorAssertion, {
      "Idempotency-Key": actor.invocationId,
    }),
    body: JSON.stringify({
      input,
      conversationHistory,
      ...(sessionId ? { sessionId } : {}),
      profileVersion: LEGACY_HERMES_PROFILE_VERSION,
    }),
  });
  const payload = await readJson(response);
  if (!response.ok || !isHermesRunStarted(payload)) {
    throw new Error(errorCode(payload) ?? "hermes_run_start_failed");
  }
  return payload;
}

export async function getHermesRunEventResponse({
  runId,
  config,
  actorAssertion,
  fetchImpl = fetch,
}: {
  runId: string;
  config: HermesRuntimeConfig;
  actorAssertion: string;
  fetchImpl?: FetchLike;
}): Promise<Response> {
  const safeRunId = sanitizeRunId(runId);
  if (!safeRunId) {
    throw new Error("invalid_hermes_run_id");
  }
  const response = await fetchImpl(
    `${config.baseUrl}/v1/xingyao/runs/${safeRunId}/events`,
    {
      method: "GET",
      headers: hermesHeaders(config, actorAssertion),
    },
  );
  if (!response.ok) {
    const payload = await readJson(response);
    throw new Error(errorCode(payload) ?? "hermes_run_events_failed");
  }
  return response;
}

export async function* readHermesRunEvents(
  response: Response,
): AsyncGenerator<HermesRunEvent> {
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
      const event = parseHermesSseEvent(block);
      if (event) yield event;
    }
    if (done) break;
  }
  const finalEvent = parseHermesSseEvent(buffer);
  if (finalEvent) yield finalEvent;
}

function hermesHeaders(
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

function normalizeRuntimeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function normalizePem(value: string): string {
  const normalized = value.trim();
  return normalized.includes("\\n") && !normalized.includes("\n")
    ? normalized.replace(/\\n/g, "\n")
    : normalized;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function isHermesRunStarted(value: unknown): value is HermesRunStarted {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    typeof value.sessionId === "string" &&
    ["queued", "running", "completed", "failed", "cancelled"].includes(
      String(value.status),
    )
  );
}

function parseHermesSseEvent(block: string): HermesRunEvent | null {
  if (!block.trim()) return null;
  let eventName = "";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!eventName || !dataLines.length) return null;
  try {
    const data = JSON.parse(dataLines.join("\n")) as unknown;
    if (!isRecord(data) || data.event !== eventName || !isRecord(data.data)) {
      return null;
    }
    return isKnownHermesEvent(eventName)
      ? ({ event: eventName, data: data.data } as HermesRunEvent)
      : null;
  } catch {
    return null;
  }
}

function isKnownHermesEvent(value: string): value is HermesRunEvent["event"] {
  return [
    "run.started",
    "message.delta",
    "tool.started",
    "tool.completed",
    "run.completed",
    "run.failed",
    "run.cancelled",
  ].includes(value);
}

function sanitizeRunId(value: string): string | null {
  return /^run_[a-f0-9]{32}$/.test(value) ? value : null;
}

function errorCode(value: unknown): string | null {
  return isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === "string"
    ? value.error.code
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
