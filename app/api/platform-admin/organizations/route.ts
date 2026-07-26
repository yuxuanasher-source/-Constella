import { z } from "zod";

import { listPlatformOrganizations } from "@/features/platform-admin/platform-admin-read-service";

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
  search: optionalText,
  lifecycleStatus: z.enum(["active", "frozen", "archived"]).optional(),
  planId: optionalText,
  expiry: z.enum(["expired", "within7Days", "within30Days"]).optional(),
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
      search: optionalParam(searchParams, "search"),
      lifecycleStatus: optionalParam(searchParams, "lifecycleStatus"),
      planId: optionalParam(searchParams, "planId"),
      expiry: optionalParam(searchParams, "expiry"),
    });
    const result = await listPlatformOrganizations({
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
