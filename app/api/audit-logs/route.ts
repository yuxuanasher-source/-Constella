import { NextResponse } from "next/server";

import {
  listAuditCenterEntries,
  type AuditQueryClient,
} from "@/features/audit-center/audit-center-queries";
import { withAuth } from "@/lib/http/route-handler";

export const GET = withAuth(async ({ supabase, auth, request }) => {
  const params = new URL(request.url).searchParams;
  const auditQueryClient = supabase as unknown as AuditQueryClient;
  const entries = await listAuditCenterEntries(
    auditQueryClient,
    {
      userId: auth.userId,
      role: auth.role,
      organizationId: auth.organizationId,
    },
    {
      module: optionalParam(params, "module"),
      action: optionalParam(params, "action"),
      projectId: optionalParam(params, "projectId"),
      highRiskOnly: isTruthy(params.get("highRiskOnly")),
      limit: numberParam(params, "limit"),
    },
  );

  return NextResponse.json({ entries });
});

function optionalParam(
  params: URLSearchParams,
  key: string,
): string | undefined {
  const value = params.get(key)?.trim();
  return value || undefined;
}

function numberParam(params: URLSearchParams, key: string): number | undefined {
  const value = params.get(key);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isTruthy(value: string | null): boolean {
  return value === "1" || value === "true";
}
