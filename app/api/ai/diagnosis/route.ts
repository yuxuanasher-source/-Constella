import { NextResponse } from "next/server";

import {
  runAiToolQuery,
  type AiToolGateway,
} from "@/features/ai/ai-tool-layer";
import {
  createDeepSeekProvider,
  readDeepSeekConfigFromEnv,
} from "@/features/ai/providers/deepseek-provider";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

let cachedGateway: AiToolGateway | null = null;

// 仅当配置了 DEEPSEEK_API_KEY 时才组装网关；否则返回 undefined，
// runAiToolQuery 走确定性兜底，本地/未配置环境零影响。
function deepSeekGateway(): AiToolGateway | undefined {
  const config = readDeepSeekConfigFromEnv(process.env);
  if (!config.apiKey) {
    return undefined;
  }
  cachedGateway ??= {
    providers: [createDeepSeekProvider(config)],
    primaryProvider: "deepseek",
  };
  return cachedGateway;
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const result = await runAiToolQuery({
      client: supabase,
      actor: auth,
      toolName: "streamer_diagnosis",
      input: body,
      gateway: deepSeekGateway(),
    });

    return NextResponse.json({ result });
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
