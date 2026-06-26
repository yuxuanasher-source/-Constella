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

import { PageHeader } from "./chrome";
import {
  PROJECTS,
  REPORTS,
  REPORT_STATUS,
  STREAMERS,
  useOpsApplications,
  useOpsLiveActions,
  useOpsReports,
} from "./data";
import { Icon } from "./icons";
import { EmptyHint } from "./screen-project";
import {
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  KV,
  SearchInput,
  Tabs,
} from "./ui";

// ——— Screen: 报数审核 ————————————————————————————

function ScreenReports({ go }) {
  const reports = useOpsReports();
  const actions = useOpsLiveActions();
  const [filter, setFilter] = React.useState("pending_review");
  const [activeId, setActiveId] = React.useState(reports[0]?.id ?? null);
  const [exportMessage, setExportMessage] = React.useState("");
  const [exportSubmitting, setExportSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (
      reports.length > 0 &&
      !reports.some((report) => report.id === activeId)
    ) {
      setActiveId(reports[0].id);
    }
  }, [activeId, reports]);

  const counts = {
    all: reports.length,
    pending_review: reports.filter((r) => r.status === "pending_review").length,
    need_supply: reports.filter((r) => r.status === "need_supply").length,
    approved: reports.filter((r) => r.status === "approved").length,
    rejected: reports.filter((r) => r.status === "rejected").length,
  };
  const filtered =
    filter === "all" ? reports : reports.filter((r) => r.status === filter);
  const exportReportDetails = async () => {
    setExportSubmitting(true);
    setExportMessage("");
    try {
      await actions.createGovernedExport?.({
        kind: "report_details",
        rows: filtered.map((report) => ({
          streamerName: report.streamer,
          settlementDuration: report.duration,
          evidenceLevel: `${report.source} · ${report.status}`,
        })),
      });
      setExportMessage("报数明细导出已生成");
    } catch (error) {
      setExportMessage(error?.message || "报数明细导出失败，请稍后重试");
    } finally {
      setExportSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="下播截图报数 · 审核"
        subtitle="一条任务可能对应多条报数。审核通过的报数将进入可结算池，但不自动生成结算。"
        actions={
          <>
            <Button
              kind="default"
              icon={<Icon.Export size={14} />}
              onClick={exportReportDetails}
              disabled={exportSubmitting}
            >
              {exportSubmitting ? "导出中" : "导出报数明细"}
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Check size={14} stroke="#fff" />}
              onClick={() => setExportMessage("批量审核后台暂未接入")}
            >
              批量审核通过
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 20,
          display: "grid",
          gridTemplateColumns: "1.35fr 1fr",
          gap: 20,
          alignItems: "flex-start",
        }}
      >
        {exportMessage ? (
          <div
            aria-live="polite"
            style={{
              gridColumn: "1 / -1",
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
              color: exportMessage.includes("失败")
                ? "var(--danger-600)"
                : "var(--ink-700)",
              fontSize: 12,
            }}
          >
            {exportMessage}
          </div>
        ) : null}
        <Card padded={false}>
          <div
            style={{ padding: "0 12px", borderBottom: "1px solid var(--line)" }}
          >
            <Tabs
              value={filter}
              onChange={setFilter}
              items={[
                {
                  key: "pending_review",
                  label: "待审核",
                  count: counts.pending_review,
                },
                {
                  key: "need_supply",
                  label: "需补充",
                  count: counts.need_supply,
                },
                { key: "approved", label: "已通过", count: counts.approved },
                { key: "rejected", label: "已驳回", count: counts.rejected },
                { key: "all", label: "全部", count: counts.all },
              ]}
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <SearchInput placeholder="任务号 / 主播 / 项目" width={220} />
            <Button kind="default" icon={<Icon.Calendar size={14} />}>
              日期：近 7 天
            </Button>
            <Button kind="default" icon={<Icon.Filter size={14} />}>
              项目
            </Button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
              OCR 与手动偏差自动标红
            </span>
          </div>

          <DataTable
            activeRowId={activeId}
            onRowClick={(r) => setActiveId(r.id)}
            columns={[
              {
                title: "报数 / 任务",
                render: (r) => (
                  <div>
                    <div
                      className="mono"
                      style={{
                        fontWeight: 600,
                        color: "var(--ink-900)",
                        fontSize: 12.5,
                      }}
                    >
                      {r.id}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {r.taskId}
                    </div>
                  </div>
                ),
              },
              {
                title: "主播 · 项目",
                render: (r) => (
                  <div>
                    <div style={{ color: "var(--ink-900)", fontWeight: 500 }}>
                      {r.streamer}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {r.project}
                    </div>
                  </div>
                ),
              },
              {
                title: "日期",
                render: (r) => (
                  <span className="num" style={{ fontSize: 12 }}>
                    {r.date}
                  </span>
                ),
              },
              {
                title: "时长",
                align: "right",
                render: (r) => (
                  <span className="num" style={{ fontWeight: 600 }}>
                    {r.duration.toFixed(1)} h
                  </span>
                ),
              },
              {
                title: "场观",
                align: "right",
                render: (r) => (
                  <span className="num">{r.audience.toLocaleString()}</span>
                ),
              },
              {
                title: "截图",
                align: "center",
                render: (r) => (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      color: "var(--ink-500)",
                    }}
                  >
                    <Icon.Reports size={12} stroke="var(--ink-400)" />
                    {r.screens}
                  </span>
                ),
              },
              {
                title: "来源",
                render: (r) => (
                  <Badge tone={r.source === "OCR" ? "violet" : "neutral"}>
                    {r.source === "OCR" ? "OCR 识别" : "手动"}
                  </Badge>
                ),
              },
              {
                title: "状态",
                render: (r) => (
                  <Badge tone={REPORT_STATUS[r.status].tone} dot>
                    {REPORT_STATUS[r.status].label}
                  </Badge>
                ),
              },
            ]}
            rows={filtered}
          />
        </Card>

        {/* Detail */}
        <ReportDetail id={activeId} reports={reports} />
      </div>
    </>
  );
}

