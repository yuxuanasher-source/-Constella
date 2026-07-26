import type { AgentOutput } from "./contracts";

// 服务端取数 loader 用 dataGaps 声明哪些字段没有真实数据来源(置零/置
// unknown 的口径)。路由在 enrichment 之后把缺口追加为 caveats,让"数据
// 缺失"作为风险提示随诊断一起呈现,而不是被静默补齐——静默编造正是本次
// 重构要消灭的行为。文案禁止出现阿拉伯数字(输出契约校验)。
const DATA_GAP_CAPTIONS: Record<string, string> = {
  project_category: "项目品类信息暂无真实数据来源,按未知处理",
  project_platform: "项目平台信息暂无真实数据来源,按未知处理",
  supplier_quality: "供应商质量评分暂无数据来源,本次复盘未纳入供应商表现",
  supplier_cost_unavailable: "供应商成本读取失败,本次按零计入",
  payable_from_pool_estimate: "应付金额来自结算池预估,尚未生成正式批次",
  streamer_roi: "主播缺少归因 GMV 或有效实际结算,投产比按缺失处理",
  streamer_disputes: "主播争议记录暂无数据来源,相关计数按缺失处理",
  streamer_margin_allocation: "主播毛利贡献为按直播时长分摊的估算口径",
  candidate_roi: "候选主播缺少归因 GMV 或有效实际结算,投产比按缺失处理",
  candidate_availability: "部分候选主播可排期时长为近期任务时长的估算口径",
};

export function dataGapCaveats(gaps: string[]): AgentOutput["caveats"] {
  return Array.from(new Set(gaps)).map((gap) => ({
    summary: DATA_GAP_CAPTIONS[gap] ?? "部分数据暂无真实来源,已按缺失口径处理",
    unverifiedExternalFactor: true as const,
  }));
}

// 缺口 caveats 在 enrichment 之后追加:模型生成的 caveats 会整体替换原
// caveats,若在 enrichment 前追加会被覆盖丢失。
export function appendDataGapCaveats(
  output: AgentOutput,
  gaps: string[],
): AgentOutput {
  if (!gaps.length) {
    return output;
  }
  const existing = new Set(output.caveats.map((caveat) => caveat.summary));
  const additions = dataGapCaveats(gaps).filter(
    (caveat) => !existing.has(caveat.summary),
  );
  return additions.length
    ? { ...output, caveats: [...output.caveats, ...additions] }
    : output;
}
