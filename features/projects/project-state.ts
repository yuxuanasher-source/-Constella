export const projectStatuses = [
  "draft",
  "recruiting",
  "pending_start",
  "active",
  "paused",
  "ended",
  "settling",
  "archived",
] as const;

export type ProjectStatus = (typeof projectStatuses)[number];

const allowedTransitions: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ["recruiting", "archived"],
  recruiting: ["pending_start", "active", "paused", "ended"],
  pending_start: ["active", "paused", "ended"],
  active: ["paused", "ended"],
  paused: ["active", "ended"],
  ended: ["settling", "archived"],
  settling: ["archived", "ended"],
  archived: [],
};

export function assertProjectTransition(
  from: ProjectStatus,
  to: ProjectStatus,
): void {
  if (from === to) {
    return;
  }

  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Illegal project status transition: ${from} -> ${to}`);
  }
}
