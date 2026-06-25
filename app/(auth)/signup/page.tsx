import Link from "next/link";
import { Sparkles } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";

import { signUpAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  config: "Supabase 环境变量尚未配置。",
  invalid: "请填写邮箱、密码与公司名称。",
  auth: "注册失败，邮箱可能已被使用。",
  provision: "开通失败，请稍后重试或联系支持。",
};

export default async function SignupPage({
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
            <Sparkles className="h-4 w-4" />
            14 天免费试用
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--ink-900)]">
            注册即开通试用
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-500)]">
            无需人工审核，注册后立即创建组织并进入产品。
          </p>
        </div>

        {params.error ? (
          <div className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-[var(--danger-600)]">
            {ERROR_MESSAGES[params.error] ?? "注册失败，请重试。"}
          </div>
        ) : null}

        <form action={signUpAction} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-[var(--ink-700)]">
            公司名称
            <input
              name="companyName"
              type="text"
              className="mt-2 h-10 w-full rounded-md border border-[var(--line)] px-3 text-sm outline-none focus:border-[var(--blue-500)]"
              required
            />
          </label>
          <label className="block text-sm font-medium text-[var(--ink-700)]">
            姓名
            <input
              name="fullName"
              type="text"
              className="mt-2 h-10 w-full rounded-md border border-[var(--line)] px-3 text-sm outline-none focus:border-[var(--blue-500)]"
            />
          </label>
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
              minLength={8}
              className="mt-2 h-10 w-full rounded-md border border-[var(--line)] px-3 text-sm outline-none focus:border-[var(--blue-500)]"
              required
            />
          </label>
          <Button type="submit" className="w-full">
            免费试用
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--ink-500)]">
          已有账号？{" "}
          <Link href="/login" className="text-[var(--blue-700)]">
            登录
          </Link>
        </p>
      </section>
    </main>
  );
}
