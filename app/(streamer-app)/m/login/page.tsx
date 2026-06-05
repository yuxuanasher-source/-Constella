import Link from "next/link";
import { cookies } from "next/headers";
import type * as React from "react";
import {
  CheckCircle2,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  activateSubaccountAction,
  requestPasswordResetAction,
  requestPhoneOtpAction,
  signInAction,
  signInWithProviderAction,
  verifyPhoneOtpAction,
} from "@/app/(auth)/login/actions";
import {
  buildLoginViewState,
  getAuthProviderState,
  normalizeLoginMode,
  type AuthProviderAvailability,
  type LoginMode,
  type LoginNotice,
} from "@/app/(auth)/login/login-workflows";

type PageSearchParams = Record<string, string | string[] | undefined>;

type StreamerMobileLoginPanelProps = {
  mode: LoginMode;
  rememberedEmail: string;
  next: string;
  phone: string;
  otpSent: boolean;
  providers: Record<"wechat" | "feishu", AuthProviderAvailability>;
  notice: LoginNotice | null;
};

export default async function StreamerMobileLoginPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const params = normalizeSearchParams(await searchParams);
  const cookieStore = await cookies();
  const viewState = buildLoginViewState({
    searchParams: { ...params, role: "streamer" },
    rememberedEmail: cookieStore.get("jy_login_email")?.value,
    rememberedRole: "streamer",
  });

  return (
    <StreamerMobileLoginPanel
      mode={normalizeLoginMode(params.mode)}
      rememberedEmail={viewState.rememberedEmail}
      next={params.next ?? ""}
      phone={params.phone ?? ""}
      otpSent={params.otp === "sent"}
      providers={getAuthProviderState(process.env)}
      notice={viewState.notice}
    />
  );
}

