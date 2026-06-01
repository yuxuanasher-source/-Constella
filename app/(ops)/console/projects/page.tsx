import { CalendarClock, FilePlus2, Rocket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  createProjectDraftAction,
  publishProjectAction,
} from "@/features/projects/project-actions";
import { listProjects } from "@/features/projects/project-queries";
import { canCreateProjectDraft, canPublishProject } from "@/lib/rbac/permissions";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

const statusLabel: Record<string, string> = {
  draft: "草稿",
  recruiting: "招募中",
  pending_start: "待开始",
  active: "进行中",
  paused: "暂停",
  ended: "已结束",
  settling: "结算中",
  archived: "已归档",
};

export default async function ProjectsPage() {
  const supabase = await createSupabaseServerClient();
  const context = await getAuthContext(supabase);
  const projects = await listProjects(supabase);
  const canCreate = canCreateProjectDraft(context?.role);
  const canPublish = canPublishProject(context?.role);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {!supabase ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-[var(--warn-600)]">
          Supabase 环境变量未配置，页面可预览；登录、RLS 与写操作需要本地 Supabase。
        </div>
      ) : null}

      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--blue-700)]">
            <Rocket className="h-4 w-4" />
            M1 纵切片
          </div>
          <h1 className="mt-2 text-2xl font-semibold">项目创建与发布</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-500)]">
            草稿创建对 owner / ops_manager / operator_business 开放，发布仅 owner /
            ops_manager 可执行。服务端仍会校验角色、RLS 和状态机。
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--line)] bg-white p-3">
          <Metric label="项目数" value={projects.length} />
          <Metric
            label="草稿"
            value={projects.filter((project) => project.status === "draft").length}
          />
          <Metric
            label="招募中"
            value={
              projects.filter((project) => project.status === "recruiting").length
            }
          />
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <div className="rounded-lg border border-[var(--line)] bg-white p-5">
          <div className="flex items-center gap-2">
            <FilePlus2 className="h-4 w-4 text-[var(--blue-600)]" />
            <h2 className="text-base font-semibold">创建草稿</h2>
          </div>
          <form action={createProjectDraftAction} className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-[var(--ink-700)]">
              项目名称
              <input
                name="name"
                placeholder="例如：新游首周直播招募"
                className="mt-2 h-10 w-full rounded-md border border-[var(--line)] px-3 text-sm outline-none focus:border-[var(--blue-500)]"
                disabled={!canCreate}
                required
              />
            </label>
            <label className="block text-sm font-medium text-[var(--ink-700)]">
              项目编号
              <input
                name="code"
                placeholder="PRJ-202606-002"
                className="mt-2 h-10 w-full rounded-md border border-[var(--line)] px-3 font-mono text-sm outline-none focus:border-[var(--blue-500)]"
                disabled={!canCreate}
                required
              />
            </label>
            <Button type="submit" disabled={!canCreate} className="w-full">
              保存草稿
            </Button>
          </form>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-white">
          <div className="grid min-w-[760px] grid-cols-[140px_1fr_110px_120px_130px] border-b border-[var(--line)] bg-[var(--bg-soft)] px-4 py-3 text-xs font-medium text-[var(--ink-500)]">
            <span>编号</span>
            <span>项目</span>
            <span>状态</span>
            <span>系统计时</span>
            <span>操作</span>
          </div>
          <div className="min-w-[760px] divide-y divide-[var(--line)]">
            {projects.length ? (
              projects.map((project) => (
                <div
                  key={project.id}
                  className="grid grid-cols-[140px_1fr_110px_120px_130px] items-center px-4 py-4 text-sm"
                >
                  <span className="font-mono text-xs text-[var(--ink-500)]">
                    {project.code}
                  </span>
                  <div>
                    <div className="font-medium">{project.name}</div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-[var(--ink-300)]">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {new Date(project.created_at).toLocaleDateString("zh-CN")}
                    </div>
                  </div>
                  <Badge tone={project.status === "draft" ? "amber" : "green"}>
                    {statusLabel[project.status] ?? project.status}
                  </Badge>
                  <Badge tone={project.force_system_timing ? "blue" : "red"}>
                    {project.force_system_timing ? "强制" : "关闭"}
                  </Badge>
                  {project.status === "draft" ? (
                    <form action={publishProjectAction}>
                      <input type="hidden" name="projectId" value={project.id} />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!canPublish}
                        variant={canPublish ? "primary" : "secondary"}
                      >
                        发布
                      </Button>
                    </form>
                  ) : (
                    <span className="text-xs text-[var(--ink-300)]">已流转</span>
                  )}
                </div>
              ))
            ) : (
              <div className="px-4 py-12 text-center text-sm text-[var(--ink-500)]">
                暂无项目。加载 seed 后会看到演示项目。
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-20">
      <div className="font-mono text-xl font-semibold tabular-nums text-[var(--ink-900)]">
        {value}
      </div>
      <div className="text-xs text-[var(--ink-300)]">{label}</div>
    </div>
  );
}
