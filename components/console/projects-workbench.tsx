"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ClipboardCheck,
  FolderKanban,
  Search,
  Users,
} from "lucide-react";

import type { OpsApplicationQueueItem } from "@/features/applications/application-queries";
import type { ProjectCardDto } from "@/features/projects/project-ui-dto";
import { cn } from "@/lib/utils";

type ConsoleProjectsUser = {
  id?: string;
  name?: string;
  role?: string;
  org?: string;
};

type ProjectSource = "all" | "owned" | "collab";

type ConsoleProjectsWorkbenchProps = {
  currentUser: ConsoleProjectsUser;
  projectCards: ProjectCardDto[];
  collaborationProjectCards: ProjectCardDto[];
  applicationQueue: OpsApplicationQueueItem[];
};

const sourceOptions: { value: ProjectSource; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "owned", label: "自有" },
  { value: "collab", label: "协作" },
];

const statusOptions = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "进行中" },
  { value: "recruiting", label: "招募中" },
  { value: "pending_start", label: "待开始" },
  { value: "settling", label: "结算中" },
  { value: "draft", label: "草稿" },
] as const;

export function ConsoleProjectsWorkbench({
  currentUser,
  projectCards,
  collaborationProjectCards,
  applicationQueue,
}: ConsoleProjectsWorkbenchProps) {
  const [source, setSource] = useState<ProjectSource>("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");

  const projects = useMemo(
    () => [
      ...projectCards.map((project) => ({ ...project, source: "owned" as const })),
      ...collaborationProjectCards.map((project) => ({
        ...project,
        source: "collab" as const,
      })),
    ],
    [collaborationProjectCards, projectCards],
  );

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return projects.filter((project) => {
      const matchesSource = source === "all" || project.source === source;
      const matchesStatus = status === "all" || project.status === status;
      const matchesQuery =
        !normalizedQuery ||
        [
          project.name,
          project.code,
          project.vendor,
          project.product,
          project.supplier,
          project.leadOps,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return matchesSource && matchesStatus && matchesQuery;
    });
  }, [projects, query, source, status]);

  const activeCount = projects.filter((project) => project.status === "active").length;
  const riskCount = projects.filter((project) => project.risk !== "low").length;
  const pendingApplicationCount = applicationQueue.filter((item) =>
    [
      "submitted",
      "invited",
      "recording_required",
      "recording_reviewing",
      "recording_approved",
    ].includes(item.status),
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
      <section className="rounded-lg border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--blue-700)]">
              <FolderKanban className="h-4 w-4" />
              M1 projects
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-[var(--ink-900)]">
              M1 项目管理
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-500)]">
              聚合自有项目、协作项目与待审核准入，把项目执行状态放在同一个可扫描工作台。
            </p>
          </div>
          <div className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-2 text-sm text-[var(--ink-500)]">
            <div className="font-medium text-[var(--ink-900)]">
              {currentUser.name ?? "未命名成员"}
            </div>
            <div>{currentUser.org ?? currentUser.role ?? "项目成员"}</div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <MetricTile icon={FolderKanban} label="全部项目" value={projects.length} />
          <MetricTile icon={Users} label="自有项目" value={projectCards.length} />
          <MetricTile
            icon={ClipboardCheck}
            label="待审核准入"
            value={pendingApplicationCount}
          />
          <MetricTile
            icon={AlertTriangle}
            label="风险项目"
            value={riskCount}
            tone={riskCount > 0 ? "warn" : "ok"}
          />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 rounded-lg border border-[var(--line)] bg-white shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] p-4">
            <div className="inline-flex rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-1">
              {sourceOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "h-8 rounded px-3 text-sm font-medium text-[var(--ink-500)]",
                    source === option.value &&
                      "bg-white text-[var(--blue-700)] shadow-sm",
                  )}
                  onClick={() => setSource(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-300)]" />
              <input
                aria-label="搜索项目"
                className="h-10 w-full rounded-md border border-[var(--line)] bg-white pl-9 pr-3 text-sm text-[var(--ink-900)] outline-none focus:border-[var(--blue-600)]"
                placeholder="搜索项目、编号、厂商"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <select
              className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm text-[var(--ink-700)] outline-none focus:border-[var(--blue-600)]"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="divide-y divide-[var(--line)]">
            {filteredProjects.length > 0 ? (
              filteredProjects.map((project) => (
                <ProjectRow key={`${project.source}-${project.id}`} project={project} />
              ))
            ) : (
              <div
                data-testid="projects-empty-state"
                className="p-10 text-center"
              >
                <div className="text-sm font-semibold text-[var(--ink-900)]">
                  {projects.length > 0 ? "没有匹配的项目" : "暂无项目"}
                </div>
                <div className="mt-2 text-sm text-[var(--ink-400)]">
                  调整筛选条件，或从项目创建流程补充新的执行项目。
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <section className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--ink-900)]">
                  准入队列
                </h2>
                <p className="mt-1 text-xs text-[var(--ink-400)]">
                  主播报名、邀约录屏与审核状态
                </p>
              </div>
              <span className="rounded-full bg-[var(--blue-50)] px-2 py-1 text-xs font-semibold text-[var(--blue-700)]">
                {applicationQueue.length}
              </span>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              {applicationQueue.length > 0 ? (
                applicationQueue.slice(0, 6).map((item) => (
                  <ApplicationQueueItem key={item.id} item={item} />
                ))
              ) : (
                <div className="rounded-md border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-400)]">
                  暂无待处理准入
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-card)]">
            <h2 className="text-sm font-semibold text-[var(--ink-900)]">
              下一步动作
            </h2>
            <div className="mt-4 space-y-3 text-sm text-[var(--ink-500)]">
              <Guardrail label="项目详情" text="从列表进入项目详情后承接招募、排班、报数。" />
              <Guardrail label="协作项目" text="外部协作只展示执行侧信息，项目设置仍由发起方确认。" />
              <Guardrail label="敏感变更" text="结算、证据和导出继续留在专属人工确认链路。" />
            </div>
            <Link
              href="/console/ai"
              className="mt-4 inline-flex h-9 items-center justify-center rounded-md border border-[var(--line)] px-3 text-sm font-medium text-[var(--ink-700)] hover:bg-[var(--bg-soft)]"
            >
              查看智能作战台
            </Link>
          </section>
        </aside>
      </section>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: typeof FolderKanban;
  label: string;
  value: number;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "text-[var(--ok-600)]"
      : tone === "warn"
        ? "text-[var(--warn-600)]"
        : "text-[var(--blue-700)]";

  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--ink-400)]">
        <Icon className={cn("h-4 w-4", toneClass)} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-[var(--ink-900)]">
        {value}
      </div>
    </div>
  );
}

