// 组织复盘知识库引擎（纯函数，无 IO）。
//
// 三件事：
//  1. parseLiveReview —— 把一份 Markdown 复盘解析成结构化要点；
//  2. aggregateReviewKnowledge —— 把组织内已保存的多份复盘汇聚成「知识」
//     （复发问题、可复制打法、常用行动项、五维度热点）；
//  3. buildReviewAssist —— 基于知识库给「下一场复盘」生成 AI 辅助建议块，
//     这就是「AI 接入知识库并反馈到后续复盘」的落点。
//
// 这些函数同时被 API 路由与经营端参考 UI 复用，保证线上线下一致。

export const REVIEW_DIMENSIONS = [
  "内容",
  "投放",
  "主播",
  "承接",
  "运营协同",
] as const;

export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];

export type ReviewProblem = {
  phenomenon: string;
  directCause: string;
  rootCause: string;
  nature: string; // 偶发 / 结构性
  dimension: ReviewDimension | null;
};

export type ReviewAction = {
  action: string;
  owner: string;
  due: string;
  metric: string;
};

export type ParsedLiveReview = {
  goal: string;
  product: string;
  platform: string;
  wins: string[];
  problems: ReviewProblem[];
  actions: ReviewAction[];
};

export type ReviewKnowledgeDocument = {
  id?: string;
  title?: string;
  contentMd: string;
  createdAt?: string;
};

export type RecurringProblem = {
  rootCause: string;
  count: number;
  structuralCount: number;
  dimension: ReviewDimension | null;
  examples: string[];
};

export type RepeatableWin = {
  text: string;
  count: number;
};

export type CommonAction = {
  action: string;
  count: number;
  metrics: string[];
};

export type ReviewKnowledge = {
  sampleSize: number;
  recurringProblems: RecurringProblem[];
  repeatableWins: RepeatableWin[];
  commonActions: CommonAction[];
  dimensionStats: { dimension: ReviewDimension; count: number }[];
};

export type ReviewAssist = {
  sampleSize: number;
  suggestions: string[];
  watchOuts: string[];
  reusableWins: string[];
  assistMarkdown: string;
};

const EXAMPLE_PREFIX = /^例[：:]/;

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  // Separator rows such as |---|---| carry no data.
  if (/^\|[\s:|-]+\|?$/.test(trimmed)) return null;
  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  return cells;
}

function isEmptyRow(cells: string[]): boolean {
  return cells.every((cell) => cell.length === 0);
}

function stripExample(value: string): string {
  return value.replace(EXAMPLE_PREFIX, "").trim();
}

function detectDimension(text: string): ReviewDimension | null {
  for (const dimension of REVIEW_DIMENSIONS) {
    if (text.includes(dimension)) return dimension;
  }
  // Light keyword routing so free-text causes still land in a bucket.
  if (/(话术|开场|留人|憋单|信息密度|内容)/.test(text)) return "内容";
  if (/(计划|定向|出价|素材|消耗|roi|ROI|投放|买量)/.test(text)) return "投放";
  if (/(主播|控场|状态|引导)/.test(text)) return "主播";
  if (/(下载|注册|付费|链路|承接|断点)/.test(text)) return "承接";
  if (/(预热|福利|客服|跟单|协同|运营)/.test(text)) return "运营协同";
  return null;
}

type SectionMap = Record<string, string[]>;

function sliceSections(markdown: string): SectionMap {
  const lines = markdown.split(/\r?\n/);
  const sections: SectionMap = { __preamble: [] };
  let current = "__preamble";
  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s*(.+?)\s*$/);
    if (heading) {
      current = heading[1];
      sections[current] = [];
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}

function findSection(sections: SectionMap, keyword: string): string[] {
  const key = Object.keys(sections).find((name) => name.includes(keyword));
  return key ? sections[key] : [];
}

function valueFromInfoTable(lines: string[], label: string): string {
  for (const line of lines) {
    const cells = splitTableRow(line);
    if (!cells || cells.length < 2) continue;
    if (cells[0].includes(label)) return cells[1];
  }
  return "";
}

