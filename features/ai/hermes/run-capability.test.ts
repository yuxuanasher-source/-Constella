import { createHash } from "node:crypto";
import { inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { createHermesActorFingerprint } from "./actor-fingerprint";
import { HERMES_PROFILE_VERSION, type HermesActorProfile } from "./contracts";
import { HermesStateRepositoryError } from "./hermes-state-repository";
import { HermesLiveActorAuthorizationError } from "./live-actor-authorization";
import {
  deriveHermesChildRunCapability,
  issueHermesRootRunCapability,
  parseHermesCapabilityDerivationRequest,
  revealHermesCapabilityToken,
  type HermesCapabilityDerivationDependencies,
  type HermesCapabilityDerivationRequest,
  type HermesParentRunCapability,
} from "./run-capability";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const TURN_ID = "44444444-4444-4444-8444-444444444444";
const ROOT_INVOCATION_ID = "55555555-5555-4555-8555-555555555555";
const CHILD_INVOCATION_ID = "66666666-6666-4666-8666-666666666666";
const CAPABILITY_ID = "77777777-7777-4777-8777-777777777777";
const SKILL_DRAFT_ID = "88888888-8888-4888-8888-888888888888";
const NOW = new Date("2026-07-22T00:00:00.000Z");

describe("Hermes run capabilities", () => {
  it("issues random 32-byte base64url roots while persisting only SHA-256", async () => {
    const issueRunCapability = vi.fn(async (...args: unknown[]) => ({
      capabilityId: CAPABILITY_ID,
      expiresAt: (args[3] as Date).toISOString(),
    }));
    const actor = profile();
    const common = {
      repository: { issueRunCapability },
      actor,
      actorFingerprint: createHermesActorFingerprint(actor),
      turn: { id: TURN_ID, conversationId: CONVERSATION_ID },
      mode: "fast" as const,
      serverAllowedTools: ["xingyao_search_projects"],
      approvedSkillDraftIds: [SKILL_DRAFT_ID],
      aiStateWritesAllowed: true,
      assertionExpiresAt: new Date("2026-07-22T00:05:00.000Z"),
      runDeadline: new Date("2026-07-22T00:03:00.000Z"),
      now: NOW,
    };

    const first = await issueHermesRootRunCapability(common);
    const second = await issueHermesRootRunCapability(common);
    const firstToken = revealHermesCapabilityToken(first.capability);
    const secondToken = revealHermesCapabilityToken(second.capability);

    expect(firstToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(firstToken, "base64url")).toHaveLength(32);
    expect(secondToken).not.toBe(firstToken);
    expect(issueRunCapability).toHaveBeenNthCalledWith(
      1,
      {
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        invocationId: ROOT_INVOCATION_ID,
        actorFingerprint: createHermesActorFingerprint(actor),
      },
      { id: TURN_ID, conversationId: CONVERSATION_ID },
      expect.objectContaining({
        tokenSha256: sha256(firstToken),
        allowedTools: ["xingyao_search_projects"],
        scopes: actor.allowedReadScopes,
        skillDraftIds: [SKILL_DRAFT_ID],
        depth: 0,
        aiStateWritesAllowed: true,
      }),
      new Date("2026-07-22T00:02:00.000Z"),
    );
    expect(JSON.stringify(issueRunCapability.mock.calls)).not.toContain(
      firstToken,
    );
  });

  it.each([
    ["fast", "2026-07-22T00:02:00.000Z"],
    ["deep", "2026-07-22T00:05:30.000Z"],
  ] as const)(
    "caps %s expiry at its wall clock budget plus 30 seconds",
    async (mode, expectedExpiry) => {
      const issueRunCapability = vi.fn(async (...args: unknown[]) => ({
        capabilityId: CAPABILITY_ID,
        expiresAt: (args[3] as Date).toISOString(),
      }));
      const actor = profile();

      const issued = await issueHermesRootRunCapability({
        repository: { issueRunCapability },
        actor,
        actorFingerprint: createHermesActorFingerprint(actor),
        turn: { id: TURN_ID, conversationId: CONVERSATION_ID },
        mode,
        serverAllowedTools: [],
        approvedSkillDraftIds: [],
        aiStateWritesAllowed: false,
        assertionExpiresAt: new Date("2026-07-22T00:10:00.000Z"),
        runDeadline: new Date("2026-07-22T00:10:00.000Z"),
        now: NOW,
      });

      expect(issued.expiresAt).toBe(expectedExpiry);
    },
  );

  it("never exceeds actor, assertion, or run deadlines", async () => {
    const issueRunCapability = vi.fn(async (...args: unknown[]) => ({
      capabilityId: CAPABILITY_ID,
      expiresAt: (args[3] as Date).toISOString(),
    }));
    const actor = profile();

    const issued = await issueHermesRootRunCapability({
      repository: { issueRunCapability },
      actor,
      actorFingerprint: createHermesActorFingerprint(actor),
      turn: { id: TURN_ID, conversationId: CONVERSATION_ID },
      mode: "deep",
      serverAllowedTools: [],
      approvedSkillDraftIds: [],
      aiStateWritesAllowed: false,
      actorDeadline: new Date("2026-07-22T00:04:00.000Z"),
      assertionExpiresAt: new Date("2026-07-22T00:03:00.000Z"),
      runDeadline: new Date("2026-07-22T00:02:00.000Z"),
      now: NOW,
    });

    expect(issued.expiresAt).toBe("2026-07-22T00:02:00.000Z");
  });

  it("marks secrets so string, JSON, and Node inspection stay redacted", async () => {
    const actor = profile();
    const issued = await issueHermesRootRunCapability({
      repository: {
        issueRunCapability: async (...args: unknown[]) => ({
          capabilityId: CAPABILITY_ID,
          expiresAt: (args[3] as Date).toISOString(),
        }),
      },
      actor,
      actorFingerprint: createHermesActorFingerprint(actor),
      turn: { id: TURN_ID, conversationId: CONVERSATION_ID },
      mode: "fast",
      serverAllowedTools: [],
      approvedSkillDraftIds: [],
      aiStateWritesAllowed: false,
      assertionExpiresAt: new Date("2026-07-22T00:02:00.000Z"),
      runDeadline: new Date("2026-07-22T00:02:00.000Z"),
      now: NOW,
    });
    const raw = revealHermesCapabilityToken(issued.capability);

    for (const representation of [
      String(issued.capability),
      JSON.stringify(issued.capability),
      inspect(issued.capability),
      JSON.stringify({ capability: issued.capability }),
    ]) {
      expect(representation).toContain("REDACTED");
      expect(representation).not.toContain(raw);
    }
  });

  it("parses only the exact child derivation shape", () => {
    const valid = derivationRequest();
    expect(parseHermesCapabilityDerivationRequest(valid)).toEqual(valid);
    expect(
      parseHermesCapabilityDerivationRequest({
        ...valid,
        childInvocationId: CHILD_INVOCATION_ID,
      }),
    ).toEqual({ ...valid, childInvocationId: CHILD_INVOCATION_ID });

    for (const forbiddenKey of [
      "organizationId",
      "userId",
      "ownerUserId",
      "role",
      "scopes",
      "skills",
      "model",
      "provider",
      "tools",
      "allowedTools",
      "parentCapabilityToken",
      "unknownField",
    ]) {
      expect(
        parseHermesCapabilityDerivationRequest({
          ...valid,
          [forbiddenKey]: "client-controlled",
        }),
      ).toBeNull();
    }

    expect(
      parseHermesCapabilityDerivationRequest({
        ...valid,
        requestedToolNames: [
          "xingyao_search_projects",
          "xingyao_search_projects",
        ],
      }),
    ).toBeNull();
    expect(
      parseHermesCapabilityDerivationRequest({
        ...valid,
        requestedScopes: ["not.a.scope"],
      }),
    ).toBeNull();
  });

  it("derives a child with inherited identity and reduced authority", async () => {
    const parent = parentCapability({ mode: "deep" });
    const dependencies = derivationDependencies(parent, 0);

    const issued = await deriveHermesChildRunCapability({
      parentCapabilityToken: "p".repeat(43),
      request: {
        ...derivationRequest(),
        childInvocationId: CHILD_INVOCATION_ID,
      },
      dependencies,
      now: NOW,
    });

    expect(issued.childInvocationId).toBe(CHILD_INVOCATION_ID);
    expect(dependencies.countActiveChildren).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      turnId: TURN_ID,
      rootInvocationId: ROOT_INVOCATION_ID,
      now: NOW,
    });
    expect(dependencies.createChildInvocation).toHaveBeenCalledWith({
      actor: parent.actor,
      childInvocationId: CHILD_INVOCATION_ID,
      parentInvocationId: ROOT_INVOCATION_ID,
      rootInvocationId: ROOT_INVOCATION_ID,
      mode: "deep",
      depth: 1,
    });
    expect(dependencies.repository.issueRunCapability).toHaveBeenCalledWith(
      {
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        invocationId: CHILD_INVOCATION_ID,
        actorFingerprint: parent.actorFingerprint,
      },
      { id: TURN_ID, conversationId: CONVERSATION_ID },
      {
        tokenSha256: sha256(revealHermesCapabilityToken(issued.capability)),
        allowedTools: ["xingyao_search_projects"],
        scopes: ["projects.search"],
        skillDraftIds: [SKILL_DRAFT_ID],
        depth: 1,
        aiStateWritesAllowed: false,
        parentCapability: {
          invocationId: ROOT_INVOCATION_ID,
          tokenSha256: sha256("p".repeat(43)),
        },
      },
      new Date(parent.expiresAt),
    );
    expect(JSON.stringify(mockCalls(dependencies))).not.toContain(
      "p".repeat(43),
    );
  });

  it.each([
    ["parallel_limit", "parallel_limit"],
    ["state_conflict", "persistence_failed"],
  ] as const)(
    "maps repository %s after best-effort child cleanup to %s",
    async (repositoryCode, expectedCode) => {
      const parent = parentCapability({ mode: "deep" });
      const dependencies = derivationDependencies(parent, 0);
      const markChildInvocationFailed = vi.fn(async () => {
        throw new Error("cleanup unavailable");
      });
      dependencies.markChildInvocationFailed = markChildInvocationFailed;
      dependencies.repository.issueRunCapability.mockRejectedValue(
        new HermesStateRepositoryError(repositoryCode),
      );

      await expect(
        deriveHermesChildRunCapability({
          parentCapabilityToken: "p".repeat(43),
          request: {
            ...derivationRequest(),
            childInvocationId: CHILD_INVOCATION_ID,
          },
          dependencies,
          now: NOW,
        }),
      ).rejects.toMatchObject({ code: expectedCode });
      expect(dependencies.createChildInvocation).toHaveBeenCalledOnce();
      expect(markChildInvocationFailed).toHaveBeenCalledWith({
        actor: parent.actor,
        childInvocationId: CHILD_INVOCATION_ID,
      });
    },
  );

  it.each([
    ["membership_query_failed", "persistence_failed"],
    ["membership_inactive", "actor_changed"],
  ] as const)(
    "maps live actor %s to %s",
    async (authorizationCode, expectedCode) => {
      const dependencies = derivationDependencies(parentCapability(), 0);
      dependencies.reauthorizeActor.mockRejectedValue(
        new HermesLiveActorAuthorizationError(authorizationCode),
      );

      await expect(
        deriveHermesChildRunCapability({
          parentCapabilityToken: "p".repeat(43),
          request: derivationRequest(),
          dependencies,
          now: NOW,
        }),
      ).rejects.toMatchObject({ code: expectedCode });
      expect(dependencies.countActiveChildren).not.toHaveBeenCalled();
      expect(dependencies.createChildInvocation).not.toHaveBeenCalled();
    },
  );

  it.each([
    "loadParentCapability",
    "countActiveChildren",
    "createChildInvocation",
  ] as const)(
    "normalizes a rejected %s persistence dependency",
    async (dependencyName) => {
      const rawMessage = `network select failed in ${dependencyName}`;
      const dependencies = derivationDependencies(parentCapability(), 0);
      dependencies[dependencyName].mockRejectedValue(new Error(rawMessage));

      const error = await deriveHermesChildRunCapability({
        parentCapabilityToken: "p".repeat(43),
        request: derivationRequest(),
        dependencies,
        now: NOW,
      }).then(
        () => null,
        (reason: unknown) => reason,
      );

      expect(error).toMatchObject({ code: "persistence_failed" });
      expect(String(error)).not.toContain(rawMessage);
    },
  );

  it.each([
    ["fast", 1, 0, "parallel_limit"],
    ["fast", 0, 1, "depth_limit"],
    ["deep", 3, 0, "parallel_limit"],
    ["deep", 0, 2, "depth_limit"],
  ] as const)(
    "%s rejects over-budget children",
    async (mode, activeChildren, parentDepth, errorCode) => {
      const dependencies = derivationDependencies(
        parentCapability({ mode, depth: parentDepth }),
        activeChildren,
      );

      await expect(
        deriveHermesChildRunCapability({
          parentCapabilityToken: "p".repeat(43),
          request: derivationRequest(),
          dependencies,
          now: NOW,
        }),
      ).rejects.toMatchObject({ code: errorCode });
      expect(dependencies.createChildInvocation).not.toHaveBeenCalled();
      expect(dependencies.repository.issueRunCapability).not.toHaveBeenCalled();
    },
  );

  it("rejects tool, scope, and actor-grant expansion before persistence", async () => {
    for (const request of [
      { ...derivationRequest(), requestedToolNames: ["unapproved_tool"] },
      { ...derivationRequest(), requestedScopes: ["settlements.summary"] },
    ] satisfies HermesCapabilityDerivationRequest[]) {
      const dependencies = derivationDependencies(parentCapability(), 0);
      await expect(
        deriveHermesChildRunCapability({
          parentCapabilityToken: "p".repeat(43),
          request,
          dependencies,
          now: NOW,
        }),
      ).rejects.toMatchObject({ code: "authority_expansion" });
      expect(dependencies.createChildInvocation).not.toHaveBeenCalled();
    }

    const changedActor = profile({ role: "finance" });
    const dependencies = derivationDependencies(parentCapability(), 0);
    dependencies.reauthorizeActor.mockResolvedValue({
      actor: changedActor,
      actorFingerprint: createHermesActorFingerprint(changedActor),
    });
    await expect(
      deriveHermesChildRunCapability({
        parentCapabilityToken: "p".repeat(43),
        request: derivationRequest(),
        dependencies,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "actor_changed" });
  });
});