export function StreamerMobileLoginPanel({
  mode,
  rememberedEmail,
  next,
  phone,
  otpSent,
  providers,
  notice,
}: StreamerMobileLoginPanelProps) {
  const activeMode = mode === "apply" || mode === "help" ? "login" : mode;

  return (
    <main className="min-h-dvh bg-[#f4f7ff] text-[var(--ink-900)]">
      <section className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col overflow-hidden bg-white shadow-[0_18px_60px_rgba(15,35,80,0.12)]">
        <div className="relative overflow-hidden bg-[#1357df] px-5 pb-8 pt-[max(24px,env(safe-area-inset-top))] text-white">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.075)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.075)_1px,transparent_1px)] bg-[size:52px_52px]" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-[radial-gradient(circle_at_82%_78%,rgba(34,211,238,0.72),transparent_38%),linear-gradient(180deg,rgba(19,87,223,0),rgba(10,38,154,0.7))]" />

          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg border border-white/20 bg-white/14 shadow-sm">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">星耀传媒</div>
                <div className="text-xs text-white/68">主播移动工作台</div>
              </div>
            </div>
            <Link
              href="/login?role=streamer"
              className="rounded-full border border-white/18 bg-white/12 px-3 py-1.5 text-xs font-semibold text-white/88 backdrop-blur"
            >
              电脑端登录
            </Link>
          </div>

          <div className="relative mt-9">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/18 bg-white/12 px-3 py-1 text-xs font-semibold text-white/88">
              <UserRound className="h-3.5 w-3.5" />
              主播端
            </div>
            <h1 className="mt-4 text-[32px] font-bold leading-tight tracking-normal">
              主播移动端登录
            </h1>
            <p className="mt-3 max-w-[310px] text-sm leading-6 text-white/76">
              进入任务、录屏、报数与结算入口，适合手机现场操作。
            </p>
          </div>
        </div>

        <div className="-mt-4 flex-1 rounded-t-2xl bg-white px-5 pb-[max(22px,env(safe-area-inset-bottom))] pt-5">
          {notice ? <MobileNotice notice={notice} /> : null}

          {activeMode === "reset" ? (
            <MobileResetForm next={next} />
          ) : activeMode === "phone" ? (
            <MobilePhoneForm next={next} phone={phone} otpSent={otpSent} />
          ) : activeMode === "activate" ? (
            <MobileActivateForm next={next} />
          ) : (
            <MobilePasswordForm
              rememberedEmail={rememberedEmail}
              next={next}
              providers={providers}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function MobilePasswordForm({
  rememberedEmail,
  next,
  providers,
}: {
  rememberedEmail: string;
  next: string;
  providers: Record<"wechat" | "feishu", AuthProviderAvailability>;
}) {
  return (
    <div>
      <form action={signInAction} className="space-y-4">
        <MobileAuthHiddenFields next={next} />
        <MobileTextField
          icon={<Mail className="h-4 w-4" />}
          label="主播账号"
          name="email"
          type="text"
          defaultValue={rememberedEmail}
          placeholder="邮箱 / 电话 / 默认账号"
          autoComplete="username"
          required
        />
        <MobileTextField
          icon={<LockKeyhole className="h-4 w-4" />}
          label="密码"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        <div className="flex items-center justify-between text-xs text-[var(--ink-500)]">
          <label className="inline-flex items-center gap-2">
            <input
              name="remember"
              type="checkbox"
              defaultChecked={rememberedEmail.length > 0}
              className="h-4 w-4 rounded border-[var(--line)] accent-[var(--blue-600)]"
            />
            7 天内保持登录偏好
          </label>
          <Link
            href={mobileLoginHref("phone", next)}
            className="font-semibold text-[var(--blue-600)]"
          >
            手机验证码
          </Link>
        </div>

        <Button
          type="submit"
          className="h-12 w-full rounded-lg text-sm shadow-[var(--shadow-fab)]"
        >
          登录移动工作台
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-[var(--ink-300)]">
        <span className="h-px flex-1 bg-[var(--line)]" />
        <span>或使用以下方式</span>
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MobileProviderButton
          provider="wechat"
          label="微信扫码"
          state={providers.wechat}
        />
        <MobileProviderButton
          provider="feishu"
          label="飞书登录"
          state={providers.feishu}
        />
      </div>

      <p className="mt-5 text-center text-xs text-[var(--ink-500)]">
        <Link
          href={mobileLoginHref("reset", next)}
          className="font-semibold text-[var(--blue-600)]"
        >
          忘记密码
        </Link>
      </p>
    </div>
  );
}

function MobilePhoneForm({
  next,
  phone,
  otpSent,
}: {
  next: string;
  phone: string;
  otpSent: boolean;
}) {
  if (otpSent) {
    return (
      <form action={verifyPhoneOtpAction} className="space-y-4">
        <MobileAuthHiddenFields next={next} />
        <MobileTextField
          icon={<Phone className="h-4 w-4" />}
          label="手机号"
          name="phone"
          type="tel"
          defaultValue={phone}
          required
        />
        <MobileTextField
          icon={<ShieldCheck className="h-4 w-4" />}
          label="验证码"
          name="token"
          type="text"
          placeholder="输入 6 位验证码"
          inputMode="numeric"
          required
        />
        <Button type="submit" className="h-12 w-full rounded-lg">
          验证并进入移动工作台
        </Button>
        <MobileBackLink next={next} />
      </form>
    );
  }

  return (
    <form action={requestPhoneOtpAction} className="space-y-4">
      <MobileAuthHiddenFields next={next} />
      <MobileTextField
        icon={<Phone className="h-4 w-4" />}
        label="手机号"
        name="phone"
        type="tel"
        placeholder="输入已绑定手机号"
        autoComplete="tel"
        required
      />
      <Button type="submit" className="h-12 w-full rounded-lg">
        发送验证码
      </Button>
      <MobileBackLink next={next} />
    </form>
  );
}

function MobileResetForm({ next }: { next: string }) {
  return (
    <form action={requestPasswordResetAction} className="space-y-4">
      <MobileAuthHiddenFields next={next} />
      <MobileTextField
        icon={<Mail className="h-4 w-4" />}
        label="账号邮箱"
        name="email"
        type="email"
        placeholder="输入需要重置密码的邮箱"
        autoComplete="email"
        required
      />
      <Button type="submit" className="h-12 w-full rounded-lg">
        发送重置邮件
      </Button>
      <MobileBackLink next={next} />
    </form>
  );
}

function MobileActivateForm({ next }: { next: string }) {
  return (
    <form action={activateSubaccountAction} className="space-y-4">
      <MobileAuthHiddenFields next={next} />
      <div className="rounded-lg border border-blue-100 bg-[var(--blue-50)] p-3 text-sm leading-6 text-[var(--blue-700)]">
        首次登录需要绑定邮箱、电话并设置新密码。完成后可继续进入移动工作台。
      </div>
      <MobileTextField label="邮箱" name="email" type="email" required />
      <MobileTextField label="电话" name="phone" type="tel" required />
      <MobileTextField
        label="新密码"
        name="password"
        type="password"
        autoComplete="new-password"
        required
      />
      <Button type="submit" className="h-12 w-full rounded-lg">
        激活账号
      </Button>
    </form>
  );
}

function MobileAuthHiddenFields({ next }: { next: string }) {
  return (
    <>
      <input type="hidden" name="roleIntent" value="streamer" />
      <input type="hidden" name="entryPoint" value="mobile" />
      <input type="hidden" name="next" value={next} />
    </>
  );
}

function MobileProviderButton({
  provider,
  label,
  state,
}: {
  provider: "wechat" | "feishu";
  label: string;
  state: AuthProviderAvailability;
}) {
  return (
    <form action={signInWithProviderAction}>
      <input type="hidden" name="provider" value={provider} />
      <MobileAuthHiddenFields next="" />
      <Button
        type="submit"
        variant="secondary"
        className="h-11 w-full rounded-lg text-xs"
        title={state === "available" ? "已配置，可跳转登录" : "尚未配置"}
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            provider === "wechat" ? "bg-emerald-500" : "bg-cyan-500",
          )}
        />
        {label}
        {state === "unconfigured" ? (
          <span className="text-[10px] text-[var(--ink-300)]">待配置</span>
        ) : null}
      </Button>
    </form>
  );
}

