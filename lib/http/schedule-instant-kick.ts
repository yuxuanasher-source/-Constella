import { after } from "next/server";

/**
 * 入队路由的「立即执行」调度器：入队成功后在本进程内立刻跑 AI 任务，
 * 消除等 cron 的调度延迟。kick 只能锦上添花——同步抛错、异步 reject 全部
 * 就地吞掉并记日志，绝不影响入队响应，也不产生 unhandled rejection。
 *
 * Next 16 的 after() 必须在 request scope 内同步调用；单测直接调用 POST 时
 * 没有 request scope 会同步抛错——此时退化为已 catch 的分离 promise
 * （与 app/api/ai/chat 的 scheduleAfterResponse 同一模式）。
 */
export function scheduleInstantKick(
  label: string,
  kick: () => Promise<unknown>,
): void {
  let work: Promise<unknown>;
  try {
    work = Promise.resolve(kick()).catch((error) => {
      console.error(`[${label}] instant kick failed`, error);
    });
  } catch (error) {
    console.error(`[${label}] instant kick failed`, error);
    return;
  }

  try {
    after(work);
  } catch {
    void work;
  }
}
