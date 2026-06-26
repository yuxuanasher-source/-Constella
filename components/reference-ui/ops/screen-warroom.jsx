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

import {
  toPricingResultDto,
  toProjectReviewDto,
  toStreamerMatchDtos,
  toSupplierQualityDtos,
} from "@/features/war-room/war-room-ui-dto";

import { PageHeader, countActionableReports } from "./chrome";
import {
  ANOMALIES,
  AUDIT_LOG_RECENT,
  DEFAULT_MATCHING_ROWS,
  PROJECTS,
  PROJECT_STATUS,
  STREAMERS,
  SUPPLIER_SCORES,
  WAR_ROOM_FALLBACK_PROJECT,
  WAR_ROOM_FALLBACK_STREAMERS,
  WAR_ROOM_FALLBACK_SUPPLIERS,
  useOpsLiveActions,
  useOpsProjects,
  useOpsReports,
  useOpsStreamers,
  useOpsTasks,
} from "./data";
import { Icon } from "./icons";
import { EmptyHint } from "./screen-project";
import {
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  Metric,
  MiniBar,
  RiskDot,
  SearchInput,
  SectionTitle,
  Tabs,
} from "./ui";

// ——— Screen: 智能项目作战台 ————————————————————————————

function ScreenWarRoom({ go }) {
  const actions = useOpsLiveActions();
  const [tab, setTab] = React.useState("overview");
  const [warRoomMessage, setWarRoomMessage] = React.useState("");
  const [warRoomExporting, setWarRoomExporting] = React.useState(false);
  const projects = useOpsProjects();
  const tasks = useOpsTasks();
  const reports = useOpsReports();
  const activeProjects = projects.filter((project) =>
    ["active", "recruiting", "settling"].includes(project.status),
  );
  const highRiskProjects = projects.filter(
    (project) => project.risk === "high",
  );
  const totalDoneHours = projects.reduce(
    (sum, project) => sum + (project.metrics?.doneHours ?? 0),
    0,
  );
  const totalReceivable = projects.reduce(
    (sum, project) => sum + (project.metrics?.receivable ?? 0),
    0,
  );
  const totalGross = projects.reduce(
    (sum, project) => sum + (project.metrics?.gross ?? 0),
    0,
  );
  const grossMargin =
    totalReceivable > 0 ? (totalGross / totalReceivable) * 100 : 0;
  const pendingReportCount = countActionableReports(reports);
  const anomalyCount =
    tasks.filter((task) => task?.anomaly).length +
    projects.reduce(
      (sum, project) => sum + (project.metrics?.anomalies ?? 0),
      0,
    );
  const pendingActionCount = pendingReportCount + anomalyCount;
  const exportDailyBrief = async () => {
    if (warRoomExporting) return;
    setWarRoomMessage("");
    setWarRoomExporting(true);
    try {
      const result = await actions.createGovernedExport?.({
        kind: "project_execution",
        rows: activeProjects.map((project) => ({
          projectName: project.name,
          status: project.status,
          operatorName: project.leadOps || project.ownerName || "未分配",
        })),
      });
      setWarRoomMessage(
        result?.filename
          ? `当日简报导出已生成：${result.filename}`
          : "当日简报导出已生成",
      );
    } catch (error) {
      setWarRoomMessage(
        error instanceof Error ? error.message : "当日简报导出失败",
      );
    } finally {
      setWarRoomExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="智能项目作战台"
        subtitle="覆盖立项前 → 招募中 → 执行中 → 结算中 → 结项复盘的项目经营决策面板"
        status={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              background: "linear-gradient(135deg, #EFEBFF, #DCE6FF)",
              color: "var(--violet-600)",
            }}
          >
            <Icon.Sparkles size={12} stroke="var(--violet-600)" /> AI 增强 ·
            基础版
          </span>
        }
        actions={
          <>
            <Button
              kind="default"
              icon={<Icon.Export size={14} />}
              onClick={exportDailyBrief}
              disabled={warRoomExporting}
            >
              {warRoomExporting ? "导出中…" : "导出当日简报"}
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Plus size={14} stroke="#fff" />}
              onClick={() => setTab("pricing")}
            >
              立项 / 报价测算
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Top metrics strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 16,
          }}
        >
          <Card style={{ position: "relative", overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                background: "var(--blue-600)",
              }}
            />
            <Metric
              label="进行中项目"
              value={String(activeProjects.length)}
              unit="个"
              hint={
                highRiskProjects.length > 0
                  ? `${highRiskProjects.length} 个高风险`
                  : "暂无高风险项目"
              }
            />
          </Card>
          <Card>
            <Metric
              label="本周直播时长"
              value={totalDoneHours.toFixed(1)}
              unit="h"
              hint="按当前项目数据汇总"
            />
          </Card>
          <Card>
            <Metric
              label="本周厂家应收"
              value={`¥${totalReceivable.toLocaleString("zh-CN")}`}
              hint="按当前项目数据汇总"
            />
          </Card>
          <Card>
            <Metric
              label="预估毛利率"
              value={grossMargin.toFixed(1)}
              unit="%"
              hint={totalReceivable > 0 ? "毛利率" : "暂无应收数据"}
            />
          </Card>
          <Card>
            <Metric
              label="待处理事项"
              value={String(pendingActionCount)}
              unit="项"
              hint={
                pendingActionCount > 0
                  ? `审核 ${pendingReportCount} · 异常 ${anomalyCount}`
                  : "暂无待处理事项"
              }
              accent={
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: "var(--danger-600)",
                  }}
                />
              }
            />
          </Card>
        </div>
        {warRoomMessage ? (
          <div
            aria-live="polite"
            style={{ fontSize: 12, color: "var(--ink-500)" }}
          >
            {warRoomMessage}
          </div>
        ) : null}

        {/* Tabs */}
        <Card padded={false}>
          <div
            style={{ padding: "0 12px", borderBottom: "1px solid var(--line)" }}
          >
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { key: "overview", label: "执行总览" },
                { key: "matching", label: "主播匹配引擎" },
                { key: "supplier", label: "供应商质量" },
                { key: "pricing", label: "报价 & 测算" },
              ]}
            />
          </div>

          <div style={{ padding: 20 }}>
            {tab === "overview" && <Overview go={go} />}
            {tab === "matching" && <Matching go={go} />}
            {tab === "supplier" && <Supplier />}
            {tab === "pricing" && <Pricing />}
          </div>
        </Card>
      </div>
    </>
  );
}

