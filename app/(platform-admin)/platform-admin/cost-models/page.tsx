import { CostModelDirectory } from "@/components/platform-admin/cost-model-directory";
import { PlatformAdminShell } from "@/components/platform-admin/platform-admin-shell";

import { getPlatformAdminPageData } from "../platform-admin-page-data";

export default async function CostModelsPage() {
  const { actor, repo } = await getPlatformAdminPageData();
  const costModels = await repo.listCostModels();
  return (
    <PlatformAdminShell
      currentPath="/platform-admin/cost-models"
      administratorName={actor.name}
    >
      <CostModelDirectory costModels={costModels} />
    </PlatformAdminShell>
  );
}
