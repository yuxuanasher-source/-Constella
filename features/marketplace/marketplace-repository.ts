// Supabase 实现的撮合论坛仓储（走 RLS：发布 / 投递 / 审核 / 达成均在调用方身份下）。
// 列裁剪：公开查询只 select 公开列；私有表单独 upsert。

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  APPLICATION_PUBLIC_COLUMNS,
  DEAL_COLUMNS,
  POSTING_PUBLIC_COLUMNS,
  toApplicationPublic,
  toDealRecord,
  toPostingPublic,
} from "./marketplace-dto";
import type { RepoPort } from "./marketplace-service";
import type {
  ApplicationPublic,
  DealRecord,
  PostingPublic,
  PublicPostingFilters,
} from "./marketplace-types";

export class SupabaseMarketplaceRepository implements RepoPort {
  constructor(private readonly client: SupabaseClient) {}

  async getPostingById(id: string): Promise<PostingPublic | null> {
    const { data, error } = await this.client
      .from("marketplace_postings")
      .select(POSTING_PUBLIC_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return toPostingPublic(data);
  }

  // 公开广场列表（RLS 已限定仅公开状态 + 平台 MCN 可读）。
  async listPublicPostings(
    filters: PublicPostingFilters,
  ): Promise<PostingPublic[]> {
    let query = this.client
      .from("marketplace_postings")
      .select(POSTING_PUBLIC_COLUMNS)
      .in("status", ["open", "matched"]);
    if (filters.category) query = query.eq("category", filters.category);
    if (filters.postType) query = query.eq("post_type", filters.postType);
    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.or(
        `title.ilike.${term},product_name.ilike.${term},description.ilike.${term}`,
      );
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(Math.min(filters.limit ?? 50, 100));
    if (error || !data) return [];
    return data.map(toPostingPublic);
  }

  async listMyPostings(organizationId: string): Promise<PostingPublic[]> {
    const { data, error } = await this.client
      .from("marketplace_postings")
      .select(POSTING_PUBLIC_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error || !data) return [];
    return data.map(toPostingPublic);
  }

  async createPosting(
    input: Parameters<RepoPort["createPosting"]>[0],
  ): Promise<PostingPublic> {
    const { data, error } = await this.client
      .from("marketplace_postings")
      .insert({
        organization_id: input.organizationId,
        created_by: input.createdBy,
        post_type: input.postType,
        status: input.status,
        title: input.title,
        product_name: input.productName,
        category: input.category,
        budget_cents: input.budgetCents,
        settlement_method: input.settlementMethod,
        requirements: input.requirements,
        description: input.description,
        deadline_at: input.deadlineAt,
        details: input.details,
      })
      .select(POSTING_PUBLIC_COLUMNS)
      .single();
    if (error || !data) {
      throw new Error(error?.message || "Failed to create posting");
    }
    return toPostingPublic(data);
  }

  async upsertPostingPrivate(
    input: Parameters<RepoPort["upsertPostingPrivate"]>[0],
  ): Promise<void> {
    await this.client.from("marketplace_posting_private").upsert(
      {
        posting_id: input.postingId,
        organization_id: input.organizationId,
        contact: input.contact,
        disclose_after_deal: input.discloseAfterDeal,
      },
      { onConflict: "posting_id" },
    );
  }

  async updatePostingStatus(id: string, status: string): Promise<void> {
    await this.client
      .from("marketplace_postings")
      .update({ status })
      .eq("id", id);
  }

  async getApplicationById(id: string): Promise<ApplicationPublic | null> {
    const { data, error } = await this.client
      .from("marketplace_applications")
      .select(APPLICATION_PUBLIC_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return toApplicationPublic(data);
  }

  async listApplicationsForPosting(
    postingId: string,
  ): Promise<ApplicationPublic[]> {
    const { data, error } = await this.client
      .from("marketplace_applications")
      .select(APPLICATION_PUBLIC_COLUMNS)
      .eq("posting_id", postingId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !data) return [];
    return data.map(toApplicationPublic);
  }

  async listMyApplications(
    organizationId: string,
  ): Promise<ApplicationPublic[]> {
    const { data, error } = await this.client
      .from("marketplace_applications")
      .select(APPLICATION_PUBLIC_COLUMNS)
      .eq("applicant_organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !data) return [];
    return data.map(toApplicationPublic);
  }

  async createApplication(
    input: Parameters<RepoPort["createApplication"]>[0],
  ): Promise<ApplicationPublic> {
    const { data, error } = await this.client
      .from("marketplace_applications")
      .insert({
        posting_id: input.postingId,
        applicant_organization_id: input.applicantOrganizationId,
        created_by: input.createdBy,
        status: input.status,
        streamer_lineup: input.streamerLineup,
        past_cases: input.pastCases,
        quote_cents: input.quoteCents,
        resources: input.resources,
        message: input.message,
        submitted_at: input.submittedAt,
      })
      .select(APPLICATION_PUBLIC_COLUMNS)
      .single();
    if (error || !data) {
      throw new Error(error?.message || "Failed to create application");
    }
    return toApplicationPublic(data);
  }

  async updateApplication(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<ApplicationPublic> {
    const { data, error } = await this.client
      .from("marketplace_applications")
      .update(patch)
      .eq("id", id)
      .select(APPLICATION_PUBLIC_COLUMNS)
      .single();
    if (error || !data) {
      throw new Error(error?.message || "Failed to update application");
    }
    return toApplicationPublic(data);
  }

  async upsertApplicationPrivate(
    input: Parameters<RepoPort["upsertApplicationPrivate"]>[0],
  ): Promise<void> {
    await this.client.from("marketplace_application_private").upsert(
      {
        application_id: input.applicationId,
        applicant_organization_id: input.applicantOrganizationId,
        contact: input.contact,
      },
      { onConflict: "application_id" },
    );
  }

  async createDeal(
    input: Parameters<RepoPort["createDeal"]>[0],
  ): Promise<DealRecord> {
    const { data, error } = await this.client
      .from("marketplace_deals")
      .insert({
        posting_id: input.postingId,
        application_id: input.applicationId,
        owner_organization_id: input.ownerOrganizationId,
        applicant_organization_id: input.applicantOrganizationId,
        created_by: input.createdBy,
      })
      .select(DEAL_COLUMNS)
      .single();
    if (error || !data) {
      throw new Error(error?.message || "Failed to create deal");
    }
    return toDealRecord(data);
  }
}
