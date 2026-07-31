import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { createSupabaseBillingRepo } from "@/features/billing/billing-repo-supabase";
import { getPaymentProvider } from "@/features/billing/providers/registry";
import { requestRefund } from "@/features/billing/refunds";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

vi.mock("@/features/billing/billing-repo-supabase", () => ({
  createSupabaseBillingRepo: vi.fn(),
}));

vi.mock("@/features/billing/providers/registry", () => ({
  getPaymentProvider: vi.fn(),
}));

vi.mock("@/features/billing/refunds", () => ({
  requestRefund: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/audit/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/notify/notify", () => ({
  sendNotification: vi.fn(),
}));

const auth = {
  userId: "user-owner",
  email: "owner@example.invalid",
  name: "Owner",
  organizationId: "org-1",
  organizationName: "Organization",
  role: "owner" as const,
};

function refundRequest() {
  return new Request("http://localhost/api/billing/refunds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId: "order-1", reason: "Duplicate charge" }),
  });
}

describe("billing refund route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "authenticated",
    } as never);
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      client: "admin",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(createSupabaseBillingRepo).mockReturnValue({
      repo: "admin-billing",
    } as never);
    vi.mocked(getPaymentProvider).mockReturnValue({ provider: "payment" } as never);
    vi.mocked(requestRefund).mockResolvedValue({ id: "refund-1" } as never);
  });

  it("uses the service-role client for authorized billing mutations", async () => {
    const response = await POST(refundRequest());

    expect(response.status).toBe(200);
    expect(createSupabaseBillingRepo).toHaveBeenCalledWith({ client: "admin" });
    expect(createSupabaseBillingRepo).not.toHaveBeenCalledWith({
      client: "authenticated",
    });
    expect(requestRefund).toHaveBeenCalledWith(
      expect.objectContaining({ repo: { repo: "admin-billing" }, actor: auth }),
    );
  });

  it("fails closed when the service-role client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await POST(refundRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Billing service is unavailable",
    });
    expect(createSupabaseBillingRepo).not.toHaveBeenCalled();
    expect(requestRefund).not.toHaveBeenCalled();
  });
});
