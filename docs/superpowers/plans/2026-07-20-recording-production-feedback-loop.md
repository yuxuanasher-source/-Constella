# Recording Production Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production slice of the admission recording flow: project task card, streamer read confirmation, six-dimension self-check, key moments, technical checks, AI pre-review evidence, MCN review, vendor review, and one structured feedback surface that only says what is not qualified and how to improve.

**Architecture:** Reuse the existing `project_applications + recording_submissions + admission_review_evaluations` state machine. Add project-level recording guide data and submission-level self-check metadata, then feed the same structured context into streamer UI, AI pre-review, MCN review, vendor review, and streamer-facing feedback. AI and system output remains advisory only; business state changes stay in existing human review routes.

**Tech Stack:** Next.js App Router, TypeScript services, Supabase SQL migrations/RLS, Vitest, React Testing Library, existing reference UI components.

---

## Non-Negotiable Boundary

This work must not let AI or deterministic checks decide admission outcomes.

Allowed:

- Show what is missing or weak.
- Show evidence time ranges.
- Suggest how to modify.
- Suggest that a clip or full recording may need rerecording.
- Block invalid submissions only when the submission payload is incomplete or the video is technically impossible to process, such as no URL/file, invalid URL, invalid storage path, or configured file-size limit.

Forbidden:

- Auto-approve a recording.
- Auto-reject a recording.
- Automatically mark a recording as `needs_changes`.
- Automatically move an application into or out of a project.
- Treat `rerecordSuggestion` as a workflow state.

Use this wording everywhere: "建议重录" / "建议补录" / "建议修改". Do not write "必须重录" unless it is a deterministic upload validation error such as file cannot be opened.

## File Structure

- Create `features/recordings/recording-production-standard.ts`
  - Shared six-dimension definitions, key moment definitions, self-check validation, advisory wording helpers.
- Create `features/recordings/recording-production-standard.test.ts`
  - Unit tests for score weights, validation, L0-L4 self-assessment labels, and advisory-only rerecord wording.
- Create `supabase/migrations/20260720140000_recording_production_feedback_loop.sql`
  - Project recording guide table and submission self-check columns.
- Create `lib/db/recording-production-feedback-schema-contract.test.ts`
  - Schema contract test for the migration.
- Create `features/recordings/recording-production-guide.ts`
  - Read project task cards, normalize guide rows, normalize submission self-checks.
- Create `features/recordings/recording-production-guide.test.ts`
  - Service tests for guide fallback, streamer visibility, and self-check normalization.
- Modify `features/recordings/project-announcements.ts`
  - Include `recordingGuide` on streamer project cards.
- Modify `features/recordings/project-announcements.test.ts`
  - Assert guide fields and fallback copy reach streamer cards.
- Modify `features/recordings/project-recording-delivery.ts`
  - Require read confirmation and self-check payload on project recording submissions; store them on `recording_submissions`.
- Modify `features/recordings/project-recording-delivery.test.ts`
  - Assert incomplete self-check is rejected before submission and low self-score does not block submission.
- Modify `app/api/streamer/recordings/route.ts`
  - Parse `selfCheck` and pass it to project recording delivery.
- Modify `app/api/streamer/recordings/route.test.ts`
  - Route-level coverage for project recording submission with self-check.
- Modify `components/reference-ui/streamer-mobile-reference.jsx`
  - Show task card, read confirmation, template/example, six-dimension self-check, key moments.
- Modify `components/reference-ui/streamer-mobile-reference.test.jsx`
  - Mobile streamer UI tests.
- Modify `components/reference-ui/streamer-desktop-reference.jsx`
  - Desktop equivalent of the streamer flow.
- Modify `components/reference-ui/streamer-desktop-reference.test.jsx`
  - Desktop streamer UI tests.
- Modify `features/admission-review/pre-review.ts`
  - Include project guide and self-check context in AI pre-review prompt and structured evidence.
- Modify `features/admission-review/pre-review.test.ts`
  - Assert prompt context and advisory feedback shape.
- Modify `features/admission-review/pre-review-job.ts`
  - Load guide/self-check context for each queued submission.
- Modify `features/admission-review/pre-review-job.test.ts`
  - Job-level coverage.
- Modify `features/admission-review/rejection-feedback.ts`
  - Return structured issue/how-to-improve/rerecord suggestion fields when present in checkpoint evidence.
- Modify `features/admission-review/rejection-feedback.test.ts`
  - Assert streamer feedback remains advisory.
- Modify `components/reference-ui/ops-reference.jsx`
  - Show task card, self-check, key moments, AI pre-review evidence, and structured feedback writer in the review workspace.
- Modify `components/reference-ui/ops-reference.test.jsx`
  - Ops workspace tests.

## Task 1: Six-Dimension Production Standard Contract

**Files:**
- Create: `features/recordings/recording-production-standard.ts`
- Create: `features/recordings/recording-production-standard.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `features/recordings/recording-production-standard.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  KEY_MOMENT_KEYS,
  RECORDING_PRODUCTION_DIMENSIONS,
  classifySelfAssessmentLevel,
  normalizeRecordingSelfCheck,
  rerecordSuggestionLabel,
} from "./recording-production-standard";

