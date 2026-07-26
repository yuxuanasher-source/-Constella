"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { PlatformPlanPerformanceDto } from "@/features/platform-admin/platform-admin-contracts";

import {
  ActionField,
  ActionSelectField,
  toIso,
  useGovernedAction,
  yuanToCents,
} from "./organization-actions";
import { PlatformAdminActionDialog } from "./platform-admin-action-dialog";

export function PlanActions({
  plan,
  onSuccess,
}: {
  plan: PlatformPlanPerformanceDto;
  onSuccess: () => void | Promise<void>;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <PlanMetadataAction plan={plan} onSuccess={onSuccess} />
      <PlanPriceAction plan={plan} onSuccess={onSuccess} />
      <CostVersionAction
        planId={plan.id}
        planName={plan.name}
        expectedUpdatedAt={plan.updatedAt}
        onSuccess={onSuccess}
      />
    </div>
  );
}

function PlanMetadataAction({
  plan,
  onSuccess,
}: {
  plan: PlatformPlanPerformanceDto;
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
      url: `/api/platform-admin/plans/${plan.id}`,
      method: "PATCH",
      successMessage: "套餐资料已更新。",
      body: (key) => ({
        name: String(form.get("name") ?? "").trim(),
        included: {
          seats: Number(form.get("seats")),
          activeStreamers: Number(form.get("activeStreamers")),
          ocr: Number(form.get("ocr")),
          ai: Number(form.get("ai")),
          storageMb: Number(form.get("storageMb")),
          exports: Number(form.get("exports")),
        },
        expectedUpdatedAt: plan.updatedAt,
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
        编辑套餐
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title={`编辑套餐 · ${plan.name}`}
        description="套餐名称和配额会影响后续订阅预览；已生效价格不会在此修改。"
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
              form={`edit-plan-${plan.id}`}
              disabled={action.submitting}
            >
              保存套餐
            </Button>
          </>
        }
      >
        <form
          id={`edit-plan-${plan.id}`}
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => void submit(event)}
        >
          <div className="sm:col-span-2">
            <ActionField
              label="套餐名称"
              name="name"
              defaultValue={plan.name}
              required
            />
          </div>
          <ActionField
            label="包含席位数"
            name="seats"
            type="number"
            min="0"
            defaultValue={String(plan.included.seats)}
            required
          />
          <ActionField
            label="包含活跃主播数"
            name="activeStreamers"
            type="number"
            min="0"
            defaultValue={String(plan.included.activeStreamers)}
            required
          />
          <ActionField
            label="包含 OCR 次数"
            name="ocr"
            type="number"
            min="0"
            defaultValue={String(plan.included.ocr)}
            required
          />
          <ActionField
            label="包含 AI 次数"
            name="ai"
            type="number"
            min="0"
            defaultValue={String(plan.included.ai)}
            required
          />
          <ActionField
            label="包含存储（MB）"
            name="storageMb"
            type="number"
            min="0"
            defaultValue={String(plan.included.storageMb)}
            required
          />
          <ActionField
            label="包含导出次数"
            name="exports"
            type="number"
            min="0"
            defaultValue={String(plan.included.exports)}
            required
          />
          <div className="sm:col-span-2">
            <ActionField label="调整原因" name="reason" required />
          </div>
        </form>
      </PlatformAdminActionDialog>
    </>
  );
}

