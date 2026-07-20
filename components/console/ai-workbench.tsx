"use client";

import Link from "next/link";
import {
  Activity,
  Bot,
  CheckCircle2,
  FileText,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import AiUsageDashboard from "@/components/reference-ui/ai-usage-dashboard";
import type { RoleHomeDashboardDto } from "@/features/dashboards/role-home";

type ConsoleAiUser = {
  id?: string;
  name?: string;
  role?: string;
  org?: string;
};

type ConsoleAiWorkbenchProps = {
  currentUser: ConsoleAiUser;
  dashboardHome: RoleHomeDashboardDto | null;
  dashboardHomeError: string | null;
};

const protocolTiles = [
  {
    icon: MessageSquareText,
    title: "会话协议",
    value: "SSE",
    detail: "上下文快照、失败重试、附件边界",
  },
  {
    icon: FileText,
    title: "草稿层",
    value: "Draft",
    detail: "AI 只生成待确认草稿",
  },
  {
    icon: ShieldCheck,
    title: "敏感动作",
    value: "人工确认",
    detail: "钱、证据、导出不自动落库",
  },
] as const;

export function ConsoleAiWorkbench({
  currentUser,
  dashboardHome,
  dashboardHomeError,
}: ConsoleAiWorkbenchProps) {
  const queueItems = dashboardHome?.queue ?? [];
  const riskItems = dashboardHome?.risks ?? [];
  const kpis = dashboardHome?.kpis ?? [];
  const scopeLabel = dashboardHome?.profile.scopeLabel ?? currentUser.org ?? "未连接组织";
  const generatedAt = dashboardHome?.generatedAt
    ? formatDateTime(dashboardHome.generatedAt)
    : "暂无经营上下文";
  const focusItems = [...riskItems, ...queueItems].slice(0, 4);

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.55fr)]">
        <div className="rounded-lg border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--blue-700)]">
                <Sparkles className="h-4 w-4" />
                M10 command AI
              </div>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--ink-900)]">
                M10 智能作战台
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-500)]">
                以真实经营上下文、AI 会话协议和用量审计为中心，承接项目诊断、风险解释和行动草稿。
              </p>
            </div>
            <div className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 py-2 text-sm text-[var(--ink-500)]">
              <div className="font-medium text-[var(--ink-900)]">
                {currentUser.name ?? "未命名成员"}
              </div>
              <div>{scopeLabel}</div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <MetricTile
              label="经营上下文"
              value={dashboardHomeError ? "降级" : "已连接"}
              detail={dashboardHomeError ?? generatedAt}
              tone={dashboardHomeError ? "warn" : "ok"}
            />
            <MetricTile
              label="风险队列"
              value={`${riskItems.length}`}
              detail="来自角色经营看板"
              tone={riskItems.length > 0 ? "warn" : "ok"}
            />
            <MetricTile
              label="待办信号"
              value={`${queueItems.length}`}
              detail={kpis[0]?.label ?? "按角色权限过滤"}
              tone="blue"
            />
          </div>
        </div>

        <section className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-[var(--blue-700)]" />
              <h2 className="text-sm font-semibold text-[var(--ink-900)]">
                协议边界
              </h2>
            </div>
            <span className="rounded-full bg-[var(--ok-50)] px-2 py-1 text-xs font-medium text-[var(--ok-600)]">
              human-in-loop
            </span>
          </div>
          <div className="mt-4 grid gap-3">
            {protocolTiles.map((item) => (
              <div
                key={item.title}
                className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-[var(--line)] px-3 py-2"
              >
                <div className="grid h-8 w-8 place-items-center rounded-md bg-[var(--blue-50)] text-[var(--blue-700)]">
                  <item.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--ink-900)]">
                    {item.title}
                  </div>
                  <div className="truncate text-xs text-[var(--ink-400)]">
                    {item.detail}
                  </div>
                </div>
                <div className="text-xs font-semibold text-[var(--ink-700)]">
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div id="usage" className="min-w-0">
          <AiUsageDashboard fetcher={undefined} />
        </div>

        <aside className="flex flex-col gap-4">
          <section className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--blue-700)]" />
              <h2 className="text-sm font-semibold text-[var(--ink-900)]">
                当前优先信号
              </h2>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {focusItems.length > 0 ? (
                focusItems.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-3"
                  >
                    <div className="text-sm font-medium text-[var(--ink-900)]">
                      {item.title}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--ink-500)]">
                      {item.subtitle}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-400)]">
                  暂无经营上下文
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-[var(--warn-600)]" />
              <h2 className="text-sm font-semibold text-[var(--ink-900)]">
                动作闸门
              </h2>
            </div>
            <div className="mt-4 space-y-3 text-sm text-[var(--ink-500)]">
              <Guardrail label="人工确认" text="结算、证据、导出类草稿保留人工确认链路。" />
              <Guardrail label="审计留痕" text="AI 调用、成本、失败降级进入用量审计。" />
              <Guardrail label="路由切换" text="迁移 gate 通过后再更新模块入口。" />
            </div>
            <Link
              href="/console"
              className="mt-4 inline-flex h-9 items-center justify-center rounded-md border border-[var(--line)] px-3 text-sm font-medium text-[var(--ink-700)] hover:bg-[var(--bg-soft)]"
            >
              返回经营总览
            </Link>
          </section>
        </aside>
      </section>
    </div>
  );
}

function MetricTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "ok" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "bg-[var(--ok-50)] text-[var(--ok-600)]"
      : tone === "warn"
        ? "bg-[var(--warn-50)] text-[var(--warn-600)]"
        : "bg-[var(--blue-50)] text-[var(--blue-700)]";

  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-3">
      <div className="text-xs text-[var(--ink-400)]">{label}</div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${toneClass}`}>
          {value}
        </span>
        <span className="min-w-0 truncate text-xs text-[var(--ink-500)]">
          {detail}
        </span>
      </div>
    </div>
  );
}

function Guardrail({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex gap-2">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ok-600)]" />
      <div>
        <div className="font-medium text-[var(--ink-900)]">{label}</div>
        <div className="mt-0.5 text-xs leading-5 text-[var(--ink-500)]">
          {text}
        </div>
      </div>
    </div>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
