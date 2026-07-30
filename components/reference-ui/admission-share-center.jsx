"use client";

import React from "react";

const tabs = [
  { id: "library", label: "录屏库" },
  { id: "tasks", label: "分享任务" },
  { id: "results", label: "结果待办" },
];

const statusLabels = {
  ready: "就绪",
  warning: "提醒",
  blocked: "阻断",
};

const reasonLabels = {
  MCN_APPROVAL_REQUIRED: "MCN 审核通过后才可分享",
  SOURCE_UNAVAILABLE: "原始视频和外部链接均不可用",
  SELECTION_STALE: "录屏状态已变化，请重新选择",
  EXTERNAL_ONLY: "仅有外部链接，建议确认可访问性",
};

const sourceLabels = {
  original_ready: "原始视频",
  original_with_external_fallback: "原始视频 + 外链备用",
  external_only: "仅外部链接",
  blocked: "来源不可用",
  original: "原始视频",
  external: "外部链接",
  none: "无可用来源",
};

const taskStatusLabels = {
  active: "进行中",
  expired: "已过期",
  revoked: "已撤销",
  completed: "已完成",
};

const buttonBase = {
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 6,
  border: "1px solid var(--line-strong, var(--line))",
  background: "#fff",
  color: "var(--ink-700)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const buttonKinds = {
  primary: {
    background: "var(--blue-600)",
    borderColor: "var(--blue-600)",
    color: "#fff",
  },
  danger: {
    background: "#fff",
    borderColor: "var(--danger-200, var(--line))",
    color: "var(--danger-600)",
  },
  quiet: {
    background: "transparent",
    borderColor: "transparent",
    color: "var(--blue-700)",
  },
};

const inputStyle = {
  minHeight: 44,
  width: "100%",
  border: "1px solid var(--line-strong, var(--line))",
  borderRadius: 6,
  background: "#fff",
  color: "var(--ink-900)",
  padding: "8px 10px",
  fontSize: 13,
};

const panelStyle = {
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "#fff",
};

