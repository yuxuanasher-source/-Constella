import { statfs } from "node:fs/promises";
import { cpus, freemem, loadavg, tmpdir, totalmem } from "node:os";

export type ResourceProtectionState =
  | "normal"
  | "cpu_high"
  | "memory_high"
  | "disk_high";

export type ResourceGuardThresholds = {
  cpuLoadRatio: number;
  memoryUsageRatio: number;
  diskUsageRatio: number;
};

export type ResourceGuardDependencies = {
  loadAverage?: () => number;
  cpuCount?: () => number;
  memory?: () => { totalBytes: number; freeBytes: number };
  tempDiskUsage?: () => Promise<{ usedBytes: number; totalBytes: number }>;
  thresholds?: Partial<ResourceGuardThresholds>;
};

const DEFAULT_THRESHOLDS: ResourceGuardThresholds = {
  cpuLoadRatio: 0.9,
  memoryUsageRatio: 0.9,
  diskUsageRatio: 0.8,
};

export async function readResourceProtectionState(
  dependencies: ResourceGuardDependencies = {},
): Promise<ResourceProtectionState> {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...dependencies.thresholds };
  const cpuCount = Math.max(1, dependencies.cpuCount?.() ?? cpus().length);
  const load = dependencies.loadAverage?.() ?? loadavg()[0] ?? 0;
  const normalizedLoad = load / cpuCount;

  if (normalizedLoad >= thresholds.cpuLoadRatio) {
    return "cpu_high";
  }

  const memory = dependencies.memory?.() ?? {
    totalBytes: totalmem(),
    freeBytes: freemem(),
  };
  const memoryUsageRatio =
    memory.totalBytes > 0
      ? (memory.totalBytes - memory.freeBytes) / memory.totalBytes
      : 1;

  if (memoryUsageRatio >= thresholds.memoryUsageRatio) {
    return "memory_high";
  }

  let diskUsage: { usedBytes: number; totalBytes: number };
  try {
    diskUsage = dependencies.tempDiskUsage
      ? await dependencies.tempDiskUsage()
      : await readDefaultTempDiskUsage();
  } catch {
    return "disk_high";
  }

  const diskUsageRatio =
    diskUsage.totalBytes > 0 ? diskUsage.usedBytes / diskUsage.totalBytes : 1;
  if (diskUsageRatio >= thresholds.diskUsageRatio) {
    return "disk_high";
  }

  return "normal";
}

async function readDefaultTempDiskUsage() {
  const stats = await statfs(tmpdir());
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bfree * stats.bsize;

  return {
    usedBytes: totalBytes - freeBytes,
    totalBytes,
  };
}
