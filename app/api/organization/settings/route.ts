import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { toHttpError } from "@/lib/http/http-error";
import { parseJsonBody } from "@/lib/http/parse-json-body";
import { canManageOrganizationSettings } from "@/lib/rbac/permissions";

const trimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value);

const settingsBodySchema = z.object({
  name: trimmed(60).optional(),
  logoText: trimmed(4).optional(),
  brandName: trimmed(12).optional(),
  brandTagline: trimmed(32).optional(),
});

export async function PATCH(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!canManageOrganizationSettings(auth.role)) {
      return NextResponse.json(
        { error: "Only owner can update organization settings" },
        { status: 403 },
      );
    }

    const body = await parseJsonBody(request, settingsBodySchema);
    const nextName = body.name;
    if (nextName !== undefined && !nextName) {
      return NextResponse.json(
        { error: "Organization name cannot be empty" },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Organization admin client is not configured" },
        { status: 500 },
      );
    }

    const current = await admin
      .from("organizations")
      .select("name, branding")
      .eq("id", auth.organizationId)
      .maybeSingle<{ name: string; branding: Record<string, unknown> | null }>();
    if (current.error || !current.data) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    const currentBranding =
      current.data.branding && typeof current.data.branding === "object"
        ? current.data.branding
        : {};
    const nextBranding = {
      ...currentBranding,
      ...(body.logoText !== undefined ? { logoText: body.logoText } : {}),
      ...(body.brandName !== undefined ? { brandName: body.brandName } : {}),
      ...(body.brandTagline !== undefined
        ? { brandTagline: body.brandTagline }
        : {}),
    };

    const update = await admin
      .from("organizations")
      .update({
        ...(nextName !== undefined ? { name: nextName } : {}),
        branding: nextBranding,
      })
      .eq("id", auth.organizationId)
      .select("id, name, branding")
      .maybeSingle<{
        id: string;
        name: string;
        branding: Record<string, unknown> | null;
      }>();
    if (update.error || !update.data) {
      return NextResponse.json(
        { error: "Failed to update organization settings" },
        { status: 500 },
      );
    }

    await writeAuditLog(admin, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      actorName: auth.name,
      actorRole: auth.role,
      action: "update",
      module: "organization",
      objectType: "organization_settings",
      objectId: auth.organizationId,
      objectName: update.data.name,
      before: {
        name: current.data.name,
        branding: currentBranding,
      },
      after: {
        name: update.data.name,
        branding: update.data.branding ?? {},
      },
      changedFields: [
        ...(nextName !== undefined ? ["name"] : []),
        ...(body.logoText !== undefined ? ["branding.logoText"] : []),
        ...(body.brandName !== undefined ? ["branding.brandName"] : []),
        ...(body.brandTagline !== undefined ? ["branding.brandTagline"] : []),
      ],
    });

    return NextResponse.json({
      organization: {
        id: update.data.id,
        name: update.data.name,
        branding: update.data.branding ?? {},
      },
    });
  } catch (error) {
    const httpError = toHttpError(error);
    return NextResponse.json(
      { error: httpError.message },
      { status: httpError.status },
    );
  }
}
