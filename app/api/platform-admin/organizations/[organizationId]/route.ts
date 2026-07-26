import { z } from "zod";

import {
  setPlatformOrganizationLifecycle,
  updatePlatformOrganizationIdentity,
} from "@/features/platform-admin/platform-admin-organization-service";
import {
  getPlatformOrganizationDetail,
  PlatformAdminNotFoundError,
} from "@/features/platform-admin/platform-admin-read-service";

import { platformMutationErrorResponse } from "../../mutation-route-utils";
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

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    code: z.string().trim().min(1).max(80).optional(),
    lifecycleStatus: z.enum(["active", "frozen", "archived"]).optional(),
    expectedUpdatedAt: z.iso.datetime(),
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().trim().min(1).max(160),
  })
  .superRefine((value, context) => {
    const identityFields = Number(value.name !== undefined) + Number(value.code !== undefined);
    if (
      (value.lifecycleStatus !== undefined && identityFields > 0) ||
      (value.lifecycleStatus === undefined && identityFields === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Choose either lifecycle or identity fields.",
      });
    }
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

export async function PATCH(
  request: Request,
  contextInput: { params: Promise<{ organizationId: string }> },
) {
  const context = await getPlatformAdminRouteContext();
  if (!context.ok) {
    return contextFailureResponse(context.status);
  }

  try {
    const { organizationId } = paramsSchema.parse(await contextInput.params);
    const command = patchSchema.parse(await request.json());
    const base = {
      repo: context.mutationRepo,
      actor: context.actor,
      organizationId,
      expectedUpdatedAt: command.expectedUpdatedAt,
      reason: command.reason,
      idempotencyKey: command.idempotencyKey,
    };
    const data =
      command.lifecycleStatus !== undefined
        ? await setPlatformOrganizationLifecycle({
            ...base,
            status: command.lifecycleStatus,
          })
        : await updatePlatformOrganizationIdentity({
            ...base,
            name: command.name,
            code: command.code,
          });
    return Response.json({ data });
  } catch (error) {
    return platformMutationErrorResponse(error);
  }
}
