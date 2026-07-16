import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runRecordingAiWorkerIteration } from "./recording-ai-worker";
import type { RecordingAiPipelineResult } from "./recording-ai-pipeline";

const now = new Date("2026-07-14T08:00:00.000Z");

function pipelineResult(): RecordingAiPipelineResult {
  return {
    providerName: "deepseek",
    asrProvider: "doubao_asr",
    transcriptText: "主播介绍新品并提醒人工确认优惠。",
    transcriptUtterances: [
      { text: "主播介绍新品", startSeconds: 0, endSeconds: 3 },
    ],
    draft: {
      summary: "开场清晰，互动偏少。",
      reviewBoundary: "AI 分析仅作为审核辅助。",
      scorecard: {
        rhythm: 80,
        script: 78,
        interaction: 60,
        media_quality: 70,
        compliance: 85,
        project_match: 75,
      },
      dimensions: [
        {
          key: "rhythm",
          label: "直播节奏",
          score: 80,
          finding: "开场节奏清晰。",
        },
      ],
      riskFlags: ["优惠承诺需人工确认"],
      recommendations: [
        {
          title: "复核优惠表述",
          detail: "由审核员确认后再沉淀。",
          requiresHumanApproval: true,
        },
      ],
      segments: [
        {
          segmentKind: "opening",
          startSeconds: 0,
          endSeconds: 60,
          title: "开场",
          summary: "快速进入主题。",
          riskLevel: "low",
          evidence: { source: "asr_transcript" },
          sortOrder: 1,
        },
      ],
    },
  };
}

