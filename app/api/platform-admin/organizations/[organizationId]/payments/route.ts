import { z } from "zod";

import { recordPlatformOfflinePayment } from "@/features/platform-admin/platform-admin-payment-service";

import { platformMutationErrorResponse } from "../../../mutation-route-utils";
import { getPlatformAdminRouteContext } from "../../../route-context";
import { contextFailureResponse } from "../../../route-utils";

const paramsSchema = z.object({
  organizationId: z.string().trim().min(1).max(120),
});

const bodySchema = z
  .object({
    purpose: z.enum([
      "subscription_new",
      "subscription_renewal",
      "subscription_upgrade",
      "subscription_downgrade",
    ]),
    planId: z.string().uuid(),
    billingCycle: z.enum(["monthly", "annual"]),
    amountCents: z.number().int().positive(),
    currency: z.string().trim().length(3),
    receivedAt: z.iso.datetime(),
    externalReference: z.string().trim().min(1).max(160),
    channel: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().trim().min(1).max(160),
  })
  .strict();

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
    const result = await recordPlatformOfflinePayment({
      repo: context.paymentRepo,
      actor: context.actor,
      organizationId,
      command,
    });
    const { traceId, ...data } = result;
    return Response.json({ data, traceId }, { status: 201 });
  } catch (error) {
    return platformMutationErrorResponse(error);
  }
}
