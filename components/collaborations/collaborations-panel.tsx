"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type CollaborationView = {
  id: string;
  projectId: string;
  status: string;
  settlementMode: string;
  sharePercentage: number | null;
  hourlyFixedAmount: number | null;
  inviteCode: string | null;
};

type SubmissionView = {
  id: string;
  streamer_name: string;
  live_account: string | null;
  recording_url: string | null;
  status: string;
  review_note: string | null;
};

const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  submitted: "待一审",
  under_review: "一审中",
  approved: "已通过",
  rejected: "已驳回",
  needs_changes: "退回补充",
};

const SUBMISSION_STATUS_TONES: Record<
  string,
  "neutral" | "blue" | "green" | "red" | "amber"
> = {
  submitted: "blue",
  under_review: "amber",
  approved: "green",
  rejected: "red",
  needs_changes: "amber",
};

export function CollaborationsPanel({
  collaborations,
  canManage,
}: {
  collaborations: CollaborationView[];
  canManage: boolean;
}) {
  const [mine, setMine] = useState(collaborations);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">MCN 协作</h1>
        <p className="text-sm text-[var(--ink-300)]">
          甲方开放协作生成协作码；乙方凭码加入后在协同面板上传主播、账号与录屏。
        </p>
      </div>

      {canManage ? <OpenCollaborationCard /> : null}

      <AcceptCollaborationCard
        onAccepted={(collaboration) =>
          setMine((prev) =>
            prev.some((item) => item.id === collaboration.id)
              ? prev
              : [collaboration, ...prev],
          )
        }
      />

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">我加入的协作项目</h2>
        {mine.length === 0 ? (
          <div className="rounded-lg border border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--ink-300)]">
            暂无已加入的协作项目
          </div>
        ) : (
          mine.map((collaboration) => (
            <CollaborationCard
              key={collaboration.id}
              collaboration={collaboration}
            />
          ))
        )}
      </div>
    </div>
  );
}

