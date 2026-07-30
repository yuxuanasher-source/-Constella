import { NextResponse } from "next/server";

import {
  getAdmissionShareCandidatePlayback,
  SupabaseAdmissionShareCandidateRepository,
} from "@/features/applications/admission-share-candidates";
import {
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { createSignedDownloadUrl } from "@/features/storage/private-upload";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      projectId: string;
      recordingSubmissionId: string;
    }>;
  },
) {
  try {
    const { projectId, recordingSubmissionId } = await params;
    const context = await getAdmissionRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError("Only MCN staff can preview share candidates", 403);
    }

    const repo = new SupabaseAdmissionShareCandidateRepository(
      context.supabase,
    );
    const source = await getAdmissionShareCandidatePlayback(repo, {
      organizationId: context.auth.organizationId,
      projectId,
      recordingSubmissionId,
    });

    if (source.sourceType === "original") {
      const signed = await createSignedDownloadUrl({
        client: context.supabase,
        bucket: getPrivateStorageBucket(),
        path: source.storagePath,
        expiresInSeconds: 3600,
      });
      if (!signed?.signedUrl) {
        throw new RouteError("Recording playback source is unavailable", 404);
      }
      return NextResponse.redirect(signed.signedUrl, 307);
    }

    return NextResponse.redirect(source.url, 307);
  } catch (error) {
    return jsonError(error);
  }
}
