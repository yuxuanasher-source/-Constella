import { describe, expect, it, vi } from "vitest";

import {
  computeHermesSkillGrantsHash,
  createHermesActorFingerprint,
} from "./actor-fingerprint";
import {
  HERMES_EVIDENCE_REF_MAX_LENGTH,
  type HermesActorProfile,
} from "./contracts";
import { HermesLiveActorAuthorizationError } from "./live-actor-authorization";
import { HermesStateRepositoryError } from "./hermes-state-repository";
import { hashHermesCapabilityToken } from "./run-capability";
import type { HermesToolBrokerRequest } from "./tool-broker-contracts";
import {
  executeHermesToolBrokerCall,
  type HermesBrokerCapability,
  type HermesToolBrokerDependencies,
} from "./tool-broker";

const CAPABILITY = "c".repeat(43);
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const INVOCATION_ID = "44444444-4444-4444-8444-444444444444";
const ROOT_INVOCATION_ID = "55555555-5555-4555-8555-555555555555";
const TURN_ID = "66666666-6666-4666-8666-666666666666";
const BROKER_CALL_ID = "77777777-7777-4777-8777-777777777777";
const NOW = new Date("2026-07-22T00:00:00.000Z");

describe("Hermes Product Tool Broker", () => {
  it.each(["missing", "expired", "revoked", "inactive invocation"])(
    "returns the same denial for a %s capability",
    async () => {
      const deps = dependencies({
        loadCapability: vi.fn(async () => null),
      });

      await expect(run(deps)).rejects.toMatchObject({ code: "unauthorized" });
      expect(deps.loadCapability).toHaveBeenCalledWith({
        tokenSha256: hashHermesCapabilityToken(CAPABILITY),
        now: NOW,
      });
      expect(deps.reauthorizeActor).not.toHaveBeenCalled();
      expect(deps.executeRead).not.toHaveBeenCalled();
    },
  );

  it("does not reveal cross-org, user, conversation, or guessed Session identity", async () => {
    const mismatches = [
      { invocationId: ROOT_INVOCATION_ID },
      { invocationId: "88888888-8888-4888-8888-888888888888" },
    ];

    for (const requestOverride of mismatches) {
      const deps = dependencies();
      await expect(run(deps, requestOverride)).rejects.toMatchObject({
        code: "unauthorized",
      });
      expect(deps.reauthorizeActor).not.toHaveBeenCalled();
      expect(deps.executeRead).not.toHaveBeenCalled();
    }
  });

  it("reauthorizes live membership on every call and invalidates a role downgrade", async () => {
    const reauthorizeActor = vi
      .fn()
      .mockResolvedValueOnce({
        actor: actor(),
        actorFingerprint: fingerprint(actor()),
      })
      .mockRejectedValueOnce(
        new HermesLiveActorAuthorizationError("actor_changed"),
      );
    const deps = dependencies({ reauthorizeActor });

    await expect(run(deps)).resolves.toMatchObject({ status: "ok" });
    await expect(
      run(deps, { toolCallId: "gateway-call-2" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(reauthorizeActor).toHaveBeenCalledTimes(2);
    expect(deps.executeRead).toHaveBeenCalledTimes(1);
  });

  it("checks capability tool and scope allowlists before dispatch", async () => {
    for (const capability of [
      brokerCapability({ allowedTools: [] }),
      brokerCapability({ scopes: [] }),
    ]) {
      const deps = dependencies({
        loadCapability: vi.fn(async () => capability),
      });

      await expect(run(deps)).rejects.toMatchObject({
        code: "permission_denied",
      });
      expect(deps.repository.claimBrokerCall).not.toHaveBeenCalled();
      expect(deps.executeRead).not.toHaveBeenCalled();
    }
  });

  it("applies the Read API role policy before claiming or dispatching", async () => {
    const finance = actor({
      role: "finance",
      allowedReadScopes: ["live_reports.search"],
    });
    const capability = brokerCapability({
      actor: finance,
      actorFingerprint: fingerprint(finance),
      allowedTools: ["xingyao_search_live_reports"],
      scopes: ["live_reports.search"],
    });
    const deps = dependencies({
      loadCapability: vi.fn(async () => capability),
      reauthorizeActor: vi.fn(async () => ({
        actor: finance,
        actorFingerprint: capability.actorFingerprint,
      })),
    });

    await expect(
      run(deps, { toolName: "xingyao_search_live_reports" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(deps.repository.claimBrokerCall).not.toHaveBeenCalled();
    expect(deps.executeRead).not.toHaveBeenCalled();
  });

  it("returns an exact stored replay without dispatching or appending twice", async () => {
    const replay = brokerEnvelope();
    const deps = dependencies();
    vi.mocked(deps.repository.claimBrokerCall).mockResolvedValueOnce({
      brokerCallId: BROKER_CALL_ID,
      status: "completed",
      execute: false,
      reused: true,
      fencingToken: 1,
      sanitizedResponseEnvelope: replay,
    });

    await expect(run(deps)).resolves.toEqual(replay);
    expect(deps.executeRead).not.toHaveBeenCalled();
    expect(deps.repository.completeBrokerCall).not.toHaveBeenCalled();
  });

  it("maps a changed replay to idempotency_conflict before dispatch", async () => {
    const deps = dependencies();
    vi.mocked(deps.repository.claimBrokerCall).mockRejectedValueOnce(
      new HermesStateRepositoryError("idempotency_conflict"),
    );

    await expect(
      run(deps, { arguments: { query: "changed" } }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(deps.executeRead).not.toHaveBeenCalled();
  });

  it("keeps an upstream read failure tool-local and permits the next tool call", async () => {
    const executeRead = vi
      .fn()
      .mockResolvedValueOnce({
        status: "error",
        error: { code: "upstream_unavailable" },
        toolInvocationId: INVOCATION_ID,
        traceId: "trace-upstream",
      })
      .mockResolvedValueOnce(readSuccess());
    const deps = dependencies({ executeRead });

    await expect(run(deps)).resolves.toMatchObject({
      status: "error",
      error: { code: "upstream_unavailable" },
      invocationId: INVOCATION_ID,
      toolCallId: "gateway-call-1",
    });
    await expect(
      run(deps, { toolCallId: "gateway-call-2" }),
    ).resolves.toMatchObject({ status: "ok", toolCallId: "gateway-call-2" });
    expect(executeRead).toHaveBeenCalledTimes(2);
    expect(deps.repository.completeBrokerCall).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      BROKER_CALL_ID,
      expect.any(String),
      1,
      "failed",
      expect.objectContaining({ error: { code: "upstream_unavailable" } }),
      expect.objectContaining({
        content: expect.stringContaining('"upstream_unavailable"'),
        metadata: expect.objectContaining({
          hermesTool: expect.objectContaining({ status: "error" }),
        }),
      }),
    );
  });

  it("persists partial metadata atomically and replays it without redispatch", async () => {
    const validEvidenceRefs = [
      `conversation:${CONVERSATION_ID}`,
      "project:project-1",
      "streamer:streamer-1",
      "streamer_project_profile:project-1",
      "live_report:report-1",
      "recording_review:review-1",
      "knowledge:document-1",
      "knowledge:doc-1#chunk-1",
      "knowledge:kb_mqu7f3_q42",
      "live_report:123456",
      "settlement_batch:batch-1",
    ];
    const partialRead = {
      ...readSuccess(),
      status: "partial" as const,
      data: {
        businessInstruction: "Select one project from the current queue",
        sqlLikeBusinessInstruction:
          "Select id from projects for the current queue",
        credentialAssignments: [
          "OPENAI_API_KEY=broker-openai-secret",
          "AWS_ACCESS_KEY_ID=broker-aws-access-id",
          "XINGYAO_READ_API_SERVICE_TOKEN=broker-service-token",
        ],
        actualSql: "SELECT id, name FROM projects",
        singleIdentifierSql: "SELECT id FROM projects",
        qualifiedIdentifierSql: "SELECT projects.id FROM public.projects;",
        implicitAliasSql: "SELECT id project_id FROM projects",
        aggregateSql: "SELECT count(*) FROM projects",
        lowercaseSql: "select p.id project_id from public.projects p;",
        rows: [
          {
            id: "project-1",
            sourceRef: "project:project-1",
          },
          {
            id: "unknown-source",
            sourceRef: "private_payroll_rows:row-1",
          },
          {
            id: "tainted-source",
            sourceRef: "knowledge:Bearer broker-source-secret",
          },
        ],
      },
      evidenceRefs: [
        ...validEvidenceRefs.map((evidenceRef) =>
          evidenceRef === "knowledge:doc-1#chunk-1"
            ? "knowledge_base:doc-1#chunk-1"
            : evidenceRef,
        ),
        "private_payroll_rows:row-1",
        "knowledge:Bearer broker-evidence-secret",
        "recording_review:/api/internal/hermes/read",
        "project:https://example.invalid/project/1",
        "knowledge:select pg_sleep(10)",
        "settlement_batch:batch-1?expand=items",
        "live_report:report-1\nnext",
      ],
      sourceLabels: ["project_record"],
      missingData: ["older_projects_not_loaded"],
      permissionDenials: ["private_budget"],
      truncated: true,
    };
    const deps = dependencies({
      executeRead: vi.fn(async () => partialRead),
    });

    const first = await run(deps);
    expect(first).toMatchObject({
      status: "partial",
      data: {
        businessInstruction: "Select one project from the current queue",
        sqlLikeBusinessInstruction:
          "Select id from projects for the current queue",
        credentialAssignments: ["[REDACTED]", "[REDACTED]", "[REDACTED]"],
        actualSql: "[REDACTED]",
        singleIdentifierSql: "[REDACTED]",
        qualifiedIdentifierSql: "[REDACTED]",
        implicitAliasSql: "[REDACTED]",
        aggregateSql: "[REDACTED]",
        lowercaseSql: "[REDACTED]",
        rows: [
          { id: "project-1", sourceRef: "project:project-1" },
          { id: "unknown-source" },
          { id: "tainted-source" },
        ],
      },
      evidenceRefs: validEvidenceRefs,
      sourceLabels: partialRead.sourceLabels,
      missingData: partialRead.missingData,
      permissionDenials: partialRead.permissionDenials,
      truncated: true,
    });
    expect(deps.repository.completeBrokerCall).toHaveBeenCalledWith(
      expect.any(Object),
      BROKER_CALL_ID,
      expect.any(String),
      1,
      "completed",
      first,
      expect.objectContaining({
        content: expect.stringContaining('"truncated":true'),
      }),
    );
    const completionCall = vi.mocked(deps.repository.completeBrokerCall).mock
      .calls[0];
    const persistedEnvelopeAndAudit = JSON.stringify([
      completionCall?.[5],
      completionCall?.[6],
    ]);
    expect(completionCall?.[6]?.content).toContain(
      '"singleIdentifierSql":"[REDACTED]"',
    );
    expect(completionCall?.[6]?.content).toContain(
      '"sqlLikeBusinessInstruction":"Select id from projects for the current queue"',
    );
    for (const rawSql of [
      "SELECT id FROM projects",
      "SELECT projects.id FROM public.projects",
      "SELECT id project_id FROM projects",
      "SELECT count(*) FROM projects",
      "select p.id project_id from public.projects p",
    ]) {
      expect(persistedEnvelopeAndAudit).not.toContain(rawSql);
      expect(completionCall?.[6]?.content).not.toContain(rawSql);
    }

    vi.mocked(deps.repository.claimBrokerCall).mockResolvedValueOnce({
      brokerCallId: BROKER_CALL_ID,
      status: "completed",
      execute: false,
      reused: true,
      fencingToken: 1,
      sanitizedResponseEnvelope: first,
    });
    const replayed = await run(deps);
    expect(replayed).toEqual(first);
    expect(replayed).toMatchObject({
      data: {
        sqlLikeBusinessInstruction:
          "Select id from projects for the current queue",
      },
    });
    for (const rawSql of [
      "SELECT id FROM projects",
      "SELECT projects.id FROM public.projects",
      "SELECT id project_id FROM projects",
      "SELECT count(*) FROM projects",
      "select p.id project_id from public.projects p",
    ]) {
      expect(JSON.stringify(replayed)).not.toContain(rawSql);
    }
    expect(first.evidenceRefs).toEqual(validEvidenceRefs);
    expect(JSON.stringify(first)).not.toContain("private_payroll_rows");
    expect(JSON.stringify(first)).not.toContain("broker-source-secret");
    expect(JSON.stringify(first)).not.toContain("broker-openai-secret");
    expect(JSON.stringify(first)).not.toContain("broker-aws-access-id");
    expect(JSON.stringify(first)).not.toContain("broker-service-token");
    expect(JSON.stringify(first)).not.toContain("/api/internal/");
    expect(JSON.stringify(first)).not.toContain("https://");
    expect(JSON.stringify(first)).not.toContain("pg_sleep");
    expect(JSON.stringify(first)).not.toContain("?expand=");
    expect(JSON.stringify(first)).not.toContain("report-1\\nnext");
    expect(deps.executeRead).toHaveBeenCalledTimes(1);
    expect(deps.repository.completeBrokerCall).toHaveBeenCalledTimes(1);
  });

  it("uses one evidence length bound for the first result and exact replay", async () => {
    const prefix = "knowledge:";
    const kbBase = "kb_mqu7f3_q42";
    const atMax = `${prefix}${kbBase}${"x".repeat(
      HERMES_EVIDENCE_REF_MAX_LENGTH - prefix.length - kbBase.length,
    )}`;
    const overMax = `${atMax}x`;
    const deps = dependencies({
      executeRead: vi.fn(async () => ({
        ...readSuccess(),
        evidenceRefs: [atMax, overMax],
      })),
    });

    const first = await run(deps);
    expect(atMax).toHaveLength(HERMES_EVIDENCE_REF_MAX_LENGTH);
    expect(first.evidenceRefs).toEqual([atMax]);

    vi.mocked(deps.repository.claimBrokerCall).mockResolvedValueOnce({
      brokerCallId: BROKER_CALL_ID,
      status: "completed",
      execute: false,
      reused: true,
      fencingToken: 1,
      sanitizedResponseEnvelope: first,
    });
    await expect(run(deps)).resolves.toEqual(first);
    expect(deps.executeRead).toHaveBeenCalledTimes(1);
    expect(deps.repository.completeBrokerCall).toHaveBeenCalledTimes(1);
  });

  it("normalizes evidence metadata and persists only sanitized args/results", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const deps = dependencies({
      executeRead: vi.fn(async () => ({
        ...readSuccess(),
        data: {
          rows: [{ id: "project-1", name: "Visible" }],
          actorJws: "signed.actor.jws",
          apiSecret: "do-not-persist",
          note: "signed.actor.jws",
          stack: "internal stack",
        },
        evidenceRefs: [" project:1 ", "project:1", `Bearer ${CAPABILITY}`],
        sourceLabels: [" project_record ", "project_record"],
        missingData: [" missing_date ", "missing_date"],
        permissionDenials: [" private_field ", "private_field"],
      })),
    });

    const result = await run(deps, {
      arguments: {
        query: `Bearer ${CAPABILITY} select * from private_table`,
      },
    });
    const persisted = JSON.stringify([
      vi.mocked(deps.repository.claimBrokerCall).mock.calls,
      vi.mocked(deps.repository.completeBrokerCall).mock.calls,
    ]);

    expect(result).toMatchObject({
      status: "ok",
      evidenceRefs: ["project:1"],
      sourceLabels: ["project_record"],
      missingData: ["missing_date"],
      permissionDenials: ["private_field"],
      truncated: false,
      invocationId: INVOCATION_ID,
      toolCallId: "gateway-call-1",
      toolName: "xingyao_search_projects",
    });
    expect(result.updatedAt).toBeTruthy();
    expect(result.observedAt).toBe(NOW.toISOString());
    expect(JSON.stringify(result)).not.toContain("signed.actor.jws");
    expect(JSON.stringify(result)).not.toContain("do-not-persist");
    expect(persisted).not.toContain(CAPABILITY);
    expect(persisted).not.toContain("signed.actor.jws");
    expect(persisted).not.toContain("private_table");
    expect(persisted.toLowerCase()).not.toContain("select *");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

function run(
  deps: HermesToolBrokerDependencies,
  overrides: Partial<ReturnType<typeof request>> = {},
) {
  return executeHermesToolBrokerCall({
    capabilityToken: CAPABILITY,
    request: { ...request(), ...overrides },
    dependencies: deps,
    now: NOW,
  });
}

function request(): HermesToolBrokerRequest {
  return {
    invocationId: INVOCATION_ID,
    toolCallId: "gateway-call-1",
    toolName: "xingyao_search_projects" as const,
    arguments: {},
  };
}

function actor(
  overrides: Partial<HermesActorProfile> = {},
): HermesActorProfile {
  const enabledSkillVersions = overrides.enabledSkillVersions ?? [];
  return {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    role: "owner",
    conversationId: CONVERSATION_ID,
    invocationId: INVOCATION_ID,
    allowedReadScopes: ["projects.search"],
    enabledSkillVersions,
    skillGrantsHash: computeHermesSkillGrantsHash(enabledSkillVersions),
    profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
    pageContext: { pageType: "projects", objectIds: [] },
    ...overrides,
  };
}

function fingerprint(value: HermesActorProfile): string {
  return createHermesActorFingerprint(value);
}

function brokerCapability(
  overrides: Partial<HermesBrokerCapability> = {},
): HermesBrokerCapability {
  const snapshot = actor();
  return {
    actor: snapshot,
    actorFingerprint: fingerprint(snapshot),
    turnId: TURN_ID,
    invocationId: INVOCATION_ID,
    rootInvocationId: ROOT_INVOCATION_ID,
    allowedTools: ["xingyao_search_projects"],
    scopes: ["projects.search"],
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<HermesToolBrokerDependencies> = {},
): HermesToolBrokerDependencies {
  const capability = brokerCapability();
  const repository = {
    claimBrokerCall: vi.fn(async () => ({
      brokerCallId: BROKER_CALL_ID,
      status: "claimed" as const,
      execute: true,
      reused: false,
      fencingToken: 1,
      sanitizedResponseEnvelope: null,
    })),
    completeBrokerCall: vi.fn(async () => ({
      brokerCallId: BROKER_CALL_ID,
      status: "completed" as const,
      reused: false,
      fencingToken: 1,
      messageId: "99999999-9999-4999-8999-999999999999",
      sequence: 3,
    })),
  };
  return {
    repository,
    loadCapability: vi.fn(async () => capability),
    reauthorizeActor: vi.fn(async () => ({
      actor: capability.actor,
      actorFingerprint: capability.actorFingerprint,
    })),
    executeRead: vi.fn(async () => readSuccess()),
    ...overrides,
  };
}

function readSuccess() {
  return {
    status: "ok" as const,
    data: { rows: [{ id: "project-1", name: "Visible" }] },
    evidenceRefs: ["project:project-1"],
    sourceLabels: ["project_record"],
    updatedAt: "2026-07-21T23:59:00.000Z",
    missingData: [],
    permissionDenials: [],
    truncated: false,
    toolInvocationId: INVOCATION_ID,
    traceId: "trace-read",
  };
}

function brokerEnvelope() {
  return {
    status: "ok" as const,
    data: { rows: [] },
    evidenceRefs: [],
    sourceLabels: [],
    updatedAt: "2026-07-21T23:59:00.000Z",
    observedAt: NOW.toISOString(),
    missingData: [],
    permissionDenials: [],
    truncated: false,
    invocationId: INVOCATION_ID,
    toolCallId: "gateway-call-1",
    toolName: "xingyao_search_projects" as const,
    traceId: "trace-read",
  };
}
