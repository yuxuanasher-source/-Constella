import { z } from "zod";

import { createPlatformCostVersion } from "@/features/platform-admin/platform-admin-billing-service";

import { platformMutationErrorResponse } from "../../../mutation-route-utils";
import { getPlatformAdminRouteContext } from "../../../route-context";
import { contextFailureResponse } from "../../../route-utils";

const paramsSchema = z.object({
  planId: z.string().trim().min(1).max(120),
});

const bodySchema = z
  .object({
    effectiveFrom: z.iso.datetime(),
    effectiveTo: z.iso.datetime().nullable(),
    fixedCostCents: z.number().int().nonnegative(),
    perSeatCostCents: z.number().int().nonnegative(),
    perActiveStreamerCostCents: z.number().int().nonnegative(),
    metricUnitCosts: z.record(
      z.string().min(1).max(80),
      z.number().int().nonnegative(),
    ),
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().trim().min(1).max(160),
  })
  .strict();

export async function POST(
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
    const data = await createPlatformCostVersion({
      repo: context.billingRepo,
      actor: context.actor,
      planId,
      command,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return platformMutationErrorResponse(error);
  }
}
