# Public Project Recording Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the organization-scoped public project announcement and recording delivery loop so ops can expose projects to current-org streamers, streamers can see summary/download links, submit recordings, and see review status from the existing recording review queue.

**Architecture:** Add public announcement fields to `projects`, expose them through the existing project service/DTO path for ops, and add a streamer-safe announcement query that returns only current-organization public projects. Recording delivery with `projectId` is handled by a small orchestration service that creates or reuses `project_applications`, then calls the existing `submitRecording` workflow so `recording_submissions`, ops review, notifications, audits, and streamer status stay on one state machine.

**Tech Stack:** Next.js App Router, React 19 reference UI, TypeScript, Supabase, Vitest, Testing Library.

---

## Scope Check

The design touches database schema, project management, streamer announcement query, recording delivery, and two reference UIs. These pieces are one business loop, so keep them in one implementation plan and ship through small commits after each task.

Current worktree warning: several implementation and test files are already dirty. Before editing a file, read the current version with `Get-Content -LiteralPath` and apply the smallest patch. Stage only files listed in the current task.

## File Structure

- Modify `supabase/migrations/20260601161000_initial_foundation.sql` only through schema contract expectations, not by editing the original migration.
- Create `supabase/migrations/20260606103000_project_public_streamer_fields.sql`: add project public fields, URL constraint, and public-project lookup index.
- Modify `lib/db/schema-contract.test.ts`: assert the migration includes the new columns and constraint.
- Modify `features/projects/project-service.ts`: extend project input/record types and validate `gameDownloadUrl`.
- Modify `features/projects/project-repository.ts`: select and map the new project columns.
- Modify `features/projects/project-queries.ts`: expose new fields to ops list queries.
- Modify `features/projects/project-ui-dto.ts`: include public announcement fields in ops project cards.
- Modify `app/api/projects/[projectId]/route.ts`: accept the new project settings payload.
- Modify `app/api/projects/projects-route.test.ts`, `features/projects/project-service.test.ts`, and `features/projects/project-ui-dto.test.ts`: cover project public settings.
- Create `features/recordings/project-announcements.ts`: streamer-safe query and DTO mapping for public project announcements.
- Create `features/recordings/project-announcements.test.ts`: mapper/status coverage and no sensitive field leakage.
- Create `app/api/streamer/project-announcements/route.ts`: streamer-only announcement endpoint.
- Create `app/api/streamer/project-announcements/route.test.ts`: route authorization and current-streamer resolution.
- Create `features/recordings/project-recording-delivery.ts`: orchestration for `projectId` recording submissions.
- Create `features/recordings/project-recording-delivery.test.ts`: service tests for auto application, existing application, and invalid public project rejection.
- Modify `features/applications/application-repository.ts`: add concrete Supabase methods used by project recording delivery.
- Modify `app/api/streamer/recordings/route.ts`: branch POST by `projectId`, preserving old personal recording behavior.
- Modify `app/api/streamer/recordings/route.test.ts`: cover both old and project-linked POST behavior.
- Modify `app/(streamer-app)/m/recordings/page.tsx`: load announcement cards server-side.
- Modify `components/reference-ui/streamer-mobile-reference.jsx`: show project announcements and submit project recordings from the existing videos route.
- Modify `components/reference-ui/streamer-mobile-reference.test.jsx`: smoke test announcement display, download link, project recording POST, and visible review status.
- Modify `components/reference-ui/ops-reference.jsx`: add public settings fields and overview badges.
- Modify `components/reference-ui/ops-reference.test.jsx`: smoke test ops can edit public settings.

---

### Task 1: Database Public Project Fields

**Files:**
- Create: `supabase/migrations/20260606103000_project_public_streamer_fields.sql`
- Modify: `lib/db/schema-contract.test.ts`
- Test: `lib/db/schema-contract.test.ts`

- [ ] **Step 1: Write the failing schema contract test**

Add these assertions to the project schema contract test block in `lib/db/schema-contract.test.ts`:

```ts
expect(allMigrations).toContain(
  "is_public_to_streamers boolean not null default false",
);
expect(allMigrations).toContain("public_summary text not null default ''");
expect(allMigrations).toContain("game_download_url text");
expect(allMigrations).toContain("projects_game_download_url_http");
expect(allMigrations).toContain("projects_org_public_streamer_idx");
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm test lib/db/schema-contract.test.ts
```

Expected: FAIL because the new migration and strings do not exist.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/20260606103000_project_public_streamer_fields.sql`:

```sql
alter table public.projects
  add column is_public_to_streamers boolean not null default false,
  add column public_summary text not null default '',
  add column game_download_url text;

alter table public.projects
  add constraint projects_game_download_url_http check (
    game_download_url is null
    or game_download_url ~* '^https?://'
  );

create index projects_org_public_streamer_idx
on public.projects (organization_id, status, created_at desc)
where is_public_to_streamers = true;
```

- [ ] **Step 4: Run the schema test again**

Run:

```bash
pnpm test lib/db/schema-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Stage only the schema files:

```bash
git add lib/db/schema-contract.test.ts supabase/migrations/20260606103000_project_public_streamer_fields.sql
git commit -m "feat: add public project announcement fields"
```

---

### Task 2: Project Settings Service, Repository, API, And Ops DTO

**Files:**
- Modify: `features/projects/project-service.test.ts`
- Modify: `features/projects/project-service.ts`
- Modify: `features/projects/project-repository.ts`
- Modify: `features/projects/project-queries.ts`
- Modify: `features/projects/project-ui-dto.test.ts`
- Modify: `features/projects/project-ui-dto.ts`
- Modify: `app/api/projects/projects-route.test.ts`
- Modify: `app/api/projects/[projectId]/route.ts`
- Test: project service, DTO, and API route tests

- [ ] **Step 1: Write failing project service tests**

Append these cases inside `describe("project service", ...)` in `features/projects/project-service.test.ts`:

