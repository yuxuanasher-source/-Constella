import { cn } from "@/lib/utils";

type Column<Row extends Record<string, unknown>> = {
  key: keyof Row & string;
  header: string;
  render?: (row: Row) => React.ReactNode;
};

export function TableShell<Row extends { id: string } & Record<string, unknown>>({
  columns,
  rows,
  className,
}: {
  columns: Array<Column<Row>>;
  rows: Row[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--ops-radius-card)] border border-[var(--ops-border)] bg-[var(--ops-surface)]",
        className,
      )}
    >
      <table className="w-full border-collapse text-left text-xs">
        <thead className="bg-[var(--ops-bg)] text-[var(--ops-text-2)]">
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="h-9 px-3 font-semibold">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--ops-border)]">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-[var(--ops-bg)]">
              {columns.map((column) => (
                <td key={column.key} className="h-10 px-3 text-[var(--ops-text-1)]">
                  {column.render ? column.render(row) : String(row[column.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
