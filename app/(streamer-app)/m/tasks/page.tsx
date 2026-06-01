import { Badge } from "@/components/ui/badge";

export default function StreamerTasksPage() {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-white p-5">
      <Badge tone="blue">主播 App</Badge>
      <h1 className="mt-4 text-xl font-semibold">我的任务</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--ink-500)]">
        任务、录屏、诊断和个人中心外壳已就绪。P1 将在这里接入开播、停止和报数。
      </p>
    </section>
  );
}