```ts
it("updates public streamer announcement fields with normal audit", async () => {
  const before = {
    id: "99999999-9999-9999-9999-999999999999",
    name: "Project",
    code: "PUB",
    status: "recruiting" as const,
  };
  const after = {
    ...before,
    is_public_to_streamers: true,
    public_summary: "Streamer-facing brief",
    game_download_url: "https://download.example.com/game",
  };
  const repo = {
    createDraft: vi.fn(),
    getById: vi.fn().mockResolvedValue(before),
    publish: vi.fn(),
    updateBasics: vi.fn().mockResolvedValue(after),
    updateSettlementRule: vi.fn(),
  };
  const audit = vi.fn().mockResolvedValue(undefined);

  await updateProjectBasics({
    repo,
    audit,
    actor,
    projectId: before.id,
    input: {
      isPublicToStreamers: true,
      publicSummary: "Streamer-facing brief",
      gameDownloadUrl: "https://download.example.com/game",
    },
  });

  expect(repo.updateBasics).toHaveBeenCalledWith(before.id, {
    is_public_to_streamers: true,
    public_summary: "Streamer-facing brief",
    game_download_url: "https://download.example.com/game",
  });
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "update",
      changedFields: [
        "is_public_to_streamers",
        "public_summary",
        "game_download_url",
      ],
      isHighRisk: false,
    }),
  );
});

it("rejects non-http game download URLs", async () => {
  const before = {
    id: "99999999-9999-9999-9999-999999999999",
    name: "Project",
    code: "PUB",
    status: "recruiting" as const,
  };
  const repo = {
    createDraft: vi.fn(),
    getById: vi.fn().mockResolvedValue(before),
    publish: vi.fn(),
    updateBasics: vi.fn(),
    updateSettlementRule: vi.fn(),
  };
  const audit = vi.fn().mockResolvedValue(undefined);

  await expect(
    updateProjectBasics({
      repo,
      audit,
      actor,
      projectId: before.id,
      input: { gameDownloadUrl: "ftp://download.example.com/game" },
    }),
  ).rejects.toThrow("Game download URL must be an http(s) URL");
  expect(repo.updateBasics).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing DTO and route tests**

In `features/projects/project-ui-dto.test.ts`, add these fields to the input row:

```ts
is_public_to_streamers: true,
public_summary: "Streamer card summary",
game_download_url: "https://download.example.com/game",
```

Add these expected fields to the `toMatchObject` assertion:

```ts
isPublicToStreamers: true,
publicSummary: "Streamer card summary",
gameDownloadUrl: "https://download.example.com/game",
```

In `app/api/projects/projects-route.test.ts`, add these request fields to the PATCH body:

```ts
isPublicToStreamers: true,
publicSummary: "Streamer card summary",
gameDownloadUrl: "https://download.example.com/game",
```

Add these expected service input fields:

```ts
isPublicToStreamers: true,
publicSummary: "Streamer card summary",
gameDownloadUrl: "https://download.example.com/game",
```

- [ ] **Step 3: Run the failing project tests**

Run:

```bash
pnpm test features/projects/project-service.test.ts features/projects/project-ui-dto.test.ts app/api/projects/projects-route.test.ts
```

Expected: FAIL because types, DTO fields, and PATCH parsing are not wired.

- [ ] **Step 4: Extend project service types and validation**

In `features/projects/project-service.ts`, add these fields to `ProjectRecord`:

```ts
is_public_to_streamers?: boolean;
public_summary?: string | null;
game_download_url?: string | null;
```

Add these fields to `UpdateProjectBasicsInput`:

```ts
isPublicToStreamers?: boolean;
publicSummary?: string;
gameDownloadUrl?: string | null;
```

Update `mapBasicProjectPatch`:

```ts
function mapBasicProjectPatch(
  input: UpdateProjectBasicsInput,
): Partial<ProjectRecord> {
  return removeUndefined({
    name: input.name,
    status: input.status,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    open_signup: input.openSignup,
    allow_direct_invite: input.allowDirectInvite,
    force_recording: input.forceRecording,
    force_system_timing: input.forceSystemTiming,
    vendor_name: input.vendorName,
    product_name: input.productName,
    agent_name: input.agentName,
    supplier_name: input.supplierName,
    description: input.description,
    owner_id: input.ownerId,
    is_public_to_streamers: input.isPublicToStreamers,
    public_summary: input.publicSummary,
    game_download_url: normalizeOptionalHttpUrl(input.gameDownloadUrl),
  });
}
```

Add this helper near `removeUndefined`:

```ts
function normalizeOptionalHttpUrl(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Game download URL must be an http(s) URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Game download URL must be an http(s) URL");
  }

  return trimmed;
}
```

- [ ] **Step 5: Extend the project repository and query DTO source**

In `features/projects/project-repository.ts`, add these fields to `ProjectRow`, `projectSelect`, and `toProjectRecord`:

```ts
is_public_to_streamers: boolean;
public_summary: string;
game_download_url: string | null;
```

```ts
is_public_to_streamers,
public_summary,
game_download_url,
```

```ts
is_public_to_streamers: row.is_public_to_streamers,
public_summary: row.public_summary,
game_download_url: row.game_download_url,
```

In `features/projects/project-queries.ts`, add these fields to `ProjectListItem`:

```ts
is_public_to_streamers: boolean;
public_summary: string;
game_download_url: string | null;
```

Add them to the `.select(...)` string:

```ts
is_public_to_streamers, public_summary, game_download_url
```

- [ ] **Step 6: Extend the ops project card DTO**

In `features/projects/project-ui-dto.ts`, add to `ProjectCardDto`:

```ts
isPublicToStreamers: boolean;
publicSummary: string;
gameDownloadUrl: string | null;
```

Add to `toProjectCardDto`:

```ts
isPublicToStreamers: row.is_public_to_streamers,
publicSummary: row.public_summary?.trim() || "",
gameDownloadUrl: row.game_download_url?.trim() || null,
```

- [ ] **Step 7: Extend the project PATCH route**

In `app/api/projects/[projectId]/route.ts`, add these fields to the request body type:

```ts
isPublicToStreamers?: boolean;
publicSummary?: string | null;
gameDownloadUrl?: string | null;
```

Pass them into `updateProjectBasics`:

```ts
isPublicToStreamers: body.isPublicToStreamers,
publicSummary: normalizeProjectText(body.publicSummary),
gameDownloadUrl: normalizeNullableProjectText(body.gameDownloadUrl),
```

Add this helper below `normalizeProjectText`:

```ts
function normalizeNullableProjectText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return value === null ? null : undefined;
  }
  return value.trim() || null;
}
```

- [ ] **Step 8: Run the project tests**

Run:

```bash
pnpm test features/projects/project-service.test.ts features/projects/project-ui-dto.test.ts app/api/projects/projects-route.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

Stage only the files from this task:

```bash
git add features/projects/project-service.test.ts features/projects/project-service.ts features/projects/project-repository.ts features/projects/project-queries.ts features/projects/project-ui-dto.test.ts features/projects/project-ui-dto.ts app/api/projects/projects-route.test.ts app/api/projects/[projectId]/route.ts
git commit -m "feat: expose public project settings"
```

---

### Task 3: Streamer Public Project Announcements API

**Files:**
- Create: `features/recordings/project-announcements.test.ts`
- Create: `features/recordings/project-announcements.ts`
- Create: `app/api/streamer/project-announcements/route.test.ts`
- Create: `app/api/streamer/project-announcements/route.ts`
- Test: announcement feature and route tests

- [ ] **Step 1: Write the failing announcement mapper test**

Create `features/recordings/project-announcements.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  isProjectAnnouncementVisibleStatus,
  toStreamerProjectAnnouncementCard,
} from "./project-announcements";

describe("streamer project announcements", () => {
  it("maps public project rows with current streamer review state", () => {
    const dto = toStreamerProjectAnnouncementCard(
      {
        id: "project-1",
        code: "PUB-1",
        name: "Public Project",
        status: "recruiting",
        vendor_name: "Vendor A",
        product_name: "Game A",
        description: "Ops internal description",
        open_signup: true,
        force_recording: true,
        public_summary: "Streamer-facing summary",
        game_download_url: "https://download.example.com/game-a",
        published_at: "2026-06-01T00:00:00.000Z",
        created_at: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "application-1",
        project_id: "project-1",
        status: "recording_reviewing",
        decision_reason: null,
        submitted_at: "2026-06-02T00:00:00.000Z",
      },
      {
        id: "recording-1",
        application_id: "application-1",
        version: 2,
        status: "submitted",
        duration_seconds: null,
        created_at: "2026-06-02T01:00:00.000Z",
      },
    );

    expect(dto).toEqual({
      id: "project-1",
      code: "PUB-1",
      name: "Public Project",
      status: "recruiting",
      vendor: "Vendor A",
      product: "Game A",
      description: "Ops internal description",
      publicSummary: "Streamer-facing summary",
      gameDownloadUrl: "https://download.example.com/game-a",
      openSignup: true,
      forceRecording: true,
      applicationId: "application-1",
      applicationStatus: "recording_reviewing",
      latestRecordingStatus: "submitted",
      latestRecordingVersion: 2,
      decisionReason: null,
      reviewStatusLabel: "审核中",
      canSubmitRecording: false,
    });
    expect(JSON.stringify(dto)).not.toContain("hourly");
    expect(JSON.stringify(dto)).not.toContain("settlement");
  });

  it("excludes draft and finished project statuses from streamer announcements", () => {
    expect(isProjectAnnouncementVisibleStatus("draft")).toBe(false);
    expect(isProjectAnnouncementVisibleStatus("ended")).toBe(false);
    expect(isProjectAnnouncementVisibleStatus("closed")).toBe(false);
    expect(isProjectAnnouncementVisibleStatus("recruiting")).toBe(true);
    expect(isProjectAnnouncementVisibleStatus("active")).toBe(true);
  });
});
```

