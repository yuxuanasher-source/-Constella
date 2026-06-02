import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "./ops-reference";

describe("OpsReferenceApp settlement smoke", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a payable settlement batch from the M6 action without losing the page state", async () => {
    const promptValues = ["project-1", "2026-06-01", "2026-06-30", "payable"];
    vi.stubGlobal(
      "prompt",
      vi.fn(() => promptValues.shift() ?? null),
    );

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        batch: {
          id: "batch-ui-smoke-1",
          projectId: "project-1",
          batchType: "payable",
          status: "generated",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          computedAmount: 160,
          manualAmount: 0,
          adjustmentAmount: 0,
          createdBy: "Ops",
          createdAt: "2026-06-02T12:20:00.000Z",
          updatedAt: "2026-06-02T12:20:00.000Z",
        },
        items: [
          {
            id: "item-ui-smoke-1",
            projectId: "project-1",
            streamerId: "streamer-1",
            liveReportId: "report-ui-smoke-1",
            itemType: "live_report",
            computedAmount: 160,
            manualAmount: 0,
            adjustmentAmount: 0,
            evidenceLevel: "green",
            evidenceSnapshot: {
              settlementDuration: 120,
              settlementMethod: "cpt",
              timeSource: "system",
            },
            createdAt: "2026-06-02T12:21:00.000Z",
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OpsReferenceApp
        initialRoute="settle"
        liveBatches={[]}
        liveBatchDetails={{}}
        liveSettlementPool={[
          {
            id: "report-ui-smoke-1",
            streamer: "主播一号",
            project: "Golden Project",
            hours: 2,
            evidence: "green · system",
            rule: "cpt",
            expected: 160,
            approvedAt: "2026-06-02 20:10",
          },
        ]}
        settlementScope={{
          projectId: "project-1",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          poolCount: 1,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建结算批次" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settlement-batches",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          batchType: "payable",
        }),
      }),
    );

    expect(await screen.findAllByText("batch-ui-smoke-1")).toHaveLength(2);
    expect(screen.getByText("暂无待入批次")).toBeInTheDocument();
    expect(screen.queryByText("report-ui-smoke-1")).not.toBeInTheDocument();
  });
});
