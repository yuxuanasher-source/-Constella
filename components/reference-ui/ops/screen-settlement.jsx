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
  BATCHES,
  BATCH_DETAIL_ITEMS,
  BATCH_STATUS,
  useOpsLiveActions,
  useOpsSettlementBatchDetails,
  useOpsSettlementBatches,
  useOpsSettlementPool,
  useOpsSettlementScope,
} from "./data";
import { Icon } from "./icons";
import { EmptyHint } from "./screen-project";
import { TaskFormLabel, taskInputStyle } from "./screen-tasks";
import { Avatar, Badge, Button, Card, DataTable, KV, Metric, Tabs } from "./ui";

// ——— Screen: 结算中心 ————————————————————————————

function ScreenSettlement({ go }) {
  const batches = useOpsSettlementBatches();
  const batchDetails = useOpsSettlementBatchDetails();
  const settlementPool = useOpsSettlementPool();
  const settlementScope = useOpsSettlementScope();
  const actions = useOpsLiveActions();
  const [type, setType] = React.useState("all");
  const [busyAction, setBusyAction] = React.useState(null);
  const [activeId, setActiveId] = React.useState(batches[0]?.id ?? null);
  const [batchFormOpen, setBatchFormOpen] = React.useState(false);
  const [manualFormOpen, setManualFormOpen] = React.useState(false);
  const [settlementMessage, setSettlementMessage] = React.useState("");
  const [batchDraft, setBatchDraft] = React.useState({
    projectId: settlementScope?.projectId || "",
    periodStart: settlementScope?.periodStart || "",
    periodEnd: settlementScope?.periodEnd || "",
    batchType: "payable",
  });
  const [manualDraft, setManualDraft] = React.useState({
    itemType: "cpa",
    manualAmount: "300",
    evidenceLevel: "red",
    reason: "人工录入 CPA/CPS/礼物金额",
  });

  React.useEffect(() => {
    if (!batches.some((b) => b.id === activeId)) {
      setActiveId(batches[0]?.id ?? null);
    }
  }, [activeId, batches]);

  const filtered =
    type === "all" ? batches : batches.filter((b) => b.type === type);
  const activeBatch =
    batches.find((batch) => batch.id === activeId) || batches[0] || null;
  const poolCount =
    settlementPool.length > 0
      ? settlementPool.length
      : (settlementScope?.poolCount ?? 0);

  const runSettlementAction = async (actionName, fn) => {
    if (busyAction) return;
    setBusyAction(actionName);
    try {
      const shouldReload = await fn();
      if (shouldReload !== false) {
        globalThis.location?.reload();
      }
    } catch (error) {
      globalThis.alert?.(
        error instanceof Error ? error.message : "结算操作失败",
      );
    } finally {
      setBusyAction(null);
    }
  };

  React.useEffect(() => {
    setBatchDraft((draft) => ({
      ...draft,
      projectId:
        draft.projectId ||
        settlementScope?.projectId ||
        activeBatch?.projectId ||
        "",
      periodStart: draft.periodStart || settlementScope?.periodStart || "",
      periodEnd: draft.periodEnd || settlementScope?.periodEnd || "",
    }));
  }, [activeBatch, settlementScope]);

  const updateBatchDraft = (field) => (event) => {
    setBatchDraft((draft) => ({ ...draft, [field]: event.target.value }));
  };
  const updateManualDraft = (field) => (event) => {
    setManualDraft((draft) => ({ ...draft, [field]: event.target.value }));
  };

  const createBatch = (event) => {
    event?.preventDefault?.();
    return runSettlementAction("create", async () => {
      const { projectId, periodStart, periodEnd, batchType } = batchDraft;
      if (!projectId || !periodStart || !periodEnd || !batchType) {
        setSettlementMessage("请填写完整结算批次信息");
        return false;
      }

      await actions.createSettlementBatch?.({
        projectId,
        periodStart,
        periodEnd,
        batchType,
      });
      setBatchFormOpen(false);
      setSettlementMessage("");
      return false;
    });
  };

  const addManualItem = (event) => {
    event?.preventDefault?.();
    return runSettlementAction("manual", async () => {
      if (!activeBatch) return false;
      const manualAmount = Number(manualDraft.manualAmount);
      if (!manualDraft.itemType || !manualAmount || !manualDraft.reason) {
        setSettlementMessage("请填写完整人工调整信息");
        return false;
      }

      await actions.addManualSettlementItem?.(activeBatch.id, {
        itemType: manualDraft.itemType,
        manualAmount,
        evidenceLevel:
          manualDraft.evidenceLevel === "yellow" ? "yellow" : "red",
        reason: manualDraft.reason,
        projectId: activeBatch.projectId,
      });
      setManualFormOpen(false);
      setSettlementMessage("");
      return false;
    });
  };

  const lockBatch = () =>
    runSettlementAction("lock", async () => {
      if (!activeBatch) return false;
      await actions.lockSettlementBatch?.(activeBatch.id, {
        reason: "财务核对无误",
      });
      return false;
    });

  const reopenBatch = () =>
    runSettlementAction("reopen", async () => {
      if (!activeBatch) return false;
      await actions.reopenSettlementBatch?.(activeBatch.id, {
        reason: "需要修正结算金额",
      });
      return false;
    });
  const exportBatches = () =>
    runSettlementAction("export", async () => {
      await actions.createGovernedExport?.({
        kind: "settlement_batch",
        rows: filtered.map((batch) => ({
          batchName: batch.name,
          payableAmountCents:
            batch.type === "streamer_payable" ? batch.amount * 100 : 0,
          vendorReceivableCents:
            batch.type === "vendor_receivable" ? batch.amount * 100 : 0,
        })),
      });
      setSettlementMessage("结算批次导出已生成");
      return false;
    });

  return (
    <>
      <PageHeader
        title="结算中心"
        subtitle="厂家应收与主播应付分别开批次 · 锁定批次只允许负责人重新打开 · 全程审计"
        actions={
          <>
            <Button
              kind="default"
              icon={<Icon.Upload size={14} />}
              onClick={() => {
                setManualFormOpen((value) => !value);
                setSettlementMessage("");
              }}
              disabled={!!busyAction}
            >
              {busyAction === "manual" ? "处理中…" : "导入 CPA / CPS 数据"}
            </Button>
            <Button
              kind="default"
              icon={<Icon.Export size={14} />}
              onClick={exportBatches}
              disabled={!!busyAction}
            >
              {busyAction === "export" ? "导出中…" : "批次导出"}
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Plus size={14} stroke="#fff" />}
              onClick={() => {
                setBatchFormOpen((value) => !value);
                setSettlementMessage("");
              }}
              disabled={!!busyAction}
            >
              新建结算批次
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
        {/* Top metrics */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
          }}
        >
          <Card>
            <Metric
              label="可结算池 · 报数条数"
              value={String(poolCount)}
              unit="条"
              hint="审核通过 · 待入批次"
            />
          </Card>
          <Card>
            <Metric
              label="本月厂家应收 (草稿)"
              value="¥286,400"
              delta="+¥120k"
              hint="2 个待确认批次"
            />
          </Card>
          <Card>
            <Metric
              label="本月主播应付 (锁定)"
              value="¥92,400"
              hint="已发送至财务"
            />
          </Card>
          <Card style={{ borderColor: "var(--blue-200)" }}>
            <Metric label="本月预估毛利" value="¥73,200" delta="34.2% 毛利率" />
          </Card>
        </div>

        {settlementMessage ? (
          <div
            aria-live="polite"
            style={{
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
              color: settlementMessage.includes("失败")
                ? "var(--danger-600)"
                : "var(--ink-700)",
              fontSize: 12,
            }}
          >
            {settlementMessage}
          </div>
        ) : null}

        {batchFormOpen ? (
          <form
            onSubmit={createBatch}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px, 1fr) 150px 150px 160px auto",
              alignItems: "end",
              gap: 10,
              padding: 14,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
            }}
          >
            <TaskFormLabel label="结算项目 ID">
              <input
                value={batchDraft.projectId}
                onChange={updateBatchDraft("projectId")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <TaskFormLabel label="周期开始">
              <input
                type="date"
                value={batchDraft.periodStart}
                onChange={updateBatchDraft("periodStart")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <TaskFormLabel label="周期结束">
              <input
                type="date"
                value={batchDraft.periodEnd}
                onChange={updateBatchDraft("periodEnd")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <TaskFormLabel label="批次类型">
              <select
                value={batchDraft.batchType}
                onChange={updateBatchDraft("batchType")}
                style={taskInputStyle}
              >
                <option value="payable">主播应付</option>
                <option value="receivable">厂家应收</option>
              </select>
            </TaskFormLabel>
            <Button kind="primary" type="submit" disabled={!!busyAction}>
              确认新建批次
            </Button>
          </form>
        ) : null}

        {manualFormOpen ? (
          <form
            onSubmit={addManualItem}
            style={{
              display: "grid",
              gridTemplateColumns: "140px 140px 140px minmax(220px, 1fr) auto",
              alignItems: "end",
              gap: 10,
              padding: 14,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
            }}
          >
            <TaskFormLabel label="人工项目类型">
              <select
                value={manualDraft.itemType}
                onChange={updateManualDraft("itemType")}
                style={taskInputStyle}
              >
                <option value="cpa">CPA</option>
                <option value="cps">CPS</option>
                <option value="gift">礼物</option>
                <option value="manual">手工</option>
              </select>
            </TaskFormLabel>
            <TaskFormLabel label="人工金额">
              <input
                value={manualDraft.manualAmount}
                onChange={updateManualDraft("manualAmount")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <TaskFormLabel label="证据等级">
              <select
                value={manualDraft.evidenceLevel}
                onChange={updateManualDraft("evidenceLevel")}
                style={taskInputStyle}
              >
                <option value="red">red</option>
                <option value="yellow">yellow</option>
              </select>
            </TaskFormLabel>
            <TaskFormLabel label="人工原因">
              <input
                value={manualDraft.reason}
                onChange={updateManualDraft("reason")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <Button kind="primary" type="submit" disabled={!!busyAction}>
              确认导入人工金额
            </Button>
          </form>
        ) : null}

        <SettlementPoolPreview
          rows={settlementPool}
          settlementScope={settlementScope}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.4fr",
            gap: 20,
            alignItems: "flex-start",
          }}
        >
          <Card padded={false}>
            <div
              style={{
                padding: "0 12px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <Tabs
                value={type}
                onChange={setType}
                items={[
                  { key: "all", label: "全部", count: batches.length },
                  {
                    key: "vendor_receivable",
                    label: "厂家应收",
                    count: batches.filter((b) => b.type === "vendor_receivable")
                      .length,
                  },
                  {
                    key: "streamer_payable",
                    label: "主播应付",
                    count: batches.filter((b) => b.type === "streamer_payable")
                      .length,
                  },
                ]}
              />
            </div>

            <DataTable
              activeRowId={activeId}
              onRowClick={(r) => setActiveId(r.id)}
              columns={[
                {
                  title: "批次",
                  render: (r) => (
                    <div>
                      <div
                        className="mono"
                        style={{ fontSize: 11, color: "var(--ink-400)" }}
                      >
                        {r.id}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--ink-900)",
                          marginTop: 2,
                        }}
                      >
                        {r.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--ink-400)",
                          marginTop: 2,
                        }}
                      >
                        {r.period}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "类型",
                  render: (r) => (
                    <Badge
                      tone={r.type === "vendor_receivable" ? "blue" : "teal"}
                    >
                      {r.type === "vendor_receivable" ? "应收" : "应付"}
                    </Badge>
                  ),
                },
                {
                  title: "金额",
                  align: "right",
                  render: (r) => (
                    <span
                      className="num"
                      style={{
                        fontWeight: 600,
                        color: "var(--ink-900)",
                        fontSize: 14,
                      }}
                    >
                      ¥{r.amount.toLocaleString()}
                    </span>
                  ),
                },
                {
                  title: "状态",
                  render: (r) => (
                    <Badge tone={BATCH_STATUS[r.status].tone} dot>
                      {BATCH_STATUS[r.status].label}
                    </Badge>
                  ),
                },
              ]}
              rows={filtered}
            />
          </Card>

          {/* Batch detail */}
          <BatchDetail
            id={activeId}
            batches={batches}
            batchDetails={batchDetails}
            onAddManualItem={() => {
              setManualFormOpen(true);
              setSettlementMessage("");
            }}
            onLockBatch={lockBatch}
            onReopenBatch={reopenBatch}
            busyAction={busyAction}
          />
        </div>
      </div>
    </>
  );
}

