import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { RouteError } from "@/lib/http/route-input";
import { sendNotification } from "@/lib/notify/notify";

import {
  getStreamerIdForUser,
  SupabaseLiveOperationsRepository,
} from "./live-operations-repository";

export {
  RouteError,
  jsonError,
  readJsonBody,
  optionalString,
  requiredString,
  optionalNumber,
  optionalBoolean,
} from "@/lib/http/route-input";

export type LiveOperationsRouteContext = {
  supabase: SupabaseClient;
  auth: AuthContext;
  repo: SupabaseLiveOperationsRepository;
  audit: typeof writeAuditLog;
  notify: typeof sendNotification;
};

export async function getLiveOperationsRouteContext(): Promise<LiveOperationsRouteContext> {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);

  if (!supabase || !auth) {
    throw new RouteError("Unauthorized", 401);
  }

  return {
    supabase,
    auth,
    repo: new SupabaseLiveOperationsRepository(supabase),
    audit: writeAuditLog,
    notify: sendNotification,
  };
}

export async function actorFromContext(
  context: LiveOperationsRouteContext,
  includeStreamerId = false,
) {
  return {
    userId: context.auth.userId,
    name: context.auth.name,
    role: context.auth.role,
    organizationId: context.auth.organizationId,
    streamerId: includeStreamerId
      ? await getStreamerIdForUser(context.supabase, context.auth.userId)
      : null,
  };
}