function MobileTextField({
  label,
  icon,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-semibold text-[var(--ink-700)]">
      {label}
      <span className="mt-2 flex h-12 items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 focus-within:border-[var(--blue-500)]">
        {icon ? <span className="text-[var(--ink-300)]">{icon}</span> : null}
        <input
          aria-label={label}
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--ink-300)]"
          {...props}
        />
      </span>
    </label>
  );
}

function MobileNotice({ notice }: { notice: LoginNotice }) {
  return (
    <div
      className={cn(
        "mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        notice.tone === "success" &&
          "border-emerald-100 bg-emerald-50 text-emerald-700",
        notice.tone === "error" &&
          "border-red-100 bg-red-50 text-[var(--danger-600)]",
        notice.tone === "info" &&
          "border-blue-100 bg-[var(--blue-50)] text-[var(--blue-700)]",
      )}
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{notice.message}</span>
    </div>
  );
}

function MobileBackLink({ next }: { next: string }) {
  return (
    <p className="text-center text-xs text-[var(--ink-500)]">
      <Link
        href={mobileLoginHref("login", next)}
        className="font-semibold text-[var(--blue-600)]"
      >
        返回账号密码登录
      </Link>
    </p>
  );
}

function mobileLoginHref(mode: LoginMode, next: string) {
  const params = new URLSearchParams();
  if (mode !== "login") {
    params.set("mode", mode);
  }
  if (next) {
    params.set("next", next);
  }
  const query = params.toString();
  return query ? `/m/login?${query}` : "/m/login";
}

function normalizeSearchParams(params: PageSearchParams) {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  ) as Record<string, string | undefined>;
}
