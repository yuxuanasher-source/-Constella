import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--ops-radius-card)] border border-[var(--ops-border)] bg-[var(--ops-surface)] p-4",
        className,
      )}
      {...props}
    />
  );
}
