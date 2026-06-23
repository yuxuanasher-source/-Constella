import { NextResponse } from "next/server";

import { listProjectCollaborationSubmissions } from "@/features/collaborations/collaboration-queries";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId } = await params;
    const status =
      new URL(request.url).searchParams.get("status")?.trim() || undefined;
    const submissions = await listProjectCollaborationSubmissions(
      supabase,
      projectId,
      status,
    );
    return NextResponse.json({ submissions });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
