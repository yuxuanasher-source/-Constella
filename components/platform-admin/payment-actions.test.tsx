import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlatformOrderDto } from "@/features/platform-admin/platform-admin-contracts";

import { PaymentActions } from "./payment-actions";

const order: PlatformOrderDto = {
  id: "order-a",
  organizationId: "org-a",
  organizationName: "安澜传媒",
  kind: "subscription",
  status: "paid",
  amountCents: 29900,
  currency: "CNY",
  planName: "专业版",
  billingCycle: "monthly",
  provider: "offline",
  paidAt: "2026-07-26T08:00:00.000Z",
  createdAt: "2026-07-26T08:00:00.000Z",
  updatedAt: "2026-07-26T08:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("PaymentActions", () => {
  it("requires a governed reason and submits a refund without optimistic totals", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { status: "refunded" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();

    render(<PaymentActions order={order} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole("button", { name: "退款" }));
    fireEvent.change(screen.getByLabelText("退款金额（元）"), {
      target: { value: "99" },
    });
    fireEvent.change(screen.getByLabelText("退款外部流水号"), {
      target: { value: "refund-20260726-01" },
    });
    expect(screen.getByRole("button", { name: "确认退款" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("退款原因"), {
      target: { value: "客户重复付款" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认退款" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(request[1].body as string);
    expect(body).toMatchObject({
      amountCents: 9900,
      refundExternalReference: "refund-20260726-01",
      reason: "客户重复付款",
    });
  });
});
