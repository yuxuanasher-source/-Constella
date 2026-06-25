import { NextResponse } from "next/server";

import { SupabaseOrganizationMemberRepository } from "@/features/organizations/organization-repository";
import {
  createOrganizationMember,
  listOrganizationMembers,
  type OrganizationAuthAdmin,
} from "@/features/organizations/organization-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import {
  canViewOrganizationMembers,
  getCreatableOrganizationMemberRoles,
} from "@/lib/rbac/permissions";
import type { AppRole } from "@/lib/rbac/roles";

import { organizationMemberRouteErrorMessage } from "./error-messages";

export async function GET() {
  try {
    const context = await getOrganizationRouteContext();
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const creatableRoles = getCreatableOrganizationMemberRoles(
      context.auth.role,
    );
    const canViewMembers = canViewOrganizationMembers(context.auth.role);
    const members = canViewMembers
      ? await listOrganizationMembers({
          repo: new SupabaseOrganizationMemberRepository(context.supabase),
          actor: context.auth,
        })
      : [];

    return NextResponse.json({
      members,
      organization: {
        id: context.auth.organizationId,
        name: context.auth.organizationName,
      },
      permissions: {
        actorRole: context.auth.role,
        canViewMembers,
        canCreateMembers: creatableRoles.length > 0,
        creatableRoles,
      },
    });
  } catch (error) {
    return jsonServiceError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getOrganizationRouteContext();
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createSupabaseAdminClient();
    const authAdmin = admin?.auth.admin as OrganizationAuthAdmin | undefined;
    if (!admin || !authAdmin) {
      return NextResponse.json(
        { error: "Organization admin client is not configured" },
        { status: 500 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as MemberPostBody;
    const mode = requiredMode(body.mode);
    const result = await createOrganizationMember({
      repo: new SupabaseOrganizationMemberRepository(admin),
      authAdmin,
      audit: (input) => writeAuditLog(admin, input),
      actor: context.auth,
      input: {
        mode,
        email:
          mode === "invite"
            ? requiredString(body.email, "email")
            : optionalString(body.email),
        name: requiredString(body.name, "name"),
        role: body.role as AppRole,
        temporaryPassword: optionalString(body.temporaryPassword),
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonServiceError(error);
  }
}

type MemberPostBody = {
  mode?: "invite" | "subaccount";
  email?: unknown;
  name?: unknown;
  role?: unknown;
  temporaryPassword?: unknown;
};

async function getOrganizationRouteContext() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return null;
  }

  const auth = await getAuthContext(supabase);
  if (!auth) {
    return null;
  }

  return { supabase, auth };
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }

  return value;
}

function requiredMode(value: unknown): "invite" | "subaccount" {
  if (value !== "invite" && value !== "subaccount") {
    throw new Error("mode is required");
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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
