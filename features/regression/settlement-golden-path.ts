import type { AuditLogInput } from "@/lib/audit/audit";
import type { NotificationInput } from "@/lib/notify/notify";

import {
  createLiveTask,
  reviewLiveReport,
  startLiveTask,
  stopLiveTask,
  submitLiveReport,
  type LiveOperationsRepository,
  type LiveReportRecord,
  type LiveTaskRecord,
  type ProjectStreamerForTask,
} from "@/features/live-operations/live-operations-service";
import {
  generateSettlementBatch,
  listSettlementPool,
  type ProjectSettlementRuleRecord,
  type SettlementBatchAtomicItemInput,
  type SettlementBatchItemRecord,
  type SettlementBatchRecord,
  type SettlementPoolReport,
  type SettlementRepository,
  type SettlementRuleRecord,
  type StreamerUserLink,
} from "@/features/settlements/settlement-service";
import {
  toStreamerEarningsSummary,
  type StreamerEarningsSummary,
  type StreamerPayableSafeRow,
} from "@/features/settlements/streamer-settlement-queries";

type GoldenPathResult = {
  task: LiveTaskRecord;
  report: LiveReportRecord;
  poolBeforeBatch: SettlementPoolReport[];
  batch: SettlementBatchRecord;
  batchItems: SettlementBatchItemRecord[];
  poolAfterBatch: SettlementPoolReport[];
  streamerBill: StreamerEarningsSummary;
  auditActions: string[];
  notifications: NotificationInput[];
};

const organizationId = "org-1";
const projectId = "project-1";
const streamerId = "streamer-1";

export async function runSettlementGoldenPathRegression(): Promise<GoldenPathResult> {
  const repo = new GoldenPathRepository();
  const auditLogs: AuditLogInput[] = [];
  const notifications: NotificationInput[] = [];
  const audit = async (input: AuditLogInput) => {
    auditLogs.push(input);
  };
  const notify = async (input: NotificationInput) => {
    notifications.push(input);
  };

  const opsActor = {
    userId: "user-ops",
    name: "Ops",
    role: "operator_business" as const,
    organizationId,
  };
  const streamerActor = {
    userId: "user-streamer",
    name: "Streamer",
    role: "streamer" as const,
    organizationId,
    streamerId,
  };

  const task = await createLiveTask({
    repo,
    audit,
    notify,
    actor: opsActor,
    input: {
      projectId,
      streamerId,
      title: "Golden path live task",
      plannedStartAt: "2026-06-02T10:00:00.000Z",
      plannedEndAt: "2026-06-02T12:00:00.000Z",
      plannedDuration: 120,
    },
  });

  await startLiveTask({
    repo,
    audit,
    actor: streamerActor,
    taskId: task.id,
    now: "2026-06-02T10:00:00.000Z",
  });
  await stopLiveTask({
    repo,
    audit,
    actor: streamerActor,
    taskId: task.id,
    now: "2026-06-02T12:00:00.000Z",
  });
  const submitted = await submitLiveReport({
    repo,
    audit,
    notify,
    actor: streamerActor,
    taskId: task.id,
    input: {
      screenshotStoragePath: "private/reports/golden/end.png",
      screenshotFileHash: "golden-report-hash",
      screenshotDuration: 124,
      claimedDuration: 124,
      viewers: 1200,
    },
  });
  const report = await reviewLiveReport({
    repo,
    audit,
    notify,
    actor: opsActor,
    reportId: submitted.id,
    input: {
      decision: "approve",
      includeInTaskResult: true,
      enterSettlementPool: true,
      reviewNotes: "Golden path approval",
    },
  });

  const settlementPeriod = {
    projectId,
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
  };
  const poolBeforeBatch = await listSettlementPool({
    repo,
    actor: opsActor,
    ...settlementPeriod,
  });
  const { batch, items: batchItems } = await generateSettlementBatch({
    repo,
    audit,
    notify,
    actor: opsActor,
    input: {
      ...settlementPeriod,
      batchType: "payable",
    },
  });
  const poolAfterBatch = await listSettlementPool({
    repo,
    actor: opsActor,
    ...settlementPeriod,
  });

  const streamerBill = toStreamerEarningsSummary(
    repo.listStreamerPayableSafeRows(streamerId),
    { currentMonth: "2026-06" },
  );
  const finalTask = await repo.getLiveTaskById(task.id);

  return {
    task: finalTask ?? task,
    report,
    poolBeforeBatch,
    batch,
    batchItems,
    poolAfterBatch,
    streamerBill,
    auditActions: auditLogs.map((log) => `${log.objectType}:${log.action}`),
    notifications,
  };
}

