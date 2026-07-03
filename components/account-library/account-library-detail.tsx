"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ACCOUNT_STATUS_TRANSITIONS } from "@/features/account-library/account-lifecycle-service";
import type { PlatformAccountStatus } from "@/features/account-library/account-library-service";
import type {
  AccountBanRecordDto,
  AccountDeviceDto,
  AccountLoginLogDto,
  AccountMetricsDto,
  AccountStatusLogDto,
  PlatformAccountDto,
} from "@/features/account-library/account-library-ui-adapters";

const STATUS_LABELS: Record<PlatformAccountStatus, string> = {
  nurturing: "养号中",
  active: "在用",
  idle: "闲置",
  frozen: "封禁",
  retired: "注销",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "手动",
  auto_idle: "自动闲置",
  metrics_sync: "指标同步",
};

type DetailPayload = {
  statusLogs: AccountStatusLogDto[];
  devices: AccountDeviceDto[];
  loginLogs: AccountLoginLogDto[];
  banRecords: AccountBanRecordDto[];
  metrics: AccountMetricsDto[];
};

type TabKey = "lifecycle" | "security" | "bans" | "metrics";

const TABS: Array<[TabKey, string]> = [
  ["lifecycle", "生命周期"],
  ["security", "安全管控"],
  ["bans", "封禁存档"],
  ["metrics", "数据指标"],
];

export function AccountLibraryDetail({
  account,
  canManage,
  onAccountUpdated,
}: {
  account: PlatformAccountDto;
  canManage: boolean;
  onAccountUpdated: (account: PlatformAccountDto) => void;
}) {
  const [tab, setTab] = useState<TabKey>("lifecycle");
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 动作完成后 bump reloadKey 触发重新拉取；刷新时保留已有数据避免闪烁
  const loadDetail = useCallback(async () => {
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let isCurrent = true;

    async function fetchDetail() {
      try {
        const response = await fetch(
          `/api/account-library/${account.id}/detail`,
        );
        const payload = await response.json();
        if (!isCurrent) {
          return;
        }
        if (!response.ok) {
          throw new Error(payload.error ?? "加载详情失败");
        }
        setDetail(payload as DetailPayload);
        setError(null);
      } catch (caught) {
        if (isCurrent) {
          setError(caught instanceof Error ? caught.message : "加载详情失败");
        }
      } finally {
        if (isCurrent) {
          setLoading(false);
        }
      }
    }

    void fetchDetail();
    return () => {
      isCurrent = false;
    };
  }, [account.id, reloadKey]);

  return (
    <div className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="font-medium">
          {account.platform}:{account.accountUid}
        </span>
        <span className="text-[var(--ink-300)]">
          密保手机 {account.securityPhone ?? "—"}
        </span>
        <span className="text-[var(--ink-300)]">
          密保邮箱 {account.securityEmail ?? "—"}
        </span>
        {account.securityInfoMasked &&
        (account.securityPhone || account.securityEmail) ? (
          <span className="text-xs text-[var(--ink-300)]">已脱敏</span>
        ) : null}
        <span className="text-[var(--ink-300)]">
          最近同步 {formatDateTime(account.lastSyncedAt)}
        </span>
      </div>

      <div className="flex gap-2 border-b border-[var(--line)]">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === key
                ? "border-[var(--blue-400)] font-medium text-[var(--blue-700)]"
                : "border-transparent text-[var(--ink-300)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-[var(--danger-600)]">{error}</p>
      ) : null}
      {loading || !detail ? (
        <p className="text-sm text-[var(--ink-300)]">加载中…</p>
      ) : (
        <>
          {tab === "lifecycle" ? (
            <LifecycleTab
              account={account}
              statusLogs={detail.statusLogs}
              canManage={canManage}
              onAccountUpdated={onAccountUpdated}
              onChanged={loadDetail}
            />
          ) : null}
          {tab === "security" ? (
            <SecurityTab
              account={account}
              devices={detail.devices}
              loginLogs={detail.loginLogs}
              canManage={canManage}
              onChanged={loadDetail}
            />
          ) : null}
          {tab === "bans" ? <BanRecordsTab records={detail.banRecords} /> : null}
          {tab === "metrics" ? <MetricsTab metrics={detail.metrics} /> : null}
        </>
      )}
    </div>
  );
}

