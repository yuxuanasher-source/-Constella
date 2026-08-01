"use client";

import React from "react";

function KnowledgeDocEditor({
  BlockEditor,
  doc,
  onChange,
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
}) {
  const [blocks, setBlocks] = React.useState(() => {
    const parsed = parseMarkdownToBlocks(doc.contentMd || "");
    return parsed.length ? parsed : [{ type: "paragraph", text: "" }];
  });
  const handle = (next) => {
    setBlocks(next);
    onChange(serializeBlocksToMarkdown(next));
  };
  return <BlockEditor blocks={blocks} onChange={handle} />;
}

export default function ScreenKnowledge({ dependencies }) {
  const {
    BlockEditor,
    Button,
    EmptyHint,
    Icon,
    KB_REVIEW_FOLDER_ID,
    KB_ROOT_ID,
    PageHeader,
    kbAddNode,
    kbChildren,
    kbDeleteNode,
    kbDescendants,
    kbEnsureSystemNodes,
    kbExportMarkdown,
    kbExportPdf,
    kbExportWord,
    kbFormatShareExpiry,
    kbListActiveShares,
    kbMoveNode,
    kbPath,
    kbRenameNode,
    kbRevokeShare,
    kbSetContent,
    kbShareAttemptMatches,
    kbShareDoc,
    kbShareRequestKey,
    loadKnowledgeStore,
    loadKnowledgeStoreRemote,
    parseMarkdownToBlocks,
    saveKnowledgeStore,
    saveKnowledgeStoreRemote,
    serializeBlocksToMarkdown,
  } = dependencies;
  const [store, setStore] = React.useState(loadKnowledgeStore);
  const [selectedId, setSelectedId] = React.useState(KB_REVIEW_FOLDER_ID);
  const [expanded, setExpanded] = React.useState(
    () => new Set([KB_ROOT_ID, KB_REVIEW_FOLDER_ID]),
  );
  const [renamingId, setRenamingId] = React.useState(null);
  const [menu, setMenu] = React.useState(null);
  const [moveId, setMoveId] = React.useState(null);
  const [shareUrl, setShareUrl] = React.useState("");
  const [shareUrlShareId, setShareUrlShareId] = React.useState(null);
  const [shareExpiresAt, setShareExpiresAt] = React.useState("");
  const [shareExpiryDays, setShareExpiryDays] = React.useState(7);
  const [activeShares, setActiveShares] = React.useState([]);
  const [activeSharesLoading, setActiveSharesLoading] = React.useState(false);
  const [revokingShareId, setRevokingShareId] = React.useState(null);
  const [focusedShareId, setFocusedShareId] = React.useState(null);
  const [docMsg, setDocMsg] = React.useState("");
  const [shareBusy, setShareBusy] = React.useState(false);
  const [syncState, setSyncState] = React.useState("loading"); // loading|synced|local
  const shareUrlShareIdRef = React.useRef(shareUrlShareId);
  const hydratedRef = React.useRef(false);
  const remoteTimerRef = React.useRef(null);
  const pendingShareAttemptRef = React.useRef(null);
  const shareAttemptEpochRef = React.useRef(0);
  const currentShareInputRef = React.useRef(null);
  const activeShareRowRefs = React.useRef(new Map());
  const revokeOperationEpochRef = React.useRef(0);
  const activeRevokeOperationRef = React.useRef(null);
  const shareDisplayEpochRef = React.useRef(0);

  // 加载：优先腾讯云 COS 真源，拿不到则用本地缓存。
  React.useEffect(() => {
    let alive = true;
    (async () => {
      const remote = await loadKnowledgeStoreRemote();
      if (!alive) return;
      if (remote && remote.nodes && remote.nodes[KB_ROOT_ID]) {
        setStore(kbEnsureSystemNodes(remote));
        setSyncState("synced");
      } else {
        setSyncState(remote === null ? "local" : "synced");
      }
      hydratedRef.current = true;
    })();
    return () => {
      alive = false;
    };
  }, [KB_ROOT_ID, kbEnsureSystemNodes, loadKnowledgeStoreRemote]);

  // 保存：本地缓存即时写，COS 防抖写（仅在完成首次加载后）。
  React.useEffect(() => {
    saveKnowledgeStore(store);
    if (!hydratedRef.current) return;
    if (remoteTimerRef.current) clearTimeout(remoteTimerRef.current);
    remoteTimerRef.current = setTimeout(() => {
      saveKnowledgeStoreRemote(store).then((ok) =>
        setSyncState(ok ? "synced" : "local"),
      );
    }, 600);
  }, [saveKnowledgeStore, saveKnowledgeStoreRemote, store]);

  const selected = store.nodes[selectedId] || store.nodes[KB_ROOT_ID];

  React.useEffect(() => {
    currentShareInputRef.current = {
      doc: selected?.type === "doc" ? selected : null,
      expiresInDays: shareExpiryDays,
    };
  }, [selected, shareExpiryDays]);

  const isCurrentShareAttempt = React.useCallback(
    (attempt) =>
      Boolean(
        attempt &&
        attempt.epoch === shareAttemptEpochRef.current &&
        kbShareAttemptMatches(
          attempt,
          currentShareInputRef.current?.doc,
          currentShareInputRef.current?.expiresInDays,
        ),
      ),
    [kbShareAttemptMatches],
  );
  const isCurrentRevokeOperation = React.useCallback(
    (operation) =>
      Boolean(
        operation &&
        activeRevokeOperationRef.current === operation &&
        operation.epoch === revokeOperationEpochRef.current &&
        operation.documentId === currentShareInputRef.current?.doc?.id,
      ),
    [],
  );

  React.useEffect(() => {
    shareUrlShareIdRef.current = shareUrlShareId;
  }, [shareUrlShareId]);

  React.useEffect(() => {
    if (
      pendingShareAttemptRef.current &&
      !isCurrentShareAttempt(pendingShareAttemptRef.current)
    ) {
      shareAttemptEpochRef.current += 1;
      pendingShareAttemptRef.current = null;
      setShareBusy(false);
    }
  }, [
    selected?.id,
    selected?.name,
    selected?.contentMd,
    selected?.type,
    shareExpiryDays,
    isCurrentShareAttempt,
  ]);

  React.useEffect(() => {
    if (!focusedShareId) return;
    activeShareRowRefs.current.get(focusedShareId)?.focus();
  }, [activeShares, focusedShareId]);

  React.useEffect(() => {
    let alive = true;
    if (selected?.type !== "doc") {
      return () => {
        alive = false;
      };
    }
    kbListActiveShares(selected.id)
      .then((shares) => {
        if (alive) setActiveShares(shares);
      })
      .catch(() => {
        if (alive) setActiveShares([]);
      })
      .finally(() => {
        if (alive) setActiveSharesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [kbListActiveShares, selected?.id, selected?.type]);

  const selectId = (id, type = store.nodes[id]?.type) => {
    shareAttemptEpochRef.current += 1;
    pendingShareAttemptRef.current = null;
    revokeOperationEpochRef.current += 1;
    shareDisplayEpochRef.current += 1;
    activeRevokeOperationRef.current = null;
    currentShareInputRef.current = { doc: null, expiresInDays: 7 };
    setShareBusy(false);
    setRevokingShareId(null);
    setActiveShares([]);
    setActiveSharesLoading(type === "doc");
    setSelectedId(id);
    setShareUrl("");
    shareUrlShareIdRef.current = null;
    setShareUrlShareId(null);
    setShareExpiresAt("");
    setShareExpiryDays(7);
    setFocusedShareId(null);
    setDocMsg("");
  };

  const toggle = (id) =>
    setExpanded((e) => {
      const n = new Set(e);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const addChild = (parentId, type) => {
    const name = type === "folder" ? "新建文件夹" : "新建页面";
    let newId = null;
    setStore((s) => {
      const r = kbAddNode(s, { type, name, parentId });
      newId = r.id;
      return r.store;
    });
    setExpanded((e) => new Set(e).add(parentId));
    setTimeout(() => {
      if (newId) {
        selectId(newId, type);
        setRenamingId(newId);
      }
    }, 0);
  };

  const selectNode = (node) => {
    selectId(node.id, node.type);
    if (node.type === "folder") setExpanded((e) => new Set(e).add(node.id));
  };

  const folderOptions = Object.values(store.nodes).filter(
    (n) => n.type === "folder",
  );

  const renderRow = (node, depth) => {
    const isFolder = node.type === "folder";
    const open = expanded.has(node.id);
    const kids = isFolder ? kbChildren(store, node.id) : [];
    return (
      <div key={node.id}>
        <div
          className="kb-row"
          onClick={() => selectNode(node)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ id: node.id, x: e.clientX, y: e.clientY });
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 6px",
            paddingLeft: 6 + depth * 14,
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            color: "var(--ink-800, #1f2733)",
            background:
              selectedId === node.id ? "var(--blue-50)" : "transparent",
          }}
        >
          <span
            onClick={(e) => {
              e.stopPropagation();
              if (isFolder) toggle(node.id);
            }}
            style={{
              width: 14,
              flexShrink: 0,
              color: "var(--ink-400)",
              fontSize: 10,
              textAlign: "center",
              visibility: isFolder && kids.length ? "visible" : "hidden",
            }}
          >
            {open ? "▾" : "▸"}
          </span>
          <span style={{ flexShrink: 0 }}>{isFolder ? "📁" : "📄"}</span>
          {renamingId === node.id ? (
            <input
              autoFocus
              defaultValue={node.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                setStore((s) =>
                  kbRenameNode(s, node.id, e.target.value.trim() || node.name),
                );
                setRenamingId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenamingId(null);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                border: "1px solid var(--blue-600)",
                borderRadius: 4,
                padding: "1px 4px",
                fontSize: 13,
                outline: "none",
              }}
            />
          ) : (
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {node.name}
            </span>
          )}
          <span
            className="kb-actions"
            style={{ display: "flex", gap: 2, flexShrink: 0 }}
          >
            {isFolder && (
              <button
                type="button"
                title="新建页面"
                onClick={(e) => {
                  e.stopPropagation();
                  addChild(node.id, "doc");
                }}
                style={kbIconBtn}
              >
                +
              </button>
            )}
            <button
              type="button"
              title="更多"
              onClick={(e) => {
                e.stopPropagation();
                setMenu({ id: node.id, x: e.clientX, y: e.clientY });
              }}
              style={kbIconBtn}
            >
              ⋯
            </button>
          </span>
        </div>
        {isFolder && open && kids.map((k) => renderRow(k, depth + 1))}
      </div>
    );
  };

  const menuNode = menu ? store.nodes[menu.id] : null;

  return (
    <>
      <PageHeader
        title="知识库"
        subtitle="任务复盘自动归档（直属库 / 复盘 / 项目 / 主播），支持自定义层级，像 Notion 一样组织文档"
      />
      <style>{`
        .kb-row .kb-actions { opacity: 0; transition: opacity .12s ease; }
        .kb-row:hover .kb-actions { opacity: 1; }
        .kb-row:hover { background: var(--bg-soft); }
      `}</style>
      <div
        style={{
          display: "flex",
          height: "calc(100vh - 168px)",
          background: "#fff",
        }}
      >
        {/* Tree */}
        <div
          style={{
            width: 290,
            flexShrink: 0,
            borderRight: "1px solid var(--line)",
            overflowY: "auto",
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <Button
              size="sm"
              kind="default"
              onClick={() => addChild(KB_ROOT_ID, "doc")}
            >
              + 页面
            </Button>
            <Button
              size="sm"
              kind="default"
              onClick={() => addChild(KB_ROOT_ID, "folder")}
            >
              + 文件夹
            </Button>
          </div>
          <div
            style={{
              fontSize: 11,
              color:
                syncState === "synced" ? "var(--ok-600)" : "var(--ink-400)",
              marginBottom: 6,
              paddingLeft: 2,
            }}
          >
            {syncState === "loading"
              ? "正在从腾讯云读取…"
              : syncState === "synced"
                ? "● 已同步至腾讯云存储桶"
                : "○ 本地缓存（未连接云端存储）"}
          </div>
          {renderRow(store.nodes[KB_ROOT_ID], 0)}
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: "auto",
            padding: "18px 24px",
          }}
        >
          {selected ? (
            <>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-400)",
                  marginBottom: 8,
                  display: "flex",
                  gap: 4,
                  flexWrap: "wrap",
                }}
              >
                {kbPath(store, selected.id).map((p, i, arr) => (
                  <span key={p.id}>
                    {p.name}
                    {i < arr.length - 1 ? " / " : ""}
                  </span>
                ))}
              </div>
              {selected.type === "doc" && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginBottom: 12,
                    alignItems: "center",
                  }}
                >
                  <Button
                    size="sm"
                    kind="default"
                    icon={<Icon.Upload size={13} />}
                    disabled={shareBusy}
                    onClick={async () => {
                      shareDisplayEpochRef.current += 1;
                      setDocMsg("");
                      setShareBusy(true);
                      const pendingAttempt = pendingShareAttemptRef.current;
                      const attempt = kbShareAttemptMatches(
                        pendingAttempt,
                        selected,
                        shareExpiryDays,
                      )
                        ? pendingAttempt
                        : {
                            documentId: selected.id,
                            documentName: selected.name,
                            contentMd: selected.contentMd || "",
                            expiresInDays: shareExpiryDays,
                            requestKey: kbShareRequestKey(),
                            epoch: ++shareAttemptEpochRef.current,
                          };
                      pendingShareAttemptRef.current = attempt;
                      let terminalAttempt = false;
                      try {
                        const result = await kbShareDoc(
                          selected,
                          shareExpiryDays,
                          attempt.requestKey,
                        );
                        if (
                          pendingShareAttemptRef.current !== attempt ||
                          !isCurrentShareAttempt(attempt)
                        ) {
                          return;
                        }
                        terminalAttempt = true;
                        shareDisplayEpochRef.current += 1;
                        setShareUrl(result.url);
                        shareUrlShareIdRef.current = result.id;
                        setShareUrlShareId(result.id);
                        setShareExpiresAt(result.expiresAt || "");
                        setActiveShares((shares) => [
                          {
                            id: result.id,
                            title: selected.name,
                            createdAt: new Date().toISOString(),
                            expiresAt: result.expiresAt,
                          },
                          ...shares.filter((share) => share.id !== result.id),
                        ]);
                        try {
                          await navigator.clipboard?.writeText(result.url);
                          if (!isCurrentShareAttempt(attempt)) return;
                          setDocMsg("分享链接已生成并复制到剪贴板。");
                        } catch {
                          if (!isCurrentShareAttempt(attempt)) return;
                          setDocMsg("分享链接已生成。");
                        }
                      } catch (e) {
                        if (
                          pendingShareAttemptRef.current !== attempt ||
                          !isCurrentShareAttempt(attempt)
                        ) {
                          return;
                        }
                        if (
                          e?.status === 409 &&
                          e?.code === "share_request_already_processed" &&
                          e?.shareId
                        ) {
                          if (e.shareStatus === "active") {
                            const refreshedShares = await kbListActiveShares(
                              selected.id,
                            ).catch(() => null);
                            if (!isCurrentShareAttempt(attempt)) return;
                            terminalAttempt = true;
                            if (refreshedShares) {
                              setActiveShares(refreshedShares);
                            }
                            setFocusedShareId(e.shareId);
                            setDocMsg(
                              "该请求已处理，但原链接无法恢复，请撤销对应分享并重新生成。",
                            );
                          } else if (e.shareStatus === "pending") {
                            setDocMsg("分享请求仍在处理中，请稍后重试。");
                          } else if (
                            e.shareStatus === "failed" ||
                            e.shareStatus === "revoked" ||
                            e.shareStatus === "expired"
                          ) {
                            terminalAttempt = true;
                            setDocMsg(
                              e.shareStatus === "failed"
                                ? "上次分享生成失败，可重新生成。"
                                : e.shareStatus === "revoked"
                                  ? "上次分享已撤销，可重新生成。"
                                  : "上次分享已过期，可重新生成。",
                            );
                          } else {
                            setDocMsg("分享请求状态暂不可确认，请稍后重试。");
                          }
                        } else {
                          setDocMsg(
                            e?.message === "Tencent COS is not configured"
                              ? "未连接云端存储，暂不可生成分享链接。"
                              : `分享失败：${e?.message || "请稍后重试"}`,
                          );
                        }
                      } finally {
                        if (isCurrentShareAttempt(attempt)) {
                          if (
                            terminalAttempt &&
                            pendingShareAttemptRef.current === attempt
                          ) {
                            pendingShareAttemptRef.current = null;
                          }
                          setShareBusy(false);
                        }
                      }
                    }}
                  >
                    {shareBusy ? "生成中…" : "分享链接"}
                  </Button>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "var(--ink-500)",
                    }}
                  >
                    分享有效期
                    <select
                      aria-label="分享有效期"
                      value={String(shareExpiryDays)}
                      disabled={shareBusy}
                      onChange={(event) =>
                        setShareExpiryDays(Number(event.target.value))
                      }
                      style={{
                        height: 28,
                        border: "1px solid var(--line)",
                        borderRadius: 6,
                        background: "#fff",
                        color: "var(--ink-700)",
                        padding: "0 8px",
                        fontSize: 12,
                      }}
                    >
                      <option value="1">1 天</option>
                      <option value="7">7 天</option>
                      <option value="30">30 天</option>
                    </select>
                  </label>
                  <Button
                    size="sm"
                    kind="default"
                    onClick={() => kbExportMarkdown(selected)}
                  >
                    导出 MD
                  </Button>
                  <Button
                    size="sm"
                    kind="default"
                    onClick={() => kbExportPdf(selected)}
                  >
                    导出 PDF
                  </Button>
                  <Button
                    size="sm"
                    kind="default"
                    onClick={() => kbExportWord(selected)}
                  >
                    导出 Word
                  </Button>
                </div>
              )}
              {selected.type === "doc" && (shareUrl || docMsg) ? (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    background: "var(--bg-soft)",
                    fontSize: 12,
                    color: "var(--ink-700)",
                  }}
                >
                  {docMsg ? (
                    <div style={{ marginBottom: shareUrl ? 6 : 0 }}>
                      {docMsg}
                    </div>
                  ) : null}
                  {shareExpiresAt ? (
                    <div style={{ marginBottom: shareUrl ? 6 : 0 }}>
                      有效期至：
                      {new Date(shareExpiresAt).toLocaleString("zh-CN")}
                    </div>
                  ) : null}
                  {shareUrl ? (
                    <div
                      style={{ display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <input
                        aria-label="分享链接"
                        readOnly
                        value={shareUrl}
                        onFocus={(e) => e.target.select()}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          border: "1px solid var(--line)",
                          borderRadius: 6,
                          padding: "5px 8px",
                          fontSize: 12,
                          color: "var(--ink-700)",
                          background: "#fff",
                        }}
                      />
                      <Button
                        size="sm"
                        kind="default"
                        onClick={() => {
                          navigator.clipboard?.writeText(shareUrl);
                          setDocMsg("已复制到剪贴板。");
                        }}
                      >
                        复制
                      </Button>
                      <a
                        href={shareUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12, color: "var(--blue-700)" }}
                      >
                        打开
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {selected.type === "doc" &&
              (activeSharesLoading || activeShares.length > 0) ? (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    background: "#fff",
                    fontSize: 12,
                    color: "var(--ink-700)",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    活跃分享
                  </div>
                  {activeSharesLoading ? (
                    <div style={{ color: "var(--ink-400)" }}>读取中…</div>
                  ) : (
                    activeShares.map((share) => {
                      const formattedExpiry = kbFormatShareExpiry(
                        share.expiresAt,
                      );
                      return (
                        <div
                          key={share.id}
                          ref={(node) => {
                            if (node) {
                              activeShareRowRefs.current.set(share.id, node);
                            } else {
                              activeShareRowRefs.current.delete(share.id);
                            }
                          }}
                          data-testid={`knowledge-share-${share.id}`}
                          tabIndex={-1}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 0",
                            borderTop: "1px solid var(--line)",
                          }}
                        >
                          <span style={{ flex: 1, minWidth: 0 }}>
                            {share.title} · 有效期至{" "}
                            <time
                              dateTime={share.expiresAt}
                              aria-label={`有效期至 ${formattedExpiry}`}
                            >
                              {formattedExpiry}
                            </time>
                          </span>
                          <Button
                            size="sm"
                            kind="danger"
                            disabled={Boolean(revokingShareId)}
                            onClick={async () => {
                              if (activeRevokeOperationRef.current) return;
                              const operation = {
                                documentId: selected.id,
                                shareId: share.id,
                                epoch: ++revokeOperationEpochRef.current,
                                displayEpoch: shareDisplayEpochRef.current,
                              };
                              activeRevokeOperationRef.current = operation;
                              setRevokingShareId(share.id);
                              try {
                                await kbRevokeShare(share.id);
                                if (!isCurrentRevokeOperation(operation))
                                  return;
                                setActiveShares((shares) =>
                                  shares.filter((item) => item.id !== share.id),
                                );
                                if (share.id === shareUrlShareIdRef.current) {
                                  setShareUrl("");
                                  shareUrlShareIdRef.current = null;
                                  setShareUrlShareId(null);
                                  setShareExpiresAt("");
                                }
                                if (
                                  operation.displayEpoch ===
                                  shareDisplayEpochRef.current
                                ) {
                                  setDocMsg("分享链接已撤销。");
                                }
                              } catch {
                                if (!isCurrentRevokeOperation(operation))
                                  return;
                                if (
                                  operation.displayEpoch ===
                                  shareDisplayEpochRef.current
                                ) {
                                  setDocMsg("撤销失败，请稍后重试。");
                                }
                              } finally {
                                if (isCurrentRevokeOperation(operation)) {
                                  activeRevokeOperationRef.current = null;
                                  setRevokingShareId(null);
                                }
                              }
                            }}
                          >
                            {revokingShareId === share.id ? "撤销中…" : "撤销"}
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}
              <input
                value={selected.name}
                onChange={(e) =>
                  setStore((s) => kbRenameNode(s, selected.id, e.target.value))
                }
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  fontSize: 24,
                  fontWeight: 700,
                  color: "var(--ink-900)",
                  marginBottom: 14,
                  background: "transparent",
                }}
              />
              {selected.type === "doc" ? (
                <KnowledgeDocEditor
                  key={selected.id}
                  BlockEditor={BlockEditor}
                  doc={selected}
                  onChange={(md) =>
                    setStore((s) => kbSetContent(s, selected.id, md))
                  }
                  parseMarkdownToBlocks={parseMarkdownToBlocks}
                  serializeBlocksToMarkdown={serializeBlocksToMarkdown}
                />
              ) : (
                <KnowledgeFolderView
                  Button={Button}
                  EmptyHint={EmptyHint}
                  kbChildren={kbChildren}
                  store={store}
                  folder={selected}
                  onOpen={(n) => selectNode(n)}
                  onAdd={(type) => addChild(selected.id, type)}
                />
              )}
            </>
          ) : (
            <EmptyHint
              title="选择左侧文档"
              hint="或新建页面 / 文件夹组织你的知识库。"
            />
          )}
        </div>
      </div>

      {/* Node context menu */}
      {menu && menuNode && (
        <>
          <div
            onMouseDown={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
            style={{ position: "fixed", inset: 0, zIndex: 90 }}
          />
          <div
            style={{
              position: "fixed",
              left: Math.min(
                menu.x,
                (typeof window !== "undefined" ? window.innerWidth : 1200) -
                  200,
              ),
              top: Math.min(
                menu.y,
                (typeof window !== "undefined" ? window.innerHeight : 800) -
                  240,
              ),
              zIndex: 91,
              background: "#fff",
              border: "1px solid var(--line)",
              borderRadius: 8,
              boxShadow: "0 12px 32px rgba(15,23,42,0.18)",
              padding: 6,
              minWidth: 168,
            }}
          >
            {menuNode.type === "folder" && (
              <>
                <KbMenuItem
                  onClick={() => addChild(menuNode.id, "doc")}
                  close={() => setMenu(null)}
                >
                  新建页面
                </KbMenuItem>
                <KbMenuItem
                  onClick={() => addChild(menuNode.id, "folder")}
                  close={() => setMenu(null)}
                >
                  新建文件夹
                </KbMenuItem>
              </>
            )}
            <KbMenuItem
              onClick={() => setRenamingId(menuNode.id)}
              close={() => setMenu(null)}
            >
              重命名
            </KbMenuItem>
            {!menuNode.system && (
              <KbMenuItem
                onClick={() => setMoveId(menuNode.id)}
                close={() => setMenu(null)}
              >
                移动到…
              </KbMenuItem>
            )}
            {!menuNode.system && (
              <KbMenuItem
                danger
                onClick={() => {
                  setStore((s) => kbDeleteNode(s, menuNode.id));
                  if (selectedId === menuNode.id) selectId(KB_REVIEW_FOLDER_ID);
                }}
                close={() => setMenu(null)}
              >
                删除
              </KbMenuItem>
            )}
          </div>
        </>
      )}

      {/* Move picker */}
      {moveId && (
        <div
          onMouseDown={() => setMoveId(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.4)",
            zIndex: 95,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: 360,
              maxHeight: "70vh",
              overflowY: "auto",
              background: "#fff",
              borderRadius: 10,
              padding: 14,
              boxShadow: "0 20px 50px rgba(15,23,42,0.25)",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 10 }}>移动到…</div>
            {folderOptions
              .filter(
                (f) =>
                  f.id !== moveId &&
                  !kbDescendants(store, moveId).includes(f.id) &&
                  store.nodes[moveId]?.parentId !== f.id,
              )
              .map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setStore((s) => kbMoveNode(s, moveId, f.id));
                    setMoveId(null);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    padding: "8px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                    color: "var(--ink-700)",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--bg-soft)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  {kbPath(store, f.id)
                    .map((p) => p.name)
                    .join(" / ")}
                </button>
              ))}
          </div>
        </div>
      )}
    </>
  );
}

