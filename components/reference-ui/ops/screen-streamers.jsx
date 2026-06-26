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
  STREAMERS,
  useOpsLiveActions,
  useOpsProjects,
  useOpsStreamers,
} from "./data";
import { Icon } from "./icons";
import { EmptyHint, splitDraftList } from "./screen-project";
import {
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  KV,
  MiniBar,
  RiskDot,
  SearchInput,
} from "./ui";

// ——— Screen: 主播资源池 ————————————————————————————

function ScreenStreamers({ go, initialActiveId }) {
  const streamers = useOpsStreamers();
  const actions = useOpsLiveActions();
  const emptyDraft = {
    displayName: "",
    realName: "",
    gender: "",
    sourceType: "external",
    categories: "",
    platforms: "",
    styles: "",
    defaultSettlementMethod: "cpt",
    userId: "",
  };
  const [active, setActive] = React.useState(
    initialActiveId || streamers[3]?.id || streamers[0]?.id,
  );
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(emptyDraft);
  const [draftError, setDraftError] = React.useState("");
  const [draftSubmitting, setDraftSubmitting] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState("all");
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [cooperationFilter, setCooperationFilter] = React.useState("all");
  const [riskFilter, setRiskFilter] = React.useState("all");
  const [importMessage, setImportMessage] = React.useState("");
  const [exportMessage, setExportMessage] = React.useState("");
  const [exportSubmitting, setExportSubmitting] = React.useState(false);
  const draftFieldStyle = {
    width: "100%",
    height: 32,
    border: "1px solid var(--line-strong)",
    borderRadius: 6,
    background: "#fff",
    color: "var(--ink-700)",
    fontSize: 13,
    outline: "none",
    padding: "0 10px",
  };
  const draftLabelStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12,
    color: "var(--ink-500)",
    fontWeight: 600,
    minWidth: 0,
  };
  const updateDraft = (field) => (event) => {
    setDraft((value) => ({ ...value, [field]: event.target.value }));
  };
  const openDraftForm = () => {
    setDraftOpen(true);
    setDraftError("");
  };
  const closeDraftForm = () => {
    setDraftOpen(false);
    setDraftError("");
  };
  const submitStreamerDraft = async (event) => {
    event.preventDefault();
    const displayName = draft.displayName.trim();
    if (!displayName) {
      setDraftError("请填写主播昵称");
      return;
    }

    setDraftSubmitting(true);
    setDraftError("");
    try {
      const body = await actions.createStreamerProfile?.({
        displayName,
        realName: draft.realName.trim(),
        gender: draft.gender,
        sourceType: draft.sourceType,
        categories: splitDraftList(draft.categories),
        platforms: splitDraftList(draft.platforms),
        styles: splitDraftList(draft.styles),
        defaultSettlementMethod: draft.defaultSettlementMethod,
        userId: draft.userId.trim(),
      });
      setDraftOpen(false);
      setDraft(emptyDraft);
      if (body?.streamer?.id) {
        setActive(body.streamer.id);
      }
    } catch (error) {
      setDraftError(error?.message || "创建主播档案失败，请稍后重试");
    } finally {
      setDraftSubmitting(false);
    }
  };
  const query = search.trim().toLowerCase();
  const visibleStreamers = streamers.filter((streamer) => {
    const matchesSearch =
      !query ||
      [
        streamer.alias,
        streamer.real,
        streamer.id,
        streamer.source,
        streamer.supplier,
        streamer.style,
        ...streamer.games,
        ...streamer.platforms,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    const matchesCategory =
      categoryFilter === "all" || streamer.games.includes(categoryFilter);
    const matchesSource =
      sourceFilter === "all" || streamer.source === sourceFilter;
    const matchesCooperation =
      cooperationFilter === "all" || streamer.cooperation === cooperationFilter;
    const matchesRisk = riskFilter === "all" || streamer.risk === riskFilter;
    return (
      matchesSearch &&
      matchesCategory &&
      matchesSource &&
      matchesCooperation &&
      matchesRisk
    );
  });
  React.useEffect(() => {
    if (!visibleStreamers.some((item) => item.id === active)) {
      const nextActive = visibleStreamers[0]?.id ?? null;
      if (nextActive !== active) {
        setActive(nextActive);
      }
    }
  }, [active, visibleStreamers]);
  const exportStreamerPool = async () => {
    setExportSubmitting(true);
    setExportMessage("");
    try {
      await actions.createGovernedExport?.({
        kind: "project_execution",
        rows: visibleStreamers.map((streamer) => ({
          projectName: "主播资源池",
          status: streamer.cooperation === "paused" ? "paused" : "active",
          operatorName: streamer.alias,
        })),
      });
      setExportMessage("导出已生成");
    } catch (error) {
      setExportMessage(error?.message || "导出失败，请稍后重试");
    } finally {
      setExportSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="主播资源池"
        subtitle="不是通讯录 · 用于回答：能不能接？适合接什么？历史表现如何？值不值得继续合作？"
        actions={
          <>
            <Button
              kind="default"
              icon={<Icon.Export size={14} />}
              onClick={exportStreamerPool}
              disabled={exportSubmitting}
            >
              导出主播表
            </Button>
            <Button
              kind="default"
              icon={<Icon.Upload size={14} />}
              onClick={() => setImportMessage("批量导入后端尚未接入")}
            >
              批量导入
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Plus size={14} stroke="#fff" />}
              onClick={openDraftForm}
            >
              新增主播档案
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 20,
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 20,
          alignItems: "flex-start",
        }}
      >
        {/* List */}
        <Card padded={false}>
          {/* Filter strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <SearchInput
              placeholder="主播名 / 真名 / 平台账号"
              value={search}
              onChange={setSearch}
              width={240}
            />
            <StreamerInlineFilter
              label="品类筛选"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={uniqueStreamerListOptions(streamers, "games")}
            />
            <StreamerInlineFilter
              label="来源筛选"
              value={sourceFilter}
              onChange={setSourceFilter}
              options={uniqueStreamerValueOptions(streamers, "source")}
            />
            <StreamerInlineFilter
              label="合作状态筛选"
              value={cooperationFilter}
              onChange={setCooperationFilter}
              options={uniqueStreamerValueOptions(streamers, "cooperation")}
            />
            <select
              aria-label="风险筛选"
              value={riskFilter}
              onChange={(event) => setRiskFilter(event.target.value)}
              style={{
                height: 32,
                border: "1px solid var(--line-strong)",
                borderRadius: 6,
                background: "#fff",
                color: "var(--ink-700)",
                fontSize: 13,
                padding: "0 10px",
                outline: "none",
              }}
            >
              <option value="all">全部风险</option>
              <option value="low">低风险</option>
              <option value="medium">中风险</option>
              <option value="high">高风险</option>
              <option value="blacklisted">黑名单</option>
            </select>
            <div style={{ flex: 1 }} />
            <Badge tone="blue">{visibleStreamers.length} 位主播</Badge>
          </div>
          {exportMessage ? (
            <div
              aria-live="polite"
              style={{
                padding: "8px 16px",
                borderBottom: "1px solid var(--line)",
                background: "var(--blue-50)",
                color: "var(--blue-700)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {exportMessage}
            </div>
          ) : null}
          {importMessage ? (
            <div
              aria-live="polite"
              style={{
                padding: "8px 16px",
                borderBottom: "1px solid var(--line)",
                background: "var(--warn-50)",
                color: "var(--warn-600)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {importMessage}
            </div>
          ) : null}

          {draftOpen ? (
            <form
              onSubmit={submitStreamerDraft}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                alignItems: "end",
                gap: 12,
                padding: "12px 16px",
                borderBottom: "1px solid var(--line)",
                background: "var(--bg-soft)",
              }}
            >
              <label style={draftLabelStyle}>
                主播昵称
                <input
                  value={draft.displayName}
                  onChange={updateDraft("displayName")}
                  placeholder="例如：小鹿"
                  style={draftFieldStyle}
                />
              </label>
              <label style={draftLabelStyle}>
                真实姓名
                <input
                  value={draft.realName}
                  onChange={updateDraft("realName")}
                  placeholder="可选"
                  style={draftFieldStyle}
                />
              </label>
              <label style={draftLabelStyle}>
                性别
                <select
                  value={draft.gender}
                  onChange={updateDraft("gender")}
                  style={draftFieldStyle}
                >
                  <option value="">未填写</option>
                  <option value="女">女</option>
                  <option value="男">男</option>
                  <option value="其他">其他</option>
                </select>
              </label>
              <label style={draftLabelStyle}>
                来源
                <select
                  value={draft.sourceType}
                  onChange={updateDraft("sourceType")}
                  style={draftFieldStyle}
                >
                  <option value="external">外部</option>
                  <option value="signed">签约</option>
                  <option value="self_incubated">自孵化</option>
                  <option value="supplier_recommended">供应商</option>
                  <option value="account_managed">代运营</option>
                </select>
              </label>
              <label style={draftLabelStyle}>
                擅长品类
                <input
                  value={draft.categories}
                  onChange={updateDraft("categories")}
                  placeholder="二游, 卡牌"
                  style={draftFieldStyle}
                />
              </label>
              <label style={draftLabelStyle}>
                平台
                <input
                  value={draft.platforms}
                  onChange={updateDraft("platforms")}
                  placeholder="抖音, 快手"
                  style={draftFieldStyle}
                />
              </label>
              <label style={draftLabelStyle}>
                直播风格
                <input
                  value={draft.styles}
                  onChange={updateDraft("styles")}
                  placeholder="高能整活, 陪伴"
                  style={draftFieldStyle}
                />
              </label>
              <label style={draftLabelStyle}>
                默认结算
                <select
                  value={draft.defaultSettlementMethod}
                  onChange={updateDraft("defaultSettlementMethod")}
                  style={draftFieldStyle}
                >
                  <option value="cpt">CPT</option>
                  <option value="cpa">CPA</option>
                  <option value="cps">CPS</option>
                  <option value="gift">礼物流水</option>
                  <option value="base_salary">保底</option>
                  <option value="base_salary_cpt">保底 + CPT</option>
                  <option value="manual">手动结算</option>
                </select>
              </label>
              <label style={draftLabelStyle}>
                用户 ID
                <input
                  value={draft.userId}
                  onChange={updateDraft("userId")}
                  placeholder="可选绑定登录用户"
                  style={draftFieldStyle}
                />
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 8,
                  minWidth: 160,
                }}
              >
                <Button
                  kind="default"
                  type="button"
                  onClick={closeDraftForm}
                  disabled={draftSubmitting}
                >
                  取消
                </Button>
                <Button
                  kind="primary"
                  type="submit"
                  disabled={draftSubmitting}
                  icon={<Icon.Plus size={14} stroke="#fff" />}
                >
                  {draftSubmitting ? "创建中" : "创建档案"}
                </Button>
              </div>
              {draftError ? (
                <div
                  aria-live="polite"
                  style={{
                    gridColumn: "1 / -1",
                    color: "var(--danger-600)",
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  {draftError}
                </div>
              ) : null}
            </form>
          ) : null}

          <DataTable
            activeRowId={active}
            onRowClick={(r) => setActive(r.id)}
            columns={[
              {
                title: "主播",
                render: (r) => (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <Avatar name={r.alias} size={32} />
                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          color: "var(--ink-900)",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {r.alias}
                        {r.cooperation === "paused" && (
                          <Badge tone="amber">暂停</Badge>
                        )}
                      </div>
                      <div
                        className="mono"
                        style={{ fontSize: 11, color: "var(--ink-400)" }}
                      >
                        {r.id} · {r.real}
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                title: "来源 / 供应商",
                render: (r) => (
                  <div>
                    <Badge
                      tone={
                        r.source === "签约"
                          ? "blue"
                          : r.source === "自孵化"
                            ? "teal"
                            : "neutral"
                      }
                    >
                      {r.source}
                    </Badge>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--ink-400)",
                        marginTop: 4,
                      }}
                    >
                      {r.supplier}
                    </div>
                  </div>
                ),
              },
              {
                title: "擅长品类",
                wrap: true,
                render: (r) => (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {r.games.map((g) => (
                      <Badge key={g} tone="neutral">
                        {g}
                      </Badge>
                    ))}
                  </div>
                ),
              },
              {
                title: "完成率",
                align: "right",
                render: (r) => (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      justifyContent: "flex-end",
                    }}
                  >
                    <MiniBar
                      value={r.metrics.projectFinish}
                      tone={r.metrics.projectFinish >= 90 ? "green" : "blue"}
                      width={56}
                    />
                    <span className="num" style={{ minWidth: 32 }}>
                      {r.metrics.projectFinish}%
                    </span>
                  </div>
                ),
              },
              {
                title: "ROI",
                align: "right",
                render: (r) => (
                  <span
                    className="num"
                    style={{
                      color:
                        r.metrics.roi >= 1.3
                          ? "var(--ok-600)"
                          : r.metrics.roi >= 1
                            ? "var(--ink-900)"
                            : "var(--danger-600)",
                      fontWeight: 600,
                    }}
                  >
                    {r.metrics.roi.toFixed(2)}
                  </span>
                ),
              },
              {
                title: "默认结算",
                render: (r) => <Badge tone="ink">{r.defaultRule}</Badge>,
              },
              { title: "风险", render: (r) => <RiskDot level={r.risk} /> },
            ]}
            rows={visibleStreamers}
            emptyText="暂无匹配主播"
          />
        </Card>

        {/* Detail panel */}
        <StreamerPanel id={active} streamers={visibleStreamers} go={go} />
      </div>
    </>
  );
}

