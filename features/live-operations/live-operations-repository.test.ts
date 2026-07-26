import { describe, expect, it, vi } from "vitest";

import {
  deleteReportScreenshotForOcr,
  getStreamerIdForUser,
  SupabaseLiveOperationsRepository,
} from "./live-operations-repository";

const databaseScreenshotId = "00000000-0000-4000-8000-000000000101";

function createDeleteClient(result: { error: Error | null; count: number }) {
  const filters: Array<{ column: string; value: string }> = [];
  type DeleteResult = typeof result;
  type DeleteQuery = PromiseLike<DeleteResult> & {
    eq(column: string, value: string): DeleteQuery;
  };
  const query = {
    eq: vi.fn((column: string, value: string) => {
      filters.push({ column, value });
      return query;
    }),
    then<TResult1 = DeleteResult, TResult2 = never>(
      onfulfilled?:
        | ((value: DeleteResult) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  } as DeleteQuery;
  const deleteRow = vi.fn(() => query);
  const from = vi.fn(() => ({ delete: deleteRow }));
  return { client: { from } as never, deleteRow, filters, from };
}

describe("getStreamerIdForUser", () => {
  it("selects one streamer binding within the current organization", async () => {
    const limit = vi.fn(async () => ({
      data: [{ id: "streamer-latest" }],
      error: null,
    }));
    const orderId = vi.fn(() => ({ limit }));
    const orderCreatedAt = vi.fn(() => ({ order: orderId }));
    const eqOrganization = vi.fn(() => ({ order: orderCreatedAt }));
    const eqUser = vi.fn(() => ({ eq: eqOrganization }));
    const select = vi.fn(() => ({ eq: eqUser }));
    const from = vi.fn(() => ({ select }));

    await expect(
      getStreamerIdForUser({ from } as never, "user-streamer", "org-1"),
    ).resolves.toBe("streamer-latest");
    expect(from).toHaveBeenCalledWith("streamers");
    expect(select).toHaveBeenCalledWith("id");
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-streamer");
    expect(eqOrganization).toHaveBeenCalledWith("organization_id", "org-1");
    expect(orderCreatedAt).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(orderId).toHaveBeenCalledWith("id", { ascending: false });
    expect(limit).toHaveBeenCalledWith(1);
  });
});

describe("SupabaseLiveOperationsRepository", () => {
  it("returns the database-generated report screenshot id", async () => {
    const single = vi.fn(async () => ({
      data: { id: databaseScreenshotId },
      error: null,
    }));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const repo = new SupabaseLiveOperationsRepository({ from } as never);

    await expect(
      repo.createReportScreenshot({
        organizationId: "org-1",
        liveReportId: "report-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        storagePath: "org/report-screenshots/task-1/end.png",
        fileHash: "sha256:abc123",
        uploadedBy: "user-streamer",
        metadata: { imageBucket: "evidence-private" },
      }),
    ).resolves.toBe(databaseScreenshotId);

    expect(from).toHaveBeenCalledWith("report_screenshots");
    expect(insert).toHaveBeenCalledWith({
      organization_id: "org-1",
      live_report_id: "report-1",
      project_id: "project-1",
      streamer_id: "streamer-1",
      storage_path: "org/report-screenshots/task-1/end.png",
      file_hash: "sha256:abc123",
      uploaded_by: "user-streamer",
      metadata: { imageBucket: "evidence-private" },
    });
    expect(select).toHaveBeenCalledWith("id");
    expect(single).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing row", null],
    ["missing id", {}],
    ["non-string id", { id: 42 }],
    ["empty id", { id: "" }],
    ["blank id", { id: "   " }],
    ["non-UUID id", { id: "screenshot-db-1" }],
  ])("rejects a %s from screenshot RETURNING", async (_case, data) => {
    const single = vi.fn(async () => ({
      data,
      error: null,
    }));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const repo = new SupabaseLiveOperationsRepository({ from } as never);

    await expect(
      repo.createReportScreenshot({
        organizationId: "org-1",
        liveReportId: "report-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        storagePath: "org/report-screenshots/task-1/end.png",
        fileHash: "sha256:abc123",
        uploadedBy: "user-streamer",
      }),
    ).rejects.toThrow("Report screenshot insert did not return a valid id");
  });

  it("deletes only the created screenshot row for its report and organization", async () => {
    const { client, deleteRow, filters, from } = createDeleteClient({
      error: null,
      count: 1,
    });

    await expect(
      deleteReportScreenshotForOcr(client, {
        id: databaseScreenshotId,
        organizationId: "org-1",
        liveReportId: "report-1",
        screenshotFileHash: "sha256:abc123",
      }),
    ).resolves.toBeUndefined();

    expect(from).toHaveBeenCalledWith("report_screenshots");
    expect(deleteRow).toHaveBeenCalledWith({ count: "exact" });
    expect(filters).toEqual([
      { column: "organization_id", value: "org-1" },
      { column: "live_report_id", value: "report-1" },
      { column: "file_hash", value: "sha256:abc123" },
      { column: "id", value: databaseScreenshotId },
    ]);
  });

  it("rejects a cleanup that did not delete exactly one screenshot row", async () => {
    const { client } = createDeleteClient({ error: null, count: 0 });

    await expect(
      deleteReportScreenshotForOcr(client, {
        id: databaseScreenshotId,
        organizationId: "org-1",
        liveReportId: "report-1",
        screenshotFileHash: "sha256:abc123",
      }),
    ).rejects.toThrow("OCR screenshot cleanup did not delete exactly one row");
  });

  it.each([0, 1])(
    "accepts count %s when cleaning up a screenshot whose RETURNING response was lost",
    async (count) => {
      const { client, filters } = createDeleteClient({ error: null, count });

      await expect(
        deleteReportScreenshotForOcr(client, {
          id: undefined,
          organizationId: "org-1",
          liveReportId: "report-1",
          screenshotFileHash: "sha256:abc123",
        }),
      ).resolves.toBeUndefined();

      expect(filters).toEqual([
        { column: "organization_id", value: "org-1" },
        { column: "live_report_id", value: "report-1" },
        { column: "file_hash", value: "sha256:abc123" },
      ]);
    },
  );

  it("rejects an unknown-id cleanup that matches more than one row", async () => {
    const { client } = createDeleteClient({ error: null, count: 2 });

    await expect(
      deleteReportScreenshotForOcr(client, {
        id: undefined,
        organizationId: "org-1",
        liveReportId: "report-1",
        screenshotFileHash: "sha256:abc123",
      }),
    ).rejects.toThrow("OCR screenshot cleanup deleted an unexpected row count");
  });
});
