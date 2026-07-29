import { NextResponse } from "next/server";

import {
  listAuditCenterEntries,
  type AuditQueryClient,
} from "@/features/audit-center/audit-center-queries";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
        objectType: optionalParam(params, "objectType"),
        objectId: optionalParam(params, "objectId"),
        highRiskOnly: isTruthy(params.get("highRiskOnly")),
        limit: numberParam(params, "limit"),
      },
    );

    return NextResponse.json({ entries });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }

    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

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