function OpenCollaborationCard() {
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<"percentage" | "hourly_fixed">("percentage");
  const [value, setValue] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleOpen() {
    setBusy(true);
    setError(null);
    setInviteCode(null);
    try {
      const numeric = Number(value);
      const response = await fetch(
        `/api/projects/${projectId}/collaborations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            settlementMode: mode,
            sharePercentage: mode === "percentage" ? numeric : undefined,
            hourlyFixedAmount: mode === "hourly_fixed" ? numeric : undefined,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "开启协作失败");
      }
      setInviteCode(payload.collaboration.inviteCode ?? "(已生成)");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "开启协作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--line)] bg-white p-4">
      <h2 className="text-sm font-semibold">开启协作（甲方）</h2>
      <p className="mb-3 text-xs text-[var(--ink-300)]">
        为项目生成协作码，发给合作方加入。分成模式：百分比按项目毛利，固定按结算时长。
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <input
          className={inputClass}
          placeholder="项目 ID"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        />
        <select
          className={inputClass}
          value={mode}
          onChange={(event) =>
            setMode(event.target.value as "percentage" | "hourly_fixed")
          }
        >
          <option value="percentage">百分比分成</option>
          <option value="hourly_fixed">每小时固定</option>
        </select>
        <input
          className={inputClass}
          placeholder={mode === "percentage" ? "0-1 之间，如 0.2" : "每小时金额"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger-600)]">{error}</p>
      ) : null}
      {inviteCode ? (
        <p className="mt-3 text-sm">
          协作码：
          <span className="ml-1 font-mono font-semibold text-[var(--blue-700)]">
            {inviteCode}
          </span>
        </p>
      ) : null}
      <div className="mt-4 flex justify-end">
        <Button onClick={handleOpen} disabled={busy || !projectId || !value}>
          {busy ? "生成中…" : "生成协作码"}
        </Button>
      </div>
    </div>
  );
}

function AcceptCollaborationCard({
  onAccepted,
}: {
  onAccepted: (collaboration: CollaborationView) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleAccept() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/collaborations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: code }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "加入失败");
      }
      onAccepted(payload.collaboration as CollaborationView);
      setCode("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加入失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--line)] bg-white p-4">
      <h2 className="text-sm font-semibold">加入协作（乙方）</h2>
      <div className="mt-3 flex flex-wrap gap-3">
        <input
          className={`${inputClass} max-w-xs`}
          placeholder="输入协作码"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button onClick={handleAccept} disabled={busy || !code}>
          {busy ? "加入中…" : "加入项目"}
        </Button>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger-600)]">{error}</p>
      ) : null}
    </div>
  );
}

function CollaborationCard({
  collaboration,
}: {
  collaboration: CollaborationView;
}) {
  const [open, setOpen] = useState(false);
  const [submissions, setSubmissions] = useState<SubmissionView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({
    streamerName: "",
    liveAccount: "",
    recordingUrl: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSubmissions() {
    const response = await fetch(
      `/api/collaborations/${collaboration.id}/submissions`,
    );
    const payload = await response.json();
    if (response.ok) {
      setSubmissions(payload.submissions ?? []);
    }
    setLoaded(true);
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      await loadSubmissions();
    }
  }

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/collaborations/${collaboration.id}/submissions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "提交失败");
      }
      setForm({ streamerName: "", liveAccount: "", recordingUrl: "", note: "" });
      await loadSubmissions();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  const shareLabel =
    collaboration.settlementMode === "percentage"
      ? `毛利分成 ${formatPercent(collaboration.sharePercentage)}`
      : `每小时 ${collaboration.hourlyFixedAmount ?? 0}`;

  return (
    <div className="rounded-lg border border-[var(--line)] bg-white">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <div className="text-sm font-medium">项目 {collaboration.projectId}</div>
          <div className="text-xs text-[var(--ink-300)]">{shareLabel}</div>
        </div>
        <Badge tone={collaboration.status === "active" ? "green" : "neutral"}>
          {collaboration.status}
        </Badge>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-[var(--line)] px-4 py-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              className={inputClass}
              placeholder="主播名称 *"
              value={form.streamerName}
              onChange={(event) =>
                setForm({ ...form, streamerName: event.target.value })
              }
            />
            <input
              className={inputClass}
              placeholder="直播账号"
              value={form.liveAccount}
              onChange={(event) =>
                setForm({ ...form, liveAccount: event.target.value })
              }
            />
            <input
              className={inputClass}
              placeholder="录屏链接"
              value={form.recordingUrl}
              onChange={(event) =>
                setForm({ ...form, recordingUrl: event.target.value })
              }
            />
            <input
              className={inputClass}
              placeholder="备注"
              value={form.note}
              onChange={(event) =>
                setForm({ ...form, note: event.target.value })
              }
            />
          </div>
          {error ? (
            <p className="text-sm text-[var(--danger-600)]">{error}</p>
          ) : null}
          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={busy || !form.streamerName}
            >
              {busy ? "提交中…" : "上传提交"}
            </Button>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-[var(--ink-300)]">
              提交记录
            </div>
            {submissions.length === 0 ? (
              <div className="text-sm text-[var(--ink-300)]">暂无提交</div>
            ) : (
              submissions.map((submission) => (
                <div
                  key={submission.id}
                  className="flex items-center justify-between rounded-md border border-[var(--line)] px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium">
                      {submission.streamer_name}
                    </span>
                    {submission.review_note ? (
                      <span className="ml-2 text-xs text-[var(--ink-300)]">
                        {submission.review_note}
                      </span>
                    ) : null}
                  </div>
                  <Badge
                    tone={
                      SUBMISSION_STATUS_TONES[submission.status] ?? "neutral"
                    }
                  >
                    {SUBMISSION_STATUS_LABELS[submission.status] ??
                      submission.status}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const inputClass =
  "h-9 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--blue-400)]";

function formatPercent(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${Math.round(value * 1000) / 10}%`;
}
