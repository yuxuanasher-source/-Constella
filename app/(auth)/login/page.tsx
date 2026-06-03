import { ShieldCheck } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";

import { signInAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg)] px-6">
      <section className="w-full max-w-md rounded-lg border border-[var(--line)] bg-white p-8 shadow-sm">
        <BrandLogo />
        <div className="mt-8">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--blue-700)]">
            <ShieldCheck className="h-4 w-4" />
            Supabase Auth
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--ink-900)]">
            登录经营舱
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-500)]">
            请输入已开通的账号和密码进入系统。
          </p>
        </div>

        {params.error ? (
          <div className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-[var(--danger-600)]">
            {params.error === "config"
              ? "Supabase 环境变量尚未配置。"
              : "登录失败，请检查账号或密码。"}
          </div>
        ) : null}

        <form action={signInAction} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-[var(--ink-700)]">
            邮箱
            <input
              name="email"
              type="email"
              className="mt-2 h-10 w-full rounded-md border border-[var(--line)] px-3 text-sm outline-none focus:border-[var(--blue-500)]"
              required
            />
          </label>
          <label className="block text-sm font-medium text-[var(--ink-700)]">
            密码
            <input
              name="password"
              type="password"
              className="mt-2 h-10 w-full rounded-md border border-[var(--line)] px-3 text-sm outline-none focus:border-[var(--blue-500)]"
              required
            />
          </label>
          <Button type="submit" className="w-full">
            登录
          </Button>
        </form>
      </section>
    </main>
  );
}