describe("runRecordingAiWorkerIteration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("ASYNC_WORKERS_ENABLED", "true");
    vi.stubEnv("RECORDING_AI_WORKER_ENABLED", "true");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("does not claim when global or recording workload claims are disabled", async () => {
    const client = createWorkerClient({ claims: [analysisRow()] });

    vi.stubEnv("ASYNC_WORKERS_ENABLED", "false");
    await expect(
      runRecordingAiWorkerIteration({
        client: client as never,
        workerId: "recording:test:1",
        limit: 1,
        leaseSeconds: 120,
        now: () => now,
      }),
    ).resolves.toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      analyses: [],
      failures: [],
    });

    vi.stubEnv("ASYNC_WORKERS_ENABLED", "true");
    vi.stubEnv("RECORDING_AI_WORKER_ENABLED", "false");
    await runRecordingAiWorkerIteration({
      client: client as never,
      workerId: "recording:test:1",
      limit: 1,
      leaseSeconds: 120,
      now: () => now,
    });

    expect(client.rpcs.map((rpc) => rpc.name)).not.toContain(
      "claim_async_recording_ai",
    );
  });

  it("does not claim or consume attempts while a required provider breaker is open", async () => {
    const client = createWorkerClient({
      claims: [analysisRow()],
      breakers: {
        doubao_asr: {
          provider_key: "doubao_asr",
          state: "open",
          consecutive_failures: 5,
          opened_until: "2026-07-14T08:02:00.000Z",
          probe_worker_id: null,
          probe_lease_expires_at: null,
          last_error_code: "provider_failed",
          updated_at: "2026-07-14T07:59:00.000Z",
        },
      },
    });

    const result = await runRecordingAiWorkerIteration({
      client: client as never,
      workerId: "recording:test:1",
      limit: 1,
      leaseSeconds: 120,
      now: () => now,
    });

    expect(result.claimed).toBe(0);
    expect(client.rpcs.map((rpc) => rpc.name)).not.toContain(
      "claim_async_recording_ai",
    );
  });

  it("honors the configured LLM provider breaker before claiming", async () => {
    vi.stubEnv("AI_PRIMARY_PROVIDER", "hunyuan");
    vi.stubEnv("HUNYUAN_API_KEY", "hunyuan-key");
    vi.stubEnv("HUNYUAN_BASE_URL", "https://hunyuan.example");
    const client = createWorkerClient({
      claims: [analysisRow()],
      breakers: {
        hunyuan: {
          provider_key: "hunyuan",
          state: "open",
          consecutive_failures: 5,
          opened_until: "2026-07-14T08:02:00.000Z",
          probe_worker_id: null,
          probe_lease_expires_at: null,
          last_error_code: "provider_failed",
          updated_at: "2026-07-14T07:59:00.000Z",
        },
      },
    });

    const result = await runRecordingAiWorkerIteration({
      client: client as never,
      workerId: "recording:test:1",
      limit: 1,
      leaseSeconds: 120,
      now: () => now,
    });

    expect(result.claimed).toBe(0);
    expect(client.rpcs.map((rpc) => rpc.name)).not.toContain(
      "claim_async_recording_ai",
    );
  });

  it("claims one analysis, emits stages, renews the lease, and finalizes success", async () => {
    const client = createWorkerClient({ claims: [analysisRow()] });
    const stages: string[] = [];
    const pipeline = vi.fn(async ({ onStage }) => {
      await onStage?.("extracting_audio");
      await onStage?.("transcribing");
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
      await onStage?.("analyzing");
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
      await onStage?.("generating_report");
      return pipelineResult();
    });

    const result = await runRecordingAiWorkerIteration({
      client: client as never,
      workerId: "recording:test:1",
      limit: 1,
      leaseSeconds: 120,
      pipelineFactory: () => pipeline,
      now: () => now,
      onStage: (stage) => stages.push(stage),
    });

    expect(result).toMatchObject({
      claimed: 1,
      succeeded: 1,
      failed: 0,
      cancelled: 0,
      analyses: [{ id: "analysis-1", status: "succeeded", attempt: 1 }],
    });
    expect(stages).toEqual([
      "extracting_audio",
      "transcribing",
      "analyzing",
      "generating_report",
      "persisting",
    ]);
    expect(client.rpcs.filter((rpc) => rpc.name === "renew_async_task_lease"))
      .toHaveLength(2);
    expect(client.rpcs.at(-1)).toEqual({
      name: "finalize_async_task",
      params: expect.objectContaining({
        p_task_type: "recording_ai",
        p_task_id: "analysis-1",
        p_worker_id: "recording:test:1",
        p_status: "succeeded",
      }),
    });
    expect(client.updates.recording_ai_analyses).toEqual([]);
    expect(client.currentStatus("analysis-1")).toBe("succeeded");
  });

  it("finalizes pre-execution cancellation without calling the pipeline", async () => {
    const client = createWorkerClient({
      claims: [
        analysisRow({
          cancel_requested_at: "2026-07-14T07:59:00.000Z",
        }),
      ],
    });
    const pipeline = vi.fn(async () => pipelineResult());

    const result = await runRecordingAiWorkerIteration({
      client: client as never,
      workerId: "recording:test:1",
      limit: 1,
      leaseSeconds: 120,
      pipelineFactory: () => pipeline,
      now: () => now,
    });

    expect(result).toMatchObject({
      claimed: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 1,
      analyses: [{ id: "analysis-1", status: "cancelled", attempt: 1 }],
    });
    expect(pipeline).not.toHaveBeenCalled();
    expect(client.rpcs.at(-1)).toEqual({
      name: "finalize_async_task",
      params: expect.objectContaining({ p_status: "cancelled" }),
    });
  });

  it("stops before ASR when cancellation appears after audio extraction", async () => {
    const client = createWorkerClient({ claims: [analysisRow()] });
    const reachedStages: string[] = [];
    const pipeline = vi.fn(async ({ onStage }) => {
      await onStage?.("extracting_audio");
      client.cancelAnalysis("analysis-1");
      await onStage?.("transcribing");
      reachedStages.push("asr");
      return pipelineResult();
    });

    const result = await runRecordingAiWorkerIteration({
      client: client as never,
      workerId: "recording:test:1",
      limit: 1,
      leaseSeconds: 120,
      pipelineFactory: () => pipeline,
      now: () => now,
    });

    expect(result).toMatchObject({
      claimed: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 1,
      analyses: [{ id: "analysis-1", status: "cancelled", attempt: 1 }],
    });
    expect(reachedStages).toEqual([]);
    expect(client.rpcs.at(-1)).toEqual({
      name: "finalize_async_task",
      params: expect.objectContaining({ p_status: "cancelled" }),
    });
  });

  it("stops before finalizing success when cancellation appears before persisting", async () => {
    const client = createWorkerClient({ claims: [analysisRow()] });
    const pipeline = vi.fn(async ({ onStage }) => {
      await onStage?.("extracting_audio");
      await onStage?.("transcribing");
      await onStage?.("analyzing");
      await onStage?.("generating_report");
      client.cancelAnalysis("analysis-1");
      return pipelineResult();
    });

    const result = await runRecordingAiWorkerIteration({
      client: client as never,
      workerId: "recording:test:1",
      limit: 1,
      leaseSeconds: 120,
      pipelineFactory: () => pipeline,
      now: () => now,
    });

    expect(result).toMatchObject({
      claimed: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 1,
      analyses: [{ id: "analysis-1", status: "cancelled", attempt: 1 }],
    });
    expect(client.rpcs.at(-1)).toEqual({
      name: "finalize_async_task",
      params: expect.objectContaining({ p_status: "cancelled" }),
    });
    expect(client.rpcs.at(-1)?.params.p_metadata).not.toHaveProperty(
      "recordingResult",
    );
  });


  it("does not synthesize a terminal event when finalizer fails", async () => {
    const client = createWorkerClient({
      claims: [analysisRow()],
      finalizeError: new Error("finalize unavailable"),
    });

    const result = await runRecordingAiWorkerIteration({
      client: client as never,
      workerId: "recording:test:1",
      limit: 1,
      leaseSeconds: 120,
      pipelineFactory: () => async () => pipelineResult(),
      now: () => now,
    });

    expect(result).toMatchObject({
      claimed: 1,
      succeeded: 0,
      failed: 1,
      cancelled: 0,
      failures: [
        {
          analysisId: "analysis-1",
          errorCode: "finalize_failed",
          errorMessage: "finalize unavailable",
        },
      ],
    });
    expect(client.inserts.async_task_events).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ status: "succeeded" }),
      ]),
    );
    expect(client.inserts.recording_ai_segments).toEqual([]);
    expect(client.updates.recording_ai_analyses).toEqual([]);
  });

  it("returns terminal provider failures as analyses instead of runner failures", async () => {
    const client = createWorkerClient({
      claims: [analysisRow({ max_attempts: 1, recording_assets: null })],
    });

    const result = await runRecordingAiWorkerIteration({
      client: client as never,
      workerId: "recording:test:1",
      limit: 1,
      leaseSeconds: 120,
      pipelineFactory: () => null,
      now: () => now,
    });

    expect(result).toMatchObject({
      claimed: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      analyses: [{ id: "analysis-1", status: "failed", attempt: 1 }],
      failures: [],
    });
  });

  it("does not record provider success when the pipeline falls back to deterministic analysis", async () => {
    const client = createWorkerClient({ claims: [analysisRow()] });

    const result = await runRecordingAiWorkerIteration({
      client: client as never,
      workerId: "recording:test:1",
      limit: 1,
      leaseSeconds: 120,
      pipelineFactory: () => async () => {
        throw new Error("Doubao ASR failed");
      },
      now: () => now,
    });

    expect(result.succeeded).toBe(1);
    expect(client.updates.provider_circuit_breakers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ last_error_code: "provider_failed" }),
      ]),
    );
    expect(client.updates.provider_circuit_breakers).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ consecutive_failures: 0 }),
      ]),
    );
  });
});

function analysisRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "analysis-1",
    organization_id: "org-1",
    asset_id: "asset-1",
    status: "running",
    provider_name: "deterministic",
    summary: "",
    scorecard: {},
    dimensions: [],
    risk_flags: [],
    recommendations: [],
    transcript_text: null,
    transcript_utterances: [],
    asr_provider: null,
    attempt: 1,
    max_attempts: 3,
    stage: "extracting_audio",
    claimed_by: "recording:test:1",
    claimed_at: "2026-07-14T08:00:00.000Z",
    lease_expires_at: "2026-07-14T08:02:00.000Z",
    cancel_requested_at: null,
    error_summary: null,
    ai_invocation_id: "invocation-1",
    created_at: "2026-07-14T07:55:00.000Z",
    updated_at: "2026-07-14T08:00:00.000Z",
    completed_at: null,
    recording_ai_segments: [],
    recording_assets: {
      id: "asset-1",
      title: "项目录屏",
      asset_kind: "project_submission",
      review_status: "submitted",
      preview_state: "private_file",
      duration_seconds: 1800,
      project_id: "project-1",
      application_id: "application-1",
      created_at: "2026-07-14T07:50:00.000Z",
      updated_at: "2026-07-14T07:50:00.000Z",
      recording_asset_sources: [
        {
          id: "source-1",
          source_kind: "storage_object",
          preview_state: "private_file",
          provider: "private_storage",
          external_url: null,
          storage_path: "org-1/recordings/asset-1.mp4",
          submitted_at: "2026-07-14T07:50:00.000Z",
        },
      ],
    },
    ...overrides,
  };
}

