import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260623130000_mcn_collaboration.sql",
  ),
  "utf8",
);

describe("mcn collaboration schema contract", () => {
  it("declares the collaboration enums and tables", () => {
    expect(migration).toContain("create type public.collaboration_status");
    expect(migration).toContain(
      "create type public.collaboration_settlement_mode",
    );
    expect(migration).toContain(
      "create type public.collaboration_submission_status",
    );
    expect(migration).toContain("create table public.project_collaborations");
    expect(migration).toContain(
      "create table public.collaboration_submissions",
    );
  });

  it("keeps the settlement mode CHECK and forbids self-partnering", () => {
    expect(migration).toContain("project_collaborations_share_valid");
    expect(migration).toContain(
      "project_collaborations_self_partner_forbidden",
    );
  });

  it("adds the cross-org access helpers", () => {
    expect(migration).toContain(
      "function public.is_active_partner_collaborator",
    );
    expect(migration).toContain(
      "function public.can_access_collaborated_project",
    );
    expect(migration).toContain("function public.accept_collaboration");
  });

  it("enforces host-only review at the database layer", () => {
    expect(migration).toContain(
      "function public.enforce_collaboration_review_authority",
    );
    expect(migration).toContain("collaboration_submissions_enforce_review");
    expect(migration).toContain(
      "Only host organization staff can review collaboration submissions",
    );
  });

  it("enables RLS and only widens SELECT for active partner collaborators", () => {
    expect(migration).toContain(
      "alter table public.project_collaborations enable row level security",
    );
    expect(migration).toContain(
      "alter table public.collaboration_submissions enable row level security",
    );
    // partner read-only widening, never write
    expect(migration).toContain("live_tasks_partner_collaborator_read");
    expect(migration).toContain("live_reports_partner_collaborator_read");
    expect(migration).toContain("project_streamers_partner_collaborator_read");
    expect(migration).toContain("projects_partner_collaborator_read");
  });

  it("does not widen settlement tables to partners", () => {
    expect(migration).not.toContain("settlement_batches_partner");
    expect(migration).not.toContain("settlement_batch_items_partner");
  });
});
