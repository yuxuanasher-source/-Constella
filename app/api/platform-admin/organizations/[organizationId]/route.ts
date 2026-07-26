import { z } from "zod";

import {
  getPlatformOrganizationDetail,
  PlatformAdminNotFoundError,
} from "@/features/platform-admin/platform-admin-read-service";

import { getPlatformAdminRouteContext } from "../../route-context";
import {
  contextFailureResponse,
  invalidQueryResponse,
  parsePeriod,
  unexpectedReadErrorResponse,
} from "../../route-utils";

const paramsSchema = z.object({
  organizationId: z.string().trim().min(1).max(120),
});

export async function GET(
  request: Request,
  contextInput: { params: Promise<{ organizationId: string }> },
) {
  const context = await getPlatformAdminRouteContext();
  if (!context.ok) {
    return contextFailureResponse(context.status);
  }

  try {
    const { organizationId } = paramsSchema.parse(await contextInput.params);
    const data = await getPlatformOrganizationDetail({
      repo: context.repo,
      organizationId,
      period: parsePeriod(new URL(request.url).searchParams),
    });
    return Response.json({ data });
  } catch (error) {
    if (error instanceof PlatformAdminNotFoundError) {
      return Response.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Organization not found.",
          },
        },
        { status: 404 },
      );
    }
    return error instanceof Error && error.name === "ZodError"
      ? invalidQueryResponse()
      : unexpectedReadErrorResponse();
  }
}
