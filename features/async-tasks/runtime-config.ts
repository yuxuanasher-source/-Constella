export type AsyncWorkerWorkload =
  | "ocr"
  | "recording"
  | "settlement"
  | "maintenance";

export type AsyncWorkerRuntimeConfig = {
  claimsEnabled: boolean;
  watchdogEnabled: boolean;
  idleMs: number;
  heartbeatIntervalMs: number;
  errorBackoffMs: number;
  maxConcurrentJobs: number;
  workloads: Record<AsyncWorkerWorkload, boolean>;
};

type RuntimeEnv = Record<string, string | undefined>;

const WORKLOAD_ENV_KEYS: Record<AsyncWorkerWorkload, readonly string[]> = {
  ocr: ["OCR_WORKER_ENABLED", "ASYNC_WORKERS_OCR_ENABLED"],
  recording: [
    "RECORDING_AI_WORKER_ENABLED",
    "ASYNC_WORKERS_RECORDING_ENABLED",
  ],
  settlement: [
    "SETTLEMENT_SIMULATION_WORKER_ENABLED",
    "ASYNC_WORKERS_SETTLEMENT_ENABLED",
  ],
  maintenance: ["MAINTENANCE_WORKER_ENABLED", "ASYNC_WORKERS_MAINTENANCE_ENABLED"],
};

export function parseAsyncWorkerRuntimeConfig(
  env: RuntimeEnv,
): AsyncWorkerRuntimeConfig {
  const claimsEnabled = env.ASYNC_WORKERS_ENABLED === "true";

  return {
    claimsEnabled,
    watchdogEnabled: env.ASYNC_WORKER_WATCHDOG_ENABLED === "true",
    idleMs: getPositiveBoundedInteger(
      "ASYNC_WORKER_IDLE_MS",
      env.ASYNC_WORKER_IDLE_MS,
      1,
      60_000,
      5_000,
    ),
    heartbeatIntervalMs: getPositiveBoundedInteger(
      env.ASYNC_WORKER_HEARTBEAT_MS !== undefined
        ? "ASYNC_WORKER_HEARTBEAT_MS"
        : "ASYNC_WORKER_HEARTBEAT_INTERVAL_MS",
      env.ASYNC_WORKER_HEARTBEAT_MS ?? env.ASYNC_WORKER_HEARTBEAT_INTERVAL_MS,
      1,
      300_000,
      30_000,
    ),
    errorBackoffMs: getPositiveBoundedInteger(
      "ASYNC_WORKER_ERROR_BACKOFF_MS",
      env.ASYNC_WORKER_ERROR_BACKOFF_MS,
      1,
      300_000,
      15_000,
    ),
    maxConcurrentJobs: getPositiveBoundedInteger(
      "ASYNC_WORKER_MAX_CONCURRENT_JOBS",
      env.ASYNC_WORKER_MAX_CONCURRENT_JOBS,
      1,
      100,
      1,
    ),
    workloads: {
      ocr: isAnyFlagEnabled(env, WORKLOAD_ENV_KEYS.ocr, true),
      recording: isAnyFlagEnabled(env, WORKLOAD_ENV_KEYS.recording, true),
      settlement: isAnyFlagEnabled(env, WORKLOAD_ENV_KEYS.settlement, true),
      maintenance: isAnyFlagEnabled(env, WORKLOAD_ENV_KEYS.maintenance, true),
    },
  };
}

export function isWorkloadEnabled(
  config: AsyncWorkerRuntimeConfig,
  workload: AsyncWorkerWorkload,
) {
  return config.claimsEnabled && config.workloads[workload];
}

export function getPositiveBoundedInteger(
  name: string,
  value: string | undefined,
  min: number,
  max: number,
  defaultValue?: number,
) {
  if (value === undefined || value === "") {
    if (defaultValue === undefined) {
      throw new Error(`${name} is required`);
    }
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return parsed;
}

function isFlagEnabled(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) {
    return defaultValue;
  }

  return value === "true";
}

function isAnyFlagEnabled(
  env: RuntimeEnv,
  names: readonly string[],
  defaultValue: boolean,
) {
  for (const name of names) {
    if (env[name] !== undefined) {
      return isFlagEnabled(env[name], defaultValue);
    }
  }

  return defaultValue;
}
