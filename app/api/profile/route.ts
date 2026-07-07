import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { toHttpError } from "@/lib/http/http-error";
import { parseJsonBody } from "@/lib/http/parse-json-body";

// 头像图片以压缩后的 data URL 直接存 profiles.avatar_url，避免依赖公开存储桶。
// 前端按 256px JPEG 压缩后一般 10-30KB；这里兜底限制 200K 字符（≈150KB 二进制）。
const AVATAR_URL_MAX_LENGTH = 200_000;
const AVATAR_URL_PATTERN = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;

// 头像字标最多 4 个字符（按 Unicode 码点计，支持 emoji），空串表示清除、回退到姓名首字。
const profileBodySchema = z
  .object({
    avatarText: z
      .string()
      .trim()
      .refine((value) => Array.from(value).length <= 4, {
        message: "avatarText is too long",
      })
      .optional(),
    avatarUrl: z
      .string()
      .refine(
        (value) =>
          value === "" ||
          (value.length <= AVATAR_URL_MAX_LENGTH &&
            AVATAR_URL_PATTERN.test(value)),
        { message: "avatarUrl must be a jpeg/png data URL" },
      )
      .optional(),
  })
  .refine(
    (value) => value.avatarText !== undefined || value.avatarUrl !== undefined,
    { message: "avatarText or avatarUrl is required" },
  );

export async function PATCH(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await parseJsonBody(request, profileBodySchema);
    const updatePayload: Record<string, string | null> = {};
    if (body.avatarText !== undefined) {
      updatePayload.avatar_text = body.avatarText || null;
    }
    if (body.avatarUrl !== undefined) {
      updatePayload.avatar_url = body.avatarUrl || null;
    }

    // profiles 已有 "users can update own profile" RLS 策略，直接用会话客户端更新。
    const update = await supabase
      .from("profiles")
      .update(updatePayload)
      .eq("id", auth.userId)
      .select("id, avatar_text, avatar_url")
      .maybeSingle<{
        id: string;
        avatar_text: string | null;
        avatar_url: string | null;
      }>();
    if (update.error || !update.data) {
      return NextResponse.json(
        { error: "Failed to update profile" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      profile: {
        id: update.data.id,
        avatarText: update.data.avatar_text ?? "",
        avatarUrl: update.data.avatar_url ?? "",
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