function ReportDetail({ id, reports }) {
  const actions = useOpsLiveActions();
  const [busyDecision, setBusyDecision] = React.useState(null);
  const r = reports.find((x) => x.id === id) || reports[0] || REPORTS[0];
  if (!r) {
    return (
      <div
        style={{
          position: "sticky",
          top: 76,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <Card>
          <EmptyHint
            title="暂无报数数据"
            hint="报数审核记录会在后端返回后展示。"
          />
        </Card>
      </div>
    );
  }

  const s = STREAMERS.find((s) => s.alias === r.streamer);
  const p = PROJECTS.find((p) => p.id === r.project);
  const projectName = p?.name || r.project;

  const review = async (decision) => {
    if (!actions.reviewReport) return;
    setBusyDecision(decision);
    try {
      await actions.reviewReport(r.id, decision);
    } finally {
      setBusyDecision(null);
    }
  };

  // OCR-vs-manual side-by-side
  const ocrFields = [
    { label: "直播日期", ocr: r.date, manual: r.date, diff: false },
    {
      label: "直播时长",
      ocr: (r.duration + 0.3).toFixed(1) + " h",
      manual: r.duration.toFixed(1) + " h",
      diff: true,
    },
    {
      label: "场观",
      ocr: (r.audience + 240).toLocaleString(),
      manual: r.audience.toLocaleString(),
      diff: true,
    },
    {
      label: "直播账号",
      ocr: "live_account",
      manual: "live_account",
      diff: false,
    },
  ];

  return (
    <div
      style={{
        position: "sticky",
        top: 76,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <Card padded={false}>
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-400)" }}
            >
              {r.id} · 任务 {r.taskId}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--ink-900)",
                marginTop: 2,
              }}
            >
              {r.streamer} · {projectName}
            </div>
          </div>
          <Badge tone={REPORT_STATUS[r.status].tone} dot>
            {REPORT_STATUS[r.status].label}
          </Badge>
        </div>

        {/* Screenshot preview */}
        <div style={{ padding: 16 }}>
          <ScreenshotPreview
            platform={s?.platforms?.[0] || "抖音"}
            streamer={r.streamer}
            date={r.date}
            duration={r.duration}
            audience={r.audience}
          />
        </div>

        {/* OCR vs Manual */}
        <div style={{ padding: "0 16px 16px" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ink-700)",
              margin: "0 0 8px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            OCR 识别 vs 主播确认
            <Badge tone="violet" dot>
              差异 2 项
            </Badge>
          </div>
          <table
            style={{
              width: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
              border: "1px solid var(--line)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <thead>
              <tr style={{ background: "var(--bg-soft)" }}>
                <th
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--ink-400)",
                  }}
                >
                  字段
                </th>
                <th
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--ink-400)",
                  }}
                >
                  OCR 原始
                </th>
                <th
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--ink-400)",
                  }}
                >
                  主播确认
                </th>
              </tr>
            </thead>
            <tbody>
              {ocrFields.map((f, i) => (
                <tr
                  key={f.label}
                  style={{ background: f.diff ? "#FEF7E6" : "#fff" }}
                >
                  <td
                    style={{
                      padding: "9px 12px",
                      fontSize: 12,
                      color: "var(--ink-500)",
                      borderTop: i ? "1px solid var(--line)" : "none",
                    }}
                  >
                    {f.label}
                  </td>
                  <td
                    className="num"
                    style={{
                      padding: "9px 12px",
                      fontSize: 12.5,
                      color: f.diff ? "var(--warn-600)" : "var(--ink-700)",
                      borderTop: i ? "1px solid var(--line)" : "none",
                      textDecoration: f.diff ? "line-through" : "none",
                    }}
                  >
                    {f.ocr}
                  </td>
                  <td
                    className="num"
                    style={{
                      padding: "9px 12px",
                      fontSize: 12.5,
                      fontWeight: f.diff ? 600 : 500,
                      color: "var(--ink-900)",
                      borderTop: i ? "1px solid var(--line)" : "none",
                    }}
                  >
                    {f.manual}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: "0 16px 16px" }}>
          <KV label="主播备注">
            {r.note || <span style={{ color: "var(--ink-300)" }}>—</span>}
          </KV>
          <KV label="风控提示">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--ok-600)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon.Check size={12} stroke="var(--ok-600)" />
                图片哈希无重复
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--warn-600)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon.Warn size={12} stroke="var(--warn-600)" />
                时长字段偏差 8.6%，已标记复核
              </span>
            </div>
          </KV>
        </div>

        {/* Action bar */}
        <div
          style={{
            padding: 12,
            borderTop: "1px solid var(--line)",
            background: "var(--bg-soft)",
            display: "flex",
            gap: 8,
          }}
        >
          <Button
            kind="danger"
            icon={<Icon.X size={14} />}
            disabled={Boolean(busyDecision)}
            onClick={() => review("reject")}
          >
            {busyDecision === "reject" ? "处理中…" : "驳回"}
          </Button>
          <Button
            kind="default"
            disabled={Boolean(busyDecision)}
            onClick={() => review("need_more")}
          >
            {busyDecision === "need_more" ? "处理中…" : "需补充截图"}
          </Button>
          <div style={{ flex: 1 }} />
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--ink-500)",
            }}
          >
            <input
              type="checkbox"
              defaultChecked
              style={{ accentColor: "var(--blue-600)" }}
            />{" "}
            计入任务结果
          </label>
          <Button
            kind="primary"
            icon={<Icon.Check size={14} stroke="#fff" />}
            disabled={Boolean(busyDecision)}
            onClick={() => review("approve")}
          >
            {busyDecision === "approve" ? "处理中…" : "审核通过"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// Faux screenshot — stylized 抖音/B 站 后台截图样式 (subtle, not real branding)
function ScreenshotPreview({ platform, streamer, date, duration, audience }) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 10,
        overflow: "hidden",
        background: "#0E1530",
        position: "relative",
        aspectRatio: "16 / 9",
      }}
    >
      {/* Phone-like overlay panel */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          right: 12,
          bottom: 12,
          background:
            "linear-gradient(180deg, rgba(20,25,55,0.85), rgba(8,12,30,0.9))",
          border: "1px solid #233063",
          borderRadius: 8,
          padding: 14,
          color: "#E5EAF6",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontFamily: '"IBM Plex Sans", "PingFang SC", sans-serif',
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "#3B6BE6",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 11,
              color: "#fff",
            }}
          >
            L
          </span>
          <span style={{ fontSize: 11.5, color: "#B8C2DB" }}>
            {platform} · 直播后台 · 数据概览
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: "#7C8AB0" }}>{date}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>本场直播已结束</div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
          }}
        >
          <ShotMetric label="直播时长" value={`${duration.toFixed(1)} h`} />
          <ShotMetric label="累计场观" value={audience.toLocaleString()} />
          <ShotMetric
            label="平均同时"
            value={((audience / (duration * 60)) * 8).toFixed(0)}
          />
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 10.5,
            color: "#7C8AB0",
          }}
        >
          <Icon.History size={11} stroke="#7C8AB0" />
          {streamer} · 截图时间 {date} 22:48:21
        </div>
      </div>

      {/* watermark */}
      <div
        style={{
          position: "absolute",
          right: 18,
          bottom: 18,
          fontSize: 10,
          color: "rgba(255,255,255,0.16)",
          fontFamily: "IBM Plex Mono, monospace",
          letterSpacing: "0.1em",
        }}
      >
        SHA · 8A2E…F19C
      </div>
    </div>
  );
}

