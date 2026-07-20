import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OpsApplicationQueueItem } from "@/features/applications/application-queries";
import type { ProjectCardDto } from "@/features/projects/project-ui-dto";

import { ConsoleProjectsWorkbench } from "./projects-workbench";

const ownedProject: ProjectCardDto = {
  id: "project-owned",
  code: "P-001",
  name: "星耀首发项目",
  agent: "星耀传媒",
  supplier: "星耀传媒",
  vendor: "厂商 A",
  product: "新游 A",
  status: "active",
  statusLabel: "进行中",
  hourlyRateLabel: "120.00 元/小时",
  timingLabel: "系统计时",
  publishedAtLabel: "2026-07-01",
  pricing: "CPT",
  defaultSettlementMethod: "cpt",
  defaultHourlyRate: 12000,
  defaultBaseSalary: 0,
  defaultSettlementRule: {},
  isInvoiced: false,
  outputVatRateBps: 0,
  surtaxRateBps: 0,
  procurementCostCents: 0,
  description: "暑期重点项目",
  isPublicToStreamers: true,
  publicSummary: "公开招募",
  gameDownloadUrl: null,
  isOpenToMcnCollaboration: true,
  mcnCollaborationSummary: "开放协作",
  mcnCollaborationTerms: {},
  ownerId: "user-owner",
  leadOps: "李运营",
  bizOwner: "未分配",
  start: "2026-07-01",
  end: "2026-07-31",
  openSignup: true,
  allowDirectInvite: true,
  needScreening: true,
  needStartStop: true,
  streamers: { active: 8, candidate: 3, pendingReview: 2 },
  metrics: {
    plannedHours: 240,
    doneHours: 96,
    audience: 0,
    reportedPending: 4,
    anomalies: 1,
    receivable: 0,
    payable: 0,
    gross: 0,
    margin: 0,
  },
  risk: "medium",
};

const collabProject: ProjectCardDto = {
  ...ownedProject,
  id: "project-collab",
  code: "C-002",
  name: "外部协作项目",
  vendor: "合作方 B",
  supplier: "合作方 B",
  status: "recruiting",
  statusLabel: "招募中",
  leadOps: "合作方 B",
  collaborationRole: "partner",
  ownerOrganizationName: "合作方 B",
  streamers: { active: 0, candidate: 0, pendingReview: 0 },
  metrics: {
    ...ownedProject.metrics,
    plannedHours: 80,
    doneHours: 0,
    reportedPending: 0,
    anomalies: 0,
  },
  risk: "low",
};

const applicationQueue: OpsApplicationQueueItem[] = [
  {
    id: "application-1",
    source: "signup",
    status: "submitted",
    submittedAt: "2026-07-19T10:00:00.000Z",
    decisionReason: null,
    project: { id: "project-owned", code: "P-001", name: "星耀首发项目" },
    streamer: {
      id: "streamer-1",
      displayName: "主播一号",
      cooperationStatus: "new",
      riskLevel: "medium",
    },
    latestRecording: {
      id: "recording-1",
      assetId: "asset-1",
      version: 2,
      status: "reviewing",
      durationSeconds: 3600,
      externalUrl: null,
      hasPrivateStorage: true,
      createdAt: "2026-07-19T11:00:00.000Z",
      aiAnalysis: null,
    },
  },
];

describe("ConsoleProjectsWorkbench", () => {
  it("renders owned, collaboration, and admission queue context", () => {
    render(
      <ConsoleProjectsWorkbench
        currentUser={{ id: "user-owner", name: "Owner User", role: "owner" }}
        projectCards={[ownedProject]}
        collaborationProjectCards={[collabProject]}
        applicationQueue={applicationQueue}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "M1 项目管理" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Owner User")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText("星耀首发项目").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText("外部协作项目")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "星耀首发项目" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("详情待迁移")).toHaveLength(2);
    expect(screen.getByText("主播一号")).toBeInTheDocument();
    expect(screen.getByText("v2 · reviewing")).toBeInTheDocument();
  });

  it("filters the project list by source and search text", () => {
    render(
      <ConsoleProjectsWorkbench
        currentUser={{ id: "user-owner", name: "Owner User", role: "owner" }}
        projectCards={[ownedProject]}
        collaborationProjectCards={[collabProject]}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "协作" }));

    expect(screen.queryByText("星耀首发项目")).not.toBeInTheDocument();
    expect(screen.getByText("外部协作项目")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜索项目"), {
      target: { value: "星耀" },
    });

    expect(screen.getByText("没有匹配的项目")).toBeInTheDocument();
  });

  it("shows a compact empty state when no projects exist", () => {
    render(
      <ConsoleProjectsWorkbench
        currentUser={{ id: "user-owner", name: "Owner User", role: "owner" }}
        projectCards={[]}
        collaborationProjectCards={[]}
        applicationQueue={[]}
      />,
    );

    const emptyState = screen.getByTestId("projects-empty-state");
    expect(within(emptyState).getByText("暂无项目")).toBeInTheDocument();
    expect(screen.getByText("暂无待处理准入")).toBeInTheDocument();
  });
});