- [ ] **Step 2: Implement the announcement query and DTO**

Create `features/recordings/project-announcements.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ApplicationStatus,
  RecordingReviewStatus,
} from "@/features/applications/application-state";

export type StreamerProjectAnnouncementProjectRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  vendor_name: string | null;
  product_name: string | null;
  description: string | null;
  open_signup: boolean;
  force_recording: boolean;
  public_summary: string;
  game_download_url: string | null;
  published_at: string | null;
  created_at: string;
};

export type StreamerProjectAnnouncementApplicationRow = {
  id: string;
  project_id: string;
  status: ApplicationStatus;
  decision_reason: string | null;
  submitted_at: string;
};

export type StreamerProjectAnnouncementRecordingRow = {
  id: string;
  application_id: string;
  version: number;
  status: RecordingReviewStatus;
  duration_seconds: number | null;
  created_at: string;
};

export type StreamerProjectAnnouncementCard = {
  id: string;
  code: string;
  name: string;
  status: string;
  vendor: string;
  product: string;
  description: string;
  publicSummary: string;
  gameDownloadUrl: string | null;
  openSignup: boolean;
  forceRecording: boolean;
  applicationId: string | null;
  applicationStatus: ApplicationStatus | null;
  latestRecordingStatus: RecordingReviewStatus | null;
  latestRecordingVersion: number | null;
  decisionReason: string | null;
  reviewStatusLabel: string;
  canSubmitRecording: boolean;
};

const finishedProjectStatuses = new Set(["draft", "ended", "closed"]);
const recordingSubmittableApplicationStatuses = new Set<ApplicationStatus>([
  "submitted",
  "invited",
  "recording_required",
  "recording_rejected",
]);

export async function listStreamerProjectAnnouncements(
  supabase: SupabaseClient | null,
  input: { organizationId: string; streamerId: string },
): Promise<StreamerProjectAnnouncementCard[]> {
  if (!supabase) {
    return [];
  }

  const { data: projectRows, error: projectError } = await supabase
    .from("projects")
    .select(
      "id, code, name, status, vendor_name, product_name, description, open_signup, force_recording, public_summary, game_download_url, published_at, created_at",
    )
    .eq("organization_id", input.organizationId)
    .eq("is_public_to_streamers", true)
    .not("status", "in", "(draft,ended,closed)")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (projectError) {
    throw projectError;
  }

  const projects = (projectRows ?? []) as StreamerProjectAnnouncementProjectRow[];
  const projectIds = projects.map((project) => project.id);
  const applications = await listApplicationsForProjects(supabase, {
    organizationId: input.organizationId,
    streamerId: input.streamerId,
    projectIds,
  });
  const latestRecordings = await listLatestRecordingsForApplications(
    supabase,
    applications.map((application) => application.id),
  );

  const applicationByProject = new Map(
    applications.map((application) => [application.project_id, application]),
  );

  return projects.map((project) => {
    const application = applicationByProject.get(project.id) ?? null;
    const recording = application
      ? latestRecordings.get(application.id) ?? null
      : null;
    return toStreamerProjectAnnouncementCard(project, application, recording);
  });
}

export function toStreamerProjectAnnouncementCard(
  project: StreamerProjectAnnouncementProjectRow,
  application: StreamerProjectAnnouncementApplicationRow | null,
  latestRecording: StreamerProjectAnnouncementRecordingRow | null,
): StreamerProjectAnnouncementCard {
  const applicationStatus = application?.status ?? null;
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
    vendor: project.vendor_name?.trim() || "",
    product: project.product_name?.trim() || project.name,
    description: project.description?.trim() || "",
    publicSummary: project.public_summary?.trim() || "",
    gameDownloadUrl: project.game_download_url?.trim() || null,
    openSignup: project.open_signup,
    forceRecording: project.force_recording,
    applicationId: application?.id ?? null,
    applicationStatus,
    latestRecordingStatus: latestRecording?.status ?? null,
    latestRecordingVersion: latestRecording?.version ?? null,
    decisionReason: application?.decision_reason ?? null,
    reviewStatusLabel: reviewStatusLabel(applicationStatus, latestRecording),
    canSubmitRecording:
      !applicationStatus ||
      recordingSubmittableApplicationStatuses.has(applicationStatus),
  };
}

export function isProjectAnnouncementVisibleStatus(status: string): boolean {
  return !finishedProjectStatuses.has(status);
}

async function listApplicationsForProjects(
  supabase: SupabaseClient,
  input: { organizationId: string; streamerId: string; projectIds: string[] },
): Promise<StreamerProjectAnnouncementApplicationRow[]> {
  if (input.projectIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("project_applications")
    .select("id, project_id, status, decision_reason, submitted_at")
    .eq("organization_id", input.organizationId)
    .eq("streamer_id", input.streamerId)
    .in("project_id", input.projectIds)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw error;
  }

  const latestByProject = new Map<
    string,
    StreamerProjectAnnouncementApplicationRow
  >();
  for (const application of
    (data ?? []) as StreamerProjectAnnouncementApplicationRow[]) {
    if (!latestByProject.has(application.project_id)) {
      latestByProject.set(application.project_id, application);
    }
  }

  return Array.from(latestByProject.values());
}

async function listLatestRecordingsForApplications(
  supabase: SupabaseClient,
  applicationIds: string[],
): Promise<Map<string, StreamerProjectAnnouncementRecordingRow>> {
  if (applicationIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("recording_submissions")
    .select("id, application_id, version, status, duration_seconds, created_at")
    .in("application_id", applicationIds)
    .order("version", { ascending: false });

  if (error) {
    throw error;
  }

  const latestByApplication = new Map<
    string,
    StreamerProjectAnnouncementRecordingRow
  >();
  for (const recording of
    (data ?? []) as StreamerProjectAnnouncementRecordingRow[]) {
    if (!latestByApplication.has(recording.application_id)) {
      latestByApplication.set(recording.application_id, recording);
    }
  }

  return latestByApplication;
}

function reviewStatusLabel(
  applicationStatus: ApplicationStatus | null,
  latestRecording: StreamerProjectAnnouncementRecordingRow | null,
) {
  if (!applicationStatus) return "待投递";
  if (applicationStatus === "recording_reviewing") return "审核中";
  if (applicationStatus === "recording_required") return "需修改";
  if (applicationStatus === "recording_rejected") return "未通过";
  if (applicationStatus === "recording_approved") return "已通过，待确认加入";
  if (applicationStatus === "joined") return "已加入项目";
  if (latestRecording?.status === "needs_changes") return "需修改";
  if (latestRecording?.status === "rejected") return "未通过";
  if (latestRecording?.status === "approved") return "已通过，待确认加入";
  return "待投递";
}
```