export function parseLiveReview(markdown: string): ParsedLiveReview {
  const sections = sliceSections(markdown ?? "");

  const infoLines = findSection(sections, "基础信息");
  const goal = valueFromInfoTable(infoLines, "本场目标");
  const product = valueFromInfoTable(infoLines, "产品");
  const platform = valueFromInfoTable(infoLines, "平台");

  const wins = findSection(sections, "做对了什么")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    // Drop a leading "标签：" prefix (e.g. 内容/话术：) so wins read as content.
    .map((line) => line.replace(/^[^：:]{1,12}[：:]\s*/, "").trim())
    .filter((line) => line.length > 0);

  const problems: ReviewProblem[] = [];
  for (const line of findSection(sections, "问题与归因")) {
    const cells = splitTableRow(line);
    if (!cells || cells.length < 4) continue;
    if (cells[0].includes("问题现象")) continue; // header row
    if (isEmptyRow(cells)) continue;
    if (EXAMPLE_PREFIX.test(cells[0].trim())) continue; // template example row
    const phenomenon = stripExample(cells[0]);
    const directCause = stripExample(cells[1]);
    const rootCause = stripExample(cells[2]);
    const nature = stripExample(cells[3]);
    if (!phenomenon && !rootCause && !directCause) continue;
    problems.push({
      phenomenon,
      directCause,
      rootCause,
      nature,
      dimension: detectDimension(`${phenomenon} ${directCause} ${rootCause}`),
    });
  }

  const actions: ReviewAction[] = [];
  for (const line of findSection(sections, "行动项")) {
    const cells = splitTableRow(line);
    if (!cells || cells.length < 4) continue;
    if (cells[0].includes("行动") && cells[1].includes("负责人")) continue;
    if (isEmptyRow(cells)) continue;
    const action = stripExample(cells[0]);
    if (!action) continue;
    actions.push({
      action,
      owner: cells[1] ?? "",
      due: cells[2] ?? "",
      metric: cells[3] ?? "",
    });
  }

  return { goal, product, platform, wins, problems, actions };
}

function bump<T>(
  map: Map<string, T>,
  key: string,
  create: () => T,
  update: (value: T) => void,
): void {
  const existing = map.get(key) ?? create();
  update(existing);
  map.set(key, existing);
}

