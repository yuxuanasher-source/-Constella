import { cn } from "@/lib/utils";

const tones = {
  neutral: "border-[var(--line)] bg-white text-[var(--ink-500)]",
  blue: "border-[var(--blue-100)] bg-[var(--blue-50)] text-[var(--blue-700)]",
  green: "border-emerald-100 bg-emerald-50 text-[var(--ok-600)]",
  amber: "border-amber-100 bg-amber-50 text-[var(--warn-600)]",
  red: "border-red-100 bg-red-50 text-[var(--danger-600)]",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded border px-2 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