- [ ] **Step 3: Write the failing API route test**

Create `app/api/streamer/project-announcements/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import { getLiveOperationsRouteContext } from "@/features/live-operations/live-operations-route-utils";
import { listStreamerProjectAnnouncements } from "@/features/recordings/project-announcements";

vi.mock("@/features/live-operations/live-operations-repository", () => ({
  getStreamerIdForUser: vi.fn(),
}));

vi.mock("@/features/live-operations/live-operations-route-utils", () => {
  class RouteError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  }

  return {
    getLiveOperationsRouteContext: vi.fn(),
    RouteError,
    jsonError: (error: unknown) => {
      const status =
        error instanceof RouteError
          ? error.statusCode
          : error instanceof Error
            ? 400
            : 500;
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      return Response.json({ error: message }, { status });
    },
  };
});

vi.mock("@/features/recordings/project-announcements", () => ({
  listStreamerProjectAnnouncements: vi.fn(),
}));

const context = {
  supabase: { client: "supabase" },
  auth: {
    userId: "user-streamer",
    email: "streamer@example.com",
    name: "Streamer",
    organizationId: "org-1",
    organizationName: "Org One",
    role: "streamer" as const,
  },
};

describe("streamer project announcements route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue(
      context as never,
    );
    vi.mocked(getStreamerIdForUser).mockResolvedValue("streamer-1");
    vi.mocked(listStreamerProjectAnnouncements).mockResolvedValue([
      {
        id: "project-1",
        code: "PUB-1",
        name: "Public Project",
        status: "recruiting",
        vendor: "Vendor A",
        product: "Game A",
        description: "",
        publicSummary: "Streamer-facing summary",
        gameDownloadUrl: "https://download.example.com/game-a",
        openSignup: true,
        forceRecording: true,
        applicationId: null,
        applicationStatus: null,
        latestRecordingStatus: null,
        latestRecordingVersion: null,
        decisionReason: null,
        reviewStatusLabel: "待投递",
        canSubmitRecording: true,
      },
    ]);
  });

  it("returns current organization public project announcements for the streamer", async () => {
    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      announcements: [
        expect.objectContaining({
          id: "project-1",
          publicSummary: "Streamer-facing summary",
        }),
      ],
    });
    expect(listStreamerProjectAnnouncements).toHaveBeenCalledWith(
      context.supabase,
      {
        organizationId: "org-1",
        streamerId: "streamer-1",
      },
    );
  });

  it("rejects non-streamer users", async () => {
    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue({
      ...context,
      auth: { ...context.auth, role: "ops_manager" },
    } as never);

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(403);
    expect(listStreamerProjectAnnouncements).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Implement the API route**

Create `app/api/streamer/project-announcements/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import {
  getLiveOperationsRouteContext,
  jsonError,
  RouteError,
} from "@/features/live-operations/live-operations-route-utils";
import { listStreamerProjectAnnouncements } from "@/features/recordings/project-announcements";

export async function GET() {
  try {
    const context = await getLiveOperationsRouteContext();
    if (context.auth.role !== "streamer") {
      throw new RouteError("Only streamers can access project announcements", 403);
    }

    const streamerId = await getStreamerIdForUser(
      context.supabase,
      context.auth.userId,
    );
    if (!streamerId) {
      throw new RouteError("Current user is not bound to a streamer", 400);
    }

    const announcements = await listStreamerProjectAnnouncements(
      context.supabase,
      {
        organizationId: context.auth.organizationId,
        streamerId,
      },
    );

    return NextResponse.json({ announcements });
  } catch (error) {
    return jsonError(error);
  }
}
```

- [ ] **Step 5: Run announcement tests**

Run:

```bash
pnpm test features/recordings/project-announcements.test.ts app/api/streamer/project-announcements/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/recordings/project-announcements.test.ts features/recordings/project-announcements.ts app/api/streamer/project-announcements/route.test.ts app/api/streamer/project-announcements/route.ts
git commit -m "feat: add streamer project announcements"
```

---

### Task 4: Project Recording Delivery Orchestration

**Files:**
- Create: `features/recordings/project-recording-delivery.test.ts`
- Create: `features/recordings/project-recording-delivery.ts`
- Modify: `features/applications/application-repository.ts`
- Test: project recording delivery service

- [ ] **Step 1: Write the failing service tests**

Create `features/recordings/project-recording-delivery.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { submitProjectRecording } from "./project-recording-delivery";

const actor = {
  userId: "user-streamer",
  name: "Streamer",
  role: "streamer" as const,
  organizationId: "org-1",
};

function baseRepo() {
  return {
    getPublicProjectForRecording: vi.fn().mockResolvedValue({
      id: "project-1",
      name: "Public Project",
      organizationId: "org-1",
      status: "recruiting",
      isPublicToStreamers: true,
    }),
    getStreamerForAdmission: vi.fn().mockResolvedValue({
      id: "streamer-1",
      displayName: "Streamer One",
      userId: "user-streamer",
      riskLevel: "low",
    }),
    getApplicationByProjectAndStreamer: vi.fn().mockResolvedValue(null),
    createApplication: vi.fn().mockResolvedValue({
      id: "application-1",
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "submitted",
      decisionReason: null,
    }),
    getApplicationById: vi.fn().mockResolvedValue({
      id: "application-1",
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "submitted",
      decisionReason: null,
    }),
    getProjectAdmissionConfig: vi.fn(),
    getLatestRecordingSubmission: vi.fn().mockResolvedValue(null),
    createRecordingSubmission: vi.fn().mockResolvedValue({
      id: "recording-1",
      applicationId: "application-1",
      version: 1,
      status: "submitted",
    }),
    updateApplicationStatus: vi.fn().mockResolvedValue({
      id: "application-1",
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "recording_reviewing",
      decisionReason: null,
    }),
    updateRecordingReview: vi.fn(),
    createProjectStreamer: vi.fn(),
  };
}