function ProjectRow({
  project,
}: {
  project: ProjectCardDto & { source: "owned" | "collab" };
}) {
  return (
    <article className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-base font-semibold text-[var(--ink-900)]">
            {project.name}
          </div>
          <StatusBadge label={project.statusLabel} status={project.status} />
          {project.source === "collab" ? (
            <span className="rounded-full bg-[var(--blue-50)] px-2 py-1 text-xs font-medium text-[var(--blue-700)]">
              协作
            </span>
          ) : null}
          <span className="rounded-full bg-[var(--bg-soft)] px-2 py-1 text-xs font-medium text-[var(--ink-400)]">
            详情待迁移
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--ink-500)]">
          <span>{project.code}</span>
          <span>{project.vendor}</span>
          <span>{project.product}</span>
          <span>{project.leadOps}</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <ProjectFact label="计费" value={project.pricing} />
          <ProjectFact label="时长" value={`${project.metrics.doneHours}/${project.metrics.plannedHours}`} />
          <ProjectFact label="待报数" value={`${project.metrics.reportedPending}`} />
          <ProjectFact label="主播" value={`${project.streamers.active}`} />
        </div>
      </div>
      <div className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-3 text-sm">
        <div className="font-medium text-[var(--ink-900)]">
          {project.hourlyRateLabel}
        </div>
        <div className="mt-1 text-[var(--ink-500)]">{project.timingLabel}</div>
        <div className="mt-3 text-xs text-[var(--ink-400)]">
          {project.start || "未设置"} - {project.end || "未设置"}
        </div>
      </div>
    </article>
  );
}

function ProjectFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] px-3 py-2">
      <div className="text-xs text-[var(--ink-400)]">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-[var(--ink-900)]">
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ label, status }: { label: string; status: string }) {
  const tone =
    status === "active"
      ? "bg-[var(--ok-50)] text-[var(--ok-600)]"
      : status === "recruiting"
        ? "bg-[var(--blue-50)] text-[var(--blue-700)]"
        : "bg-[var(--bg-soft)] text-[var(--ink-500)]";

  return (
    <span className={cn("rounded-full px-2 py-1 text-xs font-medium", tone)}>
      {label}
    </span>
  );
}

function ApplicationQueueItem({ item }: { item: OpsApplicationQueueItem }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--ink-900)]">
            {item.streamer.displayName || "未命名主播"}
          </div>
          <div className="mt-1 truncate text-xs text-[var(--ink-400)]">
            {item.project.name || item.project.code}
          </div>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-[var(--ink-500)]">
          {item.status}
        </span>
      </div>
      <div className="mt-3 text-xs text-[var(--ink-500)]">
        {item.latestRecording
          ? `v${item.latestRecording.version} · ${item.latestRecording.status}`
          : "暂无录屏"}
      </div>
    </div>
  );
}

function Guardrail({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] p-3">
      <div className="text-sm font-medium text-[var(--ink-900)]">{label}</div>
      <div className="mt-1 text-xs leading-5 text-[var(--ink-500)]">{text}</div>
    </div>
  );
}
