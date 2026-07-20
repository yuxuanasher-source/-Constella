import { ConsoleProjectsWorkbench } from "@/components/console/projects-workbench";
import { OpsShell } from "@/components/layouts/ops-shell";
import { listOpsApplicationQueue } from "@/features/applications/application-queries";
import { listProjects } from "@/features/projects/project-queries";
import {
  toCollaborationApplicationProjectCardDtos,
  toCollaborationProjectCardDtos,
  toProjectCardDtos,
} from "@/features/projects/project-ui-dto";
import {
  listPartnerCollaborationApplications,
  listPartnerCollaborationProjects,
  SupabaseProjectCollaborationRepository,
} from "@/features/collaborations/project-collaboration-service";
import type { AuthContext } from "@/lib/auth/context";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

import { currentUserFromAuth, requireConsoleStaffAuth } from "../console-auth";

export default async function ProjectsPage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  const collaborationRepo = new SupabaseProjectCollaborationRepository(
    createSupabaseAdminClient() ?? supabase,
  );

  const [projects, applicationQueue, collaborations] = await Promise.all([
    listProjects(supabase, {
      organizationId: auth.organizationId,
    }),
    listOpsApplicationQueue(supabase, {
      organizationId: auth.organizationId,
    }),
    loadPartnerCollaborations(collaborationRepo, auth),
  ]);

  return (
    <OpsShell context={auth} unreadCount={0} activeHref="/console/projects">
      <ConsoleProjectsWorkbench
        currentUser={currentUserFromAuth(auth)}
        projectCards={toProjectCardDtos(projects)}
        applicationQueue={applicationQueue}
        collaborationProjectCards={[
          ...toCollaborationProjectCardDtos(collaborations.projects),
          ...toCollaborationApplicationProjectCardDtos(
            collaborations.applications,
          ),
        ]}
      />
    </OpsShell>
  );
}

// Partner collaboration data is loaded through the service-role admin client.
// If that client is misconfigured (e.g. a bad SUPABASE_SERVICE_ROLE_KEY) or the
// query fails, degrade to no collaboration data and log it instead of letting
// the error 500 the entire projects console.
async function loadPartnerCollaborations(
  repo: SupabaseProjectCollaborationRepository,
  auth: AuthContext,
): Promise<{
  projects: Awaited<ReturnType<typeof listPartnerCollaborationProjects>>;
  applications: Awaited<
    ReturnType<typeof listPartnerCollaborationApplications>
  >;
}> {
  try {
    const [projects, applications] = await Promise.all([
      listPartnerCollaborationProjects({ repo, actor: auth }),
      listPartnerCollaborationApplications({ repo, actor: auth }),
    ]);
    return { projects, applications };
  } catch (error) {
    console.error(
      "[console/projects] failed to load partner collaborations",
      error,
    );
    return { projects: [], applications: [] };
  }
}
