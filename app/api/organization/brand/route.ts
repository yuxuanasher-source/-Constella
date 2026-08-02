import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { ValidationError, parseJsonBody } from "@/lib/http/parse-json-body";
import { SupabaseOrganizationBrandRepository } from "@/features/organizations/organization-brand-repository";
import {
  OrganizationBrandService,
  OrganizationBrandServiceError,
  organizationBrandDraftRequestSchema,
} from "@/features/organizations/organization-brand-service";

export async function GET() {
  const context = await routeContext();
  if (!context) {
    return unauthorized();
  }

  try {
    const studio = await context.service.getOrganizationBrandStudio(
      context.auth,
    );
    return NextResponse.json({ studio });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const context = await routeContext();
  if (!context) {
    return unauthorized();
  }

  try {
    const input = await parseJsonBody(
      request,
      organizationBrandDraftRequestSchema,
    );
    const draft = await context.service.saveBrandDraft(context.auth, input);
    return NextResponse.json({ draft });
  } catch (error) {
    return errorResponse(error);
  }
}

async function routeContext(): Promise<{
  auth: AuthContext;
  service: OrganizationBrandService;
} | null> {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;
  if (!supabase || !auth) {
    return null;
  }
  return {
    auth,
    service: new OrganizationBrandService(
      new SupabaseOrganizationBrandRepository(supabase),
      (input) => writeAuditLog(supabase, input),
    ),
  };
}

function unauthorized() {
  return NextResponse.json(
    { error: "Unauthorized", code: "UNAUTHORIZED" },
    { status: 401 },
  );
}

function errorResponse(error: unknown) {
  if (error instanceof OrganizationBrandServiceError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.latestVersion !== undefined
          ? { latestVersion: error.latestVersion }
          : {}),
      },
      { status: error.status },
    );
  }
  if (error instanceof ValidationError) {
    return NextResponse.json(
      { error: error.message, code: "ORGANIZATION_BRAND_INVALID_INPUT" },
      { status: 400 },
    );
  }
  return NextResponse.json(
    {
      error: "Organization brand service is unavailable",
      code: "ORGANIZATION_BRAND_UNAVAILABLE",
    },
    { status: 503 },
  );
}
