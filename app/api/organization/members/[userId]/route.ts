import { NextResponse } from "next/server";

import { updateMemberRole } from "@/features/organization/member-service";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

function canManageMembers(role: string) {
  return role === "owner" || role === "ops_manager";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageMembers(auth.role)) {
      return NextResponse.json(
        { error: "当前角色无权调整成员角色" },
        { status: 403 },
      );
    }
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "服务端未配置 service role，无法调整角色" },
        { status: 500 },
      );
    }
    const { userId } = await params;
    const body = (await request.json().catch(() => ({}))) as { role?: string };
    if (!body.role) {
      return NextResponse.json({ error: "缺少角色参数" }, { status: 400 });
    }
    await updateMemberRole({
      admin,
      organizationId: auth.organizationId,
      userId,
      role: body.role,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