function SettlementPoolPreview({ rows, settlementScope }) {
  return (
    <Card padded={false}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-700)" }}
          >
            可结算池预览
          </div>
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 3 }}
          >
            {settlementScope
              ? `${settlementScope.periodStart} → ${settlementScope.periodEnd}`
              : "等待审核通过报数进入池子"}
          </div>
        </div>
        <Badge tone={rows.length > 0 ? "green" : "neutral"} dot>
          {rows.length > 0 ? `${rows.length} 条待入批次` : "暂无待入批次"}
        </Badge>
      </div>
      <DataTable
        dense
        emptyText="暂无审核通过且未入批次的报数"
        columns={[
          {
            title: "报数",
            render: (r) => (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar name={r.streamer} size={26} />
                <div>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--ink-900)",
                    }}
                  >
                    {r.streamer}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 10.5, color: "var(--ink-400)" }}
                  >
                    {r.id}
                  </div>
                </div>
              </div>
            ),
          },
          {
            title: "项目",
            render: (r) => <span style={{ fontSize: 12 }}>{r.project}</span>,
          },
          {
            title: "有效时长",
            align: "right",
            render: (r) => <span className="num">{r.hours.toFixed(1)} h</span>,
          },
          {
            title: "证据",
            render: (r) => (
              <Badge tone={settlementEvidenceTone(r.evidence)}>
                {r.evidence}
              </Badge>
            ),
          },
          {
            title: "规则",
            render: (r) => <Badge tone="blue">{r.rule}</Badge>,
          },
          {
            title: "预计金额",
            align: "right",
            render: (r) => (
              <span
                className="num"
                style={{ fontWeight: 700, color: "var(--ink-900)" }}
              >
                ¥{r.expected.toLocaleString()}
              </span>
            ),
          },
          {
            title: "审核时间",
            align: "right",
            render: (r) => (
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-400)" }}
              >
                {r.approvedAt}
              </span>
            ),
          },
        ]}
        rows={rows}
      />
    </Card>
  );
}

