export function BrandLogo() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-9 w-9 place-items-center rounded-md bg-gradient-to-br from-[var(--blue-500)] to-[var(--blue-800)] text-sm font-bold text-white shadow-sm">
        JY
      </div>
      <div>
        <div className="text-sm font-semibold text-[var(--ink-900)]">经营舱</div>
        <div className="text-xs text-[var(--ink-300)]">MCN Ops Suite</div>
      </div>
    </div>
  );
}
