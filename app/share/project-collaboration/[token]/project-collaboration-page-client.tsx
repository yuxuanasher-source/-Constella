"use client";

import {
  AlertCircle,
  CheckCircle2,
  RefreshCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type PublicProjectCollaboration =
  | {
      available: true;
      share: {
        id: string;
        status: "active" | "expired" | "revoked";
        expiresAt: string;
        allowApplications: boolean;
      };
      project: {
        id: string;
        name: string;
        code: string;
        ownerOrganizationName: string;
        collaborationSummary: string;
        collaborationTerms: Record<string, unknown>;
      };
    }
  | {
      available: false;
      reason: string;
    };

type ProjectCollaborationPageClientProps = {
  token: string;
};

export default function ProjectCollaborationPageClient({
  token,
}: ProjectCollaborationPageClientProps) {
  const [collaboration, setCollaboration] =
    useState<PublicProjectCollaboration | null>(null);
  const [revenueSharePercent, setRevenueSharePercent] = useState("");
  const [applicantNote, setApplicantNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const terms = useMemo(() => {
    if (!collaboration?.available) {
      return [];
    }
    return Object.entries(collaboration.project.collaborationTerms).filter(
      ([, value]) => value !== null && value !== undefined && value !== "",
    );
  }, [collaboration]);

  const loadCollaboration = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const nextCollaboration = await requestCollaboration(token);
      setCollaboration(nextCollaboration);
    } catch (error) {
      setCollaboration(null);
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to load collaboration",
      );
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let isCurrent = true;

    async function loadInitialCollaboration() {
      try {
        const nextCollaboration = await requestCollaboration(token);
        if (isCurrent) {
          setCollaboration(nextCollaboration);
        }
      } catch (error) {
        if (isCurrent) {
          setCollaboration(null);
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to load collaboration",
          );
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialCollaboration();

    return () => {
      isCurrent = false;
    };
  }, [token]);

  const submitApplication = async () => {
    if (!collaboration?.available || !collaboration.share.allowApplications) {
      return;
    }

    const sharePercent = Number(revenueSharePercent);
    if (
      !Number.isFinite(sharePercent) ||
      sharePercent < 0 ||
      sharePercent > 100
    ) {
      setErrorMessage("Revenue share must be between 0 and 100");
      setSuccessMessage("");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await fetch(publicCollaborationUrl(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedRevenueShareBps: Math.round(sharePercent * 100),
          applicantNote: applicantNote.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, "Unable to submit application"));
      }

      setSuccessMessage("Application submitted");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to submit application",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink-900)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-md border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--blue-600)]">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                MCN collaboration
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-normal">
                {collaboration?.available
                  ? collaboration.project.name
                  : "Project collaboration"}
              </h1>
              {collaboration?.available ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-500)]">
                  <span className="rounded-sm border border-[var(--line)] px-2 py-1">
                    {collaboration.project.ownerOrganizationName}
                  </span>
                  <span className="rounded-sm border border-[var(--line)] px-2 py-1">
                    {collaboration.project.code}
                  </span>
                  <span className="rounded-sm border border-[var(--line)] px-2 py-1">
                    Expires {formatDateTime(collaboration.share.expiresAt)}
                  </span>
                </div>
              ) : null}
            </div>

            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-sm font-medium text-[var(--ink-700)] hover:border-[var(--blue-300)] disabled:cursor-not-allowed disabled:opacity-60"
              type="button"
              onClick={() => void loadCollaboration()}
              disabled={isLoading}
            >
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </button>
          </div>
        </section>

        {errorMessage ? (
          <div className="flex items-center gap-2 rounded-md border border-[var(--danger-600)] bg-[var(--danger-50)] px-4 py-3 text-sm text-[var(--danger-600)]">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {errorMessage}
          </div>
        ) : null}

        {successMessage ? (
          <div className="flex items-center gap-2 rounded-md border border-[var(--ok-600)] bg-[var(--ok-50)] px-4 py-3 text-sm text-[var(--ok-600)]">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {successMessage}
          </div>
        ) : null}

        {isLoading ? (
          <section className="rounded-md border border-[var(--line)] bg-white p-5 text-sm text-[var(--ink-500)]">
            Loading collaboration...
          </section>
        ) : null}

        {collaboration && !collaboration.available ? (
          <section className="rounded-md border border-[var(--line)] bg-white p-5 text-sm text-[var(--ink-500)]">
            {collaboration.reason}
          </section>
        ) : null}

        {collaboration?.available ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-md border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
              <h2 className="text-lg font-semibold tracking-normal">
                Collaboration brief
              </h2>
              <p className="mt-3 text-sm leading-6 text-[var(--ink-600)]">
                {collaboration.project.collaborationSummary || "No summary"}
              </p>

              {terms.length ? (
                <dl className="mt-5 grid gap-3">
                  {terms.map(([key, value]) => (
                    <div
                      className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-3"
                      key={key}
                    >
                      <dt className="text-xs font-medium text-[var(--ink-500)]">
                        {labelFromKey(key)}
                      </dt>
                      <dd className="mt-1 text-sm font-medium text-[var(--ink-800)]">
                        {displayValue(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </section>

            <section className="rounded-md border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
              <h2 className="text-lg font-semibold tracking-normal">
                Partner application
              </h2>
              <div className="mt-4 grid gap-4">
                <label className="grid gap-1 text-xs font-medium text-[var(--ink-700)]">
                  Revenue share %
                  <input
                    className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--blue-500)]"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    type="number"
                    value={revenueSharePercent}
                    onChange={(event) =>
                      setRevenueSharePercent(event.target.value)
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs font-medium text-[var(--ink-700)]">
                  Application note
                  <textarea
                    className="min-h-28 resize-y rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--blue-500)]"
                    value={applicantNote}
                    onChange={(event) => setApplicantNote(event.target.value)}
                  />
                </label>
                <button
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--blue-600)] px-5 text-sm font-semibold text-white shadow-[var(--shadow-fab)] hover:bg-[var(--blue-700)] disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  onClick={() => void submitApplication()}
                  disabled={
                    isSubmitting || !collaboration.share.allowApplications
                  }
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Submit application
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

async function requestCollaboration(token: string) {
  const response = await fetch(publicCollaborationUrl(token), {
    method: "GET",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(errorText(payload, "Unable to load collaboration"));
  }
  return payload.collaboration as PublicProjectCollaboration;
}

function publicCollaborationUrl(token: string) {
  return `/api/public/project-collaboration/${encodeURIComponent(token)}`;
}

function errorText(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

function labelFromKey(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function displayValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return JSON.stringify(value);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
