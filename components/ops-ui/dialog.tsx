import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function DialogShell({
  title,
  children,
  footer,
  className,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={cn(
        "rounded-[var(--ops-radius-card)] border border-[var(--ops-border)] bg-[var(--ops-surface)] p-4 shadow-lg",
        className,
      )}
    >
      <h2 className="m-0 text-sm font-semibold text-[var(--ops-text-1)]">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
      {footer ? <div className="mt-4">{footer}</div> : null}
    </section>
  );
}