function LifecycleTab({
  account,
  statusLogs,
  canManage,
  onAccountUpdated,
  onChanged,
}: {
  account: PlatformAccountDto;
  statusLogs: AccountStatusLogDto[];
  canManage: boolean;
  onAccountUpdated: (account: PlatformAccountDto) => void;
  onChanged: () => Promise<void>;
}) {
  const allowedTargets = ACCOUNT_STATUS_TRANSITIONS[account.status];
  const [toStatus, setToStatus] = useState<"" | PlatformAccountStatus>("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonRequired = toStatus === "frozen" || toStatus === "retired";

  async function handleTransition() {
    if (!toStatus) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/account-library/${account.id}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toStatus, reason: reason || undefined }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "状态流转失败");
      }
      onAccountUpdated({ ...account, status: toStatus });
      setToStatus("");
      setReason("");
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "状态流转失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {canManage && allowedTargets.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--line)] bg-white p-3">
          <label className="block space-y-1">
            <span className="text-xs text-[var(--ink-500)]">流转到</span>
            <select
              className={inputClass}
              value={toStatus}
              onChange={(event) =>
                setToStatus(event.target.value as "" | PlatformAccountStatus)
              }
            >
              <option value="">选择目标状态</option>
              {allowedTargets.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1 space-y-1">
            <span className="text-xs text-[var(--ink-500)]">
              原因{reasonRequired ? "（封禁/注销必填）" : ""}
            </span>
            <input
              className={inputClass}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reasonRequired ? "请填写原因" : "选填"}
            />
          </label>
          <Button
            onClick={handleTransition}
            disabled={submitting || !toStatus || (reasonRequired && !reason.trim())}
          >
            {submitting ? "提交中…" : "确认流转"}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-[var(--danger-600)]">{error}</p>
      ) : null}

      <DetailTable
        headers={["时间", "流转", "来源", "原因"]}
        emptyText="暂无状态流转记录"
        rows={statusLogs.map((log) => [
          formatDateTime(log.changedAt),
          `${STATUS_LABELS[log.fromStatus]} → ${STATUS_LABELS[log.toStatus]}`,
          SOURCE_LABELS[log.source] ?? log.source,
          log.reason ?? "—",
        ])}
      />
    </div>
  );
}

