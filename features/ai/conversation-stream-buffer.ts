export type ConversationStreamBufferScheduler = {
  now: () => number;
  requestFrame: (callback: () => void) => unknown;
  cancelFrame: (handle: unknown) => void;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

type ConversationStreamBufferOptions = {
  commit: (chunk: string) => void;
  scheduler?: Partial<ConversationStreamBufferScheduler>;
  minCommitIntervalMs?: number;
};

export type ConversationStreamBuffer = {
  pushDelta: (delta: string, sequence?: number) => boolean;
  acceptSequence: (sequence: number) => boolean;
  flush: () => void;
  dispose: (options?: { flush?: boolean }) => void;
  lastSequence: () => number;
};

const DEFAULT_MIN_COMMIT_INTERVAL_MS = 50;

export function createConversationStreamBuffer({
  commit,
  scheduler,
  minCommitIntervalMs = DEFAULT_MIN_COMMIT_INTERVAL_MS,
}: ConversationStreamBufferOptions): ConversationStreamBuffer {
  const clock = createScheduler(scheduler);
  const interval = Math.max(0, minCommitIntervalMs);
  let pending = "";
  let disposed = false;
  let latestSequence = 0;
  let lastCommitAt = Number.NEGATIVE_INFINITY;
  let frameHandle: unknown;
  let timerHandle: unknown;

  const cancelScheduled = () => {
    if (frameHandle !== undefined) {
      clock.cancelFrame(frameHandle);
      frameHandle = undefined;
    }
    if (timerHandle !== undefined) {
      clock.clearTimer(timerHandle);
      timerHandle = undefined;
    }
  };

  const commitPending = () => {
    cancelScheduled();
    if (!pending) return;
    const chunk = pending;
    pending = "";
    lastCommitAt = clock.now();
    commit(chunk);
  };

  const requestCommitFrame = () => {
    if (disposed || frameHandle !== undefined) return;
    frameHandle = clock.requestFrame(() => {
      frameHandle = undefined;
      commitPending();
    });
  };

  const scheduleCommit = () => {
    if (disposed || frameHandle !== undefined || timerHandle !== undefined) {
      return;
    }
    const elapsed = clock.now() - lastCommitAt;
    const remaining = Math.max(0, interval - elapsed);
    if (remaining === 0) {
      requestCommitFrame();
      return;
    }
    timerHandle = clock.setTimer(() => {
      timerHandle = undefined;
      requestCommitFrame();
    }, remaining);
  };

  const acceptSequence = (sequence: number) => {
    if (!Number.isSafeInteger(sequence) || sequence <= latestSequence) {
      return false;
    }
    latestSequence = sequence;
    return true;
  };

  return {
    pushDelta(delta, sequence) {
      if (disposed || !delta) return false;
      if (sequence !== undefined && !acceptSequence(sequence)) return false;
      pending += delta;
      scheduleCommit();
      return true;
    },
    acceptSequence,
    flush() {
      if (disposed) return;
      commitPending();
    },
    dispose(options = {}) {
      if (disposed) return;
      if (options.flush !== false) commitPending();
      else cancelScheduled();
      pending = "";
      disposed = true;
    },
    lastSequence() {
      return latestSequence;
    },
  };
}

export function isNearConversationBottom(
  metrics: {
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
  },
  thresholdPx = 80,
) {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <=
    Math.max(0, thresholdPx)
  );
}

function createScheduler(
  scheduler?: Partial<ConversationStreamBufferScheduler>,
): ConversationStreamBufferScheduler {
  return {
    now: scheduler?.now ?? (() => Date.now()),
    requestFrame:
      scheduler?.requestFrame ??
      ((callback) => requestAnimationFrame(() => callback())),
    cancelFrame:
      scheduler?.cancelFrame ??
      ((handle) => cancelAnimationFrame(handle as number)),
    setTimer:
      scheduler?.setTimer ??
      ((callback, delayMs) => setTimeout(callback, delayMs)),
    clearTimer:
      scheduler?.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
  };
}
