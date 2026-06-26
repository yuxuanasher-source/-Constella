// 供需撮合论坛领域类型。金额一律「分」(cents) 整数；私有字段(联系方式/达成后披露)
// 不进公开 DTO，只在 owner / 已达成对家的明细查询里返回。

import type { ApplicationStatus, PostingStatus } from "./marketplace-state";

export type PostingPublic = {
  id: string;
  organizationId: string;
  postType: "demand" | "supply";
  status: PostingStatus;
  title: string;
  productName: string | null;
  category: string | null;
  budgetCents: number | null;
  settlementMethod: string | null;
  requirements: string | null;
  description: string | null;
  deadlineAt: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationPublic = {
  id: string;
  postingId: string;
  applicantOrganizationId: string;
  status: ApplicationStatus;
  streamerLineup: string | null;
  pastCases: string | null;
  quoteCents: number | null;
  resources: string | null;
  message: string | null;
  reviewNote: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DealRecord = {
  id: string;
  postingId: string;
  applicationId: string;
  ownerOrganizationId: string;
  applicantOrganizationId: string;
  status: "pending_collaboration" | "collaboration_active" | "cancelled";
  collaborationApplicationId: string | null;
  collaborationAgreementId: string | null;
  collaborationShareId: string | null;
  collaborationShareToken: string | null;
  createdAt: string;
};

export type CreatePostingInput = {
  postType?: "demand" | "supply";
  title: string;
  productName?: string | null;
  category?: string | null;
  budgetCents?: number | null;
  settlementMethod?: string | null;
  requirements?: string | null;
  description?: string | null;
  deadlineAt?: string | null;
  details?: Record<string, unknown>;
  contact?: string | null;
  discloseAfterDeal?: Record<string, unknown>;
  publish?: boolean; // true → 直接 open，false → draft
};

export type SubmitApplicationInput = {
  streamerLineup?: string | null;
  pastCases?: string | null;
  quoteCents?: number | null;
  resources?: string | null;
  message?: string | null;
  contact?: string | null;
};

export type PublicPostingFilters = {
  category?: string | null;
  postType?: "demand" | "supply" | null;
  search?: string | null;
  limit?: number;
};
