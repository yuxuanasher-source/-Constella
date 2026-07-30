import type { SupabaseClient } from "@supabase/supabase-js";

const preSettlementProjectStatuses = new Set([
  "recruiting",
  "pending_start",
  "active",
  "paused",
  "ended",
]);

export function canShareAdmissionRecordingsForProject(
  projectStatus: string | null | undefined,
) {
  return Boolean(
    projectStatus && preSettlementProjectStatuses.has(projectStatus),
  );
}

export class AdmissionShareProjectStatusError extends Error {
  readonly name = "AdmissionShareProjectStatusError";
  readonly code = "ADMISSION_SHARE_PROJECT_STATUS_BLOCKED";

  constructor(
    message: string,
    public readonly statusCode: 404 | 409,
    public readonly projectStatus?: string,
  ) {
    super(message);
  }
}

export async function assertCanCreateAdmissionShareForProject(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
  },
) {
  const { data, error } = await supabase
    .from("projects")
    .select("status")
    .eq("organization_id", input.organizationId)
    .eq("id", input.projectId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to verify admission share project: ${error.message}`,
    );
  }
  if (!data) {
    throw new AdmissionShareProjectStatusError("Project not found", 404);
  }
  if (!canShareAdmissionRecordingsForProject(data.status)) {
    throw new AdmissionShareProjectStatusError(
      "Project status does not allow new admission recording shares",
      409,
      data.status,
    );
  }
}
