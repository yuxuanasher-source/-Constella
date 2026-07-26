import { z } from "zod";

import { getPaymentProvider } from "@/features/billing/providers/registry";
import { refundPlatformOrder } from "@/features/platform-admin/platform-admin-payment-service";

import { platformMutationErrorResponse } from "../../../mutation-route-utils";
import { getPlatformAdminRouteContext } from "../../../route-context";
import { contextFailureResponse } from "../../../route-utils";

const paramsSchema = z.object({
  orderId: z.string().trim().min(1).max(120),
});

const bodySchema = z
  .object({
    amountCents: z.number().int().positive(),
    refundExternalReference: z.string().trim().min(1).max(160),
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().trim().min(1).max(160),
  })
  .strict();

export async function POST(
  request: Request,
  contextInput: { params: Promise<{ orderId: string }> },
) {
  const context = await getPlatformAdminRouteContext();
  if (!context.ok) {
    return contextFailureResponse(context.status);
  }

  try {
    const { orderId } = paramsSchema.parse(await contextInput.params);
    const command = bodySchema.parse(await request.json());
    const result = await refundPlatformOrder({
      repo: context.paymentRepo,
      actor: context.actor,
      orderId,
      command,
      providerResolver: (name) => getPaymentProvider(name),
    });
    const { traceId, ...data } = result;
    return Response.json({ data, traceId });
  } catch (error) {
    return platformMutationErrorResponse(error);
  }
}