function createWorkerClient({
  claims,
  breakers = {},
  finalizeError = null,
}: {
  claims: Record<string, unknown>[];
  breakers?: Record<string, Record<string, unknown>>;
  finalizeError?: Error | null;
}) {
  const inserts = {
    async_task_events: [] as Record<string, unknown>[],
    recording_ai_segments: [] as Record<string, unknown>[],
  };
  const updates = {
    recording_ai_analyses: [] as Record<string, unknown>[],
    provider_circuit_breakers: [] as Record<string, unknown>[],
  };
  const rpcs: Array<{ name: string; params: Record<string, unknown> }> = [];

  return {
    inserts,
    updates,
    rpcs,
    currentStatus(id: string) {
      return claims.find((row) => row.id === id)?.status;
    },
    cancelAnalysis(id: string) {
      const claim = claims.find((row) => row.id === id);
      if (claim) {
        claim.cancel_requested_at = "2026-07-14T08:00:30.000Z";
      }
    },
    rpc(name: string, params: Record<string, unknown>) {
      rpcs.push({ name, params });
      if (name === "claim_async_recording_ai") {
        return Promise.resolve({ data: claims, error: null });
      }
      if (name === "renew_async_task_lease") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "finalize_async_task") {
        if (finalizeError) {
          return Promise.resolve({ data: null, error: finalizeError });
        }
        const claim = claims.find((row) => row.id === params.p_task_id);
        if (claim) {
          claim.status = params.p_status;
          claim.claimed_at = null;
          claim.claimed_by = null;
          claim.lease_expires_at = null;
          claim.completed_at = "2026-07-14T08:00:00.000Z";
        }
        return Promise.resolve({
          data: {
            id: 1,
            task_type: "recording_ai",
            task_id: params.p_task_id,
            status: params.p_status,
            stage: "persisting",
            attempt: 1,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      if (table === "provider_circuit_breakers") {
        return providerBreakerTable(table, breakers, updates);
      }
      if (table === "async_task_events") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            inserts.async_task_events.push(payload);
            return { data: null, error: null };
          },
        };
      }
      if (table === "recording_ai_segments") {
        return {
          insert: async (payload: Record<string, unknown>[]) => {
            inserts.recording_ai_segments.push(...payload);
            return { data: null, error: null };
          },
        };
      }
      if (table === "recording_ai_analyses") {
        return {
          select: () => ({
            eq: (_column: string, id: string) => ({
              maybeSingle: async () => ({
                data:
                  claims.find((row) => row.id === id) ??
                  null,
                error: null,
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: async () => {
                  updates.recording_ai_analyses.push(payload);
                  const row = { ...claims[0], ...payload };
                  claims[0] = row;
                  return { data: row, error: null };
                },
              }),
            }),
          }),
        };
      }
      return {
        insert: async () => ({ data: null, error: null }),
      };
    },
  };
}

function providerBreakerTable(
  table: string,
  breakers: Record<string, Record<string, unknown>>,
  updates: { provider_circuit_breakers: Record<string, unknown>[] },
) {
  void table;
  const query = (data: unknown) => ({
    select: () => query(data),
    maybeSingle: () => query(data),
    single: () => query(data),
    eq: () => query(data),
    or: () => query(data),
    then: (resolve: (value: { data: unknown; error: null }) => void) =>
      Promise.resolve({ data, error: null }).then(resolve),
  });
  return {
    select: () => ({
      eq: (_column: string, providerKey: string) => ({
        maybeSingle: () => query(breakers[providerKey] ?? null),
      }),
    }),
    update: (payload: Record<string, unknown>) => {
      updates.provider_circuit_breakers.push(payload);
      return query({ ...payload, provider_key: "doubao_asr" });
    },
    upsert: () => query(null),
  };
}
