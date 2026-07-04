import { NextResponse } from "next/server";

import { kickQueuedOcrJobsInProcess } from "@/features/ai/ocr-instant-run";
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
import { scheduleInstantKick } from "@/lib/http/schedule-instant-kick";

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
    const collaborationId = optionalString(body, "collaborationId");
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
        collaborationId,
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

    // 入队成功后立即在本进程内以 OCR_RUNNER_* 身份 claim+run，消除等 cron
    // 的调度延迟；本次请求恰好创建 1 个 job，故 limit = 1。kick 自带并发
    // 闸门与全链路降级（闸门满/env 未配置/admin client 不可用 → 跳过留给
    // cron，异常 → 只记日志），scheduleInstantKick 再兜一层，保证任何 kick
    // 异常都不影响 201 入队响应。
    scheduleInstantKick("ocr", () => kickQueuedOcrJobsInProcess({ limit: 1 }));

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