describe("submitProjectRecording", () => {
  it("creates a signup application and submits a recording to review", async () => {
    const repo = baseRepo();
    const audit = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);

    const result = await submitProjectRecording({
      repo,
      audit,
      notify,
      actor,
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        link: "https://videos.example.com/public-project",
      },
    });

    expect(repo.createApplication).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "submitted",
    });
    expect(repo.createRecordingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        applicationId: "application-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        version: 1,
        externalUrl: "https://videos.example.com/public-project",
      }),
    );
    expect(repo.updateApplicationStatus).toHaveBeenCalledWith("application-1", {
      status: "recording_reviewing",
    });
    expect(result).toEqual({
      applicationId: "application-1",
      projectId: "project-1",
      recording: {
        id: "recording-1",
        applicationId: "application-1",
        version: 1,
        status: "submitted",
      },
      reviewStatusLabel: "审核中",
    });
  });

  it("uses an existing submittable application and increments recording version", async () => {
    const repo = baseRepo();
    repo.getApplicationByProjectAndStreamer.mockResolvedValue({
      id: "application-existing",
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "recording_rejected",
      decisionReason: "Please resubmit",
    });
    repo.getApplicationById.mockResolvedValue({
      id: "application-existing",
      organizationId: "org-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      source: "signup",
      status: "recording_rejected",
      decisionReason: "Please resubmit",
    });
    repo.getLatestRecordingSubmission.mockResolvedValue({
      id: "recording-old",
      applicationId: "application-existing",
      version: 2,
      status: "rejected",
    });
    repo.createRecordingSubmission.mockResolvedValue({
      id: "recording-3",
      applicationId: "application-existing",
      version: 3,
      status: "submitted",
    });

    await submitProjectRecording({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor,
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        link: "https://videos.example.com/resubmit",
      },
    });

    expect(repo.createApplication).not.toHaveBeenCalled();
    expect(repo.createRecordingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "application-existing",
        version: 3,
      }),
    );
  });

  it("rejects projects outside the actor organization or hidden from streamers", async () => {
    const repo = baseRepo();
    repo.getPublicProjectForRecording.mockResolvedValue({
      id: "project-2",
      name: "Hidden Project",
      organizationId: "org-2",
      status: "recruiting",
      isPublicToStreamers: true,
    });

    await expect(
      submitProjectRecording({
        repo,
        audit: vi.fn(),
        notify: vi.fn(),
        actor,
        input: {
          projectId: "project-2",
          streamerId: "streamer-1",
          link: "https://videos.example.com/hidden",
        },
      }),
    ).rejects.toThrow("Project is not available for recording delivery");
  });
});
```

- [ ] **Step 2: Implement the project recording service**

Create `features/recordings/project-recording-delivery.ts`:

```ts
import type {
  AdmissionActor,
  ApplicationRecord,
  ApplicationRepository,
  ApplicationAuditWriter,
  ApplicationNotifier,
  RecordingSubmissionRecord,
} from "@/features/applications/application-service";
import { submitRecording } from "@/features/applications/application-service";

export type PublicProjectForRecording = {
  id: string;
  name: string;
  organizationId: string;
  status: string;
  isPublicToStreamers: boolean;
};

export type ProjectRecordingDeliveryRepository = ApplicationRepository & {
  getPublicProjectForRecording(
    projectId: string,
  ): Promise<PublicProjectForRecording | null>;
  getApplicationByProjectAndStreamer(
    projectId: string,
    streamerId: string,
  ): Promise<ApplicationRecord | null>;
};

export type ProjectRecordingDeliveryResult = {
  applicationId: string;
  projectId: string;
  recording: RecordingSubmissionRecord;
  reviewStatusLabel: string;
};

const blockedProjectStatuses = new Set(["draft", "ended", "closed"]);

export async function submitProjectRecording({
  repo,
  audit,
  notify,
  actor,
  input,
}: {
  repo: ProjectRecordingDeliveryRepository;
  audit: ApplicationAuditWriter;
  notify: ApplicationNotifier;
  actor: AdmissionActor;
  input: {
    projectId: unknown;
    streamerId: string;
    link: unknown;
    durationSeconds?: number;
  };
}): Promise<ProjectRecordingDeliveryResult> {
  if (actor.role !== "streamer") {
    throw new Error("Only streamers can submit project recordings");
  }

  const normalized = normalizeProjectRecordingInput(input);
  const project = await repo.getPublicProjectForRecording(normalized.projectId);
  if (
    !project ||
    project.organizationId !== actor.organizationId ||
    !project.isPublicToStreamers ||
    blockedProjectStatuses.has(project.status)
  ) {
    throw new Error("Project is not available for recording delivery");
  }

  const streamer = await repo.getStreamerForAdmission(input.streamerId);
  if (!streamer) {
    throw new Error("Streamer not found");
  }
  if (streamer.riskLevel === "blacklisted") {
    throw new Error("Blacklisted streamers cannot submit project recordings");
  }

  const application =
    (await repo.getApplicationByProjectAndStreamer(
      project.id,
      streamer.id,
    )) ??
    (await repo.createApplication({
      organizationId: actor.organizationId,
      projectId: project.id,
      streamerId: streamer.id,
      source: "signup",
      status: "submitted",
    }));

  const recording = await submitRecording({
    repo,
    audit,
    notify,
    actor,
    input: {
      applicationId: application.id,
      externalUrl: normalized.link,
      durationSeconds: normalized.durationSeconds,
    },
  });

  return {
    applicationId: application.id,
    projectId: project.id,
    recording,
    reviewStatusLabel: "审核中",
  };
}

function normalizeProjectRecordingInput(input: {
  projectId: unknown;
  link: unknown;
  durationSeconds?: number;
}) {
  if (typeof input.projectId !== "string" || !input.projectId.trim()) {
    throw new Error("projectId is required");
  }
  if (typeof input.link !== "string" || !input.link.trim()) {
    throw new Error("Recording link is required");
  }

  const link = input.link.trim();
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new Error("Recording link must be an http(s) URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Recording link must be an http(s) URL");
  }

  return {
    projectId: input.projectId.trim(),
    link,
    durationSeconds: input.durationSeconds,
  };
}
```

- [ ] **Step 3: Add Supabase repository methods**

In `features/applications/application-repository.ts`, add this row type near the other row types:

```ts
type PublicProjectForRecordingRow = {
  id: string;
  name: string;
  organization_id: string;
  status: string;
  is_public_to_streamers: boolean;
};
```

Inside `SupabaseApplicationRepository`, add:

```ts
async getPublicProjectForRecording(projectId: string) {
  const { data, error } = await this.client
    .from("projects")
    .select("id, name, organization_id, status, is_public_to_streamers")
    .eq("id", projectId)
    .maybeSingle<PublicProjectForRecordingRow>();

  if (error) {
    throw error;
  }

  return data
    ? {
        id: data.id,
        name: data.name,
        organizationId: data.organization_id,
        status: data.status,
        isPublicToStreamers: data.is_public_to_streamers,
      }
    : null;
}

