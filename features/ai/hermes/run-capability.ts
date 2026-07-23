import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  HERMES_MODE_BUDGETS,
  isHermesActorProfile,
  isHermesMode,
  isHermesReadScope,
  isUuid,
  type HermesActorProfile,
  type HermesMode,
  type HermesReadScope,
} from "./contracts";
import {
  HermesStateRepositoryError,
  type HermesStateRepository,
} from "./hermes-state-repository";
import {
  computeHermesSkillGrantsHash,
  createHermesActorFingerprint,
} from "./actor-fingerprint";
import { HermesLiveActorAuthorizationError } from "./live-actor-authorization";

const CAPABILITY_BYTES = 32;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const REDACTED_CAPABILITY = "[REDACTED_HERMES_CAPABILITY]";
const INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");
const CHILD_FORBIDDEN_TOOLS = new Set([
  "xingyao_memory_remember",
  "xingyao_memory_forget",
  "xingyao_skill_draft",
]);

const secretValues = new WeakMap<object, string>();

export type HermesCapabilitySecret = Readonly<{
  kind: "hermes-capability-secret";
}>;

export type IssuedHermesRunCapability = {
  capabilityId: string;
  capability: HermesCapabilitySecret;
  expiresAt: string;
};

export type HermesCapabilityDerivationRequest = {
  parentInvocationId: string;
  childInvocationId?: string;
  requestedToolNames: readonly string[];
  requestedScopes: readonly HermesReadScope[];
};

export type HermesParentRunCapability = {
  actor: HermesActorProfile;
  actorFingerprint: string;
  mode: HermesMode;
  turnId: string;
  invocationId: string;
  rootInvocationId: string;
  allowedTools: readonly string[];
  scopes: readonly HermesReadScope[];
  skillDraftIds: readonly string[];
  depth: number;
  expiresAt: string;
};

export type HermesCapabilityDerivationDependencies = {
  repository: Pick<HermesStateRepository, "issueRunCapability">;
  loadParentCapability(input: {
    tokenSha256: string;
    now: Date;
  }): Promise<HermesParentRunCapability | null>;
  countActiveChildren(input: {
    organizationId: string;
    userId: string;
    turnId: string;
    rootInvocationId: string;
    now: Date;
  }): Promise<number>;
  createChildInvocation(input: {
    actor: HermesActorProfile;
    childInvocationId: string;
    parentInvocationId: string;
    rootInvocationId: string;
    mode: HermesMode;
    depth: number;
  }): Promise<void>;
  markChildInvocationFailed?(input: {
    actor: HermesActorProfile;
    childInvocationId: string;
  }): Promise<void>;
  reauthorizeActor(input: {
    actorSnapshot: HermesActorProfile;
    expectedActorFingerprint: string;
  }): Promise<{ actor: HermesActorProfile; actorFingerprint: string }>;
};

export type HermesRunCapabilityErrorCode =
  | "invalid_request"
  | "parent_not_found"
  | "parent_invalid"
  | "actor_changed"
  | "authority_expansion"
  | "depth_limit"
  | "parallel_limit"
  | "deadline_expired"
  | "persistence_failed";

const ERROR_MESSAGES: Record<HermesRunCapabilityErrorCode, string> = {
  invalid_request: "Hermes capability request is invalid",
  parent_not_found: "Hermes parent capability is unavailable",
  parent_invalid: "Hermes parent capability is invalid",
  actor_changed: "Hermes actor authorization changed",
  authority_expansion: "Hermes child authority cannot be expanded",
  depth_limit: "Hermes child depth limit was reached",
  parallel_limit: "Hermes parallel child limit was reached",
  deadline_expired: "Hermes capability deadline has expired",
  persistence_failed: "Hermes capability could not be persisted",
};

export class HermesRunCapabilityError extends Error {
  constructor(public readonly code: HermesRunCapabilityErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "HermesRunCapabilityError";
  }
}