export function aggregateReviewKnowledge(
  documents: ReviewKnowledgeDocument[],
): ReviewKnowledge {
  const parsed = (documents ?? []).map((doc) => parseLiveReview(doc.contentMd));

  const problemMap = new Map<string, RecurringProblem>();
  const winMap = new Map<string, RepeatableWin>();
  const actionMap = new Map<string, CommonAction>();
  const dimensionCount = new Map<ReviewDimension, number>();

  for (const review of parsed) {
    for (const problem of review.problems) {
      const key = (problem.rootCause || problem.phenomenon).toLowerCase();
      if (!key) continue;
      bump(
        problemMap,
        key,
        () => ({
          rootCause: problem.rootCause || problem.phenomenon,
          count: 0,
          structuralCount: 0,
          dimension: problem.dimension,
          examples: [],
        }),
        (value) => {
          value.count += 1;
          if (problem.nature.includes("结构")) value.structuralCount += 1;
          if (!value.dimension && problem.dimension)
            value.dimension = problem.dimension;
          if (problem.phenomenon && value.examples.length < 3)
            value.examples.push(problem.phenomenon);
        },
      );
      if (problem.dimension) {
        dimensionCount.set(
          problem.dimension,
          (dimensionCount.get(problem.dimension) ?? 0) + 1,
        );
      }
    }

    for (const win of review.wins) {
      const key = win.toLowerCase();
      bump(
        winMap,
        key,
        () => ({ text: win, count: 0 }),
        (value) => {
          value.count += 1;
        },
      );
    }

    for (const action of review.actions) {
      const key = action.action.toLowerCase();
      bump(
        actionMap,
        key,
        () => ({ action: action.action, count: 0, metrics: [] }),
        (value) => {
          value.count += 1;
          if (action.metric && !value.metrics.includes(action.metric))
            value.metrics.push(action.metric);
        },
      );
    }
  }

  const byCountThenStructural = (
    a: RecurringProblem,
    b: RecurringProblem,
  ): number => b.count - a.count || b.structuralCount - a.structuralCount;

  return {
    sampleSize: parsed.length,
    recurringProblems: [...problemMap.values()]
      .sort(byCountThenStructural)
      .slice(0, 8),
    repeatableWins: [...winMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    commonActions: [...actionMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    dimensionStats: REVIEW_DIMENSIONS.map((dimension) => ({
      dimension,
      count: dimensionCount.get(dimension) ?? 0,
    }))
      .filter((stat) => stat.count > 0)
      .sort((a, b) => b.count - a.count),
  };
}

export type ReviewAssistContext = {
  product?: string;
  platform?: string;
  streamer?: string;
  goal?: string;
};

export function buildReviewAssist(
  knowledge: ReviewKnowledge,
  context: ReviewAssistContext = {},
): ReviewAssist {
  const watchOuts: string[] = [];
  for (const problem of knowledge.recurringProblems) {
    if (problem.count < 1) continue;
    const tag = problem.dimension ? `【${problem.dimension}】` : "";
    const structural =
      problem.structuralCount > 0
        ? `（${problem.structuralCount} 次判为结构性）`
        : "";
    watchOuts.push(
      `${tag}「${problem.rootCause}」已在 ${problem.count} 场复盘中复发${structural}，本场提前卡点。`,
    );
  }

  const reusableWins = knowledge.repeatableWins
    .filter((win) => win.count >= 1)
    .map((win) =>
      win.count > 1 ? `${win.text}（已被复用 ${win.count} 次）` : win.text,
    );

  const suggestions: string[] = [];
  if (knowledge.dimensionStats.length > 0) {
    const hot = knowledge.dimensionStats[0];
    suggestions.push(
      `历史问题最集中在「${hot.dimension}」维度（${hot.count} 次），开播前重点排查该环节。`,
    );
  }
  for (const action of knowledge.commonActions.slice(0, 3)) {
    const metric = action.metrics[0] ? `，验证指标：${action.metrics[0]}` : "";
    suggestions.push(`延续高频行动项「${action.action}」${metric}。`);
  }
  if (context.goal) {
    suggestions.push(`对齐本场目标「${context.goal}」，逐项核对达成率。`);
  }

  const assistMarkdown = renderAssistMarkdown({
    knowledge,
    context,
    watchOuts,
    reusableWins,
    suggestions,
  });

  return {
    sampleSize: knowledge.sampleSize,
    suggestions,
    watchOuts,
    reusableWins,
    assistMarkdown,
  };
}

function bulletBlock(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return `**${title}**\n${items.map((item) => `- ${item}`).join("\n")}\n\n`;
}

function renderAssistMarkdown({
  knowledge,
  context,
  watchOuts,
  reusableWins,
  suggestions,
}: {
  knowledge: ReviewKnowledge;
  context: ReviewAssistContext;
  watchOuts: string[];
  reusableWins: string[];
  suggestions: string[];
}): string {
  const scope = [context.product, context.platform, context.streamer]
    .filter(Boolean)
    .join(" · ");
  const header =
    knowledge.sampleSize > 0
      ? `> AI 复盘助手 · 基于组织知识库 ${knowledge.sampleSize} 份历史复盘${scope ? `（场景：${scope}）` : ""}`
      : `> AI 复盘助手 · 知识库暂无历史复盘，本场保存后将开始沉淀经验。`;

  const body =
    knowledge.sampleSize > 0
      ? bulletBlock("⚠️ 复发问题预警（提前卡点）", watchOuts) +
        bulletBlock("✅ 可复制打法（建议延续）", reusableWins) +
        bulletBlock("🎯 本场建议", suggestions)
      : "";

  return `${header}\n\n${body}`.trimEnd() + "\n";
}
