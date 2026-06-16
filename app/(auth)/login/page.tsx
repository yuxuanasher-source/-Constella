import Link from "next/link";
import { cookies } from "next/headers";
import type * as React from "react";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Globe2,
  HelpCircle,
  LockKeyhole,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  activateSubaccountAction,
  requestPasswordResetAction,
  requestPhoneOtpAction,
  signInAction,
  signInWithProviderAction,
  submitMcnApplicationAction,
  verifyPhoneOtpAction,
} from "./actions";
import {
  buildLoginViewState,
  getAuthProviderState,
  type AuthProviderAvailability,
  type RoleIntent,
} from "./login-workflows";
type PageSearchParams = Record<string, string | string[] | undefined>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const params = normalizeSearchParams(await searchParams);
  const cookieStore = await cookies();
  const viewState = buildLoginViewState({
    searchParams: params,
    rememberedEmail: cookieStore.get("jy_login_email")?.value,
    rememberedRole: cookieStore.get("jy_login_role")?.value,
  });
  const providers = getAuthProviderState(process.env);
  const next = params.next ?? "";
  const phone = params.phone ?? "";

  return (
    <main className="grid min-h-screen bg-white text-[var(--ink-900)] lg:grid-cols-[minmax(0,1.06fr)_minmax(520px,0.94fr)]">
      <BrandStoryPanel />

      <section className="relative flex min-h-screen flex-col bg-white px-6 py-7 sm:px-10 lg:px-16">
        <div className="flex items-center justify-end gap-5 text-xs text-[var(--ink-500)]">
          <label className="flex items-center gap-1.5">
            <Globe2 className="h-4 w-4" />
            <select
              className="bg-transparent text-xs outline-none"
              defaultValue="zh-CN"
              aria-label="语言"
            >
              <option value="zh-CN">中文</option>
            </select>
          </label>
          <Link
            href="/login?mode=apply"
            className="font-medium text-[var(--blue-600)]"
          >
            注册 MCN 账号
            <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col justify-center py-12">
          <div>
            <h1 className="text-3xl font-bold tracking-normal text-[var(--ink-900)]">
              {viewState.mode === "apply" ? "注册经营舱" : "欢迎回来"}
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-500)]">
              {viewState.mode === "apply"
                ? "创建机构空间并自动获得 owner 权限。"
                : "登录星耀传媒报数与结算工作台"}
            </p>
          </div>

          {viewState.notice ? (
            <div
              className={cn(
                "mt-6 flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                viewState.notice.tone === "success" &&
                  "border-emerald-100 bg-emerald-50 text-emerald-700",
                viewState.notice.tone === "error" &&
                  "border-red-100 bg-red-50 text-[var(--danger-600)]",
                viewState.notice.tone === "info" &&
                  "border-blue-100 bg-[var(--blue-50)] text-[var(--blue-700)]",
              )}
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{viewState.notice.message}</span>
            </div>
          ) : null}

          {viewState.mode === "reset" ? (
            <ResetPasswordForm roleIntent={viewState.roleIntent} />
          ) : viewState.mode === "activate" ? (
            <ActivateSubaccountForm
              roleIntent={viewState.roleIntent}
              next={next}
            />
          ) : viewState.mode === "phone" ? (
            <PhoneLoginForm
              roleIntent={viewState.roleIntent}
              phone={phone}
              next={next}
              otpSent={params.otp === "sent"}
            />
          ) : viewState.mode === "apply" ? (
            <McnApplicationForm />
          ) : viewState.mode === "help" ? (
            <HelpPanel />
          ) : (
            <PasswordLoginForm
              rememberedEmail={viewState.rememberedEmail}
              next={next}
              providers={providers}
            />
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-[var(--ink-300)]">
          <span>v2.4.0 · 中国（大陆）</span>
          <div className="flex gap-5">
            <Link href="/login?mode=help">帮助中心</Link>
            <Link href="/login?mode=help">联系运营</Link>
          </div>
        </div>

        <Link
          href="/login?mode=help"
          aria-label="帮助中心"
          className="fixed right-5 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-[var(--line)] bg-white text-[color:var(--blue-600)] shadow-[0_18px_42px_rgba(15,23,42,0.14)] transition hover:border-blue-200 hover:bg-[var(--blue-50)]"
        >
          <MessageCircle className="h-6 w-6 text-[color:var(--blue-600)]" />
        </Link>
      </section>
    </main>
  );
}

