import type { AiProviderName } from "@/features/ai/contracts";

export type ProviderKey = "tencent_ocr" | "doubao_asr" | AiProviderName;

export type ProviderCircuitBreakerState = "closed" | "open" | "half_open";

export type ProviderCircuitBreakerRecord = {
  providerKey: string;
  state: ProviderCircuitBreakerState;
  consecutiveFailures: number;
  openedUntil: Date | null;
  probeWorkerId: string | null;
  probeLeaseExpiresAt: Date | null;
  lastErrorCode: string | null;
  updatedAt: Date;
};

export type ProviderCircuitBreakerRepository = {
  getProviderBreaker(
    providerKey: ProviderKey,
  ): Promise<ProviderCircuitBreakerRecord | null>;
  recordRetryableFailure(input: {
    providerKey: ProviderKey;
    workerId: string;
    errorCode: string;
    failureThreshold: number;
    openedUntil: Date;
    now: Date;
  }): Promise<ProviderCircuitBreakerRecord>;
  recordNonRetryableFailure(input: {
    providerKey: ProviderKey;
    errorCode: string;
    now: Date;
  }): Promise<void>;
  acquireHalfOpenProbe(input: {
    providerKey: ProviderKey;
    workerId: string;
    probeLeaseExpiresAt: Date;
    now: Date;
  }): Promise<ProviderCircuitBreakerRecord | null>;
  closeProvider(input: {
    providerKey: ProviderKey;
    workerId: string;
    now: Date;
  }): Promise<boolean>;
  reopenProvider(input: {
    providerKey: ProviderKey;
    workerId: string;
    errorCode: string;
    openedUntil: Date;
    now: Date;
  }): Promise<ProviderCircuitBreakerRecord | null>;
};

type ProviderCircuitBreakerQuery = PromiseLike<{
  data: unknown;
  error: { message?: string } | null;
}> & {
  select(columns?: string): ProviderCircuitBreakerQuery;
  maybeSingle(): ProviderCircuitBreakerQuery;
  eq(column: string, value: unknown): ProviderCircuitBreakerQuery;
  or(filter: string): ProviderCircuitBreakerQuery;
};

type ProviderCircuitBreakerTable = {
  select(columns?: string): ProviderCircuitBreakerQuery;
  update(payload: Record<string, unknown>): ProviderCircuitBreakerQuery;
  upsert(
    payload: Record<string, unknown>,
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): ProviderCircuitBreakerQuery;
};

export type ProviderCircuitBreakerClient = {
  from(table: "provider_circuit_breakers"): ProviderCircuitBreakerTable;
};

export type ProviderCircuitBreakerDependencies = {
  repository: ProviderCircuitBreakerRepository;
  failureThreshold?: number;
  openDurationMs?: number;
  probeLeaseMs?: number;
};

export type ProviderCallDecision =
  | { allowed: true; probe: boolean }
  | { allowed: false; retryAt: Date; reason: "circuit_open" };

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_OPEN_DURATION_MS = 2 * 60 * 1000;
const DEFAULT_PROBE_LEASE_MS = 30 * 1000;
const PROVIDER_BREAKER_COLUMNS =
  "provider_key, state, consecutive_failures, opened_until, probe_worker_id, probe_lease_expires_at, last_error_code, updated_at";

