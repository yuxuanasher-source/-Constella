"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/audit";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { sendNotification } from "@/lib/notify/notify";

import { SupabaseProjectRepository } from "./project-repository";
import {
  createProjectDraft,
  publishProject as publishProjectService,
} from "./project-service";

function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }

  return value.trim();
}

export async function createProjectDraftAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const context = await getAuthContext(supabase);

  if (!supabase || !context) {
    redirect("/login");
  }

  await createProjectDraft({
    repo: new SupabaseProjectRepository(supabase),
    audit: (input) => writeAuditLog(supabase, input),
    actor: {
      userId: context.userId,
      name: context.name,
      role: context.role,
      organizationId: context.organizationId,
    },
    input: {
      name: requiredString(formData, "name"),
      code: requiredString(formData, "code"),
    },
  });

  revalidatePath("/console/projects");
}

export async function publishProjectAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const context = await getAuthContext(supabase);

  if (!supabase || !context) {
    redirect("/login");
  }

  const project = await publishProjectService({
    repo: new SupabaseProjectRepository(supabase),
    audit: (input) => writeAuditLog(supabase, input),
    actor: {
      userId: context.userId,
      name: context.name,
      role: context.role,
      organizationId: context.organizationId,
    },
    projectId: requiredString(formData, "projectId"),
  });

  await sendNotification(supabase, {
    organizationId: context.organizationId,
    recipientRole: "owner",
    type: "system",
    title: "项目已发布",
    content: `${project.name} 已进入招募中。`,
    objectType: "project",
    objectId: project.id,
    source: "project.publish",
  });

  revalidatePath("/console/projects");
}