async getApplicationByProjectAndStreamer(
  projectId: string,
  streamerId: string,
): Promise<ApplicationRecord | null> {
  const { data, error } = await this.client
    .from("project_applications")
    .select(applicationSelect)
    .eq("project_id", projectId)
    .eq("streamer_id", streamerId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle<ApplicationRow>();

  if (error) {
    throw error;
  }

  return data ? toApplicationRecord(data) : null;
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
pnpm test features/recordings/project-recording-delivery.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/recordings/project-recording-delivery.test.ts features/recordings/project-recording-delivery.ts features/applications/application-repository.ts
git commit -m "feat: sync project recordings to review queue"
```

---

### Task 5: Streamer Recording Route Branch

**Files:**
- Modify: `app/api/streamer/recordings/route.test.ts`
- Modify: `app/api/streamer/recordings/route.ts`
- Test: streamer recordings route

- [ ] **Step 1: Write the failing route test for `projectId`**

In `app/api/streamer/recordings/route.test.ts`, mock the new service:

```ts
import { submitProjectRecording } from "@/features/recordings/project-recording-delivery";

vi.mock("@/features/recordings/project-recording-delivery", () => ({
  submitProjectRecording: vi.fn(),
}));
```

Add this default mock in `beforeEach`:

```ts
vi.mocked(submitProjectRecording).mockResolvedValue({
  applicationId: "application-1",
  projectId: "project-1",
  recording: {
    id: "recording-1",
    applicationId: "application-1",
    version: 1,
    status: "submitted",
  },
  reviewStatusLabel: "审核中",
});
```

Add this test:

```ts
it("submits project recordings to the application review queue when projectId is present", async () => {
  const response = await POST(
    new Request("http://localhost/api/streamer/recordings", {
      method: "POST",
      body: JSON.stringify({
        projectId: "project-1",
        link: "https://videos.example.com/project-1",
        durationSeconds: 600,
      }),
    }),
  );

  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toEqual({
    projectRecording: expect.objectContaining({
      applicationId: "application-1",
      projectId: "project-1",
      reviewStatusLabel: "审核中",
    }),
  });
  expect(submitProjectRecording).toHaveBeenCalledWith(
    expect.objectContaining({
      actor: expect.objectContaining({
        userId: "user-streamer",
        role: "streamer",
        organizationId: "org-1",
      }),
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        link: "https://videos.example.com/project-1",
        durationSeconds: 600,
      },
    }),
  );
  expect(createStreamerRecordingLink).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the failing route test**

Run:

```bash
pnpm test app/api/streamer/recordings/route.test.ts
```

Expected: FAIL because the route does not branch on `projectId`.

- [ ] **Step 3: Implement the branch**

In `app/api/streamer/recordings/route.ts`, add imports:

```ts
import { SupabaseApplicationRepository } from "@/features/applications/application-repository";
import { submitProjectRecording } from "@/features/recordings/project-recording-delivery";
```

Inside `POST`, before calling `createStreamerRecordingLink`, add:

```ts
if (typeof body.projectId === "string" && body.projectId.trim()) {
  const projectRecording = await submitProjectRecording({
    repo: new SupabaseApplicationRepository(context.supabase),
    audit: (input) => context.audit(context.supabase, input),
    notify: (input) => context.notify(context.supabase, input),
    actor: {
      userId: context.auth.userId,
      name: context.auth.name,
      role: context.auth.role,
      organizationId: context.auth.organizationId,
    },
    input: {
      projectId: body.projectId,
      streamerId,
      link: body.link,
      durationSeconds:
        typeof body.durationSeconds === "number"
          ? body.durationSeconds
          : undefined,
    },
  });

  return NextResponse.json({ projectRecording }, { status: 201 });
}
```

Keep the existing `createStreamerRecordingLink` call unchanged for requests without `projectId`.

- [ ] **Step 4: Run route tests**

Run:

```bash
pnpm test app/api/streamer/recordings/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/streamer/recordings/route.test.ts app/api/streamer/recordings/route.ts
git commit -m "feat: route project recording submissions"
```

---

### Task 6: Streamer Mobile Announcement UI

**Files:**
- Modify: `app/(streamer-app)/m/recordings/page.tsx`
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Test: streamer UI smoke tests

- [ ] **Step 1: Write failing streamer UI tests**

In `components/reference-ui/streamer-mobile-reference.test.jsx`, add a test in the recording smoke describe block:

```jsx
it("renders public project announcements with download link and review status", () => {
  render(
    <StreamerMobileReferenceApp
      initialRoute="videos"
      recordings={[]}
      projectAnnouncements={[
        {
          id: "project-1",
          code: "PUB-1",
          name: "Public Project",
          status: "recruiting",
          vendor: "Vendor A",
          product: "Game A",
          description: "Ops description",
          publicSummary: "Streamer-facing summary",
          gameDownloadUrl: "https://download.example.com/game-a",
          openSignup: true,
          forceRecording: true,
          applicationId: "application-1",
          applicationStatus: "recording_reviewing",
          latestRecordingStatus: "submitted",
          latestRecordingVersion: 1,
          decisionReason: null,
          reviewStatusLabel: "审核中",
          canSubmitRecording: false,
        },
      ]}
    />,
  );

  expect(screen.getByText("项目公告")).toBeInTheDocument();
  expect(screen.getByText("Public Project")).toBeInTheDocument();
  expect(screen.getByText("Streamer-facing summary")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "打开游戏下载" })).toHaveAttribute(
    "href",
    "https://download.example.com/game-a",
  );
  expect(screen.getByText("审核中")).toBeInTheDocument();
});
```

Add a project submit interaction test:

```jsx
it("submits a project recording from an announcement card", async () => {
  const fetchMock = vi.fn(async (url, init) => {
    if (
      String(url) === "/api/streamer/recordings" &&
      init?.method === "POST"
    ) {
      return {
        ok: true,
        json: async () => ({
          projectRecording: {
            applicationId: "application-1",
            projectId: "project-1",
            recording: {
              id: "recording-1",
              applicationId: "application-1",
              version: 1,
              status: "submitted",
            },
            reviewStatusLabel: "审核中",
          },
        }),
      };
    }
    if (String(url) === "/api/streamer/project-announcements") {
      return {
        ok: true,
        json: async () => ({
          announcements: [
            {
              id: "project-1",
              code: "PUB-1",
              name: "Public Project",
              status: "recruiting",
              vendor: "Vendor A",
              product: "Game A",
              description: "",
              publicSummary: "Streamer-facing summary",
              gameDownloadUrl: "https://download.example.com/game-a",
              openSignup: true,
              forceRecording: true,
              applicationId: "application-1",
              applicationStatus: "recording_reviewing",
              latestRecordingStatus: "submitted",
              latestRecordingVersion: 1,
              decisionReason: null,
              reviewStatusLabel: "审核中",
              canSubmitRecording: false,
            },
          ],
        }),
      };
    }
    return { ok: false, json: async () => ({ error: "unexpected request" }) };
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <StreamerMobileReferenceApp
      initialRoute="videos"
      recordings={[]}
      projectAnnouncements={[
        {
          id: "project-1",
          code: "PUB-1",
          name: "Public Project",
          status: "recruiting",
          vendor: "Vendor A",
          product: "Game A",
          description: "",
          publicSummary: "Streamer-facing summary",
          gameDownloadUrl: "https://download.example.com/game-a",
          openSignup: true,
          forceRecording: true,
          applicationId: null,
          applicationStatus: null,
          latestRecordingStatus: null,
          latestRecordingVersion: null,
          decisionReason: null,
          reviewStatusLabel: "待投递",
          canSubmitRecording: true,
        },
      ]}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "投递录播" }));
  fireEvent.change(screen.getByLabelText("链接"), {
    target: { value: "https://videos.example.com/project-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交录屏链接" }));

  await waitFor(() => {
    expect(screen.getByText("审核中")).toBeInTheDocument();
  });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(
    expect.objectContaining({
      projectId: "project-1",
      link: "https://videos.example.com/project-1",
    }),
  );
});
```

- [ ] **Step 2: Run failing streamer UI tests**

Run:

```bash
pnpm test components/reference-ui/streamer-mobile-reference.test.jsx
```

Expected: FAIL because `projectAnnouncements` is not accepted or rendered.

- [ ] **Step 3: Load announcements on the streamer recordings page**

In `app/(streamer-app)/m/recordings/page.tsx`, import:

```ts
import { listStreamerProjectAnnouncements } from "@/features/recordings/project-announcements";
```

Load both datasets:

```tsx
export default async function StreamerRecordingsPage() {
  const { recordings, projectAnnouncements } =
    await loadStreamerRecordingPageData();

  return (
    <div className="mobile-prototype-stage">
      <StreamerMobileReferenceApp
        initialRoute="videos"
        recordings={recordings}
        projectAnnouncements={projectAnnouncements}
      />
    </div>
  );
}
```

Replace the old loader with:

```ts
async function loadStreamerRecordingPageData() {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);
  if (!supabase || !auth || auth.role !== "streamer") {
    return { recordings: undefined, projectAnnouncements: undefined };
  }

  const streamerId = await getStreamerIdForUser(supabase, auth.userId);
  if (!streamerId) {
    return { recordings: undefined, projectAnnouncements: undefined };
  }

  const input = {
    organizationId: auth.organizationId,
    streamerId,
  };

  const [recordings, projectAnnouncements] = await Promise.all([
    listStreamerRecordingLinks(supabase, input),
    listStreamerProjectAnnouncements(supabase, input),
  ]);

  return { recordings, projectAnnouncements };
}
```

- [ ] **Step 4: Add announcement state and actions to the mobile app**

In `components/reference-ui/streamer-mobile-reference.jsx`, add `projectAnnouncements` to `StreamerMobileReferenceInner` props and initialize state:

```jsx
function StreamerMobileReferenceInner({
  initialRoute = "home",
  liveTasks,
  liveEarnings,
  recordings,
  projectAnnouncements,
}) {
  const [announcementRows, setAnnouncementRows] = React.useState(() =>
    normalizeProjectAnnouncements(projectAnnouncements),
  );
```

Add an effect:

```jsx
React.useEffect(() => {
  setAnnouncementRows(normalizeProjectAnnouncements(projectAnnouncements));
}, [projectAnnouncements]);
```

Add this normalizer near recording normalizers:

```jsx
function normalizeProjectAnnouncements(projectAnnouncements) {
  return Array.isArray(projectAnnouncements) ? projectAnnouncements : [];
}
```

Add a refresh action:

```jsx
const refreshProjectAnnouncements = async () => {
  const body = await fetchJson(
    "/api/streamer/project-announcements",
    "refresh project announcements failed",
  );
  if (Array.isArray(body.announcements)) {
    setAnnouncementRows(normalizeProjectAnnouncements(body.announcements));
  }
};
```

Update `submitRecordingLink`:

```jsx
submitRecordingLink: async (form) => {
  const body = await fetchJson(
    "/api/streamer/recordings",
    "submit recording link failed",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    },
  );
  if (body.projectRecording) {
    await refreshProjectAnnouncements();
    return;
  }
  if (body.recording) {
    setRecordingRows((current) => [
      normalizeStreamerRecordings([body.recording])[0],
      ...(Array.isArray(current) ? current : []),
    ]);
  }
},
```

Pass `announcements` through context and to `VideosOnlyPage`:

```jsx
const visibleAnnouncements = Array.isArray(announcementRows)
  ? announcementRows
  : [];
```

```jsx
projectAnnouncements: visibleAnnouncements,
```

```jsx
<VideosOnlyPage
  go={go}
  recordings={visibleRecordings}
  projectAnnouncements={visibleAnnouncements}
/>
```

- [ ] **Step 5: Render project announcements in `VideosTab`**

Change `VideosTab` signature and state:

```jsx
function VideosTab({ recordings, projectAnnouncements }) {
  const recordingRows = Array.isArray(recordings) ? recordings : MY_VIDEOS;
  const announcementRows = Array.isArray(projectAnnouncements)
    ? projectAnnouncements
    : [];
  const actions = useStreamerLiveActions();
  const [form, setForm] = React.useState(() => ({
    projectId: "",
    projectName: "",
    product: "",
    category: "",
    link: "",
    month: currentMonthLabel(),
  }));
```

Add a card select handler:

```jsx
const selectProjectForRecording = (project) => {
  setError("");
  setForm((current) => ({
    ...current,
    projectId: project.id,
    projectName: project.name,
    product: project.product || project.name,
    category: "项目录播",
  }));
};
```

Add this section before the submit form:

```jsx
<MSection
  title="项目公告"
  action={<MBadge tone="blue">{announcementRows.length} 个</MBadge>}
>
  {announcementRows.length === 0 ? (
    <MCard style={{ background: "var(--bg-soft)", borderStyle: "dashed" }}>
      <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
        暂无公开项目公告。
      </div>
    </MCard>
  ) : (
    announcementRows.map((project) => (
      <ProjectAnnouncementCard
        key={project.id}
        project={project}
        onSelect={selectProjectForRecording}
      />
    ))
  )}
</MSection>
```

Add selected project hint inside the form above the product field:

```jsx
{form.projectId ? (
  <div
    style={{
      border: "1px solid var(--blue-100)",
      borderRadius: 8,
      padding: "8px 10px",
      background: "var(--blue-50)",
      color: "var(--blue-800)",
      fontSize: 12,
      fontWeight: 700,
    }}
  >
    投递项目：{form.projectName}
  </div>
) : null}
```

Create `ProjectAnnouncementCard` near `RecordingLinkCard`:

```jsx
function ProjectAnnouncementCard({ project, onSelect }) {
  return (
    <MCard style={{ marginBottom: 10 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: "var(--ink-900)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {project.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 2 }}>
              {project.product || project.code}
            </div>
          </div>
          <MBadge tone={recordingStatusTone(project.latestRecordingStatus)} dot>
            {project.reviewStatusLabel}
          </MBadge>
        </div>
        {project.publicSummary ? (
          <div style={{ fontSize: 12, color: "var(--ink-600)", lineHeight: 1.55 }}>
            {project.publicSummary}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {project.gameDownloadUrl ? (
            <a
              href={project.gameDownloadUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                height: 32,
                borderRadius: 8,
                padding: "0 10px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--bg-soft)",
                color: "var(--blue-700)",
                fontSize: 12,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              打开游戏下载
            </a>
          ) : null}
          <button
            type="button"
            disabled={!project.canSubmitRecording}
            onClick={() => onSelect(project)}
            style={{
              height: 32,
              borderRadius: 8,
              border: "none",
              padding: "0 10px",
              background: project.canSubmitRecording
                ? "var(--blue-600)"
                : "var(--line-strong)",
              color: project.canSubmitRecording ? "#fff" : "var(--ink-400)",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            投递录播
          </button>
        </div>
      </div>
    </MCard>
  );
}
```

Update `VideosOnlyPage` and exported prop doc:

```jsx
function VideosOnlyPage({ recordings, projectAnnouncements }) {
  return (
    <div style={{ paddingBottom: 96 }}>
      <MAppBar
        title="我的录屏"
        subtitle="项目公告 / 录屏 URL / 审核状态"
        dark={false}
      />
      <VideosTab
        recordings={recordings}
        projectAnnouncements={projectAnnouncements}
      />
    </div>
  );
}
```

```jsx
export default function StreamerMobileReferenceApp({
  initialRoute = "home",
  liveTasks,
  liveEarnings,
  recordings,
  projectAnnouncements,
}) {
  return (
    <StreamerMobileReferenceInner
      initialRoute={initialRoute}
      liveTasks={liveTasks}
      liveEarnings={liveEarnings}
      recordings={recordings}
      projectAnnouncements={projectAnnouncements}
    />
  );
}
```

- [ ] **Step 6: Run streamer UI tests**

Run:

```bash
pnpm test components/reference-ui/streamer-mobile-reference.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

Quote paths with parentheses in PowerShell:

```bash
git add "app/(streamer-app)/m/recordings/page.tsx" components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-mobile-reference.jsx
git commit -m "feat: show streamer project announcements"
```

---

### Task 7: Ops Project Settings UI

**Files:**
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Test: ops UI smoke tests

- [ ] **Step 1: Write the failing ops UI test**

In `components/reference-ui/ops-reference.test.jsx`, extend the existing project settings test around the "项目设置" click. After existing setting field changes, add:

```jsx
fireEvent.click(screen.getByLabelText("公开给组织内主播"));
fireEvent.change(screen.getByLabelText("主播公告概括"), {
  target: { value: "Streamer-facing project summary" },
});
fireEvent.change(screen.getByLabelText("游戏下载链接"), {
  target: { value: "https://download.example.com/game-a" },
});
```

Add these expectations to the mocked PATCH payload:

```ts
isPublicToStreamers: true,
publicSummary: "Streamer-facing project summary",
gameDownloadUrl: "https://download.example.com/game-a",
```

Add UI assertions after save:

```jsx
expect(screen.getByText("组织内公开")).toBeInTheDocument();
expect(
  screen.getByText("Streamer-facing project summary"),
).toBeInTheDocument();
```

- [ ] **Step 2: Run the failing ops UI test**

Run:

```bash
pnpm test components/reference-ui/ops-reference.test.jsx
```

Expected: FAIL because the fields and overview labels are missing.

- [ ] **Step 3: Add public settings to the project settings draft and submit payload**

In `components/reference-ui/ops-reference.jsx`, update `projectSettingsInitialDraft`:

```jsx
isPublicToStreamers: Boolean(project?.isPublicToStreamers),
publicSummary: normalizeProjectTextDraft(project?.publicSummary, []),
gameDownloadUrl: normalizeProjectTextDraft(project?.gameDownloadUrl, []),
```

In `handleProjectSettingsSubmit`, add to `actions.updateProjectBasics` payload:

```jsx
isPublicToStreamers: settingsDraft.isPublicToStreamers,
publicSummary: settingsDraft.publicSummary.trim(),
gameDownloadUrl: settingsDraft.gameDownloadUrl.trim(),
```

- [ ] **Step 4: Add public settings fields to `ProjectSettingsPanel`**

Inside `ProjectSettingsPanel`, add this block after the existing signup/direct-invite toggles:

```jsx
<div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  }}
>
  <label
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 12,
      color: "var(--ink-600)",
    }}
  >
    <input
      aria-label="公开给组织内主播"
      type="checkbox"
      checked={draft.isPublicToStreamers}
      onChange={(event) =>
        onChange("isPublicToStreamers", event.target.checked)
      }
    />
    公开给组织内主播
  </label>
  <ProjectSettingsField label="游戏下载链接">
    <input
      aria-label="游戏下载链接"
      value={draft.gameDownloadUrl}
      placeholder="https://download.example.com/game"
      onChange={(event) => onChange("gameDownloadUrl", event.target.value)}
      style={projectSettingsInputStyle}
    />
  </ProjectSettingsField>