function settlementEvidenceTone(value) {
  if (String(value).startsWith("green")) return "green";
  if (String(value).startsWith("yellow")) return "amber";
  if (String(value).startsWith("red")) return "red";
  return "neutral";
}

function BatchDetail({
  id,
  batches = BATCHES,
  batchDetails = {},
  onAddManualItem,
  onLockBatch,
  onReopenBatch,
  busyAction,
}) {
  const [detailMessage, setDetailMessage] = React.useState("");
  const b = batches.find((x) => x.id === id) || batches[0] || BATCHES[1];
  if (!b) {
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
          <EmptyHint title="暂无结算批次" hint="结算批次会在后端返回后展示。" />
        </Card>
      </div>
    );
  }

  const isPayable = b.type === "streamer_payable";
  const isLocked = b.status === "locked";
  const batchStatus = BATCH_STATUS[b.status] || BATCH_STATUS.pending_confirm;
  const isReferenceBatch = BATCHES.some((x) => x.id === b.id);
  const apiDetailRows = Array.isArray(batchDetails[b.id])
    ? batchDetails[b.id]
    : null;
  const detailRows = apiDetailRows?.length
    ? apiDetailRows
    : isReferenceBatch
      ? BATCH_DETAIL_ITEMS
      : [
          {
            streamer: "批次汇总",
            id: String(b.id).slice(0, 8),
            rule: isPayable ? "主播应付汇总" : "厂家应收汇总",
            hours: 0,
            qty: "API 批次",
            base: 0,
            variable: b.amount,
            adjust: 0,
            total: b.amount,
          },
        ];

  const total = detailRows.reduce((s, x) => s + x.total, 0);
  const baseSum = detailRows.reduce((s, x) => s + x.base, 0);
  const varSum = detailRows.reduce((s, x) => s + x.variable, 0);
  const adjSum = detailRows.reduce((s, x) => s + x.adjust, 0);
  const showPendingDetail = (message) => {
    setDetailMessage(message);
  };

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
        {/* Header */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-400)" }}
              >
                {b.id}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--ink-900)",
                  marginTop: 2,
                }}
              >
                {b.name}
              </div>
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <Badge tone={isPayable ? "teal" : "blue"}>
                  {isPayable ? "主播应付" : "厂家应收"}
                </Badge>
                <Badge tone={batchStatus.tone} dot>
                  {batchStatus.label}
                </Badge>
                {isLocked && (
                  <Badge tone="ink" soft={true}>
                    <Icon.Lock size={11} /> 已锁定
                  </Badge>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                合计金额
              </div>
              <div
                className="num"
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "var(--ink-900)",
                  letterSpacing: "-0.02em",
                }}
              >
                ¥{total.toLocaleString()}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
              paddingTop: 12,
              borderTop: "1px dashed var(--line)",
            }}
          >
            <KV label="结算周期" w={60}>
              <span className="num">{b.period}</span>
            </KV>
            <KV label="项目" w={36}>
              <span className="mono">{b.project}</span>
            </KV>
            <KV label="创建人" w={50}>
              {b.creator}
            </KV>
            <KV label="更新" w={36}>
              <span className="num" style={{ fontSize: 11.5 }}>
                {b.updated}
              </span>
            </KV>
          </div>
        </div>

        {/* Items */}
        <div
          style={{
            padding: "12px 16px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-700)" }}
          >
            结算明细
          </div>
          <div
            style={{
              display: "flex",
              gap: 6,
              fontSize: 11,
              color: "var(--ink-400)",
            }}
          >
            <span>
              底薪{" "}
              <span
                className="num"
                style={{ color: "var(--ink-700)", fontWeight: 600 }}
              >
                ¥{baseSum.toLocaleString()}
              </span>
            </span>
            <span>·</span>
            <span>
              变动{" "}
              <span
                className="num"
                style={{ color: "var(--ink-700)", fontWeight: 600 }}
              >
                ¥{varSum.toLocaleString()}
              </span>
            </span>
            <span>·</span>
            <span>
              调整{" "}
              <span
                className="num"
                style={{
                  color: adjSum >= 0 ? "var(--ink-700)" : "var(--danger-600)",
                  fontWeight: 600,
                }}
              >
                {adjSum >= 0 ? "+" : ""}
                {adjSum}
              </span>
            </span>
          </div>
        </div>

        <DataTable
          dense
          columns={[
            {
              title: "主播",
              render: (r) => (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar name={r.streamer} size={26} />
                  <div>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--ink-900)",
                      }}
                    >
                      {r.streamer}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 10.5, color: "var(--ink-400)" }}
                    >
                      {r.id}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              title: "结算规则",
              render: (r) => <Badge tone="blue">{r.rule}</Badge>,
            },
            {
              title: "有效时长",
              align: "right",
              render: (r) => (
                <span className="num">{r.hours.toFixed(1)} h</span>
              ),
            },
            {
              title: "其他口径",
              align: "right",
              render: (r) => (
                <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                  {r.qty}
                </span>
              ),
            },
            {
              title: "底薪",
              align: "right",
              render: (r) => (
                <span className="num">
                  {r.base ? "¥" + r.base.toLocaleString() : "—"}
                </span>
              ),
            },
            {
              title: "变动",
              align: "right",
              render: (r) => (
                <span className="num">¥{r.variable.toLocaleString()}</span>
              ),
            },
            {
              title: "调整",
              align: "right",
              render: (r) => (
                <span
                  className="num"
                  style={{
                    color:
                      r.adjust === 0
                        ? "var(--ink-400)"
                        : r.adjust > 0
                          ? "var(--ok-600)"
                          : "var(--danger-600)",
                  }}
                >
                  {r.adjust === 0 ? "—" : (r.adjust > 0 ? "+" : "") + r.adjust}
                </span>
              ),
            },
            {
              title: "小计",
              align: "right",
              render: (r) => (
                <span
                  className="num"
                  style={{ fontWeight: 700, color: "var(--ink-900)" }}
                >
                  ¥{r.total.toLocaleString()}
                </span>
              ),
            },
          ]}
          rows={detailRows}
        />
        {detailMessage ? (
          <div
            aria-live="polite"
            style={{
              padding: "10px 12px 0",
              fontSize: 12,
              color: "var(--ink-500)",
            }}
          >
            {detailMessage}
          </div>
        ) : null}

        {/* Footer: actions */}
        <div
          style={{
            padding: 12,
            borderTop: "1px solid var(--line)",
            background: "var(--bg-soft)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {isLocked && (
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-500)",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon.Lock size={12} stroke="var(--ink-500)" />
              本批次已锁定 · 由 {b.creator} 于 {b.updated}
            </div>
          )}
          <div style={{ flex: 1 }} />
          {isLocked ? (
            <>
              <Button
                kind="ghost"
                icon={<Icon.History size={14} />}
                onClick={() =>
                  showPendingDetail(
                    "批次审计明细后台暂未接入，请查看下方审计轨迹。",
                  )
                }
              >
                查看审计
              </Button>
              <Button
                kind="default"
                icon={<Icon.Export size={14} />}
                onClick={() => showPendingDetail("批次 PDF 导出后台暂未接入。")}
              >
                导出 PDF
              </Button>
              <Button
                kind="danger"
                icon={<Icon.Unlock size={14} />}
                onClick={onReopenBatch}
                disabled={!!busyAction}
              >
                {busyAction === "reopen" ? "处理中…" : "重新打开"}
              </Button>
            </>
          ) : (
            <>
              <Button
                kind="ghost"
                onClick={() =>
                  showPendingDetail("批次编辑已取消，未提交后台变更。")
                }
              >
                取消
              </Button>
              <Button
                kind="default"
                icon={<Icon.Plus size={14} />}
                onClick={onAddManualItem}
                disabled={!!busyAction}
              >
                {busyAction === "manual" ? "处理中…" : "添加人工调整"}
              </Button>
              <Button
                kind="default"
                onClick={() => showPendingDetail("批次草稿保存后台暂未接入。")}
              >
                保存为草稿
              </Button>
              <Button
                kind="primary"
                icon={<Icon.Lock size={14} stroke="#fff" />}
                onClick={onLockBatch}
                disabled={!!busyAction}
              >
                {busyAction === "lock" ? "处理中…" : "确认并锁定"}
              </Button>
            </>
          )}
        </div>
      </Card>

      {/* Audit timeline */}
      <Card title="批次审计轨迹" padded={true}>
        <EmptyHint
          title="暂无审计轨迹"
          hint="批次操作日志会在后端返回后展示。"
        />
      </Card>
    </div>
  );
}

export { ScreenSettlement };