// ——— Overview tab ————————————————————————
function Overview({ go }) {
  const projects = useOpsProjects();
  const streamers = useOpsStreamers();
  const [reviewResult, setReviewResult] = React.useState(null);
  const [reviewBusy, setReviewBusy] = React.useState(false);
  const [reviewError, setReviewError] = React.useState("");

  const runProjectReview = async () => {
    if (reviewBusy) return;

    setReviewBusy(true);
    setReviewError("");
    try {
      const reviewInput = buildWarRoomReviewInput(projects, streamers);
      if (!reviewInput) {
        setReviewError("暂无可评估的项目数据。");
        return;
      }
      const body = await postWarRoomJson(
        "/api/war-room/project-review",
        reviewInput,
        "project review failed",
      );
      setReviewResult(toProjectReviewDto(body.report));
    } catch (error) {
      setReviewError(
        error instanceof Error ? error.message : "project review failed",
      );
    } finally {
      setReviewBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
      {/* Left: active projects + AI insights */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <SectionTitle hint="按风险与履约进度排序">活跃项目</SectionTitle>
          <Card padded={false}>
            <DataTable
              columns={[
                {
                  title: "项目",
                  width: 240,
                  render: (r) => (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <span
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 6,
                          background: "var(--blue-50)",
                          color: "var(--blue-700)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon.Game size={16} stroke="var(--blue-700)" />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            color: "var(--ink-900)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: 200,
                          }}
                        >
                          {r.name}
                        </div>
                        <div
                          style={{ fontSize: 11, color: "var(--ink-400)" }}
                          className="mono"
                        >
                          {r.id} · {r.vendor}
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "状态",
                  render: (r) => (
                    <Badge tone={PROJECT_STATUS[r.status].tone} dot>
                      {PROJECT_STATUS[r.status].label}
                    </Badge>
                  ),
                },
                {
                  title: "履约进度",
                  render: (r) => {
                    const pct = r.metrics.plannedHours
                      ? Math.round(
                          (r.metrics.doneHours / r.metrics.plannedHours) * 100,
                        )
                      : 0;
                    return (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <MiniBar
                          value={pct}
                          tone={
                            pct >= 90 ? "green" : pct >= 50 ? "blue" : "amber"
                          }
                          width={64}
                        />
                        <span
                          className="num"
                          style={{
                            fontSize: 12,
                            color: "var(--ink-500)",
                            minWidth: 30,
                          }}
                        >
                          {pct}%
                        </span>
                      </div>
                    );
                  },
                },
                {
                  title: "主播",
                  align: "right",
                  render: (r) => (
                    <span className="num">{r.streamers.active}</span>
                  ),
                },
                {
                  title: "应收 / 应付",
                  align: "right",
                  render: (r) => (
                    <div>
                      <div
                        className="num"
                        style={{ fontSize: 13, color: "var(--ink-900)" }}
                      >
                        ¥{(r.metrics.receivable / 1000).toFixed(1)}k
                      </div>
                      <div
                        className="num"
                        style={{ fontSize: 11, color: "var(--ink-400)" }}
                      >
                        -¥{(r.metrics.payable / 1000).toFixed(1)}k
                      </div>
                    </div>
                  ),
                },
                { title: "风险", render: (r) => <RiskDot level={r.risk} /> },
              ]}
              rows={projects.filter((p) =>
                ["active", "settling", "paused", "recruiting"].includes(
                  p.status,
                ),
              )}
              onRowClick={() => go("project")}
            />
          </Card>
        </div>

        {/* AI advisor card */}
        <Card
          style={{
            background: "linear-gradient(135deg, #F8F6FF 0%, #EEF3FF 100%)",
            borderColor: "#D8D0FA",
          }}
        >
          <div style={{ display: "flex", gap: 14 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "linear-gradient(135deg, #5B4BD1, #1E50C8)",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon.Sparkles size={18} stroke="#fff" />
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink-900)",
                  }}
                >
                  AI 经营简报
                </span>
                <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                  基于近 14 天数据
                </span>
              </div>
              <EmptyHint
                title="暂无经营简报"
                hint="接入真实项目复盘结果后会展示可执行建议。"
              />
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <Button
                  size="sm"
                  kind="default"
                  onClick={runProjectReview}
                  disabled={reviewBusy}
                >
                  {reviewBusy ? "生成中…" : "查看完整复盘"}
                </Button>
                <Button
                  size="sm"
                  kind="ghost"
                  icon={<Icon.History size={13} />}
                >
                  历史简报
                </Button>
              </div>
              {reviewError ? (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 12,
                    color: "var(--danger-600)",
                  }}
                >
                  {reviewError}
                </div>
              ) : null}
              {reviewResult ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 8,
                    background: "#fff",
                    border: "1px solid #D8D0FA",
                    fontSize: 12.5,
                    color: "var(--ink-700)",
                    lineHeight: 1.6,
                  }}
                >
                  <div style={{ fontWeight: 700, color: "var(--violet-600)" }}>
                    复盘结论：{reviewResult.conclusionLabel}
                  </div>
                  <div>
                    下轮建议报价{" "}
                    <span className="num">
                      {reviewResult.nextSuggestedQuoteLabel}
                    </span>
                    ，毛利率{" "}
                    <span className="num">{reviewResult.marginRateLabel}</span>
                  </div>
                  <div>
                    最佳主播 {reviewResult.bestStreamerLabel} · 待替换{" "}
                    {reviewResult.worstStreamerLabel}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      </div>

      {/* Right: anomalies + audit feed */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <SectionTitle
            extra={
              <Button size="sm" kind="link" onClick={() => go("tasks")}>
                查看全部 →
              </Button>
            }
          >
            异常任务 · 实时
          </SectionTitle>
          <Card padded={false}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {ANOMALIES.map((a, i) => (
                <div
                  key={a.id}
                  style={{
                    padding: "12px 16px",
                    borderBottom:
                      i < ANOMALIES.length - 1
                        ? "1px solid var(--line)"
                        : "none",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      flexShrink: 0,
                      background:
                        a.level === "high"
                          ? "var(--danger-50)"
                          : a.level === "medium"
                            ? "var(--warn-50)"
                            : "var(--ink-50)",
                      color:
                        a.level === "high"
                          ? "var(--danger-600)"
                          : a.level === "medium"
                            ? "var(--warn-600)"
                            : "var(--ink-500)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon.Warn size={15} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--ink-900)",
                        }}
                      >
                        {a.type}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
                        {a.streamer} · {a.project}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--ink-500)",
                        marginTop: 2,
                      }}
                    >
                      {a.detail}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--ink-400)",
                        marginTop: 4,
                      }}
                    >
                      {a.time}
                    </div>
                  </div>
                  <Button size="sm" kind="default" onClick={() => go("tasks")}>
                    处理
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div>
          <SectionTitle>最近高风险操作</SectionTitle>
          <Card padded={false}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {AUDIT_LOG_RECENT.map((l, i) => (
                <div
                  key={i}
                  style={{
                    padding: "10px 16px",
                    borderBottom:
                      i < AUDIT_LOG_RECENT.length - 1
                        ? "1px solid var(--line)"
                        : "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Avatar name={l.who.split(" ")[0]} size={26} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "var(--ink-700)" }}>
                      <b style={{ color: "var(--ink-900)" }}>{l.who}</b>
                      <span style={{ color: "var(--ink-400)" }}> · </span>
                      <span>{l.action}</span>
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {l.target} · {l.time}
                    </div>
                  </div>
                  {l.risk && (
                    <Badge tone="red" dot>
                      高风险
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ——— Matching tab ————————————————————————
function Matching({ go }) {
  const streamers = useOpsStreamers();
  const [matchRows, setMatchRows] = React.useState(null);
  const [supplierRows, setSupplierRows] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [actionMessage, setActionMessage] = React.useState("");
  const rows = matchRows ?? DEFAULT_MATCHING_ROWS;

  const runMatching = async () => {
    if (busy) return;

    setBusy(true);
    setError("");
    setActionMessage("");
    try {
      const body = await postWarRoomJson(
        "/api/war-room/matching",
        buildWarRoomMatchingInput(streamers),
        "matching failed",
      );
      setMatchRows(toStreamerMatchDtos(body.matches ?? []));
      setSupplierRows(toSupplierQualityDtos(body.suppliers ?? []));
    } catch (error) {
      setError(error instanceof Error ? error.message : "matching failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <div
            style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}
          >
            为当前项目推荐主播
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>
            基于品类匹配、历史完成率、录屏通过率、ROI、风险扣分综合评分
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            kind="default"
            icon={<Icon.Filter size={14} />}
            onClick={() => setActionMessage("匹配筛选后台暂未接入。")}
          >
            筛选
          </Button>
          <Button
            kind="primary"
            icon={<Icon.Export size={14} stroke="#fff" />}
            onClick={runMatching}
            disabled={busy}
          >
            {busy ? "匹配中…" : "导出厂家候选包"}
          </Button>
        </div>
      </div>
      {error ? (
        <div
          style={{
            marginBottom: 12,
            fontSize: 12,
            color: "var(--danger-600)",
          }}
        >
          {error}
        </div>
      ) : null}
      {actionMessage ? (
        <div
          aria-live="polite"
          style={{
            marginBottom: 12,
            fontSize: 12,
            color: "var(--ink-500)",
          }}
        >
          {actionMessage}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 16,
        }}
      >
        {rows.map((r) => {
          const s = STREAMERS.find((s) => s.id === r.id);
          const source = s?.source ?? "API 推荐";
          const games = s?.games ?? ["接口结果"];
          const platforms = s?.platforms ?? ["API"];
          const style = s?.style ?? "综合评分";
          const defaultRule =
            r.suggestedSettlementMethodLabel ?? s?.defaultRule ?? "CPT";
          const tone =
            r.score >= 85 ? "green" : r.score >= 70 ? "blue" : "amber";
          return (
            <Card key={r.id}>
              <div style={{ display: "flex", gap: 14 }}>
                <Avatar name={r.alias} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ display: "flex", alignItems: "baseline", gap: 8 }}
                  >
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: "var(--ink-900)",
                      }}
                    >
                      {r.alias}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {s?.id ?? r.id}
                    </span>
                    <span style={{ flex: 1 }} />
                    <Badge
                      tone={
                        source === "签约"
                          ? "blue"
                          : source === "自孵化"
                            ? "teal"
                            : "neutral"
                      }
                    >
                      {source}
                    </Badge>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-400)",
                      marginTop: 2,
                    }}
                  >
                    {games.join(" / ")} · {platforms.join(" ")} · {style}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 6,
                      }}
                    >
                      <span
                        className="num"
                        style={{
                          fontSize: 28,
                          fontWeight: 700,
                          color:
                            tone === "green"
                              ? "var(--ok-600)"
                              : tone === "blue"
                                ? "var(--blue-600)"
                                : "var(--warn-600)",
                          letterSpacing: "-0.02em",
                        }}
                      >
                        {r.score}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                        匹配分
                      </span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <MiniBar value={r.score} tone={tone} width="100%" />
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {r.reasons.map((t, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          gap: 8,
                          fontSize: 12,
                          color: "var(--ink-700)",
                        }}
                      >
                        <Icon.Check size={14} stroke="var(--ok-600)" />
                        <span>{t}</span>
                      </div>
                    ))}
                    {r.risks.map((t, i) => (
                      <div
                        key={"r" + i}
                        style={{
                          display: "flex",
                          gap: 8,
                          fontSize: 12,
                          color: "var(--danger-600)",
                        }}
                      >
                        <Icon.Warn size={14} stroke="var(--danger-600)" />
                        <span>{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px dashed var(--line)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                  建议结算 ：
                </div>
                <Badge tone="blue">{defaultRule}</Badge>
                <span style={{ flex: 1 }} />
                <Button
                  size="sm"
                  kind="ghost"
                  onClick={() => go("streamers", r.id)}
                >
                  查看画像
                </Button>
                <Button
                  size="sm"
                  kind="primary"
                  onClick={() =>
                    setActionMessage(`${r.name} 的项目邀约后台暂未接入。`)
                  }
                >
                  发起邀约
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
      {supplierRows?.length ? (
        <div style={{ marginTop: 16 }}>
          <SectionTitle hint="来自本次匹配 API">供应商同步评分</SectionTitle>
          <Card padded={false}>
            <DataTable
              columns={[
                {
                  title: "供应商",
                  render: (r) => (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <Avatar name={r.name} size={30} />
                      <div>
                        <div
                          style={{ fontWeight: 600, color: "var(--ink-900)" }}
                        >
                          {r.name}
                        </div>
                        <div
                          className="mono"
                          style={{ fontSize: 11, color: "var(--ink-400)" }}
                        >
                          {r.id}
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "评分",
                  render: (r) => (
                    <span className="num" style={{ fontWeight: 700 }}>
                      {r.score}
                    </span>
                  ),
                },
                {
                  title: "等级",
                  render: (r) => <Badge tone="green">{r.grade}</Badge>,
                },
                {
                  title: "原因",
                  wrap: true,
                  render: (r) => r.reasons.join(" / ") || "—",
                },
              ]}
              rows={supplierRows}
            />
          </Card>
        </div>
      ) : null}
    </div>
  );
}

// ——— Supplier tab ————————————————————————
function Supplier() {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <div
            style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}
          >
            供应商质量评分
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>
            评分 = 录屏通过 + 项目完成 + 毛利贡献 − 异常率 − 黑名单率
          </div>
        </div>
        <SearchInput placeholder="搜索供应商…" width={220} />
      </div>

      <Card padded={false}>
        <DataTable
          columns={[
            {
              title: "供应商",
              render: (r) => (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar name={r.name} size={30} />
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                      {r.name}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {r.id} · 推荐主播 {r.streamers}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              title: "综合评分",
              render: (r) => (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    className="num"
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color:
                        r.score >= 85
                          ? "var(--ok-600)"
                          : r.score >= 75
                            ? "var(--blue-600)"
                            : "var(--warn-600)",
                    }}
                  >
                    {r.score}
                  </span>
                  <MiniBar
                    value={r.score}
                    tone={
                      r.score >= 85 ? "green" : r.score >= 75 ? "blue" : "amber"
                    }
                    width={100}
                  />
                </div>
              ),
            },
            {
              title: "项目完成率",
              align: "right",
              render: (r) => <span className="num">{r.finishRate}%</span>,
            },
            {
              title: "异常率",
              align: "right",
              render: (r) => (
                <span
                  className="num"
                  style={{
                    color:
                      r.anomalyRate >= 10
                        ? "var(--danger-600)"
                        : "var(--ink-700)",
                  }}
                >
                  {r.anomalyRate}%
                </span>
              ),
            },
            {
              title: "累计毛利贡献",
              align: "right",
              render: (r) => (
                <span className="num">
                  ¥{(r.grossContrib / 1000).toFixed(1)}k
                </span>
              ),
            },
            {
              title: "趋势",
              align: "right",
              render: (r) => (
                <span
                  className="num"
                  style={{
                    color: r.trend.startsWith("+")
                      ? "var(--ok-600)"
                      : "var(--danger-600)",
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  {r.trend}
                </span>
              ),
            },
            {
              title: "建议",
              render: (r) =>
                r.score >= 85 ? (
                  <Badge tone="green">优先续合</Badge>
                ) : r.score >= 75 ? (
                  <Badge tone="blue">维持合作</Badge>
                ) : (
                  <Badge tone="amber">谨慎使用</Badge>
                ),
            },
          ]}
          rows={SUPPLIER_SCORES}
        />
      </Card>
    </div>
  );
}

// ——— Pricing tab ————————————————————————
function Pricing() {
  const [model, setModel] = React.useState("cpt-cps");
  const [streamers, setStreamers] = React.useState(8);
  const [hours, setHours] = React.useState(60);
  const [hourly, setHourly] = React.useState(75);
  const [conversion, setConversion] = React.useState(12000);
  const [cpsRate, setCpsRate] = React.useState(8);
  const [pricingResult, setPricingResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [draftMessage, setDraftMessage] = React.useState("");

  const vendorRevenue = Math.round(
    streamers * hours * hourly * 1.3 + ((conversion * cpsRate) / 100) * 1.6,
  );
  const streamerCost = Math.round(streamers * hours * hourly);
  const supplierCost = Math.round(streamerCost * 0.18);
  const platform = Math.round(vendorRevenue * 0.05);
  const gross = vendorRevenue - streamerCost - supplierCost - platform;
  const marginPct =
    vendorRevenue > 0 ? ((gross / vendorRevenue) * 100).toFixed(1) : "0.0";

  const fmt = (n) => `¥${n.toLocaleString()}`;

  const runPricing = async () => {
    if (busy) return;

    setBusy(true);
    setError("");
    setDraftMessage("");
    try {
      const body = await postWarRoomJson(
        "/api/war-room/pricing",
        buildWarRoomPricingInput({
          model,
          streamers,
          hours,
          hourly,
          conversion,
          cpsRate,
          vendorRevenue,
          supplierCost,
        }),
        "pricing failed",
      );
      setPricingResult(toPricingResultDto(body.pricing));
    } catch (error) {
      setError(error instanceof Error ? error.message : "pricing failed");
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = () => {
    setError("");
    setDraftMessage("报价草稿后台暂未接入，当前测算参数已保留在本页。");
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      {/* Inputs */}
      <Card title="输入项" padded={true}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="结算方式">
            <div style={{ display: "flex", gap: 6 }}>
              {[
                ["cpt", "CPT"],
                ["cpt-cps", "CPT + CPS"],
                ["cpa", "CPA"],
                ["gift", "礼物提成"],
              ].map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setModel(k)}
                  style={{
                    height: 28,
                    padding: "0 10px",
                    fontSize: 12,
                    background: model === k ? "var(--blue-50)" : "#fff",
                    border: `1px solid ${model === k ? "var(--blue-500)" : "var(--line-strong)"}`,
                    color: model === k ? "var(--blue-700)" : "var(--ink-500)",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: model === k ? 600 : 500,
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </Field>
          <Field label="预计主播数">
            <RangeInput
              value={streamers}
              setValue={setStreamers}
              min={1}
              max={30}
              suffix="人"
            />
          </Field>
          <Field label="人均直播时长">
            <RangeInput
              value={hours}
              setValue={setHours}
              min={10}
              max={200}
              suffix="h / 月"
            />
          </Field>
          <Field label="时薪 / CPT 单价">
            <RangeInput
              value={hourly}
              setValue={setHourly}
              min={30}
              max={200}
              prefix="¥"
            />
          </Field>
          <Field label="预计 CPS 转化销售额">
            <RangeInput
              value={conversion}
              setValue={setConversion}
              min={0}
              max={80000}
              step={1000}
              prefix="¥"
            />
          </Field>
          <Field label="CPS 分成 (%)">
            <RangeInput
              value={cpsRate}
              setValue={setCpsRate}
              min={0}
              max={30}
              suffix="%"
            />
          </Field>
        </div>
      </Card>

      {/* Outputs */}
      <Card
        title="预估结果"
        extra={
          <Badge tone="violet" dot>
            AI 建议
          </Badge>
        }
        padded={true}
      >
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
        >
          <ResultCell
            label="厂家应收"
            value={pricingResult?.expectedReceivableLabel ?? fmt(vendorRevenue)}
            tone="blue"
            emphasize
          />
          <ResultCell
            label="预计毛利"
            value={pricingResult?.grossMarginLabel ?? fmt(gross)}
            tone={gross > 0 ? "green" : "red"}
            emphasize
          />
          <ResultCell
            label="主播应付"
            value={pricingResult?.streamerPayableLabel ?? fmt(streamerCost)}
          />
          <ResultCell
            label="供应商成本"
            value={pricingResult?.supplierCostLabel ?? fmt(supplierCost)}
          />
          <ResultCell
            label="平台扣点"
            value={pricingResult?.platformFeeLabel ?? fmt(platform)}
          />
          <ResultCell
            label="毛利率"
            value={pricingResult?.marginRateLabel ?? `${marginPct}%`}
            tone={parseFloat(marginPct) > 25 ? "green" : "amber"}
          />
        </div>

        <div
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 8,
            background: "linear-gradient(135deg, #F8F6FF, #EEF3FF)",
            border: "1px solid #D8D0FA",
            display: "flex",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--violet-600)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon.Sparkles size={14} stroke="#fff" />
          </div>
          <div
            style={{
              flex: 1,
              fontSize: 12.5,
              color: "var(--ink-700)",
              lineHeight: 1.6,
            }}
          >
            {pricingResult ? (
              <>
                API 测算完成，<b>建议最低报价</b>{" "}
                <span className="num">
                  {pricingResult.suggestedMinimumQuoteLabel}
                </span>
                ，盈亏平衡报价{" "}
                <span className="num">{pricingResult.breakEvenQuoteLabel}</span>
                ，建议结算方式 {pricingResult.recommendedSettlementMethodLabel}
                。
                {pricingResult.riskNotes.length ? (
                  <div style={{ marginTop: 6 }}>
                    {pricingResult.riskNotes.map((note) => (
                      <Badge key={note} tone="amber" style={{ marginRight: 6 }}>
                        {note}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                按当前输入，<b>盈亏平衡点</b>约为单主播{" "}
                <span className="num">
                  {Math.ceil(streamerCost / streamers / hourly)}
                </span>{" "}
                h / 月。 如希望毛利率 ≥ 30%，建议将 CPT 单价降至{" "}
                <span className="num">¥{Math.round(hourly * 0.93)}</span>， 或将
                CPS 分成提高至{" "}
                <span className="num">{Math.min(30, cpsRate + 2)}%</span>。
                历史同类项目平均毛利率 <b className="num">31.6%</b>。
              </>
            )}
          </div>
        </div>
        {error ? (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              color: "var(--danger-600)",
            }}
          >
            {error}
          </div>
        ) : null}
        {draftMessage ? (
          <div
            aria-live="polite"
            style={{
              marginTop: 10,
              fontSize: 12,
              color: "var(--ink-500)",
            }}
          >
            {draftMessage}
          </div>
        ) : null}

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <Button kind="default" onClick={saveDraft}>
            保存为草稿
          </Button>
          <Button kind="primary" onClick={runPricing} disabled={busy}>
            {busy ? "测算中…" : "生成立项申请"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

async function postWarRoomJson(url, body, fallbackMessage) {
  const response = await globalThis.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }
  return payload;
}

function buildWarRoomPricingInput({
  model,
  streamers,
  hours,
  hourly,
  conversion,
  cpsRate,
  vendorRevenue,
  supplierCost,
}) {
  const fixedBudgetModels = new Set(["cpt-cps", "cpa", "gift"]);
  return {
    vendorSettlementMethod: fixedBudgetModels.has(model)
      ? "fixed_budget"
      : "cpt",
    streamerCount: streamers,
    estimatedMinutesPerStreamer: hours * 60,
    vendorBudgetCents: vendorRevenue * 100,
    vendorHourlyRateCents: Math.round(hourly * 130),
    streamerHourlyCostCents: hourly * 100,
    supplierCostCents: supplierCost * 100,
    expectedManualRevenueCents: conversion * cpsRate,
    platformFeeBps: 500,
    manualAdjustmentCents: 0,
    targetMarginBps: 3000,
  };
}

function buildWarRoomMatchingInput(streamers = STREAMERS) {
  const streamerRows = streamers.length
    ? streamers
    : WAR_ROOM_FALLBACK_STREAMERS;
  const supplierRows = SUPPLIER_SCORES.length
    ? SUPPLIER_SCORES
    : WAR_ROOM_FALLBACK_SUPPLIERS;

  return {
    project: {
      category: "moba",
      platform: "douyin",
      preferredStyles: ["高互动", "欢快互动", "高能竞技"],
      requiredMinutes: 900,
    },
    candidates: streamerRows.map((streamer) => ({
      id: streamer.id ?? "streamer-war-room-fallback",
      name: streamer.alias ?? streamer.name ?? "主播待配置",
      categories: (streamer.games ?? ["moba"]).map(toWarRoomCategory),
      platforms: (streamer.platforms ?? ["抖音"]).map(toWarRoomPlatform),
      styles: [streamer.style ?? "高互动"],
      completionRateBps: (streamer.metrics?.projectFinish ?? 80) * 100,
      screeningPassRateBps: (streamer.metrics?.screenPass ?? 80) * 100,
      roiBps: Math.round((streamer.metrics?.roi ?? 1) * 10000),
      grossMarginContributionCents: (streamer.metrics?.grossContrib ?? 0) * 100,
      riskTags:
        streamer.risk === "low"
          ? []
          : streamer.risk === "medium"
            ? ["recent_anomaly"]
            : ["dispute"],
      availableMinutes: Math.max(300, (streamer.completedProjects ?? 1) * 120),
      referenceProjects: [
        {
          id: `${streamer.id}-ref`,
          name: `${streamer.alias ?? streamer.name ?? "主播待配置"} 历史项目`,
          result: `完成率 ${streamer.metrics?.projectFinish ?? 80}%`,
        },
      ],
    })),
    suppliers: supplierRows.map((supplier) => ({
      id: supplier.id ?? "supplier-war-room-fallback",
      name: supplier.name ?? "未命名供应商",
      screeningPassRateBps: Math.min(10000, (supplier.finishRate ?? 80) * 100),
      completionRateBps: Math.min(10000, (supplier.finishRate ?? 80) * 100),
      marginContributionCents: (supplier.grossContrib ?? 0) * 100,
      anomalyRateBps: (supplier.anomalyRate ?? 0) * 100,
      blacklistRateBps: 0,
      isBlacklisted: supplier.score < 60,
    })),
  };
}

function buildWarRoomReviewInput(projects = PROJECTS, streamers = STREAMERS) {
  const project = projects[0] ?? WAR_ROOM_FALLBACK_PROJECT;
  const streamerRows = streamers.length
    ? streamers
    : WAR_ROOM_FALLBACK_STREAMERS;

  return {
    project: {
      id: project.id,
      name: project.name,
      category: "moba",
      platform: "douyin",
      periodStart: project.start,
      periodEnd: project.end,
    },
    finance: {
      receivableCents: (project.metrics?.receivable ?? 12000) * 100,
      payableCents: (project.metrics?.payable ?? 6000) * 100,
      supplierCostCents: 100000,
      adjustmentCents: 0,
      manualRevenueCents: 0,
    },
    streamers: streamerRows.slice(0, 4).map((streamer, index) => ({
      id: streamer.id ?? `streamer-war-room-${index}`,
      name: streamer.alias ?? streamer.name ?? "主播待配置",
      durationMinutes: 600 + index * 120,
      totalViews: 40000 + index * 12000,
      completionRateBps: (streamer.metrics?.projectFinish ?? 80) * 100,
      roiBps: Math.round((streamer.metrics?.roi ?? 1) * 10000),
      grossMarginContributionCents: (streamer.metrics?.grossContrib ?? 0) * 100,
      anomalyCount: streamer.risk === "low" ? 0 : 1,
      disputeCount: streamer.risk === "high" ? 1 : 0,
    })),
    suppliers: buildWarRoomMatchingInput(streamers).suppliers,
    evidenceSummary: { green: 8, yellow: 1, red: 0, unknown: 0 },
    targetMarginBps: 3000,
  };
}

function toWarRoomCategory(game) {
  if (game.includes("moba") || game.includes("party")) return "moba";
  if (game.includes("rpg") || game.includes("story")) return "rpg";
  if (game.includes("action")) return "action";
  return "other";
}

function toWarRoomPlatform(platform) {
  if (platform.includes("抖音")) return "douyin";
  if (platform.includes("快手")) return "kuaishou";
  if (platform.includes("B站")) return "bilibili";
  return platform.toLowerCase();
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--ink-400)", marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function RangeInput({ value, setValue, min, max, step = 1, prefix, suffix }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        style={{ flex: 1, accentColor: "var(--blue-600)" }}
      />
      <div
        style={{
          minWidth: 96,
          height: 30,
          padding: "0 10px",
          border: "1px solid var(--line-strong)",
          borderRadius: 6,
          background: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 2,
          fontSize: 13,
          fontWeight: 600,
          color: "var(--ink-900)",
        }}
        className="num"
      >
        {prefix}
        {value.toLocaleString()}
        {suffix && (
          <span
            style={{ color: "var(--ink-400)", fontWeight: 400, marginLeft: 2 }}
          >
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function ResultCell({ label, value, tone, emphasize }) {
  const tones = {
    blue: "var(--blue-700)",
    green: "var(--ok-600)",
    amber: "var(--warn-600)",
    red: "var(--danger-600)",
  };
  return (
    <div
      style={{
        padding: 14,
        background: emphasize ? "var(--bg-soft)" : "#fff",
        border: "1px solid var(--line)",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--ink-400)" }}>{label}</div>
      <div
        className="num"
        style={{
          fontSize: emphasize ? 22 : 18,
          fontWeight: 600,
          color: tones[tone] || "var(--ink-900)",
          marginTop: 4,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export { Overview, ScreenWarRoom };
