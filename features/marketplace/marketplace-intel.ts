// 撮合论坛 AI 情报层（确定性聚合 / 打分，属 L1 感知）。基于全公开数据(需求/投递)
// 计算市场动态、供给热度、接单画像、智能匹配。铁律：数字均来自结构化输入并带 sourceRef，
// 不由 LLM 编造；匹配是确定性打分规则，给出可解释理由。

import type { ApplicationPublic, PostingPublic } from "./marketplace-types";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

// ── 市场动态：窗口内新出现的产品 / 二手单 ──
export type MarketDynamics = {
  windowDays: number;
  newPostings: number;
  newProducts: string[];
  recent: Array<{
    id: string;
    title: string;
    productName: string | null;
    category: string | null;
    budgetCents: number | null;
    createdAt: string;
  }>;
  sourceRef: string;
};

export function computeMarketDynamics(
  postings: PostingPublic[],
  nowMs: number,
  windowDays = 7,
): MarketDynamics {
  const cutoff = nowMs - windowDays * DAY_MS;
  const fresh = (postings ?? []).filter((p) => parseTime(p.createdAt) >= cutoff);
  const products = new Set<string>();
  for (const p of fresh) {
    if (p.productName) products.add(p.productName);
  }
  const recent = [...(postings ?? [])]
    .sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt))
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      title: p.title,
      productName: p.productName,
      category: p.category,
      budgetCents: p.budgetCents,
      createdAt: p.createdAt,
    }));
  return {
    windowDays,
    newPostings: fresh.length,
    newProducts: [...products],
    recent,
    sourceRef: "marketplace_postings(open,matched)",
  };
}

// ── 供给热度：在发布的组织数、品类分布、预算分布 ──
export type SupplyHeat = {
  totalOpen: number;
  publishers: number;
  byCategory: Array<{ category: string; count: number }>;
  budgetBuckets: Array<{ label: string; count: number }>;
  sourceRef: string;
};

const BUDGET_BUCKETS: Array<{ label: string; max: number }> = [
  { label: "≤1千", max: 100_000 },
  { label: "1千-1万", max: 1_000_000 },
  { label: "1万-10万", max: 10_000_000 },
  { label: ">10万", max: Infinity },
];