function SecurityTab({
  account,
  devices,
  loginLogs,
  canManage,
  onChanged,
}: {
  account: PlatformAccountDto;
  devices: AccountDeviceDto[];
  loginLogs: AccountLoginLogDto[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [deviceName, setDeviceName] = useState("");
  const [deviceFingerprint, setDeviceFingerprint] = useState("");
  const [loginFingerprint, setLoginFingerprint] = useState("");
  const [loginDeviceName, setLoginDeviceName] = useState("");
  const [loginIp, setLoginIp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(url: string, body: Record<string, unknown>, method = "POST") {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "操作失败");
      }
      await onChanged();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddDevice() {
    const ok = await submit(`/api/account-library/${account.id}/devices`, {
      deviceName,
      deviceFingerprint,
    });
    if (ok) {
      setDeviceName("");
      setDeviceFingerprint("");
    }
  }

  async function handleRevokeDevice(deviceId: string) {
    await submit(
      `/api/account-library/${account.id}/devices/${deviceId}`,
      { action: "revoke" },
      "PATCH",
    );
  }

  async function handleRecordLogin() {
    const ok = await submit(`/api/account-library/${account.id}/login-logs`, {
      deviceFingerprint: loginFingerprint,
      deviceName: loginDeviceName || undefined,
      ipAddress: loginIp || undefined,
    });
    if (ok) {
      setLoginFingerprint("");
      setLoginDeviceName("");
      setLoginIp("");
    }
  }

  return (
    <div className="space-y-5">
      {error ? (
        <p className="text-sm text-[var(--danger-600)]">{error}</p>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">登录设备白名单</h3>
        {canManage ? (
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--line)] bg-white p-3">
            <label className="block space-y-1">
              <span className="text-xs text-[var(--ink-500)]">设备名称</span>
              <input
                className={inputClass}
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                placeholder="直播间主力机"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[var(--ink-500)]">设备指纹</span>
              <input
                className={inputClass}
                value={deviceFingerprint}
                onChange={(event) => setDeviceFingerprint(event.target.value)}
                placeholder="IMEI / 序列号 / 指纹哈希"
              />
            </label>
            <Button
              onClick={handleAddDevice}
              disabled={submitting || !deviceName.trim() || !deviceFingerprint.trim()}
            >
              加入白名单
            </Button>
          </div>
        ) : null}
        <DetailTable
          headers={["设备", "指纹", "状态", "操作"]}
          emptyText="暂无白名单设备"
          rows={devices.map((device) => [
            device.deviceName,
            <span key="fp" className="font-mono text-xs">
              {device.deviceFingerprint}
            </span>,
            <Badge key="st" tone={device.status === "active" ? "green" : "neutral"}>
              {device.status === "active" ? "生效中" : "已撤销"}
            </Badge>,
            canManage && device.status === "active" ? (
              <Button
                key="op"
                variant="secondary"
                onClick={() => handleRevokeDevice(device.id)}
                disabled={submitting}
              >
                撤销
              </Button>
            ) : (
              "—"
            ),
          ])}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">登录日志</h3>
        {canManage ? (
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--line)] bg-white p-3">
            <label className="block space-y-1">
              <span className="text-xs text-[var(--ink-500)]">设备指纹</span>
              <input
                className={inputClass}
                value={loginFingerprint}
                onChange={(event) => setLoginFingerprint(event.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[var(--ink-500)]">设备名称</span>
              <input
                className={inputClass}
                value={loginDeviceName}
                onChange={(event) => setLoginDeviceName(event.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[var(--ink-500)]">IP</span>
              <input
                className={inputClass}
                value={loginIp}
                onChange={(event) => setLoginIp(event.target.value)}
              />
            </label>
            <Button
              onClick={handleRecordLogin}
              disabled={submitting || !loginFingerprint.trim()}
            >
              登记登录
            </Button>
          </div>
        ) : null}
        <DetailTable
          headers={["时间", "设备", "IP / 位置", "风险"]}
          emptyText="暂无登录日志"
          rows={loginLogs.map((log) => [
            formatDateTime(log.loggedInAt),
            <span key="d">
              {log.deviceName ?? "未知设备"}
              <span className="ml-1 font-mono text-xs text-[var(--ink-300)]">
                {log.deviceFingerprint}
              </span>
            </span>,
            [log.ipAddress, log.location].filter(Boolean).join(" / ") || "—",
            log.riskLevel === "suspicious" ? (
              <Badge key="r" tone="red">
                异常登录
              </Badge>
            ) : (
              <Badge key="r" tone="green">
                白名单
              </Badge>
            ),
          ])}
        />
      </section>
    </div>
  );
}

function BanRecordsTab({ records }: { records: AccountBanRecordDto[] }) {
  return (
    <DetailTable
      headers={["封禁时间", "原因", "来源", "解封"]}
      emptyText="暂无封禁记录"
      rows={records.map((record) => [
        formatDateTime(record.bannedAt),
        record.reason,
        record.source ?? "—",
        record.liftedAt
          ? `${formatDateTime(record.liftedAt)}${
              record.liftedReason ? `（${record.liftedReason}）` : ""
            }`
          : "封禁中",
      ])}
    />
  );
}

function MetricsTab({ metrics }: { metrics: AccountMetricsDto[] }) {
  return (
    <DetailTable
      headers={["日期", "粉丝量", "场观", "流水（元）", "直播时长（分）", "来源"]}
      emptyText="暂无同步指标，等待平台接口回传"
      rows={metrics.map((metric) => [
        metric.metricDate,
        metric.followerCount.toLocaleString(),
        metric.liveViewCount.toLocaleString(),
        metric.gmvAmount.toLocaleString(),
        metric.liveDurationMinutes.toLocaleString(),
        metric.source === "platform_api" ? "平台接口" : "手动",
      ])}
    />
  );
}

function DetailTable({
  headers,
  rows,
  emptyText,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  emptyText: string;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--line)] bg-white">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-xs text-[var(--ink-300)]">
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={headers.length}
                className="px-3 py-6 text-center text-[var(--ink-300)]"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((cells, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-[var(--line)] last:border-0"
              >
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

const inputClass =
  "h-9 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--blue-400)]";

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}
