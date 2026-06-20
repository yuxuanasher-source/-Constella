import { describe, expect, it } from "vitest";

import {
  issueInvoice,
  submitInvoiceRequest,
  type SafeInvoiceRequest,
} from "./invoices";

type FakeOptions = {
  orders?: Array<{ id: string; status: string; amount_cents: number }>;
  insertedRequest?: Record<string, unknown>;
  request?: Record<string, unknown> | null;
};

type Recorded = {
  invoices: Record<string, unknown>[];
  requestUpdates: Record<string, unknown>[];
  audits: Record<string, unknown>[];
};

function makeClient(opts: FakeOptions) {
  const recorded: Recorded = { invoices: [], requestUpdates: [], audits: [] };

  function builder(table: string) {
    const ctx: { table: string; op: string; payload?: unknown } = {
      table,
      op: "select",
    };
    const resolve = (shape: "list" | "single" | "raw") => {
      if (ctx.table === "audit_logs" && ctx.op === "insert") {
        recorded.audits.push(ctx.payload as Record<string, unknown>);
        return { error: null };
      }
      if (ctx.table === "billing_orders") {
        return { data: opts.orders ?? [], error: null };
      }
      if (ctx.table === "invoice_requests" && ctx.op === "insert") {
        return { data: opts.insertedRequest, error: null };
      }
      if (ctx.table === "invoice_requests" && ctx.op === "update") {
        recorded.requestUpdates.push(ctx.payload as Record<string, unknown>);
        return { error: null };
      }
      if (ctx.table === "invoice_requests") {
        return shape === "list"
          ? { data: opts.request ? [opts.request] : [], error: null }
          : { data: opts.request ?? null, error: null };
      }
      if (ctx.table === "invoices" && ctx.op === "insert") {
        recorded.invoices.push(ctx.payload as Record<string, unknown>);
        return { error: null };
      }
      return { data: null, error: null };
    };

    const b = {
      select: () => b,
      insert: (payload: unknown) => {
        ctx.op = "insert";
        ctx.payload = payload;
        return b;
      },
      update: (payload: unknown) => {
        ctx.op = "update";
        ctx.payload = payload;
        return b;
      },
      eq: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      returns: () => Promise.resolve(resolve("list")),
      single: () => Promise.resolve(resolve("single")),
      maybeSingle: () => Promise.resolve(resolve("single")),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve("raw")).then(onF, onR),
    };
    return b;
  }

  return { client: { from: (t: string) => builder(t) }, recorded };
}

const ACTOR = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

describe("submitInvoiceRequest", () => {
  it("sums paid orders server-side and records an audit entry", async () => {
    const { client, recorded } = makeClient({
      orders: [
        { id: "o1", status: "paid", amount_cents: 99900 },
        { id: "o2", status: "paid", amount_cents: 10000 },
      ],
      insertedRequest: {
        id: "req-1",
        status: "submitted",
        invoice_type: "vat_normal",
        title: "示例公司",
        amount_cents: 109900,
        order_ids: ["o1", "o2"],
        contact_email: "a@b.com",
        created_at: "2026-06-20T00:00:00.000Z",
      },
    });

    const result: SafeInvoiceRequest = await submitInvoiceRequest({
      client: client as never,
      actor: ACTOR,
      input: {
        invoiceType: "vat_normal",
        title: "示例公司",
        orderIds: ["o1", "o2"],
        contactEmail: "a@b.com",
      },
    });

    expect(result.amountCents).toBe(109900);
    expect(recorded.audits).toHaveLength(1);
    expect(recorded.audits[0]).toMatchObject({
      module: "billing",
      object_type: "invoice_request",
    });
  });

  it("rejects when a referenced order is not paid", async () => {
    const { client } = makeClient({
      orders: [
        { id: "o1", status: "paid", amount_cents: 99900 },
        { id: "o2", status: "pending", amount_cents: 10000 },
      ],
    });
    await expect(
      submitInvoiceRequest({
        client: client as never,
        actor: ACTOR,
        input: {
          invoiceType: "vat_normal",
          title: "x",
          orderIds: ["o1", "o2"],
          contactEmail: "a@b.com",
        },
      }),
    ).rejects.toThrow(/must be paid/);
  });

  it("requires a tax number for special VAT invoices", async () => {
    const { client } = makeClient({});
    await expect(
      submitInvoiceRequest({
        client: client as never,
        actor: ACTOR,
        input: {
          invoiceType: "vat_special",
          title: "x",
          orderIds: ["o1"],
          contactEmail: "a@b.com",
        },
      }),
    ).rejects.toThrow(/tax number/);
  });
});

describe("issueInvoice", () => {
  it("marks the request issued and writes an invoice", async () => {
    const { client, recorded } = makeClient({
      request: {
        id: "req-1",
        organization_id: "org-1",
        status: "submitted",
        amount_cents: 109900,
      },
    });

    await issueInvoice({
      client: client as never,
      reviewerId: "finance-1",
      requestId: "req-1",
      invoiceNo: "INV-0001",
      filePath: "invoices/req-1.pdf",
    });

    expect(recorded.requestUpdates[0]).toMatchObject({ status: "issued" });
    expect(recorded.invoices[0]).toMatchObject({
      invoice_no: "INV-0001",
      amount_cents: 109900,
    });
  });

  it("refuses to re-issue an already issued request", async () => {
    const { client } = makeClient({
      request: {
        id: "req-1",
        organization_id: "org-1",
        status: "issued",
        amount_cents: 1,
      },
    });
    await expect(
      issueInvoice({
        client: client as never,
        requestId: "req-1",
        invoiceNo: "INV-0002",
      }),
    ).rejects.toThrow(/already issued/);
  });
});
