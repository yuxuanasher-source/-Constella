"use client";

// 供需撮合论坛 / 派单市场 —— 论坛信息流形态(参考主流协同产品的社区/广场)。
// 消费 /api/marketplace/*：广场浏览/筛选、发布需求、我的发布、我的投递、收到的投递审核、
// 接单方确认达成。信息默认公开(联系方式不公开,撮合走平台闭环)。样式用全局 CSS 变量,
// 与现有 UI 一致;数据全为真实业务数据,无数据的区块给空态。

import * as React from "react";

const TABS = [
  { key: "square", label: "撮合广场" },
  { key: "mine", label: "我的发布" },
  { key: "applications", label: "我的投递" },
  { key: "publish", label: "发布需求" },
];

const POSTING_STATUS = {
  draft: { label: "草稿", tone: "neutral" },
  open: { label: "公开中", tone: "green" },
  matched: { label: "已撮合", tone: "blue" },
  closed: { label: "已关闭", tone: "neutral" },
  expired: { label: "已过期", tone: "neutral" },
};
const APP_STATUS = {
  draft: { label: "草稿", tone: "neutral" },
  submitted: { label: "已投递", tone: "blue" },
  under_review: { label: "审核中", tone: "amber" },
  need_more: { label: "待补充", tone: "amber" },
  approved: { label: "已通过", tone: "green" },
  rejected: { label: "已驳回", tone: "red" },
  withdrawn: { label: "已撤回", tone: "neutral" },
  deal_confirmed: { label: "已达成", tone: "green" },
};
const TONES = {
  neutral: { bg: "#f1f2f5", fg: "#6b7280", bd: "#e3e5ea" },
  blue: { bg: "#eef3ff", fg: "#1842a6", bd: "#d4e0fb" },
  green: { bg: "#e7f5ee", fg: "#0e8a4d", bd: "#bfe6cf" },
  amber: { bg: "#fef6e7", fg: "#a86a00", bd: "#f3e2bd" },
  red: { bg: "#fdecec", fg: "#c0303a", bd: "#f3c4c9" },
};

function Pill({ map, status }) {
  const m = map[status] || { label: status, tone: "neutral" };
  const t = TONES[m.tone];
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: t.bg, color: t.fg, border: `1px solid ${t.bd}` }}>
      {m.label}
    </span>
  );
}

function yuan(cents) {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `¥${(cents / 100).toLocaleString("zh-CN")}`;
}

