import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { listProjects } from "@/features/projects/project-queries";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

export default async function ProjectsPage() {
  const supabase = await createSupabaseServerClient();
  const projects = await listProjects(supabase);

  return (
    <OpsReferenceApp
      initialRoute="projects"
      projectCards={toProjectCardDtos(projects)}
    />
  );
}