function profile(patch: Partial<HermesActorProfile> = {}): HermesActorProfile {
  return {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    role: "owner",
    conversationId: CONVERSATION_ID,
    invocationId: ROOT_INVOCATION_ID,
    allowedReadScopes: ["context.read", "projects.search"],
    enabledSkillVersions: [],
    skillGrantsHash:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    profileVersion: HERMES_PROFILE_VERSION,
    pageContext: { pageType: "global", objectIds: [] },
    ...patch,
  };
}

function parentCapability(
  patch: Partial<HermesParentRunCapability> = {},
): HermesParentRunCapability {
  const actor = profile();
  return {
    actor,
    actorFingerprint: createHermesActorFingerprint(actor),
    mode: "fast",
    turnId: TURN_ID,
    invocationId: ROOT_INVOCATION_ID,
    rootInvocationId: ROOT_INVOCATION_ID,
    allowedTools: ["xingyao_search_projects"],
    scopes: ["context.read", "projects.search"],
    skillDraftIds: [SKILL_DRAFT_ID],
    depth: 0,
    expiresAt: "2026-07-22T00:02:00.000Z",
    ...patch,
  };
}

function derivationRequest() {
  return {
    parentInvocationId: ROOT_INVOCATION_ID,
    requestedToolNames: ["xingyao_search_projects"],
    requestedScopes: ["projects.search"],
  } as const;
}

