import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { RouteError } from "@/lib/http/route-input";
import { sendNotification } from "@/lib/notify/notify";

import { SupabaseSettlementRepository } from "./settlement-repository";

export {
  RouteError,
  jsonError,
  readJsonBody,
  optionalString,
  requiredString,
  optionalNumber,
  requiredNumber,
  requiredQueryParam,
} from "@/lib/http/route-input";

export type SettlementRouteContext = {
  supabase: SupabaseClient;
  auth: AuthContext;
  repo: SupabaseSettlementRepository;
  audit: typeof writeAuditLog;
  notify: typeof sendNotification;
};

export async function getSettlementRouteContext(): Promise<SettlementRouteContext> {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);

  if (!supabase || !auth) {
    throw new RouteError("Unauthorized", 401);
  }

  return {
    supabase,
    auth,
    repo: new SupabaseSettlementRepository(supabase),
    audit: writeAuditLog,
    notify: sendNotification,
  };
}

export function settlementActorFromContext(context: SettlementRouteContext) {
  return {
    userId: context.auth.userId,
    name: context.auth.name,
    role: context.auth.role,
    organizationId: context.auth.organizationId,
  };
}