function uniqueStreamerListOptions(streamers, key) {
  return Array.from(
    new Set(
      streamers.flatMap((streamer) => streamer[key] || []).filter(Boolean),
    ),
  );
}

function uniqueStreamerValueOptions(streamers, key) {
  return Array.from(
    new Set(streamers.map((streamer) => streamer[key]).filter(Boolean)),
  );
}

function StreamerInlineFilter({ label, value, onChange, options }) {
  return (
    <div
      style={{
        height: 32,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0 9px",
        border: "1px solid var(--line-strong)",
        borderRadius: 6,
        background: "#fff",
        color: "var(--ink-500)",
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      <Icon.Filter size={13} />
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--ink-700)",
          fontSize: 12,
          maxWidth: 96,
        }}
      >
        <option value="all">全部</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function StreamerPanel({ id, streamers = STREAMERS, go }) {
  const actions = useOpsLiveActions();
  const projects = useOpsProjects();
  const s = streamers.find((x) => x.id === id);
  const [riskOpen, setRiskOpen] = React.useState(false);
  const [riskLevel, setRiskLevel] = React.useState("low");
  const [riskReason, setRiskReason] = React.useState("");
  const [riskError, setRiskError] = React.useState("");
  const [riskSubmitting, setRiskSubmitting] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteProjectId, setInviteProjectId] = React.useState("");
  const [inviteMessage, setInviteMessage] = React.useState("");
  const [inviteError, setInviteError] = React.useState("");
  const [inviteSubmitting, setInviteSubmitting] = React.useState(false);
  React.useEffect(() => {
    if (!s) return;
    setRiskLevel(s.risk || "low");
    setRiskReason("");
    setRiskError("");
    setRiskOpen(false);
    setInviteOpen(false);
    setInviteError("");
    setInviteMessage("");
  }, [s?.id, s?.risk]);
  React.useEffect(() => {
    if (!inviteProjectId && projects[0]?.id) {
      setInviteProjectId(projects[0].id);
    }
  }, [inviteProjectId, projects]);
  if (!s) {
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
            title="未选中主播"
            hint="调整搜索或筛选条件后再查看主播档案。"
          />
        </Card>
      </div>
    );
  }
  const panelFieldStyle = {
    width: "100%",
    minHeight: 32,
    border: "1px solid var(--line-strong)",
    borderRadius: 6,
    background: "#fff",
    color: "var(--ink-700)",
    fontSize: 13,
    outline: "none",
    padding: "0 10px",
  };
  const panelLabelStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12,
    color: "var(--ink-500)",
    fontWeight: 600,
  };
  const openRiskForm = () => {
    setRiskOpen(true);
    setRiskError("");
  };
  const submitRiskUpdate = async (event) => {
    event.preventDefault();
    const reason = riskReason.trim();
    if (!reason) {
      setRiskError("请填写风险原因");
      return;
    }

    setRiskSubmitting(true);
    setRiskError("");
    try {
      await actions.updateStreamerRisk?.(s.id, {
        riskLevel,
        riskReason: reason,
        reason,
      });
      setRiskOpen(false);
      setRiskReason("");
    } catch (error) {
      setRiskError(error?.message || "风险更新失败，请稍后重试");
    } finally {
      setRiskSubmitting(false);
    }
  };
  const openInviteForm = () => {
    setInviteOpen(true);
    setInviteError("");
    setInviteMessage("");
    setInviteProjectId((value) => value || projects[0]?.id || "");
  };
  const submitInvitation = async (event) => {
    event.preventDefault();
    const projectId = inviteProjectId || projects[0]?.id;
    if (!projectId) {
      setInviteError("请先选择项目");
      return;
    }

    setInviteSubmitting(true);
    setInviteError("");
    try {
      await actions.inviteStreamerToProject?.(projectId, s.id);
      setInviteOpen(false);
      setInviteMessage("已发起邀约");
    } catch (error) {
      setInviteError(error?.message || "邀约失败，请稍后重试");
    } finally {
      setInviteSubmitting(false);
    }
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
      <Card padded={true}>
        <div style={{ display: "flex", gap: 14 }}>
          <Avatar name={s.alias} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: "var(--ink-900)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {s.alias}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
                  {s.real} · {s.gender} · <span className="mono">{s.id}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  title="编辑档案"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: "1px solid var(--line-strong)",
                    background: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    color: "var(--ink-500)",
                    transition: "all 100ms",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--blue-50)";
                    e.currentTarget.style.borderColor = "var(--blue-500)";
                    e.currentTarget.style.color = "var(--blue-700)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#fff";
                    e.currentTarget.style.borderColor = "var(--line-strong)";
                    e.currentTarget.style.color = "var(--ink-500)";
                  }}
                >
                  <Icon.Pencil size={14} />
                </button>
                <button
                  title="更多操作"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: "1px solid var(--line-strong)",
                    background: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    color: "var(--ink-500)",
                  }}
                >
                  <Icon.More size={14} />
                </button>
              </div>
            </div>
            <div
              style={{
                marginTop: 6,
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <Badge tone="blue">{s.source}</Badge>
              <Badge tone="green" dot>
                合作中
              </Badge>
              <Badge
                tone={
                  s.risk === "low"
                    ? "neutral"
                    : s.risk === "medium"
                      ? "amber"
                      : "red"
                }
                dot
              >
                风险 {s.risk}
              </Badge>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: "1px solid var(--line)",
          }}
        >
          <KV label="供应商来源">{s.supplier}</KV>
          <KV label="擅长品类">
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {s.games.map((g) => (
                <Badge key={g} tone="neutral">
                  {g}
                </Badge>
              ))}
            </div>
          </KV>
          <KV label="平台账号">
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {s.platforms.map((p) => (
                <Badge key={p} tone="violet">
                  {p}
                </Badge>
              ))}
            </div>
          </KV>
          <KV label="风格">{s.style}</KV>
          <KV label="默认结算">
            <Badge tone="blue">{s.defaultRule}</Badge>
          </KV>
        </div>
      </Card>

      <Card title="经营画像 · 近 90 天" padded={true}>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
        >
          <RingMetric
            label="录屏通过率"
            value={s.metrics.screenPass}
            max={100}
            suffix="%"
          />
          <RingMetric
            label="项目完成率"
            value={s.metrics.projectFinish}
            max={100}
            suffix="%"
          />
          <RingMetric
            label="ROI"
            value={s.metrics.roi}
            max={2}
            dp={2}
            highlight
          />
          <RingMetric
            label="毛利贡献"
            value={`¥${(s.metrics.grossContrib / 1000).toFixed(1)}k`}
            raw
          />
        </div>

        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px dashed var(--line)",
          }}
        >
          <div
            style={{ fontSize: 11, color: "var(--ink-400)", marginBottom: 6 }}
          >
            近 6 周匹配分趋势
          </div>
          <Sparkline data={[78, 81, 83, 86, 90, s.matchScore]} />
        </div>
      </Card>

      <Card
        title="参与项目"
        extra={
          <Button size="sm" kind="link" onClick={() => go?.("projects")}>
            查看全部
          </Button>
        }
        padded={false}
      >
        <EmptyHint
          title="暂无参与项目"
          hint="接入真实主播履约记录后会展示项目贡献。"
        />
      </Card>

      {riskOpen ? (
        <Card title="设置风险" padded={true}>
          <form
            onSubmit={submitRiskUpdate}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <label style={panelLabelStyle}>
              风险等级
              <select
                value={riskLevel}
                onChange={(event) => setRiskLevel(event.target.value)}
                style={panelFieldStyle}
              >
                <option value="low">低风险</option>
                <option value="medium">中风险</option>
                <option value="high">高风险</option>
                <option value="blacklisted">黑名单</option>
              </select>
            </label>
            <label style={panelLabelStyle}>
              风险原因
              <textarea
                value={riskReason}
                onChange={(event) => setRiskReason(event.target.value)}
                rows={3}
                placeholder="例如：连续两次异常报数"
                style={{ ...panelFieldStyle, padding: 10, lineHeight: 1.5 }}
              />
            </label>
            {riskError ? (
              <div
                aria-live="polite"
                style={{
                  color: "var(--danger-600)",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                {riskError}
              </div>
            ) : null}
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <Button
                kind="default"
                type="button"
                disabled={riskSubmitting}
                onClick={() => setRiskOpen(false)}
              >
                取消
              </Button>
              <Button kind="primary" type="submit" disabled={riskSubmitting}>
                {riskSubmitting ? "更新中" : "更新风险"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {inviteOpen ? (
        <Card title="邀请加入项目" padded={true}>
          <form
            onSubmit={submitInvitation}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <label style={panelLabelStyle}>
              邀约项目
              <select
                value={inviteProjectId}
                onChange={(event) => setInviteProjectId(event.target.value)}
                style={panelFieldStyle}
              >
                {projects.length === 0 ? (
                  <option value="">暂无可邀约项目</option>
                ) : (
                  projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            {inviteError ? (
              <div
                aria-live="polite"
                style={{
                  color: "var(--danger-600)",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                {inviteError}
              </div>
            ) : null}
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <Button
                kind="default"
                type="button"
                disabled={inviteSubmitting}
                onClick={() => setInviteOpen(false)}
              >
                取消
              </Button>
              <Button kind="primary" type="submit" disabled={inviteSubmitting}>
                {inviteSubmitting ? "邀约中" : "确认邀约"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {inviteMessage ? (
        <div
          aria-live="polite"
          style={{
            padding: "10px 12px",
            border: "1px solid #B7E6CE",
            borderRadius: 8,
            background: "#ECFDF3",
            color: "var(--ok-600)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {inviteMessage}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <Button kind="default" style={{ flex: 1 }} onClick={openRiskForm}>
          设置风险
        </Button>
        <Button kind="primary" style={{ flex: 1 }} onClick={openInviteForm}>
          邀请加入项目
        </Button>
      </div>
    </div>
  );
}

function RingMetric({
  label,
  value,
  max = 100,
  suffix = "",
  dp = 0,
  raw = false,
  highlight = false,
}) {
  let pct = 0;
  let display = value;
  if (!raw && typeof value === "number") {
    pct = Math.min(100, (value / max) * 100);
    display = dp ? value.toFixed(dp) : value;
  } else {
    pct = 75; // visual default
  }
  const size = 64,
    stroke = 6,
    r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = highlight ? "var(--violet-600)" : "var(--blue-600)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--ink-50)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div>
        <div style={{ fontSize: 11, color: "var(--ink-400)" }}>{label}</div>
        <div
          className="num"
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "var(--ink-900)",
            letterSpacing: "-0.01em",
          }}
        >
          {display}
          {suffix}
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data, w = 280, h = 40 }) {
  const min = Math.min(...data),
    max = Math.max(...data);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / (max - min || 1)) * (h - 8) - 4;
    return [x, y];
  });
  const path = pts
    .map((p, i) => (i === 0 ? "M" : "L") + p[0] + " " + p[1])
    .join(" ");
  const area = path + ` L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1E50C8" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#1E50C8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sg)" />
      <path
        d={path}
        fill="none"
        stroke="#1E50C8"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i === pts.length - 1 ? 3 : 2}
          fill={i === pts.length - 1 ? "#1E50C8" : "#fff"}
          stroke="#1E50C8"
          strokeWidth="1.4"
        />
      ))}
    </svg>
  );
}

export { ScreenStreamers };
