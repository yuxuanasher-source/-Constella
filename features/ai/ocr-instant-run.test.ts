import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  releaseInlineKickSlot,
  tryAcquireInlineKickSlot,
} from "./inline-kick-gate";
import {
  OCR_INLINE_KICK_DEFAULT_LIMIT,
  OCR_INLINE_KICK_GATE,
  kickQueuedOcrJobsInProcess,
} from "./ocr-instant-run";
import { createTencentOcrProvider } from "./providers/tencent-ocr-provider";

const { resolveIdentity, claimJobs, runJob } = vi.hoisted(() => ({
  resolveIdentity: vi.fn(),
  claimJobs: vi.fn(),
  runJob: vi.fn(),
}));

vi.mock("./ocr-runner-identity", () => ({
  resolveOcrRunnerIdentity: resolveIdentity,
}));
vi.mock("./ocr-jobs", () => ({
  claimRunnableOcrJobs: claimJobs,
  runOcrJobOnce: runJob,
}));
vi.mock("./ocr-image-source", () => ({
  resolveOcrImageInput: vi.fn(),
}));
vi.mock("./providers/tencent-ocr-provider", () => ({
  createTencentOcrProvider: vi.fn(() => ({})),
  readTencentOcrConfigFromEnv: vi.fn(() => null),
}));
vi.mock("@/lib/config/env", () => ({
  getPrivateStorageBucket: vi.fn(() => "private"),
}));

const identityOk = {
  ok: true as const,
  client: {} as never,
  actor: {
    userId: "11111111-1111-4111-8111-111111111111",
    name: "OCR Runner",
    role: "ops_manager" as const,
    organizationId: "22222222-2222-4222-8222-222222222222",
  },
};

describe("kickQueuedOcrJobsInProcess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OCR_INLINE_KICK_LIMIT;
  });

  it("claims with the clamped requested limit and runs every job", async () => {
    resolveIdentity.mockReturnValue(identityOk);
    claimJobs.mockResolvedValue([{ id: "job-1" }, { id: "job-2" }]);
    runJob.mockResolvedValue({});

    await kickQueuedOcrJobsInProcess({ limit: 99 });

    expect(claimJobs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
    expect(runJob).toHaveBeenCalledTimes(2);
  });

  it("passes an unconfigured provider result through the shared run path", async () => {
    resolveIdentity.mockReturnValue(identityOk);
    claimJobs.mockResolvedValue([{ id: "job-unconfigured" }]);
    const provider = {
      runGeneralBasicOcr: vi.fn(async () => ({
        status: "degraded" as const,
        textLines: [],
        textItems: [],
        confidence: 0,
        degradedReason: "provider_unconfigured",
      })),
    };
    vi.mocked(createTencentOcrProvider).mockReturnValueOnce(provider);
    runJob.mockImplementationOnce(async ({ provider: sharedProvider }) => {
      await sharedProvider.runGeneralBasicOcr({ imageBase64: "AQID" });
      return {};
    });

    await kickQueuedOcrJobsInProcess({ limit: 1 });

    expect(runJob).toHaveBeenCalledWith(
      expect.objectContaining({ provider }),
    );
    expect(provider.runGeneralBasicOcr).toHaveBeenCalledOnce();
  });

  it("silently skips when the runner identity is not configured", async () => {
    resolveIdentity.mockReturnValue({
      ok: false,
      reason: "runner_not_configured",
    });

    await expect(
      kickQueuedOcrJobsInProcess({ limit: 1 }),
    ).resolves.toBeUndefined();
    expect(claimJobs).not.toHaveBeenCalled();
  });

  it("skips when the concurrency gate is full", async () => {
    resolveIdentity.mockReturnValue(identityOk);
    const held: number[] = [];
    for (let i = 0; i < OCR_INLINE_KICK_DEFAULT_LIMIT; i += 1) {
      expect(
        tryAcquireInlineKickSlot(
          OCR_INLINE_KICK_GATE,
          OCR_INLINE_KICK_DEFAULT_LIMIT,
        ),
      ).toBe(true);
      held.push(i);
    }
    try {
      await kickQueuedOcrJobsInProcess({ limit: 1 });
      expect(claimJobs).not.toHaveBeenCalled();
    } finally {
      for (let index = 0; index < held.length; index += 1) {
        releaseInlineKickSlot(OCR_INLINE_KICK_GATE);
      }
    }
  });

  it("keeps running later jobs when one job fails, then releases the slot", async () => {
    resolveIdentity.mockReturnValue(identityOk);
    claimJobs.mockResolvedValue([{ id: "job-1" }, { id: "job-2" }]);
    runJob.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await kickQueuedOcrJobsInProcess({ limit: 2 });
      expect(runJob).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalled();

      // 闸门已释放：后续 kick 能继续拿到名额。
      claimJobs.mockResolvedValue([]);
      await kickQueuedOcrJobsInProcess({ limit: 1 });
      expect(claimJobs).toHaveBeenCalledTimes(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("honours OCR_INLINE_KICK_LIMIT=0 as fully disabled", async () => {
    resolveIdentity.mockReturnValue(identityOk);
    process.env.OCR_INLINE_KICK_LIMIT = "0";

    await kickQueuedOcrJobsInProcess({ limit: 1 });

    expect(claimJobs).not.toHaveBeenCalled();
  });
});
