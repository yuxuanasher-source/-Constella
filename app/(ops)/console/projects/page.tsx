import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { listProjects } from "@/features/projects/project-queries";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";

import {
  currentUserFromAuth,
  organizationSettingsFromAuth,
  requireConsoleStaffAuth,
} from "../console-auth";

export default async function ProjectsPage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  const projects = await listProjects(supabase);

  return (
    <OpsReferenceApp
      initialRoute="projects"
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettingsFromAuth(auth)}
      projectCards={toProjectCardDtos(projects)}
    />
  );
}
