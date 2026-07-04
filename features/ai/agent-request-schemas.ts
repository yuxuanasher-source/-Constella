import { z } from "zod";

// AI 诊断类路由的请求契约唯一来源。原则(方案 WP1):路由只接收 ID 与用户
// 参数,业务事实一律由服务端在组织隔离下取数;what-if 类计算参数(定价、
// 选播筛选条件)是合法用户输入,但必须过 schema 校验。briefs 与 copilot
// 共用同一组 schema,保证专属路由与 copilot 分发不出现口径分叉。

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const projectReviewRequestSchema = z.object({
  projectId: z.string().uuid(),
  periodStart: isoDateSchema.optional(),
  periodEnd: isoDateSchema.optional(),
  targetMarginBps: z.number().int().min(0).max(10000).optional(),
});

export type ProjectReviewRequest = z.infer<typeof projectReviewRequestSchema>;

// 与 app/api/war-room/pricing 的计算器输入同形;定价是 what-if 计算器,
// 参数本身就是用户假设,不需要服务端取数。
export const pricingInputSchema = z.object({
  vendorSettlementMethod: z.enum([
    "cpt",
    "fixed_budget",
    "base_salary",
    "base_salary_cpt",
  ]),
  streamerCount: z.number().int().nonnegative(),
  estimatedMinutesPerStreamer: z.number().int().nonnegative(),
  vendorBudgetCents: z.number().int().nullable().optional(),
  vendorHourlyRateCents: z.number().int().nullable().optional(),
  vendorBaseFeeCents: z.number().int().nullable().optional(),
  streamerHourlyCostCents: z.number().int().nullable().optional(),
  streamerBaseCostCents: z.number().int().nullable().optional(),
  supplierCostCents: z.number().int().nullable().optional(),
  expectedManualRevenueCents: z.number().int().nullable().optional(),
  platformFeeBps: z.number().int().nullable().optional(),
  manualAdjustmentCents: z.number().int().nullable().optional(),
  targetMarginBps: z.number().int().nullable().optional(),
});

// 选播的 matching 是筛选条件(用户输入),candidates 必须服务端取数。
export const castingMatchingSchema = z.object({
  category: z.string().trim().min(1).max(60).default("unknown"),
  platform: z.string().trim().min(1).max(60).default("unknown"),
  preferredStyles: z
    .array(z.string().trim().min(1).max(60))
    .max(20)
    .default([]),
  requiredMinutes: z
    .number()
    .int()
    .nonnegative()
    .max(60 * 24 * 90),
});

export const castingRequestSchema = z.object({
  matching: castingMatchingSchema,
  candidateIds: z.array(z.string().uuid()).max(50).optional(),
  maxRecommendations: z.number().int().positive().max(20).optional(),
});

export type CastingRequest = z.infer<typeof castingRequestSchema>;

export const aiBriefRequestSchema = z.discriminatedUnion("kind", [
  castingRequestSchema.extend({ kind: z.literal("casting") }),
  pricingInputSchema.extend({ kind: z.literal("pricing") }),
]);

// 话术优化的脚本文本与反馈是被优化的用户素材,属于合法输入;仅做形状与
// 长度校验,防止把整站数据当 payload 塞进来。
export const scriptOptimizationRequestSchema = z.object({
  scriptKey: z.string().trim().min(1).max(120),
  version: z.number().int().nonnegative(),
  currentScript: z.string().max(20_000),
  diagnosisType: z.string().trim().max(60).optional(),
  feedback: z.array(z.string().max(2_000)).max(50).optional(),
  replayNotes: z.array(z.string().max(2_000)).max(50).optional(),
  // 脚本引用的主播/项目 ID 只做形状校验:它们随草稿落库,归属校验由
  // RLS 承担,不是事实信任根。
  streamerId: z.string().trim().min(1).max(64).optional(),
  projectId: z.string().trim().min(1).max(64).optional(),
});

export const copilotRequestSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("pricing_tradeoff"),
    payload: pricingInputSchema,
  }),
  z.object({
    intent: z.literal("casting_advice"),
    payload: castingRequestSchema,
  }),
  z.object({
    intent: z.literal("project_review"),
    payload: projectReviewRequestSchema,
  }),
  z.object({
    intent: z.literal("script_optimization"),
    payload: scriptOptimizationRequestSchema,
  }),
]);

export type CopilotRequest = z.infer<typeof copilotRequestSchema>;
