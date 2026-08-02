import { NextResponse } from "next/server";
import { z } from "zod";

import { SupabaseOrganizationBrandRepository } from "@/features/organizations/organization-brand-repository";
import {
  OrganizationBrandService,
  OrganizationBrandServiceError,
  emergencyRemoveContactCardRequestSchema,
} from "@/features/organizations/organization-brand-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { ValidationError, parseJsonBody } from "@/lib/http/parse-json-body";

const cardIdSchema = z.uuid();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cardId: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const auth = supabase ? await getAuthContext(supabase) : null;
  if (!supabase || !auth) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  try {
    const { cardId } = await params;
    const idResult = cardIdSchema.safeParse(cardId);
    if (!idResult.success) {
      throw new ValidationError("Invalid contact card id");
    }
    const input = await parseJsonBody(
      request,
      emergencyRemoveContactCardRequestSchema,
    );
    const service = new OrganizationBrandService(
      new SupabaseOrganizationBrandRepository(supabase),
      (auditInput) => writeAuditLog(supabase, auditInput),
    );
    return NextResponse.json(
      await service.emergencyRemoveContactCard(auth, idResult.data, input),
    );
  } catch (error) {
    return errorResponse(error);
  }
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
