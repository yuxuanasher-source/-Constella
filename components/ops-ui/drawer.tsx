import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function DrawerShell({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={cn(
        "h-full w-full max-w-md border-l border-[var(--ops-border)] bg-[var(--ops-surface)] p-4 shadow-lg",
        className,
      )}
    >
      <h2 className="m-0 text-sm font-semibold text-[var(--ops-text-1)]">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </aside>
  );
}
