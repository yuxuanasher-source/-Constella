import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--ops-radius-card)] border border-dashed border-[var(--ops-border)] bg-[var(--ops-surface)] p-6 text-center">
      <h2 className="m-0 text-sm font-semibold text-[var(--ops-text-1)]">
        {title}
      </h2>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-xs text-[var(--ops-text-3)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
