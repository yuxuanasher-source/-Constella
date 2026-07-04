// 入队路由「立即在进程内执行 AI 任务」(inline kick) 的并发闸门。
//
// 部署形态是 pm2 单 fork 进程的自托管 Next（非 serverless），模块级计数在
// 进程生命周期内可靠。闸门只做「超限即放弃」：拿不到名额的 kick 直接跳过、
// 留给 cron 兜底（优雅退化回定时模式），绝不在内存里排队积压——
// inline kick 只能锦上添花，不能拖垮主服务。

const activeCounts = new Map<string, number>();

/**
 * 尝试占用一个并发名额。达到上限返回 false（调用方应直接跳过执行），
 * 成功返回 true，此后必须在 finally 里调用 releaseInlineKickSlot 归还，
 * 任何异常路径都不能泄漏计数。
 */
export function tryAcquireInlineKickSlot(name: string, max: number): boolean {
  const limit = Number.isFinite(max) ? Math.trunc(max) : 0;
  const current = activeCounts.get(name) ?? 0;
  if (limit <= 0 || current >= limit) {
    return false;
  }
  activeCounts.set(name, current + 1);
  return true;
}

export function releaseInlineKickSlot(name: string): void {
  const current = activeCounts.get(name) ?? 0;
  if (current <= 1) {
    activeCounts.delete(name);
  } else {
    activeCounts.set(name, current - 1);
  }
}

/**
 * 解析可选的并发上限环境变量（如 RECORDING_AI_INLINE_KICK_LIMIT）。
 * 未设置或非法值 → 使用默认值；0 为合法值，表示完全关闭 inline kick。
 */
export function resolveInlineKickLimit(
  raw: string | undefined,
  fallback: number,
): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}
