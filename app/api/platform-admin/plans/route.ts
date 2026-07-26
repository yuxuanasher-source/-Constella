import { listPlatformPlans } from "@/features/platform-admin/platform-admin-read-service";

import { getPlatformAdminRouteContext } from "../route-context";
import {
  contextFailureResponse,
  invalidQueryResponse,
  parsePeriod,
  unexpectedReadErrorResponse,
} from "../route-utils";

export async function GET(request: Request) {
  const context = await getPlatformAdminRouteContext();
  if (!context.ok) {
    return contextFailureResponse(context.status);
  }

  try {
    const period = parsePeriod(new URL(request.url).searchParams);
    const data = await listPlatformPlans({
      repo: context.repo,
      period,
    });
    return Response.json({ data });
  } catch (error) {
    return error instanceof Error && error.name === "ZodError"
      ? invalidQueryResponse()
      : unexpectedReadErrorResponse();
  }
}
