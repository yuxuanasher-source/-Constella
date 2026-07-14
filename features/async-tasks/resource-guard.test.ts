import { describe, expect, it } from "vitest";

import { readResourceProtectionState } from "./resource-guard";

describe("async task resource guard", () => {
  const normalReadings = {
    loadAverage: () => 0.25,
    cpuCount: () => 4,
    memory: () => ({ totalBytes: 100, freeBytes: 50 }),
    tempDiskUsage: async () => ({ usedBytes: 10, totalBytes: 100 }),
  };

  it("returns cpu_high when normalized load reaches the configured threshold", async () => {
    await expect(
      readResourceProtectionState({
        ...normalReadings,
        loadAverage: () => 3.2,
        cpuCount: () => 4,
        thresholds: { cpuLoadRatio: 0.75, memoryUsageRatio: 0.9, diskUsageRatio: 0.8 },
      }),
    ).resolves.toBe("cpu_high");
  });

  it("returns memory_high when memory usage reaches the configured threshold", async () => {
    await expect(
      readResourceProtectionState({
        ...normalReadings,
        memory: () => ({ totalBytes: 100, freeBytes: 10 }),
        thresholds: { cpuLoadRatio: 0.9, memoryUsageRatio: 0.9, diskUsageRatio: 0.8 },
      }),
    ).resolves.toBe("memory_high");
  });

  it("returns disk_high at the exact 80 percent temporary disk usage boundary", async () => {
    await expect(
      readResourceProtectionState({
        ...normalReadings,
        tempDiskUsage: async () => ({ usedBytes: 80, totalBytes: 100 }),
        thresholds: { cpuLoadRatio: 0.9, memoryUsageRatio: 0.9, diskUsageRatio: 0.8 },
      }),
    ).resolves.toBe("disk_high");
  });

  it("returns normal when every resource is below its threshold", async () => {
    await expect(
      readResourceProtectionState({
        ...normalReadings,
        thresholds: { cpuLoadRatio: 0.9, memoryUsageRatio: 0.9, diskUsageRatio: 0.8 },
      }),
    ).resolves.toBe("normal");
  });

  it("fails closed with disk_high when the temporary directory cannot be inspected", async () => {
    await expect(
      readResourceProtectionState({
        ...normalReadings,
        tempDiskUsage: async () => {
          throw new Error("stat failed");
        },
        thresholds: { cpuLoadRatio: 0.9, memoryUsageRatio: 0.9, diskUsageRatio: 0.8 },
      }),
    ).resolves.toBe("disk_high");
  });
});
