"use client";

import { useMemo, useState } from "react";

import { AccountLibraryDetail } from "@/components/account-library/account-library-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PlatformAccountDto } from "@/features/account-library/account-library-ui-adapters";
import type {
  PlatformAccountStatus,
  PlatformAccountType,
} from "@/features/account-library/account-library-service";

const TYPE_LABELS: Record<PlatformAccountType, string> = {
  self_incubated: "自孵化",
  partner: "合作商",
  streamer_owned: "主播自带",
};

const STATUS_LABELS: Record<PlatformAccountStatus, string> = {
  nurturing: "养号中",
  active: "在用",
  idle: "闲置",
  frozen: "封禁",
  retired: "注销",
};

const STATUS_TONES: Record<
  PlatformAccountStatus,
  "green" | "neutral" | "amber" | "red" | "blue"
> = {
  nurturing: "blue",
  active: "green",
  idle: "amber",
  frozen: "red",
  retired: "neutral",
};

type CreateForm = {
  platform: string;
  accountUid: string;
  accountType: PlatformAccountType;
  status: PlatformAccountStatus;
  accountSource: string;
  xingtuId: string;
  cooperationCode: string;
  realNameHolder: string;
  realNamePhone: string;
  securityPhone: string;
  securityEmail: string;
  followerCount: string;
  note: string;
};

const EMPTY_FORM: CreateForm = {
  platform: "",
  accountUid: "",
  accountType: "self_incubated",
  status: "active",
  accountSource: "",
  xingtuId: "",
  cooperationCode: "",
  realNameHolder: "",
  realNamePhone: "",
  securityPhone: "",
  securityEmail: "",
  followerCount: "",
  note: "",
};

