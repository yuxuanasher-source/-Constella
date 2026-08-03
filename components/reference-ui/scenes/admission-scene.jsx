"use client";
/* eslint-disable */
import React from "react";

let AdmissionCalibrationDashboard,
  AdmissionShareCenter,
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyHint,
  OpsLiveDataContext,
  PageHeader,
  SearchInput,
  StatusPill,
  Tabs,
  archiveTranscriptToKnowledgeBase,
  builderRuleFromStored,
  displayRecordId,
  formatOpsMinute,
  formatTranscriptClock,
  isUuidLikeId,
  normalizeReportPreReview,
  useOpsApplications,
  useOpsCurrentUser,
  useOpsLiveActions,
  warnBackgroundRefreshFailure,
  yuanInputToCents;

let configuredAdmissionDependencies = null;

export function configureAdmissionScene(dependencies) {
  if (configuredAdmissionDependencies) {
    if (configuredAdmissionDependencies !== dependencies) {
      throw new Error("Admission scene dependencies cannot be reconfigured");
    }
    return;
  }
  ({
    AdmissionCalibrationDashboard,
    AdmissionShareCenter,
    Avatar,
    Badge,
    Button,
    Card,
    DataTable,
    EmptyHint,
    OpsLiveDataContext,
    PageHeader,
    SearchInput,
    StatusPill,
    Tabs,
    archiveTranscriptToKnowledgeBase,
    builderRuleFromStored,
    displayRecordId,
    formatOpsMinute,
    formatTranscriptClock,
    isUuidLikeId,
    normalizeReportPreReview,
    useOpsApplications,
    useOpsCurrentUser,
    useOpsLiveActions,
    warnBackgroundRefreshFailure,
    yuanInputToCents,
  } = dependencies);
  configuredAdmissionDependencies = dependencies;
}

