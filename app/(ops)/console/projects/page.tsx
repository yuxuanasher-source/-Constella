import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { listOpsLiveTaskQueue } from "@/features/live-operations/live-operations-queries";
import { toOpsReferenceTask } from "@/features/live-operations/live-ui-adapters";
import { listProjects } from "@/features/projects/project-queries";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";

import {
  currentUserFromAuth,
  organizationSettingsFromAuth,
  requireConsoleStaffAuth,
} from "../console-auth";

export default async function ProjectsPage() {
  const { supabase, auth } = await requireConsoleStaffAuth();
  const [projects, liveTasks] = await Promise.all([
    listProjects(supabase),
    listOpsLiveTaskQueue(supabase, auth.organizationId),
  ]);

  return (
    <OpsReferenceApp
      initialRoute="projects"
      currentUser={currentUserFromAuth(auth)}
      organizationSettings={organizationSettingsFromAuth(auth)}
      projectCards={toProjectCardDtos(projects)}
      liveTasks={liveTasks.map((task) => toOpsReferenceTask(task))}
    />
  );
}
