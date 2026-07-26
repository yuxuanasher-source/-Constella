import { z } from "zod";

import { createPlatformOrganizationMember } from "@/features/platform-admin/platform-admin-organization-service";
import { appRoles } from "@/lib/rbac/roles";

import {
  createPlatformOrganizationAuthAdmin,
  platformMutationErrorResponse,
} from "../../../mutation-route-utils";
import { getPlatformAdminRouteContext } from "../../../route-context";
import { contextFailureResponse } from "../../../route-utils";

const paramsSchema = z.object({
  organizationId: z.string().trim().min(1).max(120),
});

const bodySchema = z
  .object({
    mode: z.enum(["invite", "subaccount"]),
    email: z.email().optional(),
    name: z.string().trim().min(1).max(120),
    role: z.enum(appRoles),
    temporaryPassword: z.string().min(8).max(128).optional(),
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().trim().min(1).max(160),
  })
  .superRefine((value, context) => {
    if (value.mode === "invite" && !value.email) {
      context.addIssue({
        code: "custom",
        path: ["email"],
        message: "Invite email is required.",
      });
    }
  });

export async function POST(
  request: Request,
  contextInput: { params: Promise<{ organizationId: string }> },
) {
  const context = await getPlatformAdminRouteContext();
  if (!context.ok) {
    return contextFailureResponse(context.status);
  }

  try {
    const { organizationId } = paramsSchema.parse(await contextInput.params);
    const command = bodySchema.parse(await request.json());
    const data = await createPlatformOrganizationMember({
      repo: context.mutationRepo,
      authAdmin: createPlatformOrganizationAuthAdmin(context.admin),
      actor: context.actor,
      organizationId,
      command,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return platformMutationErrorResponse(error);
  }
}
