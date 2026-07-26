import { z } from "zod";

import { createPlatformOrganization } from "@/features/platform-admin/platform-admin-organization-service";
import { listPlatformOrganizations } from "@/features/platform-admin/platform-admin-read-service";

import {
  createPlatformOrganizationAuthAdmin,
  platformMutationErrorResponse,
} from "../mutation-route-utils";
import { getPlatformAdminRouteContext } from "../route-context";
import {
  contextFailureResponse,
  invalidQueryResponse,
  optionalParam,
  optionalText,
  pageFields,
  parsePeriod,
  unexpectedReadErrorResponse,
} from "../route-utils";

const querySchema = z.object({
  ...pageFields,
  search: optionalText,
  lifecycleStatus: z.enum(["active", "frozen", "archived"]).optional(),
  planId: optionalText,
  expiry: z.enum(["expired", "within7Days", "within30Days"]).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(80),
  primaryEmail: z.email(),
  primaryName: z.string().trim().min(1).max(120),
  primaryPassword: z.string().min(8).max(128),
  planId: z.string().uuid(),
  billingCycle: z.enum(["monthly", "annual"]),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  offlinePayment: z
    .object({
      amountCents: z.number().int().nonnegative(),
      currency: z.string().trim().min(3).max(3).optional(),
      provider: z.string().trim().min(1).max(60).optional(),
      providerTransactionId: z.string().trim().min(1).max(160).optional(),
      paidAt: z.iso.datetime().optional(),
    })
    .nullable(),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().trim().min(1).max(160),
});

export async function GET(request: Request) {
  const context = await getPlatformAdminRouteContext();
  if (!context.ok) {
    return contextFailureResponse(context.status);
  }

  try {
    const searchParams = new URL(request.url).searchParams;
    const query = querySchema.parse({
      page: optionalParam(searchParams, "page"),
      pageSize: optionalParam(searchParams, "pageSize"),
      search: optionalParam(searchParams, "search"),
      lifecycleStatus: optionalParam(searchParams, "lifecycleStatus"),
      planId: optionalParam(searchParams, "planId"),
      expiry: optionalParam(searchParams, "expiry"),
    });
    const result = await listPlatformOrganizations({
      repo: context.repo,
      query: {
        ...query,
        period: parsePeriod(searchParams),
      },
    });
    return Response.json({ data: result.items, meta: result.meta });
  } catch (error) {
    return error instanceof Error && error.name === "ZodError"
      ? invalidQueryResponse()
      : unexpectedReadErrorResponse();
  }
}

export async function POST(request: Request) {
  const context = await getPlatformAdminRouteContext();
  if (!context.ok) {
    return contextFailureResponse(context.status);
  }

  try {
    const command = createSchema.parse(await request.json());
    const data = await createPlatformOrganization({
      repo: context.mutationRepo,
      authAdmin: createPlatformOrganizationAuthAdmin(context.admin),
      actor: context.actor,
      command,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return platformMutationErrorResponse(error);
  }
}
