import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseBillingRepo } from "@/features/billing/billing-repo-supabase";
import {
  getPaymentProvider,
  PaymentProviderUnavailableError,
} from "@/features/billing/providers/registry";
import { handleWebhook } from "@/features/billing/webhooks";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

import { POST } from "./route";

vi.mock("@/features/billing/billing-repo-supabase", () => ({
  createSupabaseBillingRepo: vi.fn(),
}));

vi.mock("@/features/billing/providers/registry", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/features/billing/providers/registry")
    >();
  return {
    ...actual,
    getPaymentProvider: vi.fn(),
  };
});

vi.mock("@/features/billing/webhooks", () => ({
  handleWebhook: vi.fn(),
}));

vi.mock("@/lib/audit/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const provider = {
  name: "mock",
  verifyWebhook: vi.fn(),
};
const repo = { kind: "billing-repo" };
const admin = { kind: "supabase-admin" };

function request({
  body = "{}",
  signature = "signature",
}: {
  body?: string;
  signature?: string;
} = {}) {
  return new Request("http://localhost/api/billing/webhooks/mock", {
    method: "POST",
    headers: { "x-billing-signature": signature },
    body,
  });
}

function context(providerName = "mock") {
  return { params: Promise.resolve({ provider: providerName }) };
}

describe("billing webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
    vi.mocked(createSupabaseBillingRepo).mockReturnValue(repo as never);
    vi.mocked(getPaymentProvider).mockReturnValue(provider as never);
    vi.mocked(handleWebhook).mockResolvedValue({
      processed: true,
      orderId: "order-1",
    });
    vi.mocked(writeAuditLog).mockResolvedValue(undefined);
  });

  it("preserves 503 when the admin client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await POST(request(), context());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Webhook processing is not configured",
    });
    expect(getPaymentProvider).not.toHaveBeenCalled();
  });

  it("returns a generic 404 when the provider is unavailable", async () => {
    vi.mocked(getPaymentProvider).mockImplementation(() => {
      throw new PaymentProviderUnavailableError();
    });

    const response = await POST(
      request(),
      context("secret-internal-provider"),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      error: "Payment provider unavailable",
    });
    expect(JSON.stringify(body).toLowerCase()).not.toContain(
      "secret-internal-provider",
    );
  });

  it.each(["", "   "])(
    "returns a generic 404 for explicit provider name %j",
    async (providerName) => {
      vi.mocked(getPaymentProvider).mockImplementation(() => {
        throw new PaymentProviderUnavailableError();
      });

      const response = await POST(request(), context(providerName));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "Payment provider unavailable",
      });
      expect(handleWebhook).not.toHaveBeenCalled();
    },
  );

  it("returns a generic 400 for signature verification failure", async () => {
    vi.mocked(handleWebhook).mockResolvedValue({
      processed: false,
      reason: "signature_mismatch",
      verificationFailed: true,
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid webhook",
    });
  });

  it.each([
    "amount_mismatch",
    "provider_mismatch",
    "invalid_provider_transaction",
  ] as const)(
    "acknowledges %s without leaking the reason or order",
    async (reason) => {
      vi.mocked(handleWebhook).mockResolvedValue({
        processed: false,
        reason,
        orderId: "secret-order-id",
      });

      const response = await POST(request(), context());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ processed: false });
    },
  );

  it("returns a generic 500 for unexpected failures", async () => {
    const rawBody = "super-secret-raw-body";
    const signature = "super-secret-signature";
    const secretConfig = "super-secret-provider-config";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(handleWebhook).mockRejectedValue(
      new Error(`database password leaked ${secretConfig}`),
    );

    try {
      const response = await POST(
        request({ body: rawBody, signature }),
        context(),
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Webhook processing failed",
      });
      expect(errorLog).toHaveBeenCalledWith("Billing webhook processing failed", {
        category: "unexpected_error",
      });
      const serializedLog = JSON.stringify(errorLog.mock.calls);
      expect(serializedLog).not.toContain(rawBody);
      expect(serializedLog).not.toContain(signature);
      expect(serializedLog).not.toContain(secretConfig);
      expect(serializedLog).not.toContain("database password leaked");
    } finally {
      errorLog.mockRestore();
    }
  });
});
