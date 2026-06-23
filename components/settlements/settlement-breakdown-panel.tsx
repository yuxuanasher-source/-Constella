"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type LineItemView = {
  id: string;
  streamerId: string | null;
  direction: "revenue" | "cost";
  category: string;
  label: string;
  amount: number;
};

export type StreamerMarginView = {
  streamerId: string | null;
  revenue: number;
  cost: number;
  margin: number;
};

export type CollaborationSplitView = {
  id: string;
  collaborationId: string;
  mode: string;
  basisAmount: number;
  computedAmount: number;
  manualAmount: number;
};

export function SettlementBreakdownPanel({
  batchId,
  summary,
  byStreamer,
  collaborations,
  lineItems: initialLineItems,
  canManage,
}: {
  batchId: string;
  summary: {
    revenue: number;
    cost: number;
    grossMargin: number;
    mcnSplit: number;
    netMargin: number;
  };
  byStreamer: StreamerMarginView[];
  collaborations: CollaborationSplitView[];
  lineItems: LineItemView[];
  canManage: boolean;
}) {
  const [lineItems, setLineItems] = useState(initialLineItems);
  const [form, setForm] = useState({
    direction: "cost" as "revenue" | "cost",
    category: "",
    label: "",
    amount: "",
    streamerId: "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/settlement-batches/${batchId}/line-items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            direction: form.direction,
            category: form.category,
            label: form.label,
            amount: Number(form.amount),
            streamerId: form.streamerId || undefined,
            reason: form.reason,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "添加失败");
      }
      setLineItems((prev) => [...prev, payload.lineItem as LineItemView]);
      setForm({
        direction: "cost",
        category: "",
        label: "",
        amount: "",
        streamerId: "",
        reason: "",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  const revenueItems = lineItems.filter((item) => item.direction === "revenue");
  const costItems = lineItems.filter((item) => item.direction === "cost");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">结算明细</h1>
        <p className="text-sm text-[var(--ink-300)]">
          批次 {batchId} · 收入 − 成本 = 毛利，再扣 MCN 分成得净毛利。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryCard label="收入" value={summary.revenue} tone="blue" />
        <SummaryCard label="成本" value={summary.cost} tone="amber" />
        <SummaryCard label="毛利" value={summary.grossMargin} tone="green" />
        <SummaryCard label="MCN 分成" value={summary.mcnSplit} tone="neutral" />
        <SummaryCard label="净毛利" value={summary.netMargin} tone="green" />
      </div>

      {collaborations.length > 0 ? (
        <div className="rounded-lg border border-[var(--line)] bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">MCN 协同分成</h2>
          <div className="space-y-2">
            {collaborations.map((collaboration) => (
              <div
                key={collaboration.id}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  {collaboration.mode === "percentage"
                    ? "百分比（基数=毛利）"
                    : "每小时固定（基数=结算时长）"}
                  <span className="ml-2 text-xs text-[var(--ink-300)]">
                    基数 {collaboration.basisAmount}
                  </span>
                </span>
                <span className="font-medium">
                  {collaboration.computedAmount + collaboration.manualAmount}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <LineItemTable title="收入项" items={revenueItems} />
      <LineItemTable title="成本项" items={costItems} />

      <div className="rounded-lg border border-[var(--line)] bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">按主播明细</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--ink-300)]">
              <th className="py-2">主播</th>
              <th className="py-2">收入</th>
              <th className="py-2">成本</th>
              <th className="py-2">毛利</th>
            </tr>
          </thead>
          <tbody>
            {byStreamer.map((row) => (
              <tr
                key={row.streamerId ?? "project"}
                className="border-t border-[var(--line)]"
              >
                <td className="py-2">{row.streamerId ?? "项目级"}</td>
                <td className="py-2">{row.revenue}</td>
                <td className="py-2">{row.cost}</td>
                <td className="py-2 font-medium">{row.margin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <div className="rounded-lg border border-[var(--line)] bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">新增收入/成本项</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <select
              className={inputClass}
              value={form.direction}
              onChange={(event) =>
                setForm({
                  ...form,
                  direction: event.target.value as "revenue" | "cost",
                })
              }
            >
              <option value="revenue">收入项</option>
              <option value="cost">成本项</option>
            </select>
            <input
              className={inputClass}
              placeholder="类目键，如 promotion / tax"
              value={form.category}
              onChange={(event) =>
                setForm({ ...form, category: event.target.value })
              }
            />
            <input
              className={inputClass}
              placeholder="显示名，如 推广成本"
              value={form.label}
              onChange={(event) =>
                setForm({ ...form, label: event.target.value })
              }
            />
            <input
              className={inputClass}
              placeholder="金额"
              value={form.amount}
              onChange={(event) =>
                setForm({ ...form, amount: event.target.value })
              }
            />
            <input
              className={inputClass}
              placeholder="主播 ID（可空=项目级）"
              value={form.streamerId}
              onChange={(event) =>
                setForm({ ...form, streamerId: event.target.value })
              }
            />
            <input
              className={inputClass}
              placeholder="原因 *"
              value={form.reason}
              onChange={(event) =>
                setForm({ ...form, reason: event.target.value })
              }
            />
          </div>
          {error ? (
            <p className="mt-3 text-sm text-[var(--danger-600)]">{error}</p>
          ) : null}
          <div className="mt-4 flex justify-end">
            <Button
              onClick={handleAdd}
              disabled={
                busy ||
                !form.category ||
                !form.label ||
                !form.amount ||
                !form.reason
              }
            >
              {busy ? "提交中…" : "添加明细项"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LineItemTable({
  title,
  items,
}: {
  title: string;
  items: LineItemView[];
}) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {items.length === 0 ? (
        <div className="text-sm text-[var(--ink-300)]">暂无</div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-[var(--line)]">
                <td className="py-2">
                  <span className="font-medium">{item.label}</span>
                  <Badge className="ml-2" tone="neutral">
                    {item.category}
                  </Badge>
                  {item.streamerId ? (
                    <span className="ml-2 text-xs text-[var(--ink-300)]">
                      主播 {item.streamerId}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 text-right font-medium">{item.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "amber" | "green" | "neutral";
}) {
  const toneClass = {
    blue: "text-[var(--blue-700)]",
    amber: "text-[var(--warn-600)]",
    green: "text-[var(--ok-600)]",
    neutral: "text-[var(--ink-700)]",
  }[tone];
  return (
    <div className="rounded-lg border border-[var(--line)] bg-white p-3">
      <div className="text-xs text-[var(--ink-300)]">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

const inputClass =
  "h-9 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--blue-400)]";