function derivationDependencies(
  parent: HermesParentRunCapability,
  activeChildren: number,
): HermesCapabilityDerivationDependencies & {
  loadParentCapability: ReturnType<typeof vi.fn>;
  countActiveChildren: ReturnType<typeof vi.fn>;
  createChildInvocation: ReturnType<typeof vi.fn>;
  reauthorizeActor: ReturnType<typeof vi.fn>;
  repository: { issueRunCapability: ReturnType<typeof vi.fn> };
} {
  const issueRunCapability = vi.fn(async (...args: unknown[]) => ({
    capabilityId: CAPABILITY_ID,
    expiresAt: (args[3] as Date).toISOString(),
  }));
  return {
    repository: { issueRunCapability },
    loadParentCapability: vi.fn(async () => parent),
    countActiveChildren: vi.fn(async () => activeChildren),
    createChildInvocation: vi.fn(async () => undefined),
    reauthorizeActor: vi.fn(async () => ({
      actor: parent.actor,
      actorFingerprint: parent.actorFingerprint,
    })),
  };
}

function mockCalls(dependencies: ReturnType<typeof derivationDependencies>) {
  return {
    load: dependencies.loadParentCapability.mock.calls,
    count: dependencies.countActiveChildren.mock.calls,
    create: dependencies.createChildInvocation.mock.calls,
    issue: dependencies.repository.issueRunCapability.mock.calls,
    authorize: dependencies.reauthorizeActor.mock.calls,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
