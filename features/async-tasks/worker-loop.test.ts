import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runWorkerLoop,
  sleepUntilAbortOrTimeout,
  type WorkerDesiredState,
  type WorkerLoopOptions,
} from "./worker-loop";
import type { ResourceProtectionState } from "./resource-guard";

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

describe("async task worker loop", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createOptions = (
    overrides: Partial<WorkerLoopOptions> = {},
  ): WorkerLoopOptions => {
    const controller = new AbortController();
    return {
      runOnce: vi.fn(async () => 0),
      isEnabled: () => true,
      heartbeat: vi.fn(async (): Promise<WorkerDesiredState> => "running"),
      getCurrentJobs: () => 0,
      sleep: vi.fn(async (_ms: number, _signal: AbortSignal) => {
        controller.abort();
      }),
      idleMs: 100,
      heartbeatIntervalMs: 30_000,
      errorBackoffMs: 500,
      signal: controller.signal,
      readProtectionState: vi.fn(
        async (): Promise<ResourceProtectionState> => "normal",
      ),
      ...overrides,
    };
  };

  it("polls immediately, then waits after an empty batch", async () => {
    const order: string[] = [];
    const controller = new AbortController();
    const options = createOptions({
      signal: controller.signal,
      runOnce: vi.fn(async () => {
        order.push("runOnce");
        return 0;
      }),
      sleep: vi.fn(async (ms: number) => {
        order.push(`sleep:${ms}`);
        controller.abort();
      }),
    });

    await runWorkerLoop(options);

    expect(options.runOnce).toHaveBeenCalledTimes(1);
    expect(options.runOnce).toHaveBeenCalledWith(controller.signal);
    expect(options.sleep).toHaveBeenCalledWith(100, controller.signal);
    expect(order).toEqual(["runOnce", "sleep:100"]);
  });

  it("exits on abort while a claim promise remains pending", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const neverClaim = createDeferred<number>();
    const options = createOptions({
      signal: controller.signal,
      runOnce: vi.fn(() => neverClaim.promise),
    });

    const loop = runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(options.runOnce).toHaveBeenCalledWith(controller.signal);

    controller.abort();
    const result = Promise.race([
      loop.then(() => "resolved"),
      new Promise<"timed out">((resolve) =>
        setTimeout(() => resolve("timed out"), 1),
      ),
    ]);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe("resolved");
  });

  it("stops claiming when drain is requested or the signal is already aborted", async () => {
    const draining = createOptions({
      heartbeat: vi.fn(async (): Promise<WorkerDesiredState> => "draining"),
    });
    await runWorkerLoop(draining);
    expect(draining.runOnce).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort();
    const aborted = createOptions({ signal: controller.signal });
    await runWorkerLoop(aborted);
    expect(aborted.runOnce).not.toHaveBeenCalled();
  });

  it("keeps pumping draining heartbeats after an initial drain request while jobs are active", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const heartbeats: Array<{ status: string; currentJobs: number }> = [];
    let currentJobs = 2;
    const options = createOptions({
      signal: controller.signal,
      getCurrentJobs: () => currentJobs,
      heartbeat: vi.fn(async (status, currentJobCount) => {
        heartbeats.push({ status, currentJobs: currentJobCount });
        return "draining";
      }) as WorkerLoopOptions["heartbeat"],
      sleep: vi.fn(async () => {
        await sleepUntilAbortOrTimeout(100, controller.signal);
      }),
    });

    const loop = runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(0);
    currentJobs = 1;
    await vi.advanceTimersByTimeAsync(30_000);
    currentJobs = 0;
    await vi.advanceTimersByTimeAsync(30_000);
    controller.abort();
    await vi.runOnlyPendingTimersAsync();
    await loop;

    expect(heartbeats).toEqual([
      { status: "running", currentJobs: 2 },
      { status: "draining", currentJobs: 1 },
    ]);
    expect(options.runOnce).not.toHaveBeenCalled();
  });

  it("exits without starting the heartbeat pump when an initial drain request has no active jobs", async () => {
    vi.useFakeTimers();
    const options = createOptions({
      getCurrentJobs: () => 0,
      heartbeat: vi.fn(async (): Promise<WorkerDesiredState> => "draining"),
    });

    await runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(options.heartbeat).toHaveBeenCalledTimes(1);
    expect(options.runOnce).not.toHaveBeenCalled();
  });

  it("backs off after a failed claim without terminating the loop", async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    const options = createOptions({
      signal: controller.signal,
      runOnce: vi
        .fn()
        .mockRejectedValueOnce(new Error("claim failed"))
        .mockResolvedValueOnce(0),
      sleep: vi.fn(async (ms: number) => {
        sleeps.push(ms);
        if (sleeps.length === 2) {
          controller.abort();
        }
      }),
    });

    await runWorkerLoop(options);

    expect(options.runOnce).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([500, 100]);
  });

  it("does not claim while resource protection is active", async () => {
    const controller = new AbortController();
    const options = createOptions({
      signal: controller.signal,
      readProtectionState: vi.fn(
        async (): Promise<ResourceProtectionState> => "memory_high",
      ),
      sleep: vi.fn(async () => {
        controller.abort();
      }),
    });

    await runWorkerLoop(options);

    expect(options.runOnce).not.toHaveBeenCalled();
    expect(options.sleep).toHaveBeenCalledWith(100, controller.signal);
  });

  it("keeps heartbeats pumping during a long in-flight claim with current job counts", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const claim = createDeferred<number>();
    const heartbeats: Array<{
      status: string;
      currentJobs: number;
      protectionState: ResourceProtectionState;
    }> = [];
    let currentJobs = 2;
    const options = createOptions({
      signal: controller.signal,
      runOnce: vi.fn(() => claim.promise),
      getCurrentJobs: () => currentJobs,
      heartbeat: vi.fn(async (status, currentJobCount, protectionState) => {
        heartbeats.push({ status, currentJobs: currentJobCount, protectionState });
        return "running";
      }) as WorkerLoopOptions["heartbeat"],
      sleep: vi.fn(async () => {
        controller.abort();
      }),
    });

    const loop = runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(0);
    currentJobs = 3;
    await vi.advanceTimersByTimeAsync(30_000);
    currentJobs = 4;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(heartbeats).toEqual([
      { status: "running", currentJobs: 2, protectionState: "normal" },
      { status: "running", currentJobs: 3, protectionState: "normal" },
      { status: "running", currentJobs: 4, protectionState: "normal" },
    ]);

    claim.resolve(0);
    await vi.runOnlyPendingTimersAsync();
    await loop;
  });

  it("does not overlap heartbeat calls", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const heartbeat = createDeferred<"running">();
    const claim = createDeferred<number>();
    const options = createOptions({
      signal: controller.signal,
      runOnce: vi.fn(() => claim.promise),
      heartbeat: vi
        .fn()
        .mockImplementationOnce(() => heartbeat.promise)
        .mockResolvedValue("running"),
      heartbeatTimeoutMs: 120_000,
      sleep: vi.fn(async () => {
        controller.abort();
      }),
    });

    const loop = runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(options.heartbeat).toHaveBeenCalledTimes(1);

    heartbeat.resolve("running");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(options.heartbeat).toHaveBeenCalledTimes(2);

    claim.resolve(0);
    await vi.runOnlyPendingTimersAsync();
    await loop;
  });

  it("exits on abort while the initial heartbeat is still pending", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const heartbeat = createDeferred<"running">();
    const options = createOptions({
      signal: controller.signal,
      heartbeat: vi.fn(() => heartbeat.promise),
    });

    const loop = runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(0);

    controller.abort();
    await expect(loop).resolves.toBeUndefined();
    expect(options.runOnce).not.toHaveBeenCalled();
    expect(options.heartbeat).toHaveBeenCalledTimes(1);
  });

  it("keeps claims paused and does not overlap when the initial heartbeat never settles", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    const initialHeartbeat = createDeferred<"running">();
    const options = createOptions({
      signal: controller.signal,
      heartbeat: vi.fn(() => initialHeartbeat.promise),
      heartbeatTimeoutMs: 10,
      runOnce: vi.fn(async () => 0),
      sleep: vi.fn(async () => {
        await sleepUntilAbortOrTimeout(100, controller.signal);
      }),
    });

    const loop = runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(10);

    expect(consoleError).toHaveBeenCalledWith("Async worker heartbeat timed out");
    expect(options.heartbeat).toHaveBeenCalledTimes(1);
    expect(options.runOnce).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(90_000);
    expect(options.heartbeat).toHaveBeenCalledTimes(1);
    expect(options.runOnce).not.toHaveBeenCalled();

    controller.abort();
    await vi.runOnlyPendingTimersAsync();
    await loop;
  });

  it("resumes claims and later heartbeats after a timed-out heartbeat eventually settles running", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    const claim = createDeferred<number>();
    const initialHeartbeat = createDeferred<"running">();
    const nextHeartbeat = createDeferred<"running">();
    const pausedSleep = createDeferred<void>();
    const options = createOptions({
      signal: controller.signal,
      runOnce: vi.fn(() => claim.promise),
      heartbeat: vi
        .fn()
        .mockImplementationOnce(() => initialHeartbeat.promise)
        .mockImplementationOnce(() => nextHeartbeat.promise),
      heartbeatTimeoutMs: 10,
      sleep: vi
        .fn()
        .mockImplementationOnce(() => pausedSleep.promise)
        .mockImplementation(async () => {
          controller.abort();
        }),
    });

    const loop = runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(10);

    expect(consoleError).toHaveBeenCalledWith("Async worker heartbeat timed out");
    expect(options.heartbeat).toHaveBeenCalledTimes(1);
    expect(options.runOnce).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(options.heartbeat).toHaveBeenCalledTimes(1);
    expect(options.runOnce).not.toHaveBeenCalled();

    initialHeartbeat.resolve("running");
    await vi.advanceTimersByTimeAsync(0);
    pausedSleep.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(options.runOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(options.heartbeat).toHaveBeenCalledTimes(2);

    controller.abort();
    claim.resolve(0);
    await expect(loop).resolves.toBeUndefined();
  });

  it("exits on abort while a pump heartbeat is still pending", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const heartbeat = createDeferred<"running">();
    const claim = createDeferred<number>();
    const options = createOptions({
      signal: controller.signal,
      runOnce: vi.fn(() => claim.promise),
      heartbeat: vi
        .fn()
        .mockResolvedValueOnce("running")
        .mockImplementationOnce(() => heartbeat.promise),
    });

    const loop = runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(options.heartbeat).toHaveBeenCalledTimes(2);

    controller.abort();
    claim.resolve(0);
    await expect(loop).resolves.toBeUndefined();
    expect(options.heartbeat).toHaveBeenCalledTimes(2);
  });

  it("blocks new claims after a pump heartbeat timeout until the timed-out attempt settles", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    const claim = createDeferred<number>();
    const timedOutHeartbeat = createDeferred<"running">();
    const resumedHeartbeat = createDeferred<"paused">();
    const options = createOptions({
      signal: controller.signal,
      runOnce: vi.fn(() => claim.promise),
      heartbeat: vi
        .fn()
        .mockResolvedValueOnce("running")
        .mockImplementationOnce(() => timedOutHeartbeat.promise)
        .mockImplementationOnce(() => resumedHeartbeat.promise),
      heartbeatTimeoutMs: 10,
      sleep: vi.fn(async () => {
        controller.abort();
      }),
    });

    const loop = runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(options.runOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(options.heartbeat).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10);
    expect(consoleError).toHaveBeenCalledWith("Async worker heartbeat timed out");
    expect(options.heartbeat).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(options.heartbeat).toHaveBeenCalledTimes(2);

    timedOutHeartbeat.resolve("running");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(options.heartbeat).toHaveBeenCalledTimes(3);
    resumedHeartbeat.resolve("paused");
    claim.resolve(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(options.runOnce).toHaveBeenCalledTimes(1);
    expect(options.sleep).toHaveBeenCalledWith(100, controller.signal);
    await vi.runOnlyPendingTimersAsync();
    await loop;
  });

  it("keeps sending draining heartbeats while an in-flight claim finishes", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const claim = createDeferred<number>();
    const statuses: string[] = [];
    let currentJobs = 1;
    const options = createOptions({
      signal: controller.signal,
      runOnce: vi.fn(() => claim.promise),
      getCurrentJobs: () => currentJobs,
      heartbeat: vi.fn(async (status) => {
        statuses.push(status);
        return statuses.length === 1 ? "running" : "draining";
      }) as WorkerLoopOptions["heartbeat"],
      sleep: vi.fn(async () => {
        controller.abort();
      }),
    });

    const loop = runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(options.runOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(statuses).toEqual(["running", "running", "draining"]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(statuses).toEqual(["running", "running", "draining", "draining"]);

    currentJobs = 0;
    claim.resolve(0);
    await vi.runOnlyPendingTimersAsync();
    await loop;
  });

  it("logs failed heartbeats and retries on the next interval without aborting work", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    const claim = createDeferred<number>();
    const options = createOptions({
      signal: controller.signal,
      runOnce: vi.fn(() => claim.promise),
      heartbeat: vi
        .fn()
        .mockRejectedValueOnce(new Error("heartbeat failed"))
        .mockResolvedValue("running"),
      sleep: vi.fn(async () => {
        controller.abort();
      }),
    });

    const loop = runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(consoleError).toHaveBeenCalledWith(
      "Async worker heartbeat failed",
      expect.any(Error),
    );
    expect(options.runOnce).toHaveBeenCalledTimes(1);
    expect(options.heartbeat).toHaveBeenCalledTimes(2);

    claim.resolve(0);
    await vi.runOnlyPendingTimersAsync();
    await loop;
  });

  it("skips claims while paused and continues heartbeat and idle sleep", async () => {
    const controller = new AbortController();
    const options = createOptions({
      signal: controller.signal,
      heartbeat: vi.fn(async (): Promise<WorkerDesiredState> => "paused"),
      sleep: vi.fn(async () => {
        controller.abort();
      }),
    });

    await runWorkerLoop(options);

    expect(options.runOnce).not.toHaveBeenCalled();
    expect(options.sleep).toHaveBeenCalledWith(100, controller.signal);
  });

  it("retains paused desired state after a failed heartbeat", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    const firstSleep = createDeferred<void>();
    const secondSleep = createDeferred<void>();
    const options = createOptions({
      signal: controller.signal,
      heartbeat: vi
        .fn()
        .mockResolvedValueOnce("paused")
        .mockRejectedValueOnce(new Error("heartbeat failed"))
        .mockResolvedValue("paused"),
      sleep: vi
        .fn()
        .mockImplementationOnce(() => firstSleep.promise)
        .mockImplementationOnce(() => secondSleep.promise),
    });

    const loop = runWorkerLoop(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(options.runOnce).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(consoleError).toHaveBeenCalledWith(
      "Async worker heartbeat failed",
      expect.any(Error),
    );
    expect(options.heartbeat).toHaveBeenCalledTimes(2);
    expect(options.runOnce).not.toHaveBeenCalled();

    firstSleep.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(options.sleep).toHaveBeenCalledTimes(2);
    expect(options.runOnce).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(options.heartbeat).toHaveBeenCalledTimes(3);
    expect(options.runOnce).not.toHaveBeenCalled();

    controller.abort();
    secondSleep.resolve();
    await vi.runOnlyPendingTimersAsync();
    await loop;
  });

  it("exits before a new claim when a running worker is asked to drain", async () => {
    const options = createOptions({
      heartbeat: vi.fn(async (): Promise<WorkerDesiredState> => "draining"),
    });

    await runWorkerLoop(options);

    expect(options.runOnce).not.toHaveBeenCalled();
  });

  it("keeps disabled workers on paused heartbeat and sleep without claiming", async () => {
    const controller = new AbortController();
    const options = createOptions({
      signal: controller.signal,
      isEnabled: () => false,
      sleep: vi.fn(async () => {
        controller.abort();
      }),
    });

    await runWorkerLoop(options);

    expect(options.heartbeat).toHaveBeenCalledWith("paused", 0, "normal");
    expect(options.runOnce).not.toHaveBeenCalled();
    expect(options.sleep).toHaveBeenCalledWith(100, controller.signal);
  });

  it("production sleep clears its timer when aborted", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const controller = new AbortController();
    const sleep = sleepUntilAbortOrTimeout(60_000, controller.signal);

    controller.abort();
    await expect(sleep).resolves.toBeUndefined();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
