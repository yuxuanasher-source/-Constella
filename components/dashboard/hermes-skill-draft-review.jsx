"use client";

import * as React from "react";
import { CheckCircle2, ChevronDown, ChevronRight, XCircle } from "lucide-react";

const C = {
  border: "#dfe6f2",
  soft: "#f7f9fd",
  ink: "#0b1733",
  ink2: "#1b2744",
  ink3: "#2d3a58",
  muted: "#7b879c",
  primary: "#3b6be6",
  primarySoft: "#eef3ff",
  ok: "#0e8a4d",
  okBg: "#e6f6ee",
  danger: "#b9323b",
  dangerBg: "#fdecec",
};

const INTERNAL_TEXT =
  /(Hermes(?:\s+Gateway)?|DeepSeek|OpenAI|provider|model|\/api\/|stack\s*trace|stack|trace|rawArguments|arguments|args|reasoning|chain-of-thought|toolName|gateway|sessionId|prompt|event:\s|data:\s|{\s*["'])/i;

function publicDraftText(value, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  if (INTERNAL_TEXT.test(text)) return fallback;
  return text.replace(/\s+/g, " ").slice(0, 240);
}

function publicDraftValue(value) {
  if (typeof value === "string") {
    return publicDraftText(value, "已隐藏内部字段");
  }
  if (Array.isArray(value)) return value.map(publicDraftValue).slice(0, 20);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !INTERNAL_TEXT.test(key))
      .slice(0, 30)
      .map(([key, item]) => [key, publicDraftValue(item)]),
  );
}

export function HermesSkillDraftReview({ draft, currentUser }) {
  const [expanded, setExpanded] = React.useState(false);
  const [busyDecision, setBusyDecision] = React.useState("");
  const [reviewState, setReviewState] = React.useState("");
  const [error, setError] = React.useState("");
  if (!draft) return null;

  const owner = currentUser?.role === "owner";
  const reviewable = owner && draft.status === "pending_review" && !reviewState;
  const safeSkillId = publicDraftText(draft.skillId, "已隐藏内部字段");
  const safeStatus = publicDraftText(draft.status, "已隐藏内部字段");
  const safeBundleSha256 = publicDraftText(draft.bundleSha256, "已隐藏内部字段");
  const manifestLines = JSON.stringify(publicDraftValue(draft.manifest || {}), null, 2)
    .split("\n")
    .map((line) => line.replace(/,$/, ""));

  const review = async (decision) => {
    if (!reviewable || busyDecision) return;
    setBusyDecision(decision);
    setError("");
    try {
      const response = await fetch(
        `/api/ai/hermes/skill-drafts/${encodeURIComponent(draft.id)}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, humanAction: true }),
        },
      );
      if (!response.ok) throw new Error("review failed");
      setReviewState(decision);
    } catch {
      setError("审核提交失败");
    } finally {
      setBusyDecision("");
    }
  };

  return (
    <section
      aria-label="Skill 草稿审核"
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        background: "#fff",
        padding: 12,
        display: "grid",
        gap: 10,
        color: C.ink,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 760 }}>Skill 草稿审核</div>
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              color: C.ink3,
              overflowWrap: "anywhere",
            }}
          >
            {safeSkillId}
          </div>
        </div>
        <span
          style={{
            color: C.muted,
            background: C.soft,
            borderRadius: 999,
            padding: "2px 7px",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {safeStatus}
        </span>
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: C.muted }}>Bundle SHA-256</span>
        <code
          style={{
            fontSize: 11.5,
            color: C.ink2,
            background: C.soft,
            border: `1px solid ${C.border}`,
            borderRadius: 7,
            padding: "6px 7px",
            overflowWrap: "anywhere",
          }}
        >
          {safeBundleSha256}
        </code>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        style={{
          justifySelf: "start",
          height: 28,
          border: `1px solid ${C.border}`,
          borderRadius: 7,
          background: C.soft,
          color: C.ink3,
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "0 9px",
          fontSize: 11.5,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {expanded ? (
          <ChevronDown size={13} aria-hidden="true" />
        ) : (
          <ChevronRight size={13} aria-hidden="true" />
        )}
        查看 manifest
      </button>

      {expanded ? (
        <pre
          style={{
            margin: 0,
            maxHeight: 220,
            overflow: "auto",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            background: C.soft,
            padding: 9,
            fontSize: 11.5,
            lineHeight: 1.45,
            color: C.ink2,
            whiteSpace: "pre-wrap",
          }}
        >
          {manifestLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </pre>
      ) : null}

      {owner ? (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            data-testid="skill-draft-reject"
            onClick={() => review("reject")}
            disabled={!reviewable || Boolean(busyDecision)}
            style={{
              height: 30,
              border: `1px solid ${C.danger}`,
              borderRadius: 8,
              background: C.dangerBg,
              color: C.danger,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "0 10px",
              fontSize: 12,
              fontWeight: 740,
              cursor: !reviewable || busyDecision ? "default" : "pointer",
            }}
          >
            <XCircle size={13} aria-hidden="true" />
            拒绝
          </button>
          <button
            type="button"
            data-testid="skill-draft-approve"
            onClick={() => review("approve")}
            disabled={!reviewable || Boolean(busyDecision)}
            style={{
              height: 30,
              border: `1px solid ${C.ok}`,
              borderRadius: 8,
              background: C.okBg,
              color: C.ok,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "0 10px",
              fontSize: 12,
              fontWeight: 740,
              cursor: !reviewable || busyDecision ? "default" : "pointer",
            }}
          >
            <CheckCircle2 size={13} aria-hidden="true" />
            批准
          </button>
        </div>
      ) : null}
      {error ? (
        <span
          data-testid="skill-draft-review-error"
          style={{ justifySelf: "end", fontSize: 11.5, color: C.danger }}
        >
          {error}
        </span>
      ) : null}
      {reviewState ? (
        <span style={{ justifySelf: "end", fontSize: 11.5, color: C.muted }}>
          已记录人工{reviewState === "approve" ? "批准" : "拒绝"}
        </span>
      ) : null}
    </section>
  );
}
