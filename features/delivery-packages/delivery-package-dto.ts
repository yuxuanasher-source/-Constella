import type { AppRole } from "@/lib/rbac/roles";

export type VendorDeliveryPackageRow = {
  project_id: string;
  project_name: string;
  streamer_name: string;
  settlement_duration_minutes: number | null;
  evidence_level: string | null;
  screenshot_count: number;
  cost_cents?: number;
  gross_margin_cents?: number;
  vendor_receivable_cents?: number;
  internal_risk_note?: string;
};

export type VendorDeliveryPackageItem = {
  projectId: string;
  projectName: string;
  streamerName: string;
  settlementDurationMinutes: number | null;
  evidenceLevel: string | null;
  screenshotCount: number;
};

export type DeliveryPackageActor = {
  userId: string;
  role: AppRole;
  organizationId: string;
};

export type DeliveryPackageClient = {
  from(table: "live_reports"): {
    select(columns: string): {
      eq(
        column: string,
        value: unknown,
      ): {
        eq(
          column: string,
          value: unknown,
        ): {
          eq(
            column: string,
            value: unknown,
          ): {
            order(
              column: string,
              options: { ascending: boolean },
            ): PromiseLike<{
              data: unknown[] | null;
              error: Error | null;
            }>;
          };
        };
      };
    };
  };
};

type DeliveryReportRow = {
  project_id: string;
  settlement_duration: number | null;
  evidence_level: string | null;
  projects: { name: string } | { name: string }[] | null;
  streamers: { display_name: string } | { display_name: string }[] | null;
  report_screenshots: Array<{ id: string }> | null;
};

export async function listVendorDeliveryPackage(
  client: DeliveryPackageClient,
  actor: DeliveryPackageActor,
  projectId: string,
): Promise<VendorDeliveryPackageItem[]> {
  const { data, error } = await client
    .from("live_reports")
    .select(
      "project_id, settlement_duration, evidence_level, projects(name), streamers(display_name), report_screenshots(id)",
    )
    .eq("organization_id", actor.organizationId)
    .eq("project_id", projectId)
    .eq("status", "approved")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as DeliveryReportRow[]).map((row) =>
    toVendorDeliveryPackageItem({
      project_id: row.project_id,
      project_name: first(row.projects)?.name ?? "Unknown project",
      streamer_name: first(row.streamers)?.display_name ?? "Unknown streamer",
      settlement_duration_minutes: row.settlement_duration,
      evidence_level: row.evidence_level,
      screenshot_count: row.report_screenshots?.length ?? 0,
    }),
  );
}

export function toVendorDeliveryPackageItem(
  row: VendorDeliveryPackageRow,
): VendorDeliveryPackageItem {
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    streamerName: row.streamer_name,
    settlementDurationMinutes: row.settlement_duration_minutes,
    evidenceLevel: row.evidence_level,
    screenshotCount: row.screenshot_count,
  };
}

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
