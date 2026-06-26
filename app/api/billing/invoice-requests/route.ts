import { NextResponse } from "next/server";

import {
  listInvoiceRequests,
  submitInvoiceRequest,
  type InvoiceType,
} from "@/features/billing/invoices";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET() {
  try {
    const ctx = await requireAuth();
    if (ctx.response) {
      return ctx.response;
    }
    if (!isMcnStaff(ctx.auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can view invoice requests" },
        { status: 403 },
      );
    }

    const requests = await listInvoiceRequests({
      client: ctx.supabase,
      organizationId: ctx.auth.organizationId,
    });
    return NextResponse.json({ requests });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth();
    if (ctx.response) {
      return ctx.response;
    }
    if (ctx.auth.role !== "owner" && ctx.auth.role !== "ops_manager") {
      return NextResponse.json(
        { error: "Only owner and ops_manager can submit invoice requests" },
        { status: 403 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const result = await submitInvoiceRequest({
      client: ctx.supabase,
      actor: ctx.auth,
      input: {
        invoiceType: parseInvoiceType(body.invoiceType),
        title: typeof body.title === "string" ? body.title : "",
        taxNo: typeof body.taxNo === "string" ? body.taxNo : undefined,
        orderIds: Array.isArray(body.orderIds)
          ? body.orderIds.filter((id): id is string => typeof id === "string")
          : [],
        contactEmail: typeof body.contactEmail === "string" ? body.contactEmail : "",
        extra:
          body.extra && typeof body.extra === "object"
            ? (body.extra as Record<string, unknown>)
            : undefined,
      },
    });
    return NextResponse.json({ request: result });
  } catch (error) {
    return errorResponse(error);
  }
}

async function requireAuth() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const auth = await getAuthContext(supabase);
  if (!auth) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { auth, supabase };
}

function parseInvoiceType(value: unknown): InvoiceType {
  return value === "vat_special" ? "vat_special" : "vat_normal";
}

function errorResponse(error: unknown) {
  if (error instanceof Error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusForServiceError(error) },
    );
  }
  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}