export function BrandStoryPanel() {
  return (
    <section className="relative hidden min-h-screen overflow-hidden bg-[#1357df] text-white lg:block">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] bg-[size:88px_88px]" />
      <div className="absolute inset-x-0 bottom-0 h-80 bg-[radial-gradient(circle_at_82%_82%,rgba(34,211,238,0.82),transparent_34%),linear-gradient(180deg,rgba(19,87,223,0),rgba(10,38,154,0.84))]" />

      <div className="relative flex min-h-screen flex-col justify-between px-12 py-12 xl:px-16">
        <div aria-hidden="true" className="h-9" />

        <div className="max-w-[650px]">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/16 bg-white/12 px-3 py-1 text-xs font-semibold text-white/90">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
            v2.4 · 新版结算引擎已上线
          </div>
          <h2 className="mt-6 text-5xl font-bold leading-tight tracking-normal xl:text-[56px]">
            让游戏直播项目
            <br />
            从报数结算到增长决策
            <br />
            全流程在线化
          </h2>
          <p className="mt-7 max-w-[560px] text-base leading-8 text-white/78">
            项目分配、主播报数、截图凭证、审核流程、自动结算、财务审计与主播 ROI
            分析都接入同一套权限与审计链路。
          </p>
        </div>

        <div className="flex items-end justify-between text-xs text-white/58">
          <span>© 2026 星耀传媒科技</span>
          <div className="flex items-center gap-8">
            <span>服务条款</span>
            <span>隐私协议</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function PasswordLoginForm({
  rememberedEmail,
  next,
  providers,
}: {
  rememberedEmail: string;
  next: string;
  providers: Record<"wechat" | "feishu", AuthProviderAvailability>;
}) {
  return (
    <div className="mt-7">
      <form action={signInAction} className="space-y-5">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="entryPoint" value="desktop" />

        <TextField
          icon={<Mail className="h-4 w-4" />}
          label="账号"
          name="email"
          type="text"
          defaultValue={rememberedEmail}
          placeholder="邮箱 / 电话 / 默认账号"
          autoComplete="username"
          required
        />

        <div>
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-[var(--ink-700)]">
            <span>密码</span>
            <Link
              href="/login?mode=reset"
              className="font-medium text-[var(--blue-600)]"
            >
              忘记密码？
            </Link>
          </div>
          <div className="flex h-11 items-center gap-2 rounded-md border border-[var(--line)] px-3 focus-within:border-[var(--blue-500)]">
            <LockKeyhole className="h-4 w-4 text-[var(--ink-300)]" />
            <input
              name="password"
              type="password"
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
              autoComplete="current-password"
              required
            />
          </div>
        </div>

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
            href="/login?mode=phone"
            className="font-medium text-[var(--blue-600)]"
          >
            手机验证码登录
          </Link>
        </div>

        <Button
          type="submit"
          className="h-11 w-full shadow-[var(--shadow-fab)]"
        >
          登录工作台
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-[var(--ink-300)]">
        <span className="h-px flex-1 bg-[var(--line)]" />
        <span>或使用以下方式</span>
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ProviderButton
          provider="wechat"
          label="微信扫码"
          state={providers.wechat}
        />
        <ProviderButton
          provider="feishu"
          label="飞书登录"
          state={providers.feishu}
        />
      </div>

      <p className="mt-6 text-center text-xs text-[var(--ink-500)]">
        首次访问？
        <Link
          href="/login?mode=apply"
          className="font-medium text-[var(--blue-600)]"
        >
          申请开通 MCN 账号
        </Link>
      </p>
    </div>
  );
}

function ActivateSubaccountForm({
  roleIntent,
  next,
}: {
  roleIntent: RoleIntent;
  next: string;
}) {
  return (
    <form action={activateSubaccountAction} className="mt-7 space-y-5">
      <input type="hidden" name="roleIntent" value={roleIntent} />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="entryPoint" value="desktop" />
      <div className="rounded-md border border-blue-100 bg-[var(--blue-50)] p-3 text-sm leading-6 text-[var(--blue-700)]">
        首次登录需要绑定邮箱、电话并设置新密码。完成后，后续可使用邮箱或电话 +
        密码登录。
      </div>
      <TextField
        icon={<Mail className="h-4 w-4" />}
        label="邮箱"
        name="email"
        type="email"
        placeholder="请输入工作邮箱"
        autoComplete="email"
        required
      />
      <TextField
        icon={<Phone className="h-4 w-4" />}
        label="电话"
        name="phone"
        type="tel"
        placeholder="请输入手机号"
        autoComplete="tel"
        required
      />
      <TextField
        icon={<LockKeyhole className="h-4 w-4" />}
        label="新密码"
        name="password"
        type="password"
        placeholder="至少 8 位"
        autoComplete="new-password"
        required
      />
      <Button type="submit" className="h-11 w-full">
        激活账号
      </Button>
    </form>
  );
}

function ResetPasswordForm({ roleIntent }: { roleIntent: RoleIntent }) {
  return (
    <form action={requestPasswordResetAction} className="mt-7 space-y-5">
      <input type="hidden" name="roleIntent" value={roleIntent} />
      <input type="hidden" name="entryPoint" value="desktop" />
      <TextField
        icon={<Mail className="h-4 w-4" />}
        label="账号邮箱"
        name="email"
        type="email"
        placeholder="输入需要重置密码的邮箱"
        autoComplete="email"
        required
      />
      <Button type="submit" className="h-11 w-full">
        发送重置邮件
      </Button>
      <ModeBackLink roleIntent={roleIntent} />
    </form>
  );
}

function PhoneLoginForm({
  roleIntent,
  phone,
  next,
  otpSent,
}: {
  roleIntent: RoleIntent;
  phone: string;
  next: string;
  otpSent: boolean;
}) {
  if (otpSent) {
    return (
      <form action={verifyPhoneOtpAction} className="mt-7 space-y-5">
        <input type="hidden" name="roleIntent" value={roleIntent} />
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="entryPoint" value="desktop" />
        <TextField
          icon={<Phone className="h-4 w-4" />}
          label="手机号"
          name="phone"
          type="tel"
          defaultValue={phone}
          required
        />
        <TextField
          icon={<ShieldCheck className="h-4 w-4" />}
          label="短信验证码"
          name="token"
          type="text"
          placeholder="输入 6 位验证码"
          inputMode="numeric"
          required
        />
        <Button type="submit" className="h-11 w-full">
          验证并进入工作台
        </Button>
        <ModeBackLink roleIntent={roleIntent} />
      </form>
    );
  }

  return (
    <form action={requestPhoneOtpAction} className="mt-7 space-y-5">
      <input type="hidden" name="roleIntent" value={roleIntent} />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="entryPoint" value="desktop" />
      <TextField
        icon={<Phone className="h-4 w-4" />}
        label="手机号"
        name="phone"
        type="tel"
        placeholder="输入已绑定手机号"
        autoComplete="tel"
        required
      />
      <Button type="submit" className="h-11 w-full">
        发送验证码
      </Button>
      <ModeBackLink roleIntent={roleIntent} />
    </form>
  );
}

export function McnApplicationForm() {
  return (
    <form action={submitMcnApplicationAction} className="mt-7 space-y-4">
      <TextField label="机构名称" name="companyName" required />
      <TextField label="联系人" name="contactName" required />
      <TextField label="联系邮箱" name="contactEmail" type="email" required />
      <TextField label="联系电话" name="contactPhone" type="tel" required />
      <TextField
        label="登录密码"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <TextField
        label="主播规模"
        name="businessScale"
        placeholder="例如：20-50 位签约主播"
      />
      <label className="block text-xs font-medium text-[var(--ink-700)]">
        业务说明
        <textarea
          name="note"
          rows={4}
          className="mt-2 w-full resize-none rounded-md border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-500)]"
          placeholder="可填写项目类型、结算痛点、期望开通时间"
        />
      </label>
      <Button type="submit" className="h-11 w-full">
        注册并进入工作台
      </Button>
      <ModeBackLink roleIntent="mcn" />
    </form>
  );
}

function HelpPanel() {
  return (
    <div className="mt-7 space-y-4">
      <div className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-4">
        <div className="flex items-center gap-2 font-semibold">
          <HelpCircle className="h-4 w-4 text-[var(--blue-600)]" />
          登录支持
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-500)]">
          账号由 MCN
          机构管理员开通。忘记密码可发送重置邮件；第三方登录需要管理员先配置对应
          SSO 或 OAuth Provider。
        </p>
      </div>
      <div className="rounded-md border border-[var(--line)] bg-white p-4">
        <div className="flex items-center gap-2 font-semibold">
          <FileText className="h-4 w-4 text-[var(--blue-600)]" />
          业务入口
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-500)]">
          MCN
          运营登录后进入项目与审核工作台；主播登录后进入移动端任务、录屏和结算入口。
        </p>
      </div>
      <ModeBackLink roleIntent="mcn" />
    </div>
  );
}

function ProviderButton({
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
      <input type="hidden" name="entryPoint" value="desktop" />
      <Button
        type="submit"
        variant="secondary"
        className="h-10 w-full text-xs"
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

function TextField({
  label,
  icon,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-medium text-[var(--ink-700)]">
      {label}
      <span className="mt-2 flex h-11 items-center gap-2 rounded-md border border-[var(--line)] px-3 focus-within:border-[var(--blue-500)]">
        {icon ? <span className="text-[var(--ink-300)]">{icon}</span> : null}
        <input
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ink-300)]"
          {...props}
        />
      </span>
    </label>
  );
}

function ModeBackLink({ roleIntent }: { roleIntent: RoleIntent }) {
  return (
    <p className="text-center text-xs text-[var(--ink-500)]">
      <Link
        href={`/login?role=${roleIntent}`}
        className="font-medium text-[var(--blue-600)]"
      >
        返回账号密码登录
      </Link>
    </p>
  );
}

function normalizeSearchParams(params: PageSearchParams) {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  ) as Record<string, string | undefined>;
}
