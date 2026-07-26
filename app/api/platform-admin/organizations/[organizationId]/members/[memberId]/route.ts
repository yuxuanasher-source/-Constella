import { z } from "zod";

import { updatePlatformOrganizationMember } from "@/features/platform-admin/platform-admin-organization-service";
import { appRoles } from "@/lib/rbac/roles";

import {
  createPlatformOrganizationAuthAdmin,
  platformMutationErrorResponse,
} from "../../../../mutation-route-utils";
import { getPlatformAdminRouteContext } from "../../../../route-context";
import { contextFailureResponse } from "../../../../route-utils";

const paramsSchema = z.object({
  organizationId: z.string().trim().min(1).max(120),
  memberId: z.string().trim().min(1).max(120),
});

const bodySchema = z
  .object({
    role: z.enum(appRoles).optional(),
    status: z.enum(["invited", "active", "suspended"]).optional(),
    sendPasswordReset: z.literal(true).optional(),
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().trim().min(1).max(160),
  })
  .superRefine((value, context) => {
    const actionCount = [
      value.role !== undefined,
      value.status !== undefined,
      value.sendPasswordReset === true,
    ].filter(Boolean).length;
    if (actionCount !== 1) {
      context.addIssue({
        code: "custom",
        message: "Exactly one member action is required.",
      });
    }
  });

export async function PATCH(
  request: Request,
  contextInput: {
    params: Promise<{ organizationId: string; memberId: string }>;
  },
) {
  const context = await getPlatformAdminRouteContext();
  if (!context.ok) {
    return contextFailureResponse(context.status);
  }

  try {
    const { organizationId, memberId } = paramsSchema.parse(
      await contextInput.params,
    );
    const command = bodySchema.parse(await request.json());
    const data = await updatePlatformOrganizationMember({
      repo: context.mutationRepo,
      authAdmin: createPlatformOrganizationAuthAdmin(context.admin),
      actor: context.actor,
      organizationId,
      memberId,
      command,
    });
    return Response.json({ data });
  } catch (error) {
    return platformMutationErrorResponse(error);
  }
}