describe("recording production standard", () => {
  it("keeps the six-dimension weights aligned to 100 points", () => {
    expect(RECORDING_PRODUCTION_DIMENSIONS.map((item) => item.key)).toEqual([
      "product_understanding",
      "expression_control",
      "content_structure",
      "interaction_design",
      "commercial_task",
      "technical_compliance",
    ]);
    expect(
      RECORDING_PRODUCTION_DIMENSIONS.reduce(
        (sum, item) => sum + item.weight,
        0,
      ),
    ).toBe(100);
  });

  it("requires read confirmation, all six scores, and three key moments", () => {
    const normalized = normalizeRecordingSelfCheck({
      readConfirmed: true,
      dimensionScores: {
        product_understanding: 20,
        expression_control: 18,
        content_structure: 12,
        interaction_design: 11,
        commercial_task: 12,
        technical_compliance: 9,
      },
      keyMoments: [
        { key: "best_performance", startSeconds: 30, endSeconds: 80 },
        { key: "selling_point", startSeconds: 120, endSeconds: 180 },
        { key: "commercial_task", startSeconds: 240, endSeconds: 300 },
      ],
      note: "已完整回看一次。",
    });

    expect(normalized.totalScore).toBe(82);
    expect(normalized.selfLevel).toBe("L3");
    expect(normalized.keyMoments.map((item) => item.key)).toEqual(
      KEY_MOMENT_KEYS,
    );
  });

  it("does not use rerecord wording as a business decision", () => {
    expect(rerecordSuggestionLabel("clip")).toBe("建议补录指定片段");
    expect(rerecordSuggestionLabel("full")).toBe("建议整段重录");
    expect(rerecordSuggestionLabel("none")).toBe("暂无重录建议");
  });

  it("classifies self-assessment levels without blocking submission", () => {
    expect(classifySelfAssessmentLevel(95)).toBe("L4");
    expect(classifySelfAssessmentLevel(80)).toBe("L3");
    expect(classifySelfAssessmentLevel(70)).toBe("L2");
    expect(classifySelfAssessmentLevel(60)).toBe("L1");
    expect(classifySelfAssessmentLevel(30)).toBe("L0");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm test features/recordings/recording-production-standard.test.ts
```

Expected: fail because `recording-production-standard.ts` does not exist.

- [ ] **Step 3: Add the domain contract**

Create `features/recordings/recording-production-standard.ts`:

```ts
export type RecordingProductionDimensionKey =
  | "product_understanding"
  | "expression_control"
  | "content_structure"
  | "interaction_design"
  | "commercial_task"
  | "technical_compliance";

export type RecordingSelfAssessmentLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type RerecordSuggestion = "none" | "clip" | "full";

export type RecordingKeyMomentKey =
  | "best_performance"
  | "selling_point"
  | "commercial_task";

export type RecordingProductionDimension = {
  key: RecordingProductionDimensionKey;
  label: string;
  weight: number;
  checkItems: string[];
};

export type RecordingKeyMomentInput = {
  key: RecordingKeyMomentKey;
  startSeconds: number;
  endSeconds: number;
  note?: string;
};

export type RecordingSelfCheckInput = {
  readConfirmed: boolean;
  dimensionScores: Partial<Record<RecordingProductionDimensionKey, number>>;
  keyMoments: RecordingKeyMomentInput[];
  note?: string;
};

export type NormalizedRecordingSelfCheck = {
  readConfirmed: true;
  dimensionScores: Record<RecordingProductionDimensionKey, number>;
  totalScore: number;
  selfLevel: RecordingSelfAssessmentLevel;
  keyMoments: RecordingKeyMomentInput[];
  note: string | null;
};

export const RECORDING_PRODUCTION_DIMENSIONS: RecordingProductionDimension[] = [
  {
    key: "product_understanding",
    label: "产品理解与卖点展示",
    weight: 25,
    checkItems: ["游戏版本正确", "玩法规则准确", "核心卖点出现在画面中"],
  },
  {
    key: "expression_control",
    label: "主播表达与控场能力",
    weight: 20,
    checkItems: ["能边操作边解释", "无长时间无意义沉默", "等待期间能持续输出"],
  },
  {
    key: "content_structure",
    label: "内容结构与吸引力",
    weight: 15,
    checkItems: ["开场有目标", "过程有推进", "结尾有总结"],
  },
  {
    key: "interaction_design",
    label: "互动能力",
    weight: 15,
    checkItems: ["主动抛问题", "围绕玩法设计选择或竞猜", "回应观众可能关心的问题"],
  },
  {
    key: "commercial_task",
    label: "商业任务执行",
    weight: 15,
    checkItems: ["指定入口出现在画面中", "福利和规则准确", "行动引导自然"],
  },
  {
    key: "technical_compliance",
    label: "技术质量与合规",
    weight: 10,
    checkItems: ["画面和人声清晰", "无隐私泄露", "无违规表达"],
  },
];

export const KEY_MOMENT_KEYS: RecordingKeyMomentKey[] = [
  "best_performance",
  "selling_point",
  "commercial_task",
];

export function normalizeRecordingSelfCheck(
  input: RecordingSelfCheckInput,
): NormalizedRecordingSelfCheck {
  if (!input.readConfirmed) {
    throw new Error("Recording task card must be confirmed before submission");
  }

  const dimensionScores = {} as Record<RecordingProductionDimensionKey, number>;
  let totalScore = 0;
  for (const dimension of RECORDING_PRODUCTION_DIMENSIONS) {
    const raw = input.dimensionScores[dimension.key];
    if (!Number.isFinite(raw)) {
      throw new Error(`Missing recording self-check score: ${dimension.key}`);
    }
    const score = Math.max(0, Math.min(dimension.weight, Math.trunc(raw)));
    dimensionScores[dimension.key] = score;
    totalScore += score;
  }

  const keyMoments = normalizeKeyMoments(input.keyMoments);

  return {
    readConfirmed: true,
    dimensionScores,
    totalScore,
    selfLevel: classifySelfAssessmentLevel(totalScore),
    keyMoments,
    note: input.note?.trim() || null,
  };
}

export function classifySelfAssessmentLevel(
  totalScore: number,
): RecordingSelfAssessmentLevel {
  if (totalScore >= 90) return "L4";
  if (totalScore >= 80) return "L3";
  if (totalScore >= 70) return "L2";
  if (totalScore >= 60) return "L1";
  return "L0";
}

export function rerecordSuggestionLabel(value: RerecordSuggestion): string {
  if (value === "clip") return "建议补录指定片段";
  if (value === "full") return "建议整段重录";
  return "暂无重录建议";
}

function normalizeKeyMoments(
  moments: RecordingKeyMomentInput[],
): RecordingKeyMomentInput[] {
  const byKey = new Map<RecordingKeyMomentKey, RecordingKeyMomentInput>();
  for (const moment of moments) {
    if (!KEY_MOMENT_KEYS.includes(moment.key)) continue;
    const startSeconds = Math.max(0, Math.trunc(moment.startSeconds));
    const endSeconds = Math.max(startSeconds + 1, Math.trunc(moment.endSeconds));
    byKey.set(moment.key, {
      key: moment.key,
      startSeconds,
      endSeconds,
      note: moment.note?.trim() || undefined,
    });
  }

  for (const key of KEY_MOMENT_KEYS) {
    if (!byKey.has(key)) {
      throw new Error(`Missing recording key moment: ${key}`);
    }
  }

  return KEY_MOMENT_KEYS.map((key) => byKey.get(key)!);
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm test features/recordings/recording-production-standard.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add features/recordings/recording-production-standard.ts features/recordings/recording-production-standard.test.ts
git commit -m "feat: add recording production standard contract"
```

## Task 2: Database Schema For Project Guide And Submission Self-Check

**Files:**
- Create: `supabase/migrations/20260720140000_recording_production_feedback_loop.sql`
- Create: `lib/db/recording-production-feedback-schema-contract.test.ts`

- [ ] **Step 1: Write the failing schema contract test**

Create `lib/db/recording-production-feedback-schema-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260720140000_recording_production_feedback_loop.sql",
  "utf8",
);

describe("recording production feedback schema", () => {
  it("creates project recording guides", () => {
    expect(migration).toContain(
      "create table if not exists public.project_recording_guides",
    );
    expect(migration).toContain("required_content jsonb not null default '[]'::jsonb");
    expect(migration).toContain("commercial_actions jsonb not null default '[]'::jsonb");
    expect(migration).toContain("unique (organization_id, project_id)");
  });

  it("adds advisory self-check metadata to recording submissions", () => {
    expect(migration).toContain("add column if not exists task_card_read_confirmed_at");
    expect(migration).toContain("add column if not exists self_check jsonb");
    expect(migration).toContain("add column if not exists key_moments jsonb");
    expect(migration).toContain("add column if not exists self_score_total integer");
    expect(migration).toContain("add column if not exists self_assessment_level text");
    expect(migration).toContain("recording_submissions_self_score_range");
  });

  it("keeps streamer access scoped to own project/application rows", () => {
    expect(migration).toContain("project_recording_guides_streamer_read_visible");
    expect(migration).toContain("current_streamer_id");
    expect(migration).toContain("project_recording_guides_staff_access");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm test lib/db/recording-production-feedback-schema-contract.test.ts
```

Expected: fail because the migration does not exist.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/20260720140000_recording_production_feedback_loop.sql`:

```sql
-- Recording production feedback loop:
-- project task card + streamer self-check + key moments.
-- These fields are advisory evidence only and do not change admission state.

create table if not exists public.project_recording_guides (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  game_name text not null default '',
  game_version text not null default '',
  server_region text not null default '',
  promotion_goal text not null default '',
  target_audience text not null default '',
  required_content jsonb not null default '[]'::jsonb,
  required_talking_points jsonb not null default '[]'::jsonb,
  forbidden_content jsonb not null default '[]'::jsonb,
  commercial_actions jsonb not null default '[]'::jsonb,
  technical_standard jsonb not null default '{}'::jsonb,
  template_text text not null default '',
  example_url text,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id),
  constraint project_recording_guides_example_url_http check (
    example_url is null or example_url ~* '^https?://'
  ),
  constraint project_recording_guides_required_content_array check (
    jsonb_typeof(required_content) = 'array'
  ),
  constraint project_recording_guides_required_talking_points_array check (
    jsonb_typeof(required_talking_points) = 'array'
  ),
  constraint project_recording_guides_forbidden_content_array check (
    jsonb_typeof(forbidden_content) = 'array'
  ),
  constraint project_recording_guides_commercial_actions_array check (
    jsonb_typeof(commercial_actions) = 'array'
  ),
  constraint project_recording_guides_technical_standard_object check (
    jsonb_typeof(technical_standard) = 'object'
  )
);

alter table public.recording_submissions
  add column if not exists task_card_read_confirmed_at timestamptz,
  add column if not exists self_check jsonb not null default '{}'::jsonb,
  add column if not exists key_moments jsonb not null default '[]'::jsonb,
  add column if not exists self_score_total integer,
  add column if not exists self_assessment_level text,
  add column if not exists submitter_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recording_submissions_self_score_range'
  ) then
    alter table public.recording_submissions
      add constraint recording_submissions_self_score_range
      check (self_score_total is null or self_score_total between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'recording_submissions_self_assessment_level'
  ) then
    alter table public.recording_submissions
      add constraint recording_submissions_self_assessment_level
      check (
        self_assessment_level is null
        or self_assessment_level in ('L0', 'L1', 'L2', 'L3', 'L4')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'recording_submissions_self_check_object'
  ) then
    alter table public.recording_submissions
      add constraint recording_submissions_self_check_object
      check (jsonb_typeof(self_check) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'recording_submissions_key_moments_array'
  ) then
    alter table public.recording_submissions
      add constraint recording_submissions_key_moments_array
      check (jsonb_typeof(key_moments) = 'array');
  end if;
end $$;

create index if not exists project_recording_guides_project_idx
on public.project_recording_guides (project_id);

create index if not exists recording_submissions_self_level_idx
on public.recording_submissions (organization_id, self_assessment_level, submitted_at desc);

create trigger project_recording_guides_touch_updated_at
before update on public.project_recording_guides
for each row execute function public.touch_updated_at();

alter table public.project_recording_guides enable row level security;

create policy project_recording_guides_staff_access
on public.project_recording_guides
for all
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id))
with check (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy project_recording_guides_streamer_read_visible
on public.project_recording_guides
for select
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_recording_guides.project_id
      and p.organization_id = project_recording_guides.organization_id
      and p.open_signup = true
      and p.status in ('recruiting', 'pending_start', 'active', 'paused')
  )
  and public.current_streamer_id(organization_id) is not null
);
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm test lib/db/recording-production-feedback-schema-contract.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add supabase/migrations/20260720140000_recording_production_feedback_loop.sql lib/db/recording-production-feedback-schema-contract.test.ts
git commit -m "feat: add recording production guide schema"
```

## Task 3: Recording Guide Service And Streamer Announcement DTO

**Files:**
- Create: `features/recordings/recording-production-guide.ts`
- Create: `features/recordings/recording-production-guide.test.ts`
- Modify: `features/recordings/project-announcements.ts`
- Modify: `features/recordings/project-announcements.test.ts`

- [ ] **Step 1: Write service tests for guide fallback and normalization**

Create `features/recordings/recording-production-guide.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  defaultRecordingProductionGuide,
  normalizeRecordingGuideRow,
} from "./recording-production-guide";

describe("recording production guide", () => {
  it("normalizes project guide rows for streamer task cards", () => {
    expect(
      normalizeRecordingGuideRow({
        game_name: "星海测试服",
        game_version: "1.2",
        server_region: "安卓一区",
        promotion_goal: "新版本拉新",
        target_audience: "新手玩家",
        required_content: ["新职业", "活动入口"],
        required_talking_points: ["福利领取方式"],
        forbidden_content: ["虚假保底", "攻击竞品"],
        commercial_actions: ["展示预约福利入口"],
        technical_standard: { minDurationMinutes: 10, orientation: "landscape" },
        template_text: "开场说明今天测试新职业。",
        example_url: "https://example.com/demo",
      }),
    ).toMatchObject({
      gameName: "星海测试服",
      gameVersion: "1.2",
      serverRegion: "安卓一区",
      promotionGoal: "新版本拉新",
      targetAudience: "新手玩家",
      requiredContent: ["新职业", "活动入口"],
      requiredTalkingPoints: ["福利领取方式"],
      forbiddenContent: ["虚假保底", "攻击竞品"],
      commercialActions: ["展示预约福利入口"],
      templateText: "开场说明今天测试新职业。",
      exampleUrl: "https://example.com/demo",
    });
  });

  it("builds a useful fallback from the public project card", () => {
    expect(
      defaultRecordingProductionGuide({
        product: "星海",
        publicSummary: "重点展示新职业和福利入口。",
        forceRecording: true,
      }),
    ).toMatchObject({
      gameName: "星海",
      requiredContent: ["重点展示新职业和福利入口。"],
      templateText: expect.stringContaining("开场"),
    });
  });
});
```

- [ ] **Step 2: Run the focused service test and verify it fails**

Run:

```bash
pnpm test features/recordings/recording-production-guide.test.ts
```

Expected: fail because the service file does not exist.

- [ ] **Step 3: Add `recording-production-guide.ts`**

Create `features/recordings/recording-production-guide.ts`:

```ts
export type RecordingProductionGuide = {
  gameName: string;
  gameVersion: string;
  serverRegion: string;
  promotionGoal: string;
  targetAudience: string;
  requiredContent: string[];
  requiredTalkingPoints: string[];
  forbiddenContent: string[];
  commercialActions: string[];
  technicalStandard: Record<string, unknown>;
  templateText: string;
  exampleUrl: string | null;
};

export type RecordingGuideRow = {
  game_name?: string | null;
  game_version?: string | null;
  server_region?: string | null;
  promotion_goal?: string | null;
  target_audience?: string | null;
  required_content?: unknown;
  required_talking_points?: unknown;
  forbidden_content?: unknown;
  commercial_actions?: unknown;
  technical_standard?: unknown;
  template_text?: string | null;
  example_url?: string | null;
};

export function normalizeRecordingGuideRow(
  row: RecordingGuideRow | null | undefined,
): RecordingProductionGuide | null {
  if (!row) return null;
  return {
    gameName: clean(row.game_name),
    gameVersion: clean(row.game_version),
    serverRegion: clean(row.server_region),
    promotionGoal: clean(row.promotion_goal),
    targetAudience: clean(row.target_audience),
    requiredContent: stringArray(row.required_content),
    requiredTalkingPoints: stringArray(row.required_talking_points),
    forbiddenContent: stringArray(row.forbidden_content),
    commercialActions: stringArray(row.commercial_actions),
    technicalStandard:
      row.technical_standard && typeof row.technical_standard === "object"
        ? (row.technical_standard as Record<string, unknown>)
        : {},
    templateText: clean(row.template_text),
    exampleUrl: clean(row.example_url) || null,
  };
}

export function defaultRecordingProductionGuide(input: {
  product: string;
  publicSummary: string;
  forceRecording: boolean;
}): RecordingProductionGuide {
  return {
    gameName: input.product.trim(),
    gameVersion: "",
    serverRegion: "",
    promotionGoal: "",
    targetAudience: "",
    requiredContent: input.publicSummary.trim() ? [input.publicSummary.trim()] : [],
    requiredTalkingPoints: [],
    forbiddenContent: ["虚假宣传", "攻击竞品", "外挂/代充/账号交易", "泄露隐私"],
    commercialActions: [],
    technicalStandard: {
      forceRecording: input.forceRecording,
      minDurationMinutes: input.forceRecording ? 10 : 0,
    },
    templateText:
      "开场说明本场目标；过程围绕目标展示玩法、卖点和互动；结尾总结体验结果和下一步建议。",
    exampleUrl: null,
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}
```

- [ ] **Step 4: Run the focused service test and verify it passes**

Run:

```bash
pnpm test features/recordings/recording-production-guide.test.ts
```

Expected: pass.

- [ ] **Step 5: Extend streamer announcements with `recordingGuide`**

Modify `features/recordings/project-announcements.ts`:

```ts
import {
  defaultRecordingProductionGuide,
  normalizeRecordingGuideRow,
  type RecordingProductionGuide,
  type RecordingGuideRow,
} from "@/features/recordings/recording-production-guide";
```

Add to `StreamerProjectAnnouncementCard`:

```ts
recordingGuide: RecordingProductionGuide;
```

Add `project_recording_guides(...)` to the project select:

```ts
"id, code, name, status, vendor_name, product_name, open_signup, force_recording, public_summary, game_download_url, published_at, created_at, project_recording_guides(game_name, game_version, server_region, promotion_goal, target_audience, required_content, required_talking_points, forbidden_content, commercial_actions, technical_standard, template_text, example_url)"
```

Add the guide to `toStreamerProjectAnnouncementCard`:

```ts
const guideRow = Array.isArray((project as { project_recording_guides?: unknown }).project_recording_guides)
  ? ((project as { project_recording_guides?: RecordingGuideRow[] }).project_recording_guides?.[0] ?? null)
  : null;
const recordingGuide =
  normalizeRecordingGuideRow(guideRow) ??
  defaultRecordingProductionGuide({
    product: project.product_name?.trim() || project.name,
    publicSummary: project.public_summary?.trim() || "",
    forceRecording: project.force_recording,
  });
```

Return `recordingGuide`.

- [ ] **Step 6: Add DTO test coverage**

In `features/recordings/project-announcements.test.ts`, add a case:

```ts
it("includes the recording production guide on streamer project cards", async () => {
  const cards = await listStreamerProjectAnnouncements(mockSupabaseWithGuide(), {
    organizationId: "org-1",
    streamerId: "streamer-1",
  });

  expect(cards[0].recordingGuide).toMatchObject({
    gameName: "星海测试服",
    requiredContent: ["新职业", "活动入口"],
    commercialActions: ["展示预约福利入口"],
  });
});
```

Use the existing mock style in that file; the mocked project row must include `project_recording_guides: [{ ... }]`.

- [ ] **Step 7: Run announcement tests**

Run:

```bash
pnpm test features/recordings/recording-production-guide.test.ts features/recordings/project-announcements.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit Task 3**

```bash
git add features/recordings/recording-production-guide.ts features/recordings/recording-production-guide.test.ts features/recordings/project-announcements.ts features/recordings/project-announcements.test.ts
git commit -m "feat: expose recording production guide to streamers"
```

## Task 4: Store Streamer Confirmation, Self-Check, And Key Moments On Submission

**Files:**
- Modify: `features/applications/application-service.ts`
- Modify: `features/applications/application-repository.ts`
- Modify: `features/recordings/project-recording-delivery.ts`
- Modify: `features/recordings/project-recording-delivery.test.ts`
- Modify: `app/api/streamer/recordings/route.ts`
- Modify: `app/api/streamer/recordings/route.test.ts`

- [ ] **Step 1: Write the failing delivery tests**

In `features/recordings/project-recording-delivery.test.ts`, add:

```ts
it("requires task-card confirmation and a complete self-check for project recordings", async () => {
  await expect(
    submitProjectRecording({
      repo,
      audit,
      notify,
      actor: streamerActor,
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        link: "https://example.com/recording.mp4",
        selfCheck: {
          readConfirmed: false,
          dimensionScores: {},
          keyMoments: [],
        },
      },
    }),
  ).rejects.toThrow(/task card must be confirmed/i);

  expect(repo.createdRecordings).toHaveLength(0);
});

it("stores low self-score as evidence without blocking submission", async () => {
  const result = await submitProjectRecording({
    repo,
    audit,
    notify,
    actor: streamerActor,
    input: {
      projectId: "project-1",
      streamerId: "streamer-1",
      link: "https://example.com/recording.mp4",
      selfCheck: {
        readConfirmed: true,
        dimensionScores: {
          product_understanding: 8,
          expression_control: 8,
          content_structure: 7,
          interaction_design: 7,
          commercial_task: 6,
          technical_compliance: 6,
        },
        keyMoments: [
          { key: "best_performance", startSeconds: 10, endSeconds: 20 },
          { key: "selling_point", startSeconds: 30, endSeconds: 45 },
          { key: "commercial_task", startSeconds: 50, endSeconds: 70 },
        ],
        note: "自评偏低，但希望运营给修改建议。",
      },
    },
  });

  expect(result.recording.status).toBe("submitted");
  expect(repo.createdRecordings[0]).toMatchObject({
    selfScoreTotal: 42,
    selfAssessmentLevel: "L0",
  });
});
```

- [ ] **Step 2: Run the focused delivery test and verify it fails**

Run:

```bash
pnpm test features/recordings/project-recording-delivery.test.ts
```

Expected: fail because `selfCheck` is not accepted or persisted.

- [ ] **Step 3: Extend service types**

In `features/applications/application-service.ts`, import the normalized type:

```ts
import type { NormalizedRecordingSelfCheck } from "@/features/recordings/recording-production-standard";
```

Extend `RecordingSubmissionRecord`:

```ts
selfScoreTotal?: number | null;
selfAssessmentLevel?: string | null;
```

Extend `ApplicationRepository.createRecordingSubmission` input:

```ts
selfCheck?: NormalizedRecordingSelfCheck;
```

In `submitRecording`, pass it through:

```ts
selfCheck: input.selfCheck,
```

Extend the `submitRecording` input type:

```ts
selfCheck?: NormalizedRecordingSelfCheck;
```

- [ ] **Step 4: Persist self-check in the Supabase repository**

In `features/applications/application-repository.ts`, update `createRecordingSubmission` insert payload:

```ts
task_card_read_confirmed_at: input.selfCheck
  ? new Date().toISOString()
  : null,
self_check: input.selfCheck?.dimensionScores ?? {},
key_moments: input.selfCheck?.keyMoments ?? [],
self_score_total: input.selfCheck?.totalScore ?? null,
self_assessment_level: input.selfCheck?.selfLevel ?? null,
submitter_note: input.selfCheck?.note ?? null,
```

Update the `.select(...)` for create/get/update to include:

```ts
self_score_total, self_assessment_level
```

Update `toRecordingSubmissionRecord`:

```ts
selfScoreTotal: row.self_score_total ?? null,
selfAssessmentLevel: row.self_assessment_level ?? null,
```

- [ ] **Step 5: Normalize self-check before recording creation**

In `features/recordings/project-recording-delivery.ts`, import:

```ts
import {
  normalizeRecordingSelfCheck,
  type RecordingSelfCheckInput,
} from "./recording-production-standard";
```

Extend input:

```ts
selfCheck?: RecordingSelfCheckInput;
```

Before calling `submitRecording`:

```ts
const selfCheck = normalizeRecordingSelfCheck(normalized.selfCheck);
```

Pass to `submitRecording`:

```ts
selfCheck,
```

In `normalizeProjectRecordingInput`, require project submissions to include `selfCheck`:

```ts
if (!input.selfCheck || typeof input.selfCheck !== "object") {
  throw new Error("Recording self-check is required");
}
```

Return `selfCheck: input.selfCheck as RecordingSelfCheckInput`.

- [ ] **Step 6: Parse route body self-check**

In `app/api/streamer/recordings/route.ts`, pass:

```ts
selfCheck:
  body.selfCheck && typeof body.selfCheck === "object"
    ? (body.selfCheck as never)
    : undefined,
```

- [ ] **Step 7: Add route test coverage**

In `app/api/streamer/recordings/route.test.ts`, add a POST body with:

```ts
selfCheck: {
  readConfirmed: true,
  dimensionScores: {
    product_understanding: 20,
    expression_control: 18,
    content_structure: 12,
    interaction_design: 12,
    commercial_task: 12,
    technical_compliance: 9,
  },
  keyMoments: [
    { key: "best_performance", startSeconds: 30, endSeconds: 80 },
    { key: "selling_point", startSeconds: 120, endSeconds: 180 },
    { key: "commercial_task", startSeconds: 240, endSeconds: 300 },
  ],
}
```

Assert the route returns `201` and the service receives `selfCheck`.

- [ ] **Step 8: Run focused delivery and route tests**

Run:

```bash
pnpm test features/recordings/project-recording-delivery.test.ts app/api/streamer/recordings/route.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit Task 4**

```bash
git add features/applications/application-service.ts features/applications/application-repository.ts features/recordings/project-recording-delivery.ts features/recordings/project-recording-delivery.test.ts app/api/streamer/recordings/route.ts app/api/streamer/recordings/route.test.ts
git commit -m "feat: store streamer recording self-check"
```

## Task 5: Streamer UI Task Card, Template, Self-Check, And Key Moments

**Files:**
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.test.jsx`

- [ ] **Step 1: Write mobile UI tests**

In `components/reference-ui/streamer-mobile-reference.test.jsx`, add tests that open the project recording form and assert:

```ts
expect(screen.getByText("项目任务卡")).toBeInTheDocument();
expect(screen.getByText("录屏模板 / 示例")).toBeInTheDocument();
expect(screen.getByLabelText("我已阅读并理解本次录屏要求")).toBeInTheDocument();
expect(screen.getByLabelText("产品理解与卖点展示自评分")).toBeInTheDocument();
expect(screen.getByLabelText("最佳表现片段开始时间")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "提交项目录屏" })).toBeDisabled();
```

Then fill read confirmation, six scores, three key moments, and a URL. Assert submit sends:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "/api/streamer/recordings",
  expect.objectContaining({
    method: "POST",
    body: expect.stringContaining('"selfCheck"'),
  }),
);
```

- [ ] **Step 2: Run the mobile UI test and verify it fails**

Run:

```bash
pnpm test components/reference-ui/streamer-mobile-reference.test.jsx
```

Expected: fail because the UI does not render the new form fields.

- [ ] **Step 3: Implement the mobile form**

In `components/reference-ui/streamer-mobile-reference.jsx`, add form state:

```jsx
selfCheck: {
  readConfirmed: false,
  dimensionScores: {},
  keyMoments: {
    best_performance: { startSeconds: "", endSeconds: "" },
    selling_point: { startSeconds: "", endSeconds: "" },
    commercial_task: { startSeconds: "", endSeconds: "" },
  },
  note: "",
},
```

Render before the URL/file fields:

```jsx
<MCard>
  <SectionKicker>项目任务卡</SectionKicker>
  <div>{project.recordingGuide?.gameName || project.product || project.name}</div>
  <div>{project.recordingGuide?.promotionGoal || project.publicSummary}</div>
  {(project.recordingGuide?.requiredContent || []).map((item) => (
    <MBadge key={item} tone="blue">{item}</MBadge>
  ))}
</MCard>
<MCard>
  <SectionKicker>录屏模板 / 示例</SectionKicker>
  <div>{project.recordingGuide?.templateText}</div>
  {project.recordingGuide?.exampleUrl ? (
    <a href={project.recordingGuide.exampleUrl} target="_blank" rel="noreferrer">
      查看示例
    </a>
  ) : null}
</MCard>
<label>
  <input
    type="checkbox"
    aria-label="我已阅读并理解本次录屏要求"
    checked={form.selfCheck.readConfirmed}
    onChange={(event) => onSelfCheckChange("readConfirmed", event.target.checked)}
  />
  我已阅读并理解本次录屏要求
</label>
```

Add six numeric inputs with labels ending in `自评分`, capped by their weights. Add three key moment pairs with labels:

- `最佳表现片段开始时间`
- `最佳表现片段结束时间`
- `核心卖点展示片段开始时间`
- `核心卖点展示片段结束时间`
- `商业任务完成片段开始时间`
- `商业任务完成片段结束时间`

When submitting, build:

```jsx
selfCheck: {
  readConfirmed: form.selfCheck.readConfirmed,
  dimensionScores: form.selfCheck.dimensionScores,
  keyMoments: [
    { key: "best_performance", ...form.selfCheck.keyMoments.best_performance },
    { key: "selling_point", ...form.selfCheck.keyMoments.selling_point },
    { key: "commercial_task", ...form.selfCheck.keyMoments.commercial_task },
  ],
  note: form.selfCheck.note,
},
```

- [ ] **Step 4: Repeat the same behavior for desktop**

Add equivalent tests to `components/reference-ui/streamer-desktop-reference.test.jsx` and equivalent fields to `components/reference-ui/streamer-desktop-reference.jsx`. Use desktop layout density, but keep labels identical so tests and accessibility stay stable.

- [ ] **Step 5: Run streamer UI tests**

Run:

```bash
pnpm test components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx
```

Expected: pass.

- [ ] **Step 6: Commit Task 5**

```bash
git add components/reference-ui/streamer-mobile-reference.jsx components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.jsx components/reference-ui/streamer-desktop-reference.test.jsx
git commit -m "feat: add streamer recording task card self-check"
```

## Task 6: AI Pre-Review Uses Guide And Self-Check For Advisory Feedback

**Files:**
- Modify: `features/admission-review/pre-review.ts`
- Modify: `features/admission-review/pre-review.test.ts`
- Modify: `features/admission-review/pre-review-job.ts`
- Modify: `features/admission-review/pre-review-job.test.ts`

- [ ] **Step 1: Add failing pre-review prompt test**

In `features/admission-review/pre-review.test.ts`, add:

```ts
it("injects the project guide and streamer self-check into the pre-review prompt", async () => {
  const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const runGateway = ((request) => {
    requests.push(request.request);
    return Promise.resolve({
      status: "succeeded",
      providerName: "deepseek",
      fallbackUsed: false,
      structuredOutput: {
        decision: "manual_review",
        confidence: "medium",
        noteDraft: "只提供修改建议，等待人工复审。",
        checkpoints: [
          {
            key: "script_fit",
            verdict: "fail",
            confidence: 0.7,
            evidence: "没有讲活动入口",
            issue: "核心卖点未展示",
            howToImprove: "补充活动入口画面，并说明参与方式和用户收益。",
            rerecordSuggestion: "clip",
          },
        ],
      },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      latencyMs: 10,
      costCents: 1,
    });
  }) as typeof runAiGateway;

  await generateAdmissionPreReview({
    client: createEvaluationClient() as never,
    actor,
    submission,
    transcript,
    rubric: defaultAdmissionRubric(),
    projectGuide: {
      gameName: "星海",
      gameVersion: "1.2",
      serverRegion: "安卓一区",
      promotionGoal: "新版本拉新",
      targetAudience: "新手",
      requiredContent: ["活动入口"],
      requiredTalkingPoints: ["福利领取方式"],
      forbiddenContent: ["虚假保底"],
      commercialActions: ["展示预约福利入口"],
      technicalStandard: {},
      templateText: "开场说明本场目标。",
      exampleUrl: null,
    },
    selfCheck: {
      totalScore: 72,
      selfLevel: "L2",
      dimensionScores: {
        product_understanding: 15,
        expression_control: 14,
        content_structure: 12,
        interaction_design: 10,
        commercial_task: 12,
        technical_compliance: 9,
      },
      keyMoments: [
        { key: "best_performance", startSeconds: 10, endSeconds: 20 },
        { key: "selling_point", startSeconds: 30, endSeconds: 40 },
        { key: "commercial_task", startSeconds: 50, endSeconds: 60 },
      ],
      readConfirmed: true,
      note: null,
    },
    providers: llmProviders,
    runGateway,
    recordInvocation: collectInvocations([]),
  });

  const prompt = requests[0].messages.map((item) => item.content).join("\n");
  expect(prompt).toContain("新版本拉新");
  expect(prompt).toContain("活动入口");
  expect(prompt).toContain("主播自评总分: 72");
});
```

- [ ] **Step 2: Run the pre-review test and verify it fails**

Run:

```bash
pnpm test features/admission-review/pre-review.test.ts
```

Expected: fail because `projectGuide` and `selfCheck` are not accepted.

- [ ] **Step 3: Extend pre-review types and schema**

In `features/admission-review/pre-review.ts`, add optional inputs:

```ts
import type {
  NormalizedRecordingSelfCheck,
  RerecordSuggestion,
} from "@/features/recordings/recording-production-standard";
import type { RecordingProductionGuide } from "@/features/recordings/recording-production-guide";
```

Extend `generateAdmissionPreReview` params:

```ts
projectGuide?: RecordingProductionGuide | null;
selfCheck?: NormalizedRecordingSelfCheck | null;
```

Extend `preReviewSchema.checkpoints` item:

```ts
issue: z.string().trim().optional(),
howToImprove: z.string().trim().optional(),
rerecordSuggestion: z.enum(["none", "clip", "full"]).optional(),
```

When mapping checkpoint evidence:

```ts
evidence: {
  source: "asr_transcript",
  quote: item.evidence.trim(),
  structuredFeedback: {
    issue: item.issue?.trim() || null,
    howToImprove: item.howToImprove?.trim() || null,
    rerecordSuggestion: item.rerecordSuggestion ?? "none",
    advisoryOnly: true,
  },
},
```

- [ ] **Step 4: Add prompt sections**

In `buildSystemPrompt`, add:

```ts
"6. rerecordSuggestion 只能表达建议，不能表达最终审核结论。",
"7. 不得写“必须重录”；需要时写“建议补录指定片段”或“建议整段重录”。",
```

In `buildUserPrompt`, include guide/self-check:

```ts
projectGuide ? [
  "【项目任务卡】",
  `游戏: ${projectGuide.gameName || "未知"}`,
  `版本/区服: ${[projectGuide.gameVersion, projectGuide.serverRegion].filter(Boolean).join(" / ") || "未知"}`,
  `推广目标: ${projectGuide.promotionGoal || "未知"}`,
  `目标用户: ${projectGuide.targetAudience || "未知"}`,
  `必须展示: ${projectGuide.requiredContent.join("；") || "无"}`,
  `必须讲解: ${projectGuide.requiredTalkingPoints.join("；") || "无"}`,
  `商业动作: ${projectGuide.commercialActions.join("；") || "无"}`,
  `禁止内容: ${projectGuide.forbiddenContent.join("；") || "无"}`,
] : []
```

Add self-check lines:

```ts
selfCheck ? [
  "【主播自检】",
  `主播自评总分: ${selfCheck.totalScore}`,
  `主播自评等级: ${selfCheck.selfLevel}`,
  `关键时间点: ${selfCheck.keyMoments.map((item) => `${item.key}=${item.startSeconds}-${item.endSeconds}s`).join("；")}`,
] : []
```

- [ ] **Step 5: Load context in the pre-review job**

In `features/admission-review/pre-review-job.ts`, extend the submission select:

```ts
"id, organization_id, application_id, project_id, streamer_id, duration_seconds, submitted_at, self_check, key_moments, self_score_total, self_assessment_level, task_card_read_confirmed_at, submitter_note"
```

Add a lightweight helper in the same file:

```ts
function selfCheckFromSubmission(row: SubmissionRow): NormalizedRecordingSelfCheck | null {
  if (!row.task_card_read_confirmed_at || row.self_score_total === null || !row.self_assessment_level) {
    return null;
  }
  return {
    readConfirmed: true,
    dimensionScores: row.self_check as NormalizedRecordingSelfCheck["dimensionScores"],
    totalScore: row.self_score_total,
    selfLevel: row.self_assessment_level as NormalizedRecordingSelfCheck["selfLevel"],
    keyMoments: row.key_moments as NormalizedRecordingSelfCheck["keyMoments"],
    note: row.submitter_note ?? null,
  };
}
```

Load project guides in a project-id keyed map and pass `projectGuide` plus `selfCheck` into `generate`.

- [ ] **Step 6: Run AI pre-review tests**

Run:

```bash
pnpm test features/admission-review/pre-review.test.ts features/admission-review/pre-review-job.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit Task 6**

```bash
git add features/admission-review/pre-review.ts features/admission-review/pre-review.test.ts features/admission-review/pre-review-job.ts features/admission-review/pre-review-job.test.ts
git commit -m "feat: add recording guide context to admission pre-review"
```

## Task 7: Structured Feedback Surface For MCN Review And Streamer Return

**Files:**
- Modify: `features/admission-review/rejection-feedback.ts`
- Modify: `features/admission-review/rejection-feedback.test.ts`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.test.jsx`

- [ ] **Step 1: Write feedback service test**

In `features/admission-review/rejection-feedback.test.ts`, add:

```ts
it("returns advisory structured feedback without converting it into a decision", async () => {
  const feedback = await listLatestRejectionFeedback({
    client: mockClientWithCheckpointEvidence({
      structuredFeedback: {
        issue: "核心卖点没有出现在画面中",
        howToImprove: "补充活动入口画面，并说明参与方式和用户收益。",
        rerecordSuggestion: "clip",
        advisoryOnly: true,
      },
    }) as never,
    organizationId: "org-1",
    applicationIds: ["application-1"],
  });

  expect(feedback.get("application-1")?.reasons[0]).toMatchObject({
    issue: "核心卖点没有出现在画面中",
    howToImprove: "补充活动入口画面，并说明参与方式和用户收益。",
    rerecordSuggestion: "clip",
    advisoryOnly: true,
  });
});
```

- [ ] **Step 2: Extend rejection feedback DTO**

In `features/admission-review/rejection-feedback.ts`, extend `StructuredRejectionReason`:

```ts
issue: string | null;
howToImprove: string | null;
rerecordSuggestion: "none" | "clip" | "full";
advisoryOnly: true;
```

When mapping result evidence:

```ts
const structured = readStructuredFeedback(row.evidence);
return {
  key: row.checkpoint_key,
  label: checkpointLabel(rubric, row.checkpoint_key),
  note: row.note,
  issue: structured.issue,
  howToImprove: structured.howToImprove,
  rerecordSuggestion: structured.rerecordSuggestion,
  advisoryOnly: true,
};
```

Add helper:

```ts
function readStructuredFeedback(evidence: unknown) {
  const value =
    evidence && typeof evidence === "object"
      ? (evidence as { structuredFeedback?: unknown }).structuredFeedback
      : null;
  if (!value || typeof value !== "object") {
    return { issue: null, howToImprove: null, rerecordSuggestion: "none" as const };
  }
  const record = value as Record<string, unknown>;
  const rerecordSuggestion =
    record.rerecordSuggestion === "clip" || record.rerecordSuggestion === "full"
      ? record.rerecordSuggestion
      : "none";
  return {
    issue: typeof record.issue === "string" ? record.issue.trim() || null : null,
    howToImprove:
      typeof record.howToImprove === "string"
        ? record.howToImprove.trim() || null
        : null,
    rerecordSuggestion,
  };
}
```

- [ ] **Step 3: Replace prompt-only MCN feedback with visible structured feedback fields**

In `components/reference-ui/ops-reference.jsx`, keep existing review action buttons, but when reviewing `rejected` or `needs_changes`, collect:

- reason code
- issue
- how to improve
- rerecord suggestion

Payload example:

```js
checkpointResults: [
  {
    checkpointKey: "script_fit",
    verdict: "fail",
    note: "核心卖点没有出现在画面中；建议补录活动入口片段。",
    evidence: {
      structuredFeedback: {
        issue: "核心卖点没有出现在画面中",
        howToImprove: "补充活动入口画面，并说明参与方式和用户收益。",
        rerecordSuggestion: "clip",
        advisoryOnly: true,
      },
    },
  },
],
```

If the existing route does not accept `evidence` for human review yet, extend `app/api/applications/[applicationId]/review/route.ts` and `RecordAdmissionEvaluationInput` to pass optional `evidence` through for human checkpoint results. Add a tight route test proving arbitrary evidence is stored only as checkpoint evidence.

- [ ] **Step 4: Show streamer-facing feedback in one block**

In mobile and desktop project detail feedback blocks, render:

```jsx
{project.rejectionReasons?.map((reason) => (
  <div key={reason.key}>
    <strong>{reason.label}</strong>
    {reason.issue ? <p>哪里不合格：{reason.issue}</p> : null}
    {reason.howToImprove ? <p>怎么改：{reason.howToImprove}</p> : null}
    {reason.rerecordSuggestion === "clip" ? <p>建议：补录指定片段</p> : null}
    {reason.rerecordSuggestion === "full" ? <p>建议：整段重录</p> : null}
  </div>
))}
```

Do not show "系统判定", "必须重录", "自动驳回", or "自动通过".

- [ ] **Step 5: Add UI tests for advisory wording**

In mobile and desktop tests, assert:

```ts
expect(screen.getByText(/哪里不合格/)).toBeInTheDocument();
expect(screen.getByText(/怎么改/)).toBeInTheDocument();
expect(screen.getByText(/建议/)).toBeInTheDocument();
expect(screen.queryByText(/必须重录/)).not.toBeInTheDocument();
expect(screen.queryByText(/系统判定/)).not.toBeInTheDocument();
```

In ops tests, assert the review payload contains `structuredFeedback.advisoryOnly: true` and still calls the human review route, not a new auto-decision route.

- [ ] **Step 6: Run feedback tests**

Run:

```bash
pnpm test features/admission-review/rejection-feedback.test.ts components/reference-ui/ops-reference.test.jsx components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx
```

Expected: pass.

- [ ] **Step 7: Commit Task 7**

```bash
git add features/admission-review/rejection-feedback.ts features/admission-review/rejection-feedback.test.ts components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx components/reference-ui/streamer-mobile-reference.jsx components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.jsx components/reference-ui/streamer-desktop-reference.test.jsx
git commit -m "feat: surface advisory recording feedback"
```

## Task 8: Technical Check Visibility And Final Verification

**Files:**
- Modify: `app/api/recording-assets/[assetId]/ai-analysis/route.test.ts`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.test.jsx`

- [ ] **Step 1: Pin technical-check copy**

Add tests that current deterministic checks are described as technical checks, not admission decisions:

```ts
expect(screen.getByText(/技术自动检查/)).toBeInTheDocument();
expect(screen.getByText(/文件大小/)).toBeInTheDocument();
expect(screen.getByText(/音轨|时长|画面/)).toBeInTheDocument();
expect(screen.queryByText(/技术检查通过即入项/)).not.toBeInTheDocument();
```

For `/api/recording-assets/[assetId]/ai-analysis`, keep existing `429` quota and oversized-file tests. Add an assertion that the response error message says parsing cannot start, not that the recording is rejected.

- [ ] **Step 2: Run all focused suites**

Run:

```bash
pnpm test features/recordings/recording-production-standard.test.ts features/recordings/recording-production-guide.test.ts features/recordings/project-announcements.test.ts features/recordings/project-recording-delivery.test.ts app/api/streamer/recordings/route.test.ts features/admission-review/pre-review.test.ts features/admission-review/pre-review-job.test.ts features/admission-review/rejection-feedback.test.ts components/reference-ui/ops-reference.test.jsx components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx lib/db/recording-production-feedback-schema-contract.test.ts app/api/recording-assets/[assetId]/ai-analysis/route.test.ts
```

Expected: pass.

- [ ] **Step 3: Run repo quality gates**

Run:

```bash
git diff --check
pnpm type-check
pnpm lint
```

Expected:

- `git diff --check`: no whitespace errors.
- `pnpm type-check`: pass.
- `pnpm lint`: pass, allowing the repo's existing large-file Babel deopt warning if it appears.

- [ ] **Step 4: Run build if focused gates pass**

Run:

```bash
pnpm build
```

Expected: pass. If build fails because of unrelated dirty-worktree changes, capture the exact failing files and rerun the focused suites above to keep this slice verified.

- [ ] **Step 5: Commit Task 8**

```bash
git add app/api/recording-assets/[assetId]/ai-analysis/route.test.ts components/reference-ui/ops-reference.test.jsx components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx
git commit -m "test: verify recording feedback decision boundaries"
```

## Self-Review

Spec coverage:

- Project task card: Task 2 schema, Task 3 DTO, Task 5 UI.
- Streamer read confirmation: Task 1 contract, Task 4 persistence, Task 5 UI.
- Recording template/example: Task 2 schema, Task 3 DTO, Task 5 UI.
- Six-dimension self-score: Task 1 contract, Task 4 persistence, Task 5 UI.
- Key moments: Task 1 contract, Task 4 persistence, Task 5 UI, Task 6 AI prompt context.
- Technical automatic checks: Task 8 verifies copy and existing AI-analysis gates.
- AI pre-review checkpoints: Task 6 prompt/evidence integration.
- MCN human review: Task 7 preserves human review route and adds structured feedback evidence.
- Vendor review: Existing vendor review flow remains unchanged; Task 7 feeds the same structured feedback return channel.
- Structured feedback/rework/admission: Task 7 returns advisory issue/how-to-improve/rerecord suggestion; admission state still uses existing human decisions only.

Placeholder scan:

- The plan contains no open implementation placeholders.
- Any optional behavior is explicitly scoped as not part of this first slice.

Type consistency:

- `RecordingProductionDimensionKey`, `RecordingSelfCheckInput`, `NormalizedRecordingSelfCheck`, and `RerecordSuggestion` are defined in Task 1 and reused by later tasks.
- Database fields use snake_case; service/DTO fields use camelCase.
- `rerecordSuggestion` is advisory evidence, not a status enum.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-20-recording-production-feedback-loop.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
