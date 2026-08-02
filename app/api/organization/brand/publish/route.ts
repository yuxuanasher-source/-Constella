import { NextResponse } from "next/server";

import { SupabaseOrganizationBrandRepository } from "@/features/organizations/organization-brand-repository";
import {
  OrganizationBrandService,
  OrganizationBrandServiceError,
  organizationBrandPublishRequestSchema,
} from "@/features/organizations/organization-brand-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { ValidationError, parseJsonBody } from "@/lib/http/parse-json-body";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;
  if (!supabase || !auth) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  try {
    const input = await parseJsonBody(
      request,
      organizationBrandPublishRequestSchema,
    );
    const service = new OrganizationBrandService(
      new SupabaseOrganizationBrandRepository(supabase),
      (auditInput) => writeAuditLog(supabase, auditInput),
    );
    return NextResponse.json(await service.publishBrand(auth, input));
  } catch (error) {
    return errorResponse(error);
  }
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
