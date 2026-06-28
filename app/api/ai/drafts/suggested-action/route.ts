import { NextResponse } from "next/server";

import {
  createAiDraft,
  type DraftClient,
} from "@/features/ai/draft-repository";
import {
  buildSuggestedActionTodoDraft,
  type SuggestedActionTodoDraftInput,
} from "@/features/ai/drafts";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { isMcnStaff } from "@/lib/rbac/roles";

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
    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can create AI action drafts" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      action?: Partial<SuggestedActionTodoDraftInput>;
    };
    const action = sanitizeSuggestedAction(body.action);
    if (!action) {
      return NextResponse.json(
        { error: "A valid suggested action is required" },
        { status: 400 },
      );
    }

    const envelope = buildSuggestedActionTodoDraft(action);
    const created = await createAiDraft(supabase as unknown as DraftClient, {
      organizationId: auth.organizationId,
      actingUserId: auth.userId,
      envelope,
    });
    if (!created) {
      return NextResponse.json(
        { error: "Failed to persist AI action draft" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      draft: { id: created.id, ...envelope },
      todo: todoFromDraft(created.id, envelope.payload),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

function sanitizeSuggestedAction(
  value: Partial<SuggestedActionTodoDraftInput> | undefined,
): SuggestedActionTodoDraftInput | null {
  const title = typeof value?.title === "string" ? value.title.trim() : "";
  const actionId =
    typeof value?.actionId === "string" ? value.actionId.trim() : "";
  if (!title || !actionId) return null;
  const priority =
    value?.priority === "high" ||
    value?.priority === "medium" ||
    value?.priority === "low"
      ? value.priority
      : "medium";
  const target =
    value?.target && typeof value.target === "object"
      ? {
          route:
            typeof value.target.route === "string"
              ? value.target.route.slice(0, 80)
              : undefined,
          id:
            typeof value.target.id === "string"
              ? value.target.id.slice(0, 120)
              : undefined,
        }
      : undefined;
  return {
    actionId: actionId.slice(0, 160),
    ...(typeof value?.projectId === "string"
      ? { projectId: value.projectId.slice(0, 120) }
      : {}),
    ...(typeof value?.projectName === "string"
      ? { projectName: value.projectName.slice(0, 120) }
      : {}),
    priority,
    title: title.slice(0, 160),
    rationale:
      typeof value?.rationale === "string"
        ? value.rationale.slice(0, 240)
        : "",
    evidence: Array.isArray(value?.evidence)
      ? value.evidence
          .map((entry) => ({
            sourceTool:
              typeof entry?.sourceTool === "string"
                ? entry.sourceTool.slice(0, 80)
                : "role_home_dashboard",
            sourceId:
              typeof entry?.sourceId === "string"
                ? entry.sourceId.slice(0, 180)
                : "",
          }))
          .filter((entry) => entry.sourceId)
          .slice(0, 5)
      : [],
    ...(target ? { target } : {}),
    requiresHumanApproval: value?.requiresHumanApproval !== false,
  };
}

function todoFromDraft(id: string, payload: Record<string, unknown>) {
  const priority = String(payload.priority ?? "medium");
  return {
    key: `ai-draft:${id}`,
    text: String(payload.title ?? "AI suggested action"),
    count: priority,
    tone: priority === "high" ? "danger" : priority === "medium" ? "warn" : "neutral",
    route: typeof payload.route === "string" ? payload.route : undefined,
    targetId: typeof payload.targetId === "string" ? payload.targetId : undefined,
    draftId: id,
  };
}