function ActionButton({
  children,
  kind = "default",
  style,
  disabled,
  ...props
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        ...buttonBase,
        ...(buttonKinds[kind] || {}),
        ...(disabled ? { cursor: "not-allowed", opacity: 0.5 } : {}),
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}

function sevenDaysFromNowInput() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setSeconds(0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function dateInputToIso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function shareItem(candidate, sortOrder) {
  return {
    applicationId: candidate.applicationId,
    recordingSubmissionId: candidate.recordingSubmissionId,
    recordingVersion: candidate.recordingVersion,
    sortOrder,
  };
}

function candidateLabel(candidate) {
  return `${candidate.streamer?.displayName || "未命名主播"} V${candidate.recordingVersion}`;
}

function formatDate(value) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function AdmissionShareCenter({ project, actions, onClose }) {
  const firstTabRef = React.useRef(null);
  const openerRef = React.useRef(null);
  const [tab, setTab] = React.useState("library");
  const [candidates, setCandidates] = React.useState([]);
  const [tasks, setTasks] = React.useState([]);
  const [issues, setIssues] = React.useState([]);
  const [selected, setSelected] = React.useState(new Map());
  const [expandedVersions, setExpandedVersions] = React.useState(new Set());
  const [search, setSearch] = React.useState("");
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [shareableOnly, setShareableOnly] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [wizardStep, setWizardStep] = React.useState(0);
  const [preflight, setPreflight] = React.useState(null);
  const [draft, setDraft] = React.useState({
    mode: "formal_review",
    title: `${project.name || "项目"} 录屏复核`,
    purpose: "",
    expiresAt: sevenDaysFromNowInput(),
    requireAccessCode: true,
    accessCode: "",
    allowExternalFallback: true,
  });
  const [delivery, setDelivery] = React.useState(null);
  const [taskExpiresAt, setTaskExpiresAt] = React.useState({});
  const [reopenReasons, setReopenReasons] = React.useState({});
  const [submissions, setSubmissions] = React.useState({});

  React.useEffect(() => {
    openerRef.current = document.activeElement;
    firstTabRef.current?.focus();
    return () => {
      openerRef.current?.focus?.();
    };
  }, []);

  const loadTasks = React.useCallback(async () => {
    if (!actions.listAdmissionShareBoards) return [];
    const result = await actions.listAdmissionShareBoards(project.id);
    const next = Array.isArray(result) ? result : [];
    setTasks(next);
    return next;
  }, [actions, project.id]);

  const loadIssues = React.useCallback(async () => {
    if (!actions.listAdmissionSharePlaybackIssues) return [];
    const result = await actions.listAdmissionSharePlaybackIssues(
      project.id,
      "open",
    );
    const next = Array.isArray(result) ? result : [];
    setIssues(next);
    return next;
  }, [actions, project.id]);

  React.useEffect(() => {
    let current = true;
    const loadInitialData = async () => {
      try {
        const [candidateResult, taskResult] = await Promise.all([
          actions.listAdmissionShareCandidates
            ? actions.listAdmissionShareCandidates(project.id)
            : [],
          actions.listAdmissionShareBoards
            ? actions.listAdmissionShareBoards(project.id)
            : [],
        ]);
        if (!current) return;
        setCandidates(Array.isArray(candidateResult) ? candidateResult : []);
        setTasks(Array.isArray(taskResult) ? taskResult : []);
        if (!actions.listAdmissionShareCandidates) {
          setMessage("录屏候选接口暂未接入");
        }
      } catch (error) {
        if (current) {
          setMessage(error?.message || "录屏分享数据加载失败");
        }
      } finally {
        if (current) setLoading(false);
      }
    };
    loadInitialData();
    return () => {
      current = false;
    };
  }, [actions, project.id]);

  const selectedCandidates = React.useMemo(
    () => Array.from(selected.values()),
    [selected],
  );

  const candidateByRecordingId = React.useMemo(
    () =>
      new Map(
        candidates.map((candidate) => [
          candidate.recordingSubmissionId,
          candidate,
        ]),
      ),
    [candidates],
  );

  const groupedCandidates = React.useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const matches = candidates.filter((candidate) => {
      const searchable = [
        candidate.streamer?.displayName,
        candidate.streamer?.accountLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (normalizedSearch && !searchable.includes(normalizedSearch)) {
        return false;
      }
      if (shareableOnly && !candidate.isShareable) return false;
      if (sourceFilter === "original" && !candidate.hasPrivateStorage) {
        return false;
      }
      if (sourceFilter === "external" && !candidate.externalUrl) return false;
      if (sourceFilter === "blocked" && candidate.sourceHealth !== "blocked") {
        return false;
      }
      return true;
    });

    const groups = new Map();
    for (const candidate of matches) {
      const group = groups.get(candidate.applicationId) || [];
      group.push(candidate);
      groups.set(candidate.applicationId, group);
    }
    return Array.from(groups.entries()).map(([applicationId, items]) => ({
      applicationId,
      items: items.sort(
        (left, right) => right.recordingVersion - left.recordingVersion,
      ),
    }));
  }, [candidates, search, shareableOnly, sourceFilter]);

  const toggleSelection = (candidate) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(candidate.recordingSubmissionId)) {
        next.delete(candidate.recordingSubmissionId);
      } else {
        next.set(candidate.recordingSubmissionId, candidate);
      }
      return next;
    });
  };

  const moveSelection = (recordingSubmissionId, offset) => {
    setSelected((current) => {
      const entries = Array.from(current.entries());
      const index = entries.findIndex(([id]) => id === recordingSubmissionId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= entries.length) return current;
      [entries[index], entries[target]] = [entries[target], entries[index]];
      return new Map(entries);
    });
  };

  const startWizard = async () => {
    if (selected.size === 0) {
      setMessage("请先主动选择本次分享的录屏");
      return;
    }
    if (!actions.preflightAdmissionShareBoard) {
      setMessage("分享预检接口暂未接入");
      return;
    }
    setBusy("preflight");
    setMessage("");
    setWizardOpen(true);
    setWizardStep(0);
    setPreflight(null);
    try {
      const items = selectedCandidates.map(shareItem);
      const result = await actions.preflightAdmissionShareBoard(
        project.id,
        items,
      );
      setPreflight(result);
      if ((result?.summary?.blocked || 0) === 0) {
        setWizardStep(1);
      }
    } catch (error) {
      setMessage(error?.message || "分享预检失败");
      setWizardOpen(false);
    } finally {
      setBusy("");
    }
  };

  const removeBlockedAndContinue = () => {
    const blockedIds = new Set(
      (preflight?.items || [])
        .filter((item) => item.status === "blocked")
        .map((item) => item.recordingSubmissionId),
    );
    setSelected(
      new Map(
        Array.from(selected.entries()).filter(([id]) => !blockedIds.has(id)),
      ),
    );
    setPreflight((current) => ({
      ...current,
      items: (current?.items || []).filter((item) => item.status !== "blocked"),
      summary: {
        ready: current?.summary?.ready || 0,
        warning: current?.summary?.warning || 0,
        blocked: 0,
      },
    }));
    setWizardStep(1);
  };

  const createShare = async () => {
    if (!actions.createAdmissionShareBoard) {
      setMessage("创建分享接口暂未接入");
      return;
    }
    setBusy("create");
    setMessage("");
    try {
      const expiresAt = dateInputToIso(draft.expiresAt);
      const result = await actions.createAdmissionShareBoard(project.id, {
        mode: draft.mode,
        title: draft.title.trim(),
        purpose: draft.purpose.trim() || undefined,
        expiresAt: expiresAt || undefined,
        requireAccessCode: draft.requireAccessCode,
        accessCode:
          draft.requireAccessCode && draft.accessCode.trim()
            ? draft.accessCode.trim()
            : undefined,
        allowExternalFallback: draft.allowExternalFallback,
        items: selectedCandidates.map(shareItem),
      });
      setDelivery({
        shareUrl: result?.shareUrl || "",
        accessCode: result?.accessCode || "",
        title: draft.title.trim(),
      });
      setSelected(new Map());
      setPreflight(null);
      setWizardOpen(false);
      setWizardStep(0);
      setMessage("分享任务已创建；链接和访问码仅在本次弹窗展示");
      await loadTasks().catch(() => {});
    } catch (error) {
      setMessage(error?.message || "分享任务创建失败");
    } finally {
      setBusy("");
    }
  };

  const runTaskAction = async (key, action, successMessage) => {
    setBusy(key);
    setMessage("");
    try {
      await action();
      setMessage(successMessage);
      await loadTasks();
    } catch (error) {
      setMessage(error?.message || "分享任务操作失败");
    } finally {
      setBusy("");
    }
  };

  const rotateTaskToken = async (task) => {
    if (!actions.rotateAdmissionShareBoardToken) return;
    setBusy(`rotate:${task.id}`);
    setMessage("");
    try {
      const result = await actions.rotateAdmissionShareBoardToken(
        project.id,
        task.id,
      );
      setDelivery({
        title: `${task.title}（已重置）`,
        shareUrl: result?.shareUrl || "",
        accessCode: result?.accessCode || "",
      });
    } catch (error) {
      setMessage(error?.message || "分享链接重置失败");
    } finally {
      setBusy("");
    }
  };

  const viewSubmissions = async (task) => {
    if (!actions.listAdmissionShareSubmissions) return;
    setBusy(`submissions:${task.id}`);
    try {
      const result = await actions.listAdmissionShareSubmissions(
        project.id,
        task.id,
      );
      setSubmissions((current) => ({
        ...current,
        [task.id]: Array.isArray(result) ? result : [],
      }));
    } catch (error) {
      setMessage(error?.message || "提交历史加载失败");
    } finally {
      setBusy("");
    }
  };

  const changeTab = (nextTab) => {
    setTab(nextTab);
    setMessage("");
    if (nextTab === "results") {
      setBusy("issues");
      loadIssues()
        .catch((error) => setMessage(error?.message || "结果待办加载失败"))
        .finally(() => setBusy(""));
    }
  };

  const resolveIssue = async (issue) => {
    if (!actions.resolveAdmissionSharePlaybackIssue) return;
    setBusy(`issue:${issue.id}`);
    try {
      await actions.resolveAdmissionSharePlaybackIssue(project.id, issue.id);
      setIssues((current) => current.filter((item) => item.id !== issue.id));
      setMessage("播放问题已标记为解决");
    } catch (error) {
      setMessage(error?.message || "播放问题处理失败");
    } finally {
      setBusy("");
    }
  };

  const closeCenter = () => {
    setDelivery(null);
    onClose?.();
  };

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={`${project.name || "项目"} 录屏分享中心`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !wizardOpen && !delivery) {
          event.preventDefault();
          closeCenter();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(15, 23, 42, 0.28)",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeCenter();
      }}
    >
      <div
        style={{
          width: "min(1180px, 100%)",
          height: "min(860px, calc(100vh - 32px))",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid var(--line)",
          borderRadius: 10,
          background: "var(--bg, #f7f8fb)",
          boxShadow: "0 24px 70px rgba(15, 23, 42, 0.2)",
          color: "var(--ink-900)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "16px 20px",
            borderBottom: "1px solid var(--line)",
            background: "#fff",
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>录屏分享中心</div>
            <div
              style={{ marginTop: 3, fontSize: 12, color: "var(--ink-500)" }}
            >
              {project.name} · 由你明确选择本轮分享的录屏和版本
            </div>
          </div>
          <ActionButton aria-label="关闭录屏分享中心" onClick={closeCenter}>
            关闭
          </ActionButton>
        </header>

        <div
          role="tablist"
          aria-label="录屏分享中心栏目"
          style={{
            display: "flex",
            gap: 4,
            padding: "8px 20px 0",
            borderBottom: "1px solid var(--line)",
            background: "#fff",
            overflowX: "auto",
          }}
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`admission-share-tab-${item.id}`}
              aria-controls="admission-share-tabpanel"
              aria-selected={tab === item.id}
              ref={item.id === "library" ? firstTabRef : undefined}
              onClick={() => changeTab(item.id)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                event.preventDefault();
                const currentIndex = tabs.findIndex(
                  (candidate) => candidate.id === item.id,
                );
                const offset = event.key === "ArrowRight" ? 1 : -1;
                const next =
                  tabs[(currentIndex + offset + tabs.length) % tabs.length];
                changeTab(next.id);
                document
                  .getElementById(`admission-share-tab-${next.id}`)
                  ?.focus();
              }}
              style={{
                minHeight: 44,
                padding: "0 14px",
                border: 0,
                borderBottom:
                  tab === item.id
                    ? "2px solid var(--blue-600)"
                    : "2px solid transparent",
                background: "transparent",
                color: tab === item.id ? "var(--blue-700)" : "var(--ink-500)",
                fontSize: 13,
                fontWeight: tab === item.id ? 700 : 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div
          aria-live="polite"
          role="status"
          style={{
            minHeight: message ? 37 : 0,
            padding: message ? "9px 20px" : 0,
            borderBottom: message ? "1px solid var(--line)" : 0,
            background: message ? "var(--blue-50)" : "transparent",
            color: "var(--blue-700)",
            fontSize: 13,
          }}
        >
          {message}
        </div>

        <main
          id="admission-share-tabpanel"
          role="tabpanel"
          aria-labelledby={`admission-share-tab-${tab}`}
          style={{ minHeight: 0, flex: 1, overflow: "auto", padding: 20 }}
        >
          {tab === "library" ? (
            <CandidateLibrary
              loading={loading}
              groups={groupedCandidates}
              selected={selected}
              selectedCandidates={selectedCandidates}
              expandedVersions={expandedVersions}
              search={search}
              sourceFilter={sourceFilter}
              shareableOnly={shareableOnly}
              onSearchChange={setSearch}
              onSourceFilterChange={setSourceFilter}
              onShareableOnlyChange={setShareableOnly}
              onToggleVersion={(applicationId) =>
                setExpandedVersions((current) => {
                  const next = new Set(current);
                  if (next.has(applicationId)) next.delete(applicationId);
                  else next.add(applicationId);
                  return next;
                })
              }
              onToggleSelection={toggleSelection}
              onMoveSelection={moveSelection}
              onPlayback={(candidate) =>
                actions.openAdmissionShareCandidatePlayback?.(
                  project.id,
                  candidate.recordingSubmissionId,
                )
              }
              onCreate={startWizard}
              busy={busy === "preflight"}
            />
          ) : null}
          {tab === "tasks" ? (
            <ShareTasks
              tasks={tasks}
              busy={busy}
              taskExpiresAt={taskExpiresAt}
              reopenReasons={reopenReasons}
              submissions={submissions}
              onTaskExpiresAtChange={(taskId, value) =>
                setTaskExpiresAt((current) => ({
                  ...current,
                  [taskId]: value,
                }))
              }
              onReopenReasonChange={(taskId, value) =>
                setReopenReasons((current) => ({
                  ...current,
                  [taskId]: value,
                }))
              }
              onRotate={rotateTaskToken}
              onExtend={(task) => {
                const expiresAt = dateInputToIso(taskExpiresAt[task.id]);
                if (!expiresAt) {
                  setMessage("请选择新的到期日期");
                  return;
                }
                runTaskAction(
                  `extend:${task.id}`,
                  () =>
                    actions.extendAdmissionShareBoard?.(
                      project.id,
                      task.id,
                      expiresAt,
                    ),
                  "分享任务已延期",
                );
              }}
              onReopen={(task) => {
                const reason = (reopenReasons[task.id] || "").trim();
                if (!reason) {
                  setMessage("请填写重开原因");
                  return;
                }
                runTaskAction(
                  `reopen:${task.id}`,
                  () =>
                    actions.reopenAdmissionShareBoard?.(
                      project.id,
                      task.id,
                      reason,
                    ),
                  "复核任务已重开",
                );
              }}
              onRevoke={(task) =>
                runTaskAction(
                  `revoke:${task.id}`,
                  () =>
                    actions.revokeAdmissionShareBoard?.(project.id, task.id),
                  "分享任务已撤销",
                )
              }
              onViewSubmissions={viewSubmissions}
            />
          ) : null}
          {tab === "results" ? (
            <PlaybackIssues
              issues={issues}
              loading={busy === "issues"}
              busy={busy}
              onResolve={resolveIssue}
            />
          ) : null}
        </main>
      </div>

      {wizardOpen ? (
        <ShareWizard
          step={wizardStep}
          draft={draft}
          preflight={preflight}
          selected={selectedCandidates}
          candidateByRecordingId={candidateByRecordingId}
          busy={busy}
          onDraftChange={(patch) =>
            setDraft((current) => ({ ...current, ...patch }))
          }
          onRemoveBlocked={removeBlockedAndContinue}
          onContinue={() =>
            setWizardStep((current) => Math.min(2, current + 1))
          }
          onBack={() => setWizardStep((current) => Math.max(0, current - 1))}
          onCreate={createShare}
          onClose={() => {
            setWizardOpen(false);
            setPreflight(null);
            setWizardStep(0);
          }}
        />
      ) : null}

      {delivery ? (
        <DeliveryDialog
          delivery={delivery}
          onClose={() => setDelivery(null)}
          onMessage={setMessage}
        />
      ) : null}
    </section>
  );
}

