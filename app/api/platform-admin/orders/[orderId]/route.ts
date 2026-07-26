import { z } from "zod";

import { cancelPlatformOrder } from "@/features/platform-admin/platform-admin-payment-service";

import { platformMutationErrorResponse } from "../../mutation-route-utils";
import { getPlatformAdminRouteContext } from "../../route-context";
import { contextFailureResponse } from "../../route-utils";

const paramsSchema = z.object({
  orderId: z.string().trim().min(1).max(120),
});

const bodySchema = z
  .object({
    action: z.literal("cancel"),
    expectedUpdatedAt: z.iso.datetime(),
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().trim().min(1).max(160),
  })
  .strict();

export async function PATCH(
  request: Request,
  contextInput: { params: Promise<{ orderId: string }> },
) {
  const context = await getPlatformAdminRouteContext();
  if (!context.ok) {
    return contextFailureResponse(context.status);
  }

  try {
    const { orderId } = paramsSchema.parse(await contextInput.params);
    const parsed = bodySchema.parse(await request.json());
    const data = await cancelPlatformOrder({
      repo: context.paymentRepo,
      actor: context.actor,
      orderId,
      command: {
        expectedUpdatedAt: parsed.expectedUpdatedAt,
        reason: parsed.reason,
        idempotencyKey: parsed.idempotencyKey,
      },
    });
    return Response.json({ data });
  } catch (error) {
    return platformMutationErrorResponse(error);
  }
}
