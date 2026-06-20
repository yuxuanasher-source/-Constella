import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAuditLog } from "@/lib/audit/audit";

import type { BillingActor } from "./billing-write-guard";

export type InvoiceType = "vat_normal" | "vat_special";
export type InvoiceRequestStatus =
  | "submitted"
  | "issuing"
  | "issued"
  | "rejected"
  | "cancelled";

export type InvoiceRequestInput = {
  invoiceType: InvoiceType;
  title: string;
  taxNo?: string;
  orderIds: string[];
  contactEmail: string;
  extra?: Record<string, unknown>;
};

export type SafeInvoiceRequest = {
  id: string;
  status: InvoiceRequestStatus;
  invoiceType: InvoiceType;
  title: string;
  amountCents: number;
  orderIds: string[];
  contactEmail: string;
  createdAt: string;
};

type InvoiceRequestRow = {
  id: string;
  status: InvoiceRequestStatus;
  invoice_type: InvoiceType;
  title: string;
  amount_cents: number;
  order_ids: string[];
  contact_email: string;
  created_at: string;
};

const REQUEST_COLUMNS =
  "id, status, invoice_type, title, amount_cents, order_ids, contact_email, created_at";

/**
 * 提交发票申请。金额由服务端按关联的**已支付**订单汇总，前端不可传金额。
 * 一张发票可覆盖多个订单。
 */
export async function submitInvoiceRequest({
  client,
  actor,
  input,
}: {
  client: SupabaseClient;
  actor: BillingActor;
  input: InvoiceRequestInput;
}): Promise<SafeInvoiceRequest> {
  if (!input.title?.trim()) {
    throw new Error("Invoice title is required");
  }
  if (!input.contactEmail?.trim()) {
    throw new Error("Contact email is required");
  }
  if (!input.orderIds || input.orderIds.length === 0) {
    throw new Error("At least one paid order is required");
  }
  if (input.invoiceType === "vat_special" && !input.taxNo?.trim()) {
    throw new Error("Special VAT invoices require a tax number");
  }

  const { data: orders, error: ordersError } = await client
    .from("billing_orders")
    .select("id, status, amount_cents")
    .eq("organization_id", actor.organizationId)
    .in("id", input.orderIds)
    .returns<{ id: string; status: string; amount_cents: number }[]>();
  if (ordersError) {
    throw ordersError;
  }

  if ((orders ?? []).length !== input.orderIds.length) {
    throw new Error("Some orders were not found for this organization");
  }
  if ((orders ?? []).some((order) => order.status !== "paid")) {
    throw new Error("All referenced orders must be paid");
  }
  const amountCents = (orders ?? []).reduce(
    (sum, order) => sum + order.amount_cents,
    0,
  );

  const { data, error } = await client
    .from("invoice_requests")
    .insert({
      organization_id: actor.organizationId,
      status: "submitted",
      invoice_type: input.invoiceType,
      title: input.title.trim(),
      tax_no: input.taxNo?.trim() ?? null,
      amount_cents: amountCents,
      order_ids: input.orderIds,
      contact_email: input.contactEmail.trim(),
      extra: input.extra ?? {},
    })
    .select(REQUEST_COLUMNS)
    .single<InvoiceRequestRow>();
  if (error) {
    throw error;
  }

  await writeAuditLog(client, {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "billing",
    objectType: "invoice_request",
    objectId: data.id,
    after: { amountCents, orderCount: input.orderIds.length },
    changedFields: ["status", "amount_cents"],
  });

  return toSafeRequest(data);
}

export async function listInvoiceRequests({
  client,
  organizationId,
}: {
  client: SupabaseClient;
  organizationId: string;
}): Promise<SafeInvoiceRequest[]> {
  const { data, error } = await client
    .from("invoice_requests")
    .select(REQUEST_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .returns<InvoiceRequestRow[]>();
  if (error) {
    throw error;
  }
  return (data ?? []).map(toSafeRequest);
}

/**
 * 开具发票（平台财务后台 / service-role）。把申请置为 issued 并写入 invoices。
 * 首版人工开票；自动开票（航信 / 百望）后续接入。
 */
export async function issueInvoice({
  client,
  reviewerId,
  requestId,
  invoiceNo,
  filePath,
  now = new Date(),
}: {
  client: SupabaseClient;
  reviewerId?: string;
  requestId: string;
  invoiceNo: string;
  filePath?: string;
  now?: Date;
}): Promise<{ invoiceNo: string }> {
  const { data: request, error: requestError } = await client
    .from("invoice_requests")
    .select("id, organization_id, status, amount_cents")
    .eq("id", requestId)
    .maybeSingle<{
      id: string;
      organization_id: string;
      status: InvoiceRequestStatus;
      amount_cents: number;
    }>();
  if (requestError) {
    throw requestError;
  }
  if (!request) {
    throw new Error("Invoice request not found");
  }
  if (request.status === "issued") {
    throw new Error("Invoice request already issued");
  }

  const { error: updateError } = await client
    .from("invoice_requests")
    .update({
      status: "issued",
      reviewed_by: reviewerId ?? null,
      reviewed_at: now.toISOString(),
    })
    .eq("id", requestId);
  if (updateError) {
    throw updateError;
  }

  const { error: insertError } = await client.from("invoices").insert({
    organization_id: request.organization_id,
    request_id: request.id,
    invoice_no: invoiceNo,
    amount_cents: request.amount_cents,
    file_path: filePath ?? null,
  });
  if (insertError) {
    throw insertError;
  }

  return { invoiceNo };
}

function toSafeRequest(row: InvoiceRequestRow): SafeInvoiceRequest {
  return {
    id: row.id,
    status: row.status,
    invoiceType: row.invoice_type,
    title: row.title,
    amountCents: row.amount_cents,
    orderIds: row.order_ids ?? [],
    contactEmail: row.contact_email,
    createdAt: row.created_at,
  };
}
