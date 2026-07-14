import type { ResourceProtectionState } from "./resource-guard";

export type WorkerDesiredState = "running" | "paused" | "draining";

export type WorkerLoopOptions = {
  runOnce: (signal: AbortSignal) => Promise<number>;
  isEnabled: () => boolean;
  heartbeat: (
    status: "running" | "paused" | "draining",
    currentJobs: number,
    protectionState: ResourceProtectionState,
  ) => Promise<WorkerDesiredState>;
  getCurrentJobs: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  idleMs: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  errorBackoffMs?: number;
  signal: AbortSignal;
  readProtectionState: () => Promise<ResourceProtectionState>;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 5_000;
const DEFAULT_ERROR_BACKOFF_MS = 15_000;
const RUN_ONCE_ABORTED = Symbol("RUN_ONCE_ABORTED");
type HeartbeatResult = {
  desiredState: WorkerDesiredState;
  status: "settled" | "timeout" | "aborted" | "pending";
};

export async function runWorkerLoop(options: WorkerLoopOptions): Promise<void> {
  if (options.signal.aborted) {
    return;
  }

  let protectionState = await options.readProtectionState();
  let desiredState: WorkerDesiredState = "running";
  const heartbeatController = new AbortController();
  const heartbeat = createHeartbeatCoordinator(options, (state) => {
    desiredState = state;
  });
  const initialHeartbeat = await heartbeat.send(
    protectionState,
    desiredState,
    options.signal,
  );
  if (initialHeartbeat.status === "aborted") {
    return;
  }
  desiredState = initialHeartbeat.desiredState;
  let heartbeatPump: Promise<void> | undefined;
  const abortHeartbeat = () => heartbeatController.abort();
  options.signal.addEventListener("abort", abortHeartbeat, { once: true });

  const startHeartbeatPump = () => {
    heartbeatPump ??= pumpHeartbeats({
      options,
      signal: heartbeatController.signal,
      getProtectionState: () => protectionState,
      getDesiredState: () => desiredState,
      setDesiredState: (state) => {
        desiredState = state;
      },
      sendHeartbeat: heartbeat.send,
    });
  };

  if (
    (desiredState !== "draining" || options.getCurrentJobs() > 0)
  ) {
    startHeartbeatPump();
  }

  try {
    while (!options.signal.aborted) {
      if (desiredState === "draining" && options.getCurrentJobs() === 0) {
        break;
      }
      if (desiredState === "draining") {
        await options.sleep(options.idleMs, options.signal);
        continue;
      }

      protectionState = await options.readProtectionState();
      if (
        desiredState === "paused" ||
        !options.isEnabled() ||
        protectionState !== "normal"
      ) {
        await options.sleep(options.idleMs, options.signal);
        continue;
      }

      try {
        const claimedJobs = await runOnceUntilAbort(options);
        if (claimedJobs === RUN_ONCE_ABORTED) {
          break;
        }
        if (claimedJobs === 0) {
          await options.sleep(options.idleMs, options.signal);
        }
      } catch (error) {
        console.error("Async worker claim failed", error);
        await options.sleep(
          options.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS,
          options.signal,
        );
      }
    }
  } finally {
    heartbeatController.abort();
    options.signal.removeEventListener("abort", abortHeartbeat);
    await heartbeatPump;
  }
}

async function runOnceUntilAbort(
  options: WorkerLoopOptions,
): Promise<number | typeof RUN_ONCE_ABORTED> {
  if (options.signal.aborted) {
    return RUN_ONCE_ABORTED;
  }

  let removeAbortListener: (() => void) | undefined;
  const claim = options.runOnce(options.signal);
  claim.catch(() => {
    // If abort wins the race, the claim may settle later. runOnce implementations
    // should honor the signal to clean up provider/database resources promptly.
  });

  const aborted = new Promise<typeof RUN_ONCE_ABORTED>((resolve) => {
    const onAbort = () => resolve(RUN_ONCE_ABORTED);
    removeAbortListener = () =>
      options.signal.removeEventListener("abort", onAbort);
    options.signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([claim, aborted]);
  } finally {
    removeAbortListener?.();
  }
}

export function sleepUntilAbortOrTimeout(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(done, ms);

    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }

    signal.addEventListener("abort", done, { once: true });
  });
}

async function pumpHeartbeats({
  options,
  signal,
  getProtectionState,
  getDesiredState,
  setDesiredState,
  sendHeartbeat,
}: {
  options: WorkerLoopOptions;
  signal: AbortSignal;
  getProtectionState: () => ResourceProtectionState;
  getDesiredState: () => WorkerDesiredState;
  setDesiredState: (state: WorkerDesiredState) => void;
  sendHeartbeat: (
    protectionState: ResourceProtectionState,
    lastDesiredState: WorkerDesiredState,
    signal: AbortSignal,
  ) => Promise<HeartbeatResult>;
}) {
  while (!options.signal.aborted && !signal.aborted) {
    await sleepUntilAbortOrTimeout(
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      signal,
    );
    if (options.signal.aborted || signal.aborted) {
      break;
    }
    const state = await sendHeartbeat(
      getProtectionState(),
      getDesiredState(),
      signal,
    );
    if (state.status === "aborted") {
      break;
    }
    setDesiredState(state.desiredState);
    if (state.desiredState === "draining" && options.getCurrentJobs() === 0) {
      break;
    }
  }
}

function createHeartbeatCoordinator(
  options: WorkerLoopOptions,
  setDesiredState: (state: WorkerDesiredState) => void,
) {
  let inFlight: Promise<void> | undefined;

  const send = async (
    protectionState: ResourceProtectionState,
    lastDesiredState: WorkerDesiredState,
    signal: AbortSignal,
  ): Promise<HeartbeatResult> => {
    if (inFlight) {
      return { desiredState: "paused", status: "pending" };
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: (() => void) | undefined;
    let settled = false;
    let timedOut = false;

    const heartbeat = options
      .heartbeat(
        lastDesiredState === "draining"
          ? "draining"
          : options.isEnabled()
            ? "running"
            : "paused",
        options.getCurrentJobs(),
        protectionState,
      )
      .then((desiredState) => {
        settled = true;
        return { desiredState, status: "settled" as const };
      })
      .catch((error) => {
        settled = true;
        console.error("Async worker heartbeat failed", error);
        return {
          desiredState: timedOut ? "paused" : lastDesiredState,
          status: "settled" as const,
        };
      });

    inFlight = heartbeat
      .then((result) => {
        setDesiredState(result.desiredState);
      })
      .finally(() => {
        inFlight = undefined;
      });

    const abortOrTimeout = new Promise<HeartbeatResult>((resolve) => {
      const done = (reason: "aborted" | "timed out") => {
        if (settled) {
          return;
        }
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        removeAbortListener?.();
        console.error(`Async worker heartbeat ${reason}`);
        if (reason === "timed out") {
          timedOut = true;
        }
        resolve({
          desiredState: reason === "timed out" ? "paused" : lastDesiredState,
          status: reason === "timed out" ? "timeout" : "aborted",
        });
      };
      const onAbort = () => done("aborted");
      removeAbortListener = () => signal.removeEventListener("abort", onAbort);

      timeout = setTimeout(
        () => done("timed out"),
        options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
      );
      signal.addEventListener("abort", onAbort, { once: true });
    });

    try {
      return await Promise.race([heartbeat, abortOrTimeout]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      removeAbortListener?.();
    }
  };

  return { send };
}
