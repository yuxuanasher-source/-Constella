import { describe, expect, it, vi } from "vitest";

import {
  createConversationStreamBuffer,
  isNearConversationBottom,
  type ConversationStreamBufferScheduler,
} from "./conversation-stream-buffer";

describe("conversation stream buffer", () => {
  it("batches deltas into one frame and commits no more often than every 50ms", () => {
    const harness = schedulerHarness();
    const commit = vi.fn();
    const buffer = createConversationStreamBuffer({
      commit,
      scheduler: harness.scheduler,
    });

    buffer.pushDelta("a");
    buffer.pushDelta("b");
    harness.runFrame();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenLastCalledWith("ab");

    harness.advance(10);
    buffer.pushDelta("c");
    expect(harness.timerDelay()).toBe(40);
    harness.runTimer();
    harness.runFrame();
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith("c");
  });

  it("flushes pending text synchronously before a tool or terminal boundary", () => {
    const harness = schedulerHarness();
    const order: string[] = [];
    const buffer = createConversationStreamBuffer({
      commit: (chunk) => order.push(`text:${chunk}`),
      scheduler: harness.scheduler,
    });

    buffer.pushDelta("partial");
    buffer.flush();
    order.push("tool");

    expect(order).toEqual(["text:partial", "tool"]);
    expect(harness.hasScheduledWork()).toBe(false);
  });

  it("ignores duplicate and stale event sequences", () => {
    const harness = schedulerHarness();
    const commit = vi.fn();
    const buffer = createConversationStreamBuffer({
      commit,
      scheduler: harness.scheduler,
    });

    expect(buffer.pushDelta("first", 4)).toBe(true);
    expect(buffer.pushDelta("duplicate", 4)).toBe(false);
    expect(buffer.pushDelta("stale", 3)).toBe(false);
    expect(buffer.pushDelta("next", 5)).toBe(true);
    buffer.flush();

    expect(commit).toHaveBeenCalledWith("firstnext");
    expect(buffer.lastSequence()).toBe(5);
  });

  it("flushes on disposal without scheduling future commits", () => {
    const harness = schedulerHarness();
    const commit = vi.fn();
    const buffer = createConversationStreamBuffer({
      commit,
      scheduler: harness.scheduler,
    });

    buffer.pushDelta("handoff");
    buffer.dispose();
    buffer.pushDelta("ignored");

    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith("handoff");
    expect(harness.hasScheduledWork()).toBe(false);
  });
});

describe("conversation scroll position", () => {
  it("sticks only when the reader is already near the bottom", () => {
    expect(
      isNearConversationBottom({
        scrollTop: 900,
        clientHeight: 300,
        scrollHeight: 1_250,
      }),
    ).toBe(true);
    expect(
      isNearConversationBottom({
        scrollTop: 400,
        clientHeight: 300,
        scrollHeight: 1_250,
      }),
    ).toBe(false);
  });
});

function schedulerHarness() {
  let now = 0;
  let frame: (() => void) | undefined;
  let timer: { callback: () => void; delay: number } | undefined;
  const scheduler: ConversationStreamBufferScheduler = {
    now: () => now,
    requestFrame: (callback) => {
      frame = callback;
      return "frame";
    },
    cancelFrame: () => {
      frame = undefined;
    },
    setTimer: (callback, delay) => {
      timer = { callback, delay };
      return "timer";
    },
    clearTimer: () => {
      timer = undefined;
    },
  };

  return {
    scheduler,
    advance(ms: number) {
      now += ms;
    },
    runFrame() {
      const callback = frame;
      frame = undefined;
      callback?.();
    },
    runTimer() {
      const scheduled = timer;
      timer = undefined;
      if (!scheduled) return;
      now += scheduled.delay;
      scheduled.callback();
    },
    timerDelay() {
      return timer?.delay;
    },
    hasScheduledWork() {
      return Boolean(frame || timer);
    },
  };
}
