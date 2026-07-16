import type { AiExecutionActor } from "@/features/ai/contracts";

export function createWorkerActor({
  organizationId,
  workerId,
}: {
  organizationId: string;
  workerId: string;
}): AiExecutionActor {
  return {
    actorKind: "system",
    organizationId,
    userId: undefined,
    name: "Background Worker",
    role: "ops_manager",
    workerId,
  };
}
