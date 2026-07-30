import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  assertCanCreateAdmissionShareForProject,
  canShareAdmissionRecordingsForProject,
} from "./admission-share-policy";

describe("admission share project policy", () => {
  it.each(["recruiting", "pending_start", "active", "paused", "ended"])(
    "allows recording shares while project status is %s",
    (status) => {
      expect(canShareAdmissionRecordingsForProject(status)).toBe(true);
    },
  );

  it.each(["draft", "settling", "archived", null, undefined])(
    "blocks recording shares when project status is %s",
    (status) => {
      expect(canShareAdmissionRecordingsForProject(status)).toBe(false);
    },
  );

  it("reads the owned project status and rejects create/preflight after lifecycle close", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { status: "settling" },
      error: null,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const supabase = {
      from: vi.fn().mockReturnValue(query),
    };

    await expect(
      assertCanCreateAdmissionShareForProject(supabase as never, {
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({
      code: "ADMISSION_SHARE_PROJECT_STATUS_BLOCKED",
      statusCode: 409,
    });
    expect(supabase.from).toHaveBeenCalledWith("projects");
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(query.eq).toHaveBeenCalledWith("id", "project-1");
  });

  it("allows server creation while the owned project is pre-settlement", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { status: "active" },
      error: null,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);

    await expect(
      assertCanCreateAdmissionShareForProject(
        { from: vi.fn().mockReturnValue(query) } as never,
        {
          organizationId: "org-1",
          projectId: "project-1",
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps a database lifecycle guard on the final share-board insert", () => {
    const migrationPath = resolve(
      process.cwd(),
      "supabase/migrations/20260730151000_admission_share_project_status_guard.sql",
    );
    expect(existsSync(migrationPath)).toBe(true);
    const sql = existsSync(migrationPath)
      ? readFileSync(migrationPath, "utf8")
      : "";

    expect(sql).toContain("before insert");
    expect(sql).toContain("project_recording_share_boards");
    expect(sql).toContain("admission_share_project_status_blocked");
    expect(sql).toMatch(
      /project\.status::text\s+in\s+\(\s*'recruiting'[\s\S]*'ended'/,
    );
  });

  it("uses a unique timestamp basename for every migration", () => {
    const migrationNames = readdirSync(
      resolve(process.cwd(), "supabase/migrations"),
    ).filter((name) => /^\d{14}_.+\.sql$/.test(name));
    const timestampCounts = new Map<string, string[]>();

    for (const name of migrationNames) {
      const timestamp = basename(name).slice(0, 14);
      timestampCounts.set(timestamp, [
        ...(timestampCounts.get(timestamp) || []),
        name,
      ]);
    }

    expect(
      Array.from(timestampCounts.values()).filter((names) => names.length > 1),
    ).toEqual([]);
  });
});
