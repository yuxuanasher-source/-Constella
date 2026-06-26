// 撮合论坛 API 公共上下文：鉴权(走 RLS) + 仓储 + 审计闭包 + actor。
// 鉴权沿用 createSupabaseServerClient → getAuthContext；审计 module 固定 "marketplace"。

import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import { SupabaseMarketplaceRepository } from "./marketplace-repository";
import type { AuditFn, MarketplaceActor } from "./marketplace-service";

export class MarketplaceHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type MarketplaceContext = {
  auth: AuthContext;
  repo: SupabaseMarketplaceRepository;
  audit: AuditFn;
  actor: MarketplaceActor;
};

export async function getMarketplaceContext(): Promise<MarketplaceContext> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new MarketplaceHttpError("Unauthorized", 401);
  const auth = await getAuthContext(supabase);
  if (!auth) throw new MarketplaceHttpError("Unauthorized", 401);

  const repo = new SupabaseMarketplaceRepository(supabase);
  const actor: MarketplaceActor = {
    userId: auth.userId,
    name: auth.name,
    role: auth.role,
    organizationId: auth.organizationId,
  };
  const audit: AuditFn = (input) =>
    writeAuditLog(supabase, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      actorName: auth.name,
      actorRole: auth.role,
      action: input.action as Parameters<typeof writeAuditLog>[1]["action"],
      module: "marketplace",
      objectType: input.objectType,
      objectId: input.objectId,
      after: input.after,
      changedFields: input.changedFields,
    });

  return { auth, repo, audit, actor };
}

export function marketplaceError(error: unknown): NextResponse {
  if (error instanceof MarketplaceHttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const status =
    typeof (error as { status?: number })?.status === "number"
      ? (error as { status: number }).status
      : 500;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Unexpected error" },
    { status },
  );
}
