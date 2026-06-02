import type { StreamerListRow } from "./streamer-queries";

const sourceLabels: Record<string, string> = {
  signed: "签约",
  self_incubated: "自孵化",
  internal: "自孵化",
  external: "外部",
  supplier_recommended: "供应商",
  account_managed: "代运营",
};

export type StreamerCardDto = {
  id: string;
  alias: string;
  real: string;
  gender: string;
  source: string;
  supplier: string;
  games: string[];
  platforms: string[];
  style: string;
  cooperation: string;
  risk: string;
  defaultRule: string;
  createdAtLabel: string;
  matchScore: number;
  metrics: {
    screenPass: number;
    projectFinish: number;
    roi: number;
    grossContrib: number;
  };
};

export function toStreamerCardDto(row: StreamerListRow): StreamerCardDto {
  const cleanCount = Math.max(row.clean_report_count ?? 0, 0);
  const stableScore = Math.min(95, 65 + cleanCount * 2);

  return {
    id: row.id,
    alias: row.display_name,
    real: row.real_name ?? "未填写",
    gender: row.gender ?? "未填写",
    source: sourceLabels[row.source_type] ?? row.source_type,
    supplier: "未绑定",
    games: row.categories.length > 0 ? row.categories : ["未填写"],
    platforms: row.platforms.length > 0 ? row.platforms : ["未填写"],
    style: row.styles[0] ?? "未填写",
    cooperation: row.cooperation_status,
    risk: row.risk_level,
    defaultRule: row.default_settlement_method.toUpperCase(),
    createdAtLabel: row.created_at.slice(0, 10),
    matchScore: stableScore,
    metrics: {
      screenPass: stableScore,
      projectFinish: stableScore,
      roi: Number((1 + cleanCount / 100).toFixed(2)),
      grossContrib: 0,
    },
  };
}

export function toStreamerCardDtos(rows: StreamerListRow[]) {
  return rows.map(toStreamerCardDto);
}
