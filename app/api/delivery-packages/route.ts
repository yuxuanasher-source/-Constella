import { NextResponse } from "next/server";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const auth = await getAuthContext(supabase);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isMcnStaff(auth.role)) {
    return NextResponse.json(
      { error: "Only MCN staff can view delivery packages" },
      { status: 403 },
    );
  }

  const projectId = new URL(request.url).searchParams
    .get("projectId")
    ?.trim();
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 },
    );
  }
  const replacement = `/api/projects/${encodeURIComponent(projectId)}/admission-share-boards`;
  return NextResponse.json(
    {
      error: "Vendor delivery packages are retired",
      replacement,
    },
    { status: 410 },
  );
}
