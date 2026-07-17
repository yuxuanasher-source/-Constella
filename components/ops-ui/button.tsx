import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

const variants = {
  primary:
    "border-[var(--ops-primary)] bg-[var(--ops-primary)] text-white hover:brightness-95",
  secondary:
    "border-[var(--ops-border)] bg-[var(--ops-surface)] text-[var(--ops-text-1)] hover:bg-[var(--ops-bg)]",
  ghost:
    "border-transparent bg-transparent text-[var(--ops-text-2)] hover:bg-[var(--ops-primary-soft)] hover:text-[var(--ops-primary)]",
  danger:
    "border-[var(--ops-danger)] bg-[var(--ops-danger)] text-white hover:brightness-95",
};

const sizes = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-xs",
};

export function Button({
  asChild,
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--ops-radius-control)] border font-semibold transition disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
