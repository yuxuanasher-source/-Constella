# Recording Share Business Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有录屏分享链接升级为可主动选录屏、支持预览/正式复核双模式、具备服务端草稿、原子提交、提交锁定、重开轮次、单条视频异常隔离和运营结果待办的完整业务闭环。

**Architecture:** 保留 `project_applications`、`recording_submissions`、`project_recording_share_boards` 和现有公开 token 路由；在录屏版本上增加不可变 MCN 内审事实，在分享看板上增加模式、复核状态和轮次，并用受约束的数据库 RPC 原子保存草稿、创建分享及完成正式提交。运营端新增独立分享中心组件，甲方端把现有纵向卡片拆成聚焦式复核工作台；所有新公开接口继续通过 token、访问会话和服务端管理员客户端访问，公开 DTO 保持白名单。

**Tech Stack:** Next.js App Router、React 19、TypeScript、Supabase/PostgreSQL、Vitest、Testing Library、Tailwind CSS、现有审计与访问会话基础设施。

---

## 0. 执行约束

- 所有命令从独立实施工作树根目录运行；不要在设计工作树或主工作区直接实施。
- 实施分支必须从执行时最新的 `origin/codex/full-project-ui` 创建。
- 每个任务严格执行 RED → GREEN → REFACTOR → COMMIT。
- 不修改财务、结算、入项确认和外部账号体系。
- `selected` 只能进入 MCN 最终确认，不能自动创建 `project_streamers`。
- 分享 token 数据库只保存哈希；创建或轮换成功时明文只返回一次。
- 旧链接丢失时只能轮换新 token；轮换后旧 token 和访问会话立即失效。
- 每次提交前运行任务内列出的聚焦测试和 `git diff --check`。

## 1. 文件职责映射

### 数据库

- Create: `supabase/migrations/20260730120000_admission_share_business_workflow.sql`
  - 增加不可变 MCN 内审字段、分享模式/状态/轮次、草稿、提交快照、事件和播放问题表。
- Create: `supabase/migrations/20260730123000_admission_share_create_rpc.sql`
  - 原子创建分享任务和分享项，处理正式轮次唯一性。
- Create: `supabase/migrations/20260730130000_admission_share_draft_rpc.sql`
  - 以修订号 CAS 保存服务端草稿。
- Create: `supabase/migrations/20260730133000_admission_share_submit_rpc.sql`
  - 完整校验并原子生成正式提交快照、最新甲方结果及状态回流。
- Create: `supabase/migrations/20260730140000_admission_share_lifecycle_rpc.sql`
  - 延期、撤销、重开、token 轮换和访问会话失效。
- Create: `supabase/migrations/20260730143000_admission_share_playback_issue_rpc.sql`
  - 受限解决播放问题，只允许更新状态、解决人和解决时间。

### 领域与数据访问

- Create: `features/applications/admission-share-workflow.ts`
  - 双模式、来源健康度、候选资格、逐条预检、完整提交验证和稳定错误类型。
- Create: `features/applications/admission-share-candidates.ts`
  - 查询项目全部录屏版本并生成安全候选 DTO。
- Modify: `features/applications/application-service.ts`
  - 在 MCN 审核时写入版本级不可变事实。
- Modify: `features/applications/application-repository.ts`
  - 读取和写入 `mcn_review_*` 字段。
- Modify: `features/applications/admission-share-board.ts`
  - 扩展分享记录、仓储方法、创建、草稿、提交、生命周期和公开 DTO。
- Modify: `features/applications/admission-board.ts`
  - 输出分享任务摘要、明确进度和下一步待办。
- Modify: `lib/audit/audit.ts`
  - 增加延期、重开、token 轮换和播放问题处理的审计动作。

### 运营接口

- Create: `app/api/projects/[projectId]/admission-share-candidates/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-candidates/[recordingSubmissionId]/playback/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/preflight/route.ts`
- Modify: `app/api/projects/[projectId]/admission-share-boards/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/extend/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/reopen/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/rotate-token/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/submissions/route.ts`
- Modify: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/revoke/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-playback-issues/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-playback-issues/[issueId]/resolve/route.ts`

### 公开接口

- Modify: `app/api/public/admission-share/[token]/route.ts`
- Create: `app/api/public/admission-share/[token]/drafts/route.ts`
- Create: `app/api/public/admission-share/[token]/drafts/[recordingSubmissionId]/route.ts`
- Modify: `app/api/public/admission-share/[token]/reviews/route.ts`
- Modify: `app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/route.ts`
- Create: `app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/issues/route.ts`
- Modify: `app/api/public/admission-share/public-route-utils.ts`

### 界面

- Create: `components/reference-ui/admission-share-center.jsx`
- Create: `components/reference-ui/admission-share-center.test.jsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Create: `app/share/admission/[token]/admission-share-review-workspace.tsx`
- Create: `app/share/admission/[token]/admission-share-review-workspace.test.tsx`
- Create: `app/share/admission/[token]/admission-share-types.ts`
- Create: `app/share/admission/[token]/admission-share-api.ts`
- Create: `app/share/admission/[token]/admission-share-api.test.ts`
- Modify: `app/share/admission/[token]/admission-share-page-client.tsx`
- Modify: `app/share/admission/[token]/admission-share-page-client.test.tsx`

## Task 1: 建立业务工作流数据库契约

**Files:**

- Create: `lib/db/admission-share-business-workflow-schema-contract.test.ts`
- Create: `supabase/migrations/20260730120000_admission_share_business_workflow.sql`
- Modify: `lib/audit/audit.ts:3-30`

- [ ] **Step 1: 写失败的数据库契约测试**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260730120000_admission_share_business_workflow.sql",
  ),
  "utf8",
).toLowerCase();

