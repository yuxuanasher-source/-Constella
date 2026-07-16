import { describe, expect, it } from "vitest";

import {
  canCallProvider,
  createProviderCircuitBreakerRepository,
  recordProviderFailure,
  recordProviderSuccess,
  type ProviderCircuitBreakerDependencies,
  type ProviderCircuitBreakerRecord,
  type ProviderCircuitBreakerRepository,
} from "./provider-circuit-breaker";

const baseNow = new Date("2026-07-14T10:00:00.000Z");

describe("provider circuit breaker", () => {
  it("leaves the provider closed before the retryable failure threshold", async () => {
    const deps = createDeps();

    for (let failure = 1; failure < 5; failure += 1) {
      await recordProviderFailure(deps, {
        providerKey: "tencent_ocr",
        workerId: "worker-a",
        errorCode: "TENCENT_5XX",
        retryable: true,
        now: baseNow,
      });
    }

    expect(deps.repository.snapshot("tencent_ocr")).toMatchObject({
      state: "closed",
      consecutiveFailures: 4,
      openedUntil: null,
    });
    await expect(
      canCallProvider(deps, "tencent_ocr", "worker-a", baseNow),
    ).resolves.toEqual({ allowed: true, probe: false });
  });

  it("opens the provider for the default two minutes on the fifth retryable failure", async () => {
    const deps = createDeps();

    for (let failure = 1; failure <= 5; failure += 1) {
      await recordProviderFailure(deps, {
        providerKey: "tencent_ocr",
        workerId: "worker-a",
        errorCode: "TENCENT_5XX",
        retryable: true,
        now: baseNow,
      });
    }

    expect(deps.repository.snapshot("tencent_ocr")).toMatchObject({
      state: "open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T10:02:00.000Z"),
      lastErrorCode: "TENCENT_5XX",
    });
    await expect(
      canCallProvider(deps, "tencent_ocr", "worker-a", baseNow),
    ).resolves.toEqual({
      allowed: false,
      retryAt: new Date("2026-07-14T10:02:00.000Z"),
      reason: "circuit_open",
    });
  });

  it("does not advance the outage counter for non-retryable provider failures", async () => {
    const deps = createDeps();

    for (const errorCode of [
      "OCR_INPUT_INVALID",
      "OCR_AUTH_INVALID",
      "OCR_PROVIDER_UNCONFIGURED",
    ]) {
      await recordProviderFailure(deps, {
        providerKey: "tencent_ocr",
        workerId: "worker-a",
        errorCode,
        retryable: false,
        now: baseNow,
      });
    }

    expect(deps.repository.snapshot("tencent_ocr")).toMatchObject({
      state: "closed",
      consecutiveFailures: 0,
      lastErrorCode: "OCR_PROVIDER_UNCONFIGURED",
    });
  });

  it("allows exactly one worker to acquire the half-open probe lease after the open window", async () => {
    const deps = createDeps();
    deps.repository.seed({
      providerKey: "tencent_ocr",
      state: "open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T10:02:00.000Z"),
      probeWorkerId: null,
      probeLeaseExpiresAt: null,
      lastErrorCode: "TENCENT_5XX",
      updatedAt: baseNow,
    });

    const afterOpen = new Date("2026-07-14T10:02:00.000Z");
    await expect(
      canCallProvider(deps, "tencent_ocr", "worker-a", afterOpen),
    ).resolves.toEqual({ allowed: true, probe: true });
    await expect(
      canCallProvider(deps, "tencent_ocr", "worker-b", afterOpen),
    ).resolves.toEqual({
      allowed: false,
      retryAt: new Date("2026-07-14T10:02:30.000Z"),
      reason: "circuit_open",
    });
  });

  it("lets another worker reclaim an expired half-open probe lease", async () => {
    const deps = createDeps();
    deps.repository.seed({
      providerKey: "doubao_asr",
      state: "half_open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T09:58:00.000Z"),
      probeWorkerId: "worker-a",
      probeLeaseExpiresAt: new Date("2026-07-14T10:00:30.000Z"),
      lastErrorCode: "DOUBAO_TIMEOUT",
      updatedAt: baseNow,
    });

    await expect(
      canCallProvider(
        deps,
        "doubao_asr",
        "worker-b",
        new Date("2026-07-14T10:00:31.000Z"),
      ),
    ).resolves.toEqual({ allowed: true, probe: true });
    expect(deps.repository.snapshot("doubao_asr")).toMatchObject({
      state: "half_open",
      probeWorkerId: "worker-b",
      probeLeaseExpiresAt: new Date("2026-07-14T10:01:01.000Z"),
    });
  });

  it("closes the breaker and clears failure and probe state after a successful probe", async () => {
    const deps = createDeps();
    deps.repository.seed({
      providerKey: "deepseek",
      state: "half_open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T09:58:00.000Z"),
      probeWorkerId: "worker-a",
      probeLeaseExpiresAt: new Date("2026-07-14T10:00:30.000Z"),
      lastErrorCode: "DEEPSEEK_TIMEOUT",
      updatedAt: baseNow,
    });

    await recordProviderSuccess(deps, {
      providerKey: "deepseek",
      workerId: "worker-a",
      now: baseNow,
    });

    expect(deps.repository.snapshot("deepseek")).toMatchObject({
      state: "closed",
      consecutiveFailures: 0,
      openedUntil: null,
      probeWorkerId: null,
      probeLeaseExpiresAt: null,
      lastErrorCode: null,
    });
  });

  it("ignores half-open success from a worker that does not own the probe lease", async () => {
    const deps = createDeps();
    deps.repository.seed({
      providerKey: "deepseek",
      state: "half_open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T09:58:00.000Z"),
      probeWorkerId: "worker-a",
      probeLeaseExpiresAt: new Date("2026-07-14T10:00:30.000Z"),
      lastErrorCode: "DEEPSEEK_TIMEOUT",
      updatedAt: baseNow,
    });

    await recordProviderSuccess(deps, {
      providerKey: "deepseek",
      workerId: "worker-b",
      now: baseNow,
    });

    expect(deps.repository.snapshot("deepseek")).toMatchObject({
      state: "half_open",
      consecutiveFailures: 5,
      probeWorkerId: "worker-a",
      probeLeaseExpiresAt: new Date("2026-07-14T10:00:30.000Z"),
    });
  });

  it("ignores half-open success from an expired probe owner", async () => {
    const deps = createDeps();
    deps.repository.seed({
      providerKey: "deepseek",
      state: "half_open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T09:58:00.000Z"),
      probeWorkerId: "worker-a",
      probeLeaseExpiresAt: new Date("2026-07-14T10:00:30.000Z"),
      lastErrorCode: "DEEPSEEK_TIMEOUT",
      updatedAt: baseNow,
    });

    await recordProviderSuccess(deps, {
      providerKey: "deepseek",
      workerId: "worker-a",
      now: new Date("2026-07-14T10:00:31.000Z"),
    });

    expect(deps.repository.snapshot("deepseek")).toMatchObject({
      state: "half_open",
      probeWorkerId: "worker-a",
      probeLeaseExpiresAt: new Date("2026-07-14T10:00:30.000Z"),
    });
  });

  it("does not close an open breaker for stale in-flight success", async () => {
    const deps = createDeps();
    deps.repository.seed({
      providerKey: "deepseek",
      state: "open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T10:02:00.000Z"),
      probeWorkerId: null,
      probeLeaseExpiresAt: null,
      lastErrorCode: "DEEPSEEK_TIMEOUT",
      updatedAt: baseNow,
    });

    await recordProviderSuccess(deps, {
      providerKey: "deepseek",
      workerId: "worker-a",
      now: new Date("2026-07-14T10:01:00.000Z"),
    });

    expect(deps.repository.snapshot("deepseek")).toMatchObject({
      state: "open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T10:02:00.000Z"),
      lastErrorCode: "DEEPSEEK_TIMEOUT",
    });
  });

  it("reopens a failed probe without touching task-attempt state", async () => {
    const deps = createDeps();
    deps.repository.seed({
      providerKey: "hunyuan",
      state: "half_open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T09:58:00.000Z"),
      probeWorkerId: "worker-a",
      probeLeaseExpiresAt: new Date("2026-07-14T10:00:30.000Z"),
      lastErrorCode: "HUNYUAN_TIMEOUT",
      updatedAt: baseNow,
    });

    await recordProviderFailure(deps, {
      providerKey: "hunyuan",
      workerId: "worker-a",
      errorCode: "HUNYUAN_5XX",
      retryable: true,
      now: baseNow,
    });

    expect(deps.repository.taskAttempts).toBe(0);
    expect(deps.repository.snapshot("hunyuan")).toMatchObject({
      state: "open",
      openedUntil: new Date("2026-07-14T10:02:00.000Z"),
      probeWorkerId: null,
      probeLeaseExpiresAt: null,
      lastErrorCode: "HUNYUAN_5XX",
    });
  });

  it("ignores half-open failure from a worker that does not own the probe lease", async () => {
    const deps = createDeps();
    deps.repository.seed({
      providerKey: "hunyuan",
      state: "half_open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T09:58:00.000Z"),
      probeWorkerId: "worker-a",
      probeLeaseExpiresAt: new Date("2026-07-14T10:00:30.000Z"),
      lastErrorCode: "HUNYUAN_TIMEOUT",
      updatedAt: baseNow,
    });

    await recordProviderFailure(deps, {
      providerKey: "hunyuan",
      workerId: "worker-b",
      errorCode: "HUNYUAN_5XX",
      retryable: true,
      now: baseNow,
    });

    expect(deps.repository.snapshot("hunyuan")).toMatchObject({
      state: "half_open",
      probeWorkerId: "worker-a",
      lastErrorCode: "HUNYUAN_TIMEOUT",
    });
  });

  it("does not extend an already-open breaker for stale retryable failures", async () => {
    const deps = createDeps();
    deps.repository.seed({
      providerKey: "tencent_ocr",
      state: "open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T10:02:00.000Z"),
      probeWorkerId: null,
      probeLeaseExpiresAt: null,
      lastErrorCode: "TENCENT_5XX",
      updatedAt: baseNow,
    });

    await recordProviderFailure(deps, {
      providerKey: "tencent_ocr",
      workerId: "worker-a",
      errorCode: "TENCENT_TIMEOUT",
      retryable: true,
      now: new Date("2026-07-14T10:01:30.000Z"),
    });

    expect(deps.repository.snapshot("tencent_ocr")).toMatchObject({
      state: "open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T10:02:00.000Z"),
      lastErrorCode: "TENCENT_5XX",
    });
  });

  it("recovers a half-open row with a missing probe lease by acquiring a new probe", async () => {
    const deps = createDeps();
    deps.repository.seed({
      providerKey: "doubao_asr",
      state: "half_open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T09:58:00.000Z"),
      probeWorkerId: "worker-a",
      probeLeaseExpiresAt: null,
      lastErrorCode: "DOUBAO_TIMEOUT",
      updatedAt: baseNow,
    });

    await expect(
      canCallProvider(deps, "doubao_asr", "worker-b", baseNow),
    ).resolves.toEqual({ allowed: true, probe: true });
    expect(deps.repository.snapshot("doubao_asr")).toMatchObject({
      state: "half_open",
      probeWorkerId: "worker-b",
      probeLeaseExpiresAt: new Date("2026-07-14T10:00:30.000Z"),
    });
  });

  it("uses injected thresholds and lease durations", async () => {
    const deps = createDeps({
      failureThreshold: 2,
      openDurationMs: 10_000,
      probeLeaseMs: 5_000,
    });

    await recordProviderFailure(deps, {
      providerKey: "openai",
      workerId: "worker-a",
      errorCode: "OPENAI_TIMEOUT",
      retryable: true,
      now: baseNow,
    });
    await recordProviderFailure(deps, {
      providerKey: "openai",
      workerId: "worker-a",
      errorCode: "OPENAI_TIMEOUT",
      retryable: true,
      now: baseNow,
    });

    expect(deps.repository.snapshot("openai")).toMatchObject({
      state: "open",
      openedUntil: new Date("2026-07-14T10:00:10.000Z"),
    });

    await expect(
      canCallProvider(
        deps,
        "openai",
        "worker-a",
        new Date("2026-07-14T10:00:10.000Z"),
      ),
    ).resolves.toEqual({ allowed: true, probe: true });
    expect(deps.repository.snapshot("openai")?.probeLeaseExpiresAt).toEqual(
      new Date("2026-07-14T10:00:15.000Z"),
    );
  });
});