</div>
<ProjectSettingsField label="主播公告概括">
  <textarea
    aria-label="主播公告概括"
    value={draft.publicSummary}
    placeholder="给组织内主播看的项目概括、录播要求和注意事项"
    onChange={(event) => onChange("publicSummary", event.target.value)}
    rows={3}
    style={{
      ...projectSettingsInputStyle,
      height: 76,
      paddingTop: 8,
      resize: "vertical",
      lineHeight: 1.45,
    }}
  />
</ProjectSettingsField>
```

- [ ] **Step 5: Show public state in project overview**

In the project overview summary area, add a compact badge and summary preview:

```jsx
{p.isPublicToStreamers ? (
  <Badge tone="green" dot>
    组织内公开
  </Badge>
) : (
  <Badge tone="default">未公开</Badge>
)}
```

Render a preview row:

```jsx
{p.publicSummary ? (
  <div style={{ fontSize: 12, color: "var(--ink-600)", lineHeight: 1.55 }}>
    {p.publicSummary}
  </div>
) : null}
```

If a download link is configured, render:

```jsx
{p.gameDownloadUrl ? (
  <a href={p.gameDownloadUrl} target="_blank" rel="noreferrer">
    游戏下载已配置
  </a>
) : null}
```

- [ ] **Step 6: Run ops UI test**

Run:

```bash
pnpm test components/reference-ui/ops-reference.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/reference-ui/ops-reference.test.jsx components/reference-ui/ops-reference.jsx
git commit -m "feat: configure public project announcements"
```

---

### Task 8: End-To-End Verification And Business Closure

**Files:**
- Modify only files required to fix failures found by verification.
- Test: focused suites, full type-check, UI smoke.

- [ ] **Step 1: Run the focused backend suites**

Run:

```bash
pnpm test lib/db/schema-contract.test.ts features/projects/project-service.test.ts features/projects/project-ui-dto.test.ts app/api/projects/projects-route.test.ts features/recordings/project-announcements.test.ts app/api/streamer/project-announcements/route.test.ts features/recordings/project-recording-delivery.test.ts app/api/streamer/recordings/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run UI smoke tests**