export default function ScreenAdmission({ focusRequest = null }) {
  if (!configuredAdmissionDependencies) {
    throw new Error("Admission scene dependencies are not configured");
  }
  const applications = useOpsApplications();
  const { applications: applicationData } =
    React.useContext(OpsLiveDataContext);
  const actions = useOpsLiveActions();
  const currentUser = useOpsCurrentUser();
  // 与后端 rejectApplicationJoin 的角色门控一致：仅 owner / ops_manager 可最终拒绝入项。
  const canRejectJoin =
    currentUser.role === "owner" || currentUser.role === "ops_manager";
  const canProxyUploadRecording = [
    "owner",
    "ops_manager",
    "operator_business",
  ].includes(currentUser.role);
  const [projectBoards, setProjectBoards] = React.useState(null);
  const [calibrationMetrics, setCalibrationMetrics] = React.useState(null);
  const [calibrationMetricsError, setCalibrationMetricsError] =
    React.useState("");
  const [calibrationMetricsLoading, setCalibrationMetricsLoading] =
    React.useState(false);
  // 行内抽屉展开的项目：默认全部收起，点谁展开谁，明细跟随行出现。
  const [expandedProjectId, setExpandedProjectId] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [admissionMessage, setAdmissionMessage] = React.useState("");
  const [busyAction, setBusyAction] = React.useState("");
  const [selectedAiAnalysis, setSelectedAiAnalysis] = React.useState(null);
  const [shareCenterProject, setShareCenterProject] = React.useState(null);
  // 私有录屏内嵌播放弹层：存 { assetId, streamerName }，null 表示关闭。
  const [playbackRecording, setPlaybackRecording] = React.useState(null);
  // 录屏审核工作台：非空时主体切换为「左队列 + 右播放审核」双栏视图（页头保持）。
  const [workspaceProjectId, setWorkspaceProjectId] = React.useState("");

  React.useEffect(() => {
    const projectId = String(focusRequest?.projectId || "").trim();
    setSearchQuery(projectId);
    setExpandedProjectId(projectId);
    setWorkspaceProjectId("");
  }, [focusRequest?.requestId]);

  const syncAdmissionProjectBoards = async () => {
    if (!actions.refreshAdmissionProjectBoards) {
      return;
    }
    const projects = await actions.refreshAdmissionProjectBoards();
    if (!Array.isArray(projects)) {
      return;
    }
    setProjectBoards(projects);
  };

  const loadAdmissionCalibrationMetrics = async () => {
    if (!actions.refreshAdmissionReviewMetrics) {
      setCalibrationMetricsError("组织审核校准指标后台暂未接入。");
      return;
    }
    setCalibrationMetricsLoading(true);
    setCalibrationMetricsError("");
    try {
      const metrics = await actions.refreshAdmissionReviewMetrics();
      setCalibrationMetrics(Array.isArray(metrics) ? metrics : []);
    } catch (error) {
      setCalibrationMetricsError(error?.message || "组织审核校准指标加载失败");
    } finally {
      setCalibrationMetricsLoading(false);
    }
  };

  // 返回是否审核成功：工作台据此决定是否自动跳到下一条待审核。
  const review = async (application, decision) => {
    if (!actions.reviewApplicationRecording) {
      setAdmissionMessage("录屏审核后台暂未接入。");
      return false;
    }
    const reviewNote = admissionRecordingReviewNote(application, decision);
    // 驳回/需修改时按卡点字典选择结构化理由码（沉淀审核信号）。
    let reasonCodes = [];
    let checkpointResults = [];
    if (decision === "rejected" || decision === "needs_changes") {
      const checkpoints = await loadMcnReviewCheckpoints();
      if (checkpoints.length > 0) {
        const picked = askAdmissionReasonCodes(checkpoints, decision);
        if (picked === null) {
          setAdmissionMessage("操作已取消：驳回或需修改需选择理由卡点");
          return false;
        }
        reasonCodes = picked;
        const structuredFeedback = askAdmissionStructuredFeedback(decision);
        if (structuredFeedback === null) {
          setAdmissionMessage("操作已取消：反馈需填写哪里不合格和怎么改");
          return false;
        }
        checkpointResults = reasonCodes.map((checkpointKey) => ({
          checkpointKey,
          verdict: "fail",
          note: reviewNote,
          evidence: {
            structuredFeedback,
          },
        }));
      }
    }
    const applicationId = application.id;
    setBusyAction(`review:${applicationId}:${decision}`);
    setAdmissionMessage("");
    try {
      const reviewPayload = {
        decision,
        note: reviewNote,
        reasonCodes,
      };
      if (checkpointResults.length > 0) {
        reviewPayload.checkpointResults = checkpointResults;
      }
      await actions.reviewApplicationRecording(applicationId, reviewPayload);
      await syncAdmissionProjectBoards();
      setAdmissionMessage(recordingDecisionSuccessMessage(decision));
      return true;
    } catch (error) {
      setAdmissionMessage(error?.message || "录屏审核失败，请稍后重试");
      return false;
    } finally {
      setBusyAction("");
    }
  };

  const requestAiAnalysis = async (application) => {
    const assetId = application.latestRecording?.assetId;
    if (!assetId) {
      setAdmissionMessage("该录屏尚未归档为统一资产，暂不能发起 AI 分析。");
      return;
    }
    if (!actions.requestRecordingAiAnalysis) {
      setAdmissionMessage("录屏 AI 分析后台暂未接入。");
      return;
    }
    setBusyAction(`ai:${application.id}`);
    setAdmissionMessage("");
    try {
      await actions.requestRecordingAiAnalysis(assetId);
      await syncAdmissionProjectBoards();
      setAdmissionMessage("AI 分析已排队");
    } catch (error) {
      setAdmissionMessage(error?.message || "AI 分析发起失败，请稍后重试");
    } finally {
      setBusyAction("");
    }
  };

  const confirmAiProfileInsight = async (analysis) => {
    const assetId = analysis?.assetId;
    if (!assetId) {
      setAdmissionMessage("该录屏尚未归档为统一资产，暂不能沉淀画像。");
      return;
    }
    if (!actions.confirmRecordingProfileInsight) {
      setAdmissionMessage("主播画像沉淀后台暂未接入。");
      return;
    }
    setBusyAction(`profile-insight:${assetId}`);
    setAdmissionMessage("");
    try {
      await actions.confirmRecordingProfileInsight(assetId);
      setAdmissionMessage("AI 观察已沉淀到主播画像");
    } catch (error) {
      setAdmissionMessage(error?.message || "主播画像沉淀失败，请稍后重试");
    } finally {
      setBusyAction("");
    }
  };

  const confirmJoin = async (applicationId) => {
    if (!actions.confirmApplicationJoin) {
      setAdmissionMessage("二次确认后台暂未接入。");
      return;
    }
    setBusyAction(`confirm:${applicationId}`);
    setAdmissionMessage("");
    try {
      await actions.confirmApplicationJoin(applicationId);
      await syncAdmissionProjectBoards();
      setAdmissionMessage("二次确认已完成");
    } catch (error) {
      setAdmissionMessage(error?.message || "二次确认失败，请稍后重试");
    } finally {
      setBusyAction("");
    }
  };

  const rejectJoin = async (applicationId) => {
    if (!actions.rejectApplicationJoin) {
      setAdmissionMessage("拒绝入项后台暂未接入。");
      return;
    }
    const reason = askText("拒绝入项原因");
    if (!reason) {
      setAdmissionMessage("操作已取消：拒绝入项需填写原因");
      return;
    }
    setBusyAction(`reject-join:${applicationId}`);
    setAdmissionMessage("");
    try {
      await actions.rejectApplicationJoin(applicationId, { reason });
      await syncAdmissionProjectBoards();
      setAdmissionMessage("已拒绝入项");
    } catch (error) {
      setAdmissionMessage(error?.message || "拒绝入项失败，请稍后重试");
    } finally {
      setBusyAction("");
    }
  };

  const proxyUploadRecording = async (application) => {
    if (!actions.proxyUploadApplicationRecording) {
      setAdmissionMessage("运营代传后台暂未接入。");
      return;
    }
    const externalUrl = askText("录屏外链（仅支持 http(s)）");
    if (!externalUrl) {
      setAdmissionMessage("操作已取消：请填写录屏外链");
      return;
    }
    if (!isHttpUrl(externalUrl)) {
      setAdmissionMessage("录屏外链仅支持 http(s) URL");
      return;
    }

    setBusyAction(`proxy-upload:${application.id}`);
    setAdmissionMessage("");
    try {
      await actions.proxyUploadApplicationRecording(
        application.id,
        externalUrl,
      );
      await syncAdmissionProjectBoards();
      setAdmissionMessage("已由运营代传，待审核");
    } catch (error) {
      setAdmissionMessage(error?.message || "运营代传失败，请稍后重试");
    } finally {
      setBusyAction("");
    }
  };
  const boards = projectBoards ?? buildAdmissionProjectBoards(applications);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleBoards = normalizedQuery
    ? boards.filter((board) => {
        const project = board.project ?? {};
        const projectText = [
          project.name,
          project.code,
          project.id,
          project.vendor,
          project.product,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (projectText.includes(normalizedQuery)) return true;
        return applications.some(
          (application) =>
            admissionProjectId(application) === project.id &&
            [application.streamer?.displayName, application.id]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery),
        );
      })
    : boards;

  React.useEffect(() => {
    let active = true;
    if (!actions.refreshAdmissionProjectBoards) {
      return () => {
        active = false;
      };
    }
    actions
      .refreshAdmissionProjectBoards()
      .then((projects) => {
        if (!active || !Array.isArray(projects)) return;
        setProjectBoards(projects);
      })
      .catch((error) =>
        warnBackgroundRefreshFailure("admission project board", error),
      );
    return () => {
      active = false;
    };
  }, [actions]);

  React.useEffect(() => {
    loadAdmissionCalibrationMetrics();
  }, [actions]);

  // B6：m3 页 SSR 不再预取报名队列，挂载后按需拉取（与看板刷新并行）。
  // 抽屉明细 / 录屏审核工作台 / 分享筛选都依赖这份 applications 数据。
  React.useEffect(() => {
    if (applicationData == null && actions.refreshApplications) {
      actions
        .refreshApplications()
        .catch((error) =>
          warnBackgroundRefreshFailure("admission queue", error),
        );
    }
  }, [actions, applicationData]);

  const toggleProject = (board) => {
    setExpandedProjectId((current) =>
      current === board.project.id ? "" : board.project.id,
    );
  };

  const exportAdmissionRecordings = async (board) => {
    if (!actions.exportAdmissionRecordings) {
      setAdmissionMessage("录屏表导出后台暂未接入。");
      return;
    }
    setBusyAction(`export:${board.project.id}`);
    setAdmissionMessage("");
    try {
      const result = await actions.exportAdmissionRecordings(board.project.id);
      downloadAdmissionExport(result);
      setAdmissionMessage(
        result?.filename
          ? `录屏表导出已生成：${result.filename}`
          : "录屏表导出已生成",
      );
    } catch (error) {
      setAdmissionMessage(error?.message || "录屏表导出失败，请稍后重试");
    } finally {
      setBusyAction("");
    }
  };

  // 项目行下方的抽屉：该项目全部准入明细，展开即见，不再跳到页面底部。
  const renderBoardDrawer = (board) => {
    const boardApplications = applications.filter(
      (application) => admissionProjectId(application) === board.project.id,
    );
    const projectMeta = [board.project.product, board.project.vendor]
      .filter(Boolean)
      .join(" · ");
    return (
      <div style={{ padding: "12px 16px 16px 36px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}
          >
            {board.project.name || "项目"} · 录屏明细
          </span>
          {projectMeta ? (
            <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
              {projectMeta}
            </span>
          ) : null}
          <Badge tone="blue">共 {boardApplications.length} 条</Badge>
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid var(--line)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <DataTable
            dense
            rows={boardApplications}
            emptyText="该项目暂无准入明细"
            columns={[
              {
                title: "报名编号",
                render: (r) => (
                  <span className="mono" style={{ fontSize: 12 }}>
                    {displayRecordId(r.id, "报名记录")}
                  </span>
                ),
              },
              {
                title: "主播",
                render: (r) => (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <Avatar name={r.streamer?.displayName} size={24} />
                    <div>
                      <div>{r.streamer?.displayName}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                        {admissionAccountLabel(r)}
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                title: "录屏",
                render: (r) => {
                  const externalUrl = r.latestRecording?.externalUrl || null;
                  const canPlayPrivate = Boolean(
                    r.latestRecording?.hasPrivateStorage &&
                    r.latestRecording?.assetId,
                  );
                  return (
                    <div>
                      <Badge tone={r.latestRecording ? "violet" : "amber"}>
                        {r.latestRecording
                          ? r.latestRecording.status
                          : "待上传"}
                      </Badge>
                      <div
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: "var(--ink-400)",
                          marginTop: 4,
                        }}
                      >
                        {displayRecordId(r.latestRecording?.id, "暂无录屏")}
                        {r.latestRecording?.version
                          ? ` · v${r.latestRecording.version}`
                          : ""}
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {externalUrl ? (
                          <a
                            href={externalUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              fontSize: 12,
                              fontWeight: 500,
                              color: "var(--blue-600)",
                              textDecoration: "none",
                            }}
                          >
                            查看录屏
                          </a>
                        ) : null}
                        {canPlayPrivate ? (
                          <Button
                            size="sm"
                            kind="link"
                            style={{ height: 22, padding: 0 }}
                            onClick={() =>
                              setPlaybackRecording({
                                assetId: r.latestRecording.assetId,
                                streamerName: r.streamer?.displayName || "",
                                // 逐字稿空态需要区分「未分析 / 分析中 / 已完成」，
                                // 弹层里拿不到整条 application，这里顺手带上。
                                aiAnalysisStatus:
                                  r.latestRecording?.aiAnalysis?.status ?? null,
                              })
                            }
                          >
                            播放录屏
                          </Button>
                        ) : null}
                        {!externalUrl && !canPlayPrivate ? (
                          <span
                            style={{ fontSize: 12, color: "var(--ink-400)" }}
                          >
                            无录屏
                          </span>
                        ) : null}
                      </div>
                      <RecordingAiAnalysisInline
                        analysis={r.latestRecording?.aiAnalysis}
                        onOpen={() =>
                          setSelectedAiAnalysis(r.latestRecording?.aiAnalysis)
                        }
                      />
                    </div>
                  );
                },
              },
              {
                title: "厂家决策",
                render: (r) => (
                  <div>
                    <Badge tone={vendorDecisionTone(r.vendorReview?.decision)}>
                      {vendorDecisionLabel(r.vendorReview?.decision)}
                    </Badge>
                    {r.vendorReview?.remark ? (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: "var(--ink-500)",
                        }}
                      >
                        {r.vendorReview.remark}
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "状态",
                render: (r) => <Badge tone="neutral">{r.status}</Badge>,
              },
              {
                title: "操作",
                render: (r) => {
                  const reviewable = isAdmissionRecordingReviewable(r);
                  const confirmable =
                    r.status === "recording_approved" &&
                    r.vendorReview?.decision === "selected";
                  const proxyUploadable =
                    canProxyUploadRecording &&
                    canProxyUploadAdmissionRecording(r);
                  if (!reviewable && !confirmable && !proxyUploadable) {
                    return (
                      <span style={{ color: "var(--ink-400)" }}>
                        {admissionNextActionLabel(r)}
                      </span>
                    );
                  }
                  return (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {proxyUploadable && !reviewable && !confirmable ? (
                        <span style={{ color: "var(--ink-400)" }}>
                          {admissionNextActionLabel(r)}
                        </span>
                      ) : null}
                      {proxyUploadable ? (
                        <Button
                          size="sm"
                          kind="default"
                          onClick={() => proxyUploadRecording(r)}
                          disabled={busyAction === `proxy-upload:${r.id}`}
                        >
                          {busyAction === `proxy-upload:${r.id}`
                            ? "代传中..."
                            : "代传录屏"}
                        </Button>
                      ) : null}
                      {reviewable ? (
                        <>
                          {canRequestAdmissionRecordingAiAnalysis(r) ? (
                            <Button
                              size="sm"
                              kind="default"
                              onClick={() => requestAiAnalysis(r)}
                              disabled={busyAction === `ai:${r.id}`}
                            >
                              {r.latestRecording?.aiAnalysis?.status ===
                              "failed"
                                ? "重试 AI 分析"
                                : "发起 AI 分析"}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            kind="default"
                            onClick={() => review(r, "needs_changes")}
                            disabled={
                              busyAction === `review:${r.id}:needs_changes`
                            }
                          >
                            需补充
                          </Button>
                          <Button
                            size="sm"
                            kind="default"
                            onClick={() => review(r, "rejected")}
                            disabled={busyAction === `review:${r.id}:rejected`}
                          >
                            驳回
                          </Button>
                          <Button
                            size="sm"
                            kind="primary"
                            onClick={() => review(r, "approved")}
                            disabled={busyAction === `review:${r.id}:approved`}
                          >
                            通过
                          </Button>
                        </>
                      ) : null}
                      {confirmable ? (
                        <>
                          <Button
                            size="sm"
                            kind="default"
                            onClick={() => confirmJoin(r.id)}
                            disabled={busyAction === `confirm:${r.id}`}
                          >
                            二次确认
                          </Button>
                          {canRejectJoin ? (
                            <Button
                              size="sm"
                              kind="danger"
                              onClick={() => rejectJoin(r.id)}
                              disabled={busyAction === `reject-join:${r.id}`}
                            >
                              拒绝入项
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  );
                },
              },
            ]}
          />
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="选播准入"
        subtitle="点击项目行即可展开该项目的录屏明细，审核完成后可创建厂家分享链接"
      />
      <div style={{ padding: 20 }}>
        {workspaceProjectId ? (
          <AdmissionReviewWorkspace
            board={
              boards.find((board) => board.project.id === workspaceProjectId) ??
              null
            }
            rows={applications.filter(
              (application) =>
                admissionProjectId(application) === workspaceProjectId,
            )}
            message={admissionMessage}
            busyAction={busyAction}
            onBack={() => setWorkspaceProjectId("")}
            onReview={review}
            onOpenAiAnalysis={setSelectedAiAnalysis}
            fetchPreReview={actions.fetchAdmissionPreReview}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <AdmissionCalibrationDashboard
              metrics={calibrationMetrics}
              loading={calibrationMetricsLoading}
              error={calibrationMetricsError}
              onRetry={loadAdmissionCalibrationMetrics}
            />
            <Card title="项目准入板" padded={false}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <SearchInput
                  placeholder="项目 / 主播 / 报名编号"
                  width={260}
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
                <Badge tone="blue">
                  {normalizedQuery
                    ? `${visibleBoards.length}/${boards.length} 个项目`
                    : `${boards.length} 个项目`}
                </Badge>
                <Badge tone="violet">{applications.length} 条准入记录</Badge>
              </div>
              {admissionMessage ? (
                <div
                  aria-live="polite"
                  style={{
                    padding: "10px 16px",
                    fontSize: 12,
                    borderBottom: "1px solid var(--line)",
                    background: admissionMessage.includes("失败")
                      ? "#FDECEC"
                      : "var(--bg-soft)",
                    color: admissionMessage.includes("失败")
                      ? "var(--danger-600)"
                      : "var(--ink-600)",
                  }}
                >
                  {admissionMessage}
                </div>
              ) : null}
              <DataTable
                rows={visibleBoards}
                rowId={(board) => board.project.id}
                emptyText={normalizedQuery ? "没有匹配的项目" : "暂无准入项目"}
                onRowClick={toggleProject}
                expandedRowId={expandedProjectId}
                renderExpanded={renderBoardDrawer}
                columns={[
                  {
                    title: "项目",
                    render: (board) => (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            fontSize: 10,
                            color: "var(--ink-400)",
                            display: "inline-block",
                            transition: "transform 120ms ease",
                            transform:
                              expandedProjectId === board.project.id
                                ? "rotate(90deg)"
                                : "none",
                          }}
                        >
                          ▶
                        </span>
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {board.project.name}
                          </div>
                          <div
                            className="mono"
                            style={{ fontSize: 11, color: "var(--ink-400)" }}
                          >
                            {board.project.code ||
                              displayRecordId(board.project.id)}
                          </div>
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: "MCN 进度",
                    render: (board) => (
                      <div
                        style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                      >
                        <Badge tone="blue">
                          录屏 {board.counts.recordingCount}/
                          {board.counts.totalApplications}
                        </Badge>
                        <Badge tone="amber">
                          待审 {board.counts.mcnPendingReview}
                        </Badge>
                        <Badge tone="teal">
                          待确认 {board.counts.pendingFinalConfirm}
                        </Badge>
                      </div>
                    ),
                  },
                  {
                    title: "厂家反馈",
                    render: (board) => (
                      <div
                        style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                      >
                        <Badge tone="teal">
                          厂家已选 {board.counts.vendorSelected}
                        </Badge>
                        <Badge tone="amber">
                          备选 {board.counts.vendorBackup}
                        </Badge>
                        <Badge tone="red">
                          拒绝 {board.counts.vendorRejected}
                        </Badge>
                      </div>
                    ),
                  },
                  {
                    title: "分享状态",
                    render: (board) => (
                      <Badge
                        tone={
                          board.share?.status === "active" ? "green" : "neutral"
                        }
                      >
                        {admissionShareStatusLabel(board.share?.status)}
                      </Badge>
                    ),
                  },
                  {
                    title: "操作",
                    render: (board) => (
                      <div
                        style={{ display: "flex", gap: 6 }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Button
                          size="sm"
                          kind="primary"
                          onClick={() =>
                            setWorkspaceProjectId(board.project.id)
                          }
                        >
                          进入录屏审核
                        </Button>
                        <Button
                          size="sm"
                          kind="default"
                          onClick={() => toggleProject(board)}
                        >
                          {expandedProjectId === board.project.id
                            ? "收起明细"
                            : "展开明细"}
                        </Button>
                        <Button
                          size="sm"
                          kind="default"
                          onClick={() => exportAdmissionRecordings(board)}
                          disabled={busyAction === `export:${board.project.id}`}
                        >
                          导出录屏表
                        </Button>
                        <Button
                          size="sm"
                          kind="default"
                          onClick={() => setShareCenterProject(board.project)}
                        >
                          录屏分享中心
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
          </div>
        )}
        {shareCenterProject ? (
          <React.Suspense
            fallback={
              <div
                role="status"
                aria-label="录屏分享中心加载中"
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 100,
                  display: "grid",
                  placeItems: "center",
                  background: "rgba(15, 23, 42, 0.28)",
                  color: "var(--ink-700)",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    padding: "12px 16px",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    background: "#fff",
                    boxShadow: "0 16px 40px rgba(15, 23, 42, 0.18)",
                  }}
                >
                  正在加载录屏分享中心…
                </span>
              </div>
            }
          >
            <AdmissionShareCenter
              project={shareCenterProject}
              actions={actions}
              onClose={() => setShareCenterProject(null)}
            />
          </React.Suspense>
        ) : null}
        {playbackRecording ? (
          <RecordingPlaybackDialog
            recording={playbackRecording}
            onClose={() => setPlaybackRecording(null)}
          />
        ) : null}
        {selectedAiAnalysis ? (
          <RecordingAiAnalysisDetailsPanel
            analysis={selectedAiAnalysis}
            onClose={() => setSelectedAiAnalysis(null)}
            onConfirmProfileInsight={() =>
              confirmAiProfileInsight(selectedAiAnalysis)
            }
            confirmProfileDisabled={
              busyAction === `profile-insight:${selectedAiAnalysis.assetId}`
            }
          />
        ) : null}
      </div>
    </>
  );
}

// 私有录屏内嵌播放弹层：video 直接指向签名播放端点（服务端 302 到 1h 签名 URL，
// video 会自动跟随重定向）。
// 播放窗旁挂载直播逐字稿面板（RecordingTranscriptPanel）：宽屏侧栏、窄屏折行。
function RecordingPlaybackDialog({ recording, onClose }) {
  const [videoError, setVideoError] = React.useState(false);
  const videoRef = React.useRef(null);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="播放录屏"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(15,23,42,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(1080px, 100%)",
          maxHeight: "min(860px, 92vh)",
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          borderRadius: 12,
          border: "1px solid var(--line)",
          boxShadow: "0 24px 70px rgba(15,23,42,0.22)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div>
            <div
              style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-900)" }}
            >
              播放录屏
            </div>
            {recording.streamerName ? (
              <div
                style={{ marginTop: 2, fontSize: 12, color: "var(--ink-500)" }}
              >
                {recording.streamerName}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--ink-400)",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            padding: 18,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "stretch",
            gap: 14,
            overflow: "auto",
            minHeight: 0,
          }}
        >
          <div
            style={{
              flex: "1.4 1 420px",
              minWidth: 0,
              display: "grid",
              gap: 10,
              alignContent: "start",
            }}
          >
            <video
              ref={videoRef}
              controls
              autoPlay
              style={{ width: "100%", borderRadius: 8, background: "#000" }}
              src={`/api/recording-assets/${recording.assetId}/download`}
              onError={() => setVideoError(true)}
            />
            {videoError ? (
              <div style={{ fontSize: 12, color: "var(--danger-600)" }}>
                无法加载视频（签名过期或文件缺失），请重试
              </div>
            ) : null}
          </div>
          <RecordingTranscriptPanel
            assetId={recording.assetId}
            assetName={recording.streamerName || "录屏"}
            videoRef={videoRef}
            analysisStatus={recording.aiAnalysisStatus ?? null}
            bodyMaxHeight={420}
            style={{ flex: "1 1 320px", minWidth: 280 }}
          />
        </div>
      </div>
    </div>
  );
}

// ===== 直播录屏逐字稿（两处播放窗共用的侧栏面板） =====
// 挂载点：① 项目准入板「播放录屏」弹层（RecordingPlaybackDialog）；
// ② 录屏审核工作台右栏播放窗（AdmissionWorkspaceDetail）。
// 后端契约（与 transcript 后端并行开发，字段已锁定）：
//   GET  /api/recording-assets/{assetId}/transcript
//     → { transcript: { available, asrProvider, analysisId, utterances, summary } }
//       utterances[].segments[].tone: null | "warning"(风险词黄标) | "violation"(违规词红标)
//       transcript.wordInsights?（高频词分析，后端可能尚未部署 → 字段缺失时整块不渲染）：
//         { effective: [{ word, category: "conversion"|"interaction"|"explanation", categoryLabel, count }],
//           ineffective: [{ word, count }], neutral: [{ word, count }],
//           metrics: { effectiveCount, ineffectiveCount, utteranceCount,
//                      fillerPerUtterance, effectiveShare: number|null } }
//   POST /api/recording-assets/{assetId}/transcript/export
//     body { format: "knowledge"|"docx"|"pdf", includeTimestamps }
//     → knowledge 返回 { document: { id, title } }；docx/pdf 返回附件二进制（blob 下载）。

// 红/黄标注色沿用全局状态 token：违规=danger 系（同状态徽章红），风险=warn 系（同徽章黄）。
const TRANSCRIPT_TONE_MARK_STYLES = {
  violation: { background: "var(--danger-50)", color: "var(--danger-600)" },
  warning: { background: "var(--warn-50)", color: "var(--warn-600)" },
};

// ===== 高频词分析（wordInsights）展示常量 =====
// 指标徽章配色沿用全局状态 token（ok/warn/danger/ink 系）。阈值：
//   有效话术占比：≥60% 绿 / 30%-60% 黄 / <30% 红 / null 中性「—」；
//   水词密度：≤0.5 绿 / 0.5-1.5 黄 / >1.5 红。
const TRANSCRIPT_METRIC_TONE_STYLES = {
  green: { background: "var(--ok-50)", color: "var(--ok-600)" },
  amber: { background: "var(--warn-50)", color: "var(--warn-600)" },
  red: { background: "var(--danger-50)", color: "var(--danger-600)" },
  neutral: { background: "var(--ink-50)", color: "var(--ink-500)" },
};

// 词 chips 三组配色：有效话术=ok 绿系、无效水词=warn 黄灰系、其他高频=中性描边；
// active 为点击筛选后的选中态（实底反白，与 aria-pressed 同步）。
const TRANSCRIPT_WORD_CHIP_STYLES = {
  effective: {
    idle: {
      background: "var(--ok-50)",
      color: "var(--ok-600)",
      border: "1px solid transparent",
    },
    active: {
      background: "var(--ok-600)",
      color: "#fff",
      border: "1px solid var(--ok-600)",
    },
  },
  ineffective: {
    idle: {
      background: "var(--warn-50)",
      color: "var(--warn-600)",
      border: "1px solid transparent",
    },
    active: {
      background: "var(--warn-600)",
      color: "#fff",
      border: "1px solid var(--warn-600)",
    },
  },
  neutral: {
    idle: {
      background: "#fff",
      color: "var(--ink-500)",
      border: "1px solid var(--ink-200)",
    },
    active: {
      background: "var(--ink-700)",
      color: "#fff",
      border: "1px solid var(--ink-700)",
    },
  },
};

// 有效话术组内的类别小簇固定顺序；categoryLabel 缺失时按 category 兜底。
const TRANSCRIPT_EFFECTIVE_CATEGORY_ORDER = [
  "conversion",
  "interaction",
  "explanation",
];
const TRANSCRIPT_EFFECTIVE_CATEGORY_LABELS = {
  conversion: "转化引导",
  interaction: "互动",
  explanation: "游戏讲解",
};

function transcriptEffectiveShareMetric(share) {
  if (typeof share !== "number" || !Number.isFinite(share)) {
    return { text: "—", tone: "neutral" };
  }
  return {
    text: `${Math.round(share * 1000) / 10}%`,
    tone: share >= 0.6 ? "green" : share >= 0.3 ? "amber" : "red",
  };
}

function transcriptFillerDensityMetric(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { text: "—", tone: "neutral" };
  }
  return {
    text: `${Math.round(value * 100) / 100}/句`,
    tone: value <= 0.5 ? "green" : value <= 1.5 ? "amber" : "red",
  };
}

// 筛选词命中强调：下划线（不占背景色），与红/黄 mark 的底色标注互不冲突，
// mark 内命中时同样生效。大小写不敏感、无正则（避免特殊字符转义问题）。
function renderTranscriptWordHits(text, word) {
  const source = String(text ?? "");
  const needle = String(word ?? "").toLowerCase();
  if (!needle || !source) {
    return source;
  }
  const lower = source.toLowerCase();
  if (!lower.includes(needle)) {
    return source;
  }
  const parts = [];
  let cursor = 0;
  let hit = lower.indexOf(needle);
  while (hit !== -1) {
    if (hit > cursor) {
      parts.push(source.slice(cursor, hit));
    }
    parts.push(
      <span
        key={`hit-${hit}`}
        data-word-filter-hit="true"
        style={{
          textDecoration: "underline",
          textDecorationThickness: 1.5,
          textUnderlineOffset: 2,
          fontWeight: 600,
        }}
      >
        {source.slice(hit, hit + needle.length)}
      </span>,
    );
    cursor = hit + needle.length;
    hit = lower.indexOf(needle, cursor);
  }
  if (cursor < source.length) {
    parts.push(source.slice(cursor));
  }
  return parts;
}

// 「高频词分析」折叠区（默认展开，折叠交互对齐 CollapsibleSection）：
// 指标行两枚配色徽章 + 三组词 chips；chip 是 button，点击回调交给面板做筛选联动。
function TranscriptWordInsightsSection({ insights, activeWord, onToggleWord }) {
  const [open, setOpen] = React.useState(true);
  const effective = Array.isArray(insights?.effective)
    ? insights.effective
    : [];
  const ineffective = Array.isArray(insights?.ineffective)
    ? insights.ineffective
    : [];
  const neutral = Array.isArray(insights?.neutral) ? insights.neutral : [];
  const shareMetric = transcriptEffectiveShareMetric(
    insights?.metrics?.effectiveShare ?? null,
  );
  const fillerMetric = transcriptFillerDensityMetric(
    insights?.metrics?.fillerPerUtterance ?? null,
  );

  // 有效话术按类别聚簇：固定顺序 转化引导 → 互动 → 游戏讲解，未知类别排后。
  const clusterMap = new Map();
  effective.forEach((item) => {
    if (!item?.word) {
      return;
    }
    const category = item.category ?? "other";
    if (!clusterMap.has(category)) {
      clusterMap.set(category, {
        category,
        label:
          item.categoryLabel ||
          TRANSCRIPT_EFFECTIVE_CATEGORY_LABELS[category] ||
          category,
        items: [],
      });
    }
    clusterMap.get(category).items.push(item);
  });
  const clusters = [
    ...TRANSCRIPT_EFFECTIVE_CATEGORY_ORDER.filter((category) =>
      clusterMap.has(category),
    ).map((category) => clusterMap.get(category)),
    ...[...clusterMap.values()].filter(
      (cluster) =>
        !TRANSCRIPT_EFFECTIVE_CATEGORY_ORDER.includes(cluster.category),
    ),
  ];

  const renderMetric = (name, label, metric) => (
    <span
      data-word-insights-metric={name}
      data-tone={metric.tone}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        lineHeight: "18px",
        fontWeight: 500,
        whiteSpace: "nowrap",
        ...TRANSCRIPT_METRIC_TONE_STYLES[metric.tone],
      }}
    >
      {label} {metric.text}
    </span>
  );

  const renderChip = (item, group) => {
    if (!item?.word) {
      return null;
    }
    const active = activeWord === item.word;
    const chipStyles = TRANSCRIPT_WORD_CHIP_STYLES[group];
    return (
      <button
        key={item.word}
        type="button"
        aria-pressed={active}
        onClick={() => onToggleWord(item.word)}
        title={active ? "取消筛选" : `只看包含「${item.word}」的句子`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          padding: "1px 8px",
          borderRadius: 999,
          fontSize: 12,
          lineHeight: "18px",
          fontWeight: 500,
          cursor: "pointer",
          whiteSpace: "nowrap",
          transition: "background 100ms ease",
          ...(active ? chipStyles.active : chipStyles.idle),
        }}
      >
        {item.word}{" "}
        <span style={{ fontSize: 11, opacity: 0.72 }}>×{item.count ?? 0}</span>
      </button>
    );
  };

  const groupTitleStyle = {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--ink-400)",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ borderBottom: "1px solid var(--line)" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "8px 12px",
          background: open ? "var(--bg-soft)" : "#fff",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-900)" }}
        >
          高频词分析
        </span>
        <span
          aria-hidden="true"
          style={{
            fontSize: 11,
            color: "var(--ink-400)",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          ▶
        </span>
      </button>
      {open ? (
        <div
          style={{
            padding: "8px 12px 10px",
            borderTop: "1px solid var(--line)",
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {renderMetric("effective-share", "有效话术占比", shareMetric)}
            {renderMetric("filler-density", "水词密度", fillerMetric)}
          </div>
          {effective.length > 0 ? (
            <div style={{ display: "grid", gap: 4 }}>
              <div style={groupTitleStyle}>有效话术</div>
              {clusters.map((cluster) => (
                <div
                  key={cluster.category}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--ok-600)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cluster.label}
                  </span>
                  {cluster.items.map((item) => renderChip(item, "effective"))}
                </div>
              ))}
            </div>
          ) : null}
          {ineffective.length > 0 ? (
            <div style={{ display: "grid", gap: 4 }}>
              <div style={groupTitleStyle}>无效水词</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ineffective.map((item) => renderChip(item, "ineffective"))}
              </div>
            </div>
          ) : null}
          {neutral.length > 0 ? (
            <div style={{ display: "grid", gap: 4 }}>
              <div style={groupTitleStyle}>其他高频</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {neutral.map((item) => renderChip(item, "neutral"))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const TRANSCRIPT_EXPORT_ACTIONS = [
  {
    format: "knowledge",
    label: "保存到企业库",
    busyLabel: "保存中…",
    failText: "保存到企业库失败，请稍后重试",
  },
  {
    format: "docx",
    label: "导出 Word",
    busyLabel: "导出中…",
    successText: "导出 Word 成功，已开始下载",
    failText: "导出 Word 失败，请稍后重试",
  },
  {
    format: "pdf",
    label: "导出 PDF",
    busyLabel: "导出中…",
    successText: "导出 PDF 成功，已开始下载",
    failText: "导出 PDF 失败，请稍后重试",
  },
];

// [MM:SS] 时间戳；超过 1 小时退化为 H:MM:SS。

function transcriptExportFilename(response, format, assetName) {
  const header =
    typeof response?.headers?.get === "function"
      ? response.headers.get("Content-Disposition") ||
        response.headers.get("content-disposition")
      : null;
  if (header) {
    const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
    if (encoded?.[1]) {
      try {
        return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ""));
      } catch {
        // 编码异常时继续尝试普通 filename= 或默认名。
      }
    }
    const plain = /filename="?([^";]+)"?/i.exec(header);
    if (plain?.[1]) {
      return plain[1].trim();
    }
  }
  return `逐字稿-${assetName || "录屏"}.${format === "pdf" ? "pdf" : "docx"}`;
}

// 与 downloadAdmissionExport 同款的 blob 下载（jsdom 等无 createObjectURL 环境静默跳过）。
function downloadTranscriptBlob(blob, filename) {
  if (
    !blob ||
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL?.(href);
}

function RecordingTranscriptPanel({
  assetId,
  assetName,
  videoRef,
  analysisStatus,
  bodyMaxHeight = 320,
  style,
}) {
  const [state, setState] = React.useState({
    status: "loading",
    transcript: null,
  });
  const [reloadToken, setReloadToken] = React.useState(0);
  const [includeTimestamps, setIncludeTimestamps] = React.useState(true);
  const [exportBusy, setExportBusy] = React.useState("");
  const [exportMessage, setExportMessage] = React.useState(null);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  // 高频词点击筛选：记录选中的词（null=不筛选），换资产/重载时清空。
  const [wordFilter, setWordFilter] = React.useState(null);
  // timeupdate 高频触发，节流后再计算当前话语行。
  const lastFollowAtRef = React.useRef(0);
  const activeRowRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    setActiveIndex(-1);
    setWordFilter(null);
    setExportMessage(null);
    if (!assetId) {
      setState({ status: "error", transcript: null });
      return () => {
        cancelled = true;
      };
    }
    setState({ status: "loading", transcript: null });
    Promise.resolve()
      .then(() =>
        globalThis.fetch(`/api/recording-assets/${assetId}/transcript`, {
          method: "GET",
        }),
      )
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "加载逐字稿失败");
        }
        return payload.transcript ?? null;
      })
      .then((transcript) => {
        if (!cancelled) {
          setState({ status: "ready", transcript });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "error", transcript: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, reloadToken]);

  const transcript = state.status === "ready" ? state.transcript : null;
  const available = Boolean(transcript?.available);
  const utterances = available ? (transcript.utterances ?? []) : [];
  const summary = available ? (transcript.summary ?? null) : null;
  // 高频词分析数据：后端未部署时字段缺失 → 整个区块降级不渲染，其余照常。
  const wordInsights =
    available &&
    transcript?.wordInsights &&
    typeof transcript.wordInsights === "object"
      ? transcript.wordInsights
      : null;

  // 词筛选：大小写不敏感包含匹配；保留原 index，seek/播放跟随高亮不受筛选影响。
  const normalizedWordFilter = wordFilter ? wordFilter.toLowerCase() : "";
  const visibleUtterances = utterances
    .map((utterance, index) => ({ utterance, index }))
    .filter(({ utterance }) => {
      if (!normalizedWordFilter) {
        return true;
      }
      const text =
        utterance.text ??
        (Array.isArray(utterance.segments)
          ? utterance.segments.map((segment) => segment?.text ?? "").join("")
          : "");
      return String(text).toLowerCase().includes(normalizedWordFilter);
    });

  const toggleWordFilter = (word) => {
    setWordFilter((current) => (current === word ? null : word));
  };

  // 播放位置 → 话语行高亮跟随（250ms 节流）。
  React.useEffect(() => {
    const video = videoRef?.current;
    if (
      !video ||
      typeof video.addEventListener !== "function" ||
      utterances.length === 0
    ) {
      return undefined;
    }
    const followPlayback = () => {
      const now = Date.now();
      if (now - lastFollowAtRef.current < 250) {
        return;
      }
      lastFollowAtRef.current = now;
      const time = Number(video.currentTime) || 0;
      let next = -1;
      for (let i = 0; i < utterances.length; i += 1) {
        const utterance = utterances[i];
        if (time < utterance.startSeconds) {
          break;
        }
        next = i;
        if (time < utterance.endSeconds) {
          break;
        }
      }
      setActiveIndex(next);
    };
    video.addEventListener("timeupdate", followPlayback);
    return () => {
      video.removeEventListener("timeupdate", followPlayback);
    };
  }, [videoRef, utterances]);

  // 高亮行滚入可视区（jsdom 无 scrollIntoView，静默跳过）。
  React.useEffect(() => {
    const node = activeRowRef.current;
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const seekToUtterance = (utterance, index) => {
    setActiveIndex(index);
    const video = videoRef?.current;
    if (!video) {
      return;
    }
    try {
      video.currentTime = Number(utterance.startSeconds) || 0;
      const playing = video.play?.();
      playing?.catch?.(() => {});
    } catch {
      // 视频未就绪/环境不支持播放时忽略，仅保留高亮。
    }
  };

  const runExport = async (action) => {
    if (!assetId || exportBusy) {
      return;
    }
    setExportBusy(action.format);
    setExportMessage(null);
    // 「保存到企业库」：主保存是把逐字稿写进 COS 知识树（用户在「知识库」页可见），
    // 与复盘归档同款路径；服务端 /transcript/export 只作尽力而为的 AI 检索索引同步。
    if (action.format === "knowledge") {
      try {
        const { docName, remoteOk } = await archiveTranscriptToKnowledgeBase({
          assetName,
          asrProvider: transcript?.asrProvider ?? null,
          transcript,
          includeTimestamps,
        });
        // 次要：同步 RAG 索引 + 审计留痕，失败只记录、不影响主提示。
        globalThis
          .fetch(`/api/recording-assets/${assetId}/transcript/export`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ format: "knowledge", includeTimestamps }),
          })
          .catch((error) => {
            console.warn("transcript RAG index sync failed", error);
          });
        setExportMessage({
          tone: "ok",
          text: remoteOk
            ? `已保存到知识库 → 逐字稿 /《${docName}》`
            : `已保存到知识库（本地）→ 逐字稿 /《${docName}》`,
        });
      } catch (error) {
        setExportMessage({
          tone: "error",
          text: error?.message || action.failText,
        });
      } finally {
        setExportBusy("");
      }
      return;
    }
    try {
      const response = await globalThis.fetch(
        `/api/recording-assets/${assetId}/transcript/export`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format: action.format, includeTimestamps }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (
          response.status === 501 &&
          [payload.error, payload.code].includes("pdf_font_unavailable")
        ) {
          throw new Error("PDF 字体未配置，请先导出 Word");
        }
        throw new Error(payload.error || action.failText);
      }
      const blob = await response.blob();
      downloadTranscriptBlob(
        blob,
        transcriptExportFilename(response, action.format, assetName),
      );
      setExportMessage({ tone: "ok", text: action.successText });
    } catch (error) {
      setExportMessage({
        tone: "error",
        text: error?.message || action.failText,
      });
    } finally {
      setExportBusy("");
    }
  };

  // available:false 的引导空态：区分「未发起分析 / 分析中 / 分析完成但无转写」。
  const analysisRunning =
    analysisStatus === "pending" ||
    analysisStatus === "queued" ||
    analysisStatus === "running" ||
    analysisStatus === "processing";
  const unavailableHint = analysisRunning
    ? "AI 分析进行中，完成后将自动生成逐字稿。"
    : analysisStatus === "succeeded"
      ? "本次 AI 分析未产出转写文本，可重新发起分析后生成。"
      : "该录屏还未完成 AI 分析，请先在录屏明细的「发起 AI 分析」入口发起分析。";

  let body = null;
  if (state.status === "loading") {
    body = (
      <div
        aria-label="逐字稿加载中"
        style={{ padding: 14, display: "grid", gap: 10 }}
      >
        {[88, 64, 94, 72].map((width, index) => (
          <div
            key={index}
            style={{
              height: 10,
              width: `${width}%`,
              borderRadius: 999,
              background: "var(--ink-50)",
            }}
          />
        ))}
        <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
          逐字稿加载中…
        </div>
      </div>
    );
  } else if (state.status === "error") {
    body = (
      <div
        style={{
          padding: "24px 14px",
          display: "grid",
          gap: 10,
          justifyItems: "center",
        }}
      >
        <div style={{ fontSize: 12, color: "var(--danger-600)" }}>
          逐字稿加载失败，请重试
        </div>
        <Button
          size="sm"
          kind="default"
          onClick={() => setReloadToken((token) => token + 1)}
        >
          重试
        </Button>
      </div>
    );
  } else if (!available) {
    body = (
      <EmptyHint title="完成 AI 分析后自动生成逐字稿" hint={unavailableHint} />
    );
  } else if (utterances.length === 0) {
    body = (
      <EmptyHint title="逐字稿为空" hint="本场录屏未识别到有效语音内容。" />
    );
  } else {
    body = (
      <div
        role="list"
        aria-label="逐字稿话语列表"
        style={{
          overflowY: "auto",
          maxHeight: bodyMaxHeight,
          padding: 8,
          display: "grid",
          gap: 2,
          alignContent: "start",
        }}
      >
        {wordFilter && visibleUtterances.length === 0 ? (
          <div
            style={{
              padding: "16px 8px",
              fontSize: 12,
              color: "var(--ink-400)",
              textAlign: "center",
            }}
          >
            {`没有包含「${wordFilter}」的句子`}
          </div>
        ) : null}
        {visibleUtterances.map(({ utterance, index }) => {
          const isActive = index === activeIndex;
          const clock = formatTranscriptClock(utterance.startSeconds);
          const segments =
            Array.isArray(utterance.segments) && utterance.segments.length > 0
              ? utterance.segments
              : [{ text: utterance.text ?? "", tone: null }];
          return (
            <div
              role="listitem"
              key={utterance.index ?? index}
              ref={isActive ? activeRowRef : null}
              data-transcript-row={isActive ? "active" : "idle"}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "5px 6px",
                borderRadius: 6,
                background: isActive ? "var(--blue-50)" : "transparent",
                boxShadow: isActive
                  ? "inset 0 0 0 1px var(--blue-200)"
                  : "none",
              }}
            >
              <button
                type="button"
                className="num"
                onClick={() => seekToUtterance(utterance, index)}
                aria-label={`跳转到 ${clock}`}
                title={`跳转播放到 ${clock}`}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  marginTop: 1,
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: "18px",
                  color: isActive ? "var(--blue-700)" : "var(--blue-600)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                [{clock}]
              </button>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: "18px",
                  color: "var(--ink-700)",
                  wordBreak: "break-word",
                }}
              >
                {segments.map((segment, segmentIndex) => {
                  const markStyle = segment?.tone
                    ? TRANSCRIPT_TONE_MARK_STYLES[segment.tone]
                    : null;
                  if (!markStyle) {
                    return (
                      <React.Fragment key={segmentIndex}>
                        {renderTranscriptWordHits(
                          segment?.text ?? "",
                          wordFilter,
                        )}
                      </React.Fragment>
                    );
                  }
                  return (
                    <mark
                      key={segmentIndex}
                      data-tone={segment.tone}
                      title={
                        segment.keyword
                          ? `${segment.tone === "violation" ? "违规词" : "风险词"}：${segment.keyword}${segment.category ? `（${segment.category}）` : ""}`
                          : undefined
                      }
                      style={{
                        ...markStyle,
                        borderRadius: 3,
                        padding: "0 2px",
                        fontWeight: 500,
                      }}
                    >
                      {renderTranscriptWordHits(segment.text, wordFilter)}
                    </mark>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section
      aria-label="直播逐字稿"
      style={{
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 10,
        boxShadow: "var(--shadow-card)",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        ...style,
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--line)",
          display: "grid",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink-900)",
              flex: 1,
              minWidth: 0,
            }}
          >
            直播逐字稿
            {available && transcript?.asrProvider ? (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  fontWeight: 400,
                  color: "var(--ink-400)",
                }}
              >
                ASR：{transcript.asrProvider}
              </span>
            ) : null}
          </div>
          {summary ? (
            <span style={{ display: "inline-flex", gap: 6 }}>
              <Badge tone="red">违规 {summary.violationCount ?? 0}</Badge>
              <Badge tone="amber">风险 {summary.warningCount ?? 0}</Badge>
            </span>
          ) : null}
        </div>
        {summary?.keywords?.length ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {summary.keywords.slice(0, 6).map((item) => (
              <Badge
                key={`${item.tone}:${item.keyword}`}
                tone={item.tone === "violation" ? "red" : "amber"}
                soft={false}
              >
                {item.keyword} ×{item.count}
              </Badge>
            ))}
          </div>
        ) : null}
        {available ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                color: "var(--ink-500)",
                cursor: "pointer",
                whiteSpace: "nowrap",
                marginRight: 2,
              }}
            >
              <input
                type="checkbox"
                checked={includeTimestamps}
                onChange={(event) => setIncludeTimestamps(event.target.checked)}
                style={{ accentColor: "var(--blue-600)" }}
              />
              带时间戳
            </label>
            {TRANSCRIPT_EXPORT_ACTIONS.map((action) => (
              <Button
                key={action.format}
                size="sm"
                kind="default"
                onClick={() => runExport(action)}
                disabled={Boolean(exportBusy)}
              >
                {exportBusy === action.format ? action.busyLabel : action.label}
              </Button>
            ))}
          </div>
        ) : null}
        {exportMessage ? (
          <div
            style={{
              fontSize: 12,
              color:
                exportMessage.tone === "error"
                  ? "var(--danger-600)"
                  : "var(--ok-600)",
            }}
          >
            {exportMessage.text}
          </div>
        ) : null}
      </div>
      {wordInsights ? (
        <TranscriptWordInsightsSection
          insights={wordInsights}
          activeWord={wordFilter}
          onToggleWord={toggleWordFilter}
        />
      ) : null}
      {wordFilter ? (
        <div
          style={{
            padding: "5px 12px",
            borderBottom: "1px solid var(--line)",
            background: "var(--blue-50)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              color: "var(--blue-700)",
              wordBreak: "break-word",
            }}
          >
            {`筛选：「${wordFilter}」 · ${visibleUtterances.length} 句`}
          </span>
          <Button
            size="sm"
            kind="link"
            onClick={() => setWordFilter(null)}
            style={{ height: 20, padding: 0 }}
          >
            清除筛选
          </Button>
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0 }}>{body}</div>
    </section>
  );
}