async function api(url, opts) {
  const res = await fetch(url, { cache: "no-store", ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "请求失败");
  return json;
}

function Notice({ notice }) {
  if (!notice) return null;
  const ok = notice.kind === "ok";
  return (
    <div style={{ fontSize: 13, padding: "8px 12px", borderRadius: 8, background: ok ? "#e7f5ee" : "#fdecec", color: ok ? "#0e8a4d" : "#c0303a", border: `1px solid ${ok ? "#bfe6cf" : "#f3c4c9"}` }}>
      {notice.text}
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--ink-400)" }}>{text}</div>;
}

const cardStyle = { background: "#fff", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow-card)" };
const input = { height: 32, padding: "0 10px", fontSize: 13, borderRadius: 6, border: "1px solid var(--line-strong)", background: "#fff", color: "var(--ink-900)", width: "100%" };
function btn(kind, disabled) {
  const base = { height: 32, padding: "0 14px", fontSize: 13, fontWeight: 500, borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1 };
  if (kind === "primary") return { ...base, background: "var(--blue-600)", color: "#fff", border: "1px solid var(--blue-600)" };
  if (kind === "danger") return { ...base, background: "#fff", color: "#c0303a", border: "1px solid #f3c4c9" };
  return { ...base, background: "#fff", color: "var(--ink-700)", border: "1px solid var(--line-strong)" };
}

// ── 需求卡片 ──
function PostingCard({ posting, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(posting)} style={{ ...cardStyle, textAlign: "left", cursor: "pointer", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-900)" }}>{posting.title}</span>
        <Pill map={POSTING_STATUS} status={posting.status} />
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--ink-500)" }}>
        {posting.productName && <span>产品：{posting.productName}</span>}
        {posting.category && <span>品类：{posting.category}</span>}
        <span>预算：{yuan(posting.budgetCents)}</span>
        {posting.settlementMethod && <span>结算：{posting.settlementMethod}</span>}
        {posting.deadlineAt && <span>截止：{String(posting.deadlineAt).slice(0, 10)}</span>}
      </div>
      {posting.description && (
        <div style={{ fontSize: 13, color: "var(--ink-700)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{posting.description}</div>
      )}
    </button>
  );
}

// ── 需求详情抽屉：投递(接单方) / 审核(发单方) / 达成(接单方) ──
function PostingDetail({ posting, orgId, onClose, onChanged }) {
  const [applications, setApplications] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const [form, setForm] = React.useState({ quoteCents: "", streamerLineup: "", pastCases: "", resources: "", contact: "", message: "" });
  const isOwner = posting.organizationId === orgId;

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const json = await api(`/api/marketplace/postings/${posting.id}/applications`);
      setApplications(json.applications || []);
    } catch (e) {
      setNotice({ kind: "error", text: e.message });
    } finally {
      setLoading(false);
    }
  }, [posting.id]);

  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) load(); });
    return () => { cancelled = true; };
  }, [load]);

  const myApplication = applications.find((a) => a.applicantOrganizationId === orgId);

  async function submit() {
    setBusy(true); setNotice(null);
    try {
      await api(`/api/marketplace/postings/${posting.id}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteCents: form.quoteCents ? Math.round(Number(form.quoteCents) * 100) : null,
          streamerLineup: form.streamerLineup || null,
          pastCases: form.pastCases || null,
          resources: form.resources || null,
          contact: form.contact || null,
          message: form.message || null,
        }),
      });
      setNotice({ kind: "ok", text: "已投递接单资料,等待发单方审核" });
      await load();
    } catch (e) {
      setNotice({ kind: "error", text: e.message });
    } finally { setBusy(false); }
  }

  async function review(appId, action, note) {
    setBusy(true); setNotice(null);
    try {
      await api(`/api/marketplace/applications/${appId}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note || null }),
      });
      setNotice({ kind: "ok", text: "已更新审核状态" });
      await load(); onChanged?.();
    } catch (e) { setNotice({ kind: "error", text: e.message }); } finally { setBusy(false); }
  }

  async function confirmDeal(appId) {
    setBusy(true); setNotice(null);
    try {
      await api(`/api/marketplace/applications/${appId}/confirm`, { method: "POST" });
      setNotice({ kind: "ok", text: "已确认达成,撮合关系已记录,后续进入协作流程" });
      await load(); onChanged?.();
    } catch (e) { setNotice({ kind: "error", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div style={{ ...cardStyle, padding: 0, display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{posting.title}</span>
          <Pill map={POSTING_STATUS} status={posting.status} />
          {isOwner && <span style={{ fontSize: 12, color: "var(--ink-400)" }}>(我的发布)</span>}
        </div>
        <button type="button" onClick={onClose} style={btn("default")}>返回</button>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "var(--ink-700)" }}>
          {posting.productName && <span>产品：{posting.productName}</span>}
          {posting.category && <span>品类：{posting.category}</span>}
          <span>预算：{yuan(posting.budgetCents)}</span>
          {posting.settlementMethod && <span>结算：{posting.settlementMethod}</span>}
        </div>
        {posting.requirements && <div style={{ fontSize: 13 }}><b>要求：</b>{posting.requirements}</div>}
        {posting.description && <div style={{ fontSize: 13, color: "var(--ink-700)" }}>{posting.description}</div>}

        <Notice notice={notice} />

        {/* 接单方:未投递则展示投递表单;已投递展示状态;通过后可确认达成 */}
        {!isOwner && (
          myApplication ? (
            <div style={{ ...cardStyle, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>我的投递</span>
                <Pill map={APP_STATUS} status={myApplication.status} />
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-700)" }}>报价：{yuan(myApplication.quoteCents)}</div>
              {myApplication.reviewNote && <div style={{ fontSize: 12, color: "var(--ink-500)" }}>审核意见：{myApplication.reviewNote}</div>}
              {myApplication.status === "approved" && (
                <button type="button" disabled={busy} onClick={() => confirmDeal(myApplication.id)} style={btn("primary", busy)}>确认达成</button>
              )}
            </div>
          ) : posting.status === "open" ? (
            <div style={{ ...cardStyle, padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ gridColumn: "1 / -1", fontSize: 13, fontWeight: 600 }}>投递接单资料</div>
              <Field label="报价(元)"><input type="number" style={input} value={form.quoteCents} onChange={(e) => setForm({ ...form, quoteCents: e.target.value })} /></Field>
              <Field label="主播阵容"><input style={input} value={form.streamerLineup} onChange={(e) => setForm({ ...form, streamerLineup: e.target.value })} /></Field>
              <Field label="过往案例"><input style={input} value={form.pastCases} onChange={(e) => setForm({ ...form, pastCases: e.target.value })} /></Field>
              <Field label="可投入资源"><input style={input} value={form.resources} onChange={(e) => setForm({ ...form, resources: e.target.value })} /></Field>
              <Field label="联系方式(不公开,达成后披露)"><input style={input} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
              <Field label="留言"><input style={input} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
              <div style={{ gridColumn: "1 / -1" }}>
                <button type="button" disabled={busy} onClick={submit} style={btn("primary", busy)}>{busy ? "提交中…" : "投递"}</button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--ink-400)" }}>该需求当前不接受投递。</div>
          )
        )}

        {/* 收到的投递(发单方审核 / 全员可见公开投递) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{isOwner ? "收到的投递" : "公开投递"}（{applications.length}）</div>
          {loading ? <Empty text="加载中…" /> : applications.length === 0 ? <Empty text="暂无投递" /> : (
            applications.map((a) => (
              <div key={a.id} style={{ ...cardStyle, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <Pill map={APP_STATUS} status={a.status} />
                    <span>报价 {yuan(a.quoteCents)}</span>
                    {a.streamerLineup && <span style={{ color: "var(--ink-500)" }}>· {a.streamerLineup}</span>}
                  </div>
                  {isOwner && ["submitted", "under_review", "need_more"].includes(a.status) && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" disabled={busy} onClick={() => review(a.id, "request_more", "请补充资料")} style={btn("default", busy)}>要求补充</button>
                      <button type="button" disabled={busy} onClick={() => review(a.id, "reject", "暂不合适")} style={btn("danger", busy)}>驳回</button>
                      <button type="button" disabled={busy} onClick={() => review(a.id, "approve", null)} style={btn("primary", busy)}>通过</button>
                    </div>
                  )}
                </div>
                {a.pastCases && <div style={{ fontSize: 12, color: "var(--ink-500)" }}>案例：{a.pastCases}</div>}
                {a.message && <div style={{ fontSize: 12, color: "var(--ink-500)" }}>留言：{a.message}</div>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "var(--ink-400)" }}>{label}</span>
      {children}
    </label>
  );
}

// ── 发布需求表单 ──
function PublishForm({ onPublished }) {
  const [form, setForm] = React.useState({ title: "", productName: "", category: "", budget: "", settlementMethod: "", requirements: "", description: "", deadlineAt: "", contact: "" });
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function publish(asDraft) {
    if (!form.title.trim()) { setNotice({ kind: "error", text: "请填写标题" }); return; }
    setBusy(true); setNotice(null);
    try {
      await api("/api/marketplace/postings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title, productName: form.productName || null, category: form.category || null,
          budgetCents: form.budget ? Math.round(Number(form.budget) * 100) : null,
          settlementMethod: form.settlementMethod || null, requirements: form.requirements || null,
          description: form.description || null, deadlineAt: form.deadlineAt || null,
          contact: form.contact || null, publish: !asDraft,
        }),
      });
      setNotice({ kind: "ok", text: asDraft ? "已存草稿" : "已发布,需求已公开到撮合广场" });
      setForm({ title: "", productName: "", category: "", budget: "", settlementMethod: "", requirements: "", description: "", deadlineAt: "", contact: "" });
      onPublished?.();
    } catch (e) { setNotice({ kind: "error", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div style={{ ...cardStyle, padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 760 }}>
      <div style={{ gridColumn: "1 / -1", fontSize: 14, fontWeight: 600 }}>发布分包需求(二手单)</div>
      <Field label="标题 *"><input style={input} value={form.title} onChange={set("title")} /></Field>
      <Field label="产品名"><input style={input} value={form.productName} onChange={set("productName")} /></Field>
      <Field label="品类"><input style={input} value={form.category} onChange={set("category")} /></Field>
      <Field label="预算/报价(元)"><input type="number" style={input} value={form.budget} onChange={set("budget")} /></Field>
      <Field label="结算方式"><input style={input} value={form.settlementMethod} onChange={set("settlementMethod")} placeholder="如 CPT / CPS / 一口价" /></Field>
      <Field label="截止时间"><input type="date" style={input} value={form.deadlineAt} onChange={set("deadlineAt")} /></Field>
      <div style={{ gridColumn: "1 / -1" }}><Field label="对主播/MCN 的要求"><input style={input} value={form.requirements} onChange={set("requirements")} /></Field></div>
      <div style={{ gridColumn: "1 / -1" }}><Field label="需求描述"><input style={input} value={form.description} onChange={set("description")} /></Field></div>
      <div style={{ gridColumn: "1 / -1" }}><Field label="联系方式(不公开,仅达成后对家可见)"><input style={input} value={form.contact} onChange={set("contact")} /></Field></div>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" disabled={busy} onClick={() => publish(false)} style={btn("primary", busy)}>{busy ? "处理中…" : "发布到广场"}</button>
        <button type="button" disabled={busy} onClick={() => publish(true)} style={btn("default", busy)}>存草稿</button>
        <Notice notice={notice} />
      </div>
    </div>
  );
}

// ── 论坛首页信息流：AI 撮合情报(市场动态 / 供给热度 / 智能推荐) ──
// 数字均来自 /api/marketplace/intel 的确定性聚合(带 sourceRef),不编造。
function IntelStrip({ onOpenPosting }) {
  const [intel, setIntel] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const json = await api("/api/marketplace/intel");
        if (!cancelled) setIntel(json);
      } catch {
        if (!cancelled) setIntel(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div style={{ ...cardStyle, padding: 14, fontSize: 13, color: "var(--ink-400)" }}>撮合情报加载中…</div>;
  if (!intel) return null;
  const { marketDynamics: md, supplyHeat: sh, matches } = intel;
  const recs = (matches?.recommendations || []).slice(0, 4);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr", gap: 12 }}>
      <div style={{ ...cardStyle, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>市场动态 · 近{md.windowDays}天</span>
        <span style={{ fontSize: 22, fontWeight: 700, color: "var(--blue-600)" }}>{md.newPostings}<span style={{ fontSize: 12, fontWeight: 400, color: "var(--ink-400)", marginLeft: 4 }}>条新需求</span></span>
        <div style={{ fontSize: 12, color: "var(--ink-500)", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {md.newProducts.slice(0, 6).map((p) => (
            <span key={p} style={{ padding: "1px 8px", borderRadius: 999, background: "#eef3ff", color: "#1842a6" }}>{p}</span>
          ))}
          {md.newProducts.length === 0 && <span style={{ color: "var(--ink-400)" }}>暂无新产品</span>}
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>供给热度</span>
        <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
          <span><b style={{ fontSize: 18 }}>{sh.totalOpen}</b> 公开需求</span>
          <span><b style={{ fontSize: 18 }}>{sh.publishers}</b> 发布方</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-500)", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {sh.byCategory.slice(0, 4).map((c) => (
            <span key={c.category} style={{ padding: "1px 8px", borderRadius: 999, background: "#f1f2f5" }}>{c.category}·{c.count}</span>
          ))}
          {sh.byCategory.length === 0 && <span style={{ color: "var(--ink-400)" }}>暂无公开需求</span>}
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>为你智能匹配</span>
        {recs.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--ink-400)" }}>暂无匹配推荐</span>
        ) : (
          recs.map((r) => (
            <button key={r.kind + r.refId} type="button"
              onClick={() => r.kind === "posting" && onOpenPosting?.(r.refId)}
              style={{ textAlign: "left", border: "none", background: "transparent", cursor: r.kind === "posting" ? "pointer" : "default", padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, color: "var(--ink-900)", fontWeight: 500 }}>
                {r.kind === "posting" ? "需求：" : "接单方："}{r.title}
              </span>
              <span style={{ fontSize: 11, color: "var(--ink-400)" }}>{r.reasons.join(" · ")}</span>
            </button>
          ))
        )}
        <span style={{ fontSize: 10, color: "var(--ink-400)", marginTop: 2 }}>情报来自公开撮合数据的确定性聚合，数字以平台结构化数据为准。</span>
      </div>
    </div>
  );
}

export function MarketplaceBoard({ organizationId }) {
  const [tab, setTab] = React.useState("square");
  const [postings, setPostings] = React.useState([]);
  const [myApps, setMyApps] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [active, setActive] = React.useState(null);
  const [filters, setFilters] = React.useState({ category: "", search: "" });

  const load = React.useCallback(async (which) => {
    setLoading(true); setError(null);
    try {
      if (which === "applications") {
        const json = await api("/api/marketplace/applications");
        setMyApps(json.applications || []);
      } else {
        const params = new URLSearchParams();
        if (which === "mine") params.set("mine", "1");
        if (filters.category) params.set("category", filters.category);
        if (filters.search) params.set("search", filters.search);
        const json = await api(`/api/marketplace/postings?${params.toString()}`);
        setPostings(json.postings || []);
      }
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  }, [filters.category, filters.search]);

  React.useEffect(() => {
    if (active) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) load(tab); });
    return () => { cancelled = true; };
  }, [tab, active, load]);

  if (active) {
    return (
      <div style={{ padding: 20 }}>
        <PostingDetail posting={active} orgId={organizationId} onClose={() => { setActive(null); }} onChanged={() => load(tab)} />
      </div>
    );
  }

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ height: 32, padding: "0 14px", fontSize: 13, fontWeight: 500, borderRadius: 6, cursor: "pointer", border: "1px solid var(--line-strong)", background: tab === t.key ? "var(--blue-600)" : "#fff", color: tab === t.key ? "#fff" : "var(--ink-700)" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "publish" ? (
        <PublishForm onPublished={() => setTab("mine")} />
      ) : tab === "applications" ? (
        loading ? <Empty text="加载中…" /> : error ? <Empty text={error} /> : myApps.length === 0 ? <Empty text="暂无投递" /> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {myApps.map((a) => (
              <button key={a.id} type="button" onClick={() => setActive({ id: a.postingId, organizationId: "", title: "查看需求", status: "open", budgetCents: null })}
                style={{ ...cardStyle, textAlign: "left", cursor: "pointer", padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <Pill map={APP_STATUS} status={a.status} />
                  <span>报价 {yuan(a.quoteCents)}</span>
                </div>
                <span style={{ fontSize: 12, color: "var(--ink-400)" }}>{String(a.submittedAt || a.createdAt || "").slice(0, 10)}</span>
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          {tab === "square" && (
            <IntelStrip onOpenPosting={(id) => setActive({ id, organizationId: "", title: "查看需求", status: "open", budgetCents: null })} />
          )}
          {tab === "square" && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <Field label="品类"><input style={{ ...input, width: 160 }} value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} /></Field>
              <Field label="搜索"><input style={{ ...input, width: 220 }} value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="标题/产品/描述" /></Field>
              <button type="button" onClick={() => load("square")} style={btn("default")}>筛选</button>
            </div>
          )}
          {loading ? <Empty text="加载中…" /> : error ? <Empty text={error} /> : postings.length === 0 ? (
            <Empty text={tab === "mine" ? "你还没有发布需求" : "撮合广场暂无公开需求"} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
              {postings.map((p) => <PostingCard key={p.id} posting={p} onOpen={setActive} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