class GoldenPathRepository
  implements LiveOperationsRepository, SettlementRepository
{
  private readonly projectStreamer: ProjectStreamerForTask = {
    id: "project-streamer-1",
    projectId,
    streamerId,
    status: "joined",
  };
  private readonly tasks = new Map<string, LiveTaskRecord>();
  private readonly reports = new Map<string, LiveReportRecord>();
  private readonly reportCreatedAt = new Map<string, string>();
  private readonly settledReportItems = new Map<string, string>();
  private readonly batches = new Map<string, SettlementBatchRecord>();
  private readonly items = new Map<string, SettlementBatchItemRecord>();

  async getProjectStreamer(input: {
    projectId: string;
    streamerId: string;
  }): Promise<ProjectStreamerForTask | null> {
    return input.projectId === this.projectStreamer.projectId &&
      input.streamerId === this.projectStreamer.streamerId
      ? this.projectStreamer
      : null;
  }

  async getActiveCollaborationAgreement(): Promise<null> {
    return null;
  }

  async createLiveTask(input: {
    organizationId: string;
    projectId: string;
    streamerId: string;
    title: string;
    plannedStartAt?: string | null;
    plannedEndAt?: string | null;
    plannedDuration?: number | null;
    requiresTiming: boolean;
    createdBy: string;
  }): Promise<LiveTaskRecord> {
    const task: LiveTaskRecord = {
      id: "task-1",
      organizationId: input.organizationId,
      projectId: input.projectId,
      streamerId: input.streamerId,
      title: input.title,
      status: "pending_live",
      taskType: "project",
      plannedStartAt: input.plannedStartAt,
      plannedEndAt: input.plannedEndAt,
      plannedDuration: input.plannedDuration,
      requiresTiming: input.requiresTiming,
      systemStartedAt: null,
      systemStoppedAt: null,
      systemDuration: 0,
      createdBy: input.createdBy,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async getLiveTaskById(taskId: string): Promise<LiveTaskRecord | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async updateLiveTask(
    taskId: string,
    patch: Partial<LiveTaskRecord>,
  ): Promise<LiveTaskRecord> {
    const before = await this.requireTask(taskId);
    const after = { ...before, ...patch };
    this.tasks.set(taskId, after);
    return after;
  }

  async createLiveReport(input: {
    organizationId: string;
    liveTaskId: string;
    projectId: string;
    streamerId: string;
    status: LiveReportRecord["status"];
    systemDuration?: number | null;
    screenshotDuration?: number | null;
    claimedDuration?: number | null;
    settlementDuration: number;
    timeSource: NonNullable<LiveReportRecord["timeSource"]>;
    evidenceLevel: NonNullable<LiveReportRecord["evidenceLevel"]>;
    divergencePct?: number | null;
    viewers?: number | null;
    riskFlags: string[];
  }): Promise<LiveReportRecord> {
    const report: LiveReportRecord = {
      id: "report-1",
      organizationId: input.organizationId,
      liveTaskId: input.liveTaskId,
      projectId: input.projectId,
      streamerId: input.streamerId,
      status: input.status,
      systemDuration: input.systemDuration,
      screenshotDuration: input.screenshotDuration,
      claimedDuration: input.claimedDuration,
      settlementDuration: input.settlementDuration,
      timeSource: input.timeSource,
      evidenceLevel: input.evidenceLevel,
      divergencePct: input.divergencePct,
      viewers: input.viewers,
      includeInTaskResult: true,
      enterSettlementPool: true,
      riskFlags: input.riskFlags,
    };
    this.reports.set(report.id, report);
    this.reportCreatedAt.set(report.id, "2026-06-02T12:10:00.000Z");
    return report;
  }

  async getLiveReportById(reportId: string): Promise<LiveReportRecord | null> {
    return this.reports.get(reportId) ?? null;
  }

  async listLiveReportsByTask(taskId: string): Promise<LiveReportRecord[]> {
    return [...this.reports.values()].filter(
      (report) => report.liveTaskId === taskId,
    );
  }

  async updateLiveReport(
    reportId: string,
    patch: Partial<LiveReportRecord>,
  ): Promise<LiveReportRecord> {
    const before = await this.requireReport(reportId);
    const after = { ...before, ...patch };
    this.reports.set(reportId, after);
    return after;
  }

  async createReportScreenshot(): Promise<string> {
    return "00000000-0000-4000-8000-000000000101";
  }

  async findReportScreenshotByFileHash(): Promise<null> {
    return null;
  }

  async createReportChangeLog(): Promise<void> {}

  async listSettlementPoolReports(input: {
    organizationId: string;
    projectId: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<SettlementPoolReport[]> {
    return Array.from(this.reports.values())
      .filter(
        (report) =>
          report.organizationId === input.organizationId &&
          report.projectId === input.projectId &&
          report.status === "approved" &&
          report.enterSettlementPool &&
          !this.settledReportItems.has(report.id) &&
          report.settlementDuration !== null &&
          this.isReportInPeriod(report.id, input.periodStart, input.periodEnd),
      )
      .map((report) => ({
        id: report.id,
        organizationId: report.organizationId,
        projectId: report.projectId,
        streamerId: report.streamerId,
        liveTaskId: report.liveTaskId,
        status: "approved",
        settlementDuration: report.settlementDuration ?? null,
        timeSource: report.timeSource ?? null,
        evidenceLevel: report.evidenceLevel ?? null,
        settledBatchItemId: this.settledReportItems.get(report.id) ?? null,
        createdAt:
          this.reportCreatedAt.get(report.id) ?? "2026-06-02T12:10:00.000Z",
      }));
  }

  async getSettlementRules(input: {
    projectId: string;
    streamerIds: string[];
  }): Promise<SettlementRuleRecord[]> {
    return input.streamerIds.map((id) => ({
      projectId: input.projectId,
      streamerId: id,
      settlementMethod: "cpt",
      hourlyRate: 80,
      baseSalary: 0,
      cpsRateBps: 0,
    }));
  }

  async getProjectSettlementRule(input: {
    projectId: string;
  }): Promise<ProjectSettlementRuleRecord | null> {
    return {
      projectId: input.projectId,
      settlementMethod: "cpt",
      hourlyRate: 100,
      baseSalary: 0,
      cpsRateBps: 0,
    };
  }

  async createSettlementBatch(input: {
    organizationId: string;
    projectId: string;
    batchType: SettlementBatchRecord["batchType"];
    periodStart: string;
    periodEnd: string;
    computedAmount: number;
    manualAmount: number;
    adjustmentAmount: number;
    evidenceSummary: Record<string, unknown>;
    createdBy: string;
  }): Promise<SettlementBatchRecord> {
    const batch: SettlementBatchRecord = {
      id: "batch-1",
      organizationId: input.organizationId,
      projectId: input.projectId,
      batchType: input.batchType,
      status: "generated",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      computedAmount: input.computedAmount,
      manualAmount: input.manualAmount,
      adjustmentAmount: input.adjustmentAmount,
      evidenceSummary: input.evidenceSummary,
      createdBy: input.createdBy,
      lockReason: null,
      reopenReason: null,
      lockedAt: null,
      createdAt: "2026-06-02T12:20:00.000Z",
      updatedAt: "2026-06-02T12:20:00.000Z",
    };
    this.batches.set(batch.id, batch);
    return batch;
  }

  async createSettlementBatchItem(
    input: Omit<SettlementBatchItemRecord, "id" | "createdAt">,
  ): Promise<SettlementBatchItemRecord> {
    const item: SettlementBatchItemRecord = {
      id: `item-${this.items.size + 1}`,
      ...input,
      createdAt: "2026-06-02T12:21:00.000Z",
    };
    this.items.set(item.id, item);
    return item;
  }

  async createSettlementBatchAtomic(input: {
    organizationId: string;
    projectId: string;
    batchType: SettlementBatchRecord["batchType"];
    periodStart: string;
    periodEnd: string;
    computedAmount: number;
    manualAmount: number;
    adjustmentAmount: number;
    evidenceSummary: Record<string, unknown>;
    createdBy: string;
    items: SettlementBatchAtomicItemInput[];
  }): Promise<{
    batch: SettlementBatchRecord;
    items: SettlementBatchItemRecord[];
  }> {
    const batch = await this.createSettlementBatch({
      organizationId: input.organizationId,
      projectId: input.projectId,
      batchType: input.batchType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      computedAmount: input.computedAmount,
      manualAmount: input.manualAmount,
      adjustmentAmount: input.adjustmentAmount,
      evidenceSummary: input.evidenceSummary,
      createdBy: input.createdBy,
    });
    const items: SettlementBatchItemRecord[] = [];
    for (const item of input.items) {
      const created = await this.createSettlementBatchItem({
        organizationId: input.organizationId,
        settlementBatchId: batch.id,
        projectId: input.projectId,
        streamerId: item.streamerId,
        liveReportId: item.liveReportId,
        itemType: item.itemType,
        computedAmount: item.computedAmount,
        manualAmount: item.manualAmount,
        adjustmentAmount: item.adjustmentAmount,
        evidenceLevel: item.evidenceLevel,
        evidenceSnapshot: item.evidenceSnapshot,
      });
      if (item.liveReportId) {
        await this.markReportSettled({
          reportId: item.liveReportId,
          settlementBatchItemId: created.id,
        });
      }
      items.push(created);
    }
    return { batch, items };
  }

  async markReportSettled(input: {
    reportId: string;
    settlementBatchItemId: string;
  }): Promise<void> {
    this.settledReportItems.set(input.reportId, input.settlementBatchItemId);
  }

  async getSettlementBatchById(
    batchId: string,
  ): Promise<SettlementBatchRecord | null> {
    return this.batches.get(batchId) ?? null;
  }

  async updateSettlementBatch(
    batchId: string,
    patch: Partial<SettlementBatchRecord>,
  ): Promise<SettlementBatchRecord> {
    const before = this.batches.get(batchId);
    if (!before) {
      throw new Error("Settlement batch not found");
    }

    const after = { ...before, ...patch };
    this.batches.set(batchId, after);
    return after;
  }

  async listSettlementBatchItems(
    batchId: string,
  ): Promise<SettlementBatchItemRecord[]> {
    return Array.from(this.items.values()).filter(
      (item) => item.settlementBatchId === batchId,
    );
  }

  async listStreamerUserLinks(input: {
    organizationId: string;
    streamerIds: string[];
  }): Promise<StreamerUserLink[]> {
    return input.streamerIds.map((id) => ({
      streamerId: id,
      userId: `user-${id}`,
      displayName: id,
    }));
  }

  listStreamerPayableSafeRows(streamerId: string): StreamerPayableSafeRow[] {
    return Array.from(this.items.values())
      .filter((item) => {
        const batch = this.batches.get(item.settlementBatchId);
        return item.streamerId === streamerId && batch?.batchType === "payable";
      })
      .map((item) => {
        const batch = this.batches.get(item.settlementBatchId);
        return {
          id: item.id,
          project_name: "Golden Project",
          period_start: batch?.periodStart ?? "2026-06-01",
          period_end: batch?.periodEnd ?? "2026-06-30",
          computed_amount: item.computedAmount,
          manual_amount: item.manualAmount,
          adjustment_amount: item.adjustmentAmount,
          payable_amount:
            item.computedAmount + item.manualAmount + item.adjustmentAmount,
          evidence_level: item.evidenceLevel ?? null,
          evidence_snapshot: item.evidenceSnapshot,
          created_at: item.createdAt ?? "2026-06-02T12:21:00.000Z",
        };
      });
  }

  private async requireTask(taskId: string): Promise<LiveTaskRecord> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Live task not found");
    }
    return task;
  }

  private async requireReport(reportId: string): Promise<LiveReportRecord> {
    const report = this.reports.get(reportId);
    if (!report) {
      throw new Error("Live report not found");
    }
    return report;
  }

  private isReportInPeriod(
    reportId: string,
    periodStart: string,
    periodEnd: string,
  ): boolean {
    const createdAt = this.reportCreatedAt.get(reportId);
    if (!createdAt) {
      return false;
    }

    return (
      createdAt >= `${periodStart}T00:00:00.000Z` &&
      createdAt <= `${periodEnd}T23:59:59.999Z`
    );
  }
}
