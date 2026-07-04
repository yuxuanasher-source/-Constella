import {
  releaseInlineKickSlot,
  resolveInlineKickLimit,
  tryAcquireInlineKickSlot,
} from "@/features/ai/inline-kick-gate";

import { runRecordingAiAnalysisOnce } from "./recording-ai-analysis";
import { createRecordingAiAnalysisPipeline } from "./recording-ai-pipeline";
import { resolveRecordingAiRunnerIdentity } from "./recording-ai-runner-identity";

export const RECORDING_AI_INLINE_KICK_GATE = "recording-ai-inline-kick";

// 单条录屏分析要跑 ffmpeg 抽音频（CPU 密集）且最大约 80MB 音频驻留内存，
// 与 Web 服务同进程，默认只允许 1 路 inline 并发；超限的入队留给 cron。
// 可用 RECORDING_AI_INLINE_KICK_LIMIT 覆盖（0 = 关闭 inline kick）。
export const RECORDING_AI_INLINE_KICK_DEFAULT_LIMIT = 1;

/**
 * 入队成功后在本进程内立即执行该条录屏 AI 分析，消除等 cron 的调度延迟。
 * 全链路降级、永不 reject（不产生 unhandled rejection）：
 * - 并发闸门已满 → console.info 后跳过，留给 cron；
 * - runner env 未配置 / admin client 不可用 → 静默跳过，cron 兜底；
 * - 输掉认领竞态（cron 或其他 runner 已接手）→ 静默返回；
 * - 其余异常 → 只记 console.error。
 */
export async function kickRecordingAiAnalysisInProcess({
  analysisId,
}: {
  analysisId: string;
}): Promise<void> {
  const limit = resolveInlineKickLimit(
    process.env.RECORDING_AI_INLINE_KICK_LIMIT,
    RECORDING_AI_INLINE_KICK_DEFAULT_LIMIT,
  );
  if (!tryAcquireInlineKickSlot(RECORDING_AI_INLINE_KICK_GATE, limit)) {
    console.info(
      `[recording-ai] inline kick skipped for ${analysisId}: at concurrency limit, cron will pick it up`,
    );
    return;
  }

  try {
    const identity = resolveRecordingAiRunnerIdentity();
    if (!identity.ok) {
      return;
    }

    // 豆包 ASR + LLM 流水线；未配置（返回 null）时 runner 走确定性草稿，
    // 与 /api/internal/recording-ai/run 保持一致。
    const pipeline = createRecordingAiAnalysisPipeline({
      client: identity.client as never,
      actor: identity.actor,
    });

    await runRecordingAiAnalysisOnce({
      client: identity.client as never,
      actor: identity.actor,
      analysisId,
      pipeline,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Recording AI analysis is not queued")
    ) {
      // 认领竞态：该条已被 cron/其他 runner claim（或已执行完），不算失败。
      return;
    }
    console.error(
      `[recording-ai] inline kick failed for ${analysisId}`,
      error,
    );
  } finally {
    releaseInlineKickSlot(RECORDING_AI_INLINE_KICK_GATE);
  }
}
