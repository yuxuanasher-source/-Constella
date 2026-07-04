import { getPrivateStorageBucket } from "@/lib/config/env";

import {
  releaseInlineKickSlot,
  resolveInlineKickLimit,
  tryAcquireInlineKickSlot,
} from "./inline-kick-gate";
import { resolveOcrImageInput } from "./ocr-image-source";
import { claimRunnableOcrJobs, runOcrJobOnce } from "./ocr-jobs";
import { resolveOcrRunnerIdentity } from "./ocr-runner-identity";
import {
  createTencentOcrProvider,
  readTencentOcrConfigFromEnv,
} from "./providers/tencent-ocr-provider";

export const OCR_INLINE_KICK_GATE = "ocr-inline-kick";

// OCR 是纯网络调用（腾讯云接口）+ 小图片 base64，单路开销远小于录屏分析，
// 默认放 3 路 inline 并发；超限的入队留给 cron。
// 可用 OCR_INLINE_KICK_LIMIT 覆盖（0 = 关闭 inline kick）。
export const OCR_INLINE_KICK_DEFAULT_LIMIT = 3;

/**
 * 报数截图入队成功后在本进程内立即 claim+run OCR job，消除等 cron 的延迟。
 * limit 为本次请求新建的 job 数（claim 时 clamp 到内部路由允许的 1-10）。
 * 全链路降级、永不 reject（不产生 unhandled rejection）：
 * - 并发闸门已满 → console.info 后跳过，留给 cron；
 * - runner env 未配置 / admin client 不可用 → 静默跳过，cron 兜底；
 * - claim 竞态天然安全（原子认领，抢不到只是拿到空列表）；
 * - 单个 job 失败 → 只记 console.error，继续后续 job。
 */
export async function kickQueuedOcrJobsInProcess({
  limit,
}: {
  limit: number;
}): Promise<void> {
  const gateLimit = resolveInlineKickLimit(
    process.env.OCR_INLINE_KICK_LIMIT,
    OCR_INLINE_KICK_DEFAULT_LIMIT,
  );
  if (!tryAcquireInlineKickSlot(OCR_INLINE_KICK_GATE, gateLimit)) {
    console.info(
      "[ocr] inline kick skipped: at concurrency limit, cron will pick the jobs up",
    );
    return;
  }

  try {
    const identity = resolveOcrRunnerIdentity();
    if (!identity.ok) {
      return;
    }
    const { client, actor } = identity;

    const claimLimit =
      typeof limit === "number" && Number.isFinite(limit)
        ? Math.max(1, Math.min(Math.trunc(limit), 10))
        : 1;
    const provider = createTencentOcrProvider(
      readTencentOcrConfigFromEnv(process.env),
    );

    const jobs = await claimRunnableOcrJobs({
      client: client as never,
      organizationId: actor.organizationId,
      runnerId: actor.userId,
      limit: claimLimit,
    });

    for (const job of jobs) {
      try {
        await runOcrJobOnce({
          client: client as never,
          actor,
          jobId: job.id,
          provider,
          runnerId: actor.userId,
          imageResolver: (payload) =>
            resolveOcrImageInput({
              client,
              payload,
              defaultBucket: getPrivateStorageBucket(),
            }),
        });
      } catch (error) {
        console.error(`[ocr] inline kick failed for job ${job.id}`, error);
      }
    }
  } catch (error) {
    console.error("[ocr] inline kick could not claim jobs", error);
  } finally {
    releaseInlineKickSlot(OCR_INLINE_KICK_GATE);
  }
}