export async function issueHermesRootRunCapability({
  repository,
  actor,
  actorFingerprint,
  turn,
  mode,
  serverAllowedTools,
  approvedSkillDraftIds,
  aiStateWritesAllowed,
  actorDeadline,
  assertionExpiresAt,
  runDeadline,
  now = new Date(),
}: {
  repository: Pick<HermesStateRepository, "issueRunCapability">;
  actor: HermesActorProfile;
  actorFingerprint: string;
  turn: { id: string; conversationId: string };
  mode: HermesMode;
  serverAllowedTools: readonly string[];
  approvedSkillDraftIds: readonly string[];
  aiStateWritesAllowed: boolean;
  actorDeadline?: Date;
  assertionExpiresAt: Date;
  runDeadline: Date;
  now?: Date;
}): Promise<IssuedHermesRunCapability> {
  if (
    !isValidGatewayActor(actor, actorFingerprint) ||
    !isUuid(turn.id) ||
    turn.conversationId !== actor.conversationId ||
    !isHermesMode(mode) ||
    typeof aiStateWritesAllowed !== "boolean" ||
    !isValidDate(now)
  ) {
    throw new HermesRunCapabilityError("invalid_request");
  }

  const allowedTools = canonicalTools(serverAllowedTools);
  const skillDraftIds = canonicalUuids(approvedSkillDraftIds);
  if (!allowedTools || !skillDraftIds) {
    throw new HermesRunCapabilityError("invalid_request");
  }

  const budgetDeadline = new Date(
    now.getTime() + HERMES_MODE_BUDGETS[mode].wallClockMs + 30_000,
  );
  const expiresAt = earliestDeadline(
    [budgetDeadline, actorDeadline, assertionExpiresAt, runDeadline],
    now,
  );
  const token = randomCapabilityToken();
  const issued = await issuePersistedCapability(repository, {
    actorSnapshot: {
      organizationId: actor.organizationId,
      userId: actor.userId,
      conversationId: actor.conversationId,
      invocationId: actor.invocationId,
      actorFingerprint,
    },
    turn,
    binding: {
      tokenSha256: hashCapabilityToken(token),
      allowedTools,
      scopes: [...actor.allowedReadScopes],
      skillDraftIds,
      depth: 0,
      aiStateWritesAllowed,
    },
    expiresAt,
  });

  return {
    capabilityId: issued.capabilityId,
    capability: capabilitySecret(token),
    expiresAt: issued.expiresAt,
  };
}

export async function deriveHermesChildRunCapability({
  parentCapabilityToken,
  request,
  dependencies,
  now = new Date(),
}: {
  parentCapabilityToken: string;
  request: HermesCapabilityDerivationRequest;
  dependencies: HermesCapabilityDerivationDependencies;
  now?: Date;
}): Promise<IssuedHermesRunCapability & { childInvocationId: string }> {
  const parsedRequest = parseHermesCapabilityDerivationRequest(request);
  if (
    !CAPABILITY_PATTERN.test(parentCapabilityToken) ||
    !parsedRequest ||
    !isValidDate(now)
  ) {
    throw new HermesRunCapabilityError("invalid_request");
  }

  const parentTokenSha256 = hashCapabilityToken(parentCapabilityToken);
  const parent = await invokePersistenceDependency(() =>
    dependencies.loadParentCapability({
      tokenSha256: parentTokenSha256,
      now,
    }),
  );
  if (!parent) {
    throw new HermesRunCapabilityError("parent_not_found");
  }
  if (!isValidParent(parent, now)) {
    throw new HermesRunCapabilityError("parent_invalid");
  }
  if (parsedRequest.parentInvocationId !== parent.invocationId) {
    throw new HermesRunCapabilityError("parent_not_found");
  }

  let liveActor: { actor: HermesActorProfile; actorFingerprint: string };
  try {
    liveActor = await dependencies.reauthorizeActor({
      actorSnapshot: parent.actor,
      expectedActorFingerprint: parent.actorFingerprint,
    });
  } catch (error) {
    if (
      error instanceof HermesLiveActorAuthorizationError &&
      error.code === "membership_query_failed"
    ) {
      throw new HermesRunCapabilityError("persistence_failed");
    }
    throw new HermesRunCapabilityError("actor_changed");
  }
  if (
    liveActor.actorFingerprint !== parent.actorFingerprint ||
    liveActor.actor.organizationId !== parent.actor.organizationId ||
    liveActor.actor.userId !== parent.actor.userId ||
    liveActor.actor.conversationId !== parent.actor.conversationId ||
    liveActor.actor.skillGrantsHash !== parent.actor.skillGrantsHash
  ) {
    throw new HermesRunCapabilityError("actor_changed");
  }

  if (
    !isSubset(parsedRequest.requestedToolNames, parent.allowedTools) ||
    !isSubset(parsedRequest.requestedScopes, parent.scopes) ||
    parsedRequest.requestedToolNames.some((tool) =>
      CHILD_FORBIDDEN_TOOLS.has(tool),
    )
  ) {
    throw new HermesRunCapabilityError("authority_expansion");
  }

  const depth = parent.depth + 1;
  const budget = HERMES_MODE_BUDGETS[parent.mode];
  if (depth > budget.maxSubagentDepth) {
    throw new HermesRunCapabilityError("depth_limit");
  }
  const activeChildren = await invokePersistenceDependency(() =>
    dependencies.countActiveChildren({
      organizationId: parent.actor.organizationId,
      userId: parent.actor.userId,
      turnId: parent.turnId,
      rootInvocationId: parent.rootInvocationId,
      now,
    }),
  );
  if (!Number.isSafeInteger(activeChildren) || activeChildren < 0) {
    throw new HermesRunCapabilityError("persistence_failed");
  }
  if (activeChildren >= budget.maxParallelSubagents) {
    throw new HermesRunCapabilityError("parallel_limit");
  }

  const childInvocationId = parsedRequest.childInvocationId ?? randomUUID();
  if (
    childInvocationId === parent.invocationId ||
    childInvocationId === parent.rootInvocationId
  ) {
    throw new HermesRunCapabilityError("invalid_request");
  }

  await invokePersistenceDependency(() =>
    dependencies.createChildInvocation({
      actor: parent.actor,
      childInvocationId,
      parentInvocationId: parent.invocationId,
      rootInvocationId: parent.rootInvocationId,
      mode: parent.mode,
      depth,
    }),
  );

  const token = randomCapabilityToken();
  const expiresAt = new Date(parent.expiresAt);
  try {
    const issued = await issuePersistedCapability(dependencies.repository, {
      actorSnapshot: {
        organizationId: parent.actor.organizationId,
        userId: parent.actor.userId,
        conversationId: parent.actor.conversationId,
        invocationId: childInvocationId,
        actorFingerprint: parent.actorFingerprint,
      },
      turn: { id: parent.turnId, conversationId: parent.actor.conversationId },
      binding: {
        tokenSha256: hashCapabilityToken(token),
        allowedTools: [...parsedRequest.requestedToolNames].sort(compareAscii),
        scopes: [...parsedRequest.requestedScopes].sort(compareAscii),
        skillDraftIds: [...parent.skillDraftIds].sort(compareAscii),
        depth,
        aiStateWritesAllowed: false,
        parentCapability: {
          invocationId: parent.invocationId,
          tokenSha256: parentTokenSha256,
        },
      },
      expiresAt,
    });
    return {
      childInvocationId,
      capabilityId: issued.capabilityId,
      capability: capabilitySecret(token),
      expiresAt: issued.expiresAt,
    };
  } catch (error) {
    try {
      await dependencies.markChildInvocationFailed?.({
        actor: parent.actor,
        childInvocationId,
      });
    } catch {
      // Preserve the stable issuance failure even when best-effort cleanup fails.
    }
    if (
      error instanceof HermesRunCapabilityError &&
      error.code === "parallel_limit"
    ) {
      throw error;
    }
    throw new HermesRunCapabilityError("persistence_failed");
  }
}

