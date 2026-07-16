import { hostname } from "node:os";

import {
  heartbeatWorker,
  markWorkerStopped,
} from "@/features/async-tasks/repository";
import { readResourceProtectionState } from "@/features/async-tasks/resource-guard";
import {
  isWorkloadEnabled,
  parseAsyncWorkerRuntimeConfig,
} from "@/features/async-tasks/runtime-config";
import {
  runWorkerLoop,
  sleepUntilAbortOrTimeout,
} from "@/features/async-tasks/worker-loop";
import { runRecordingAiWorkerIteration } from "@/features/recordings/recording-ai-worker";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

const client = createSupabaseAdminClient();
if (!client) {
  console.error("Supabase admin client is unavailable");
  process.exit(1);
}

const config = parseAsyncWorkerRuntimeConfig(process.env);
const workerId = `recording-ai:${hostname()}:${process.pid}`;
const controller = new AbortController();
let currentJobs = 0;

process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());

await runWorkerLoop({
  runOnce: async () => {
    const result = await runRecordingAiWorkerIteration({
      client: client as never,
      workerId,
      limit: config.maxConcurrentJobs,
      leaseSeconds: 120,
      onCurrentJobsChange: (count) => {
        currentJobs = count;
      },
    });
    return result.claimed;
  },
  isEnabled: () =>
    isWorkloadEnabled(parseAsyncWorkerRuntimeConfig(process.env), "recording"),
  heartbeat: (status, jobs, protectionState) =>
    heartbeatWorker(client as never, {
      workerId,
      workerType: "recording_ai",
      hostName: hostname(),
      status,
      currentJobs: jobs,
      concurrencyLimit: config.maxConcurrentJobs,
      protectionState,
    }),
  getCurrentJobs: () => currentJobs,
  sleep: sleepUntilAbortOrTimeout,
  idleMs: 1_000,
  heartbeatIntervalMs: config.heartbeatIntervalMs,
  errorBackoffMs: config.errorBackoffMs,
  signal: controller.signal,
  readProtectionState: () => readResourceProtectionState(),
});

await markWorkerStopped(client as never, workerId, new Date().toISOString());
