export default function RecordingsPage() {
  return <Stub title="录屏库" />;
}

function Stub({ title }: { title: string }) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-white p-5">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm text-[var(--ink-500)]">P1 业务页占位。</p>
    </section>
  );
}