function ShotMetric({ label, value }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 6,
        padding: "8px 10px",
      }}
    >
      <div style={{ fontSize: 10, color: "#7C8AB0" }}>{label}</div>
      <div
        className="num"
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: "#fff",
          marginTop: 2,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ScreenAdmission() {
  const applications = useOpsApplications();
  const actions = useOpsLiveActions();
  const review = async (applicationId, decision) => {
    await actions.reviewApplicationRecording?.(applicationId, {
      decision,
      note: "经营端选播准入审核",
    });
  };

  return (
    <>
      <PageHeader
        title="选播准入"
        subtitle="主播报名 → 试播录屏 → 运营审核 → 二次确认加入项目"
      />
      <div style={{ padding: 20 }}>
        <Card padded={false}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <SearchInput placeholder="项目 / 主播 / 报名编号" width={260} />
            <Badge tone="blue">{applications.length} 条准入记录</Badge>
          </div>
          <DataTable
            rows={applications}
            columns={[
              {
                title: "报名编号",
                render: (r) => (
                  <span className="mono" style={{ fontSize: 12 }}>
                    {r.id}
                  </span>
                ),
              },
              {
                title: "项目",
                render: (r) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{r.project?.name}</div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {r.project?.code}
                    </div>
                  </div>
                ),
              },
              {
                title: "主播",
                render: (r) => (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <Avatar name={r.streamer?.displayName} size={24} />
                    <span>{r.streamer?.displayName}</span>
                  </div>
                ),
              },
              {
                title: "录屏",
                render: (r) => (
                  <div>
                    <Badge tone={r.latestRecording ? "violet" : "amber"}>
                      {r.latestRecording ? r.latestRecording.status : "待上传"}
                    </Badge>
                    <div
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: "var(--ink-400)",
                        marginTop: 4,
                      }}
                    >
                      {r.latestRecording?.id ?? "暂无录屏"}
                    </div>
                  </div>
                ),
              },
              {
                title: "状态",
                render: (r) => <Badge tone="neutral">{r.status}</Badge>,
              },
              {
                title: "操作",
                render: (r) => (
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button
                      size="sm"
                      kind="default"
                      onClick={() => review(r.id, "needs_changes")}
                    >
                      需补充
                    </Button>
                    <Button
                      size="sm"
                      kind="default"
                      onClick={() => review(r.id, "rejected")}
                    >
                      驳回
                    </Button>
                    <Button
                      size="sm"
                      kind="primary"
                      onClick={() => review(r.id, "approved")}
                    >
                      通过
                    </Button>
                    <Button
                      size="sm"
                      kind="default"
                      onClick={() => actions.confirmApplicationJoin?.(r.id)}
                    >
                      二次确认
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

function askText(label, defaultValue = "") {
  const value = globalThis.prompt?.(label, defaultValue);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatOpsMinute(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "刚刚";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).formatToParts(date);
  const byType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}`;
}

function numberFromSnapshot(snapshot, key) {
  const value = snapshot && typeof snapshot === "object" ? snapshot[key] : null;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textFromSnapshot(snapshot, key, fallback = "unknown") {
  const value = snapshot && typeof snapshot === "object" ? snapshot[key] : null;
  return typeof value === "string" && value.trim() ? value : fallback;
}

function toReferenceReportFromApi(report) {
  return {
    id: report.id,
    date: String(report.submittedAt || "").slice(0, 10),
    streamer: report.streamerName || "Unknown streamer",
    streamerId: report.streamerName || "Unknown streamer",
    project: report.projectName || "Unknown project",
    taskId: report.taskTitle || "Unknown task",
    duration: Math.round(((report.settlementDuration ?? 0) / 60) * 10) / 10,
    audience: report.viewers ?? 0,
    status:
      report.status === "need_more"
        ? "need_supply"
        : report.status || "pending_review",
    screens: 1,
    source: report.timeSource === "claimed" ? "manual" : "OCR",
    note: `${report.timeSource ?? "unknown"} · ${report.evidenceLevel ?? "unknown"}`,
  };
}

function toReferenceBatchFromApi(batch, items, context = {}) {
  const isPayable = batch.batchType === "payable";
  const projectName =
    batch.projectName ||
    context.pool?.find((row) => row.project)?.project ||
    context.activeBatch?.project ||
    batch.projectId ||
    "项目";
  const amount =
    Number(batch.totalAmount ?? 0) ||
    Number(batch.computedAmount ?? 0) +
      Number(batch.manualAmount ?? 0) +
      Number(batch.adjustmentAmount ?? 0);

  return {
    id: batch.id,
    projectId: batch.projectId,
    type: isPayable ? "streamer_payable" : "vendor_receivable",
    name: `${projectName} · ${isPayable ? "主播应付" : "厂家应收"}`,
    project: projectName,
    vendor: isPayable ? "—" : projectName,
    period: `${batch.periodStart} → ${batch.periodEnd}`,
    items:
      typeof batch.itemCount === "number"
        ? batch.itemCount
        : Array.isArray(items)
          ? items.length
          : 0,
    amount,
    status:
      batch.status === "pending"
        ? "pending_confirm"
        : batch.status || "generated",
    updated: formatOpsMinute(batch.updatedAt || batch.createdAt),
    creator: batch.createdBy || "system",
  };
}

function toReferenceBatchDetailFromApi(item, pool = [], index = 0) {
  const snapshot = item.evidenceSnapshot || {};
  const settlementDuration =
    typeof item.settlementDuration === "number"
      ? item.settlementDuration
      : numberFromSnapshot(snapshot, "settlementDuration");
  const settlementMethod = textFromSnapshot(
    snapshot,
    "settlementMethod",
    item.itemType,
  );
  const timeSource =
    item.timeSource || textFromSnapshot(snapshot, "timeSource");
  const sourceReport = pool.find((row) => row.id === item.liveReportId);
  const computedAmount = Number(item.systemAmount ?? item.computedAmount ?? 0);
  const manualAmount = Number(item.manualAmount ?? 0);
  const adjustmentAmount = Number(item.adjustmentAmount ?? 0);
  const total =
    Number(item.totalAmount ?? 0) ||
    computedAmount + manualAmount + adjustmentAmount;

  return {
    streamer:
      item.streamerName ||
      sourceReport?.streamer ||
      item.streamerId ||
      `主播 ${index + 1}`,
    id: item.id,
    rule:
      item.itemType === "live_report"
        ? `${settlementMethod} · 系统结算`
        : `${String(item.itemType).toUpperCase()} · 人工承载`,
    hours: Math.round((settlementDuration / 60) * 10) / 10,
    qty: `${item.evidenceLevel ?? "unknown"} · ${timeSource}`,
    base: 0,
    variable: computedAmount + manualAmount,
    adjust: adjustmentAmount,
    total,
  };
}

function toReferenceSettlementPoolFromApi(item) {
  return {
    id: item.id,
    streamer: item.streamerName || "Unknown streamer",
    project: item.projectName || "Unknown project",
    hours: Math.round(((item.settlementDuration ?? 0) / 60) * 10) / 10,
    evidence: `${item.evidenceLevel ?? "unknown"} · ${item.timeSource ?? "unknown"}`,
    rule: item.settlementMethod || "manual",
    expected: Number(item.expectedAmount ?? 0),
    approvedAt: formatOpsMinute(item.approvedAt),
  };
}

function toSettlementPoolFromReviewedReport(report, sourceReport) {
  const settlementDuration = Number(
    report.settlementDuration ?? (sourceReport?.duration ?? 0) * 60,
  );
  const evidenceLevel = report.evidenceLevel ?? "unknown";
  const timeSource = report.timeSource ?? "unknown";

  return {
    id: report.id || sourceReport?.id,
    streamer: sourceReport?.streamer || report.streamerId || "主播",
    project: sourceReport?.project || report.projectId || "项目",
    hours: Math.round((settlementDuration / 60) * 10) / 10,
    evidence: `${evidenceLevel} · ${timeSource}`,
    rule: "cpt",
    expected: Math.round((settlementDuration / 60) * 80),
    approvedAt: formatOpsMinute(
      report.reviewedAt || report.updatedAt || new Date().toISOString(),
    ),
  };
}

export {
  ScreenAdmission,
  ScreenReports,
  formatOpsMinute,
  toReferenceBatchDetailFromApi,
  toReferenceBatchFromApi,
  toReferenceReportFromApi,
  toReferenceSettlementPoolFromApi,
};