describe("createProviderCircuitBreakerRepository", () => {
  it("uses provider_circuit_breakers with conditional half-open probe updates", async () => {
    const client = createRecordingClient([
      {
        provider_key: "tencent_ocr",
        state: "half_open",
        consecutive_failures: 5,
        opened_until: "2026-07-14T10:02:00.000Z",
        probe_worker_id: "worker-a",
        probe_lease_expires_at: "2026-07-14T10:00:30.000Z",
        last_error_code: "TENCENT_5XX",
        updated_at: "2026-07-14T10:00:00.000Z",
      },
    ]);
    const repository = createProviderCircuitBreakerRepository(client);

    await repository.acquireHalfOpenProbe({
      providerKey: "tencent_ocr",
      workerId: "worker-a",
      probeLeaseExpiresAt: new Date("2026-07-14T10:00:30.000Z"),
      now: baseNow,
    });

    expect(client.calls).toContainEqual({
      method: "from",
      table: "provider_circuit_breakers",
    });
    expect(client.calls).toContainEqual({
      method: "update",
      payload: expect.objectContaining({
        state: "half_open",
        probe_worker_id: "worker-a",
      }),
    });
    expect(client.calls).toContainEqual({
      method: "or",
      filter: expect.stringContaining("state.eq.open"),
    });
    expect(client.calls).toContainEqual({
      method: "or",
      filter: expect.stringContaining("probe_lease_expires_at.is.null"),
    });
  });

  it("persists retryable failure counters with optimistic state conditions", async () => {
    const client = createRecordingClient([
      null,
      {
        provider_key: "deepseek",
        state: "closed",
        consecutive_failures: 4,
        opened_until: null,
        probe_worker_id: null,
        probe_lease_expires_at: null,
        last_error_code: "DEEPSEEK_TIMEOUT",
        updated_at: "2026-07-14T10:00:00.000Z",
      },
      {
        provider_key: "deepseek",
        state: "open",
        consecutive_failures: 5,
        opened_until: "2026-07-14T10:02:00.000Z",
        probe_worker_id: null,
        probe_lease_expires_at: null,
        last_error_code: "DEEPSEEK_TIMEOUT",
        updated_at: "2026-07-14T10:00:00.000Z",
      },
    ]);
    const repository = createProviderCircuitBreakerRepository(client);

    const record = await repository.recordRetryableFailure({
      providerKey: "deepseek",
      workerId: "worker-a",
      errorCode: "DEEPSEEK_TIMEOUT",
      failureThreshold: 5,
      openedUntil: new Date("2026-07-14T10:02:00.000Z"),
      now: baseNow,
    });

    expect(record).toMatchObject({
      state: "open",
      consecutiveFailures: 5,
      openedUntil: new Date("2026-07-14T10:02:00.000Z"),
    });
    expect(client.calls).toContainEqual({
      method: "upsert",
      payload: expect.objectContaining({ provider_key: "deepseek" }),
      options: { onConflict: "provider_key", ignoreDuplicates: true },
    });
    expect(client.calls).toContainEqual({
      method: "eq",
      column: "consecutive_failures",
      value: 4,
    });
  });
});

