import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlatformPlanPerformanceDto } from "@/features/platform-admin/platform-admin-contracts";

import { PlanActions } from "./plan-actions";

const plan: PlatformPlanPerformanceDto = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "pro",
  name: "专业版",
  tier: "pro",
  updatedAt: "2026-07-26T08:00:00.000Z",
  included: {
    activeStreamers: 10,
    seats: 5,
    ocr: 1000,
    ai: 500,
    storageMb: 10240,
    exports: 100,
  },
  features: { exports: true },
  monthlyPriceCents: 29900,
  annualPriceCents: 299000,
  activeSubscriptionCount: 3,
  payingOrganizationCount: 3,
  netRevenueCents: 89700,
  standardCostCents: 12000,
  contributionMarginCents: 77700,
};

afterEach(() => vi.unstubAllGlobals());

describe("PlanActions", () => {
  it("creates a governed price version using cents and the plan version", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ data: { id: "price-new" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();

    render(<PlanActions plan={plan} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole("button", { name: "新增价格" }));
    fireEvent.change(screen.getByLabelText("新价格（元）"), {
      target: { value: "399" },
    });
    fireEvent.change(screen.getByLabelText("生效时间"), {
      target: { value: "2026-08-01T08:00" },
    });
    expect(screen.getByRole("button", { name: "创建价格版本" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("调整原因"), {
      target: { value: "年度定价评审" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建价格版本" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(request[1].body as string);
    expect(body.priceCents).toBe(39900);
    expect(body.expectedUpdatedAt).toBe(plan.updatedAt);
    expect(body.reason).toBe("年度定价评审");
  });

  it("collects versioned internal cost inputs separately from customer price", () => {
    render(<PlanActions plan={plan} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "新增成本版本" }));

    expect(screen.getByLabelText("固定成本（元）")).toBeInTheDocument();
    expect(screen.getByLabelText("每席位成本（元）")).toBeInTheDocument();
    expect(screen.getByLabelText("每活跃主播成本（元）")).toBeInTheDocument();
    expect(screen.getByLabelText("OCR 单位成本（分）")).toBeInTheDocument();
    expect(screen.getByText(/不会改变客户账单/)).toBeInTheDocument();
  });
});
