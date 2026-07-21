"use client";

import React from "react";

const STATUS_LABELS = {
  granted: "已启用",
  role_not_allowed: "角色未授权",
  missing_read_scope: "缺少数据权限",
};

export default function HermesSkillCenter({ fetcher = globalThis.fetch }) {
  const [state, setState] = React.useState({
    loading: true,
    error: "",
    catalog: null,
  });

  React.useEffect(() => {
    let cancelled = false;
    fetcher("/api/ai/hermes/skills")
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Hermes Skill catalog unavailable");
        }
        if (!cancelled) {
          setState({ loading: false, error: "", catalog: payload });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Hermes Skill catalog unavailable",
            catalog: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher]);

  const skills = Array.isArray(state.catalog?.skills)
    ? state.catalog.skills
    : [];
  const enabledCount = Array.isArray(state.catalog?.enabledSkillIds)
    ? state.catalog.enabledSkillIds.length
    : skills.filter((skill) => skill?.enabled).length;

  return (
    <section
      aria-label="Hermes Skills"
      style={{
        marginTop: 16,
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 10,
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 16px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-900)" }}>
            Hermes Skills
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-500)" }}>
            星耀 AI 内核能力按组织角色与只读数据权限自动裁剪
          </div>
        </div>
        <div
          style={{
            alignSelf: "flex-start",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "5px 8px",
            fontSize: 12,
            color: "var(--ink-600)",
            background: "var(--ink-50)",
            whiteSpace: "nowrap",
          }}
        >
          {state.catalog?.role ?? "读取中"} · {enabledCount} enabled
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {state.loading ? (
          <div role="status" style={{ fontSize: 13, color: "var(--ink-500)" }}>
            正在读取 Hermes Skill 授权状态
          </div>
        ) : state.error ? (
          <div
            role="alert"
            style={{
              border: "1px solid var(--danger-200)",
              borderRadius: 8,
              background: "var(--danger-50)",
              color: "var(--danger-700)",
              fontSize: 13,
              padding: "10px 12px",
            }}
          >
            {state.error}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {skills.map((skill) => (
              <SkillRow key={skill.skillId} skill={skill} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SkillRow({ skill }) {
  const enabled = Boolean(skill?.enabled);
  const reason = enabled ? "granted" : skill?.reason;
  const label = STATUS_LABELS[reason] || "未授权";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 12,
        alignItems: "center",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: "10px 12px",
        background: enabled ? "var(--ok-50)" : "#fff",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-800)" }}>
          {skill.displayName || skill.skillId}
        </div>
        <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-500)" }}>
          {skill.skillId} · {skill.version}
        </div>
      </div>
      <span
        style={{
          borderRadius: 999,
          padding: "4px 8px",
          fontSize: 12,
          fontWeight: 700,
          color: enabled ? "var(--ok-700)" : "var(--ink-500)",
          background: enabled ? "#fff" : "var(--ink-50)",
          border: "1px solid var(--line)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
}