function createDeps(
  options: Omit<Partial<ProviderCircuitBreakerDependencies>, "repository"> = {},
): ProviderCircuitBreakerDependencies & { repository: FakeProviderBreakerRepository } {
  const repository = new FakeProviderBreakerRepository();
  return {
    repository,
    ...options,
  };
}

type RecordingCall =
  | { method: "from"; table: string }
  | { method: "select"; columns?: string }
  | { method: "update"; payload: Record<string, unknown> }
  | {
      method: "upsert";
      payload: Record<string, unknown>;
      options?: { onConflict?: string; ignoreDuplicates?: boolean };
    }
  | { method: "eq"; column: string; value: unknown }
  | { method: "or"; filter: string }
  | { method: "maybeSingle" };

function createRecordingClient(results: unknown[]) {
  const calls: RecordingCall[] = [];
  return {
    calls,
    from(table: string) {
      calls.push({ method: "from", table });
      return new RecordingQuery(calls, results);
    },
  };
}

class RecordingQuery
  implements PromiseLike<{ data: unknown; error: { message?: string } | null }>
{
  constructor(
    private readonly calls: RecordingCall[],
    private readonly results: unknown[],
  ) {}

  select(columns?: string) {
    this.calls.push({ method: "select", columns });
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.calls.push({ method: "update", payload });
    return this;
  }

  upsert(
    payload: Record<string, unknown>,
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {
    this.calls.push({ method: "upsert", payload, options });
    return this;
  }

  eq(column: string, value: unknown) {
    this.calls.push({ method: "eq", column, value });
    return this;
  }

  or(filter: string) {
    this.calls.push({ method: "or", filter });
    return this;
  }

  maybeSingle() {
    this.calls.push({ method: "maybeSingle" });
    return this;
  }

  then<TResult1 = { data: unknown; error: { message?: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((
          value: { data: unknown; error: { message?: string } | null },
        ) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): PromiseLike<TResult1 | TResult2> {
    const data = this.results.length > 0 ? this.results.shift() : null;
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class FakeProviderBreakerRepository implements ProviderCircuitBreakerRepository {
  readonly rows = new Map<string, ProviderCircuitBreakerRecord>();
  taskAttempts = 0;

  async getProviderBreaker(providerKey: string) {
    return this.snapshot(providerKey);
  }

  async recordNonRetryableFailure(input: {
    providerKey: string;
    errorCode: string;
    now: Date;
  }) {
    const current = this.snapshot(input.providerKey);
    this.rows.set(input.providerKey, {
      providerKey: input.providerKey,
      state: current?.state ?? "closed",
      consecutiveFailures: current?.consecutiveFailures ?? 0,
      openedUntil: current?.openedUntil ?? null,
      probeWorkerId: current?.probeWorkerId ?? null,
      probeLeaseExpiresAt: current?.probeLeaseExpiresAt ?? null,
      lastErrorCode: input.errorCode,
      updatedAt: input.now,
    });
  }

  async recordRetryableFailure(input: {
    providerKey: string;
    workerId: string;
    errorCode: string;
    failureThreshold: number;
    openedUntil: Date;
    now: Date;
  }) {
    const current = this.snapshot(input.providerKey);
    const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1;
    const shouldOpen = consecutiveFailures >= input.failureThreshold;
    const next: ProviderCircuitBreakerRecord = {
      providerKey: input.providerKey,
      state: shouldOpen ? "open" : "closed",
      consecutiveFailures,
      openedUntil: shouldOpen ? input.openedUntil : null,
      probeWorkerId: null,
      probeLeaseExpiresAt: null,
      lastErrorCode: input.errorCode,
      updatedAt: input.now,
    };
    this.rows.set(input.providerKey, next);
    return { ...next };
  }

  async acquireHalfOpenProbe(input: {
    providerKey: string;
    workerId: string;
    probeLeaseExpiresAt: Date;
    now: Date;
  }) {
    const current = this.snapshot(input.providerKey);
    if (!current) {
      return null;
    }

    const openWindowExpired =
      current.openedUntil !== null && current.openedUntil.getTime() <= input.now.getTime();
    const probeLeaseExpired =
      current.probeLeaseExpiresAt === null ||
      current.probeLeaseExpiresAt.getTime() <= input.now.getTime();

    if (
      (current.state === "open" && openWindowExpired) ||
      (current.state === "half_open" && probeLeaseExpired)
    ) {
      const next: ProviderCircuitBreakerRecord = {
        ...current,
        state: "half_open",
        probeWorkerId: input.workerId,
        probeLeaseExpiresAt: input.probeLeaseExpiresAt,
        updatedAt: input.now,
      };
      this.rows.set(input.providerKey, next);
      return { ...next };
    }

    return null;
  }

  async closeProvider(input: { providerKey: string; workerId: string; now: Date }) {
    const current = this.snapshot(input.providerKey);
    if (current === null || current.state === "open") {
      return false;
    }
    if (
      current?.state === "half_open" &&
      (current.probeWorkerId !== input.workerId ||
        current.probeLeaseExpiresAt === null ||
        current.probeLeaseExpiresAt.getTime() <= input.now.getTime())
    ) {
      return false;
    }
    this.rows.set(input.providerKey, {
      providerKey: input.providerKey,
      state: "closed",
      consecutiveFailures: 0,
      openedUntil: null,
      probeWorkerId: null,
      probeLeaseExpiresAt: null,
      lastErrorCode: null,
      updatedAt: input.now,
    });
    return current !== null;
  }

  async reopenProvider(input: {
    providerKey: string;
    workerId: string;
    errorCode: string;
    openedUntil: Date;
    now: Date;
  }) {
    const current = this.snapshot(input.providerKey);
    if (
      current?.state === "half_open" &&
      (current.probeWorkerId !== input.workerId ||
        current.probeLeaseExpiresAt === null ||
        current.probeLeaseExpiresAt.getTime() <= input.now.getTime())
    ) {
      return null;
    }
    const next: ProviderCircuitBreakerRecord = {
      providerKey: input.providerKey,
      state: "open",
      consecutiveFailures: Math.max(current?.consecutiveFailures ?? 0, 1),
      openedUntil: input.openedUntil,
      probeWorkerId: null,
      probeLeaseExpiresAt: null,
      lastErrorCode: input.errorCode,
      updatedAt: input.now,
    };
    this.rows.set(input.providerKey, next);
    return { ...next };
  }

  seed(record: ProviderCircuitBreakerRecord) {
    this.rows.set(record.providerKey, { ...record });
  }

  snapshot(providerKey: string) {
    const row = this.rows.get(providerKey);
    return row ? { ...row } : null;
  }
}
