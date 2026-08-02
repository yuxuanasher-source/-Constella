import { NextResponse } from "next/server";

import { SupabaseOrganizationBrandRepository } from "@/features/organizations/organization-brand-repository";
import {
  OrganizationBrandService,
  OrganizationBrandServiceError,
  createOrganizationContactCardRequestSchema,
} from "@/features/organizations/organization-brand-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { ValidationError, parseJsonBody } from "@/lib/http/parse-json-body";

export async function GET() {
  const context = await routeContext();
  if (!context) {
    return unauthorized();
  }
  try {
    const contactCards = await context.service.listContactCards(context.auth);
    return NextResponse.json({ contactCards });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const context = await routeContext();
  if (!context) {
    return unauthorized();
  }
  try {
    const input = await parseJsonBody(
      request,
      createOrganizationContactCardRequestSchema,
    );
    const contactCard = await context.service.createContactCard(
      context.auth,
      input,
    );
    return NextResponse.json({ contactCard }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

async function routeContext() {
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
      { error: error.message, code: error.code },
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