Run:

```bash
pnpm test:ui-smoke
```

Expected: PASS.

- [ ] **Step 3: Run type-check**

Run:

```bash
pnpm type-check
```

Expected: PASS.

- [ ] **Step 4: Run a local browser check**

Start the app:

```bash
pnpm dev
```

Open `http://localhost:3000/m/recordings` and verify:

- The streamer videos route renders "项目公告".
- A public project card shows project name, public summary, review status, and the game download link.
- Clicking "投递录播" preselects the project in the recording form.
- Submitting a link sends `POST /api/streamer/recordings` with `projectId`.

Open `http://localhost:3000/console/projects` and verify:

- Project settings include "公开给组织内主播", "主播公告概括", and "游戏下载链接".
- Saving settings persists the public fields in the UI response.
- The project detail overview shows "组织内公开" and the summary preview.

- [ ] **Step 5: Business closure checklist**

Confirm these acceptance points:

- Ops can set a project as public to streamers in the current organization.
- Streamers only see current-organization public projects.
- Streamers see public summary and game download link.
- Streamers can submit a recording from a public project announcement.
- The submission creates or reuses `project_applications`.
- The submission creates `recording_submissions` and updates application status to `recording_reviewing`.
- Ops review continues through existing `/api/applications/:applicationId/review`.
- Streamers see the updated review status from announcement DTO.
- A POST without `projectId` still creates a personal `streamer_recording_links` row.

- [ ] **Step 6: Final commit for verification fixes**

If verification required fixes, stage only those files:

```bash
git add <files changed by verification fixes>
git commit -m "fix: close public project recording verification"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: database fields, ops project settings, streamer project announcements, game download link, project recording delivery, auto-sync to recording review, streamer review status, current-organization visibility, and old personal recording compatibility all map to tasks above.
- Placeholder scan: the plan contains concrete files, snippets, commands, expected outcomes, and acceptance checks for every task.
- Type consistency: project public fields use snake_case in Supabase rows and camelCase in service/API/UI DTOs. Recording delivery returns `projectRecording` from the route and keeps personal recording responses as `recording`.
