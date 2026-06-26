"use client";
/* eslint-disable */
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { toOpsReferenceTask } from "@/features/live-operations/live-ui-adapters";

import {
  PageHeader,
  Sidebar,
  TopBar,
  countActionableReports,
  countActionableTasks,
  countUnreadNotifications,
} from "./chrome";
import { OpsLiveDataContext, PROJECTS, REPORTS, TASKS } from "./data";
import { Icon } from "./icons";
import {
  ScreenAudit,
  ScreenBilling,
  ScreenExport,
  ScreenNotifications,
  ScreenOrg,
} from "./screen-org";
import { ScreenProjects } from "./screen-project";
import {
  ScreenAdmission,
  ScreenReports,
  toReferenceBatchDetailFromApi,
  toReferenceBatchFromApi,
  toReferenceReportFromApi,
  toReferenceSettlementPoolFromApi,
} from "./screen-reports";
import { ScreenSettlement } from "./screen-settlement";
import { ScreenStreamers } from "./screen-streamers";
import { ScreenTasks } from "./screen-tasks";
import { ScreenWarRoom } from "./screen-warroom";
import { Button, Card } from "./ui";

// ——— App entry ————————————————————————————————

function OpsReferenceInner({
  initialRoute = "warroom",
  liveTasks,
  liveReports,
  liveBatches,
  liveBatchDetails,
  liveSettlementPool,
  settlementScope,
  auditEntries,
  notificationItems,
  billingStatus,
  projectCards,
  streamerCards,
  applicationQueue,
}) {
  // route can be: 'warroom' | 'projects' | 'project' | 'streamers' | 'tasks' | 'reports' | 'settle' | 'billing' | 'export' | 'audit' | 'org'
  const [route, setRoute] = React.useState(initialRoute);
  const [projectId, setProjectId] = React.useState(null);
  const [streamerId, setStreamerId] = React.useState(null);
  const [tasksState, setTasksState] = React.useState(liveTasks ?? null);
  const [reportsState, setReportsState] = React.useState(liveReports ?? null);
  const [batchesState, setBatchesState] = React.useState(liveBatches ?? null);
  const [batchDetailsState, setBatchDetailsState] = React.useState(
    liveBatchDetails ?? null,
  );
  const [settlementPoolState, setSettlementPoolState] = React.useState(
    liveSettlementPool ?? null,
  );
  const [auditEntriesState, setAuditEntriesState] = React.useState(
    auditEntries ?? null,
  );
  const [notificationItemsState, setNotificationItemsState] = React.useState(
    notificationItems ?? null,
  );
  const [billingStatusState, setBillingStatusState] = React.useState(
    billingStatus ?? null,
  );
  const [projectsState, setProjectsState] = React.useState(
    projectCards ?? null,
  );
  const [streamersState, setStreamersState] = React.useState(
    streamerCards ?? null,
  );
  const [applicationsState, setApplicationsState] = React.useState(
    applicationQueue ?? null,
  );

  React.useEffect(() => {
    setTasksState(liveTasks ?? null);
  }, [liveTasks]);

  React.useEffect(() => {
    setReportsState(liveReports ?? null);
  }, [liveReports]);

  React.useEffect(() => {
    setBatchesState(liveBatches ?? null);
  }, [liveBatches]);

  React.useEffect(() => {
    setBatchDetailsState(liveBatchDetails ?? null);
  }, [liveBatchDetails]);

  React.useEffect(() => {
    setSettlementPoolState(liveSettlementPool ?? null);
  }, [liveSettlementPool]);

  React.useEffect(() => {
    setAuditEntriesState(auditEntries ?? null);
  }, [auditEntries]);

  React.useEffect(() => {
    setNotificationItemsState(notificationItems ?? null);
  }, [notificationItems]);

  React.useEffect(() => {
    setBillingStatusState(billingStatus ?? null);
  }, [billingStatus]);

  React.useEffect(() => {
    setProjectsState(projectCards ?? null);
  }, [projectCards]);

  React.useEffect(() => {
    setStreamersState(streamerCards ?? null);
  }, [streamerCards]);

  React.useEffect(() => {
    setApplicationsState(applicationQueue ?? null);
  }, [applicationQueue]);

  const actions = React.useMemo(() => {
    const readJson = async (response, fallbackMessage) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || fallbackMessage);
      }
      return body;
    };

    const fetchJson = async (url, fallbackMessage, init) => {
      const response = await fetch(url, init);
      return readJson(response, fallbackMessage);
    };

    const refreshOpsTasks = async () => {
      const body = await fetchJson(
        "/api/live-tasks",
        "refresh live tasks failed",
      );
      if (Array.isArray(body.tasks)) {
        setTasksState(body.tasks.map((task) => toOpsReferenceTask(task)));
      }
    };

    const settlementPoolUrl = (scope) => {
      if (!scope?.projectId || !scope?.periodStart || !scope?.periodEnd) {
        return null;
      }
      const params = new URLSearchParams({
        projectId: scope.projectId,
        periodStart: scope.periodStart,
        periodEnd: scope.periodEnd,
      });
      return `/api/settlement-pool?${params.toString()}`;
    };

    const refreshReports = async () => {
      const body = await fetchJson(
        "/api/live-reports",
        "refresh reports failed",
      );
      if (Array.isArray(body.reports)) {
        setReportsState(body.reports.map(toReferenceReportFromApi));
      }
    };

    const refreshSettlementPool = async (scope = settlementScope) => {
      const url = settlementPoolUrl(scope);
      if (!url) return;
      const body = await fetchJson(url, "refresh settlement pool failed");
      if (Array.isArray(body.reports)) {
        setSettlementPoolState(
          body.reports.map(toReferenceSettlementPoolFromApi),
        );
      }
    };

    const refreshSettlementBatches = async () => {
      const body = await fetchJson(
        "/api/settlement-batches",
        "refresh settlement batches failed",
      );
      if (Array.isArray(body.batches)) {
        setBatchesState(
          body.batches.map((batch) => toReferenceBatchFromApi(batch, [])),
        );
      }
    };

    const refreshSettlementBatchDetail = async (batchId) => {
      const body = await fetchJson(
        `/api/settlement-batches/${batchId}`,
        "refresh settlement batch failed",
      );
      const items = Array.isArray(body.items) ? body.items : [];
      if (body.batch) {
        const batch = toReferenceBatchFromApi(body.batch, items);
        setBatchesState((current) => {
          const base = Array.isArray(current) ? current : [];
          return [batch, ...base.filter((item) => item.id !== batch.id)];
        });
      }
      setBatchDetailsState((current) => ({
        ...(current && typeof current === "object" ? current : {}),
        [batchId]: items.map((item, index) =>
          toReferenceBatchDetailFromApi(item, [], index),
        ),
      }));
    };

    const refreshAuditEntries = async () => {
      const body = await fetchJson(
        "/api/audit-logs?limit=50",
        "refresh audit logs failed",
      );
      if (Array.isArray(body.entries)) {
        setAuditEntriesState(body.entries);
      }
    };

    const refreshNotifications = async () => {
      const body = await fetchJson(
        "/api/notifications",
        "refresh notifications failed",
      );
      if (Array.isArray(body.items)) {
        setNotificationItemsState(body.items);
      }
    };

    const refreshBillingStatus = async () => {
      const body = await fetchJson(
        "/api/billing/status",
        "refresh billing failed",
        {
          method: "GET",
        },
      );
      if (body.billing) {
        setBillingStatusState(body.billing);
      }
      return body.billing;
    };

    const refreshProjects = async () => {
      const body = await fetchJson("/api/projects", "refresh projects failed");
      if (Array.isArray(body.projects)) {
        setProjectsState(body.projects);
      }
    };

    const refreshStreamers = async () => {
      const body = await fetchJson(
        "/api/streamers",
        "refresh streamers failed",
      );
      if (Array.isArray(body.streamers)) {
        setStreamersState(body.streamers);
      }
    };

    const refreshApplications = async () => {
      const body = await fetchJson(
        "/api/applications",
        "refresh applications failed",
      );
      if (Array.isArray(body.applications)) {
        setApplicationsState(body.applications);
      }
    };

    return {
      createProjectDraft: async (input) => {
        const body = await fetchJson("/api/projects", "create project failed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        await refreshProjects();
        return body;
      },
      publishProject: async (id) => {
        const body = await fetchJson(
          `/api/projects/${id}/publish`,
          "publish project failed",
          { method: "POST" },
        );
        await refreshProjects();
        return body;
      },
      createStreamerProfile: async (input) => {
        const body = await fetchJson(
          "/api/streamers",
          "create streamer failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshStreamers();
        return body;
      },
      updateStreamerRisk: async (id, input) => {
        const body = await fetchJson(
          `/api/streamers/${id}/risk`,
          "update streamer risk failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshStreamers();
        return body;
      },
      inviteStreamerToProject: async (projectId, streamerId) => {
        return fetchJson(
          `/api/projects/${projectId}/invitations`,
          "invite streamer failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ streamerId }),
          },
        );
      },
      reviewApplicationRecording: async (id, input) => {
        const body = await fetchJson(
          `/api/applications/${id}/review`,
          "review application recording failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshApplications();
        return body;
      },
      confirmApplicationJoin: async (id) => {
        const body = await fetchJson(
          `/api/applications/${id}/confirm-join`,
          "confirm application join failed",
          { method: "POST" },
        );
        await refreshApplications();
        return body;
      },
      createLiveTask: async (input) => {
        const body = await fetchJson(
          "/api/live-tasks",
          "create live task failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshOpsTasks();
        return body;
      },
      createLiveTasks: async (input) => {
        const body = await fetchJson(
          "/api/live-tasks/batch",
          "create live tasks failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshOpsTasks();
        return body;
      },
      cancelLiveTask: async (id, input) => {
        const body = await fetchJson(
          `/api/live-tasks/${id}/cancel`,
          "cancel live task failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input ?? {}),
          },
        );
        await refreshOpsTasks();
        return body;
      },
      reviewReport: async (id, decision) => {
        await fetchJson(
          `/api/live-reports/${id}/review`,
          "review report failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              decision,
              includeInTaskResult: true,
              enterSettlementPool: true,
              reviewNotes: "经营端页面审核",
            }),
          },
        );
        await refreshReports();
        await refreshSettlementPool();
      },
      createSettlementBatch: async (input) => {
        const body = await fetchJson(
          "/api/settlement-batches",
          "create settlement batch failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshSettlementBatches();
        if (body.batch?.id) {
          await refreshSettlementBatchDetail(body.batch.id);
        }
        await refreshSettlementPool({
          projectId: input.projectId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        });
        return body;
      },
      addManualSettlementItem: async (batchId, input) => {
        await fetchJson(
          `/api/settlement-batches/${batchId}/manual-items`,
          "add manual settlement item failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshSettlementBatchDetail(batchId);
        await refreshSettlementBatches();
      },
      lockSettlementBatch: async (batchId, input) => {
        await fetchJson(
          `/api/settlement-batches/${batchId}/lock`,
          "lock settlement batch failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshSettlementBatchDetail(batchId);
        await refreshSettlementBatches();
      },
      reopenSettlementBatch: async (batchId, input) => {
        await fetchJson(
          `/api/settlement-batches/${batchId}/reopen`,
          "reopen settlement batch failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshSettlementBatchDetail(batchId);
        await refreshSettlementBatches();
      },
      refreshAuditEntries,
      refreshNotifications,
      refreshBillingStatus,
      updateNotificationStatus: async (id, action) => {
        await fetchJson(
          `/api/notifications/${id}`,
          "update notification failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          },
        );
        await refreshNotifications();
      },
      createGovernedExport: async (input) => {
        const body = await fetchJson("/api/exports", "create export failed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        return body.export;
      },
    };
  }, [settlementScope]);

  const go = (r, arg) => {
    if (r === "project") {
      setRoute("project");
      setProjectId(arg || null);
    } else if (r === "streamers") {
      setRoute("streamers");
      if (arg) setStreamerId(arg);
    } else {
      setRoute(r);
      if (r === "projects") setProjectId(null);
    }
    // Scroll content to top
    const content = globalThis.document?.getElementById("content-scroll");
    if (content) content.scrollTop = 0;
  };

  // Breadcrumbs per route
  const crumbs = (() => {
    switch (route) {
      case "warroom":
        return ["工作台", "智能作战台"];
      case "projects":
        return ["项目管理", "全部项目"];
      case "project":
        return [
          "项目管理",
          PROJECTS.find((p) => p.id === projectId)?.name || "项目详情",
        ];
      case "streamers":
        return ["资源", "主播资源池"];
      case "admission":
        return ["项目", "选播准入"];
      case "tasks":
        return ["执行", "排班与任务"];
      case "reports":
        return ["执行", "报数审核"];
      case "settle":
        return ["财务", "结算中心"];
      case "billing":
        return ["财务", "商业化与套餐"];
      case "export":
        return ["运营", "数据导出"];
      case "audit":
        return ["治理", "操作日志"];
      case "notifications":
        return ["治理", "通知待办"];
      case "org":
        return ["设置", "组织与权限"];
      default:
        return ["工作台"];
    }
  })();

  const navKey = route === "project" ? "projects" : route;
  const navCounts = {
    tasks: countActionableTasks(Array.isArray(tasksState) ? tasksState : TASKS),
    reports: countActionableReports(
      Array.isArray(reportsState) ? reportsState : REPORTS,
    ),
  };
  const unreadNotificationCount = countUnreadNotifications(
    Array.isArray(notificationItemsState) ? notificationItemsState : [],
  );

  return (
    <OpsLiveDataContext.Provider
      value={{
        projects: projectsState,
        streamers: streamersState,
        applications: applicationsState,
        tasks: tasksState,
        reports: reportsState,
        batches: batchesState,
        batchDetails: batchDetailsState,
        settlementPool: settlementPoolState,
        settlementScope,
        auditEntries: auditEntriesState,
        notificationItems: notificationItemsState,
        actions,
      }}
    >
      <div
        style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}
      >
        <Sidebar route={navKey} onNav={go} navCounts={navCounts} />
        <main
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            maxHeight: "100vh",
          }}
        >
          <TopBar
            breadcrumbs={crumbs}
            notificationCount={unreadNotificationCount}
          />
          <div id="content-scroll" style={{ flex: 1, overflowY: "auto" }}>
            {route === "warroom" && <ScreenWarRoom go={go} />}
            {(route === "projects" || route === "project") && (
              <ScreenProjects go={go} projectId={projectId} />
            )}
            {route === "streamers" && (
              <ScreenStreamers go={go} initialActiveId={streamerId} />
            )}
            {route === "admission" && <ScreenAdmission go={go} />}
            {route === "tasks" && <ScreenTasks go={go} />}
            {route === "reports" && <ScreenReports go={go} />}
            {route === "settle" && <ScreenSettlement go={go} />}
            {route === "billing" && (
              <ScreenBilling
                billingStatus={billingStatusState}
                onRefresh={actions.refreshBillingStatus}
              />
            )}
            {route === "audit" && <ScreenAudit go={go} />}
            {route === "notifications" && <ScreenNotifications go={go} />}
            {route === "org" && <ScreenOrg go={go} />}
            {route === "export" && <ScreenExport go={go} />}
          </div>
        </main>
      </div>
    </OpsLiveDataContext.Provider>
  );
}

