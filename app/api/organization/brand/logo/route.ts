import { NextResponse } from "next/server";

import { getAuthContext } from "@/lib/auth/context";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import {
  BrandLogoError,
  normalizeBrandLogo,
} from "@/lib/storage/organization-brand-logo";

class BrandLogoRequestError extends Error {
  constructor() {
    super("A single logo file is required");
    this.name = "BrandLogoRequestError";
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return unavailable();
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }
    if (auth.role !== "owner") {
      return NextResponse.json(
        {
          error: "Only organization owners can upload brand logos",
          code: "ORGANIZATION_BRAND_FORBIDDEN",
        },
        { status: 403 },
      );
    }

    const file = await readSingleLogoFile(request);
    const normalized = await normalizeBrandLogo(file, auth.organizationId);
    const bucket = getPrivateStorageBucket();
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(normalized.path, normalized.body, {
        contentType: normalized.contentType,
        upsert: false,
      });

    if (error || !data) {
      return NextResponse.json(
        {
          error: "Organization brand logo upload failed",
          code: "BRAND_LOGO_UPLOAD_FAILED",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      logoStoragePath: normalized.path,
      contentType: normalized.contentType,
    });
  } catch (error) {
    if (error instanceof BrandLogoRequestError) {
      return NextResponse.json(
        { error: error.message, code: "BRAND_LOGO_INVALID_REQUEST" },
        { status: 400 },
      );
    }
    if (error instanceof BrandLogoError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return unavailable();
  }
}

async function readSingleLogoFile(request: Request): Promise<File> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new BrandLogoRequestError();
  }

  const entries = Array.from(form.entries());
  if (
    entries.length !== 1 ||
    entries[0]?.[0] !== "logo" ||
    !isMultipartFile(entries[0][1])
  ) {
    throw new BrandLogoRequestError();
  }
  return entries[0][1];
}

function isMultipartFile(value: FormDataEntryValue): value is File {
  return (
    typeof value !== "string" &&
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    typeof value.type === "string" &&
    typeof value.arrayBuffer === "function"
  );
}

function unavailable() {
  return NextResponse.json(
    {
      error: "Organization brand logo service is unavailable",
      code: "ORGANIZATION_BRAND_LOGO_UNAVAILABLE",
    },
    { status: 503 },
  );
}
