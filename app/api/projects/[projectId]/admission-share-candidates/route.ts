import { NextResponse } from "next/server";

import {
  listAdmissionShareCandidates,
  SupabaseAdmissionShareCandidateRepository,
} from "@/features/applications/admission-share-candidates";
import {
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const context = await getAdmissionRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError("Only MCN staff can view share candidates", 403);
    }

    const admin = createSupabaseAdminClient();
    if (!admin) {
      throw new RouteError("Share candidate service is unavailable", 503);
    }
    const repo = new SupabaseAdmissionShareCandidateRepository(admin);
    const candidates = await listAdmissionShareCandidates(repo, {
      projectId,
      organizationId: context.auth.organizationId,
    });

    return NextResponse.json({ candidates });
  } catch (error) {
    return jsonError(error);
  }
}
