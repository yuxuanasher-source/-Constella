"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

export function PlatformAdminActionDialog({
  open,
  title,
  description,
  submitting,
  error,
  success,
  conflict = false,
  onClose,
  onRefresh,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  submitting: boolean;
  error?: string;
  success?: string;
  conflict?: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[1px]" />
        <Dialog.Content
          onEscapeKeyDown={(event) => {
            if (submitting) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (submitting) event.preventDefault();
          }}
          className="fixed top-1/2 left-1/2 z-50 max-h-[min(84vh,760px)] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--r-lg)] border border-[var(--line)] bg-white shadow-2xl outline-none"
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--line)] bg-white px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-[var(--ink-900)]">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 max-w-xl text-xs leading-5 text-[var(--ink-400)]">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild disabled={submitting}>
              <Button
                type="button"
                aria-label="关闭"
                variant="ghost"
                size="icon"
                className="-mt-1 -mr-2 shrink-0"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="space-y-4 px-5 py-5">{children}</div>

          {error || success ? (
            <div
              role="status"
              aria-live="polite"
              className={`mx-5 mb-4 border px-3 py-2 text-sm ${
                error
                  ? "border-red-200 bg-red-50 text-[var(--danger-600)]"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{error ?? success}</span>
                {conflict && onRefresh ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onRefresh}
                  >
                    刷新最新数据
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="sr-only" role="status" aria-live="polite" />
          )}

          {footer ? (
            <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-[var(--line)] bg-[var(--bg-soft)] px-5 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
