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

export function HermesSkillDraftReview({ draft, currentUser }) {
  const [expanded, setExpanded] = React.useState(false);
  const [busyDecision, setBusyDecision] = React.useState("");
  const [reviewState, setReviewState] = React.useState("");
  if (!draft) return null;

  const owner = currentUser?.role === "owner";
  const manifestLines = JSON.stringify(draft.manifest || {}, null, 2)
    .split("\n")
    .map((line) => line.replace(/,$/, ""));

  const review = async (decision) => {
    setBusyDecision(decision);
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
            {draft.skillId}
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
          {draft.status}
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
          {draft.bundleSha256}
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
            onClick={() => review("reject")}
            disabled={Boolean(busyDecision)}
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
              cursor: busyDecision ? "default" : "pointer",
            }}
          >
            <XCircle size={13} aria-hidden="true" />
            拒绝
          </button>
          <button
            type="button"
            onClick={() => review("approve")}
            disabled={Boolean(busyDecision)}
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
              cursor: busyDecision ? "default" : "pointer",
            }}
          >
            <CheckCircle2 size={13} aria-hidden="true" />
            批准
          </button>
        </div>
      ) : null}
      {reviewState ? (
        <span style={{ justifySelf: "end", fontSize: 11.5, color: C.muted }}>
          已记录人工{reviewState === "approve" ? "批准" : "拒绝"}
        </span>
      ) : null}
    </section>
  );
}
