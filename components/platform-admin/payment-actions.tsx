"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { PlatformOrderDto } from "@/features/platform-admin/platform-admin-contracts";

import {
  ActionField,
  useGovernedAction,
  yuanToCents,
} from "./organization-actions";
import { PlatformAdminActionDialog } from "./platform-admin-action-dialog";
import { formatCurrencyCents } from "./platform-admin-format";

export function PaymentActions({
  order,
  onSuccess,
}: {
  order: PlatformOrderDto;
  onSuccess: () => void | Promise<void>;
}) {
  if (order.status === "paid") {
    return <RefundAction order={order} onSuccess={onSuccess} />;
  }
  if (order.status === "pending") {
    return <CancelOrderAction order={order} onSuccess={onSuccess} />;
  }
  return <span className="text-xs text-[var(--ink-300)]">无可用操作</span>;
}

function RefundAction({
  order,
  onSuccess,
}: {
  order: PlatformOrderDto;
  onSuccess: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const action = useGovernedAction(onSuccess);

  function close() {
    setOpen(false);
    setReason("");
    action.reset();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action.submit({
      url: `/api/platform-admin/orders/${order.id}/refund`,
      method: "POST",
      successMessage: "退款请求已处理，订单与经营指标已从服务端刷新。",
      body: (key) => ({
        amountCents: yuanToCents(String(form.get("amountYuan"))),
        refundExternalReference: String(
          form.get("refundExternalReference") ?? "",
        ).trim(),
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
        退款
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title={`订单退款 · ${order.organizationName}`}
        description={`订单 ${order.id}，原支付金额 ${formatCurrencyCents(order.amountCents)}。退款将影响平台实收与 ARP。`}
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
              form={`refund-order-${order.id}`}
              variant="danger"
              disabled={action.submitting || !reason.trim()}
            >
              {action.submitting ? "退款中…" : "确认退款"}
            </Button>
          </>
        }
      >
        <form
          id={`refund-order-${order.id}`}
          className="space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <ActionField
            label="退款金额（元）"
            name="amountYuan"
            type="number"
            min="0.01"
            max={(order.amountCents / 100).toFixed(2)}
            step="0.01"
            defaultValue={(order.amountCents / 100).toFixed(2)}
            required
          />
          <ActionField
            label="退款外部流水号"
            name="refundExternalReference"
            required
          />
          <ActionField
            label="退款原因"
            name="reason"
            value={reason}
            onChange={setReason}
            required
          />
          <p className="border-l-2 border-amber-400 pl-3 text-xs leading-5 text-[var(--ink-500)]">
            请确认退款渠道已具备处理条件；界面不会提前扣减金额，最终以服务端结果为准。
          </p>
        </form>
      </PlatformAdminActionDialog>
    </>
  );
}

function CancelOrderAction({
  order,
  onSuccess,
}: {
  order: PlatformOrderDto;
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
      url: `/api/platform-admin/orders/${order.id}`,
      method: "PATCH",
      successMessage: "订单已取消。",
      body: (key) => ({
        action: "cancel",
        expectedUpdatedAt: order.updatedAt,
        reason: String(form.get("reason") ?? "").trim(),
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
        取消订单
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title="取消未完成订单"
        description={`订单 ${order.id} 将停止后续支付处理。`}
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
              type="submit"
              form={`cancel-order-${order.id}`}
              variant="danger"
              disabled={action.submitting}
            >
              确认取消
            </Button>
          </>
        }
      >
        <form
          id={`cancel-order-${order.id}`}
          onSubmit={(event) => void submit(event)}
        >
          <ActionField label="取消原因" name="reason" required />
        </form>
      </PlatformAdminActionDialog>
    </>
  );
}
