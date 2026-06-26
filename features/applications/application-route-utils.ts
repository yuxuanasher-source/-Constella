import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { optionalString, RouteError } from "@/lib/http/route-input";
import { sendNotification } from "@/lib/notify/notify";

import {
  getStreamerIdForUser,
  SupabaseApplicationRepository,
} from "./application-repository";

export {
  RouteError,
  jsonError,
  readJsonBody,
  optionalString,
  requiredString,
  optionalNumber,
} from "@/lib/http/route-input";

export type AdmissionRouteContext = {
  supabase: SupabaseClient;
  auth: AuthContext;
  repo: SupabaseApplicationRepository;
  audit: typeof writeAuditLog;
  notify: typeof sendNotification;
};

export async function getAdmissionRouteContext(): Promise<AdmissionRouteContext> {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);

  if (!supabase || !auth) {
    throw new RouteError("Unauthorized", 401);
  }

  return {
    supabase,
    auth,
    repo: new SupabaseApplicationRepository(supabase),
    audit: writeAuditLog,
    notify: sendNotification,
  };
}

export function actorFromContext(context: AdmissionRouteContext) {
  return {
    userId: context.auth.userId,
    name: context.auth.name,
    role: context.auth.role,
    organizationId: context.auth.organizationId,
  };
}

export async function resolveStreamerId(
  context: AdmissionRouteContext,
  body: Record<string, unknown>,
): Promise<string> {
  const explicitStreamerId = optionalString(body, "streamerId");
  if (explicitStreamerId) {
    return explicitStreamerId;
  }

  const ownStreamerId = await getStreamerIdForUser(
    context.supabase,
    context.auth.userId,
  );
  if (!ownStreamerId) {
    throw new RouteError("Current user is not bound to a streamer", 400);
  }

  return ownStreamerId;
}
