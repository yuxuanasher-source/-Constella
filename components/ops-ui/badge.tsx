import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const tones = {
  neutral: "border-[var(--ops-border)] bg-[var(--ops-surface)] text-[var(--ops-text-2)]",
  blue: "border-blue-100 bg-[var(--ops-primary-soft)] text-[var(--ops-primary)]",
  green: "border-green-100 bg-green-50 text-[var(--ops-success)]",
  amber: "border-orange-100 bg-orange-50 text-[var(--ops-warning)]",
  red: "border-red-100 bg-red-50 text-[var(--ops-danger)]",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-[var(--ops-radius-control)] border px-2 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