function PlaceholderScreen({ route, go }) {
  const [placeholderMessage, setPlaceholderMessage] = React.useState("");
  const map = {
    tasks: {
      title: "排班与任务",
      desc: "项目维度排班看板 + 任务表格 · 第一版支持单日与多日重复批量排班 · 主播端有「我的任务」",
      icon: "Tasks",
    },
    export: {
      title: "数据导出中心",
      desc: "厂家候选主播表 / 项目执行表 / 报数明细 / 结算批次 / 审计日志，统一权限、字段、脱敏与日志",
      icon: "Export",
    },
    audit: {
      title: "操作日志 & 审计",
      desc: "差异日志 + 高风险原因 + 轻量审计中心 + 高风险站内提醒",
      icon: "Audit",
    },
    org: {
      title: "组织与权限",
      desc: "角色与字段级权限 · 主播敏感字段隔离 · AI 查询继承权限",
      icon: "Settings",
    },
  };
  const m = map[route] || map.tasks;
  const IconComp = Icon[m.icon];

  return (
    <>
      <PageHeader title={m.title} subtitle={m.desc} />
      <div style={{ padding: 32 }}>
        <Card padded={true}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "32px 16px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 14,
                background: "var(--blue-50)",
                color: "var(--blue-700)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 14,
              }}
            >
              <IconComp size={28} stroke="var(--blue-700)" />
            </div>
            <div
              style={{ fontSize: 17, fontWeight: 600, color: "var(--ink-900)" }}
            >
              {m.title}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-400)",
                marginTop: 6,
                maxWidth: 520,
              }}
            >
              {m.desc}
            </div>

            <div
              style={{
                marginTop: 22,
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 12,
                maxWidth: 720,
                width: "100%",
              }}
            >
              {modulePreview(route).map((b, i) => (
                <div
                  key={i}
                  style={{
                    padding: 14,
                    background: "var(--bg-soft)",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--ink-900)",
                    }}
                  >
                    {b.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-400)",
                      marginTop: 4,
                    }}
                  >
                    {b.desc}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 22, display: "flex", gap: 8 }}>
              <Button kind="default" onClick={() => go("warroom")}>
                返回作战台
              </Button>
              <Button
                kind="primary"
                onClick={() =>
                  setPlaceholderMessage("产品设计详情页暂未接入。")
                }
              >
                查看产品设计 →
              </Button>
            </div>
            {placeholderMessage ? (
              <div
                aria-live="polite"
                style={{
                  marginTop: 12,
                  fontSize: 12,
                  color: "var(--ink-500)",
                }}
              >
                {placeholderMessage}
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}

function modulePreview(route) {
  return (
    {
      tasks: [
        {
          title: "项目排班看板",
          desc: "横向时间轴 / 纵向主播 · 拖拽创建与冲突检测",
        },
        {
          title: "批量排班",
          desc: "单日批量 + 多日重复 · 后续支持 Excel 导入",
        },
        {
          title: "异常任务列表",
          desc: "未开播 / 未报数 / 超 48h 未停止 / 报数逾期等",
        },
      ],
      export: [
        {
          title: "厂家候选主播表",
          desc: "录屏审核后导出给厂家，自动脱敏价格与毛利",
        },
        { title: "项目执行表", desc: "任务、报数、审核进度的统一对账" },
        { title: "导出日志 & 高风险提醒", desc: "财务表格导出触发负责人提醒" },
      ],
      audit: [
        { title: "差异日志", desc: "记录 before / after 与变更字段" },
        { title: "高风险原因", desc: "修改金额、解锁批次、拉黑主播必须填原因" },
        { title: "审计中心", desc: "按角色 / 模块 / 项目过滤，可签名导出" },
      ],
      org: [
        {
          title: "角色权限矩阵",
          desc: "负责人 / 运营负责人 / 次级运营 / 财务 / 主播",
        },
        { title: "字段级脱敏", desc: "主播端不返回毛利、价格、其他主播结算" },
        {
          title: "AI 工具权限继承",
          desc: "AI 查询走安全工具层，与用户身份绑定",
        },
      ],
    }[route] || []
  );
}

// Mount

/**
 * @param {{ initialRoute?: string; projectCards?: any[]; streamerCards?: any[]; applicationQueue?: any[]; liveTasks?: any[]; liveReports?: any[]; liveBatches?: any[]; liveBatchDetails?: Record<string, any[]>; liveSettlementPool?: any[]; settlementScope?: any; auditEntries?: any[]; notificationItems?: any[]; billingStatus?: any }} props
 */
export default function OpsReferenceApp({
  initialRoute = "warroom",
  liveTasks,
  liveReports,
  liveBatches,
  liveBatchDetails,
  liveSettlementPool,
  settlementScope,
  auditEntries,
  notificationItems,
  billingStatus,
  projectCards,
  streamerCards,
  applicationQueue,
}) {
  return (
    <OpsReferenceInner
      initialRoute={initialRoute}
      liveTasks={liveTasks}
      liveReports={liveReports}
      liveBatches={liveBatches}
      liveBatchDetails={liveBatchDetails}
      liveSettlementPool={liveSettlementPool}
      settlementScope={settlementScope}
      auditEntries={auditEntries}
      notificationItems={notificationItems}
      billingStatus={billingStatus}
      projectCards={projectCards}
      streamerCards={streamerCards}
      applicationQueue={applicationQueue}
    />
  );
}
