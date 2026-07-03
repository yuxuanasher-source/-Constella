// 上播后结果回流（post_join_outcome）：入项满观察窗口的申请，回看其直播
// 报数质量（证据等级、风险标记、是否复播），事后校验准入决定是否正确。
// regret 信号供指标与复盘使用——准入判断的最终 ground truth 不是二审，
// 而是上播后的真实表现。

export const OUTCOME_DEFAULT_WINDOW_DAYS = 30;
export const OUTCOME_CLAIM_DEFAULT_LIMIT = 20;

export type PostJoinOutcome = "healthy" | "watch" | "regret";

export type PostJoinOutcomePayload = {
  joinedAt: string;
  windowDays: number;
  totalReports: number;
  greenReports: number;
  yellowReports: number;
  redReports: number;
  riskFlaggedReports: number;
  outcome: PostJoinOutcome;
};

type JoinedApplicationRow = {
  id: string;
  organization_id: string;
  project_id: string;
  streamer_id: string;
  decided_at: string | null;
};

type ReportRow = {
  evidence_level: string | null;
  risk_flags: string[] | null;
};

type OutcomeDb = {
  from(table: "project_applications"): {
    select(columns: string): {
      eq(
        column: "organization_id",
        value: string,
      ): {
        eq(
          column: "status",
          value: string,
        ): {
          lt(
            column: "decided_at",
            value: string,
          ): {
            order(
              column: "decided_at",
              options: { ascending: boolean },
            ): {
              limit(count: number): PromiseLike<{
                data: JoinedApplicationRow[] | null;
                error: Error | null;
              }>;
            };
          };
        };
      };
    };
  };
  from(table: "recording_submissions"): {
    select(columns: string): {
      eq(
        column: "application_id",
        value: string,
      ): {
        order(
          column: "version",
          options: { ascending: boolean },
        ): {
          limit(count: number): PromiseLike<{
            data: Array<{ id: string }> | null;
            error: Error | null;
          }>;
        };
      };
    };
  };
  from(table: "admission_review_signals"): {
    select(columns: string): {
      in(
        column: "submission_id",
        values: string[],
      ): {
        eq(
          column: "signal_kind",
          value: string,
        ): PromiseLike<{
          data: Array<{ submission_id: string }> | null;
          error: Error | null;
        }>;
      };
    };
    upsert(
      payload: Record<string, unknown>,
      options: { onConflict: string },
    ): PromiseLike<{ error: Error | null }>;
  };
  from(table: "live_reports"): {
    select(columns: string): {
      eq(
        column: "organization_id",
        value: string,
      ): {
        eq(
          column: "project_id",
          value: string,
        ): {
          eq(
            column: "streamer_id",
            value: string,
          ): PromiseLike<{ data: ReportRow[] | null; error: Error | null }>;
        };
      };
    };
  };
};

export type OutcomeRunResult = {
  processed: number;
  outcomes: Array<{
    applicationId: string;
    submissionId: string;
    outcome: PostJoinOutcome;
  }>;
  failures: Array<{ applicationId: string; errorSummary: string }>;
};

export async function runPostJoinOutcomes({
  client,
  actor,
  windowDays = OUTCOME_DEFAULT_WINDOW_DAYS,
  limit = OUTCOME_CLAIM_DEFAULT_LIMIT,
  now = () => new Date(),
}: {
  client: OutcomeDb;
  actor: { organizationId: string };
  windowDays?: number;
  limit?: number;
  now?: () => Date;
}): Promise<OutcomeRunResult> {
  const normalizedWindow = Math.max(7, Math.min(Math.trunc(windowDays), 120));
  const cutoff = new Date(
    now().getTime() - normalizedWindow * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await client
    .from("project_applications")
    .select("id, organization_id, project_id, streamer_id, decided_at")
    .eq("organization_id", actor.organizationId)
    .eq("status", "joined")
    .lt("decided_at", cutoff)
    .order("decided_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)) * 3);

  if (error) {
    throw error;
  }

  const candidates = (data ?? []).filter((row) => row.decided_at);
  const outcomes: OutcomeRunResult["outcomes"] = [];
  const failures: OutcomeRunResult["failures"] = [];

  for (const application of candidates) {
    if (outcomes.length >= Math.max(1, Math.min(limit, 100))) {
      break;
    }
    try {
      // 找最新录屏提交（信号以 submission 为锚点，与其它信号对齐）。
      const { data: submissions, error: submissionError } = await client
        .from("recording_submissions")
        .select("id")
        .eq("application_id", application.id)
        .order("version", { ascending: false })
        .limit(1);
      if (submissionError) {
        throw submissionError;
      }
      const submissionId = submissions?.[0]?.id;
      if (!submissionId) {
        continue;
      }

      // 已有结果信号则跳过（窗口只回看一次）。
      const { data: existing, error: existingError } = await client
        .from("admission_review_signals")
        .select("submission_id")
        .in("submission_id", [submissionId])
        .eq("signal_kind", "post_join_outcome");
      if (existingError) {
        throw existingError;
      }
      if (existing?.length) {
        continue;
      }

      const { data: reports, error: reportsError } = await client
        .from("live_reports")
        .select("evidence_level, risk_flags")
        .eq("organization_id", application.organization_id)
        .eq("project_id", application.project_id)
        .eq("streamer_id", application.streamer_id);
      if (reportsError) {
        throw reportsError;
      }

      const payload = buildOutcomePayload({
        joinedAt: application.decided_at as string,
        windowDays: normalizedWindow,
        reports: reports ?? [],
      });

      const { error: upsertError } = await client
        .from("admission_review_signals")
        .upsert(
          {
            organization_id: application.organization_id,
            application_id: application.id,
            submission_id: submissionId,
            signal_kind: "post_join_outcome",
            payload,
          },
          { onConflict: "submission_id,signal_kind" },
        );
      if (upsertError) {
        throw upsertError;
      }

      outcomes.push({
        applicationId: application.id,
        submissionId,
        outcome: payload.outcome,
      });
    } catch (error) {
      failures.push({
        applicationId: application.id,
        errorSummary:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "outcome computation failed",
      });
    }
  }

  return { processed: outcomes.length, outcomes, failures };
}

export function buildOutcomePayload({
  joinedAt,
  windowDays,
  reports,
}: {
  joinedAt: string;
  windowDays: number;
  reports: ReportRow[];
}): PostJoinOutcomePayload {
  const total = reports.length;
  const count = (level: string) =>
    reports.filter((report) => report.evidence_level === level).length;
  const green = count("green");
  const yellow = count("yellow");
  const red = count("red");
  const riskFlagged = reports.filter(
    (report) => (report.risk_flags ?? []).length > 0,
  ).length;

  // regret：入项后从未复播，或红色证据占比过高——准入判断需复盘。
  // watch：黄/红或风险标记偏多，值得关注但不算误判。
  let outcome: PostJoinOutcome = "healthy";
  if (total === 0 || (total > 0 && red / total > 0.3)) {
    outcome = "regret";
  } else if (
    (yellow + red) / total > 0.4 ||
    riskFlagged / total > 0.3
  ) {
    outcome = "watch";
  }

  return {
    joinedAt,
    windowDays,
    totalReports: total,
    greenReports: green,
    yellowReports: yellow,
    redReports: red,
    riskFlaggedReports: riskFlagged,
    outcome,
  };
}
