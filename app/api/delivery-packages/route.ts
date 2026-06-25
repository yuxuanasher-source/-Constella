import { NextResponse } from "next/server";

import {
  listVendorDeliveryPackage,
  type DeliveryPackageActor,
  type DeliveryPackageClient,
} from "@/features/delivery-packages/delivery-package-dto";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(request: Request) {
  try {
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

    const actor: DeliveryPackageActor = {
      userId: auth.userId,
      role: auth.role,
      organizationId: auth.organizationId,
    };
    const items = await listVendorDeliveryPackage(
      supabase as unknown as DeliveryPackageClient,
      actor,
      projectId,
    );

    return NextResponse.json({ items });
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