export function computeSupplyHeat(postings: PostingPublic[]): SupplyHeat {
  const open = (postings ?? []).filter((p) => p.status === "open");
  const publishers = new Set(open.map((p) => p.organizationId));
  const catMap = new Map<string, number>();
  const bucketCounts = new Map<string, number>();
  for (const p of open) {
    const cat = p.category || "未分类";
    catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
    if (p.budgetCents != null) {
      const bucket = BUDGET_BUCKETS.find((b) => p.budgetCents! <= b.max);
      if (bucket) bucketCounts.set(bucket.label, (bucketCounts.get(bucket.label) ?? 0) + 1);
    }
  }
  const byCategory = [...catMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  const budgetBuckets = BUDGET_BUCKETS.map((b) => ({
    label: b.label,
    count: bucketCounts.get(b.label) ?? 0,
  })).filter((b) => b.count > 0);
  return {
    totalOpen: open.length,
    publishers: publishers.size,
    byCategory,
    budgetBuckets,
    sourceRef: "marketplace_postings(open)",
  };
}

// ── 接单画像：哪些 MCN 在接单 + 覆盖品类 / 报价区间 / 已达成 ──
export type ApplicantProfile = {
  organizationId: string;
  applications: number;
  deals: number;
  categories: string[];
  quoteRange: { minCents: number; maxCents: number } | null;
};
export type ApplicantProfiles = {
  profiles: ApplicantProfile[];
  sourceRef: string;
};

export function computeApplicantProfiles(
  applications: ApplicationPublic[],
  postings: PostingPublic[],
  limit = 10,
): ApplicantProfiles {
  const categoryByPosting = new Map(
    (postings ?? []).map((p) => [p.id, p.category]),
  );
  const acc = new Map<
    string,
    { applications: number; deals: number; categories: Set<string>; quotes: number[] }
  >();
  for (const a of applications ?? []) {
    const entry =
      acc.get(a.applicantOrganizationId) ??
      { applications: 0, deals: 0, categories: new Set<string>(), quotes: [] };
    entry.applications += 1;
    if (a.status === "deal_confirmed") entry.deals += 1;
    const cat = categoryByPosting.get(a.postingId);
    if (cat) entry.categories.add(cat);
    if (a.quoteCents != null) entry.quotes.push(a.quoteCents);
    acc.set(a.applicantOrganizationId, entry);
  }
  const profiles = [...acc.entries()]
    .map(([organizationId, e]) => ({
      organizationId,
      applications: e.applications,
      deals: e.deals,
      categories: [...e.categories],
      quoteRange: e.quotes.length
        ? { minCents: Math.min(...e.quotes), maxCents: Math.max(...e.quotes) }
        : null,
    }))
    .sort((a, b) => b.applications - a.applications || b.deals - a.deals)
    .slice(0, limit);
  return { profiles, sourceRef: "marketplace_applications(public)" };
}

// ── 智能匹配：按当前用户属性给推荐 + 理由 ──
export type Recommendation = {
  kind: "posting" | "applicant";
  refId: string;
  title: string;
  score: number;
  reasons: string[];
};
export type MatchResult = {
  recommendations: Recommendation[];
  sourceRef: string;
};

export type MatchActor = {
  organizationId: string;
  // 该组织已投递过的需求 id（用于推断偏好品类、排除已投递）。
  myApplicationPostingIds: string[];
  // 该组织作为发单方的公开需求（用于厂商侧推荐接单方）。
  myOpenPostingCategories: string[];
};

// MCN 侧：推荐公开需求；偏好品类来自其过往投递所属需求的品类。
export function recommendPostingsForMcn(
  actor: MatchActor,
  postings: PostingPublic[],
  nowMs: number,
  limit = 5,
): Recommendation[] {
  const categoryByPosting = new Map((postings ?? []).map((p) => [p.id, p.category]));
  const preferred = new Set<string>();
  for (const pid of actor.myApplicationPostingIds) {
    const cat = categoryByPosting.get(pid);
    if (cat) preferred.add(cat);
  }
  const appliedSet = new Set(actor.myApplicationPostingIds);
  const recs: Recommendation[] = [];
  for (const p of postings ?? []) {
    if (p.status !== "open") continue;
    if (p.organizationId === actor.organizationId) continue; // 不推荐自己的需求
    if (appliedSet.has(p.id)) continue; // 已投递的不再推荐
    let score = 1;
    const reasons: string[] = [];
    if (p.category && preferred.has(p.category)) {
      score += 5;
      reasons.push(`品类匹配：${p.category}`);
    }
    if (p.budgetCents != null) {
      score += 1;
      reasons.push("预算明确");
    }
    const ageDays = (nowMs - parseTime(p.createdAt)) / DAY_MS;
    if (ageDays <= 3) {
      score += 1;
      reasons.push("近期新发布");
    }
    if (!reasons.length) reasons.push("公开需求");
    recs.push({ kind: "posting", refId: p.id, title: p.title, score, reasons });
  }
  return recs
    .sort((a, b) => b.score - a.score || a.refId.localeCompare(b.refId))
    .slice(0, limit);
}

// 厂商侧：推荐接单方；按其覆盖品类与我方公开需求品类的重合度。
export function recommendApplicantsForVendor(
  actor: MatchActor,
  profiles: ApplicantProfile[],
  limit = 5,
): Recommendation[] {
  const myCats = new Set(actor.myOpenPostingCategories.filter(Boolean));
  const recs: Recommendation[] = [];
  for (const prof of profiles ?? []) {
    if (prof.organizationId === actor.organizationId) continue;
    let score = 1;
    const reasons: string[] = [];
    const overlap = prof.categories.filter((c) => myCats.has(c));
    if (overlap.length) {
      score += 4 * overlap.length;
      reasons.push(`覆盖品类匹配：${overlap.join("、")}`);
    }
    if (prof.deals > 0) {
      score += 2;
      reasons.push(`已达成 ${prof.deals} 单`);
    }
    if (prof.applications >= 3) {
      score += 1;
      reasons.push("活跃接单方");
    }
    if (!reasons.length) reasons.push("平台接单方");
    recs.push({
      kind: "applicant",
      refId: prof.organizationId,
      title: `接单方 ${prof.organizationId.slice(0, 8)}`,
      score,
      reasons,
    });
  }
  return recs
    .sort((a, b) => b.score - a.score || a.refId.localeCompare(b.refId))
    .slice(0, limit);
}

export function computeMatches(
  actor: MatchActor,
  postings: PostingPublic[],
  applications: ApplicationPublic[],
  nowMs: number,
): MatchResult {
  const recs: Recommendation[] = [];
  // MCN 侧推荐（任何组织都可作为接单方）。
  recs.push(...recommendPostingsForMcn(actor, postings, nowMs, 5));
  // 厂商侧推荐（仅当我方有公开需求时）。
  if (actor.myOpenPostingCategories.length) {
    const { profiles } = computeApplicantProfiles(applications, postings, 20);
    recs.push(...recommendApplicantsForVendor(actor, profiles, 5));
  }
  return {
    recommendations: recs,
    sourceRef: "marketplace_postings+applications(public)",
  };
}
