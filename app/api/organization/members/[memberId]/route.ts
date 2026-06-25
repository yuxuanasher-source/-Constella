import { NextResponse } from "next/server";

import { SupabaseOrganizationMemberRepository } from "@/features/organizations/organization-repository";
import {
  updateOrganizationMemberRole,
  updateOrganizationMemberStatus,
  type OrganizationMemberStatus,
} from "@/features/organizations/organization-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import type { AppRole } from "@/lib/rbac/roles";

import { organizationMemberRouteErrorMessage } from "../error-messages";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { memberId } = await params;
    const body = (await request.json().catch(() => ({}))) as MemberPatchBody;
    const repo = new SupabaseOrganizationMemberRepository(supabase);
    const audit = (input: Parameters<typeof writeAuditLog>[1]) =>
      writeAuditLog(supabase, input);
    const reason = requiredString(body.reason, "reason");
    const member =
      body.status !== undefined
        ? await updateOrganizationMemberStatus({
            repo,
            audit,
            actor: auth,
            memberId,
            status: body.status as OrganizationMemberStatus,
            reason,
          })
        : await updateOrganizationMemberRole({
            repo,
            audit,
            actor: auth,
            memberId,
            role: body.role as AppRole,
            reason,
          });

    return NextResponse.json({ member });
  } catch (error) {
    return jsonServiceError(error);
  }
}

type MemberPatchBody = {
  role?: unknown;
  status?: unknown;
  reason?: unknown;
};

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }

  return value;
}

function jsonServiceError(error: unknown) {
  if (error instanceof Error) {
    return NextResponse.json(
      { error: organizationMemberRouteErrorMessage(error) },
      { status: statusForServiceError(error) },
    );
  }

  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}
