import { NextResponse } from "next/server";

import {
  submitProjectCollaborationInviteApplication,
  SupabaseProjectCollaborationRepository,
} from "@/features/collaborations/project-collaboration-service";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  readJsonBody,
  RouteError,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const context = await getAdmissionRouteContext();
    const repoClient = createSupabaseAdminClient();
    if (!repoClient) {
      throw new RouteError("Collaboration service is unavailable", 500);
    }

    const repo = new SupabaseProjectCollaborationRepository(repoClient);
    const result = await submitProjectCollaborationInviteApplication({
      repo,
      actor: actorFromContext(context),
      input: {
        inviteLink: requiredString(body.inviteLink, "inviteLink"),
        requestedRevenueShareBps: optionalNumber(
          body.requestedRevenueShareBps,
          0,
        ),
        applicantNote: optionalString(body.applicantNote),
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

function requiredString(value: unknown, key: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
