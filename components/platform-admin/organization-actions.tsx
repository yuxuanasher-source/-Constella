"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  PlatformOrganizationDetailDto,
  PlatformPlanPerformanceDto,
  PlatformUserDto,
  ReportingPeriod,
} from "@/features/platform-admin/platform-admin-contracts";
import { appRoles } from "@/lib/rbac/roles";

import { PlatformAdminActionDialog } from "./platform-admin-action-dialog";
import { formatCurrencyCents, roleLabel } from "./platform-admin-format";

type ActionResult = Record<string, unknown>;

type ActionRequest = {
  url: string;
  method: "POST" | "PATCH";
  body: (idempotencyKey: string) => Record<string, unknown>;
  successMessage?: string;
  final?: boolean;
};

export function useGovernedAction(onSuccess: () => void | Promise<void>) {
  const idempotencyKey = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [conflict, setConflict] = useState(false);

  async function submit(request: ActionRequest) {
    const key =
      idempotencyKey.current ??
      globalThis.crypto?.randomUUID?.() ??
      `platform-admin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    idempotencyKey.current = key;
    setSubmitting(true);
    setError("");
    setSuccess("");
    setConflict(false);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.body(key)),
      });
      const payload = (await response.json()) as {
        data?: ActionResult;
        error?: { message?: string };
      };
      if (!response.ok) {
        setConflict(response.status === 409);
        setError(
          payload.error?.message ??
            (response.status === 409
              ? "数据已被其他管理员更新，请刷新后重试。"
              : "操作失败，请检查输入后重试。"),
        );
        return null;
      }
      setSuccess(request.successMessage ?? "");
      if (request.final !== false) {
        idempotencyKey.current = null;
        try {
          await onSuccess();
        } catch {
          setSuccess("操作已成功，但最新数据刷新失败，请手动刷新页面。");
        }
      }
      return payload.data ?? {};
    } catch {
      setError("网络请求失败，请确认连接后重试。");
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    idempotencyKey.current = null;
    setSubmitting(false);
    setError("");
    setSuccess("");
    setConflict(false);
  }

  return {
    submitting,
    error,
    success,
    conflict,
    submit,
    reset,
    clearFeedback() {
      setError("");
      setSuccess("");
      setConflict(false);
    },
  };
}

export function CreateOrganizationAction({
  plans,
  period,
  onSuccess,
}: {
  plans: PlatformPlanPerformanceDto[];
  period: ReportingPeriod;
  onSuccess: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [withPayment, setWithPayment] = useState(false);
  const action = useGovernedAction(onSuccess);

  function close() {
    setOpen(false);
    setWithPayment(false);
    action.reset();
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await action.submit({
      url: "/api/platform-admin/organizations",
      method: "POST",
      successMessage: "组织、主账号与订阅已创建。",
      body: (key) => ({
        name: text(form, "name"),
        code: text(form, "code"),
        primaryName: text(form, "primaryName"),
        primaryEmail: text(form, "primaryEmail"),
        primaryPassword: text(form, "primaryPassword"),
        planId: text(form, "planId"),
        billingCycle: text(form, "billingCycle"),
        periodStart: text(form, "periodStart"),
        periodEnd: text(form, "periodEnd"),
        offlinePayment: withPayment
          ? {
              amountCents: yuanToCents(text(form, "amountYuan")),
              currency: "CNY",
              provider: "offline",
              providerTransactionId: text(form, "paymentReference"),
              paidAt: toIso(text(form, "paidAt")),
            }
          : null,
        reason: text(form, "reason"),
        idempotencyKey: key,
      }),
    });
    if (result) {
      close();
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        新建组织
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title="新建组织"
        description="一次创建组织、主账号和首个订阅；线下首付款可选。"
        submitting={action.submitting}
        error={action.error}
        success={action.success}
        conflict={action.conflict}
        onClose={close}
        onRefresh={onSuccess}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close}>
              取消
            </Button>
            <Button
              type="submit"
              form="create-platform-organization"
              disabled={action.submitting || plans.length === 0}
            >
              {action.submitting ? "创建中…" : "创建组织"}
            </Button>
          </>
        }
      >
        <form
          id="create-platform-organization"
          autoComplete="off"
          className="space-y-5"
          onSubmit={(event) => void create(event)}
        >
          <FormSection title="组织信息">
            <Field label="组织名称" name="name" required />
            <Field label="组织编码" name="code" required />
          </FormSection>
          <FormSection title="主账号">
            <Field label="主账号姓名" name="primaryName" required />
            <Field
              label="主账号邮箱"
              name="primaryEmail"
              type="email"
              autoComplete="off"
              required
            />
            <Field
              label="初始密码"
              name="primaryPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </FormSection>
          <FormSection title="首个订阅">
            <SelectField
              label="套餐"
              name="planId"
              defaultValue={plans[0]?.id}
              required
              options={plans.map((plan) => [plan.id, plan.name])}
            />
            <SelectField
              label="计费周期"
              name="billingCycle"
              defaultValue="monthly"
              options={[
                ["monthly", "月付"],
                ["annual", "年付"],
              ]}
            />
            <Field
              label="生效日期"
              name="periodStart"
              type="date"
              defaultValue={period.start}
              required
            />
            <Field
              label="到期日期"
              name="periodEnd"
              type="date"
              defaultValue={period.end}
              required
            />
          </FormSection>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={withPayment}
              onChange={(event) => setWithPayment(event.target.checked)}
              className="h-4 w-4 accent-[var(--blue-600)]"
            />
            记录首笔线下付款
          </label>
          {withPayment ? (
            <FormSection title="首笔付款">
              <Field
                label="实收金额（元）"
                name="amountYuan"
                type="number"
                min="0"
                step="0.01"
                required
              />
              <Field label="付款流水号" name="paymentReference" required />
              <Field
                label="收款时间"
                name="paidAt"
                type="datetime-local"
                required
              />
            </FormSection>
          ) : null}
          <Field label="操作原因" name="reason" required />
        </form>
      </PlatformAdminActionDialog>
    </>
  );
}

export function OrganizationActions({
  organization,
  plans,
  onSuccess,
}: {
  organization: PlatformOrganizationDetailDto;
  plans: PlatformPlanPerformanceDto[];
  onSuccess: () => void | Promise<void>;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);

  function closeMenuAfterSelection(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) {
      menuRef.current?.removeAttribute("open");
    }
  }

  return (
    <details ref={menuRef} className="w-full text-right sm:w-auto">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center justify-center rounded-md border border-[var(--line)] bg-white px-3 text-sm font-semibold text-[var(--ink-700)] transition hover:bg-[var(--bg-soft)] focus-visible:ring-2 focus-visible:ring-[var(--blue-300)] focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        管理操作
      </summary>
      <div
        className="mt-2 ml-auto flex max-w-xl flex-wrap justify-end gap-1 border-t border-[var(--line)] pt-2 [&>button]:justify-start"
        onClick={closeMenuAfterSelection}
      >
        <OrganizationIdentityAction
          organization={organization}
          onSuccess={onSuccess}
        />
        <MemberCreateAction organization={organization} onSuccess={onSuccess} />
        {organization.subscription ? (
          <>
            <SubscriptionPlanAction
              organization={organization}
              plans={plans}
              onSuccess={onSuccess}
            />
            <SubscriptionExpiryAction
              organization={organization}
              onSuccess={onSuccess}
            />
            <OfflinePaymentAction
              organization={organization}
              plans={plans}
              onSuccess={onSuccess}
            />
            <SubscriptionStatusAction
              organization={organization}
              onSuccess={onSuccess}
            />
          </>
        ) : null}
        {organization.lifecycleStatus !== "archived" ? (
          <OrganizationLifecycleAction
            organization={organization}
            onSuccess={onSuccess}
          />
        ) : null}
      </div>
    </details>
  );
}

function OrganizationIdentityAction({
  organization,
  onSuccess,
}: {
  organization: PlatformOrganizationDetailDto;
  onSuccess: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const action = useGovernedAction(onSuccess);

  function close() {
    setOpen(false);
    action.reset();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action.submit({
      url: `/api/platform-admin/organizations/${organization.id}`,
      method: "PATCH",
      successMessage: "组织资料已更新。",
      body: (key) => ({
        name: text(form, "name"),
        code: text(form, "code"),
        expectedUpdatedAt: organization.updatedAt,
        reason: text(form, "reason"),
        idempotencyKey: key,
      }),
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        编辑组织
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title="编辑组织资料"
        description="组织名称和编码会同步到平台目录；历史审计记录保持原样。"
        submitting={action.submitting}
        error={action.error}
        success={action.success}
        conflict={action.conflict}
        onClose={close}
        onRefresh={onSuccess}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close}>
              取消
            </Button>
            <Button
              type="submit"
              form="edit-platform-organization"
              disabled={action.submitting}
            >
              保存组织
            </Button>
          </>
        }
      >
        <form
          id="edit-platform-organization"
          className="space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <Field
            label="组织名称"
            name="name"
            defaultValue={organization.name}
            required
          />
          <Field
            label="组织编码"
            name="code"
            defaultValue={organization.code}
            required
          />
          <Field label="操作原因" name="reason" required />
        </form>
      </PlatformAdminActionDialog>
    </>
  );
}

function MemberCreateAction({
  organization,
  onSuccess,
}: {
  organization: PlatformOrganizationDetailDto;
  onSuccess: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"invite" | "subaccount">("invite");
  const [credentials, setCredentials] = useState<{
    account: string;
    password: string;
  } | null>(null);
  const action = useGovernedAction(onSuccess);

  function close() {
    setOpen(false);
    setMode("invite");
    setCredentials(null);
    action.reset();
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await action.submit({
      url: `/api/platform-admin/organizations/${organization.id}/members`,
      method: "POST",
      successMessage:
        mode === "invite"
          ? "邀请已创建。"
          : "子账号已创建，请立即保存一次性凭证。",
      body: (key) => ({
        mode,
        ...(mode === "invite" ? { email: text(form, "email") } : {}),
        name: text(form, "name"),
        role: text(form, "role"),
        ...(text(form, "temporaryPassword")
          ? { temporaryPassword: text(form, "temporaryPassword") }
          : {}),
        reason: text(form, "reason"),
        idempotencyKey: key,
      }),
    });
    const nextCredentials = result?.credentials as
      | { account?: string; password?: string }
      | undefined;
    if (nextCredentials?.account && nextCredentials.password) {
      setCredentials({
        account: nextCredentials.account,
        password: nextCredentials.password,
      });
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
      >
        新增账号
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title="新增组织账号"
        description={`账号将加入 ${organization.name}，凭证只在创建成功后展示一次。`}
        submitting={action.submitting}
        error={action.error}
        success={action.success}
        conflict={action.conflict}
        onClose={close}
        onRefresh={onSuccess}
        footer={
          credentials ? (
            <Button type="button" onClick={close}>
              我已安全保存
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={close}>
                取消
              </Button>
              <Button
                type="submit"
                form="create-organization-member"
                disabled={action.submitting}
              >
                {action.submitting ? "创建中…" : "创建账号"}
              </Button>
            </>
          )
        }
      >
        {credentials ? (
          <div className="border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-950">
              一次性登录凭证
            </p>
            <dl className="mt-3 grid gap-3 text-sm">
              <CredentialRow label="账号" value={credentials.account} />
              <CredentialRow label="密码" value={credentials.password} />
            </dl>
            <p className="mt-3 text-xs leading-5 text-amber-800">
              关闭后不再展示；审计记录不会保存明文密码。
            </p>
          </div>
        ) : (
          <form
            id="create-organization-member"
            autoComplete="off"
            className="space-y-4"
            onSubmit={(event) => void create(event)}
          >
            <SelectField
              label="创建方式"
              name="mode"
              value={mode}
              onChange={(value) => setMode(value as "invite" | "subaccount")}
              options={[
                ["invite", "邮件邀请"],
                ["subaccount", "系统生成子账号"],
              ]}
            />
            <Field label="账号名称" name="name" required />
            {mode === "invite" ? (
              <Field
                label="邀请邮箱"
                name="email"
                type="email"
                autoComplete="off"
                required
              />
            ) : (
              <Field
                label="临时密码（留空自动生成）"
                name="temporaryPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
              />
            )}
            <SelectField
              label="角色"
              name="role"
              defaultValue="operator_business"
              options={appRoles.map((role) => [role, roleLabel(role)])}
            />
            <Field label="操作原因" name="reason" required />
          </form>
        )}
      </PlatformAdminActionDialog>
    </>
  );
}

export function MemberActions({
  organizationId,
  member,
  onSuccess,
}: {
  organizationId: string;
  member: PlatformUserDto;
  onSuccess: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState("role");
  const [role, setRole] = useState(member.role);
  const [reason, setReason] = useState("");
  const action = useGovernedAction(onSuccess);

  function close() {
    setOpen(false);
    setOperation("role");
    setRole(member.role);
    setReason("");
    action.reset();
  }

  async function submit() {
    await action.submit({
      url: `/api/platform-admin/organizations/${organizationId}/members/${member.membershipId}`,
      method: "PATCH",
      successMessage: "账号设置已更新。",
      body: (key) => ({
        ...(operation === "role" ? { role } : {}),
        ...(operation === "suspend" ? { status: "suspended" } : {}),
        ...(operation === "activate" ? { status: "active" } : {}),
        ...(operation === "reset" ? { sendPasswordReset: true } : {}),
        expectedUpdatedAt: member.updatedAt,
        reason,
        idempotencyKey: key,
      }),
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        管理账号
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title={`管理账号 · ${member.name}`}
        description={
          member.isPrimaryAccount
            ? "这是组织主账号；服务端会阻止移除最后一位有效负责人。"
            : member.email
        }
        submitting={action.submitting}
        error={action.error}
        success={action.success}
        conflict={action.conflict}
        onClose={close}
        onRefresh={onSuccess}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close}>
              取消
            </Button>
            <Button
              type="button"
              disabled={action.submitting || !reason.trim()}
              onClick={() => void submit()}
            >
              确认操作
            </Button>
          </>
        }
      >
        <SelectField
          label="账号操作"
          name="operation"
          value={operation}
          onChange={setOperation}
          options={[
            ["role", "调整角色"],
            ["suspend", "停用账号"],
            ["activate", "恢复账号"],
            ["reset", "发送密码重置"],
          ]}
        />
        {operation === "role" ? (
          <SelectField
            label="目标角色"
            name="role"
            value={role}
            onChange={setRole}
            options={appRoles.map((item) => [item, roleLabel(item)])}
          />
        ) : null}
        <Field
          label="操作原因"
          name="reason"
          value={reason}
          onChange={setReason}
          required
        />
      </PlatformAdminActionDialog>
    </>
  );
}

function SubscriptionPlanAction({
  organization,
  plans,
  onSuccess,
}: {
  organization: PlatformOrganizationDetailDto;
  plans: PlatformPlanPerformanceDto[];
  onSuccess: () => void | Promise<void>;
}) {
  const subscription = organization.subscription!;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [targetPlanId, setTargetPlanId] = useState(subscription?.plan.id ?? "");
  const [billingCycle, setBillingCycle] = useState(
    subscription?.billingCycle ?? "monthly",
  );
  const [timing, setTiming] = useState("immediate");
  const [preview, setPreview] = useState<SubscriptionPreview | null>(null);
  const action = useGovernedAction(onSuccess);

  function close() {
    setOpen(false);
    setReason("");
    setTargetPlanId(subscription.plan.id);
    setBillingCycle(subscription.billingCycle);
    setTiming("immediate");
    setPreview(null);
    action.reset();
  }

  function command(key: string) {
    return {
      action: "change_plan",
      targetPlanId,
      targetBillingCycle: billingCycle,
      timing,
      expectedUpdatedAt: subscription.updatedAt,
      reason,
      idempotencyKey: key,
    };
  }

  async function requestPreview() {
    const result = await action.submit({
      url: `/api/platform-admin/organizations/${organization.id}/subscription`,
      method: "PATCH",
      final: false,
      body: (key) => ({ mode: "preview", command: command(key) }),
    });
    const nextPreview = result?.preview as SubscriptionPreview | undefined;
    if (nextPreview) setPreview(nextPreview);
  }

  async function apply() {
    await action.submit({
      url: `/api/platform-admin/organizations/${organization.id}/subscription`,
      method: "PATCH",
      successMessage: "套餐变更已应用。",
      body: (key) => ({ mode: "apply", command: command(key) }),
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
      >
        调整套餐
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title="调整套餐"
        description="提交前先计算价格、配额和生效时间影响。"
        submitting={action.submitting}
        error={action.error}
        success={action.success}
        conflict={action.conflict}
        onClose={close}
        onRefresh={onSuccess}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close}>
              取消
            </Button>
            {preview ? (
              <Button
                type="button"
                disabled={action.submitting}
                onClick={() => void apply()}
              >
                {action.submitting ? "应用中…" : "确认应用"}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={action.submitting || !reason.trim()}
                onClick={() => void requestPreview()}
              >
                {action.submitting ? "计算中…" : "预览变更"}
              </Button>
            )}
          </>
        }
      >
        <SelectField
          label="目标套餐"
          name="targetPlanId"
          value={targetPlanId}
          onChange={(value) => {
            setTargetPlanId(value);
            setPreview(null);
            action.clearFeedback();
          }}
          options={plans.map((plan) => [plan.id, plan.name])}
        />
        <SelectField
          label="目标计费周期"
          name="billingCycle"
          value={billingCycle}
          onChange={(value) => {
            setBillingCycle(value);
            setPreview(null);
          }}
          options={[
            ["monthly", "月付"],
            ["annual", "年付"],
          ]}
        />
        <SelectField
          label="生效时间"
          name="timing"
          value={timing}
          onChange={(value) => {
            setTiming(value);
            setPreview(null);
          }}
          options={[
            ["immediate", "立即生效"],
            ["next_cycle", "下个周期生效"],
          ]}
        />
        <Field
          label="调整原因"
          name="reason"
          value={reason}
          onChange={setReason}
          required
        />
        {preview ? <SubscriptionPreviewPanel preview={preview} /> : null}
      </PlatformAdminActionDialog>
    </>
  );
}

function SubscriptionExpiryAction({
  organization,
  onSuccess,
}: {
  organization: PlatformOrganizationDetailDto;
  onSuccess: () => void | Promise<void>;
}) {
  const subscription = organization.subscription!;
  const [open, setOpen] = useState(false);
  const [periodEnd, setPeriodEnd] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<SubscriptionPreview | null>(null);
  const action = useGovernedAction(onSuccess);
  function close() {
    setOpen(false);
    setPeriodEnd("");
    setReason("");
    setPreview(null);
    action.reset();
  }

  function command(key: string) {
    return {
      action: "extend",
      periodEnd,
      expectedUpdatedAt: subscription.updatedAt,
      reason,
      idempotencyKey: key,
    };
  }

  async function submit(mode: "preview" | "apply") {
    const result = await action.submit({
      url: `/api/platform-admin/organizations/${organization.id}/subscription`,
      method: "PATCH",
      final: mode === "apply",
      successMessage: mode === "apply" ? "套餐到期日已更新。" : undefined,
      body: (key) => ({ mode, command: command(key) }),
    });
    if (mode === "preview" && result?.preview) {
      setPreview(result.preview as SubscriptionPreview);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        延长到期
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title="延长套餐到期日"
        description={`当前到期日：${subscription.currentPeriodEnd}`}
        submitting={action.submitting}
        error={action.error}
        success={action.success}
        conflict={action.conflict}
        onClose={close}
        onRefresh={onSuccess}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close}>
              取消
            </Button>
            <Button
              type="button"
              disabled={action.submitting || !periodEnd || !reason.trim()}
              onClick={() => void submit(preview ? "apply" : "preview")}
            >
              {preview ? "确认应用" : "预览变更"}
            </Button>
          </>
        }
      >
        <Field
          label="新的到期日期"
          name="periodEnd"
          type="date"
          value={periodEnd}
          min={subscription.currentPeriodEnd}
          onChange={(value) => {
            setPeriodEnd(value);
            setPreview(null);
          }}
          required
        />
        <Field
          label="调整原因"
          name="reason"
          value={reason}
          onChange={(value) => {
            setReason(value);
            setPreview(null);
          }}
          required
        />
        {preview ? <SubscriptionPreviewPanel preview={preview} /> : null}
      </PlatformAdminActionDialog>
    </>
  );
}

function SubscriptionStatusAction({
  organization,
  onSuccess,
}: {
  organization: PlatformOrganizationDetailDto;
  onSuccess: () => void | Promise<void>;
}) {
  const subscription = organization.subscription!;
  const restoring = subscription.status === "cancelled";
  const actionName = restoring ? "恢复订阅" : "取消订阅";
  const commandAction = restoring ? "restore" : "cancel";
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<SubscriptionPreview | null>(null);
  const action = useGovernedAction(onSuccess);

  function close() {
    setOpen(false);
    setReason("");
    setPreview(null);
    action.reset();
  }

  function command(key: string) {
    return {
      action: commandAction,
      expectedUpdatedAt: subscription.updatedAt,
      reason,
      idempotencyKey: key,
    };
  }

  async function submit(mode: "preview" | "apply") {
    const result = await action.submit({
      url: `/api/platform-admin/organizations/${organization.id}/subscription`,
      method: "PATCH",
      final: mode === "apply",
      successMessage: mode === "apply" ? `${actionName}已完成。` : undefined,
      body: (key) => ({ mode, command: command(key) }),
    });
    if (mode === "preview" && result?.preview) {
      setPreview(result.preview as SubscriptionPreview);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        {actionName}
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title={actionName}
        description={
          restoring
            ? "恢复后订阅重新生效，原套餐和到期日保持不变。"
            : "取消后关闭自动续费并停止订阅；提交前会展示影响预览。"
        }
        submitting={action.submitting}
        error={action.error}
        success={action.success}
        conflict={action.conflict}
        onClose={close}
        onRefresh={onSuccess}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close}>
              返回
            </Button>
            <Button
              type="button"
              variant={!restoring && preview ? "danger" : "primary"}
              disabled={action.submitting || !reason.trim()}
              onClick={() => void submit(preview ? "apply" : "preview")}
            >
              {preview ? `确认${actionName}` : "预览影响"}
            </Button>
          </>
        }
      >
        <Field
          label="操作原因"
          name="reason"
          value={reason}
          onChange={(value) => {
            setReason(value);
            setPreview(null);
          }}
          required
        />
        {preview ? <SubscriptionPreviewPanel preview={preview} /> : null}
      </PlatformAdminActionDialog>
    </>
  );
}

function OfflinePaymentAction({
  organization,
  plans,
  onSuccess,
}: {
  organization: PlatformOrganizationDetailDto;
  plans: PlatformPlanPerformanceDto[];
  onSuccess: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const action = useGovernedAction(onSuccess);

  function close() {
    setOpen(false);
    action.reset();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action.submit({
      url: `/api/platform-admin/organizations/${organization.id}/payments`,
      method: "POST",
      successMessage: "线下付款已记录，订单与订阅状态已刷新。",
      body: (key) => ({
        purpose: text(form, "purpose"),
        planId: text(form, "planId"),
        billingCycle: text(form, "billingCycle"),
        amountCents: yuanToCents(text(form, "amountYuan")),
        currency: "CNY",
        receivedAt: toIso(text(form, "receivedAt")),
        externalReference: text(form, "externalReference"),
        channel: text(form, "channel"),
        reason: text(form, "reason"),
        idempotencyKey: key,
      }),
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        记录付款
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title="记录线下付款"
        description="仅记录已确认到账的组织订阅款，不包含主播结算。"
        submitting={action.submitting}
        error={action.error}
        success={action.success}
        conflict={action.conflict}
        onClose={close}
        onRefresh={onSuccess}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close}>
              取消
            </Button>
            <Button
              type="submit"
              form="record-offline-payment"
              disabled={action.submitting}
            >
              {action.submitting ? "记录中…" : "确认已到账"}
            </Button>
          </>
        }
      >
        <form
          id="record-offline-payment"
          className="space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <SelectField
            label="款项用途"
            name="purpose"
            defaultValue="subscription_renewal"
            options={[
              ["subscription_new", "新购订阅"],
              ["subscription_renewal", "续费"],
              ["subscription_upgrade", "升级"],
              ["subscription_downgrade", "降级"],
            ]}
          />
          <SelectField
            label="对应套餐"
            name="planId"
            defaultValue={organization.subscription?.plan.id}
            options={plans.map((plan) => [plan.id, plan.name])}
          />
          <SelectField
            label="计费周期"
            name="billingCycle"
            defaultValue={organization.subscription?.billingCycle}
            options={[
              ["monthly", "月付"],
              ["annual", "年付"],
            ]}
          />
          <Field
            label="实收金额（元）"
            name="amountYuan"
            type="number"
            min="0.01"
            step="0.01"
            required
          />
          <Field
            label="收款时间"
            name="receivedAt"
            type="datetime-local"
            required
          />
          <Field label="外部流水号" name="externalReference" required />
          <Field
            label="收款渠道"
            name="channel"
            defaultValue="银行转账"
            required
          />
          <Field label="操作原因" name="reason" required />
        </form>
      </PlatformAdminActionDialog>
    </>
  );
}

function OrganizationLifecycleAction({
  organization,
  onSuccess,
}: {
  organization: PlatformOrganizationDetailDto;
  onSuccess: () => void | Promise<void>;
}) {
  const target =
    organization.lifecycleStatus === "frozen" ? "active" : "frozen";
  const label = target === "frozen" ? "冻结组织" : "恢复组织";
  const [open, setOpen] = useState(false);
  const action = useGovernedAction(onSuccess);

  function close() {
    setOpen(false);
    action.reset();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action.submit({
      url: `/api/platform-admin/organizations/${organization.id}`,
      method: "PATCH",
      successMessage: `${label}已完成。`,
      body: (key) => ({
        lifecycleStatus: target,
        expectedUpdatedAt: organization.updatedAt,
        reason: text(form, "reason"),
        idempotencyKey: key,
      }),
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={target === "frozen" ? "danger" : "secondary"}
        size="sm"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title={label}
        description={
          target === "frozen"
            ? "冻结后组织仍保留数据，但成员将无法继续业务操作。"
            : "恢复后组织成员将重新获得原有业务访问权限。"
        }
        submitting={action.submitting}
        error={action.error}
        success={action.success}
        conflict={action.conflict}
        onClose={close}
        onRefresh={onSuccess}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close}>
              取消
            </Button>
            <Button
              type="submit"
              form="change-organization-lifecycle"
              variant={target === "frozen" ? "danger" : "primary"}
              disabled={action.submitting}
            >
              确认{label}
            </Button>
          </>
        }
      >
        <form
          id="change-organization-lifecycle"
          onSubmit={(event) => void submit(event)}
        >
          <Field label="操作原因" name="reason" required />
        </form>
      </PlatformAdminActionDialog>
    </>
  );
}

type SubscriptionPreview = {
  currentPlan: string;
  targetPlan: string;
  effectiveAt: string;
  currentPeriodEnd: string;
  nextPeriodEnd: string;
  currentPriceCents: number;
  targetPriceCents: number;
  includedQuantityChanges?: Record<string, { from: number; to: number }>;
};

function SubscriptionPreviewPanel({
  preview,
}: {
  preview: SubscriptionPreview;
}) {
  return (
    <section
      aria-label="变更预览"
      className="border border-blue-200 bg-[var(--blue-50)] p-4"
    >
      <p className="text-xs font-semibold text-[var(--blue-700)]">变更预览</p>
      <p className="mt-2 text-base font-semibold">
        {preview.currentPlan} → {preview.targetPlan}
      </p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <PreviewValue
          label="价格"
          value={`${formatCurrencyCents(preview.currentPriceCents)} → ${formatCurrencyCents(preview.targetPriceCents)}`}
        />
        <PreviewValue label="生效时间" value={preview.effectiveAt} />
        <PreviewValue
          label="到期日"
          value={`${preview.currentPeriodEnd} → ${preview.nextPeriodEnd}`}
        />
        <PreviewValue
          label="配额变化"
          value={`${Object.keys(preview.includedQuantityChanges ?? {}).length} 项`}
        />
      </dl>
    </section>
  );
}

function PreviewValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--ink-400)]">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[64px_1fr] gap-3">
      <dt className="text-amber-800">{label}</dt>
      <dd className="select-all font-mono font-semibold">{value}</dd>
    </div>
  );
}

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid gap-4 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
      <legend className="mb-1 pr-3 text-xs font-semibold text-[var(--ink-500)]">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  name,
  type = "text",
  value,
  onChange,
  ...inputProps
}: {
  label: string;
  name: string;
  type?: string;
  value?: string;
  onChange?: (value: string) => void;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "name" | "type" | "value" | "onChange"
>) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-xs font-medium text-[var(--ink-500)]">
        {label}
      </span>
      <input
        aria-label={label}
        name={name}
        type={type}
        {...(value !== undefined ? { value } : {})}
        {...(onChange
          ? {
              onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                onChange(event.target.value),
            }
          : {})}
        className="h-10 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--blue-600)] focus:ring-2 focus:ring-blue-100"
        {...inputProps}
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
  value,
  onChange,
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  options: Array<readonly [string, string]>;
  value?: string;
  onChange?: (value: string) => void;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-xs font-medium text-[var(--ink-500)]">
        {label}
      </span>
      <select
        aria-label={label}
        name={name}
        {...(value !== undefined ? { value } : { defaultValue })}
        onChange={
          onChange ? (event) => onChange(event.target.value) : undefined
        }
        required={required}
        className="h-10 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--blue-600)] focus:ring-2 focus:ring-blue-100"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export function yuanToCents(value: string) {
  return Math.round(Number(value) * 100);
}

export function toIso(value: string) {
  return new Date(value).toISOString();
}

export { Field as ActionField, SelectField as ActionSelectField };
