import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import {
  isActivated,
  type OnboardingStep,
} from "@/features/funnel/onboarding";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

const STEP_LABELS: Array<{ step: OnboardingStep; title: string; hint: string }> = [
  { step: "create_project", title: "创建第一个项目", hint: "搭建合作项目骨架" },
  { step: "add_streamer", title: "添加主播", hint: "把主播纳入项目" },
  { step: "schedule_live", title: "排一场直播", hint: "安排一次直播任务" },
  { step: "submit_report", title: "提交一次报数", hint: "完成一次直播报数" },
  { step: "view_settlement", title: "查看结算", hint: "生成首个结算批次" },
  { step: "invite_member", title: "邀请成员（可选）", hint: "扩展你的团队" },
];

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect("/login");
  }
  const auth = await getAuthContext(supabase);
  if (!auth) {
    redirect("/login");
  }

  const { data: progress } = await supabase
    .from("onboarding_progress")
    .select("step")
    .eq("organization_id", auth.organizationId)
    .returns<{ step: OnboardingStep }[]>();

  const completed = new Set((progress ?? []).map((row) => row.step));
  const activated = isActivated([...completed]);

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg)] px-6 py-12">
      <section className="w-full max-w-xl rounded-lg border border-[var(--line)] bg-white p-8 shadow-sm">
        <BrandLogo />
        <h1 className="mt-8 text-2xl font-semibold text-[var(--ink-900)]">
          欢迎，{auth.organizationName}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-500)]">
          完成下面的核心步骤，跑通「项目 → 主播 → 报数 → 结算」最小闭环。
        </p>

        {activated ? (
          <div className="mt-4 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            🎉 你已完成激活，可以开始正式使用经营舱。
          </div>
        ) : null}

        <ul className="mt-6 space-y-3">
          {STEP_LABELS.map(({ step, title, hint }) => {
            const done = completed.has(step);
            return (
              <li
                key={step}
                className="flex items-start gap-3 rounded-md border border-[var(--line)] px-3 py-3"
              >
                {done ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 text-[var(--ink-300)]" />
                )}
                <div>
                  <p className="text-sm font-medium text-[var(--ink-900)]">
                    {title}
                  </p>
                  <p className="text-xs text-[var(--ink-500)]">{hint}</p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-8 flex gap-3">
          <Link href="/console" className="flex-1">
            <Button className="w-full">进入控制台</Button>
          </Link>
          <Link href="/pricing" className="flex-1">
            <Button variant="secondary" className="w-full">
              查看套餐
            </Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
