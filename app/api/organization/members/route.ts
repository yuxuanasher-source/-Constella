import { NextResponse } from "next/server";

import { listOrgMembers } from "@/features/organization/member-queries";
import { inviteMember } from "@/features/organization/member-service";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

function canManageMembers(role: string) {
  return role === "owner" || role === "ops_manager";
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const members = await listOrgMembers(supabase, auth.organizationId);
    return NextResponse.json({ members });
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

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageMembers(auth.role)) {
      return NextResponse.json(
        { error: "当前角色无权邀请成员" },
        { status: 403 },
      );
    }
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "服务端未配置 service role，无法邀请成员" },
        { status: 500 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      name?: string;
      role?: string;
    };
    const member = await inviteMember({
      admin,
      organizationId: auth.organizationId,
      email: body.email ?? "",
      name: body.name ?? "",
      role: body.role ?? "operator_business",
    });
    return NextResponse.json({ member });
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
