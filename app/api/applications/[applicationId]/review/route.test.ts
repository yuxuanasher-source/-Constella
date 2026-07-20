import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "./route";

import {
  recordAdmissionEvaluation,
  resolveAdmissionRubric,
} from "@/features/admission-review/evaluation-service";
import { recordAiVsMcnSignal } from "@/features/admission-review/signals";
import { getAdmissionRouteContext } from "@/features/applications/application-route-utils";
import { reviewRecordingSubmission } from "@/features/applications/application-service";

vi.mock("@/features/admission-review/evaluation-service", () => ({
  recordAdmissionEvaluation: vi.fn(),
  resolveAdmissionRubric: vi.fn(),
}));

vi.mock("@/features/admission-review/signals", () => ({
  recordAiVsMcnSignal: vi.fn(),
}));

vi.mock("@/features/applications/application-service", () => ({
  reviewRecordingSubmission: vi.fn(),
}));

vi.mock("@/features/applications/application-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/applications/application-route-utils")
  >("@/features/applications/application-route-utils");

  return {
    ...actual,
    getAdmissionRouteContext: vi.fn(),
  };
});

const auth = {
  userId: "user-ops",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

const rubric = {
  rubricVersion: 1,
  source: "default" as const,
  checkpoints: [
    {
      key: "script_fit",
      label: "话术贴合项目卖点",
      description: "",
      severity: "soft" as const,
      applicableStage: "mcn_first" as const,
      weight: 1,
      active: true,
    },
  ],
};

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/applications/app-1/review", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/applications/[applicationId]/review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdmissionRouteContext).mockResolvedValue({
      supabase: { client: "supabase" },
      auth,
      repo: { repo: "applications" },
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);
    vi.mocked(resolveAdmissionRubric).mockResolvedValue(rubric);
    vi.mocked(recordAdmissionEvaluation).mockResolvedValue({
      id: "evaluation-1",
    } as never);
    vi.mocked(recordAiVsMcnSignal).mockResolvedValue(undefined as never);
    vi.mocked(reviewRecordingSubmission).mockImplementation(async (input) => {
      await input.recordEvaluation?.({
        organizationId: auth.organizationId,
        applicationId: input.input.applicationId,
        submissionId: "recording-1",
        decision: input.input.decision,
        reviewerId: auth.userId,
        note: input.input.note,
        noteSource: "human",
        reasonCodes: input.input.reasonCodes ?? [],
        checkpointResults: input.input.checkpointResults,
      });

      return {
        id: input.input.applicationId,
        status: "recording_required",
      } as never;
    });
  });

  it("whitelists structured advisory evidence as checkpoint evidence only", async () => {
    const response = await PATCH(
      jsonRequest({
        decision: "needs_changes",
        note: "人工要求补充",
        reasonCodes: ["script_fit"],
        checkpointResults: [
          {
            checkpointKey: "script_fit",
            verdict: "fail",
            note: "缺少开服冲榜卖点",
            evidence: {
              structuredFeedback: {
                issue: "  卖点没说清  ",
                howToImprove: "补充福利入口和预约动作",
                rerecordSuggestion: "clip",
                advisoryOnly: false,
                decision: "approved",
              },
              hugeRawPayload: "discard me",
            },
          },
        ],
      }),
      { params: Promise.resolve({ applicationId: "app-1" }) },
    );

    expect(response.status).toBe(200);
    expect(reviewRecordingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          applicationId: "app-1",
          decision: "needs_changes",
          checkpointResults: [
            {
              checkpointKey: "script_fit",
              verdict: "fail",
              note: "缺少开服冲榜卖点",
              evidence: {
                structuredFeedback: {
                  issue: "卖点没说清",
                  howToImprove: "补充福利入口和预约动作",
                  rerecordSuggestion: "clip",
                  advisoryOnly: true,
                },
              },
            },
          ],
        }),
      }),
    );
    expect(recordAdmissionEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          decision: "needs_changes",
          checkpointResults: [
            {
              checkpointKey: "script_fit",
              verdict: "fail",
              note: "缺少开服冲榜卖点",
              evidence: {
                structuredFeedback: {
                  issue: "卖点没说清",
                  howToImprove: "补充福利入口和预约动作",
                  rerecordSuggestion: "clip",
                  advisoryOnly: true,
                },
              },
            },
          ],
        }),
      }),
    );
    expect(
      vi.mocked(recordAdmissionEvaluation).mock.calls[0][0].input
        .checkpointResults?.[0],
    ).not.toHaveProperty("decision");
  });
});
