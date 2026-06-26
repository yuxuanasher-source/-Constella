// DB 行 → 领域对象映射。公开 DTO 只含公开字段；联系方式 / 达成后披露不在此层返回
// （它们走独立私有表与单独查询，沿用 toSafeShare 的「选列即遮挡」范式）。

import type {
  ApplicationPublic,
  DealRecord,
  PostingPublic,
} from "./marketplace-types";
import type { ApplicationStatus, PostingStatus } from "./marketplace-state";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.length ? v : null;
const intOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function toPostingPublic(row: Row): PostingPublic {
  return {
    id: str(row.id),
    organizationId: str(row.organization_id),
    postType: row.post_type === "supply" ? "supply" : "demand",
    status: str(row.status) as PostingStatus,
    title: str(row.title),
    productName: strOrNull(row.product_name),
    category: strOrNull(row.category),
    budgetCents: intOrNull(row.budget_cents),
    settlementMethod: strOrNull(row.settlement_method),
    requirements: strOrNull(row.requirements),
    description: strOrNull(row.description),
    deadlineAt: strOrNull(row.deadline_at),
    details: obj(row.details),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function toApplicationPublic(row: Row): ApplicationPublic {
  return {
    id: str(row.id),
    postingId: str(row.posting_id),
    applicantOrganizationId: str(row.applicant_organization_id),
    status: str(row.status) as ApplicationStatus,
    streamerLineup: strOrNull(row.streamer_lineup),
    pastCases: strOrNull(row.past_cases),
    quoteCents: intOrNull(row.quote_cents),
    resources: strOrNull(row.resources),
    message: strOrNull(row.message),
    reviewNote: strOrNull(row.review_note),
    submittedAt: strOrNull(row.submitted_at),
    reviewedAt: strOrNull(row.reviewed_at),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function toDealRecord(row: Row): DealRecord {
  return {
    id: str(row.id),
    postingId: str(row.posting_id),
    applicationId: str(row.application_id),
    ownerOrganizationId: str(row.owner_organization_id),
    applicantOrganizationId: str(row.applicant_organization_id),
    status: str(row.status) as DealRecord["status"],
    collaborationApplicationId: strOrNull(row.collaboration_application_id),
    collaborationAgreementId: strOrNull(row.collaboration_agreement_id),
    collaborationShareId: strOrNull(row.collaboration_share_id),
    collaborationShareToken: strOrNull(row.collaboration_share_token),
    createdAt: str(row.created_at),
  };
}

// 公开列裁剪：列表 / 详情统一只 select 这些列，私有表另查。
export const POSTING_PUBLIC_COLUMNS =
  "id, organization_id, post_type, status, title, product_name, category, budget_cents, settlement_method, requirements, description, deadline_at, details, created_at, updated_at";

export const APPLICATION_PUBLIC_COLUMNS =
  "id, posting_id, applicant_organization_id, status, streamer_lineup, past_cases, quote_cents, resources, message, review_note, submitted_at, reviewed_at, created_at, updated_at";

export const DEAL_COLUMNS =
  "id, posting_id, application_id, owner_organization_id, applicant_organization_id, status, collaboration_application_id, collaboration_agreement_id, collaboration_share_id, collaboration_share_token, created_at";
