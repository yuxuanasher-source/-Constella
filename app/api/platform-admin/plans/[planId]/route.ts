import { z } from "zod";

import { updatePlatformPlan } from "@/features/platform-admin/platform-admin-billing-service";

import { platformMutationErrorResponse } from "../../mutation-route-utils";
import { getPlatformAdminRouteContext } from "../../route-context";
import { contextFailureResponse } from "../../route-utils";

const paramsSchema = z.object({
  planId: z.string().trim().min(1).max(120),
});

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    features: z.record(z.string().min(1).max(80), z.boolean()).optional(),
    included: z
      .object({
        activeStreamers: z.number().int().nonnegative().optional(),
        seats: z.number().int().nonnegative().optional(),
        ocr: z.number().int().nonnegative().optional(),
        ai: z.number().int().nonnegative().optional(),
        storageMb: z.number().int().nonnegative().optional(),
        exports: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    expectedUpdatedAt: z.iso.datetime(),
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().trim().min(1).max(160),
  })
  .strict();

export async function PATCH(
  request: Request,
  contextInput: { params: Promise<{ planId: string }> },
) {
  const context = await getPlatformAdminRouteContext();
  if (!context.ok) {
    return contextFailureResponse(context.status);
  }

  try {
    const { planId } = paramsSchema.parse(await contextInput.params);
    const command = bodySchema.parse(await request.json());
    const data = await updatePlatformPlan({
      repo: context.billingRepo,
      actor: context.actor,
      planId,
      command,
    });
    return Response.json({ data });
  } catch (error) {
    return platformMutationErrorResponse(error);
  }
}
