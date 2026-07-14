import { cn } from "@/lib/utils";

export type OpsTabItem = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function Tabs({
  value,
  items,
  onChange,
  className,
}: {
  value: string;
  items: OpsTabItem[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex rounded-[var(--ops-radius-card)] border border-[var(--ops-border)] bg-[var(--ops-bg)] p-1",
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={item.disabled}
            className={cn(
              "h-7 rounded-[var(--ops-radius-control)] px-3 text-xs font-medium text-[var(--ops-text-2)] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ops-primary)] disabled:pointer-events-none disabled:opacity-50",
              selected &&
                "bg-[var(--ops-surface)] text-[var(--ops-primary)] shadow-sm",
            )}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