export function AccountLibraryPanel({
  accounts: initialAccounts,
  canManage,
}: {
  accounts: PlatformAccountDto[];
  canManage: boolean;
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [typeFilter, setTypeFilter] = useState<"" | PlatformAccountType>("");
  const [statusFilter, setStatusFilter] = useState<"" | PlatformAccountStatus>("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      accounts.filter(
        (account) =>
          (!typeFilter || account.accountType === typeFilter) &&
          (!statusFilter || account.status === statusFilter),
      ),
    [accounts, typeFilter, statusFilter],
  );

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/account-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          followerCount: form.followerCount
            ? Number(form.followerCount)
            : undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "创建失败");
      }
      setAccounts((prev) => [dtoFromAccount(payload.account), ...prev]);
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">账号库</h1>
          <p className="text-sm text-[var(--ink-300)]">
            组织级账号资产，独立于主播；实名与密保信息按权限脱敏，
            生命周期流转、设备白名单与平台指标见行内详情。
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setShowForm((value) => !value)}>
            {showForm ? "取消" : "新增账号"}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <FilterSelect
          label="账号类型"
          value={typeFilter}
          onChange={(value) => setTypeFilter(value as "" | PlatformAccountType)}
          options={[["", "全部类型"], ...objectEntries(TYPE_LABELS)]}
        />
        <FilterSelect
          label="状态"
          value={statusFilter}
          onChange={(value) =>
            setStatusFilter(value as "" | PlatformAccountStatus)
          }
          options={[["", "全部状态"], ...objectEntries(STATUS_LABELS)]}
        />
        <div className="ml-auto self-end text-sm text-[var(--ink-300)]">
          共 {filtered.length} 个账号
        </div>
      </div>

      {showForm ? (
        <div className="rounded-lg border border-[var(--line)] bg-white p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="平台 *">
              <input
                className={inputClass}
                value={form.platform}
                onChange={(event) =>
                  setForm({ ...form, platform: event.target.value })
                }
                placeholder="抖音 / 快手 / 视频号"
              />
            </Field>
            <Field label="账号 UID *">
              <input
                className={inputClass}
                value={form.accountUid}
                onChange={(event) =>
                  setForm({ ...form, accountUid: event.target.value })
                }
              />
            </Field>
            <Field label="账号类型">
              <select
                className={inputClass}
                value={form.accountType}
                onChange={(event) =>
                  setForm({
                    ...form,
                    accountType: event.target.value as PlatformAccountType,
                  })
                }
              >
                {objectEntries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="状态">
              <select
                className={inputClass}
                value={form.status}
                onChange={(event) =>
                  setForm({
                    ...form,
                    status: event.target.value as PlatformAccountStatus,
                  })
                }
              >
                {objectEntries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="账号来源">
              <input
                className={inputClass}
                value={form.accountSource}
                onChange={(event) =>
                  setForm({ ...form, accountSource: event.target.value })
                }
              />
            </Field>
            <Field label="星图 ID">
              <input
                className={inputClass}
                value={form.xingtuId}
                onChange={(event) =>
                  setForm({ ...form, xingtuId: event.target.value })
                }
              />
            </Field>
            <Field label="合作码">
              <input
                className={inputClass}
                value={form.cooperationCode}
                onChange={(event) =>
                  setForm({ ...form, cooperationCode: event.target.value })
                }
              />
            </Field>
            <Field label="实名人">
              <input
                className={inputClass}
                value={form.realNameHolder}
                onChange={(event) =>
                  setForm({ ...form, realNameHolder: event.target.value })
                }
              />
            </Field>
            <Field label="实名手机号">
              <input
                className={inputClass}
                value={form.realNamePhone}
                onChange={(event) =>
                  setForm({ ...form, realNamePhone: event.target.value })
                }
              />
            </Field>
            <Field label="密保手机">
              <input
                className={inputClass}
                value={form.securityPhone}
                onChange={(event) =>
                  setForm({ ...form, securityPhone: event.target.value })
                }
              />
            </Field>
            <Field label="密保邮箱">
              <input
                className={inputClass}
                value={form.securityEmail}
                onChange={(event) =>
                  setForm({ ...form, securityEmail: event.target.value })
                }
              />
            </Field>
            <Field label="粉丝量">
              <input
                className={inputClass}
                type="number"
                min={0}
                value={form.followerCount}
                onChange={(event) =>
                  setForm({ ...form, followerCount: event.target.value })
                }
              />
            </Field>
          </div>
          {error ? (
            <p className="mt-3 text-sm text-[var(--danger-600)]">{error}</p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setShowForm(false);
                setError(null);
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleCreate}
              disabled={submitting || !form.platform || !form.accountUid}
            >
              {submitting ? "提交中…" : "保存账号"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-xs text-[var(--ink-300)]">
              <th className="px-4 py-3 font-medium">平台 / UID</th>
              <th className="px-4 py-3 font-medium">类型</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">粉丝量</th>
              <th className="px-4 py-3 font-medium">实名人</th>
              <th className="px-4 py-3 font-medium">实名手机号</th>
              <th className="px-4 py-3 font-medium">最近直播</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-[var(--ink-300)]"
                >
                  暂无账号
                </td>
              </tr>
            ) : (
              filtered.flatMap((account) => {
                const rows = [
                  <tr
                    key={account.id}
                    className="border-b border-[var(--line)] last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{account.platform}</div>
                      <div className="text-xs text-[var(--ink-300)]">
                        {account.accountUid}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="blue">
                        {TYPE_LABELS[account.accountType]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONES[account.status]}>
                        {STATUS_LABELS[account.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {account.followerCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {account.realNameHolder ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs">
                        {account.realNamePhone ?? "—"}
                      </span>
                      {account.realNamePhoneMasked &&
                      account.realNamePhone ? (
                        <span className="ml-2 text-xs text-[var(--ink-300)]">
                          已脱敏
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--ink-500)]">
                      {formatDate(account.lastLiveAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setExpandedId((current) =>
                            current === account.id ? null : account.id,
                          )
                        }
                      >
                        {expandedId === account.id ? "收起" : "详情"}
                      </Button>
                    </td>
                  </tr>,
                ];
                if (expandedId === account.id) {
                  rows.push(
                    <tr key={`${account.id}-detail`}>
                      <td colSpan={8} className="px-4 py-3">
                        <AccountLibraryDetail
                          account={account}
                          canManage={canManage}
                          onAccountUpdated={(updated) =>
                            setAccounts((prev) =>
                              prev.map((item) =>
                                item.id === updated.id ? updated : item,
                              ),
                            )
                          }
                        />
                      </td>
                    </tr>,
                  );
                }
                return rows;
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("zh-CN");
}

const inputClass =
  "h-9 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--blue-400)]";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-[var(--ink-500)]">{label}</span>
      {children}
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-[var(--ink-300)]">{label}</span>
      <select
        className="h-9 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
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

function objectEntries<T extends Record<string, string>>(
  record: T,
): [string, string][] {
  return Object.entries(record);
}

function dtoFromAccount(account: {
  id: string;
  platform: string;
  accountSource: string | null;
  accountUid: string;
  xingtuId: string | null;
  cooperationCode: string | null;
  accountType: PlatformAccountType;
  status: PlatformAccountStatus;
  realNameHolder: string | null;
  realNamePhone: string | null;
  securityPhone: string | null;
  securityEmail: string | null;
  followerCount: number;
  projectId: string | null;
  operatorId: string | null;
  boundStreamerId: string | null;
  note: string | null;
  lastLiveAt: string | null;
  lastSyncedAt: string | null;
}): PlatformAccountDto {
  return {
    ...account,
    realNamePhoneMasked: false,
    securityInfoMasked: false,
    createdAt: new Date().toISOString(),
  };
}