function CandidateLibrary({
  loading,
  groups,
  selected,
  selectedCandidates,
  expandedVersions,
  search,
  sourceFilter,
  shareableOnly,
  onSearchChange,
  onSourceFilterChange,
  onShareableOnlyChange,
  onToggleVersion,
  onToggleSelection,
  onMoveSelection,
  onPlayback,
  onCreate,
  busy,
}) {
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
          gap: 10,
          alignItems: "end",
        }}
      >
        <label style={fieldLabelStyle}>
          搜索主播
          <input
            aria-label="搜索主播"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="主播名或账号"
            style={inputStyle}
          />
        </label>
        <label style={fieldLabelStyle}>
          来源筛选
          <select
            aria-label="来源筛选"
            value={sourceFilter}
            onChange={(event) => onSourceFilterChange(event.target.value)}
            style={inputStyle}
          >
            <option value="all">全部来源</option>
            <option value="original">有原始视频</option>
            <option value="external">有外部链接</option>
            <option value="blocked">来源不可用</option>
          </select>
        </label>
        <label
          style={{
            ...fieldLabelStyle,
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <input
            type="checkbox"
            aria-label="只看可分享"
            checked={shareableOnly}
            onChange={(event) => onShareableOnlyChange(event.target.checked)}
          />
          只看可分享
        </label>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {loading ? (
          <div style={emptyStyle}>录屏库加载中…</div>
        ) : groups.length === 0 ? (
          <div style={emptyStyle}>没有符合条件的录屏</div>
        ) : (
          groups.map((group) => {
            const expanded = expandedVersions.has(group.applicationId);
            const visibleItems =
              expanded || group.items.length === 1
                ? group.items
                : group.items.slice(0, 1);
            const streamerName =
              group.items[0]?.streamer?.displayName || "未命名主播";
            return (
              <section key={group.applicationId} style={panelStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 13 }}>{streamerName}</strong>
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 12,
                        color: "var(--ink-400)",
                      }}
                    >
                      {group.items[0]?.streamer?.accountLabel || "无账号"}
                    </span>
                  </div>
                  {group.items.length > 1 ? (
                    <ActionButton
                      kind="quiet"
                      aria-label={`${expanded ? "收起" : "展开"} ${streamerName} 历史版本`}
                      onClick={() => onToggleVersion(group.applicationId)}
                    >
                      {expanded
                        ? "收起历史版本"
                        : `展开历史版本（${group.items.length - 1}）`}
                    </ActionButton>
                  ) : null}
                </div>
                {visibleItems.map((candidate) => (
                  <CandidateRow
                    key={candidate.recordingSubmissionId}
                    candidate={candidate}
                    checked={selected.has(candidate.recordingSubmissionId)}
                    onToggle={() => onToggleSelection(candidate)}
                    onPlayback={() => onPlayback(candidate)}
                  />
                ))}
              </section>
            );
          })
        )}
      </div>

      {selectedCandidates.length > 0 ? (
        <section
          role="region"
          aria-label="已选择录屏"
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 2,
            marginTop: 18,
            padding: 12,
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "#fff",
            boxShadow: "0 -8px 24px rgba(15, 23, 42, 0.08)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <strong style={{ fontSize: 14 }}>
              已选择 {selectedCandidates.length} 条
            </strong>
            <ActionButton kind="primary" disabled={busy} onClick={onCreate}>
              {busy ? "正在预检…" : "创建分享"}
            </ActionButton>
          </div>
          <ol
            style={{
              display: "grid",
              gap: 6,
              margin: "10px 0 0",
              padding: 0,
              listStyle: "none",
            }}
          >
            {selectedCandidates.map((candidate, index) => (
              <li
                key={candidate.recordingSubmissionId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                  fontSize: 12,
                  color: "var(--ink-600)",
                }}
              >
                <span style={{ width: 20, textAlign: "right" }}>
                  {index + 1}.
                </span>
                <span style={{ flex: 1 }}>{candidateLabel(candidate)}</span>
                <ActionButton
                  kind="quiet"
                  aria-label={`上移 ${candidateLabel(candidate)}`}
                  disabled={index === 0}
                  onClick={() =>
                    onMoveSelection(candidate.recordingSubmissionId, -1)
                  }
                >
                  上移
                </ActionButton>
                <ActionButton
                  kind="quiet"
                  aria-label={`下移 ${candidateLabel(candidate)}`}
                  disabled={index === selectedCandidates.length - 1}
                  onClick={() =>
                    onMoveSelection(candidate.recordingSubmissionId, 1)
                  }
                >
                  下移
                </ActionButton>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function CandidateRow({ candidate, checked, onToggle, onPlayback }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))",
        gap: 12,
        alignItems: "center",
        padding: "10px 14px",
        borderTop: "1px solid var(--line)",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          minHeight: 44,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <input
          type="checkbox"
          aria-label={`选择 ${candidateLabel(candidate)}`}
          checked={checked}
          onChange={onToggle}
        />
        <span>
          V{candidate.recordingVersion}
          {candidate.isLatestVersion ? (
            <span
              style={{
                marginLeft: 7,
                color: "var(--blue-700)",
                fontSize: 11,
              }}
            >
              当前版本
            </span>
          ) : (
            <span
              style={{
                marginLeft: 7,
                color: "var(--ink-400)",
                fontSize: 11,
              }}
            >
              历史版本
            </span>
          )}
        </span>
      </label>
      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
        <div>{sourceLabels[candidate.sourceHealth] || "来源待确认"}</div>
        <div style={{ marginTop: 3 }}>
          {candidate.isShareable
            ? "可加入本次分享"
            : reasonLabels[candidate.blockReason] || "暂不可分享"}
        </div>
      </div>
      <ActionButton
        aria-label={`播放 ${candidateLabel(candidate)}`}
        onClick={onPlayback}
      >
        播放
      </ActionButton>
    </div>
  );
}

function ShareWizard({
  step,
  draft,
  preflight,
  selected,
  candidateByRecordingId,
  busy,
  onDraftChange,
  onRemoveBlocked,
  onContinue,
  onBack,
  onCreate,
  onClose,
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="创建录屏分享"
      style={overlayStyle}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={dialogStyle}>
        <header style={dialogHeaderStyle}>
          <div>
            <strong>创建录屏分享</strong>
            <div
              style={{ marginTop: 4, fontSize: 12, color: "var(--ink-500)" }}
            >
              {["1 确认录屏", "2 分享规则", "3 甲方视角预览"].map(
                (label, index) => (
                  <span
                    key={label}
                    style={{
                      marginRight: 14,
                      color:
                        step === index ? "var(--blue-700)" : "var(--ink-400)",
                      fontWeight: step === index ? 700 : 500,
                    }}
                  >
                    {label}
                  </span>
                ),
              )}
            </div>
          </div>
          <ActionButton autoFocus aria-label="关闭创建向导" onClick={onClose}>
            关闭
          </ActionButton>
        </header>

        <div style={{ padding: 20, overflow: "auto" }}>
          {step === 0 ? (
            <PreflightPanel
              preflight={preflight}
              candidateByRecordingId={candidateByRecordingId}
            />
          ) : null}
          {step === 1 ? (
            <ShareRules
              draft={draft}
              preflight={preflight}
              candidateByRecordingId={candidateByRecordingId}
              onDraftChange={onDraftChange}
            />
          ) : null}
          {step === 2 ? (
            <VendorPreview
              draft={draft}
              selected={selected}
              preflight={preflight}
            />
          ) : null}
        </div>

        <footer style={dialogFooterStyle}>
          {step > 0 ? (
            <ActionButton onClick={onBack}>上一步</ActionButton>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {step === 0 && (preflight?.summary?.blocked || 0) > 0 ? (
              <ActionButton kind="primary" onClick={onRemoveBlocked}>
                移除异常并继续
              </ActionButton>
            ) : null}
            {step === 0 &&
            preflight &&
            (preflight?.summary?.blocked || 0) === 0 ? (
              <ActionButton kind="primary" onClick={onContinue}>
                下一步
              </ActionButton>
            ) : null}
            {step === 1 ? (
              <ActionButton
                kind="primary"
                disabled={!draft.title.trim()}
                onClick={onContinue}
              >
                下一步
              </ActionButton>
            ) : null}
            {step === 2 ? (
              <ActionButton
                kind="primary"
                disabled={busy === "create"}
                onClick={onCreate}
              >
                {busy === "create" ? "正在生成…" : "确认生成"}
              </ActionButton>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

function PreflightPanel({ preflight, candidateByRecordingId }) {
  if (!preflight) return <div style={emptyStyle}>正在逐条检查录屏状态…</div>;
  const blocked = preflight.summary?.blocked || 0;
  return (
    <div>
      <div
        style={{
          padding: 12,
          border: `1px solid ${
            blocked
              ? "var(--danger-200, var(--line))"
              : "var(--ok-200, var(--line))"
          }`,
          background: blocked
            ? "var(--danger-50, #fff7f7)"
            : "var(--ok-50, #f3fbf6)",
          color: blocked ? "var(--danger-600)" : "var(--ok-700, #27794b)",
          fontSize: 13,
        }}
      >
        {blocked
          ? `${blocked} 条录屏无法分享`
          : `预检通过：${preflight.summary?.ready || 0} 条就绪，${
              preflight.summary?.warning || 0
            } 条提醒`}
      </div>
      <PreflightRows
        preflight={preflight}
        candidateByRecordingId={candidateByRecordingId}
      />
    </div>
  );
}

function PreflightRows({ preflight, candidateByRecordingId }) {
  return (
    <div style={{ ...panelStyle, marginTop: 12 }}>
      {(preflight?.items || []).map((item, index) => {
        const candidate = candidateByRecordingId.get(
          item.recordingSubmissionId,
        );
        return (
          <div
            key={item.recordingSubmissionId}
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, 150px), 1fr))",
              gap: 10,
              alignItems: "center",
              minHeight: 52,
              padding: "6px 12px",
              borderTop: index ? "1px solid var(--line)" : 0,
              fontSize: 12,
            }}
          >
            <span style={{ color: "var(--ink-400)" }}>{index + 1}</span>
            <strong>
              {candidate
                ? candidateLabel(candidate)
                : `录屏 V${item.recordingVersion}`}
            </strong>
            <span
              style={{
                color:
                  item.status === "blocked"
                    ? "var(--danger-600)"
                    : item.status === "warning"
                      ? "var(--warn-600)"
                      : "var(--ok-600)",
                fontWeight: 700,
              }}
            >
              {statusLabels[item.status] || item.status}
            </span>
            <span style={{ color: "var(--ink-500)" }}>
              {reasonLabels[item.reasonCode] ||
                sourceLabels[item.sourceHealth] ||
                "状态正常"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ShareRules({
  draft,
  preflight,
  candidateByRecordingId,
  onDraftChange,
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <PreflightRows
        preflight={preflight}
        candidateByRecordingId={candidateByRecordingId}
      />
      <fieldset
        style={{
          ...panelStyle,
          display: "flex",
          gap: 18,
          padding: 14,
          margin: 0,
        }}
      >
        <legend style={{ padding: "0 6px", fontSize: 12, fontWeight: 700 }}>
          分享模式
        </legend>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="share-mode"
            aria-label="正式复核"
            checked={draft.mode === "formal_review"}
            onChange={() =>
              onDraftChange({
                mode: "formal_review",
                requireAccessCode: true,
              })
            }
          />
          正式复核
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="share-mode"
            aria-label="仅预览"
            checked={draft.mode === "preview"}
            onChange={() =>
              onDraftChange({ mode: "preview", requireAccessCode: false })
            }
          />
          仅预览
        </label>
      </fieldset>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 12,
        }}
      >
        <label style={fieldLabelStyle}>
          分享名称
          <input
            aria-label="分享名称"
            value={draft.title}
            onChange={(event) => onDraftChange({ title: event.target.value })}
            style={inputStyle}
          />
        </label>
        <label style={fieldLabelStyle}>
          有效期
          <input
            type="datetime-local"
            aria-label="分享有效期"
            value={draft.expiresAt}
            onChange={(event) =>
              onDraftChange({ expiresAt: event.target.value })
            }
            style={inputStyle}
          />
        </label>
      </div>
      <label style={fieldLabelStyle}>
        分享目的
        <textarea
          aria-label="分享目的"
          value={draft.purpose}
          onChange={(event) => onDraftChange({ purpose: event.target.value })}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </label>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <label style={radioLabelStyle}>
          <input
            type="checkbox"
            aria-label="需要访问码"
            checked={draft.requireAccessCode}
            onChange={(event) =>
              onDraftChange({ requireAccessCode: event.target.checked })
            }
          />
          需要访问码
        </label>
        <label style={radioLabelStyle}>
          <input
            type="checkbox"
            aria-label="允许外部链接备用"
            checked={draft.allowExternalFallback}
            onChange={(event) =>
              onDraftChange({ allowExternalFallback: event.target.checked })
            }
          />
          允许外部链接备用
        </label>
      </div>
      {draft.requireAccessCode ? (
        <label style={fieldLabelStyle}>
          自定义访问码（留空则系统生成）
          <input
            aria-label="自定义访问码"
            autoComplete="off"
            value={draft.accessCode}
            onChange={(event) =>
              onDraftChange({ accessCode: event.target.value })
            }
            style={inputStyle}
          />
        </label>
      ) : null}
    </div>
  );
}

function VendorPreview({ draft, selected, preflight }) {
  const warningCount = preflight?.summary?.warning || 0;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section style={{ ...panelStyle, padding: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{draft.title}</div>
            <div
              style={{ marginTop: 4, fontSize: 12, color: "var(--ink-500)" }}
            >
              {draft.mode === "formal_review" ? "正式复核" : "仅预览"} ·{" "}
              {draft.requireAccessCode ? "访问码保护" : "无需访问码"}
            </div>
          </div>
          <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
            甲方将看到 {selected.length} 条录屏
          </span>
        </div>
        {draft.purpose ? (
          <p
            style={{
              margin: "14px 0 0",
              fontSize: 13,
              color: "var(--ink-700)",
            }}
          >
            {draft.purpose}
          </p>
        ) : null}
      </section>
      <ol
        style={{
          ...panelStyle,
          margin: 0,
          padding: "8px 8px 8px 42px",
          fontSize: 13,
        }}
      >
        {selected.map((candidate) => (
          <li
            key={candidate.recordingSubmissionId}
            style={{ minHeight: 44, padding: "8px 6px" }}
          >
            {candidateLabel(candidate)} ·{" "}
            {sourceLabels[candidate.sourceHealth] || "来源待确认"}
          </li>
        ))}
      </ol>
      {warningCount ? (
        <div
          style={{
            padding: 12,
            background: "var(--warn-50, #fffbeb)",
            color: "var(--warn-700, #8a5b00)",
            fontSize: 12,
          }}
        >
          有 {warningCount}{" "}
          条录屏仅使用外部链接；已保留提醒，不会被“移除异常”删除。
        </div>
      ) : null}
    </div>
  );
}

function ShareTasks({
  tasks,
  busy,
  taskExpiresAt,
  reopenReasons,
  submissions,
  onTaskExpiresAtChange,
  onReopenReasonChange,
  onRotate,
  onExtend,
  onReopen,
  onRevoke,
  onViewSubmissions,
}) {
  const [confirmingRevoke, setConfirmingRevoke] = React.useState("");
  if (tasks.length === 0) return <div style={emptyStyle}>暂无分享任务</div>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {tasks.map((task) => (
        <article key={task.id} style={{ ...panelStyle, padding: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{task.title}</div>
              <div
                style={{ marginTop: 5, fontSize: 12, color: "var(--ink-500)" }}
              >
                {task.mode === "formal_review" ? "正式复核" : "仅预览"} · 第{" "}
                {task.roundNumber || 1} 轮 ·{" "}
                {taskStatusLabels[task.status] || task.status}
              </div>
            </div>
            <div
              style={{
                textAlign: "right",
                fontSize: 12,
                color: "var(--ink-500)",
              }}
            >
              <div>
                进度 {task.draftCompletedCount || 0}/{task.itemCount || 0}
              </div>
              <div style={{ marginTop: 4 }}>
                到期 {formatDate(task.expiresAt)}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              marginTop: 14,
            }}
          >
            <label style={fieldLabelStyle}>
              延期至
              <input
                type="date"
                aria-label={`${task.title} 延期至`}
                value={taskExpiresAt[task.id] || ""}
                onChange={(event) =>
                  onTaskExpiresAtChange(task.id, event.target.value)
                }
                style={inputStyle}
              />
            </label>
            <label style={fieldLabelStyle}>
              重开原因
              <input
                aria-label={`${task.title} 重开原因`}
                value={reopenReasons[task.id] || ""}
                onChange={(event) =>
                  onReopenReasonChange(task.id, event.target.value)
                }
                placeholder="仅在确需重新提交时填写"
                style={inputStyle}
              />
            </label>
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 12,
            }}
          >
            <ActionButton
              onClick={() => onRotate(task)}
              disabled={busy === `rotate:${task.id}`}
            >
              重置分享链接
            </ActionButton>
            <ActionButton
              aria-label={`延期 ${task.title}`}
              onClick={() => onExtend(task)}
              disabled={busy === `extend:${task.id}`}
            >
              延期
            </ActionButton>
            <ActionButton
              aria-label={`重开 ${task.title}`}
              onClick={() => onReopen(task)}
              disabled={busy === `reopen:${task.id}`}
            >
              重开
            </ActionButton>
            <ActionButton
              aria-label={`查看 ${task.title} 提交历史`}
              onClick={() => onViewSubmissions(task)}
              disabled={busy === `submissions:${task.id}`}
            >
              查看提交历史
            </ActionButton>
            <ActionButton
              kind="danger"
              aria-label={`撤销 ${task.title}`}
              onClick={() => setConfirmingRevoke(task.id)}
              disabled={busy === `revoke:${task.id}`}
            >
              撤销
            </ActionButton>
          </div>
          {confirmingRevoke === task.id ? (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 12,
                padding: 12,
                border: "1px solid var(--danger-200, var(--line))",
                background: "var(--danger-50, #fff7f7)",
                color: "var(--danger-700, var(--danger-600))",
                fontSize: 12,
              }}
            >
              <span>撤销后当前分享链接立即失效，确认继续？</span>
              <span style={{ display: "flex", gap: 8 }}>
                <ActionButton onClick={() => setConfirmingRevoke("")}>
                  取消
                </ActionButton>
                <ActionButton
                  kind="danger"
                  aria-label={`确认撤销 ${task.title}`}
                  onClick={() => {
                    setConfirmingRevoke("");
                    onRevoke(task);
                  }}
                >
                  确认撤销
                </ActionButton>
              </span>
            </div>
          ) : null}
          {Object.hasOwn(submissions, task.id) ? (
            <div
              aria-label={`${task.title} 提交历史`}
              style={{
                marginTop: 12,
                padding: 12,
                borderTop: "1px solid var(--line)",
              }}
            >
              {submissions[task.id].length === 0 ? (
                <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
                  暂无提交记录
                </span>
              ) : (
                submissions[task.id].map((submission, index) => (
                  <div
                    key={submission.id || index}
                    style={{ fontSize: 12, color: "var(--ink-600)" }}
                  >
                    {`第 ${submission.revision || index + 1} 次提交 · ${formatDate(
                      submission.submittedAt,
                    )}`}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function PlaybackIssues({ issues, loading, busy, onResolve }) {
  return (
    <section aria-label="播放问题待办">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>播放问题</h3>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: "var(--ink-500)",
            }}
          >
            仅展示尚未解决的甲方播放反馈
          </p>
        </div>
        <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
          {issues.length} 条待办
        </span>
      </div>
      {loading ? (
        <div style={emptyStyle}>结果待办加载中…</div>
      ) : issues.length === 0 ? (
        <div style={emptyStyle}>暂无播放问题</div>
      ) : (
        <div style={{ ...panelStyle, overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              minWidth: 720,
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr style={{ background: "var(--ink-50)" }}>
                {["主播 / 版本", "来源", "错误码", "上报时间", "操作"].map(
                  (label) => (
                    <th
                      key={label}
                      scope="col"
                      style={{
                        padding: "10px 12px",
                        textAlign: "left",
                        color: "var(--ink-500)",
                        fontWeight: 600,
                      }}
                    >
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr
                  key={issue.id}
                  style={{ borderTop: "1px solid var(--line)" }}
                >
                  <td style={tableCellStyle}>
                    {issue.streamerDisplayName || "未命名主播"} · V
                    {issue.recordingVersion}
                  </td>
                  <td style={tableCellStyle}>
                    {sourceLabels[issue.sourceType] || issue.sourceType}
                  </td>
                  <td style={tableCellStyle}>{issue.errorCode}</td>
                  <td style={tableCellStyle}>{formatDate(issue.reportedAt)}</td>
                  <td style={tableCellStyle}>
                    <ActionButton
                      onClick={() => onResolve(issue)}
                      disabled={busy === `issue:${issue.id}`}
                    >
                      标记已解决
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DeliveryDialog({ delivery, onClose, onMessage }) {
  const deliveryText = [
    delivery.title ? `任务：${delivery.title}` : "",
    `分享链接：${delivery.shareUrl}`,
    delivery.accessCode ? `访问码：${delivery.accessCode}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="一次性交付信息"
      style={{ ...overlayStyle, zIndex: 120 }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={{ ...dialogStyle, width: "min(560px, 100%)" }}>
        <header style={dialogHeaderStyle}>
          <div>
            <strong>一次性交付信息</strong>
            <div
              style={{ marginTop: 4, fontSize: 12, color: "var(--danger-600)" }}
            >
              关闭后不再展示明文，请现在完成交付。
            </div>
          </div>
        </header>
        <div style={{ padding: 20, display: "grid", gap: 12 }}>
          <label style={fieldLabelStyle}>
            分享链接
            <div
              style={{
                ...inputStyle,
                minHeight: 0,
                overflowWrap: "anywhere",
                userSelect: "all",
              }}
            >
              {delivery.shareUrl || "未返回分享链接"}
            </div>
          </label>
          {delivery.accessCode ? (
            <label style={fieldLabelStyle}>
              访问码
              <strong
                style={{
                  ...inputStyle,
                  display: "block",
                  minHeight: 0,
                  letterSpacing: "0.12em",
                }}
              >
                {delivery.accessCode}
              </strong>
            </label>
          ) : null}
        </div>
        <footer style={dialogFooterStyle}>
          <ActionButton
            autoFocus
            onClick={async () => {
              try {
                await copyText(deliveryText);
                onMessage("完整交付信息已复制");
              } catch {
                onMessage("复制失败，请手动复制");
              }
            }}
          >
            复制完整交付信息
          </ActionButton>
          <ActionButton
            kind="primary"
            aria-label="关闭交付信息"
            onClick={onClose}
          >
            我已完成交付并关闭
          </ActionButton>
        </footer>
      </div>
    </div>
  );
}

const fieldLabelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  color: "var(--ink-600)",
  fontSize: 12,
  fontWeight: 600,
};

const radioLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 44,
  fontSize: 13,
  color: "var(--ink-700)",
};

const emptyStyle = {
  ...panelStyle,
  padding: 32,
  textAlign: "center",
  color: "var(--ink-400)",
  fontSize: 13,
};

const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 110,
  display: "grid",
  placeItems: "center",
  padding: 16,
  background: "rgba(15, 23, 42, 0.38)",
};

const dialogStyle = {
  width: "min(760px, 100%)",
  maxHeight: "calc(100vh - 32px)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  border: "1px solid var(--line)",
  borderRadius: 10,
  background: "#fff",
  boxShadow: "0 24px 70px rgba(15, 23, 42, 0.22)",
};

const dialogHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "16px 20px",
  borderBottom: "1px solid var(--line)",
};

const dialogFooterStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "12px 20px",
  borderTop: "1px solid var(--line)",
  background: "var(--ink-50)",
};

const tableCellStyle = {
  padding: "10px 12px",
  color: "var(--ink-700)",
};
