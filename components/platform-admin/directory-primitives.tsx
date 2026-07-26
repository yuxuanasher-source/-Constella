import { Inbox } from "lucide-react";

export function DirectoryHeader({
  eyebrow,
  title,
  description,
  trailing,
}: {
  eyebrow: string;
  title: string;
  description: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-medium text-[var(--blue-600)]">{eyebrow}</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--ink-400)]">
          {description}
        </p>
      </div>
      {trailing}
    </div>
  );
}

export function DirectoryEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="grid min-h-56 place-items-center rounded-[var(--r-lg)] border border-dashed border-[var(--line-strong)] bg-white px-6 text-center">
      <div>
        <Inbox
          aria-hidden="true"
          className="mx-auto h-6 w-6 text-[var(--ink-300)]"
        />
        <p className="mt-3 text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-[var(--ink-400)]">{description}</p>
      </div>
    </div>
  );
}
