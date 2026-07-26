import { z } from "zod";

import { listPlatformAudit } from "@/features/platform-admin/platform-admin-read-service";

import { getPlatformAdminRouteContext } from "../route-context";
import {
  contextFailureResponse,
  invalidQueryResponse,
  optionalParam,
  optionalText,
  pageFields,
  parsePeriod,
  unexpectedReadErrorResponse,
} from "../route-utils";

const querySchema = z.object({
  ...pageFields,
  organizationId: optionalText,
  action: optionalText,
  result: z.enum(["success", "failure"]).optional(),
});

export async function GET(request: Request) {
  const context = await getPlatformAdminRouteContext();
  if (!context.ok) {
    return contextFailureResponse(context.status);
  }

  try {
    const searchParams = new URL(request.url).searchParams;
    const query = querySchema.parse({
      page: optionalParam(searchParams, "page"),
      pageSize: optionalParam(searchParams, "pageSize"),
      organizationId: optionalParam(searchParams, "organizationId"),
      action: optionalParam(searchParams, "action"),
      result: optionalParam(searchParams, "result"),
    });
    const result = await listPlatformAudit({
      repo: context.repo,
      query: {
        ...query,
        period: parsePeriod(searchParams),
      },
    });
    return Response.json({ data: result.items, meta: result.meta });
  } catch (error) {
    return error instanceof Error && error.name === "ZodError"
      ? invalidQueryResponse()
      : unexpectedReadErrorResponse();
  }
}