function RecordingAiAnalysisInline({ analysis, onOpen }) {
  if (!analysis) {
    return (
      <div style={{ marginTop: 4, fontSize: 11, color: "var(--ink-400)" }}>
        AI：未分析
      </div>
    );
  }

  const tone =
    analysis.status === "succeeded"
      ? "green"
      : analysis.status === "failed"
        ? "red"
        : "violet";
  return (
    <div style={{ marginTop: 4, display: "grid", gap: 3 }}>
      <Badge tone={tone} soft={false}>
        AI：{analysis.statusLabel || analysis.status}
      </Badge>
      {analysis.status === "succeeded" && analysis.summary ? (
        <div style={{ maxWidth: 220, fontSize: 11, color: "var(--ink-500)" }}>
          {analysis.summary}
        </div>
      ) : null}
      {analysis.status === "succeeded" && onOpen ? (
        <Button
          size="sm"
          kind="link"
          onClick={onOpen}
          style={{ justifySelf: "start", height: 22, padding: 0 }}
        >
          查看 AI 详情
        </Button>
      ) : null}
    </div>
  );
}

function RecordingAiAnalysisDetailsPanel({
  analysis,
  onClose,
  onConfirmProfileInsight,
  confirmProfileDisabled,
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="录屏 AI 分析详情"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(15,23,42,0.28)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(760px, 100%)",
          maxHeight: "min(760px, 90vh)",
          overflow: "auto",
          background: "#fff",
          borderRadius: 12,
          border: "1px solid var(--line)",
          boxShadow: "0 24px 70px rgba(15,23,42,0.22)",
        }}
      >
        <div
          style={{
            padding: "18px 20px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              录屏 AI 分析详情
            </div>
            <div
              style={{ marginTop: 4, fontSize: 12, color: "var(--ink-500)" }}
            >
              {analysis.statusLabel || analysis.status}
              {analysis.providerName ? ` · ${analysis.providerName}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {onConfirmProfileInsight ? (
              <Button
                size="sm"
                kind="primary"
                onClick={onConfirmProfileInsight}
                disabled={confirmProfileDisabled}
              >
                确认沉淀到主播画像
              </Button>
            ) : null}
            <Button size="sm" kind="default" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
        <div style={{ padding: 20, display: "grid", gap: 18 }}>
          {analysis.summary ? (
            <div>
              <SectionKicker>摘要</SectionKicker>
              <div style={{ fontSize: 14, color: "var(--ink-800)" }}>
                {analysis.summary}
              </div>
            </div>
          ) : null}
          {analysis.dimensions?.length ? (
            <div>
              <SectionKicker>维度评分</SectionKicker>
              <div style={{ display: "grid", gap: 8 }}>
                {analysis.dimensions.map((dimension) => (
                  <div
                    key={dimension.key}
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      padding: 10,
                      background: "var(--bg-soft)",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {dimension.label} {dimension.score}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 12,
                        color: "var(--ink-500)",
                      }}
                    >
                      {dimension.finding}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {analysis.riskFlags?.length ? (
            <div>
              <SectionKicker>风险提示</SectionKicker>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {analysis.riskFlags.map((flag) => (
                  <Badge key={flag} tone="amber">
                    {flag}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          {analysis.recommendations?.length ? (
            <div>
              <SectionKicker>处理建议</SectionKicker>
              <div style={{ display: "grid", gap: 8 }}>
                {analysis.recommendations.map((recommendation) => (
                  <div
                    key={`${recommendation.title}-${recommendation.detail}`}
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      padding: 10,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {recommendation.title}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 12,
                        color: "var(--ink-600)",
                      }}
                    >
                      {recommendation.detail}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {analysis.segments?.length ? (
            <div>
              <SectionKicker>分段点评</SectionKicker>
              <div style={{ display: "grid", gap: 8 }}>
                {analysis.segments.map((segment) => (
                  <div
                    key={segment.id}
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      padding: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <strong>{segment.title}</strong>
                      <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
                        {segment.timeRangeLabel}
                      </span>
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 12,
                        color: "var(--ink-600)",
                      }}
                    >
                      {segment.summary}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SectionKicker({ children }) {
  return (
    <div
      style={{
        marginBottom: 8,
        fontSize: 12,
        fontWeight: 700,
        color: "var(--ink-500)",
      }}
    >
      {children}
    </div>
  );
}

function downloadAdmissionExport(result) {
  if (
    !result?.content ||
    !result?.filename ||
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }

  const blob = new Blob(["\uFEFF", result.content], {
    type: "text/csv;charset=utf-8",
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = result.filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL?.(href);
}

// 把服务端返回的 base64 xlsx 解码后触发下载（含真实嵌入的下播截图）。

function admissionWorkspaceStatusKey(application) {
  if (isAdmissionRecordingReviewable(application)) return "pending";
  const status = application.status;
  const recordingStatus = application.latestRecording?.status;
  if (status === "recording_required" || recordingStatus === "needs_changes") {
    return "needs_changes";
  }
  if (status === "recording_rejected" || recordingStatus === "rejected") {
    return "rejected";
  }
  if (status === "recording_approved" || status === "joined") {
    return "approved";
  }
  return "other";
}

function admissionWorkspaceStatusMeta(application) {
  const key = admissionWorkspaceStatusKey(application);
  if (key === "pending") return { key, label: "待审核", tone: "amber" };
  if (key === "needs_changes") return { key, label: "需修改", tone: "violet" };
  if (key === "approved") return { key, label: "已通过", tone: "green" };
  if (key === "rejected") return { key, label: "已驳回", tone: "red" };
  return {
    key,
    label: application.latestRecording ? "无需操作" : "等待录屏",
    tone: "neutral",
  };
}

// 两个数据源字段名不同：application-queries DTO 叫 externalUrl，
// admission-board detail DTO 叫 url，这里统一取值。
function admissionRecordingExternalUrl(recording) {
  return recording?.externalUrl || recording?.url || null;
}

function admissionRecordingSourceMeta(recording) {
  if (!recording) return { label: "无录屏", tone: "amber" };
  if (recording.hasPrivateStorage && admissionRecordingExternalUrl(recording)) {
    return { label: "双来源", tone: "violet" };
  }
  if (recording.hasPrivateStorage) return { label: "私有上传", tone: "teal" };
  if (admissionRecordingExternalUrl(recording)) {
    return { label: "外链", tone: "blue" };
  }
  return { label: "无录屏", tone: "amber" };
}

function admissionRecordingDurationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  return `${Math.round(seconds / 60)} 分钟`;
}

// B 站外链就地内嵌：features/recordings/recording-assets.ts 的
// buildBilibiliEmbedUrl 的前端轻量版（BV 号简单正则提取）。
function admissionBilibiliEmbedSrc(url) {
  const bvid =
    typeof url === "string"
      ? (url.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] ?? null)
      : null;
  if (!bvid) return null;
  return `https://player.bilibili.com/player.html?bvid=${bvid}&page=1&high_quality=1&danmaku=0`;
}

function admissionPreReviewVerdictLabel(verdict) {
  if (verdict === "pass") return "通过";
  if (verdict === "fail") return "未通过";
  if (verdict === "not_applicable") return "不适用";
  return verdict || "不确定";
}

function admissionPreReviewVerdictTone(verdict) {
  if (verdict === "pass") return "green";
  if (verdict === "fail") return "red";
  return "amber";
}

function AdmissionReviewWorkspace({
  board,
  rows,
  message,
  busyAction,
  onBack,
  onReview,
  onOpenAiAnalysis,
  fetchPreReview,
}) {
  const [statusFilter, setStatusFilter] = React.useState("pending");
  const [queueQuery, setQueueQuery] = React.useState("");
  const [activeId, setActiveId] = React.useState("");

  const normalizedQuery = queueQuery.trim().toLowerCase();
  const scopedRows = normalizedQuery
    ? rows.filter((application) =>
        (application.streamer?.displayName || "")
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : rows;
  const statusCounts = {
    pending: 0,
    needs_changes: 0,
    approved: 0,
    rejected: 0,
  };
  for (const application of scopedRows) {
    const key = admissionWorkspaceStatusKey(application);
    if (statusCounts[key] != null) statusCounts[key] += 1;
  }
  const filteredRows =
    statusFilter === "all"
      ? scopedRows
      : scopedRows.filter(
          (application) =>
            admissionWorkspaceStatusKey(application) === statusFilter,
        );
  const pendingLeft = rows.filter(
    (application) => admissionWorkspaceStatusKey(application) === "pending",
  ).length;

  // 选中对齐规则：
  // - 数据刷新（审核回写等）按 id 保持选中，即使刚审完的条目已不属于当前页签
  //   也停留在原条目（配合「待审核已清零」提示）；
  // - 用户切换搜索/页签导致选中被过滤掉时，自动落到过滤结果第一条待审核
  //   （无待审核取第一条）。
  const filterSignature = `${statusFilter}::${normalizedQuery}`;
  const lastFilterSignatureRef = React.useRef(filterSignature);
  React.useEffect(() => {
    const filterChanged = lastFilterSignatureRef.current !== filterSignature;
    lastFilterSignatureRef.current = filterSignature;
    if (filteredRows.some((application) => application.id === activeId)) {
      return;
    }
    const stillInProject = rows.some(
      (application) => application.id === activeId,
    );
    if (stillInProject && !filterChanged) {
      return;
    }
    if (filteredRows.length === 0) {
      if (activeId && (filterChanged || !stillInProject)) setActiveId("");
      return;
    }
    const firstPending = filteredRows.find(
      (application) => admissionWorkspaceStatusKey(application) === "pending",
    );
    setActiveId((firstPending ?? filteredRows[0]).id);
  }, [activeId, filteredRows, filterSignature, rows]);

  const active =
    filteredRows.find((application) => application.id === activeId) ??
    rows.find((application) => application.id === activeId) ??
    null;

  // 审核成功后自动跳到列表中下一条待审核（从当前位置向后找，找不到再回头找）。
  const reviewAndAdvance = async (application, decision) => {
    const queue = filteredRows;
    const succeeded = await onReview(application, decision);
    if (!succeeded) return;
    const index = queue.findIndex((row) => row.id === application.id);
    const ordered =
      index >= 0
        ? [...queue.slice(index + 1), ...queue.slice(0, index)]
        : queue;
    const next = ordered.find(
      (row) =>
        row.id !== application.id &&
        admissionWorkspaceStatusKey(row) === "pending",
    );
    if (next) setActiveId(next.id);
  };

  if (!board) {
    return (
      <Card>
        <EmptyHint
          title="项目不存在或数据已刷新"
          hint="请返回项目列表重新选择要审核的项目。"
          actionLabel="返回项目列表"
          onAction={onBack}
        />
      </Card>
    );
  }

  const projectName = board.project.name || board.project.code || "项目";
  const projectMeta = [board.project.product, board.project.vendor]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.35fr 1fr",
        gap: 20,
        alignItems: "flex-start",
      }}
    >
      {/* 宽屏下左右两栏各自吸附视口、独立滚动：滚列表不带走预览，滚预览
          不带走列表；窄屏（<1100px）回退为整页自然滚动。top/高度按
          sticky 顶栏 64px + 16px 间距取值。 */}
      <style>
        {`
          @media (min-width: 1100px) {
            .admission-workspace-col {
              position: sticky;
              top: 80px;
              max-height: calc(100vh - 96px);
              overflow-y: auto;
              overscroll-behavior: contain;
              scrollbar-width: thin;
            }
          }
        `}
      </style>
      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Button size="sm" kind="default" onClick={onBack}>
          ← 返回项目列表
        </Button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-900)" }}
          >
            {projectName} · 录屏审核工作台
          </div>
          {projectMeta ? (
            <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
              {projectMeta}
            </div>
          ) : null}
        </div>
        <Badge tone={pendingLeft > 0 ? "amber" : "green"}>
          待审核 {pendingLeft}
        </Badge>
        <Badge tone="blue">共 {rows.length} 条</Badge>
      </div>
      {message ? (
        <div
          aria-live="polite"
          style={{
            gridColumn: "1 / -1",
            padding: "10px 12px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: message.includes("失败") ? "#FDECEC" : "var(--bg-soft)",
            color: message.includes("失败")
              ? "var(--danger-600)"
              : "var(--ink-600)",
            fontSize: 12,
          }}
        >
          {message}
        </div>
      ) : null}
      <div className="admission-workspace-col">
        <Card padded={false}>
          <div
            style={{ padding: "0 12px", borderBottom: "1px solid var(--line)" }}
          >
            <Tabs
              value={statusFilter}
              onChange={setStatusFilter}
              items={[
                {
                  key: "pending",
                  label: "待审核",
                  count: statusCounts.pending,
                },
                {
                  key: "needs_changes",
                  label: "需修改",
                  count: statusCounts.needs_changes,
                },
                {
                  key: "approved",
                  label: "已通过",
                  count: statusCounts.approved,
                },
                {
                  key: "rejected",
                  label: "已驳回",
                  count: statusCounts.rejected,
                },
                { key: "all", label: "全部", count: scopedRows.length },
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
            <SearchInput
              placeholder="按主播名搜索"
              width={220}
              value={queueQuery}
              onChange={setQueueQuery}
            />
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
              点击行在右侧预览并审核
            </span>
          </div>
          <DataTable
            activeRowId={activeId}
            onRowClick={(application) => setActiveId(application.id)}
            rows={filteredRows}
            emptyText="当前筛选下暂无录屏条目"
            columns={[
              {
                title: "#",
                render: (r, index) => (
                  <span
                    className="num"
                    style={{ fontSize: 12, color: "var(--ink-400)" }}
                  >
                    {index + 1}
                  </span>
                ),
              },
              {
                title: "主播",
                render: (r) => (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <Avatar name={r.streamer?.displayName} size={24} />
                    <div>
                      <div style={{ color: "var(--ink-900)", fontWeight: 500 }}>
                        {r.streamer?.displayName}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                        {admissionAccountLabel(r)}
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                title: "提交日期",
                render: (r) => (
                  <span className="num" style={{ fontSize: 12 }}>
                    {String(r.submittedAt || "").slice(0, 10) || "—"}
                  </span>
                ),
              },
              {
                title: "版本",
                render: (r) => (
                  <span className="mono" style={{ fontSize: 12 }}>
                    {r.latestRecording?.version
                      ? `v${r.latestRecording.version}`
                      : "—"}
                  </span>
                ),
              },
              {
                title: "时长",
                align: "right",
                render: (r) => (
                  <span className="num" style={{ fontSize: 12 }}>
                    {admissionRecordingDurationLabel(
                      r.latestRecording?.durationSeconds,
                    )}
                  </span>
                ),
              },
              {
                title: "来源",
                render: (r) => {
                  const source = admissionRecordingSourceMeta(
                    r.latestRecording,
                  );
                  return <Badge tone={source.tone}>{source.label}</Badge>;
                },
              },
              {
                title: "AI",
                render: (r) => (
                  <span style={{ fontSize: 12, color: "var(--ink-600)" }}>
                    {r.latestRecording?.aiAnalysis?.statusLabel || "—"}
                  </span>
                ),
              },
              {
                title: "状态",
                render: (r) => {
                  const meta = admissionWorkspaceStatusMeta(r);
                  return <StatusPill tone={meta.tone}>{meta.label}</StatusPill>;
                },
              },
            ]}
          />
        </Card>
      </div>
      <div className="admission-workspace-col">
        <AdmissionWorkspaceDetail
          application={active}
          projectName={projectName}
          pendingLeft={pendingLeft}
          hasRows={rows.length > 0}
          busyAction={busyAction}
          onReview={reviewAndAdvance}
          onOpenAiAnalysis={onOpenAiAnalysis}
          fetchPreReview={fetchPreReview}
        />
      </div>
    </div>
  );
}

// 工作台右栏：播放窗（私有内嵌 video / B 站 iframe / 外链按钮）+ AI 识别区
// （录屏 AI 摘要 + AI 预审卡点）+ 审核操作条。
function AdmissionWorkspaceDetail({
  application,
  projectName,
  pendingLeft,
  hasRows,
  busyAction,
  onReview,
  onOpenAiAnalysis,
  fetchPreReview,
}) {
  const submissionId = application?.latestRecording?.id ?? null;
  const recording = application?.latestRecording ?? null;
  const externalUrl = admissionRecordingExternalUrl(recording);
  const embedSrc = admissionBilibiliEmbedSrc(externalUrl);
  const canPlayPrivate = Boolean(
    recording?.hasPrivateStorage && recording?.assetId,
  );
  const [videoError, setVideoError] = React.useState(false);
  const [playbackSource, setPlaybackSource] = React.useState(
    canPlayPrivate ? "private" : "external",
  );
  // 逐字稿面板的时间戳跳转/高亮跟随需要直接操作本屏的 video 元素。
  const videoRef = React.useRef(null);
  // AI 预审：选中条目变化时拉取一次；失败降级为灰字，不阻塞审核操作。
  const [preReview, setPreReview] = React.useState({
    status: "idle",
    data: null,
    fastLane: null,
    labels: {},
  });

  React.useEffect(() => {
    setVideoError(false);
  }, [submissionId]);

  React.useEffect(() => {
    setPlaybackSource(canPlayPrivate ? "private" : "external");
  }, [canPlayPrivate, submissionId]);

  React.useEffect(() => {
    let cancelled = false;
    if (!submissionId || typeof fetchPreReview !== "function") {
      setPreReview({
        status: submissionId ? "error" : "idle",
        data: null,
        fastLane: null,
        labels: {},
      });
      return () => {
        cancelled = true;
      };
    }
    setPreReview({ status: "loading", data: null, fastLane: null, labels: {} });
    Promise.all([fetchPreReview(submissionId), loadMcnReviewCheckpoints()])
      .then(([result, checkpoints]) => {
        if (cancelled) return;
        setPreReview({
          status: "ready",
          data: result?.preReview ?? null,
          fastLane: result?.fastLane ?? null,
          labels: Object.fromEntries(
            (checkpoints ?? []).map((checkpoint) => [
              checkpoint.key,
              checkpoint.label,
            ]),
          ),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setPreReview({
          status: "error",
          data: null,
          fastLane: null,
          labels: {},
        });
      });
    return () => {
      cancelled = true;
    };
  }, [submissionId, fetchPreReview]);

  if (!application) {
    return (
      <div style={{ position: "sticky", top: 76 }}>
        <Card>
          <EmptyHint
            title="从左侧选择一条录屏"
            hint="选中后可在此就地播放并完成审核。"
          />
        </Card>
      </div>
    );
  }

  const hasBothSources = Boolean(canPlayPrivate && externalUrl);
  const showPrivateSource = Boolean(
    canPlayPrivate && (!externalUrl || playbackSource === "private"),
  );
  const statusMeta = admissionWorkspaceStatusMeta(application);
  const reviewable = isAdmissionRecordingReviewable(application);
  const analysis = recording?.aiAnalysis ?? null;
  const dimensionLabels = Object.fromEntries(
    (analysis?.dimensions ?? []).map((dimension) => [
      dimension.key,
      dimension.label,
    ]),
  );
  const scorecardEntries = Object.entries(analysis?.scorecard ?? {}).slice(
    0,
    4,
  );
  const riskFlags = (analysis?.riskFlags ?? []).slice(0, 2);
  const preReviewCheckpoints = (preReview.data?.checkpoints ?? []).slice(0, 6);

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
              {displayRecordId(application.id, "报名记录")}
              {recording?.version ? ` · v${recording.version}` : ""}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--ink-900)",
                marginTop: 2,
              }}
            >
              {application.streamer?.displayName || "主播"} · {projectName}
            </div>
          </div>
          <StatusPill tone={statusMeta.tone}>{statusMeta.label}</StatusPill>
        </div>
        <div
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            flex: 1,
            minHeight: 0,
          }}
        >
          {hasRows && pendingLeft === 0 ? (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                background: "#E6F6EE",
                color: "#0E8A4D",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              本项目待审核已清零 ✅
            </div>
          ) : null}
          {/* 播放窗 + 直播逐字稿：宽屏并排（逐字稿作侧栏），窄屏 flexWrap 折行。 */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "stretch",
              gap: 12,
              flex: "1 1 auto",
              minHeight: 0,
            }}
          >
            <div
              style={{
                background: "#0B1220",
                borderRadius: 10,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 8,
                flex: "1.4 1 300px",
                minWidth: 0,
                minHeight: 200,
                overflow: "hidden",
              }}
            >
              {hasBothSources ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button
                    size="sm"
                    kind={showPrivateSource ? "primary" : "default"}
                    onClick={() => setPlaybackSource("private")}
                  >
                    原始录屏
                  </Button>
                  <Button
                    size="sm"
                    kind={!showPrivateSource ? "primary" : "default"}
                    onClick={() => setPlaybackSource("external")}
                  >
                    平台链接
                  </Button>
                </div>
              ) : null}
              {showPrivateSource ? (
                <>
                  <video
                    ref={videoRef}
                    controls
                    key={recording.assetId}
                    style={{
                      flex: 1,
                      minHeight: 0,
                      width: "100%",
                      objectFit: "contain",
                      borderRadius: 8,
                      background: "#000",
                    }}
                    src={`/api/recording-assets/${recording.assetId}/download`}
                    onError={() => setVideoError(true)}
                  />
                  {videoError ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: "#FCA5A5",
                        textAlign: "center",
                      }}
                    >
                      无法加载视频（签名过期或文件缺失）
                    </div>
                  ) : null}
                </>
              ) : embedSrc ? (
                <iframe
                  title="B 站录屏播放"
                  src={embedSrc}
                  allowFullScreen
                  style={{
                    width: "100%",
                    flex: "0 1 auto",
                    aspectRatio: "16 / 9",
                    maxHeight: "100%",
                    border: "none",
                    borderRadius: 8,
                    background: "#000",
                  }}
                />
              ) : externalUrl ? (
                <div style={{ textAlign: "center", padding: "44px 0" }}>
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 16px",
                      borderRadius: 8,
                      border: "1px solid #334155",
                      background: "#111C33",
                      color: "#C7D5F2",
                      fontSize: 13,
                      fontWeight: 500,
                      textDecoration: "none",
                    }}
                  >
                    打开外部链接 ↗
                  </a>
                </div>
              ) : (
                <div
                  style={{
                    textAlign: "center",
                    padding: "44px 0",
                    fontSize: 13,
                    color: "#64748B",
                  }}
                >
                  暂无录屏
                </div>
              )}
            </div>
            {showPrivateSource ? (
              <RecordingTranscriptPanel
                assetId={recording.assetId}
                assetName={`${application.streamer?.displayName || "主播"}-${projectName}`}
                videoRef={videoRef}
                analysisStatus={analysis?.status ?? null}
                bodyMaxHeight={240}
                style={{ flex: "1 1 260px", minWidth: 240 }}
              />
            ) : null}
          </div>
          {/* AI 识别与预审：常驻面板底部，内容超高时块内滚动 */}
          <div
            style={{
              flexShrink: 0,
              maxHeight: 250,
              overflowY: "auto",
              display: "grid",
              gap: 14,
            }}
          >
            <div>
              <SectionKicker>录屏 AI</SectionKicker>
              {analysis ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <Badge
                      tone={
                        analysis.status === "succeeded"
                          ? "green"
                          : analysis.status === "failed"
                            ? "red"
                            : "violet"
                      }
                    >
                      {analysis.statusLabel || analysis.status}
                    </Badge>
                    {analysis.summary ? (
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 12,
                          color: "var(--ink-600)",
                        }}
                      >
                        {analysis.summary}
                      </span>
                    ) : (
                      <span style={{ flex: 1 }} />
                    )}
                    <Button
                      size="sm"
                      kind="link"
                      style={{ height: 22, padding: 0 }}
                      onClick={() => onOpenAiAnalysis(analysis)}
                    >
                      查看全部
                    </Button>
                  </div>
                  {scorecardEntries.length ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {scorecardEntries.map(([key, score]) => (
                        <Badge key={key} tone="violet">
                          {dimensionLabels[key] || key} {score}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {riskFlags.map((flag) => (
                    <div
                      key={flag}
                      style={{ fontSize: 12, color: "var(--danger-600)" }}
                    >
                      ⚠ {flag}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
                  AI 分析未运行
                </div>
              )}
            </div>
            <div>
              <SectionKicker>AI 预审</SectionKicker>
              {preReview.status === "loading" ? (
                <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
                  预审结果拉取中…
                </div>
              ) : preReview.status === "error" ? (
                <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
                  预审结果不可用
                </div>
              ) : !preReview.data ? (
                <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
                  暂无 AI 预审结果
                </div>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {preReview.fastLane?.eligible ? (
                    <div>
                      <Badge tone="green">快速通道候选</Badge>
                    </div>
                  ) : null}
                  {preReviewCheckpoints.map((checkpoint) => (
                    <div
                      key={checkpoint.key}
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <Badge
                        tone={admissionPreReviewVerdictTone(checkpoint.verdict)}
                      >
                        {admissionPreReviewVerdictLabel(checkpoint.verdict)}
                      </Badge>
                      <span style={{ fontSize: 12, color: "var(--ink-600)" }}>
                        {preReview.labels[checkpoint.key] || checkpoint.key}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {reviewable ? (
            <div
              style={{
                flexShrink: 0,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                borderTop: "1px solid var(--line)",
                paddingTop: 12,
              }}
            >
              <Button
                kind="danger"
                onClick={() => onReview(application, "rejected")}
                disabled={busyAction === `review:${application.id}:rejected`}
              >
                驳回
              </Button>
              <Button
                kind="default"
                onClick={() => onReview(application, "needs_changes")}
                disabled={
                  busyAction === `review:${application.id}:needs_changes`
                }
              >
                需修改
              </Button>
              <Button
                kind="primary"
                onClick={() => onReview(application, "approved")}
                disabled={busyAction === `review:${application.id}:approved`}
              >
                审核通过
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function buildAdmissionProjectBoards(applications = []) {
  const boards = new Map();
  for (const application of applications) {
    const project = admissionProject(application);
    const current = boards.get(project.id) ?? {
      project,
      counts: {
        totalApplications: 0,
        recordingCount: 0,
        mcnPendingReview: 0,
        mcnApproved: 0,
        mcnRejected: 0,
        needsChanges: 0,
        vendorPending: 0,
        vendorSelected: 0,
        vendorBackup: 0,
        vendorRejected: 0,
        vendorNeedsChanges: 0,
        pendingFinalConfirm: 0,
      },
      share: {
        id: null,
        status: "unshared",
        expiresAt: null,
        lastSubmittedAt: null,
      },
      lastActivityAt: application.submittedAt ?? null,
    };
    incrementAdmissionCounts(current, application);
    boards.set(project.id, current);
  }
  return [...boards.values()];
}

function incrementAdmissionCounts(board, application) {
  const status = application.status;
  const recordingStatus = application.latestRecording?.status;
  const decision = application.vendorReview?.decision || "pending";
  board.counts.totalApplications += 1;
  if (application.latestRecording) board.counts.recordingCount += 1;
  if (
    [
      "recording_reviewing",
      "pending_recording_review",
      "pending_review",
    ].includes(status) ||
    ["submitted", "reviewing", "pending_review"].includes(recordingStatus)
  ) {
    board.counts.mcnPendingReview += 1;
  }
  if (status === "recording_approved" || status === "joined") {
    board.counts.mcnApproved += 1;
  }
  if (status === "recording_rejected" || recordingStatus === "rejected") {
    board.counts.mcnRejected += 1;
  }
  if (status === "recording_required" || recordingStatus === "needs_changes") {
    board.counts.needsChanges += 1;
  }
  if (status === "recording_approved") {
    board.counts.pendingFinalConfirm += 1;
  }
  if (decision === "pending") board.counts.vendorPending += 1;
  if (decision === "selected") board.counts.vendorSelected += 1;
  if (decision === "backup") board.counts.vendorBackup += 1;
  if (decision === "rejected") board.counts.vendorRejected += 1;
  if (decision === "needs_changes") board.counts.vendorNeedsChanges += 1;
}

function isAdmissionRecordingReviewable(application) {
  const status = application.status;
  const recordingStatus = application.latestRecording?.status;
  return (
    Boolean(application.latestRecording) &&
    ([
      "recording_reviewing",
      "pending_recording_review",
      "pending_review",
    ].includes(status) ||
      ["submitted", "reviewing", "pending_review"].includes(recordingStatus))
  );
}

function canProxyUploadAdmissionRecording(application) {
  return [
    "submitted",
    "invited",
    "recording_required",
    "recording_rejected",
  ].includes(application.status);
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function canRequestAdmissionRecordingAiAnalysis(application) {
  const assetId = application.latestRecording?.assetId;
  const analysisStatus = application.latestRecording?.aiAnalysis?.status;
  return (
    Boolean(assetId) &&
    (!analysisStatus || analysisStatus === "failed") &&
    isAdmissionRecordingReviewable(application)
  );
}

function admissionRecordingReviewNote(application, decision) {
  const base = "经营端选播准入审核";
  const analysis = application.latestRecording?.aiAnalysis;
  if (!analysis || analysis.status !== "succeeded") {
    return base;
  }

  const parts = [base, `人工结论：${recordingReviewDecisionLabel(decision)}`];
  if (analysis.summary) {
    parts.push(`AI辅助摘要：${analysis.summary}`);
  }
  const recommendations = (analysis.recommendations ?? [])
    .map((recommendation) =>
      [recommendation.title, recommendation.detail].filter(Boolean).join(" - "),
    )
    .filter(Boolean);
  if (recommendations.length > 0) {
    parts.push(`AI建议：${recommendations.join("；")}`);
  }
  return parts.join("。");
}

function recordingReviewDecisionLabel(decision) {
  if (decision === "approved") return "通过";
  if (decision === "rejected") return "驳回";
  return "需补充";
}

function admissionNextActionLabel(application) {
  const decision = application.vendorReview?.decision;
  if (decision === "selected" && application.status === "recording_approved") {
    return "邀请进入项目";
  }
  if (decision === "backup") return "厂家备选，等待最终名额";
  if (decision === "rejected") return "等待主播重新上传";
  if (decision === "needs_changes") return "等待主播补充录屏";
  if (isAdmissionRecordingReviewable(application)) return "MCN 初审";
  if (!application.latestRecording) return "等待录屏";
  return "无需操作";
}

function recordingDecisionSuccessMessage(decision) {
  if (decision === "approved") return "录屏已通过";
  if (decision === "rejected") return "录屏已驳回";
  return "已要求补充录屏";
}

function admissionProject(application) {
  const project = application.project ?? {};
  return {
    id: admissionProjectId(application),
    code: project.code || application.projectCode || "",
    name:
      project.name ||
      application.projectName ||
      displayRecordId(admissionProjectId(application), "项目记录"),
    status: project.status || application.projectStatus || "",
    vendor: project.vendor || application.vendor || "",
    product: project.product || application.product || "",
  };
}

function admissionProjectId(application) {
  return application.project?.id || application.projectId || "unknown-project";
}

function admissionAccountLabel(application) {
  return (
    application.streamer?.accountLabel ||
    application.streamer?.account ||
    application.streamer?.platformAccount ||
    "未配置账号"
  );
}

function admissionShareStatusLabel(status) {
  const labels = {
    unshared: "未分享",
    active: "已分享",
    expired: "已过期",
    revoked: "已撤销",
  };
  return labels[status] || status;
}

function vendorDecisionLabel(decision) {
  const labels = {
    pending: "待厂家反馈",
    selected: "厂家已选",
    backup: "厂家备选",
    rejected: "厂家拒绝",
    needs_changes: "需修改",
  };
  return labels[decision || "pending"] || decision;
}

function vendorDecisionTone(decision) {
  const tones = {
    selected: "teal",
    backup: "amber",
    rejected: "red",
    needs_changes: "violet",
  };
  return tones[decision] || "neutral";
}

let cachedMcnReviewCheckpoints = null;

async function loadMcnReviewCheckpoints() {
  if (cachedMcnReviewCheckpoints) return cachedMcnReviewCheckpoints;
  try {
    const response = await fetch(
      "/api/admission-review/rubric?stage=mcn_first",
    );
    if (!response.ok) return [];
    const payload = await response.json();
    cachedMcnReviewCheckpoints = Array.isArray(payload?.checkpoints)
      ? payload.checkpoints
      : [];
    return cachedMcnReviewCheckpoints;
  } catch {
    return [];
  }
}

// 编号多选：返回卡点 key 数组；取消或无有效选择返回 null（中止审核）。
function askAdmissionReasonCodes(checkpoints, decision) {
  const menu = checkpoints
    .map((checkpoint, index) => `${index + 1}. ${checkpoint.label}`)
    .join("\n");
  const raw = globalThis.prompt?.(
    `${recordingReviewDecisionLabel(decision)}理由（输入编号，逗号分隔可多选）：\n${menu}`,
    "",
  );
  if (typeof raw !== "string" || !raw.trim()) return null;
  const codes = [
    ...new Set(
      raw
        .split(/[^0-9]+/)
        .map((token) => parseInt(token, 10))
        .filter((num) => num >= 1 && num <= checkpoints.length)
        .map((num) => checkpoints[num - 1].key),
    ),
  ];
  return codes.length ? codes : null;
}

function askAdmissionStructuredFeedback() {
  const issue = askText("哪里不合格");
  if (!issue) return null;
  const howToImprove = askText("怎么改");
  if (!howToImprove) return null;
  const rawSuggestion = globalThis.prompt?.(
    "建议（none=不建议重录，clip=补录指定片段，full=整段重录）",
    "none",
  );
  if (typeof rawSuggestion !== "string") return null;

  return {
    issue,
    howToImprove,
    rerecordSuggestion: normalizeAdmissionRerecordSuggestion(rawSuggestion),
    advisoryOnly: true,
  };
}

function normalizeAdmissionRerecordSuggestion(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (["1", "clip", "片段", "补录", "补录指定片段"].includes(normalized)) {
    return "clip";
  }
  if (["2", "full", "整段", "重录", "整段重录"].includes(normalized)) {
    return "full";
  }
  return "none";
}

function askText(label, defaultValue = "") {
  const value = globalThis.prompt?.(label, defaultValue);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toSettlementPoolFromReviewedReport(report, sourceReport) {
  const settlementDuration = Number(
    report.settlementDuration ?? (sourceReport?.duration ?? 0) * 60,
  );
  const evidenceLevel = report.evidenceLevel ?? "unknown";
  const timeSource = report.timeSource ?? "unknown";

  return {
    id: report.id || sourceReport?.id,
    projectId: report.projectId || sourceReport?.projectId,
    streamer:
      sourceReport?.streamer || displayRecordId(report.streamerId, "主播"),
    project: sourceReport?.project || displayRecordId(report.projectId, "项目"),
    hours: Math.round((settlementDuration / 60) * 10) / 10,
    evidence: `${evidenceLevel} · ${timeSource}`,
    rule: "cpt",
    expected: Math.round((settlementDuration / 60) * 80),
    approvedAt: formatOpsMinute(
      report.reviewedAt || report.updatedAt || new Date().toISOString(),
    ),
  };
}
