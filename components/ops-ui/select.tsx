import type { SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 rounded-[var(--ops-radius-control)] border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 text-xs text-[var(--ops-text-1)] outline-none transition focus:border-[var(--ops-primary)] focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
