import { z } from "zod";

import { listPlatformUsers } from "@/features/platform-admin/platform-admin-read-service";

import { getPlatformAdminRouteContext } from "../route-context";
import {
  contextFailureResponse,
  invalidQueryResponse,
  optionalParam,
  optionalText,
  pageFields,
  unexpectedReadErrorResponse,
} from "../route-utils";

const querySchema = z.object({
  ...pageFields,
  search: optionalText,
  organizationId: optionalText,
  role: optionalText,
  status: optionalText,
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
      organizationId: optionalParam(searchParams, "organizationId"),
      role: optionalParam(searchParams, "role"),
      status: optionalParam(searchParams, "status"),
    });
    const result = await listPlatformUsers({
      repo: context.repo,
      query,
    });
    return Response.json({ data: result.items, meta: result.meta });
  } catch (error) {
    return error instanceof Error && error.name === "ZodError"
      ? invalidQueryResponse()
      : unexpectedReadErrorResponse();
  }
}
