import { NextResponse } from "next/server";

import { createOcrJob } from "@/features/ai/ocr-jobs";
import {
  RouteError,
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
  optionalString,
  readJsonBody,
  requiredString,
} from "@/features/live-operations/live-operations-route-utils";
import { submitLiveReportScreenshotForOcr } from "@/features/live-operations/live-operations-service";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await readJsonBody(request);
    const screenshotStoragePath = requiredString(body, "screenshotStoragePath");
    const screenshotFileHash = requiredString(body, "screenshotFileHash");
    const imageBucket = optionalString(body, "imageBucket");
    const context = await getLiveOperationsRouteContext();
    const ocrJobClient = createSupabaseAdminClient();
    if (!ocrJobClient) {
      throw new RouteError("Supabase admin client is unavailable", 500);
    }

    const result = await submitLiveReportScreenshotForOcr({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: await actorFromContext(context, true),
      taskId,
      input: {
        screenshotStoragePath,
        screenshotFileHash,
        imageBucket,
      },
      createOcrJob: (input) =>
        createOcrJob({
          client: ocrJobClient as never,
          actor: context.auth,
          input: {
            liveReportId: input.liveReportId,
            screenshotId: input.screenshotId,
            imageBucket: input.imageBucket,
            imagePath: input.imagePath,
            expectedDuration: input.expectedDuration,
          },
        }),
    });

    return NextResponse.json(
      {
        report: result.report,
        job: {
          id: result.job.id,
          status: result.job.status,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
