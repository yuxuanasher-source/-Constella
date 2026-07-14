import { describe, expect, it } from "vitest";

import {
  getPositiveBoundedInteger,
  isWorkloadEnabled,
  parseAsyncWorkerRuntimeConfig,
} from "./runtime-config";

describe("async worker runtime config", () => {
  it("enables claims only when ASYNC_WORKERS_ENABLED is exactly true", () => {
    expect(
      parseAsyncWorkerRuntimeConfig({ ASYNC_WORKERS_ENABLED: "true" }).claimsEnabled,
    ).toBe(true);
    expect(parseAsyncWorkerRuntimeConfig({}).claimsEnabled).toBe(false);
    expect(
      parseAsyncWorkerRuntimeConfig({ ASYNC_WORKERS_ENABLED: "false" }).claimsEnabled,
    ).toBe(false);
    expect(
      parseAsyncWorkerRuntimeConfig({ ASYNC_WORKERS_ENABLED: "TRUE" }).claimsEnabled,
    ).toBe(false);
  });

  it("lets per-workload flags further disable their own claims", () => {
    const config = parseAsyncWorkerRuntimeConfig({
      ASYNC_WORKERS_ENABLED: "true",
      ASYNC_WORKERS_OCR_ENABLED: "false",
      ASYNC_WORKERS_RECORDING_ENABLED: "true",
      ASYNC_WORKERS_SETTLEMENT_ENABLED: "TRUE",
    });

    expect(isWorkloadEnabled(config, "ocr")).toBe(false);
    expect(isWorkloadEnabled(config, "recording")).toBe(true);
    expect(isWorkloadEnabled(config, "settlement")).toBe(false);
    expect(isWorkloadEnabled(config, "maintenance")).toBe(true);
  });

  it.each([
    ["ocr", "OCR_WORKER_ENABLED"],
    ["recording", "RECORDING_AI_WORKER_ENABLED"],
    ["settlement", "SETTLEMENT_SIMULATION_WORKER_ENABLED"],
    ["maintenance", "MAINTENANCE_WORKER_ENABLED"],
  ] as const)(
    "lets planned %s worker flag disable its workload",
    (workload, flagName) => {
      const config = parseAsyncWorkerRuntimeConfig({
        ASYNC_WORKERS_ENABLED: "true",
        [flagName]: "false",
      });

      expect(isWorkloadEnabled(config, workload)).toBe(false);
    },
  );

  it("keeps the watchdog active when workload claims are globally disabled", () => {
    const config = parseAsyncWorkerRuntimeConfig({
      ASYNC_WORKERS_ENABLED: "false",
      ASYNC_WORKER_WATCHDOG_ENABLED: "true",
    });

    expect(config.claimsEnabled).toBe(false);
    expect(config.watchdogEnabled).toBe(true);
    expect(isWorkloadEnabled(config, "recording")).toBe(false);
  });

  it("uses bounded numeric defaults when settings are absent", () => {
    const config = parseAsyncWorkerRuntimeConfig({});

    expect(config.idleMs).toBe(5_000);
    expect(config.heartbeatIntervalMs).toBe(30_000);
    expect(config.errorBackoffMs).toBe(15_000);
    expect(config.maxConcurrentJobs).toBe(1);
  });

  it("uses the documented heartbeat interval setting", () => {
    const config = parseAsyncWorkerRuntimeConfig({
      ASYNC_WORKER_HEARTBEAT_MS: "45",
    });

    expect(config.heartbeatIntervalMs).toBe(45);
  });

  it("prefers the documented heartbeat interval setting over the legacy alias", () => {
    const config = parseAsyncWorkerRuntimeConfig({
      ASYNC_WORKER_HEARTBEAT_MS: "45",
      ASYNC_WORKER_HEARTBEAT_INTERVAL_MS: "90",
    });

    expect(config.heartbeatIntervalMs).toBe(45);
  });

  it("rejects nonpositive, non-integer, and unbounded numeric settings", () => {
    expect(() => getPositiveBoundedInteger("TEST_LIMIT", "0", 1, 10)).toThrow(
      /TEST_LIMIT/,
    );
    expect(() => getPositiveBoundedInteger("TEST_LIMIT", "1.5", 1, 10)).toThrow(
      /TEST_LIMIT/,
    );
    expect(() => getPositiveBoundedInteger("TEST_LIMIT", "11", 1, 10)).toThrow(
      /TEST_LIMIT/,
    );
    expect(() => getPositiveBoundedInteger("TEST_LIMIT", "Infinity", 1, 10)).toThrow(
      /TEST_LIMIT/,
    );
  });
});