export function createProviderCircuitBreakerRepository(
  client: ProviderCircuitBreakerClient,
): ProviderCircuitBreakerRepository {
  return {
    getProviderBreaker(providerKey) {
      return getProviderBreakerRow(client, providerKey);
    },

    async recordNonRetryableFailure(input) {
      await ensureProviderBreakerRow(client, input.providerKey, input.now);
      await requireNoError(
        client
          .from("provider_circuit_breakers")
          .update({
            last_error_code: input.errorCode,
            updated_at: input.now.toISOString(),
          })
          .eq("provider_key", input.providerKey),
        "record provider non-retryable failure failed",
      );
    },

    async recordRetryableFailure(input) {
      await ensureProviderBreakerRow(client, input.providerKey, input.now);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await getProviderBreakerRow(client, input.providerKey);
        const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1;
        const shouldOpen = consecutiveFailures >= input.failureThreshold;
        const updated = await readOptionalRow(
          client
            .from("provider_circuit_breakers")
            .update({
              state: shouldOpen ? "open" : "closed",
              consecutive_failures: consecutiveFailures,
              opened_until: shouldOpen ? input.openedUntil.toISOString() : null,
              probe_worker_id: null,
              probe_lease_expires_at: null,
              last_error_code: input.errorCode,
              updated_at: input.now.toISOString(),
            })
            .eq("provider_key", input.providerKey)
            .eq("state", current?.state ?? "closed")
            .eq("consecutive_failures", current?.consecutiveFailures ?? 0)
            .select(PROVIDER_BREAKER_COLUMNS)
            .maybeSingle(),
          "record provider retryable failure failed",
        );
        if (updated !== null) {
          return updated;
        }
      }

      throw new Error("record provider retryable failure conflicted");
    },

    acquireHalfOpenProbe(input) {
      return readOptionalRow(
        client
          .from("provider_circuit_breakers")
          .update({
            state: "half_open",
            probe_worker_id: input.workerId,
            probe_lease_expires_at: input.probeLeaseExpiresAt.toISOString(),
            updated_at: input.now.toISOString(),
          })
          .eq("provider_key", input.providerKey)
          .or(
            [
              `and(state.eq.open,opened_until.lte.${input.now.toISOString()})`,
              `and(state.eq.half_open,probe_lease_expires_at.lte.${input.now.toISOString()})`,
              "and(state.eq.half_open,probe_lease_expires_at.is.null)",
            ].join(","),
          )
          .select(PROVIDER_BREAKER_COLUMNS)
          .maybeSingle(),
        "acquire provider probe failed",
      );
    },

    async closeProvider(input) {
      const updated = await readOptionalRow(
        client
          .from("provider_circuit_breakers")
          .update({
            state: "closed",
            consecutive_failures: 0,
            opened_until: null,
            probe_worker_id: null,
            probe_lease_expires_at: null,
            last_error_code: null,
            updated_at: input.now.toISOString(),
          })
          .eq("provider_key", input.providerKey)
          .or(
            [
              "state.eq.closed",
              `and(state.eq.half_open,probe_worker_id.eq.${input.workerId},probe_lease_expires_at.gt.${input.now.toISOString()})`,
            ].join(","),
          )
          .select(PROVIDER_BREAKER_COLUMNS)
          .maybeSingle(),
        "close provider breaker failed",
      );
      return updated !== null;
    },

    reopenProvider(input) {
      return readOptionalRow(
        client
          .from("provider_circuit_breakers")
          .update({
            state: "open",
            opened_until: input.openedUntil.toISOString(),
            probe_worker_id: null,
            probe_lease_expires_at: null,
            last_error_code: input.errorCode,
            updated_at: input.now.toISOString(),
          })
          .eq("provider_key", input.providerKey)
          .eq("state", "half_open")
          .eq("probe_worker_id", input.workerId)
          .or(`probe_lease_expires_at.gt.${input.now.toISOString()}`)
          .select(PROVIDER_BREAKER_COLUMNS)
          .maybeSingle(),
        "reopen provider breaker failed",
      );
    },
  };
}

export async function canCallProvider(
  dependencies: ProviderCircuitBreakerDependencies,
  providerKey: ProviderKey,
  workerId: string,
  now = new Date(),
): Promise<ProviderCallDecision> {
  const breaker = await dependencies.repository.getProviderBreaker(providerKey);
  if (breaker === null || breaker.state === "closed") {
    return { allowed: true, probe: false };
  }

  if (breaker.state === "open" && isAfter(now, breaker.openedUntil)) {
    return acquireProbe(dependencies, providerKey, workerId, now, breaker);
  }

  if (breaker.state === "half_open") {
    if (breaker.probeWorkerId === workerId && isBefore(now, breaker.probeLeaseExpiresAt)) {
      return { allowed: true, probe: true };
    }

    if (breaker.probeLeaseExpiresAt === null || isAfter(now, breaker.probeLeaseExpiresAt)) {
      return acquireProbe(dependencies, providerKey, workerId, now, breaker);
    }

    return denyUntil(breaker.probeLeaseExpiresAt ?? now);
  }

  return denyUntil(breaker.openedUntil ?? now);
}