const kbIconBtn = {
  border: "none",
  background: "transparent",
  color: "var(--ink-400)",
  cursor: "pointer",
  fontSize: 13,
  width: 20,
  height: 20,
  borderRadius: 4,
  padding: 0,
  lineHeight: 1,
};

function KbMenuItem({ children, onClick, close, danger }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
        close?.();
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--bg-soft)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        border: "none",
        background: "transparent",
        padding: "7px 8px",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
        color: danger ? "var(--danger-600)" : "var(--ink-700)",
      }}
    >
      {children}
    </button>
  );
}

function KnowledgeFolderView({
  Button,
  EmptyHint,
  folder,
  kbChildren,
  onAdd,
  onOpen,
  store,
}) {
  const kids = kbChildren(store, folder.id);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <Button size="sm" kind="default" onClick={() => onAdd("doc")}>
          + 新建页面
        </Button>
        <Button size="sm" kind="default" onClick={() => onAdd("folder")}>
          + 新建文件夹
        </Button>
      </div>
      {kids.length === 0 ? (
        <EmptyHint
          title="空文件夹"
          hint="新建页面或文件夹，或在任务详情完成复盘后自动归档到这里。"
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          {kids.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => onOpen(k)}
              style={{
                textAlign: "left",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: 12,
                background: "#fff",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 18, marginBottom: 6 }}>
                {k.type === "folder" ? "📁" : "📄"}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink-900)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {k.name}
              </div>
              <div
                style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 4 }}
              >
                {k.type === "folder"
                  ? `${kbChildren(store, k.id).length} 项`
                  : "复盘文档"}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