export function parseHermesCapabilityDerivationRequest(
  value: unknown,
): HermesCapabilityDerivationRequest | null {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value).sort();
  const expectedKeys =
    value.childInvocationId === undefined
      ? ["parentInvocationId", "requestedScopes", "requestedToolNames"]
      : [
          "childInvocationId",
          "parentInvocationId",
          "requestedScopes",
          "requestedToolNames",
        ];
  if (
    keys.length !== expectedKeys.length ||
    !keys.every((key, index) => key === expectedKeys[index]) ||
    !isUuid(value.parentInvocationId) ||
    (value.childInvocationId !== undefined &&
      !isUuid(value.childInvocationId)) ||
    !isUniqueToolList(value.requestedToolNames) ||
    !isUniqueScopeList(value.requestedScopes)
  ) {
    return null;
  }

  return {
    parentInvocationId: value.parentInvocationId,
    ...(value.childInvocationId === undefined
      ? null
      : { childInvocationId: value.childInvocationId }),
    requestedToolNames: [...value.requestedToolNames],
    requestedScopes: [...value.requestedScopes],
  };
}

export function revealHermesCapabilityToken(
  secret: HermesCapabilitySecret,
): string {
  const value = secretValues.get(secret);
  if (!value) {
    throw new HermesRunCapabilityError("invalid_request");
  }
  return value;
}

export function hashHermesCapabilityToken(token: string): string {
  if (!CAPABILITY_PATTERN.test(token)) {
    throw new HermesRunCapabilityError("invalid_request");
  }
  return hashCapabilityToken(token);
}

function capabilitySecret(token: string): HermesCapabilitySecret {
  const secret = Object.create(null) as HermesCapabilitySecret;
  Object.defineProperties(secret, {
    kind: {
      value: "hermes-capability-secret",
      enumerable: true,
    },
    toString: { value: () => REDACTED_CAPABILITY },
    toJSON: { value: () => REDACTED_CAPABILITY },
    [INSPECT_CUSTOM]: { value: () => REDACTED_CAPABILITY },
  });
  secretValues.set(secret, token);
  return Object.freeze(secret);
}

function randomCapabilityToken(): string {
  const token = randomBytes(CAPABILITY_BYTES).toString("base64url");
  if (!CAPABILITY_PATTERN.test(token)) {
    throw new HermesRunCapabilityError("persistence_failed");
  }
  return token;
}

function hashCapabilityToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function invokePersistenceDependency<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HermesRunCapabilityError) throw error;
    throw new HermesRunCapabilityError("persistence_failed");
  }
}

async function issuePersistedCapability(
  repository: Pick<HermesStateRepository, "issueRunCapability">,
  input: Parameters<HermesStateRepository["issueRunCapability"]> extends [
    infer Actor,
    infer Turn,
    infer Binding,
    infer Expiry,
  ]
    ? {
        actorSnapshot: Actor;
        turn: Turn;
        binding: Binding;
        expiresAt: Expiry;
      }
    : never,
) {
  let issued: Awaited<ReturnType<HermesStateRepository["issueRunCapability"]>>;
  try {
    issued = await repository.issueRunCapability(
      input.actorSnapshot,
      input.turn,
      input.binding,
      input.expiresAt,
    );
  } catch (error) {
    if (
      error instanceof HermesStateRepositoryError &&
      error.code === "parallel_limit"
    ) {
      throw new HermesRunCapabilityError("parallel_limit");
    }
    throw new HermesRunCapabilityError("persistence_failed");
  }

  const requestedExpiry = input.expiresAt as Date;
  const persistedExpiry = new Date(issued.expiresAt);
  if (
    !isUuid(issued.capabilityId) ||
    !isValidDate(persistedExpiry) ||
    persistedExpiry.getTime() > requestedExpiry.getTime()
  ) {
    throw new HermesRunCapabilityError("persistence_failed");
  }
  return issued;
}

function earliestDeadline(
  values: readonly (Date | undefined)[],
  now: Date,
): Date {
  const deadlines = values.filter(
    (value): value is Date => value !== undefined,
  );
  if (
    deadlines.length !== values.filter(Boolean).length ||
    deadlines.some((value) => !isValidDate(value))
  ) {
    throw new HermesRunCapabilityError("invalid_request");
  }
  const earliest = new Date(
    Math.min(...deadlines.map((value) => value.getTime())),
  );
  if (earliest.getTime() <= now.getTime()) {
    throw new HermesRunCapabilityError("deadline_expired");
  }
  return earliest;
}

function isValidGatewayActor(
  actor: HermesActorProfile,
  actorFingerprint: string,
): boolean {
  return (
    isHermesActorProfile(actor) &&
    actor.skillGrantsHash ===
      computeHermesSkillGrantsHash(actor.enabledSkillVersions) &&
    SHA256_PATTERN.test(actorFingerprint) &&
    createHermesActorFingerprint(actor) === actorFingerprint
  );
}

function isValidParent(parent: HermesParentRunCapability, now: Date): boolean {
  const expiry = new Date(parent.expiresAt);
  return (
    isValidGatewayActor(parent.actor, parent.actorFingerprint) &&
    isHermesMode(parent.mode) &&
    isUuid(parent.turnId) &&
    isUuid(parent.invocationId) &&
    isUuid(parent.rootInvocationId) &&
    parent.actor.invocationId === parent.invocationId &&
    parent.actor.conversationId.length > 0 &&
    Number.isInteger(parent.depth) &&
    parent.depth >= 0 &&
    parent.depth <= HERMES_MODE_BUDGETS[parent.mode].maxSubagentDepth &&
    canonicalTools(parent.allowedTools) !== null &&
    isUniqueScopeList(parent.scopes) &&
    isSubset(parent.scopes, parent.actor.allowedReadScopes) &&
    canonicalUuids(parent.skillDraftIds) !== null &&
    isValidDate(expiry) &&
    expiry.getTime() > now.getTime()
  );
}

function canonicalTools(values: readonly string[]): string[] | null {
  if (!isUniqueToolList(values)) return null;
  return [...values].sort(compareAscii);
}

function canonicalUuids(values: readonly string[]): string[] | null {
  if (
    !Array.isArray(values) ||
    values.length > 50 ||
    values.some((value) => !isUuid(value)) ||
    new Set(values).size !== values.length
  ) {
    return null;
  }
  return [...values].sort(compareAscii);
}

function isUniqueToolList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (tool) =>
        typeof tool === "string" &&
        TOOL_NAME_PATTERN.test(tool) &&
        tool.trim() === tool,
    ) &&
    new Set(value).size === value.length
  );
}

function isUniqueScopeList(value: unknown): value is HermesReadScope[] {
  return (
    Array.isArray(value) &&
    value.length <= 32 &&
    value.every(isHermesReadScope) &&
    new Set(value).size === value.length
  );
}

function isSubset(
  requested: readonly string[],
  allowed: readonly string[],
): boolean {
  return requested.every((value) => allowed.includes(value));
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
