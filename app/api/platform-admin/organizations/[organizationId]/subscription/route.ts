import { z } from "zod";

import { changePlatformSubscription } from "@/features/platform-admin/platform-admin-billing-service";

import { platformMutationErrorResponse } from "../../../mutation-route-utils";
import { getPlatformAdminRouteContext } from "../../../route-context";
import { contextFailureResponse } from "../../../route-utils";

const paramsSchema = z.object({
  organizationId: z.string().trim().min(1).max(120),
});

const governanceFields = {
  expectedUpdatedAt: z.iso.datetime(),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().trim().min(1).max(160),
};

const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("change_plan"),
      targetPlanId: z.string().uuid(),
      targetBillingCycle: z.enum(["monthly", "annual"]),
      timing: z.enum(["immediate", "next_cycle"]),
      ...governanceFields,
    })
    .strict(),
  z
    .object({
      action: z.literal("renew"),
      periods: z.number().int().min(1).max(120),
      ...governanceFields,
    })
    .strict(),
  z
    .object({
      action: z.literal("extend"),
      periodEnd: z.iso.date(),
      ...governanceFields,
    })
    .strict(),
  z
    .object({
      action: z.enum(["cancel", "restore"]),
      ...governanceFields,
    })
    .strict(),
]);

const bodySchema = z
  .object({
    mode: z.enum(["preview", "apply"]),
    command: commandSchema,
  })
  .strict();

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
    const { mode, command } = bodySchema.parse(await request.json());
    const data = await changePlatformSubscription({
      repo: context.billingRepo,
      actor: context.actor,
      organizationId,
      mode,
      command,
    });
    return Response.json({ data });
  } catch (error) {
    return platformMutationErrorResponse(error);
  }
}