describe("admission share business workflow schema", () => {
  it("stores an immutable MCN review fact on each recording version", () => {
    expect(sql).toContain("mcn_review_decision public.recording_review_status");
    expect(sql).toContain("mcn_reviewed_by uuid");
    expect(sql).toContain("mcn_reviewed_at timestamptz");
    expect(sql).toContain("mcn_review_note text");
    expect(sql).toContain("guard_recording_mcn_review_fact");
    expect(sql).toContain("project_recording_share_items");
    expect(sql).toContain("mcn_review_decision");
  });

  it("adds modes, progress, rounds, drafts and immutable submissions", () => {
    expect(sql).toContain("mode text not null default 'formal_review'");
    expect(sql).toContain("review_state text not null default 'not_started'");
    expect(sql).toContain("round_number integer not null default 1");
    expect(sql).toContain("project_recording_vendor_review_drafts");
    expect(sql).toContain("project_recording_vendor_review_submissions");
    expect(sql).toContain("project_recording_vendor_review_submission_items");
  });

  it("creates event and playback issue evidence with staff-only RLS", () => {
    expect(sql).toContain("project_recording_share_events");
    expect(sql).toContain("project_recording_share_playback_issues");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("public.can_access_project(project_id)");
  });

  it("normalizes duplicate legacy formal links before enforcing one open round", () => {
    expect(sql).toMatch(
      /row_number\(\) over \([\s\S]+partition by organization_id, project_id[\s\S]+update public\.project_recording_share_boards/u,
    );
    expect(sql).toContain("project_recording_share_boards_one_open_formal_idx");
  });
});
```

- [ ] **Step 2: 运行测试并确认因迁移不存在而失败**

Run:

```powershell
corepack pnpm test "lib/db/admission-share-business-workflow-schema-contract.test.ts"
```

Expected: FAIL，错误包含 `ENOENT` 和迁移文件名。

- [ ] **Step 3: 创建业务工作流迁移**

迁移必须包含以下精确结构：

```sql
alter table public.recording_submissions
  add column if not exists mcn_review_decision public.recording_review_status,
  add column if not exists mcn_reviewed_by uuid references public.profiles(id),
  add column if not exists mcn_reviewed_at timestamptz,
  add column if not exists mcn_review_note text;

alter table public.recording_submissions
  add constraint recording_submissions_mcn_review_decision_check
  check (
    mcn_review_decision is null
    or mcn_review_decision in ('approved', 'rejected', 'needs_changes')
  );

update public.recording_submissions
set
  mcn_review_decision = status,
  mcn_reviewed_by = reviewed_by,
  mcn_reviewed_at = reviewed_at,
  mcn_review_note = review_note
where mcn_review_decision is null
  and status in ('approved', 'rejected', 'needs_changes')
  and reviewed_at is not null;

update public.recording_submissions as submission
set
  mcn_review_decision = 'approved',
  mcn_reviewed_at = coalesce(
    submission.reviewed_at,
    share_item.created_at,
    submission.updated_at
  ),
  mcn_review_note = coalesce(submission.review_note, '')
from public.project_recording_share_items as share_item
where share_item.recording_submission_id = submission.id
  and submission.mcn_review_decision is null;

create or replace function public.guard_recording_mcn_review_fact()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.mcn_review_decision is not null
     and (
       new.mcn_review_decision is distinct from old.mcn_review_decision
       or new.mcn_reviewed_by is distinct from old.mcn_reviewed_by
       or new.mcn_reviewed_at is distinct from old.mcn_reviewed_at
       or new.mcn_review_note is distinct from old.mcn_review_note
     ) then
    raise exception 'recording_mcn_review_fact_is_immutable';
  end if;
  return new;
end;
$$;

create trigger recording_submissions_guard_mcn_review_fact
before update on public.recording_submissions
for each row execute function public.guard_recording_mcn_review_fact();

alter table public.project_recording_share_boards
  add column if not exists mode text not null default 'formal_review',
  add column if not exists purpose text not null default '',
  add column if not exists review_state text not null default 'not_started',
  add column if not exists round_number integer not null default 1,
  add column if not exists allow_external_fallback boolean not null default true,
  add column if not exists last_draft_at timestamptz,
  add column if not exists locked_at timestamptz,
  add column if not exists current_submission_revision integer not null default 0,
  add column if not exists reopened_by uuid references public.profiles(id),
  add column if not exists reopened_at timestamptz,
  add column if not exists reopen_reason text;

update public.project_recording_share_boards
set
  mode = case
    when allow_vendor_submit then 'formal_review'
    else 'preview'
  end,
  round_number = case
    when allow_vendor_submit then greatest(round_number, 1)
    else 0
  end,
  review_state = case
    when last_submitted_at is not null then 'submitted_locked'
    when last_viewed_at is not null then 'viewed'
    else 'not_started'
  end,
  locked_at = coalesce(locked_at, last_submitted_at),
  current_submission_revision = case
    when last_submitted_at is not null then greatest(current_submission_revision, 1)
    else current_submission_revision
  end;

alter table public.project_recording_share_boards
  add constraint project_recording_share_boards_mode_check
  check (mode in ('preview', 'formal_review')),
  add constraint project_recording_share_boards_review_state_check
  check (
    review_state in (
      'not_started',
      'viewed',
      'in_progress',
      'submitted_locked'
    )
  ),
  add constraint project_recording_share_boards_round_mode_check
  check (
    (mode = 'preview' and round_number = 0)
    or (mode = 'formal_review' and round_number > 0)
  ),
  add constraint project_recording_share_boards_submission_revision_check
  check (current_submission_revision >= 0);

alter table public.project_recording_share_items
  add column if not exists mcn_review_decision public.recording_review_status,
  add column if not exists source_health text,
  add column if not exists allow_external_fallback boolean not null default true;

update public.project_recording_share_items as share_item
set
  mcn_review_decision = submission.mcn_review_decision,
  source_health = case
    when nullif(btrim(submission.storage_path), '') is not null
      and submission.external_url ~* '^https?://'
      then 'original_with_external_fallback'
    when nullif(btrim(submission.storage_path), '') is not null
      then 'original_ready'
    when submission.external_url ~* '^https?://'
      then 'external_only'
    else 'blocked'
  end
from public.recording_submissions as submission
where submission.id = share_item.recording_submission_id;

do $$
begin
  if exists (
    select 1
    from public.project_recording_share_items
    where mcn_review_decision is distinct from 'approved'
  ) then
    raise exception 'legacy_admission_share_item_backfill_failed';
  end if;
end;
$$;

alter table public.project_recording_share_items
  alter column mcn_review_decision set not null,
  alter column source_health set not null;

alter table public.project_recording_share_items
  add constraint project_recording_share_items_mcn_approved_check
  check (mcn_review_decision = 'approved'),
  add constraint project_recording_share_items_source_health_check
  check (
    source_health in (
      'original_ready',
      'original_with_external_fallback',
      'external_only',
      'blocked'
    )
  );

create table public.project_recording_vendor_review_drafts (
  share_board_id uuid not null
    references public.project_recording_share_boards(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  project_id uuid not null
    references public.projects(id) on delete cascade,
  application_id uuid not null
    references public.project_applications(id) on delete cascade,
  recording_submission_id uuid not null
    references public.recording_submissions(id) on delete cascade,
  recording_version integer not null,
  decision text not null default 'pending',
  remark text not null default '',
  reason_codes text[] not null default '{}',
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (share_board_id, recording_submission_id),
  constraint project_recording_vendor_review_drafts_decision_check
    check (
      decision in (
        'pending',
        'selected',
        'backup',
        'rejected',
        'needs_changes'
      )
    ),
  constraint project_recording_vendor_review_drafts_revision_check
    check (revision >= 0)
);

create table public.project_recording_vendor_review_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  share_board_id uuid not null
    references public.project_recording_share_boards(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  project_id uuid not null
    references public.projects(id) on delete cascade,
  revision integer not null,
  project_remark text not null default '',
  selected_count integer not null default 0,
  backup_count integer not null default 0,
  rejected_count integer not null default 0,
  needs_changes_count integer not null default 0,
  submitted_at timestamptz not null default now(),
  unique (share_board_id, revision),
  constraint project_recording_vendor_review_submissions_revision_check
    check (revision > 0),
  constraint project_recording_vendor_review_submissions_counts_check
    check (
      selected_count >= 0
      and backup_count >= 0
      and rejected_count >= 0
      and needs_changes_count >= 0
    )
);

create table public.project_recording_vendor_review_submission_items (
  id uuid primary key default extensions.gen_random_uuid(),
  submission_id uuid not null
    references public.project_recording_vendor_review_submissions(id)
    on delete cascade,
  share_board_id uuid not null
    references public.project_recording_share_boards(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  project_id uuid not null
    references public.projects(id) on delete cascade,
  application_id uuid not null
    references public.project_applications(id) on delete cascade,
  recording_submission_id uuid not null
    references public.recording_submissions(id) on delete cascade,
  recording_version integer not null,
  decision text not null,
  remark text not null default '',
  reason_codes text[] not null default '{}',
  sync_status text not null,
  sync_error text,
  created_at timestamptz not null default now(),
  unique (submission_id, recording_submission_id),
  constraint project_recording_vendor_review_submission_items_decision_check
    check (decision in ('selected', 'backup', 'rejected', 'needs_changes')),
  constraint project_recording_vendor_review_submission_items_sync_check
    check (sync_status in ('synced', 'skipped'))
);

create table public.project_recording_share_events (
  id uuid primary key default extensions.gen_random_uuid(),
  share_board_id uuid not null
    references public.project_recording_share_boards(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  project_id uuid not null
    references public.projects(id) on delete cascade,
  event_type text not null,
  actor_type text not null,
  actor_user_id uuid references public.profiles(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint project_recording_share_events_actor_type_check
    check (actor_type in ('staff', 'public', 'system')),
  constraint project_recording_share_events_event_type_check
    check (
      event_type in (
        'created',
        'viewed',
        'draft_saved',
        'submitted',
        'extended',
        'reopened',
        'token_rotated',
        'revoked',
        'playback_issue_reported',
        'playback_issue_resolved'
      )
    )
);

create table public.project_recording_share_playback_issues (
  id uuid primary key default extensions.gen_random_uuid(),
  share_board_id uuid not null
    references public.project_recording_share_boards(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  project_id uuid not null
    references public.projects(id) on delete cascade,
  recording_submission_id uuid not null
    references public.recording_submissions(id) on delete cascade,
  source_type text not null,
  error_code text not null,
  user_agent_family text not null default '',
  status text not null default 'open',
  reported_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  constraint project_recording_share_playback_issues_source_check
    check (source_type in ('original', 'external', 'none')),
  constraint project_recording_share_playback_issues_status_check
    check (status in ('open', 'resolved'))
);
```

紧接上段 SQL 添加索引、旧数据收敛、RLS 和审计枚举；不要把这些留到其他迁移：

```sql
create index project_recording_vendor_review_drafts_project_idx
  on public.project_recording_vendor_review_drafts(project_id, updated_at desc);
create index project_recording_vendor_review_submissions_project_idx
  on public.project_recording_vendor_review_submissions(project_id, submitted_at desc);
create index project_recording_vendor_review_submission_items_board_idx
  on public.project_recording_vendor_review_submission_items(share_board_id, created_at desc);
create index project_recording_share_events_board_idx
  on public.project_recording_share_events(share_board_id, created_at desc);
create index project_recording_share_playback_issues_project_status_idx
  on public.project_recording_share_playback_issues(project_id, status, reported_at desc);

with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id, project_id
      order by created_at desc, id desc
    ) as position
  from public.project_recording_share_boards
  where mode = 'formal_review'
    and status = 'active'
    and locked_at is null
)
update public.project_recording_share_boards as board
set status = 'revoked', revoked_at = coalesce(board.revoked_at, now())
from ranked
where ranked.id = board.id
  and ranked.position > 1;

create unique index project_recording_share_boards_one_open_formal_idx
  on public.project_recording_share_boards(organization_id, project_id)
  where mode = 'formal_review'
    and status = 'active'
    and locked_at is null;

alter table public.project_recording_vendor_review_drafts enable row level security;
alter table public.project_recording_vendor_review_submissions enable row level security;
alter table public.project_recording_vendor_review_submission_items enable row level security;
alter table public.project_recording_share_events enable row level security;
alter table public.project_recording_share_playback_issues enable row level security;

create policy project_recording_vendor_review_drafts_staff_select
on public.project_recording_vendor_review_drafts for select
using (
  public.is_org_member(organization_id)
  and public.can_access_project(project_id)
);

create policy project_recording_vendor_review_submissions_staff_select
on public.project_recording_vendor_review_submissions for select
using (
  public.is_org_member(organization_id)
  and public.can_access_project(project_id)
);

create policy project_recording_vendor_review_submission_items_staff_select
on public.project_recording_vendor_review_submission_items for select
using (
  public.is_org_member(organization_id)
  and public.can_access_project(project_id)
);

create policy project_recording_share_events_staff_select
on public.project_recording_share_events for select
using (
  public.is_org_member(organization_id)
  and public.can_access_project(project_id)
);

create policy project_recording_share_playback_issues_staff_select
on public.project_recording_share_playback_issues for select
using (
  public.is_org_member(organization_id)
  and public.can_access_project(project_id)
);

alter type public.audit_action add value if not exists 'extend_share_board';
alter type public.audit_action add value if not exists 'reopen_share_board';
alter type public.audit_action add value if not exists 'rotate_share_board_token';
alter type public.audit_action add value if not exists 'resolve_share_playback_issue';
```

草稿、提交快照、公开事件和播放问题的创建仍由服务端管理员客户端完成，因此不增加客户端 INSERT policy；播放问题也不增加通用 UPDATE policy，Task 12 通过只更新解决字段的受限 RPC 处理，避免工作人员直接改写原始错误证据。

- [ ] **Step 4: 扩展 TypeScript 审计动作联合类型**

```ts
export type AuditAction =
  | "create"
  | "update"
  | "approve"
  | "reject"
  | "export"
  | "lock"
  | "reopen"
  | "login"
  | "logout"
  | "publish"
  | "void"
  | "create_share_board"
  | "revoke_share_board"
  | "extend_share_board"
  | "reopen_share_board"
  | "rotate_share_board_token"
  | "resolve_share_playback_issue"
  | "vendor_review_submit"
  | "vendor_review_sync"
  | "enable_collaboration"
  | "disable_collaboration"
  | "create_collaboration_share"
  | "revoke_collaboration_share"
  | "submit_collaboration_application"
  | "review_collaboration_application"
  | "confirm_collaboration_counter"
  | "activate_collaboration_agreement";
```

- [ ] **Step 5: 运行数据库契约测试**

Run:

```powershell
corepack pnpm test "lib/db/admission-share-business-workflow-schema-contract.test.ts" "lib/db/admission-share-public-security-schema-contract.test.ts" "lib/db/admission-share-access-rate-limit-contract.test.ts"
```

Expected: 3 files PASS。

- [ ] **Step 6: 提交**

```powershell
git add "supabase/migrations/20260730120000_admission_share_business_workflow.sql" "lib/db/admission-share-business-workflow-schema-contract.test.ts" "lib/audit/audit.ts"
git commit -m "feat: add admission share workflow schema"
```

## Task 2: 在 MCN 审核时写入不可变版本事实

**Files:**

- Modify: `features/applications/application-service.ts:74-84,116-181,483-597`
- Modify: `features/applications/application-repository.ts:65-117,390-415,544-557`
- Modify: `features/applications/application-service.test.ts`
- Modify: `features/applications/application-repository.test.ts`

- [ ] **Step 1: 写失败的服务测试**

在 `reviewRecordingSubmission` 的通过用例中增加：

```ts
expect(repo.updateRecordingReview).toHaveBeenCalledWith("recording-1", {
  status: "approved",
  reviewedBy: operatorActor.userId,
  reviewedAt: expect.any(String),
  reviewNote: "Recording meets the project gate.",
  mcnReviewDecision: "approved",
  mcnReviewedBy: operatorActor.userId,
  mcnReviewedAt: expect.any(String),
  mcnReviewNote: "Recording meets the project gate.",
});
```

增加仓储映射测试：

```ts
expect(recording).toMatchObject({
  id: "recording-1",
  mcnReviewDecision: "approved",
  mcnReviewedBy: "operator-1",
  mcnReviewedAt: "2026-07-30T08:00:00.000Z",
  mcnReviewNote: "通过内审",
});
```

- [ ] **Step 2: 运行测试并确认字段缺失**

Run:

```powershell
corepack pnpm test "features/applications/application-service.test.ts" "features/applications/application-repository.test.ts"
```

Expected: FAIL，`updateRecordingReview` 调用和映射缺少 `mcnReview*`。

- [ ] **Step 3: 扩展领域记录和仓储输入**

```ts
export type RecordingSubmissionRecord = {
  id: string;
  applicationId: string;
  version: number;
  status: RecordingReviewStatus;
  uploadedBy: string | null;
  mcnReviewDecision?: Extract<
    RecordingReviewStatus,
    "approved" | "rejected" | "needs_changes"
  > | null;
  mcnReviewedBy?: string | null;
  mcnReviewedAt?: string | null;
  mcnReviewNote?: string | null;
  collaborationId?: string | null;
  contributorOrganizationId?: string | null;
  selfScoreTotal?: number | null;
  selfAssessmentLevel?: RecordingSelfAssessmentLevel | null;
};
```

把 `ApplicationRepository.updateRecordingReview` 输入扩展为：

```ts
{
  status: RecordingReviewStatus;
  reviewedBy: string;
  reviewedAt: string;
  reviewNote?: string;
  mcnReviewDecision: Extract<
    RecordingReviewStatus,
    "approved" | "rejected" | "needs_changes"
  >;
  mcnReviewedBy: string;
  mcnReviewedAt: string;
  mcnReviewNote?: string;
}
```

- [ ] **Step 4: 在同一次 MCN 审核更新中写入不可变字段**

```ts
const reviewedRecording = await repo.updateRecordingReview(latest.id, {
  status: input.decision,
  reviewedBy: actor.userId,
  reviewedAt: now,
  reviewNote: note,
  mcnReviewDecision: input.decision,
  mcnReviewedBy: actor.userId,
  mcnReviewedAt: now,
  mcnReviewNote: note,
});
```

仓储更新 payload：

```ts
{
  status: input.status,
  reviewed_by: input.reviewedBy,
  reviewed_at: input.reviewedAt,
  review_note: input.reviewNote,
  mcn_review_decision: input.mcnReviewDecision,
  mcn_reviewed_by: input.mcnReviewedBy,
  mcn_reviewed_at: input.mcnReviewedAt,
  mcn_review_note: input.mcnReviewNote,
}
```

把 `mcn_review_decision`、`mcn_reviewed_by`、`mcn_reviewed_at`、`mcn_review_note` 加入 `RecordingSubmissionRow`、`recordingSubmissionSelect` 和 `toRecordingSubmissionRecord`。

- [ ] **Step 5: 运行聚焦测试**

Run:

```powershell
corepack pnpm test "features/applications/application-service.test.ts" "features/applications/application-repository.test.ts" "app/api/applications/[applicationId]/review/route.test.ts"
```

Expected: 3 files PASS。

- [ ] **Step 6: 提交**

```powershell
git add "features/applications/application-service.ts" "features/applications/application-repository.ts" "features/applications/application-service.test.ts" "features/applications/application-repository.test.ts"
git commit -m "feat: preserve MCN recording review facts"
```

## Task 3: 建立候选录屏池、来源健康度和逐条预检

**Files:**

- Create: `features/applications/admission-share-workflow.ts`
- Create: `features/applications/admission-share-workflow.test.ts`
- Create: `features/applications/admission-share-candidates.ts`
- Create: `features/applications/admission-share-candidates.test.ts`
- Create: `app/api/projects/[projectId]/admission-share-candidates/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-candidates/route.test.ts`
- Create: `app/api/projects/[projectId]/admission-share-candidates/[recordingSubmissionId]/playback/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-candidates/[recordingSubmissionId]/playback/route.test.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/preflight/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/preflight/route.test.ts`

- [ ] **Step 1: 写失败的纯规则测试**

```ts
import { describe, expect, it } from "vitest";

import {
  classifyAdmissionShareSource,
  preflightAdmissionShareSelection,
} from "./admission-share-workflow";

describe("admission share workflow", () => {
  it("keeps a historically MCN-approved version shareable after vendor rejection", () => {
    expect(
      preflightAdmissionShareSelection(
        [
          {
            applicationId: "app-1",
            recordingSubmissionId: "recording-v1",
            recordingVersion: 1,
            mcnReviewDecision: "approved",
            hasPrivateStorage: true,
            externalUrl: null,
          },
        ],
        [
          {
            applicationId: "app-1",
            recordingSubmissionId: "recording-v1",
            recordingVersion: 1,
            sortOrder: 0,
          },
        ],
      ).items[0],
    ).toMatchObject({ status: "ready", sourceHealth: "original_ready" });
  });

  it("blocks only the invalid selected item", () => {
    const result = preflightAdmissionShareSelection(
      [
        {
          applicationId: "app-1",
          recordingSubmissionId: "ready",
          recordingVersion: 1,
          mcnReviewDecision: "approved",
          hasPrivateStorage: true,
          externalUrl: null,
        },
        {
          applicationId: "app-2",
          recordingSubmissionId: "blocked",
          recordingVersion: 1,
          mcnReviewDecision: null,
          hasPrivateStorage: true,
          externalUrl: null,
        },
      ],
      [
        {
          applicationId: "app-1",
          recordingSubmissionId: "ready",
          recordingVersion: 1,
          sortOrder: 0,
        },
        {
          applicationId: "app-2",
          recordingSubmissionId: "blocked",
          recordingVersion: 1,
          sortOrder: 1,
        },
      ],
    );
    expect(result.summary).toEqual({ ready: 1, warning: 0, blocked: 1 });
    expect(result.items.map((item) => item.status)).toEqual([
      "ready",
      "blocked",
    ]);
  });

  it("marks safe external-only recordings as a warning", () => {
    expect(
      classifyAdmissionShareSource(false, "https://video.example/v1"),
    ).toEqual({
      status: "warning",
      sourceHealth: "external_only",
      reasonCode: "EXTERNAL_ONLY",
    });
  });
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run:

```powershell
corepack pnpm test "features/applications/admission-share-workflow.test.ts"
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现纯类型、来源分类和预检**

```ts
export type AdmissionShareMode = "preview" | "formal_review";
export type AdmissionShareReviewState =
  | "not_started"
  | "viewed"
  | "in_progress"
  | "submitted_locked";
export type AdmissionShareSourceHealth =
  | "original_ready"
  | "original_with_external_fallback"
  | "external_only"
  | "blocked";
export type AdmissionSharePreflightStatus = "ready" | "warning" | "blocked";

export type AdmissionShareSelectionInput = {
  applicationId: string;
  recordingSubmissionId: string;
  recordingVersion: number;
  sortOrder: number;
};

export type AdmissionShareCandidateSource = {
  applicationId: string;
  recordingSubmissionId: string;
  recordingVersion: number;
  mcnReviewDecision: "approved" | "rejected" | "needs_changes" | null;
  hasPrivateStorage: boolean;
  externalUrl: string | null;
};

export function classifyAdmissionShareSource(
  hasPrivateStorage: boolean,
  externalUrl: string | null,
) {
  const hasOriginal = hasPrivateStorage;
  const hasExternal = isSafeExternalUrl(externalUrl);
  if (hasOriginal && hasExternal) {
    return {
      status: "ready" as const,
      sourceHealth: "original_with_external_fallback" as const,
      reasonCode: null,
    };
  }
  if (hasOriginal) {
    return {
      status: "ready" as const,
      sourceHealth: "original_ready" as const,
      reasonCode: null,
    };
  }
  if (hasExternal) {
    return {
      status: "warning" as const,
      sourceHealth: "external_only" as const,
      reasonCode: "EXTERNAL_ONLY" as const,
    };
  }
  return {
    status: "blocked" as const,
    sourceHealth: "blocked" as const,
    reasonCode: "SOURCE_UNAVAILABLE" as const,
  };
}

export function preflightAdmissionShareSelection(
  candidates: AdmissionShareCandidateSource[],
  selections: AdmissionShareSelectionInput[],
) {
  const byRecording = new Map(
    candidates.map((candidate) => [candidate.recordingSubmissionId, candidate]),
  );
  const items = selections
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((selection) => {
      const candidate = byRecording.get(selection.recordingSubmissionId);
      if (
        !candidate ||
        candidate.applicationId !== selection.applicationId ||
        candidate.recordingVersion !== selection.recordingVersion
      ) {
        return {
          ...selection,
          status: "blocked" as const,
          sourceHealth: "blocked" as const,
          reasonCode: "SELECTION_STALE" as const,
        };
      }
      if (candidate.mcnReviewDecision !== "approved") {
        return {
          ...selection,
          status: "blocked" as const,
          sourceHealth: "blocked" as const,
          reasonCode: "MCN_APPROVAL_REQUIRED" as const,
        };
      }
      return {
        ...selection,
        ...classifyAdmissionShareSource(
          candidate.hasPrivateStorage,
          candidate.externalUrl,
        ),
      };
    });
  return {
    items,
    summary: {
      ready: items.filter((item) => item.status === "ready").length,
      warning: items.filter((item) => item.status === "warning").length,
      blocked: items.filter((item) => item.status === "blocked").length,
    },
  };
}

function isSafeExternalUrl(value: string | null) {
  if (!value?.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 写候选查询测试**

测试必须固定以下 DTO：

```ts
expect(candidates).toEqual([
  expect.objectContaining({
    applicationId: "app-1",
    recordingSubmissionId: "recording-v2",
    recordingVersion: 2,
    isLatestVersion: true,
    mcnReviewDecision: "approved",
    sourceHealth: "original_with_external_fallback",
    isShareable: true,
    currentVendorDecision: "rejected",
  }),
  expect.objectContaining({
    applicationId: "app-1",
    recordingSubmissionId: "recording-v1",
    recordingVersion: 1,
    isLatestVersion: false,
    mcnReviewDecision: "approved",
    isShareable: true,
  }),
]);
```

- [ ] **Step 5: 实现候选查询和两个运营路由**

`AdmissionShareCandidateDto` 必须只包含：

```ts
export type AdmissionShareCandidateDto = {
  applicationId: string;
  recordingSubmissionId: string;
  recordingVersion: number;
  isLatestVersion: boolean;
  streamer: {
    id: string;
    displayName: string;
    accountLabel: string;
  };
  mcnReviewDecision: "approved" | "rejected" | "needs_changes" | null;
  mcnReviewedAt: string | null;
  sourceHealth:
    | "original_ready"
    | "original_with_external_fallback"
    | "external_only"
    | "blocked";
  hasPrivateStorage: boolean;
  externalUrl: string | null;
  isShareable: boolean;
  blockReason: string | null;
  currentVendorDecision:
    | "pending"
    | "selected"
    | "backup"
    | "rejected"
    | "needs_changes";
  lastSharedAt: string | null;
};
```

候选查询读取项目下全部 `recording_submissions`，按 `application_id, version desc` 排序，用 `mcn_review_decision === "approved"` 和来源分类决定 `isShareable`。不要使用当前 `project_applications.status` 或当前 `recording_submissions.status` 作为历史版本分享资格。

候选数据访问统一通过：

```ts
export interface AdmissionShareCandidateRepository {
  listCandidates(input: {
    organizationId: string;
    projectId: string;
  }): Promise<AdmissionShareCandidateDto[]>;
  getPlaybackSource(input: {
    organizationId: string;
    projectId: string;
    recordingSubmissionId: string;
  }): Promise<
    | { sourceType: "original"; storagePath: string }
    | { sourceType: "external"; url: string }
  >;
}

export class SupabaseAdmissionShareCandidateRepository implements AdmissionShareCandidateRepository {
  constructor(private readonly supabase: SupabaseClient) {}
}
```

`listAdmissionShareCandidates` 和 `getAdmissionShareCandidatePlayback` 接收该接口；路由统一实例化 `SupabaseAdmissionShareCandidateRepository`。这样 Task 4 创建前复用的是同一份候选查询和资格规则。

候选 GET 路由：

```ts
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const context = await getAdmissionRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError("Only MCN staff can view share candidates", 403);
    }
    const repo = new SupabaseAdmissionShareCandidateRepository(
      context.supabase,
    );
    const candidates = await listAdmissionShareCandidates(repo, {
      projectId,
      organizationId: context.auth.organizationId,
    });
    return NextResponse.json({ candidates });
  } catch (error) {
    return jsonError(error);
  }
}
```

预检 POST 路由读取 `items`，重新查询候选池后返回 `preflightAdmissionShareSelection` 的逐条结果。即使存在 blocked 条目也返回 200，供界面一键移除。

候选播放路由用于生成分享前的 MCN 预览，测试必须固定三条安全边界：

```ts
const request = new Request(
  "https://app.example/api/projects/project-1/admission-share-candidates/recording-v1/playback",
);
const routeParams = {
  params: Promise.resolve({
    projectId: "project-1",
    recordingSubmissionId: "recording-v1",
  }),
};

it("redirects MCN staff to a fresh signed original URL", async () => {
  getAdmissionShareCandidatePlayback.mockResolvedValue({
    sourceType: "original",
    storagePath: "org-1/recordings/project-1/original.mp4",
  });
  createSignedDownloadUrl.mockResolvedValue({
    signedUrl: "https://signed.example/original.mp4",
  });
  const response = await GET(request, routeParams);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "https://signed.example/original.mp4",
  );
});

it("falls back to a safe external URL when no original exists", async () => {
  getAdmissionShareCandidatePlayback.mockResolvedValue({
    sourceType: "external",
    url: "https://video.example/watch/1",
  });
  const response = await GET(request, routeParams);
  expect(response.headers.get("location")).toBe(
    "https://video.example/watch/1",
  );
});

it("rejects a recording from another project", async () => {
  getAdmissionShareCandidatePlayback.mockRejectedValue(
    new RouteError("Recording not found", 404),
  );
  expect((await GET(request, routeParams)).status).toBe(404);
});
```

在 `admission-share-candidates.ts` 增加：

```ts
export async function getAdmissionShareCandidatePlayback(
  repo: AdmissionShareCandidateRepository,
  input: {
    organizationId: string;
    projectId: string;
    recordingSubmissionId: string;
  },
): Promise<
  | { sourceType: "original"; storagePath: string }
  | { sourceType: "external"; url: string }
> {
  return repo.getPlaybackSource(input);
}
```

播放路由必须先走 `getAdmissionRouteContext()` 和 `isMcnStaff`，再调用该函数。`original` 分支复用 `createSignedDownloadUrl({ client: context.supabase, bucket: getPrivateStorageBucket(), path: result.storagePath, expiresInSeconds: 3600 })` 并重定向到 `signedUrl`；`external` 分支重定向到 `result.url`。两种分支均使用 307；不得把 `storagePath` 放进 JSON、查询参数或日志。

- [ ] **Step 6: 运行候选与路由测试**

Run:

```powershell
corepack pnpm test "features/applications/admission-share-workflow.test.ts" "features/applications/admission-share-candidates.test.ts" "app/api/projects/[projectId]/admission-share-candidates/route.test.ts" "app/api/projects/[projectId]/admission-share-candidates/[recordingSubmissionId]/playback/route.test.ts" "app/api/projects/[projectId]/admission-share-boards/preflight/route.test.ts"
```

Expected: 5 files PASS。

- [ ] **Step 7: 提交**

```powershell
git add "features/applications/admission-share-workflow.ts" "features/applications/admission-share-workflow.test.ts" "features/applications/admission-share-candidates.ts" "features/applications/admission-share-candidates.test.ts" "app/api/projects/[projectId]/admission-share-candidates/route.ts" "app/api/projects/[projectId]/admission-share-candidates/route.test.ts" "app/api/projects/[projectId]/admission-share-candidates/[recordingSubmissionId]/playback/route.ts" "app/api/projects/[projectId]/admission-share-candidates/[recordingSubmissionId]/playback/route.test.ts" "app/api/projects/[projectId]/admission-share-boards/preflight/route.ts" "app/api/projects/[projectId]/admission-share-boards/preflight/route.test.ts"
git commit -m "feat: add admission share candidate preflight"
```

## Task 4: 原子创建双模式分享任务

**Files:**

- Create: `lib/db/admission-share-create-schema-contract.test.ts`
- Create: `supabase/migrations/20260730123000_admission_share_create_rpc.sql`
- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Modify: `app/api/projects/[projectId]/admission-share-boards/route.ts`
- Modify: `app/api/projects/[projectId]/admission-share-boards/route.test.ts`

- [ ] **Step 1: 写失败的创建行为测试**

新增服务测试：

```ts
it("creates only the explicitly selected recording versions", async () => {
  candidateRepo.listCandidates.mockResolvedValue([
    {
      applicationId: "app-2",
      recordingSubmissionId: "recording-2-v1",
      recordingVersion: 1,
      isLatestVersion: true,
      streamer: {
        id: "streamer-2",
        displayName: "主播乙",
        accountLabel: "dy_2",
      },
      mcnReviewDecision: "approved",
      mcnReviewedAt: "2026-07-30T07:00:00.000Z",
      sourceHealth: "original_ready",
      hasPrivateStorage: true,
      externalUrl: null,
      isShareable: true,
      blockReason: null,
      currentVendorDecision: "pending",
      lastSharedAt: null,
    },
  ]);
  const result = await createAdmissionShareBoard({
    repo,
    candidateRepo,
    audit,
    actor,
    projectId: "project-1",
    input: {
      mode: "formal_review",
      title: "第一轮正式复核",
      purpose: "品牌方首轮选人",
      requireAccessCode: true,
      allowExternalFallback: true,
      items: [
        {
          applicationId: "app-2",
          recordingSubmissionId: "recording-2-v1",
          recordingVersion: 1,
          sortOrder: 0,
        },
      ],
    },
    tokenFactory: () => "plain-token",
    accessCodeFactory: () => "24681024",
  });
  expect(repo.createShareBoardWithItems).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "formal_review",
      purpose: "品牌方首轮选人",
      items: [
        expect.objectContaining({
          recordingSubmissionId: "recording-2-v1",
          recordingVersion: 1,
        }),
      ],
    }),
  );
  expect(result.accessCode).toBe("24681024");
});

it("returns itemized conflicts instead of silently adding project recordings", async () => {
  candidateRepo.listCandidates.mockResolvedValue([
    {
      applicationId: "app-2",
      recordingSubmissionId: "blocked",
      recordingVersion: 1,
      isLatestVersion: true,
      streamer: {
        id: "streamer-2",
        displayName: "主播乙",
        accountLabel: "dy_2",
      },
      mcnReviewDecision: null,
      mcnReviewedAt: null,
      sourceHealth: "blocked",
      hasPrivateStorage: true,
      externalUrl: null,
      isShareable: false,
      blockReason: "MCN_APPROVAL_REQUIRED",
      currentVendorDecision: "pending",
      lastSharedAt: null,
    },
  ]);
  await expect(
    createAdmissionShareBoard({
      repo,
      candidateRepo,
      audit,
      actor,
      projectId: "project-1",
      input: {
        mode: "formal_review",
        title: "第一轮正式复核",
        items: [
          {
            applicationId: "app-2",
            recordingSubmissionId: "blocked",
            recordingVersion: 1,
            sortOrder: 0,
          },
        ],
      },
      tokenFactory: () => "plain-token",
      accessCodeFactory: () => "24681024",
    }),
  ).rejects.toMatchObject({
    name: "AdmissionShareSelectionError",
    items: [
      expect.objectContaining({
        recordingSubmissionId: "blocked",
        reasonCode: "MCN_APPROVAL_REQUIRED",
      }),
    ],
  });
});
```

路由测试固定请求：

```ts
expect(createAdmissionShareBoard).toHaveBeenCalledWith(
  expect.objectContaining({
    projectId: "project-1",
    input: {
      mode: "preview",
      title: "客户预览",
      purpose: "确认画面",
      expiresAt: "2026-08-06T00:00:00.000Z",
      requireAccessCode: false,
      accessCode: undefined,
      allowExternalFallback: true,
      items: [
        {
          applicationId: "app-1",
          recordingSubmissionId: "recording-v2",
          recordingVersion: 2,
          sortOrder: 0,
        },
      ],
    },
  }),
);
```

- [ ] **Step 2: 运行创建测试并确认失败**

Run:

```powershell
corepack pnpm test "features/applications/admission-share-board.test.ts" "app/api/projects/[projectId]/admission-share-boards/route.test.ts" "lib/db/admission-share-create-schema-contract.test.ts"
```

Expected: FAIL，缺少 RPC 迁移、新输入字段和 `createShareBoardWithItems`。

- [ ] **Step 3: 创建原子创建 RPC**

RPC 签名固定为：

```sql
create or replace function public.create_admission_share_board(
  p_organization_id uuid,
  p_project_id uuid,
  p_title text,
  p_purpose text,
  p_mode text,
  p_token_hash text,
  p_access_code_hash text,
  p_expires_at timestamptz,
  p_allow_external_fallback boolean,
  p_created_by uuid,
  p_items jsonb
)
returns public.project_recording_share_boards
language plpgsql
security invoker
set search_path = pg_catalog, public
```

函数按以下顺序执行并处于同一事务：

1. 验证模式、未来有效期、1–30 天上限和至少一个 item；
2. 验证 `auth.uid()` 非空、`p_created_by = auth.uid()`、`p_organization_id` 与项目一致，并同时满足 `is_mcn_staff(p_organization_id)` 与 `can_access_project(p_project_id)`；
3. 把已过期但仍为 `active` 的任务改成 `expired`；
4. 正式模式检查部分唯一索引；
5. 使用 `jsonb_to_recordset` 校验每个 item 的 application、recording、version、项目和 `mcn_review_decision = 'approved'`；
6. 验证来源至少有私有原始路径或合法 HTTP/HTTPS 外链；
7. 计算项目下下一个正式 `round_number`，预览任务固定为 0；
8. 插入看板；
9. 按传入 `sortOrder` 插入分享项，并保存 `mcn_review_decision`、`source_health` 和备用外链策略；
10. 插入 `created` 事件；
11. 返回新看板。

迁移末尾显式收窄执行权限：

```sql
revoke all on function public.create_admission_share_board(
  uuid, uuid, text, text, text, text, text, timestamptz, boolean, uuid, jsonb
) from public, anon;
grant execute on function public.create_admission_share_board(
  uuid, uuid, text, text, text, text, text, timestamptz, boolean, uuid, jsonb
) to authenticated;
```

契约测试必须断言 `jsonb_to_recordset`、`mcn_review_decision = 'approved'`、`recording_version`、`project_recording_share_items` 和 `project_recording_share_events` 同时存在。

- [ ] **Step 4: 扩展服务类型和创建方法**

`CreateAdmissionShareBoardInput` 改为：

```ts
export type CreateAdmissionShareBoardInput = {
  title?: string;
  purpose?: string;
  mode: AdmissionShareMode;
  expiresAt?: string;
  requireAccessCode?: boolean;
  accessCode?: string;
  allowExternalFallback?: boolean;
  items: AdmissionShareSelectionInput[];
};
```

正式模式默认 `requireAccessCode = true`；未提供自定义码时使用 `randomInt` 生成 8 位数字。`createAdmissionShareBoard` 增加必填 `candidateRepo: AdmissionShareCandidateRepository`，路由使用与候选 GET 相同的 Supabase 实现。服务必须重新读取候选池并调用预检，在 blocked 条目存在时抛出：

```ts
export class AdmissionShareSelectionError extends Error {
  readonly name = "AdmissionShareSelectionError";

  constructor(public readonly items: AdmissionSharePreflightResult["items"]) {
    super("Admission share selection changed");
  }
}
```

`SupabaseAdmissionShareBoardRepository.createShareBoardWithItems` 只调用 `create_admission_share_board` RPC，不再分两次写看板和分享项。

- [ ] **Step 5: 更新创建路由和一次性交付响应**

成功响应固定为：

```ts
return NextResponse.json({
  shareBoard: toSafeShareBoard(result.shareBoard),
  shareUrl: shareUrl.toString(),
  accessCode: result.accessCode,
});
```

捕获 `AdmissionShareSelectionError` 时返回：

```ts
return NextResponse.json(
  {
    code: "SHARE_SELECTION_CHANGED",
    error: "部分录屏状态已变化，请移除异常项后重试。",
    items: error.items,
  },
  { status: 409 },
);
```

不要在 GET、日志或 `toSafeShareBoard` 中返回 token、token 哈希或访问码。

- [ ] **Step 6: 运行创建链路测试**

Run:

```powershell
corepack pnpm test "lib/db/admission-share-create-schema-contract.test.ts" "features/applications/admission-share-board.test.ts" "app/api/projects/[projectId]/admission-share-boards/route.test.ts"
```

Expected: 3 files PASS。

- [ ] **Step 7: 提交**

```powershell
git add "supabase/migrations/20260730123000_admission_share_create_rpc.sql" "lib/db/admission-share-create-schema-contract.test.ts" "features/applications/admission-share-board.ts" "features/applications/admission-share-board.test.ts" "app/api/projects/[projectId]/admission-share-boards/route.ts" "app/api/projects/[projectId]/admission-share-boards/route.test.ts"
git commit -m "feat: create controlled admission share rounds"
```

## Task 5: 增加分享任务生命周期

**Files:**

- Create: `lib/db/admission-share-lifecycle-schema-contract.test.ts`
- Create: `supabase/migrations/20260730140000_admission_share_lifecycle_rpc.sql`
- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/extend/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/extend/route.test.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/reopen/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/reopen/route.test.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/rotate-token/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/rotate-token/route.test.ts`
- Modify: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/revoke/route.ts`

- [ ] **Step 1: 写失败的生命周期服务测试**

```ts
it("reopens only a locked formal review with a required reason", async () => {
  await reopenAdmissionShareBoard({
    repo,
    audit,
    actor,
    projectId: "project-1",
    shareBoardId: "share-1",
    reason: "甲方误选一条录屏",
  });
  expect(repo.reopenShareBoard).toHaveBeenCalledWith(
    expect.objectContaining({
      shareBoardId: "share-1",
      reason: "甲方误选一条录屏",
    }),
  );
});

it("rotates the token and invalidates prior public sessions", async () => {
  const result = await rotateAdmissionShareBoardToken({
    repo,
    audit,
    actor,
    projectId: "project-1",
    shareBoardId: "share-1",
    tokenFactory: () => "new-plain-token",
  });
  expect(repo.rotateShareBoardToken).toHaveBeenCalledWith(
    expect.objectContaining({
      tokenHash: hashShareSecret("new-plain-token"),
    }),
  );
  expect(result.token).toBe("new-plain-token");
});
```

- [ ] **Step 2: 运行生命周期测试并确认失败**

Run:

```powershell
corepack pnpm test "features/applications/admission-share-board.test.ts" "lib/db/admission-share-lifecycle-schema-contract.test.ts"
```

Expected: FAIL，生命周期方法和迁移不存在。

- [ ] **Step 3: 实现四个生命周期 RPC**

固定函数：

```sql
public.extend_admission_share_board(
  p_share_board_id uuid,
  p_project_id uuid,
  p_expires_at timestamptz,
  p_actor_user_id uuid
)

public.reopen_admission_share_board(
  p_share_board_id uuid,
  p_project_id uuid,
  p_reason text,
  p_actor_user_id uuid
)

public.rotate_admission_share_board_token(
  p_share_board_id uuid,
  p_project_id uuid,
  p_token_hash text,
  p_actor_user_id uuid
)

public.revoke_admission_share_board(
  p_share_board_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid
)
```

四个函数都使用 `security definer`，否则当前访问会话表的 revoke/RLS 会阻止 token 轮换和撤销清理。每个函数开头必须执行同一段显式授权，函数末尾只授权 authenticated：

```sql
if auth.uid() is null
   or p_actor_user_id is distinct from auth.uid()
   or not public.can_access_project(p_project_id) then
  raise exception 'insufficient_privilege'
    using errcode = '42501';
end if;

select *
into strict v_board
from public.project_recording_share_boards
where id = p_share_board_id
  and project_id = p_project_id
for update;

if not public.is_mcn_staff(v_board.organization_id) then
  raise exception 'insufficient_privilege'
    using errcode = '42501';
end if;
```

每个函数定义使用：

```sql
language plpgsql
security definer
set search_path = pg_catalog, public
```

迁移末尾执行：

```sql
revoke all on function public.extend_admission_share_board(
  uuid, uuid, timestamptz, uuid
) from public, anon;
revoke all on function public.reopen_admission_share_board(
  uuid, uuid, text, uuid
) from public, anon;
revoke all on function public.rotate_admission_share_board_token(
  uuid, uuid, text, uuid
) from public, anon;
revoke all on function public.revoke_admission_share_board(
  uuid, uuid, uuid
) from public, anon;
grant execute on function public.extend_admission_share_board(
  uuid, uuid, timestamptz, uuid
) to authenticated;
grant execute on function public.reopen_admission_share_board(
  uuid, uuid, text, uuid
) to authenticated;
grant execute on function public.rotate_admission_share_board_token(
  uuid, uuid, text, uuid
) to authenticated;
grant execute on function public.revoke_admission_share_board(
  uuid, uuid, uuid
) to authenticated;
```

业务规则：

- 延期不得超过执行时刻 30 天；
- 只有 `submitted_locked` 的正式任务可重开；
- 重开原因 trim 后至少 2 个字符；
- 重开把最近正式提交项复制到草稿，`revision = revision + 1`；
- token 轮换同时删除该看板的访问会话和访问尝试；
- 撤销同时删除访问会话和访问尝试；
- token 轮换、撤销后旧 token 立即无法通过哈希查找或旧会话访问。

- [ ] **Step 4: 实现服务方法和安全审计**

服务签名固定为：

```ts
export async function extendAdmissionShareBoard(input: {
  repo: AdmissionShareBoardRepository;
  audit: AdmissionShareBoardAuditWriter;
  actor: AdmissionShareBoardActor;
  projectId: string;
  shareBoardId: string;
  expiresAt: string;
}): Promise<void>;

export async function reopenAdmissionShareBoard(input: {
  repo: AdmissionShareBoardRepository;
  audit: AdmissionShareBoardAuditWriter;
  actor: AdmissionShareBoardActor;
  projectId: string;
  shareBoardId: string;
  reason: string;
}): Promise<void>;

export async function rotateAdmissionShareBoardToken(input: {
  repo: AdmissionShareBoardRepository;
  audit: AdmissionShareBoardAuditWriter;
  actor: AdmissionShareBoardActor;
  projectId: string;
  shareBoardId: string;
  tokenFactory?: () => string;
}): Promise<{ token: string }>;
```

重开和 token 轮换使用高风险审计并写原因；路由要求 MCN staff。轮换路由只在本次响应返回：

```ts
{
  shareUrl: "https://app.example/share/admission/new-token";
}
```

- [ ] **Step 5: 运行生命周期路由测试**

Run:

```powershell
corepack pnpm test "lib/db/admission-share-lifecycle-schema-contract.test.ts" "features/applications/admission-share-board.test.ts" "app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/extend/route.test.ts" "app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/reopen/route.test.ts" "app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/rotate-token/route.test.ts" "app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/revoke/route.test.ts"
```

Expected: 6 files PASS。

- [ ] **Step 6: 提交**

```powershell
git add "supabase/migrations/20260730140000_admission_share_lifecycle_rpc.sql" "lib/db/admission-share-lifecycle-schema-contract.test.ts" "features/applications/admission-share-board.ts" "features/applications/admission-share-board.test.ts" "app/api/projects/[projectId]/admission-share-boards"
git commit -m "feat: manage admission share lifecycle"
```

## Task 6: 增加服务端草稿和并发冲突

**Files:**

- Create: `lib/db/admission-share-draft-schema-contract.test.ts`
- Create: `supabase/migrations/20260730130000_admission_share_draft_rpc.sql`
- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Create: `app/api/public/admission-share/[token]/drafts/route.ts`
- Create: `app/api/public/admission-share/[token]/drafts/route.test.ts`
- Create: `app/api/public/admission-share/[token]/drafts/[recordingSubmissionId]/route.ts`
- Create: `app/api/public/admission-share/[token]/drafts/[recordingSubmissionId]/route.test.ts`
- Modify: `app/api/public/admission-share/public-route-utils.ts`
- Modify: `app/api/public/admission-share/public-route-utils.test.ts`

- [ ] **Step 1: 写失败的草稿服务测试**

```ts
it("saves a draft with optimistic revision control", async () => {
  const result = await savePublicAdmissionReviewDraft({
    repo,
    accessStore,
    token: "plain-token",
    sessionToken: "session-token",
    recordingSubmissionId: "recording-1",
    input: {
      expectedRevision: 2,
      decision: "needs_changes",
      remark: "开场需要更快进入卖点",
      reasonCodes: ["script_fit"],
    },
  });
  expect(repo.saveReviewDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      shareBoardId: "share-1",
      expectedRevision: 2,
    }),
  );
  expect(result.revision).toBe(3);
});

it("surfaces a stable conflict when another session already saved", async () => {
  repo.saveReviewDraft.mockRejectedValue(
    new Error("admission_share_draft_conflict"),
  );
  await expect(
    savePublicAdmissionReviewDraft({
      repo,
      accessStore,
      token: "plain-token",
      sessionToken: "session-token",
      recordingSubmissionId: "recording-1",
      input: {
        expectedRevision: 2,
        decision: "needs_changes",
        remark: "开场需要更快进入卖点",
        reasonCodes: ["script_fit"],
      },
    }),
  ).rejects.toMatchObject({
    code: "DRAFT_CONFLICT",
    statusCode: 409,
  });
});
```

- [ ] **Step 2: 运行草稿测试并确认失败**

Run:

```powershell
corepack pnpm test "features/applications/admission-share-board.test.ts" "lib/db/admission-share-draft-schema-contract.test.ts"
```

Expected: FAIL，缺少草稿 RPC 和服务方法。

- [ ] **Step 3: 实现 CAS 草稿 RPC**

签名固定为：

```sql
create or replace function public.save_admission_share_review_draft(
  p_share_board_id uuid,
  p_recording_submission_id uuid,
  p_expected_revision integer,
  p_decision text,
  p_remark text,
  p_reason_codes text[],
  p_saved_at timestamptz
)
returns public.project_recording_vendor_review_drafts
language plpgsql
security definer
set search_path = pg_catalog, public
```

函数只授权 `service_role`，并执行：

- 锁定看板；
- 验证正式模式、`active`、未过期、未撤销、`locked_at is null`；
- 验证录屏属于分享项；
- 允许正在编辑的负向草稿暂时没有备注；
- 首次保存要求 `expectedRevision = 0`；
- 更新保存要求数据库 `revision = expectedRevision`；
- 失败抛出 `admission_share_draft_conflict`；
- 成功把 revision 加 1；
- 看板更新为 `in_progress`、写 `last_draft_at`；
- 写入不含备注正文的 `draft_saved` 事件。

- [ ] **Step 4: 实现草稿读取、保存服务和公开路由**

公开 GET `/drafts` 返回：

```ts
{
  drafts: Array<{
    recordingSubmissionId: string;
    recordingVersion: number;
    decision: VendorAdmissionDecision;
    remark: string;
    reasonCodes: string[];
    revision: number;
    updatedAt: string;
  }>;
}
```

公开 PUT `/drafts/[recordingSubmissionId]` 接收：

```ts
{
  expectedRevision: number;
  decision: VendorAdmissionDecision;
  remark: string;
  reasonCodes: string[];
}
```

两个路由均使用现有 token + HttpOnly 访问会话校验，不读取 query access code。增加公开错误：

```ts
| "DRAFT_CONFLICT"
| "DRAFT_SAVE_FAILED"
| "REVIEW_ALREADY_LOCKED"
```

映射文案分别为：

- `DRAFT_CONFLICT`: “其他复核人刚刚更新了结果，请刷新后查看最新内容。”
- `DRAFT_SAVE_FAILED`: “草稿暂时无法保存，请保留页面并稍后重试。”
- `REVIEW_ALREADY_LOCKED`: “本轮结果已经提交并锁定。”

- [ ] **Step 5: 运行草稿链路测试**

Run:

```powershell
corepack pnpm test "lib/db/admission-share-draft-schema-contract.test.ts" "features/applications/admission-share-board.test.ts" "app/api/public/admission-share/[token]/drafts/route.test.ts" "app/api/public/admission-share/[token]/drafts/[recordingSubmissionId]/route.test.ts" "app/api/public/admission-share/public-route-utils.test.ts"
```

Expected: 5 files PASS。

- [ ] **Step 6: 提交**

```powershell
git add "supabase/migrations/20260730130000_admission_share_draft_rpc.sql" "lib/db/admission-share-draft-schema-contract.test.ts" "features/applications/admission-share-board.ts" "features/applications/admission-share-board.test.ts" "app/api/public/admission-share"
git commit -m "feat: persist admission review drafts"
```

## Task 7: 原子正式提交、结果快照和安全回流

**Files:**

- Create: `lib/db/admission-share-submit-schema-contract.test.ts`
- Create: `supabase/migrations/20260730133000_admission_share_submit_rpc.sql`
- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Modify: `app/api/public/admission-share/[token]/reviews/route.ts`
- Modify: `app/api/public/admission-share/[token]/reviews/route.test.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/submissions/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/submissions/route.test.ts`

- [ ] **Step 1: 写失败的完整提交测试**

```ts
const submitInput = {
  repo,
  accessStore,
  token: "plain-token",
  sessionToken: "session-token",
  input: { projectRemark: "首轮复核完成" },
  now: "2026-07-30T10:00:00.000Z",
};

it("rejects an incomplete formal review before mutating business state", async () => {
  repo.submitReview.mockRejectedValue(
    new Error("admission_share_review_incomplete"),
  );
  await expect(submitVendorAdmissionReviews(submitInput)).rejects.toMatchObject(
    {
      code: "REVIEW_INCOMPLETE",
      statusCode: 400,
    },
  );
  expect(repo.updateRecordingReviewForVendor).not.toHaveBeenCalled();
  expect(repo.updateApplicationStatusForVendor).not.toHaveBeenCalled();
});

it("locks one atomic submission and never auto-joins selected streamers", async () => {
  repo.submitReview.mockResolvedValue({
    submissionRevision: 2,
    submittedCount: 4,
    syncedCount: 3,
    skippedCount: 1,
    items: [
      {
        vendorReviewId: "review-selected",
        applicationId: "app-selected",
        recordingSubmissionId: "recording-selected",
        decision: "selected",
        syncStatus: "synced",
        syncError: null,
        reasonCodes: [],
      },
    ],
  });
  const result = await submitVendorAdmissionReviews(submitInput);
  expect(result).toMatchObject({
    submissionRevision: 2,
    submittedCount: 4,
  });
  expect(repo.createProjectStreamer).toBeUndefined();
});

it("records but does not sync a historical recording result", async () => {
  repo.submitReview.mockResolvedValue({
    submissionRevision: 1,
    submittedCount: 1,
    syncedCount: 0,
    skippedCount: 1,
    items: [
      {
        vendorReviewId: "review-old",
        applicationId: "app-1",
        recordingSubmissionId: "recording-v1",
        decision: "rejected",
        syncStatus: "skipped",
        syncError: "superseded_recording_version",
        reasonCodes: ["script_fit"],
      },
    ],
  });
  expect(await submitVendorAdmissionReviews(submitInput)).toMatchObject({
    skippedCount: 1,
  });
});
```

- [ ] **Step 2: 运行提交测试并确认失败**

Run:

```powershell
corepack pnpm test "features/applications/admission-share-board.test.ts" "app/api/public/admission-share/[token]/reviews/route.test.ts" "lib/db/admission-share-submit-schema-contract.test.ts"
```

Expected: FAIL，仍使用逐条 TypeScript 更新且没有原子 RPC。

- [ ] **Step 3: 实现正式提交 RPC**

固定签名：

```sql
create or replace function public.submit_admission_share_review(
  p_share_board_id uuid,
  p_project_remark text,
  p_submitted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
```

函数只授权 `service_role`，在单一事务中：

1. `for update` 锁定分享看板；
2. 验证正式模式、active、未过期、未撤销和未锁定；
3. 验证草稿数量等于分享项数量；
4. 验证所有 decision 非 pending；
5. 验证 rejected/needs_changes 备注非空；
6. 新建 submission revision；
7. 复制草稿到不可变 submission items；
8. upsert 现有 `project_recording_vendor_reviews`，保持其作为“当前甲方结果”读模型；
9. 仅当分享项仍是 application 的最新录屏且 application 未 joined 时同步状态；
10. `selected` 更新为 `recording_approved`/`approved`，但不创建 `project_streamers`；
11. `backup` 记录为 synced 且不改变状态；
12. `rejected` 更新为 `recording_rejected`/`rejected`；
13. `needs_changes` 更新为 `recording_required`/`needs_changes` 并保留原因；
14. 历史版本或 joined application 设置 `sync_status = 'skipped'` 和稳定原因；
15. 更新看板 `last_submitted_at`、`locked_at`、`review_state = 'submitted_locked'` 和 revision；
16. 写 `submitted` 事件；
17. 返回提交计数和每条结果 ID。

契约测试必须断言 RPC 中不存在对 `project_streamers` 的 insert。

- [ ] **Step 4: 把服务改为一次 RPC 调用**

删除 `submitVendorAdmissionReviews` 中逐条调用：

- `updateRecordingReviewForVendor`
- `updateApplicationStatusForVendor`
- `upsertVendorReviews`
- `markShareBoardSubmitted`

把公开提交输入收窄为：

```ts
export type SubmitVendorAdmissionReviewsInput = {
  projectRemark?: string;
};
```

逐条判断只从服务端草稿表读取，拒绝客户端在最终提交请求中再次携带或覆盖 `items`。

改为：

```ts
const result = await repo.submitReview({
  shareBoardId: snapshot.id,
  projectRemark: input.projectRemark?.trim() || "",
  submittedAt: now,
});
```

RPC 成功后再执行现有 `recordEvaluation`，失败继续不阻断正式提交。

- [ ] **Step 5: 增加 MCN 历史提交查询路由**

GET `/submissions` 返回：

```ts
{
  submissions: Array<{
    id: string;
    revision: number;
    projectRemark: string;
    submittedAt: string;
    summary: {
      selected: number;
      backup: number;
      rejected: number;
      needsChanges: number;
    };
    items: Array<{
      applicationId: string;
      recordingSubmissionId: string;
      recordingVersion: number;
      decision: VendorAdmissionDecision;
      remark: string;
      reasonCodes: string[];
      syncStatus: "synced" | "skipped" | "failed";
      syncError: string | null;
    }>;
  }>;
}
```

路由只允许 MCN staff，不返回 reviewer 联系方式。

- [ ] **Step 6: 运行提交与历史测试**

Run:

```powershell
corepack pnpm test "lib/db/admission-share-submit-schema-contract.test.ts" "features/applications/admission-share-board.test.ts" "app/api/public/admission-share/[token]/reviews/route.test.ts" "app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/submissions/route.test.ts"
```

Expected: 4 files PASS。

- [ ] **Step 7: 提交**

```powershell
git add "supabase/migrations/20260730133000_admission_share_submit_rpc.sql" "lib/db/admission-share-submit-schema-contract.test.ts" "features/applications/admission-share-board.ts" "features/applications/admission-share-board.test.ts" "app/api/public/admission-share/[token]/reviews" "app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/submissions"
git commit -m "feat: atomically submit admission reviews"
```

## Task 8: 扩展公开快照、双模式和锁定回执

**Files:**

- Create: `lib/db/admission-share-playback-issue-schema-contract.test.ts`
- Create: `supabase/migrations/20260730143000_admission_share_playback_issue_rpc.sql`
- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Modify: `app/api/public/admission-share/[token]/route.ts`
- Modify: `app/api/public/admission-share/[token]/route.test.ts`
- Modify: `app/api/public/admission-share/public-route-utils.ts`
- Modify: `app/api/public/admission-share/public-route-utils.test.ts`

- [ ] **Step 1: 写失败的公开 DTO 测试**

```ts
expect(publicBoard).toMatchObject({
  mode: "formal_review",
  purpose: "品牌方首轮选人",
  reviewState: "submitted_locked",
  roundNumber: 2,
  progress: {
    completed: 3,
    total: 3,
  },
  latestSubmission: {
    revision: 2,
    submittedAt: "2026-07-30T10:00:00.000Z",
    summary: {
      selected: 1,
      backup: 1,
      rejected: 1,
      needsChanges: 0,
    },
  },
});
expect(JSON.stringify(publicBoard)).not.toContain("storagePath");
expect(JSON.stringify(publicBoard)).not.toContain("tokenHash");
expect(JSON.stringify(publicBoard)).not.toContain("reviewerContact");
```

增加预览模式断言：

```ts
expect(previewBoard).toMatchObject({
  mode: "preview",
  canSubmit: false,
  latestSubmission: null,
});
expect(previewBoard.items.every((item) => !("draft" in item))).toBe(true);
```

- [ ] **Step 2: 运行公开 DTO 测试并确认失败**

Run:

```powershell
corepack pnpm test "features/applications/admission-share-board.test.ts" "app/api/public/admission-share/[token]/route.test.ts"
```

Expected: FAIL，公开快照没有模式、进度和回执字段。

- [ ] **Step 3: 扩展仓储读取和公开白名单**

`toPublicShareDto` 只输出：

```ts
{
  id,
  title,
  purpose,
  mode,
  status,
  reviewState,
  roundNumber,
  expiresAt,
  canSubmit:
    mode === "formal_review" &&
    status === "active" &&
    reviewState !== "submitted_locked",
  allowExternalFallback,
  project,
  progress,
  latestSubmission,
  items,
}
```

每个 item 输出：

```ts
{
  applicationId,
  recordingSubmissionId,
  recordingVersion,
  playbackUrl,
  externalUrl: allowExternalFallback ? recordingUrl : null,
  sourceHealth,
  hasPrivateStorage,
  streamer,
  finalReview,
}
```

不要返回 `draft`、`applicationStatus`、当前 `recordingStatus`、存储路径、内部审核人和联系方式；草稿只由 token + 访问会话保护的 `/drafts` 路由返回，甲方公开快照只需知道本轮锁定版本和本轮最终结果。

把这份白名单 DTO 导出为 `PublicAdmissionShareBoard`，并让 `toPublicShareDto` 显式返回 `PublicAdmissionShareBoard`；Task 11 的页面类型只能复用这个导出，不得从路由响应再次手写一份不同结构。

- [ ] **Step 4: 增加稳定公开错误**

把下列错误加入 `PublicAdmissionShareError` 和公开映射：

```ts
| "SHARE_REVOKED"
| "RECORDING_SOURCE_UNAVAILABLE"
| "DRAFT_CONFLICT"
| "DRAFT_SAVE_FAILED"
| "REVIEW_INCOMPLETE"
| "REVIEW_ALREADY_LOCKED"
| "REVIEW_REOPEN_REQUIRED"
```

撤销和过期使用不同 code，但都返回 410；客户端文案分别显示“已撤销”和“已过期”。

- [ ] **Step 5: 运行公开契约测试**

Run:

```powershell
corepack pnpm test "features/applications/admission-share-board.test.ts" "app/api/public/admission-share/[token]/route.test.ts" "app/api/public/admission-share/public-route-utils.test.ts"
```

Expected: 3 files PASS。

- [ ] **Step 6: 提交**

```powershell
git add "features/applications/admission-share-board.ts" "features/applications/admission-share-board.test.ts" "app/api/public/admission-share/[token]/route.ts" "app/api/public/admission-share/[token]/route.test.ts" "app/api/public/admission-share/public-route-utils.ts" "app/api/public/admission-share/public-route-utils.test.ts"
git commit -m "feat: expose admission review workflow safely"
```

## Task 9: 增加运营分享任务 DTO 和明确待办

**Files:**

- Modify: `features/applications/admission-board.ts`
- Modify: `features/applications/admission-board.test.ts`
- Modify: `app/api/applications/admission-board/route.test.ts`
- Modify: `app/api/projects/[projectId]/admission-share-boards/route.ts`
- Modify: `app/api/projects/[projectId]/admission-share-boards/route.test.ts`

- [ ] **Step 1: 写失败的 DTO 聚合测试**

```ts
expect(board.share).toEqual({
  id: "share-formal-2",
  mode: "formal_review",
  status: "active",
  reviewState: "in_progress",
  roundNumber: 2,
  expiresAt: "2026-08-06T00:00:00.000Z",
  lastViewedAt: "2026-07-30T08:00:00.000Z",
  lastDraftAt: "2026-07-30T08:20:00.000Z",
  lastSubmittedAt: null,
  lockedAt: null,
});
expect(board.shareProgress).toEqual({
  completed: 4,
  total: 10,
});
```

结果待办测试：

```ts
expect(toAdmissionResultTask(detail)).toEqual({
  type: "mcn_final_confirm",
  applicationId: detail.id,
  recordingSubmissionId: detail.latestRecording?.id,
  label: "待 MCN 最终确认",
});
```

并分别固定 `backup`、`rejected`、`needs_changes`、历史版本 skipped 的下一步文案。

- [ ] **Step 2: 运行 DTO 测试并确认失败**

Run:

```powershell
corepack pnpm test "features/applications/admission-board.test.ts" "app/api/applications/admission-board/route.test.ts"
```

Expected: FAIL，分享摘要仍只有 active/expired/revoked 和 lastSubmittedAt。

- [ ] **Step 3: 扩展安全运营 DTO**

`AdmissionProjectBoard.share` 增加模式、复核状态、轮次、查看/草稿/锁定时间。新增：

```ts
export type AdmissionResultTask = {
  type:
    | "mcn_final_confirm"
    | "notify_streamer_changes"
    | "await_streamer_resubmission"
    | "new_version_review"
    | "start_next_round"
    | "historical_result_manual_review";
  applicationId: string;
  recordingSubmissionId: string | null;
  label: string;
};
```

`selected` 只有当前版本且未入项时输出 `mcn_final_confirm`；`backup` 不输出变更动作；负向结果输出主播修改动作；历史版本 skipped 输出人工确认，禁止静默覆盖当前版本。

- [ ] **Step 4: 扩展项目分享任务 GET**

GET `/admission-share-boards` 返回每个任务：

```ts
{
  id,
  title,
  purpose,
  mode,
  status,
  reviewState,
  roundNumber,
  expiresAt,
  itemCount,
  draftCompletedCount,
  lastViewedAt,
  lastDraftAt,
  lastSubmittedAt,
  lockedAt,
  createdBy,
  createdAt,
}
```

禁止返回 token hash、access code hash、存储路径和 reviewer 联系方式。

- [ ] **Step 5: 运行 DTO 与路由测试**

Run:

```powershell
corepack pnpm test "features/applications/admission-board.test.ts" "app/api/applications/admission-board/route.test.ts" "app/api/projects/[projectId]/admission-share-boards/route.test.ts"
```

Expected: 3 files PASS。

- [ ] **Step 6: 提交**

```powershell
git add "features/applications/admission-board.ts" "features/applications/admission-board.test.ts" "app/api/applications/admission-board/route.test.ts" "app/api/projects/[projectId]/admission-share-boards/route.ts" "app/api/projects/[projectId]/admission-share-boards/route.test.ts"
git commit -m "feat: expose admission share task progress"
```

## Task 10: 建立运营录屏分享中心与主动选择器

**Files:**

- Create: `components/reference-ui/admission-share-center.jsx`
- Create: `components/reference-ui/admission-share-center.test.jsx`
- Modify: `components/reference-ui/ops-reference.jsx:1-50,17141-18180,36384-36555`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: 写失败的独立分享中心测试**

```jsx
const candidates = [
  {
    applicationId: "app-1",
    recordingSubmissionId: "recording-v1",
    recordingVersion: 1,
    isLatestVersion: false,
    streamer: { id: "streamer-1", displayName: "主播甲", accountLabel: "dy_1" },
    mcnReviewDecision: "approved",
    sourceHealth: "original_ready",
    hasPrivateStorage: true,
    externalUrl: null,
    isShareable: true,
    blockReason: null,
    currentVendorDecision: "pending",
    lastSharedAt: null,
  },
  {
    applicationId: "app-2",
    recordingSubmissionId: "recording-v2",
    recordingVersion: 2,
    isLatestVersion: true,
    streamer: { id: "streamer-2", displayName: "主播乙", accountLabel: "dy_2" },
    mcnReviewDecision: null,
    sourceHealth: "blocked",
    hasPrivateStorage: true,
    externalUrl: null,
    isShareable: false,
    blockReason: "MCN_APPROVAL_REQUIRED",
    currentVendorDecision: "pending",
    lastSharedAt: null,
  },
];

const actions = {
  listAdmissionShareCandidates: vi.fn().mockResolvedValue(candidates),
  openAdmissionShareCandidatePlayback: vi.fn(),
  preflightAdmissionShareBoard: vi.fn().mockResolvedValue({
    summary: { ready: 1, warning: 0, blocked: 1 },
    items: [
      { ...candidates[0], status: "ready", reasonCode: null },
      {
        ...candidates[1],
        status: "blocked",
        reasonCode: "MCN_APPROVAL_REQUIRED",
      },
    ],
  }),
  listAdmissionShareBoards: vi.fn().mockResolvedValue([]),
  createAdmissionShareBoard: vi.fn().mockResolvedValue({
    shareBoard: { id: "share-1", mode: "formal_review" },
    shareUrl: "https://app.example/share/admission/plain-token",
    accessCode: "24681024",
  }),
  extendAdmissionShareBoard: vi.fn(),
  reopenAdmissionShareBoard: vi.fn(),
  rotateAdmissionShareBoardToken: vi.fn(),
  revokeAdmissionShareBoard: vi.fn(),
  listAdmissionShareSubmissions: vi.fn().mockResolvedValue([]),
  listAdmissionSharePlaybackIssues: vi.fn().mockResolvedValue([]),
  resolveAdmissionSharePlaybackIssue: vi.fn(),
};

function renderShareCenter() {
  return render(
    <AdmissionShareCenter
      project={{ id: "project-1", name: "Alpha Project" }}
      actions={actions}
      onClose={vi.fn()}
    />,
  );
}

it("selects an approved historical version and removes only blocked items", async () => {
  renderShareCenter();

  expect(await screen.findByText("录屏库")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("选择 主播甲 V1"));
  fireEvent.click(screen.getByLabelText("选择 主播乙 V2"));
  fireEvent.click(screen.getByRole("button", { name: "创建分享" }));

  expect(await screen.findByText("1 条录屏无法分享")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "移除异常并继续" }));
  expect(screen.getByText("已选择 1 条")).toBeInTheDocument();
  expect(screen.getByLabelText("分享名称")).toHaveValue(
    "Alpha Project 录屏复核",
  );
});

it("creates a formal review with explicit items and one-time delivery data", async () => {
  actions.preflightAdmissionShareBoard.mockResolvedValueOnce({
    summary: { ready: 1, warning: 0, blocked: 0 },
    items: [{ ...candidates[0], status: "ready", reasonCode: null }],
  });
  renderShareCenter();
  fireEvent.click(await screen.findByLabelText("选择 主播甲 V1"));
  fireEvent.click(screen.getByRole("button", { name: "创建分享" }));
  fireEvent.click(screen.getByLabelText("正式复核"));
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

  await waitFor(() => {
    expect(actions.createAdmissionShareBoard).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        mode: "formal_review",
        requireAccessCode: true,
        items: [
          expect.objectContaining({
            recordingSubmissionId: "recording-v1",
            recordingVersion: 1,
          }),
        ],
      }),
    );
  });
  expect(screen.getByText("24681024")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "复制完整交付信息" }),
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行组件测试并确认组件不存在**

Run:

```powershell
corepack pnpm test "components/reference-ui/admission-share-center.test.jsx"
```

Expected: FAIL，组件模块不存在。

- [ ] **Step 3: 实现分享中心组件**

组件 props 固定为：

```jsx
export function AdmissionShareCenter({ project, actions, onClose }) {
  const [tab, setTab] = React.useState("library");
  const [candidates, setCandidates] = React.useState([]);
  const [tasks, setTasks] = React.useState([]);
  const [selected, setSelected] = React.useState(new Map());
  const [wizardStep, setWizardStep] = React.useState(0);
  const [draft, setDraft] = React.useState({
    mode: "formal_review",
    title: `${project.name || "项目"} 录屏复核`,
    purpose: "",
    expiresAt: sevenDaysFromNowInput(),
    requireAccessCode: true,
    accessCode: "",
    allowExternalFallback: true,
  });
  const [delivery, setDelivery] = React.useState(null);
  const [message, setMessage] = React.useState("");
}
```

组件必须实现：

- `录屏库 / 分享任务 / 结果待办` 三个 tab；
- 主播搜索、版本展开、来源筛选、只看可分享；
- 复选框主动选择和排序；
- 固定“已选择 X 条”操作栏；
- 三步向导：确认录屏、分享规则、甲方视角预览；
- 调用 preflight 后展示逐条 ready/warning/blocked；
- “移除异常并继续”只删 blocked；
- 正式模式默认访问码，预览模式默认关闭；
- 创建成功弹窗只在当前状态保存 `shareUrl` 和 `accessCode`；
- 关闭弹窗后清除一次性明文；
- 历史任务只显示“重置分享链接”，不显示旧链接复制；
- 延期、撤销、重开和查看提交历史；
- 所有关键按钮最小高度 44px，使用现有 CSS 变量。

- [ ] **Step 4: 把 Ops actions 接到真实接口**

在 `ops-reference.jsx` 的 actions 中增加：

```jsx
listAdmissionShareCandidates(projectId);
openAdmissionShareCandidatePlayback(projectId, recordingSubmissionId);
preflightAdmissionShareBoard(projectId, items);
listAdmissionShareBoards(projectId);
createAdmissionShareBoard(projectId, input);
extendAdmissionShareBoard(projectId, shareBoardId, expiresAt);
reopenAdmissionShareBoard(projectId, shareBoardId, reason);
rotateAdmissionShareBoardToken(projectId, shareBoardId);
revokeAdmissionShareBoard(projectId, shareBoardId);
listAdmissionShareSubmissions(projectId, shareBoardId);
listAdmissionSharePlaybackIssues(projectId, status);
resolveAdmissionSharePlaybackIssue(projectId, issueId);
```

除预览外，每个方法使用 `fetchJson` 和对应 REST 路由；`openAdmissionShareCandidatePlayback` 使用 `window.open` 打开受 MCN 鉴权的候选播放路由，不接触存储路径。项目表操作按钮从“创建分享链接”改成“录屏分享中心”，点击后打开 `AdmissionShareCenter`；删除旧的自动收集所有 `applicationIds` 的 `createShareBoard` 函数。

- [ ] **Step 5: 运行运营界面测试**

Run:

```powershell
corepack pnpm test "components/reference-ui/admission-share-center.test.jsx" "components/reference-ui/ops-reference.test.jsx"
```

Expected: 2 files PASS，旧“自动全量分享”用例改为“打开分享中心并主动选择”。

- [ ] **Step 6: 提交**

```powershell
git add "components/reference-ui/admission-share-center.jsx" "components/reference-ui/admission-share-center.test.jsx" "components/reference-ui/ops-reference.jsx" "components/reference-ui/ops-reference.test.jsx"
git commit -m "feat: add admission recording share center"
```

## Task 11: 建立甲方聚焦式复核工作台与自动保存

**Files:**

- Create: `app/share/admission/[token]/admission-share-review-workspace.tsx`
- Create: `app/share/admission/[token]/admission-share-review-workspace.test.tsx`
- Create: `app/share/admission/[token]/admission-share-types.ts`
- Create: `app/share/admission/[token]/admission-share-api.ts`
- Create: `app/share/admission/[token]/admission-share-api.test.ts`
- Modify: `app/share/admission/[token]/admission-share-page-client.tsx`
- Modify: `app/share/admission/[token]/admission-share-page-client.test.tsx`

- [ ] **Step 1: 写失败的工作台测试**

```tsx
const formalBoard = {
  id: "share-1",
  title: "第一轮正式复核",
  purpose: "品牌方首轮选人",
  mode: "formal_review",
  status: "active",
  reviewState: "in_progress",
  roundNumber: 1,
  expiresAt: "2026-08-06T00:00:00.000Z",
  canSubmit: true,
  allowExternalFallback: true,
  progress: { completed: 1, total: 2 },
  latestSubmission: null,
  project: { id: "project-1", name: "Alpha Project" },
  items: [
    {
      applicationId: "app-1",
      recordingSubmissionId: "recording-1",
      recordingVersion: 1,
      playbackUrl: "/api/public/admission-share/token/recordings/recording-1",
      externalUrl: null,
      sourceHealth: "original_ready",
      hasPrivateStorage: true,
      streamer: {
        id: "streamer-1",
        displayName: "待判断主播",
        accountLabel: "dy_1",
      },
      finalReview: null,
    },
    {
      applicationId: "app-2",
      recordingSubmissionId: "recording-2",
      recordingVersion: 1,
      playbackUrl: "/api/public/admission-share/token/recordings/recording-2",
      externalUrl: "https://video.example/2",
      sourceHealth: "external_only",
      hasPrivateStorage: false,
      streamer: {
        id: "streamer-2",
        displayName: "已完成主播",
        accountLabel: "dy_2",
      },
      finalReview: null,
    },
  ],
} satisfies PublicAdmissionShareBoard;

const onDraftChange = vi.fn();
const drafts = {
  "recording-1": {
    decision: "pending",
    remark: "",
    reasonCodes: [],
    revision: 0,
    updatedAt: null,
  },
  "recording-2": {
    decision: "backup",
    remark: "",
    reasonCodes: [],
    revision: 2,
    updatedAt: "2026-07-30T08:00:00.000Z",
  },
} satisfies Record<string, ReviewDraft>;

const formalProps = {
  board: formalBoard,
  drafts,
  saveState: { "recording-1": "idle", "recording-2": "saved" },
  activeRecordingId: "recording-1",
  onActiveRecordingChange: vi.fn(),
  onDraftChange,
  onRetryDraft: vi.fn(),
  onOpenSubmissionSummary: vi.fn(),
  onReportPlaybackIssue: vi.fn(),
} satisfies AdmissionShareReviewWorkspaceProps;

const previewProps = {
  ...formalProps,
  board: {
    ...formalBoard,
    mode: "preview",
    canSubmit: false,
    reviewState: "viewed",
  },
} satisfies AdmissionShareReviewWorkspaceProps;

it("renders a focused three-pane formal review and filters pending items", () => {
  render(<AdmissionShareReviewWorkspace {...formalProps} />);
  expect(
    screen.getByRole("navigation", { name: "录屏列表" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "录屏播放器" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("form", { name: "当前录屏判断" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "只看待判断" }));
  expect(screen.queryByText("已完成主播")).not.toBeInTheDocument();
});

it("emits a typed draft patch without owning network state", async () => {
  render(<AdmissionShareReviewWorkspace {...formalProps} />);
  fireEvent.change(screen.getByLabelText("当前录屏备注"), {
    target: { value: "需要补充产品卖点" },
  });
  expect(onDraftChange).toHaveBeenCalledWith(
    "recording-1",
    expect.objectContaining({
      remark: "需要补充产品卖点",
    }),
  );
});

it("requires every item before opening the submission summary", () => {
  render(<AdmissionShareReviewWorkspace {...formalProps} />);
  expect(screen.getByRole("button", { name: "查看提交汇总" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("入选"));
  expect(onDraftChange).toHaveBeenCalledWith(
    "recording-1",
    expect.objectContaining({ decision: "selected" }),
  );
});

it("renders preview mode without decision controls", () => {
  render(<AdmissionShareReviewWorkspace {...previewProps} />);
  expect(
    screen.queryByRole("form", { name: "当前录屏判断" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "提交复核" }),
  ).not.toBeInTheDocument();
});
```

在 `admission-share-page-client.test.tsx` 单独测试控制器职责，避免组件测试引用不存在的 `saveDraft`：

```tsx
it("autosaves a remark after 500ms and keeps local text on conflict", async () => {
  vi.useFakeTimers();
  saveAdmissionShareDraft.mockResolvedValueOnce({
    decision: "pending",
    remark: "需要补充产品卖点",
    reasonCodes: [],
    revision: 3,
    updatedAt: "2026-07-30T08:30:00.000Z",
  });
  render(<AdmissionSharePageClient token="public-token" />);
  await screen.findByText("待判断主播");

  fireEvent.change(screen.getByLabelText("当前录屏备注"), {
    target: { value: "需要补充产品卖点" },
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(saveAdmissionShareDraft).toHaveBeenCalledWith(
    "public-token",
    "recording-1",
    expect.objectContaining({
      expectedRevision: 2,
      remark: "需要补充产品卖点",
    }),
  );

  saveAdmissionShareDraft.mockRejectedValueOnce({ code: "DRAFT_CONFLICT" });
  fireEvent.click(screen.getByLabelText("需修改"));
  expect(await screen.findByText(/其他复核人刚刚更新/)).toBeInTheDocument();
  expect(screen.getByLabelText("当前录屏备注")).toHaveValue("需要补充产品卖点");
  vi.useRealTimers();
});
```

- [ ] **Step 2: 运行工作台测试并确认组件不存在**

Run:

```powershell
corepack pnpm test "app/share/admission/[token]/admission-share-review-workspace.test.tsx"
```

Expected: FAIL，组件模块不存在。

- [ ] **Step 3: 实现聚焦工作台**

组件 props：

```ts
import type {
  PublicAdmissionShareBoard,
  ReviewDraft,
} from "./admission-share-types";

export type AdmissionShareReviewWorkspaceProps = {
  board: PublicAdmissionShareBoard;
  drafts: Record<string, ReviewDraft>;
  saveState: Record<string, "idle" | "saving" | "saved" | "failed">;
  activeRecordingId: string;
  onActiveRecordingChange: (recordingSubmissionId: string) => void;
  onDraftChange: (
    recordingSubmissionId: string,
    patch: Partial<ReviewDraft>,
  ) => void;
  onRetryDraft: (recordingSubmissionId: string) => void;
  onOpenSubmissionSummary: () => void;
  onReportPlaybackIssue: (
    recordingSubmissionId: string,
    sourceType: "original" | "external" | "none",
  ) => void;
};
```

`admission-share-types.ts` 是页面容器与工作台的唯一共享类型入口：

```ts
export type { PublicAdmissionShareBoard } from "@/features/applications/admission-share-board";
export type { VendorAdmissionDecision } from "@/features/applications/admission-board";

export type ReviewDraft = {
  decision: import("@/features/applications/admission-board").VendorAdmissionDecision;
  remark: string;
  reasonCodes: string[];
  revision: number;
  updatedAt: string | null;
};
```

`admission-share-api.ts` 集中实现 `loadAdmissionShareBoard`、`loadAdmissionShareDrafts`、`saveAdmissionShareDraft`、`submitAdmissionShareReview` 和 `reportAdmissionSharePlaybackIssue`；每个函数都使用相对公开路由、`credentials: "same-origin"`、JSON content type 和统一的 `PublicAdmissionShareApiError`。页面容器和工作台不得各自复制 fetch/error 解析。

桌面布局：

```tsx
<section className="grid min-h-[680px] overflow-hidden rounded-lg border border-[var(--line)] bg-white lg:grid-cols-[280px_minmax(0,1fr)_340px]">
  <RecordingListPane />
  <ActiveRecordingPane />
  <DecisionPane />
</section>
```

移动端使用录屏列表抽屉、纵向播放器/判断区和固定“上一条/下一条”操作栏。所有草稿状态必须显示“保存中、已保存、保存失败”；切换录屏前立即 flush 当前防抖保存。

- [ ] **Step 4: 在页面容器实现草稿控制器**

`admission-share-page-client.tsx` 负责：

- 初次 GET 同时读取公开快照和服务端 drafts；
- 每条草稿维护 `revision`；
- decision/reasonCodes 立即 PUT；
- remark 使用 500ms 防抖 PUT；
- 离开页面前 flush；
- 冲突保留本地值并要求刷新；
- `reviewedCount === items.length` 且负向原因完整时才能打开汇总；
- 汇总对话框显示 selected/backup/rejected/needs_changes/pending 计数；
- 正式提交只发送 `projectRemark`，服务端从已保存草稿原子提交；
- 成功后重新 GET，渲染锁定回执；
- 预览模式不读取或写入 drafts。

- [ ] **Step 5: 运行甲方页面测试**

Run:

```powershell
corepack pnpm test "app/share/admission/[token]/admission-share-api.test.ts" "app/share/admission/[token]/admission-share-review-workspace.test.tsx" "app/share/admission/[token]/admission-share-page-client.test.tsx"
```

Expected: 3 files PASS。

- [ ] **Step 6: 提交**

```powershell
git add "app/share/admission/[token]/admission-share-types.ts" "app/share/admission/[token]/admission-share-api.ts" "app/share/admission/[token]/admission-share-api.test.ts" "app/share/admission/[token]/admission-share-review-workspace.tsx" "app/share/admission/[token]/admission-share-review-workspace.test.tsx" "app/share/admission/[token]/admission-share-page-client.tsx" "app/share/admission/[token]/admission-share-page-client.test.tsx"
git commit -m "feat: add focused admission review workspace"
```

## Task 12: 增加单条播放问题反馈和运营待办

**Files:**

- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Modify: `app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/route.ts`
- Modify: `app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/route.test.ts`
- Create: `app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/issues/route.ts`
- Create: `app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/issues/route.test.ts`
- Create: `app/api/projects/[projectId]/admission-share-playback-issues/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-playback-issues/route.test.ts`
- Create: `app/api/projects/[projectId]/admission-share-playback-issues/[issueId]/resolve/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-playback-issues/[issueId]/resolve/route.test.ts`
- Modify: `components/reference-ui/admission-share-center.jsx`
- Modify: `components/reference-ui/admission-share-center.test.jsx`
- Modify: `app/share/admission/[token]/admission-share-review-workspace.tsx`
- Modify: `app/share/admission/[token]/admission-share-review-workspace.test.tsx`

- [ ] **Step 1: 写失败的播放问题服务和路由测试**

```ts
const issueUrl =
  "https://app.example/api/public/admission-share/plain-token/recordings/recording-1/issues";
const routeParams = {
  params: Promise.resolve({
    token: "plain-token",
    recordingSubmissionId: "recording-1",
  }),
};

it("records a sanitized issue for one shared recording", async () => {
  const response = await POST(
    new Request(issueUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 Chrome/140",
      },
      body: JSON.stringify({
        sourceType: "original",
        errorCode: "MEDIA_DECODE_FAILED",
      }),
    }),
    routeParams,
  );
  expect(response.status).toBe(201);
  expect(recordPublicAdmissionPlaybackIssue).toHaveBeenCalledWith(
    expect.objectContaining({
      recordingSubmissionId: "recording-1",
      sourceType: "original",
      errorCode: "MEDIA_DECODE_FAILED",
      userAgentFamily: "Chrome",
    }),
  );
  expect(
    JSON.stringify(recordPublicAdmissionPlaybackIssue.mock.calls),
  ).not.toContain("plain-token");
});

// app/api/projects/[projectId]/admission-share-playback-issues/route.test.ts
const projectRequest = new Request(
  "https://app.example/api/projects/project-1/admission-share-playback-issues?status=open",
);
const projectRouteParams = {
  params: Promise.resolve({ projectId: "project-1" }),
};

it("lists only sanitized open issues for the requested project", async () => {
  listAdmissionSharePlaybackIssues.mockResolvedValue([
    {
      id: "issue-1",
      shareBoardId: "share-1",
      recordingSubmissionId: "recording-1",
      recordingVersion: 1,
      streamerDisplayName: "主播甲",
      sourceType: "original",
      errorCode: "MEDIA_DECODE_FAILED",
      status: "open",
      reportedAt: "2026-07-30T09:00:00.000Z",
    },
  ]);
  const response = await GET_ISSUES(projectRequest, projectRouteParams);
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.issues).toHaveLength(1);
  expect(JSON.stringify(body)).not.toContain("storagePath");
  expect(JSON.stringify(body)).not.toContain("userAgent");
});

// app/api/projects/[projectId]/admission-share-playback-issues/[issueId]/resolve/route.test.ts
const resolveRequest = new Request(
  "https://app.example/api/projects/project-1/admission-share-playback-issues/issue-1/resolve",
  { method: "POST" },
);
const resolveRouteParams = {
  params: Promise.resolve({ projectId: "project-1", issueId: "issue-1" }),
};

it("resolves one issue with MCN audit evidence", async () => {
  const response = await POST_RESOLVE(resolveRequest, resolveRouteParams);
  expect(response.status).toBe(200);
  expect(resolveAdmissionSharePlaybackIssue).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: "project-1",
      issueId: "issue-1",
    }),
  );
});
```

- [ ] **Step 2: 运行播放问题测试并确认路由不存在**

Run:

```powershell
corepack pnpm test "lib/db/admission-share-playback-issue-schema-contract.test.ts" "app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/issues/route.test.ts" "app/api/projects/[projectId]/admission-share-playback-issues/route.test.ts" "app/api/projects/[projectId]/admission-share-playback-issues/[issueId]/resolve/route.test.ts" "features/applications/admission-share-board.test.ts"
```

Expected: FAIL，公开上报、运营列表、受限解决 RPC、解决路由和服务方法不存在。

- [ ] **Step 3: 实现单条反馈服务与路由**

服务签名：

```ts
export async function recordPublicAdmissionPlaybackIssue(input: {
  repo: AdmissionShareBoardRepository;
  accessStore?: AdmissionShareAccessStore;
  token: string;
  sessionToken?: string;
  recordingSubmissionId: string;
  sourceType: "original" | "external" | "none";
  errorCode: string;
  userAgentFamily: string;
  now?: string;
}): Promise<{ issueId: string }>;

export async function listAdmissionSharePlaybackIssues(input: {
  repo: AdmissionShareBoardRepository;
  actor: AdmissionShareBoardActor;
  projectId: string;
  status?: "open" | "resolved";
}): Promise<AdmissionSharePlaybackIssueDto[]>;

export async function resolveAdmissionSharePlaybackIssue(input: {
  repo: AdmissionShareBoardRepository;
  audit: AdmissionShareBoardAuditWriter;
  actor: AdmissionShareBoardActor;
  projectId: string;
  issueId: string;
}): Promise<void>;
```

`20260730143000_admission_share_playback_issue_rpc.sql` 定义：

```sql
create or replace function public.report_admission_share_playback_issue(
  p_share_board_id uuid,
  p_recording_submission_id uuid,
  p_source_type text,
  p_error_code text,
  p_user_agent_family text,
  p_reported_at timestamptz
)
returns public.project_recording_share_playback_issues
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_board public.project_recording_share_boards;
  v_issue public.project_recording_share_playback_issues;
begin
  select board.*
  into strict v_board
  from public.project_recording_share_boards as board
  join public.project_recording_share_items as item
    on item.share_board_id = board.id
   and item.recording_submission_id = p_recording_submission_id
  where board.id = p_share_board_id
    and board.status = 'active'
    and board.expires_at > p_reported_at;

  if p_source_type not in ('original', 'external', 'none')
     or p_error_code not in (
       'MEDIA_LOAD_FAILED',
       'MEDIA_DECODE_FAILED',
       'EXTERNAL_LINK_FAILED',
       'NO_PLAYABLE_SOURCE'
     ) then
    raise exception 'invalid_playback_issue';
  end if;

  insert into public.project_recording_share_playback_issues (
    share_board_id,
    organization_id,
    project_id,
    recording_submission_id,
    source_type,
    error_code,
    user_agent_family,
    reported_at
  ) values (
    v_board.id,
    v_board.organization_id,
    v_board.project_id,
    p_recording_submission_id,
    p_source_type,
    p_error_code,
    left(coalesce(p_user_agent_family, ''), 40),
    p_reported_at
  )
  returning * into v_issue;

  insert into public.project_recording_share_events (
    share_board_id,
    organization_id,
    project_id,
    event_type,
    actor_type,
    metadata,
    created_at
  ) values (
    v_board.id,
    v_board.organization_id,
    v_board.project_id,
    'playback_issue_reported',
    'public',
    jsonb_build_object(
      'issue_id', v_issue.id,
      'recording_submission_id', p_recording_submission_id,
      'source_type', p_source_type,
      'error_code', p_error_code
    ),
    p_reported_at
  );

  return v_issue;
end;
$$;

create or replace function public.resolve_admission_share_playback_issue(
  p_project_id uuid,
  p_issue_id uuid,
  p_actor_user_id uuid,
  p_resolved_at timestamptz
)
returns public.project_recording_share_playback_issues
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_issue public.project_recording_share_playback_issues;
begin
  if auth.uid() is null
     or p_actor_user_id is distinct from auth.uid()
     or not public.can_access_project(p_project_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  select *
  into strict v_issue
  from public.project_recording_share_playback_issues
  where id = p_issue_id
    and project_id = p_project_id
  for update;

  if not public.is_mcn_staff(v_issue.organization_id) then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  update public.project_recording_share_playback_issues
  set
    status = 'resolved',
    resolved_by = p_actor_user_id,
    resolved_at = p_resolved_at
  where id = p_issue_id
  returning * into v_issue;

  insert into public.project_recording_share_events (
    share_board_id,
    organization_id,
    project_id,
    event_type,
    actor_type,
    actor_user_id,
    metadata,
    created_at
  ) values (
    v_issue.share_board_id,
    v_issue.organization_id,
    v_issue.project_id,
    'playback_issue_resolved',
    'staff',
    p_actor_user_id,
    jsonb_build_object('issue_id', v_issue.id),
    p_resolved_at
  );

  return v_issue;
end;
$$;

revoke all on function public.report_admission_share_playback_issue(
  uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.report_admission_share_playback_issue(
  uuid, uuid, text, text, text, timestamptz
) to service_role;
revoke all on function public.resolve_admission_share_playback_issue(
  uuid, uuid, uuid, timestamptz
) from public, anon;
grant execute on function public.resolve_admission_share_playback_issue(
  uuid, uuid, uuid, timestamptz
) to authenticated;
```

`recordPublicAdmissionPlaybackIssue` 在 token/session 校验成功后只调用 `report_admission_share_playback_issue`，不再分别插入 issue 和 event。契约测试断言上报 RPC 只授权 `service_role` 并原子写问题与 `playback_issue_reported` 事件；解决 RPC 只更新 `status/resolved_by/resolved_at`，写 `playback_issue_resolved` 事件；migration 不包含对 playback issues 的通用 UPDATE policy。

服务重用 `requirePublicSnapshot`，验证录屏属于分享项后写问题表和 `playback_issue_reported` 事件。`errorCode` 使用白名单：

```ts
const playbackIssueCodes = new Set([
  "MEDIA_LOAD_FAILED",
  "MEDIA_DECODE_FAILED",
  "EXTERNAL_LINK_FAILED",
  "NO_PLAYABLE_SOURCE",
]);
```

只保存浏览器族，不保存完整 User-Agent、原始 IP、token、访问码或存储路径。

- [ ] **Step 4: 接入甲方反馈和运营待办**

播放器失败卡片提供：

- “重试原始视频”
- “打开备用视频”
- “反馈无法播放”

反馈成功只在当前录屏显示“已反馈”，不阻止查看下一条。

分享中心“结果待办”通过 GET `/api/projects/[projectId]/admission-share-playback-issues?status=open` 加载开放问题，显示主播、版本、来源类型、错误码和上报时间；“标记已解决”调用 POST `/api/projects/[projectId]/admission-share-playback-issues/[issueId]/resolve`。两个运营路由都复用 `getAdmissionRouteContext()`，要求 `isMcnStaff`，并把 `organizationId/projectId` 传入服务做二次约束。解决动作在同一事务写 `resolved_by/resolved_at/status`，随后写不含 token、IP 或完整 UA 的 `resolve_share_playback_issue` 审计。

`AdmissionSharePlaybackIssueDto` 只含：

```ts
export type AdmissionSharePlaybackIssueDto = {
  id: string;
  shareBoardId: string;
  recordingSubmissionId: string;
  recordingVersion: number;
  streamerDisplayName: string;
  sourceType: "original" | "external" | "none";
  errorCode: string;
  status: "open" | "resolved";
  reportedAt: string;
  resolvedAt: string | null;
};
```

- [ ] **Step 5: 运行播放链路与 UI 测试**

Run:

```powershell
corepack pnpm test "lib/db/admission-share-playback-issue-schema-contract.test.ts" "features/applications/admission-share-board.test.ts" "app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/route.test.ts" "app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/issues/route.test.ts" "app/api/projects/[projectId]/admission-share-playback-issues/route.test.ts" "app/api/projects/[projectId]/admission-share-playback-issues/[issueId]/resolve/route.test.ts" "app/share/admission/[token]/admission-share-review-workspace.test.tsx" "components/reference-ui/admission-share-center.test.jsx"
```

Expected: 8 files PASS。

- [ ] **Step 6: 提交**

```powershell
git add "supabase/migrations/20260730143000_admission_share_playback_issue_rpc.sql" "lib/db/admission-share-playback-issue-schema-contract.test.ts" "features/applications/admission-share-board.ts" "features/applications/admission-share-board.test.ts" "app/api/public/admission-share/[token]/recordings" "app/api/projects/[projectId]/admission-share-playback-issues" "app/share/admission/[token]/admission-share-review-workspace.tsx" "app/share/admission/[token]/admission-share-review-workspace.test.tsx" "components/reference-ui/admission-share-center.jsx" "components/reference-ui/admission-share-center.test.jsx"
git commit -m "feat: track admission share playback issues"
```

## Task 13: 补齐路由契约与端到端业务回归

**Files:**

- Create: `features/regression/admission-share-business-workflow.test.ts`
- Modify: `app/api/api-route-contracts.test.ts`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `app/share/admission/[token]/admission-share-page-client.test.tsx`
- Modify: `docs/superpowers/specs/2026-07-30-recording-share-business-ux-design.md`

- [ ] **Step 1: 写完整业务回归测试**

回归文件覆盖以下表驱动场景：

```ts
const scenarios = [
  {
    name: "preview never writes drafts or results",
    mode: "preview",
    expectedDraftWrites: 0,
    expectedSubmissionWrites: 0,
  },
  {
    name: "formal review requires every item",
    mode: "formal_review",
    decisions: ["selected", "pending"],
    expectedError: "REVIEW_INCOMPLETE",
  },
  {
    name: "historically approved version remains selectable",
    mcnReviewDecision: "approved",
    currentRecordingStatus: "rejected",
    expectedShareable: true,
  },
  {
    name: "historical version result never overwrites latest state",
    selectedVersion: 1,
    latestVersion: 2,
    expectedSyncStatus: "skipped",
    expectedSyncError: "superseded_recording_version",
  },
  {
    name: "locked submission requires MCN reopen",
    reviewState: "submitted_locked",
    expectedError: "REVIEW_ALREADY_LOCKED",
  },
];
```

另加 route manifest 断言，确保新增运营和公开路由均存在。

- [ ] **Step 2: 运行回归测试并确认缺失断言**

Run:

```powershell
corepack pnpm test "features/regression/admission-share-business-workflow.test.ts" "app/api/api-route-contracts.test.ts"
```

Expected: 新回归测试先 FAIL，直到测试夹具接入真实领域函数和路由 manifest。

- [ ] **Step 3: 完成回归夹具和设计文档实施映射**

回归测试直接调用：

- `preflightAdmissionShareSelection`
- `createAdmissionShareBoard`
- `savePublicAdmissionReviewDraft`
- `submitVendorAdmissionReviews`
- `reopenAdmissionShareBoard`

不复制生产规则到测试帮助函数。

在设计文档末尾新增“实施映射”，列出 Task 1–12 与设计章节的对应关系，并记录 token 一次性展示与轮换规则已经落实。

- [ ] **Step 4: 运行全部录屏分享聚焦套件**

Run:

```powershell
$admissionShareTests = rg --files | Where-Object {
  $_ -match '^lib\\db\\admission-share.*\.test\.ts$' -or
  $_ -match '^lib\\http\\admission-share.*\.test\.ts$' -or
  $_ -match '^features\\applications\\admission-share.*\.test\.ts$' -or
  $_ -match '^features\\applications\\admission-board\.test\.ts$' -or
  $_ -match '^features\\applications\\application-(service|repository)\.test\.ts$' -or
  ($_ -match '^app\\api\\.*admission-share.*\.test\.ts$') -or
  $_ -match '^app\\api\\api-route-contracts\.test\.ts$' -or
  $_ -match '^app\\share\\admission\\\[token\]\\.*\.test\.tsx?$' -or
  $_ -match '^components\\reference-ui\\(admission-share-center|ops-reference)\.test\.jsx$' -or
  $_ -match '^features\\regression\\admission-share-business-workflow\.test\.ts$'
}
if ($admissionShareTests.Count -lt 25) {
  throw "Admission share focused suite is incomplete: $($admissionShareTests.Count) files"
}
corepack pnpm test @admissionShareTests
```

Expected: 至少收集 25 个聚焦测试文件，全部 PASS；命令不依赖 PowerShell 展开 glob。

- [ ] **Step 5: 提交**

```powershell
git add "features/regression/admission-share-business-workflow.test.ts" "app/api/api-route-contracts.test.ts" "components/reference-ui/ops-reference.test.jsx" "app/share/admission/[token]/admission-share-page-client.test.tsx" "docs/superpowers/specs/2026-07-30-recording-share-business-ux-design.md"
git commit -m "test: cover admission share business workflow"
```

## Task 14: 全量本地验证与交付准备

**Files:**

- Modify only if verification finds an in-scope defect.

- [ ] **Step 1: 检查变更范围**

Run:

```powershell
git status --short
git diff --stat "origin/codex/full-project-ui...HEAD"
git diff --name-only "origin/codex/full-project-ui...HEAD"
```

Expected: 只包含录屏分享、准入内审事实、对应迁移、测试和设计/计划文档。

- [ ] **Step 2: 运行格式与差异检查**

Run:

```powershell
corepack pnpm exec prettier --check "features/applications" "app/api/projects" "app/api/public/admission-share" "app/share/admission" "components/reference-ui/admission-share-center.jsx" "components/reference-ui/admission-share-center.test.jsx" "lib/db" "supabase/migrations/202607301*.sql"
git diff --check "origin/codex/full-project-ui...HEAD"
```

Expected: Prettier PASS；`git diff --check` 无输出。

- [ ] **Step 3: 运行完整静态检查**

Run:

```powershell
corepack pnpm type-check
corepack pnpm lint
```

Expected: 两条命令 exit 0。若存在基线失败，必须在相同基线工作树复现并单独记录，不能把基线失败描述为本功能通过。

- [ ] **Step 4: 运行完整测试**

Run:

```powershell
corepack pnpm test
```

Expected: 全部测试 PASS，0 failed。

- [ ] **Step 5: 运行生产构建**

Run:

```powershell
corepack pnpm build
```

Expected: Next.js build exit 0。

- [ ] **Step 6: 运行真实浏览器验收**

启动：

```powershell
corepack pnpm dev
```

在浏览器依次验证：

1. 运营打开项目录屏分享中心；
2. 主动选择最新和历史已通过版本；
3. 一条异常录屏可被移除，其他选择不丢失；
4. 创建预览分享，不出现判断控件；
5. 创建正式分享，访问码不在 URL；
6. 原始上传优先播放，外链显示为备用；
7. 草稿刷新后恢复；
8. 两个会话并发编辑出现冲突提示；
9. 未完成不能提交；
10. 正式提交后锁定；
11. MCN 重开后出现新修订，旧快照仍可查；
12. token 轮换后旧链接和旧会话失效；
13. 单条播放失败反馈进入运营待办；
14. 桌面 1440×900、平板 1024×768、手机 390×844 均能完成主流程。

Expected: 14 项全部通过并保存截图证据。

- [ ] **Step 7: 最终提交修复**

只有 Step 1–6 发现并修复了范围内问题时执行：

```powershell
git add --update
git diff --cached --name-only
git commit -m "fix: close admission share verification gaps"
```

`git diff --cached --name-only` 必须逐项确认只包含本计划已跟踪文件；新增文件已在 Task 1–13 的提交中加入，不应在最终验证阶段首次出现。没有新增修复时不创建空提交。

- [ ] **Step 8: 交付前最终证据**

Run:

```powershell
git status --short
git log --oneline "origin/codex/full-project-ui..HEAD"
git diff --check "origin/codex/full-project-ui...HEAD"
```

Expected: 工作树干净；提交历史只包含本计划任务；diff check 无输出。

## 2. 需求覆盖矩阵

| 设计要求                          | 实施任务            |
| --------------------------------- | ------------------- |
| 双模式                            | Task 4、8、10、11   |
| 主动选择具体录屏版本              | Task 3、4、10       |
| 历史 MCN 通过事实不被甲方结果覆盖 | Task 1、2、3、7     |
| 单条异常不阻断整批                | Task 3、4、10、12   |
| 原始视频优先、外链备用            | Task 3、8、11、12   |
| 生成前预览原始视频和外链          | Task 3、10、14      |
| 服务端草稿和并发冲突              | Task 6、11          |
| 全部完成后原子提交                | Task 7、11          |
| 提交锁定、MCN 重开                | Task 5、7、8、11    |
| 历史提交快照与新轮次              | Task 1、5、7、9、10 |
| selected 不自动入项               | Task 7、9、13       |
| backup 可见但不改状态             | Task 7、9、13       |
| 负向结果必须有原因并回流          | Task 7、9、11       |
| 分享进度与运营待办                | Task 9、10、12      |
| token 明文只展示一次              | Task 4、5、10       |
| 公开 DTO 与隐私白名单             | Task 6、7、8、12    |
| 播放异常上报、运营解决与审计      | Task 1、12、14      |
| 过期/撤销同时关闭数据和播放       | Task 5、8、12、13   |
| 桌面/移动完整流程                 | Task 10、11、14     |
