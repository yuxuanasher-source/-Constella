"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AccountLibraryPanel } from "@/components/account-library/account-library-panel";
import { Button } from "@/components/ui/button";
import type { PlatformAccountDto } from "@/features/account-library/account-library-ui-adapters";

type LoadState = "idle" | "loading" | "ready" | "error";

export function AccountLibraryScreen({
  active,
  initialAccounts,
  canManage,
}: {
  active: boolean;
  initialAccounts?: PlatformAccountDto[];
  canManage: boolean;
}) {
  const mountedRef = useRef(true);
  const [accounts, setAccounts] = useState<PlatformAccountDto[]>(
    () => initialAccounts ?? [],
  );
  const [loadState, setLoadState] = useState<LoadState>(() =>
    initialAccounts === undefined ? "idle" : "ready",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadAccounts = useCallback(async () => {
    setLoadState("loading");
    setError(null);

    try {
      const response = await fetch("/api/account-library", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        accounts?: unknown;
        error?: unknown;
      };

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "账号库加载失败，请稍后重试。",
        );
      }
      if (!Array.isArray(payload.accounts)) {
        throw new Error("账号库返回了无效数据，请稍后重试。");
      }
      if (!mountedRef.current) {
        return;
      }

      setAccounts(payload.accounts as PlatformAccountDto[]);
      setLoadState("ready");
    } catch (caught) {
      if (!mountedRef.current) {
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "账号库加载失败，请稍后重试。",
      );
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    if (!active || loadState !== "idle") {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void loadAccounts();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [active, loadAccounts, loadState]);

  if (loadState === "ready") {
    return (
      <div hidden={!active} style={{ padding: 20 }}>
        <AccountLibraryPanel accounts={accounts} canManage={canManage} />
      </div>
    );
  }

  if (!active) {
    return null;
  }

  if (loadState === "error") {
    return (
      <div className="p-5">
        <div
          role="alert"
          className="rounded-lg border border-[var(--line)] bg-white p-8 text-center"
        >
          <p className="text-sm text-[var(--danger-600)]">{error}</p>
          <Button
            className="mt-4"
            variant="secondary"
            onClick={() => void loadAccounts()}
          >
            重试
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      aria-busy="true"
      aria-label="账号库加载中"
      aria-live="polite"
      className="space-y-4 p-5"
    >
      <div className="h-7 w-32 animate-pulse rounded bg-[var(--ink-100)]" />
      <div className="h-10 animate-pulse rounded-lg bg-[var(--ink-50)]" />
      <div className="rounded-lg border border-[var(--line)] bg-white p-4">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="h-10 animate-pulse rounded bg-[var(--ink-50)]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
