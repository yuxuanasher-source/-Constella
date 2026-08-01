import { describe, expect, it, vi } from "vitest";

import { createMemoryBillingRepo } from "./billing-repo-memory";
import { TEST_PAYMENT_WEBHOOK_SECRET } from "./billing-test-fixtures";
import { createMockPaymentProvider } from "./providers/mock-provider";
import { reconcile, runReconciliation } from "./reconciliation";

describe("reconcile", () => {
  it("balances when every txn matches by id and amount", () => {
    const result = reconcile({
      ours: [
        { providerTxnId: "a", amountCents: 100 },
        { providerTxnId: "b", amountCents: 200 },
      ],
      channel: [
        { providerTxnId: "a", amountCents: 100 },
        { providerTxnId: "b", amountCents: 200 },
      ],
    });
    expect(result).toMatchObject({
      status: "balanced",
      matchedCount: 2,
      mismatchedCount: 0,
      expectedAmountCents: 300,
      providerAmountCents: 300,
    });
  });

  it("flags missing and amount-mismatched txns", () => {
    const result = reconcile({
      ours: [
        { providerTxnId: "a", amountCents: 100 },
        { providerTxnId: "b", amountCents: 200 },
      ],
      channel: [
        { providerTxnId: "a", amountCents: 150 },
        { providerTxnId: "c", amountCents: 50 },
      ],
    });
    expect(result.status).toBe("mismatch");
    expect(result.detail.ourOnly).toEqual(["b"]);
    expect(result.detail.channelOnly).toEqual(["c"]);
    expect(result.detail.amountMismatch).toEqual([
      { providerTxnId: "a", ours: 100, channel: 150 },
    ]);
    expect(result.mismatchedCount).toBe(3);
  });
});

describe("runReconciliation", () => {
  async function seedPayment(
    repo: ReturnType<typeof createMemoryBillingRepo>["repo"],
  ) {
    await repo.insertTransaction({
      organizationId: "org-1",
      orderId: "order-1",
      type: "payment",
      status: "succeeded",
      amountCents: 99900,
      provider: "mock",
      providerTxnId: "mock_pay_order-1",
      succeededAt: "2026-06-20T01:00:00.000Z",
    });
  }

  it("persists a balanced reconciliation when the statement matches", async () => {
    const { repo, state } = createMemoryBillingRepo({});
    await seedPayment(repo);
    const provider = createMockPaymentProvider({
      secret: TEST_PAYMENT_WEBHOOK_SECRET,
      statement: [{ providerTxnId: "mock_pay_order-1", amountCents: 99900 }],
    });

    const result = await runReconciliation({
      repo,
      provider,
      date: "2026-06-20",
    });

    expect(result.status).toBe("balanced");
    expect(state.reconciliations.get("2026-06-20:mock")).toEqual({
      status: "balanced",
      mismatchedCount: 0,
    });
  });

  it("alerts and persists a mismatch when the statement is short", async () => {
    const { repo, state } = createMemoryBillingRepo({});
    await seedPayment(repo);
    const provider = createMockPaymentProvider({
      secret: TEST_PAYMENT_WEBHOOK_SECRET,
      statement: [],
    });
    const alert = vi.fn(async () => undefined);

    const result = await runReconciliation({
      repo,
      provider,
      date: "2026-06-20",
      alert,
    });

    expect(result.status).toBe("mismatch");
    expect(result.detail.ourOnly).toEqual(["mock_pay_order-1"]);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(state.reconciliations.get("2026-06-20:mock")?.status).toBe(
      "mismatch",
    );
  });
});