function PlanPriceAction({
  plan,
  onSuccess,
}: {
  plan: PlatformPlanPerformanceDto;
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
      url: `/api/platform-admin/plans/${plan.id}/prices`,
      method: "POST",
      successMessage: "新价格版本已创建。",
      body: (key) => ({
        billingCycle: String(form.get("billingCycle")),
        priceCents: yuanToCents(String(form.get("priceYuan"))),
        currency: "CNY",
        effectiveFrom: toIso(String(form.get("effectiveFrom"))),
        expectedUpdatedAt: plan.updatedAt,
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
        新增价格
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title={`新增价格版本 · ${plan.name}`}
        description="新价格按生效时间参与后续计费，历史订单金额保持不变。"
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
              form={`create-price-${plan.id}`}
              disabled={action.submitting || !reason.trim()}
            >
              创建价格版本
            </Button>
          </>
        }
      >
        <form
          id={`create-price-${plan.id}`}
          className="space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <ActionSelectField
            label="计费周期"
            name="billingCycle"
            defaultValue="monthly"
            options={[
              ["monthly", "月付"],
              ["annual", "年付"],
            ]}
          />
          <ActionField
            label="新价格（元）"
            name="priceYuan"
            type="number"
            min="0"
            step="0.01"
            required
          />
          <ActionField
            label="生效时间"
            name="effectiveFrom"
            type="datetime-local"
            required
          />
          <ActionField
            label="调整原因"
            name="reason"
            value={reason}
            onChange={setReason}
            required
          />
        </form>
      </PlatformAdminActionDialog>
    </>
  );
}

export function CostVersionAction({
  planId,
  planName,
  expectedUpdatedAt,
  onSuccess,
}: {
  planId: string;
  planName: string;
  expectedUpdatedAt: string;
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
    const effectiveTo = String(form.get("effectiveTo") ?? "");
    await action.submit({
      url: `/api/platform-admin/plans/${planId}/cost-versions`,
      method: "POST",
      successMessage: "新成本版本已创建，盈利估算将按生效期重算。",
      body: (key) => ({
        effectiveFrom: toIso(String(form.get("effectiveFrom"))),
        effectiveTo: effectiveTo ? toIso(effectiveTo) : null,
        fixedCostCents: yuanToCents(String(form.get("fixedCostYuan"))),
        perSeatCostCents: yuanToCents(String(form.get("perSeatCostYuan"))),
        perActiveStreamerCostCents: yuanToCents(
          String(form.get("perActiveStreamerCostYuan")),
        ),
        metricUnitCosts: {
          ocr: Number(form.get("ocrCostFen")),
          ai: Number(form.get("aiCostFen")),
          storage_mb: Number(form.get("storageCostFen")),
          export: Number(form.get("exportCostFen")),
        },
        expectedUpdatedAt,
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
        新增成本版本
      </Button>
      <PlatformAdminActionDialog
        open={open}
        title={`新增成本版本 · ${planName}`}
        description="标准成本只用于内部盈利估算，不会改变客户账单或主播结算。"
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
              form={`create-cost-${planId}`}
              disabled={action.submitting || !reason.trim()}
            >
              创建成本版本
            </Button>
          </>
        }
      >
        <form
          id={`create-cost-${planId}`}
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => void submit(event)}
        >
          <ActionField
            label="生效时间"
            name="effectiveFrom"
            type="datetime-local"
            required
          />
          <ActionField
            label="失效时间（可选）"
            name="effectiveTo"
            type="datetime-local"
          />
          <ActionField
            label="固定成本（元）"
            name="fixedCostYuan"
            type="number"
            min="0"
            step="0.01"
            required
          />
          <ActionField
            label="每席位成本（元）"
            name="perSeatCostYuan"
            type="number"
            min="0"
            step="0.01"
            required
          />
          <ActionField
            label="每活跃主播成本（元）"
            name="perActiveStreamerCostYuan"
            type="number"
            min="0"
            step="0.01"
            required
          />
          <ActionField
            label="OCR 单位成本（分）"
            name="ocrCostFen"
            type="number"
            min="0"
            required
          />
          <ActionField
            label="AI 单位成本（分）"
            name="aiCostFen"
            type="number"
            min="0"
            required
          />
          <ActionField
            label="存储单位成本（分）"
            name="storageCostFen"
            type="number"
            min="0"
            required
          />
          <ActionField
            label="导出单位成本（分）"
            name="exportCostFen"
            type="number"
            min="0"
            required
          />
          <div className="sm:col-span-2">
            <ActionField
              label="调整原因"
              name="reason"
              value={reason}
              onChange={setReason}
              required
            />
          </div>
        </form>
      </PlatformAdminActionDialog>
    </>
  );
}