export async function recordProviderFailure(
  dependencies: ProviderCircuitBreakerDependencies,
  input: {
    providerKey: ProviderKey;
    workerId: string;
    errorCode: string;
    retryable: boolean;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  if (!input.retryable) {
    await dependencies.repository.recordNonRetryableFailure({
      providerKey: input.providerKey,
      errorCode: input.errorCode,
      now,
    });
    return;
  }

  const openedUntil = addMilliseconds(now, openDurationMs(dependencies));
  const breaker = await dependencies.repository.getProviderBreaker(input.providerKey);
  if (breaker?.state === "half_open") {
    if (
      breaker.probeWorkerId !== input.workerId ||
      !isBefore(now, breaker.probeLeaseExpiresAt)
    ) {
      return;
    }
    await dependencies.repository.reopenProvider({
      providerKey: input.providerKey,
      workerId: input.workerId,
      errorCode: input.errorCode,
      openedUntil,
      now,
    });
    return;
  }

  if (breaker?.state === "open") {
    return;
  }

  await dependencies.repository.recordRetryableFailure({
    providerKey: input.providerKey,
    workerId: input.workerId,
    errorCode: input.errorCode,
    failureThreshold: failureThreshold(dependencies),
    openedUntil,
    now,
  });
}

export async function recordProviderSuccess(
  dependencies: ProviderCircuitBreakerDependencies,
  input: { providerKey: ProviderKey; workerId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const breaker = await dependencies.repository.getProviderBreaker(input.providerKey);
  if (breaker === null || breaker.state === "open") {
    return;
  }

  if (
    breaker.state === "half_open" &&
    (breaker.probeWorkerId !== input.workerId ||
      !isBefore(now, breaker.probeLeaseExpiresAt))
  ) {
    return;
  }

  await dependencies.repository.closeProvider({
    providerKey: input.providerKey,
    workerId: input.workerId,
    now,
  });
}

async function acquireProbe(
  dependencies: ProviderCircuitBreakerDependencies,
  providerKey: ProviderKey,
  workerId: string,
  now: Date,
  previous: ProviderCircuitBreakerRecord,
): Promise<ProviderCallDecision> {
  const breaker = await dependencies.repository.acquireHalfOpenProbe({
    providerKey,
    workerId,
    probeLeaseExpiresAt: addMilliseconds(now, probeLeaseMs(dependencies)),
    now,
  });

  if (breaker?.probeWorkerId === workerId) {
    return { allowed: true, probe: true };
  }

  const current =
    (await dependencies.repository.getProviderBreaker(providerKey)) ?? previous;
  return denyUntil(
    current.probeLeaseExpiresAt ?? current.openedUntil ?? previous.openedUntil ?? now,
  );
}

function denyUntil(retryAt: Date): ProviderCallDecision {
  return { allowed: false, retryAt, reason: "circuit_open" };
}

function isAfter(now: Date, date: Date | null): boolean {
  return date !== null && now.getTime() >= date.getTime();
}

function isBefore(now: Date, date: Date | null): boolean {
  return date !== null && now.getTime() < date.getTime();
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

function failureThreshold(dependencies: ProviderCircuitBreakerDependencies) {
  return dependencies.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
}

function openDurationMs(dependencies: ProviderCircuitBreakerDependencies) {
  return dependencies.openDurationMs ?? DEFAULT_OPEN_DURATION_MS;
}

function probeLeaseMs(dependencies: ProviderCircuitBreakerDependencies) {
  return dependencies.probeLeaseMs ?? DEFAULT_PROBE_LEASE_MS;
}

async function ensureProviderBreakerRow(
  client: ProviderCircuitBreakerClient,
  providerKey: ProviderKey,
  now: Date,
): Promise<void> {
  await requireNoError(
    client.from("provider_circuit_breakers").upsert(
      {
        provider_key: providerKey,
        state: "closed",
        consecutive_failures: 0,
        opened_until: null,
        probe_worker_id: null,
        probe_lease_expires_at: null,
        last_error_code: null,
        updated_at: now.toISOString(),
      },
      { onConflict: "provider_key", ignoreDuplicates: true },
    ),
    "ensure provider breaker failed",
  );
}

async function getProviderBreakerRow(
  client: ProviderCircuitBreakerClient,
  providerKey: ProviderKey,
): Promise<ProviderCircuitBreakerRecord | null> {
  return readOptionalRow(
    client
      .from("provider_circuit_breakers")
      .select(PROVIDER_BREAKER_COLUMNS)
      .eq("provider_key", providerKey)
      .maybeSingle(),
    "load provider breaker failed",
  );
}

async function readOptionalRow(
  query: ProviderCircuitBreakerQuery,
  message: string,
): Promise<ProviderCircuitBreakerRecord | null> {
  const { data, error } = await query;
  if (error) {
    throw new Error(error.message ?? message);
  }
  if (data === null) {
    return null;
  }
  return mapProviderBreakerRow(data);
}

async function requireNoError(
  query: ProviderCircuitBreakerQuery,
  message: string,
): Promise<void> {
  const { error } = await query;
  if (error) {
    throw new Error(error.message ?? message);
  }
}

function mapProviderBreakerRow(value: unknown): ProviderCircuitBreakerRecord {
  if (!isRecord(value)) {
    throw new Error("Invalid provider circuit breaker row");
  }

  return {
    providerKey: requiredString(value.provider_key, "provider_key"),
    state: parseState(value.state),
    consecutiveFailures: nonnegativeInteger(value.consecutive_failures),
    openedUntil: optionalDate(value.opened_until),
    probeWorkerId: optionalString(value.probe_worker_id),
    probeLeaseExpiresAt: optionalDate(value.probe_lease_expires_at),
    lastErrorCode: optionalString(value.last_error_code),
    updatedAt: optionalDate(value.updated_at) ?? new Date(0),
  };
}

function parseState(value: unknown): ProviderCircuitBreakerState {
  if (value === "closed" || value === "open" || value === "half_open") {
    return value;
  }
  throw new Error("Invalid provider circuit breaker state");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
