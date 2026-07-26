import { LockKeyhole, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

import { platformAdminSignInAction } from "./actions";

type PageSearchParams = Record<string, string | string[] | undefined>;

const errorMessages: Record<string, string> = {
  config: "平台认证服务尚未配置，请联系系统维护人员。",
  auth: "邮箱或密码不正确，请核对后重试。",
  forbidden: "当前账号没有平台管理员权限，登录已安全退出。",
};

export default async function PlatformAdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const params = await searchParams;
  const errorCode = firstValue(params.error);
  const errorMessage = errorCode ? errorMessages[errorCode] : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-5 py-10 text-[var(--ink-900)]">
      <section className="w-full max-w-[420px] border border-[var(--line)] bg-white px-7 py-8 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:px-9">
        <header className="border-b border-[var(--line)] pb-6">
          <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md bg-[var(--blue-50)] text-[var(--blue-600)]">
            <ShieldCheck aria-hidden="true" className="h-5 w-5" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-500)]">
            Xingyao Platform Operations
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            平台管理后台
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-500)]">
            仅供已授权的平台超级管理员处理组织、订阅与经营数据。
          </p>
        </header>

        {errorMessage ? (
          <div
            role="alert"
            className="mt-5 border border-red-200 bg-red-50 px-3 py-2.5 text-sm leading-5 text-[var(--danger-600)]"
          >
            {errorMessage}
          </div>
        ) : null}

        <form action={platformAdminSignInAction} className="mt-6 space-y-5">
          <label className="block text-sm font-medium text-[var(--ink-700)]">
            管理员邮箱
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="admin@example.com"
              className="mt-2 h-11 w-full border border-[var(--line)] bg-white px-3 text-sm outline-none transition focus:border-[var(--blue-600)] focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <label className="block text-sm font-medium text-[var(--ink-700)]">
            密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              className="mt-2 h-11 w-full border border-[var(--line)] bg-white px-3 text-sm outline-none transition focus:border-[var(--blue-600)] focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <Button type="submit" className="h-11 w-full">
            <LockKeyhole aria-hidden="true" className="h-4 w-4" />
            进入管理后台
          </Button>
        </form>

        <p className="mt-6 border-t border-[var(--line)] pt-5 text-xs leading-5 text-[var(--ink-500)]">
          <span>机构账号无法进入此后台</span>
          。所有登录和高风险操作都会记录审计信息。
        </p>
      </section>
    </main>
  );
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
