import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  DuplicateKnowledgeShareRequestError,
  InvalidKnowledgeShareInputError,
  KnowledgeShareCreationError,
  canManageKnowledgeShares,
  createKnowledgeShare,
  createKnowledgeShareRepository,
  getPublicKnowledgeShare,
  revokeKnowledgeShare,
  type KnowledgeShareRepository,
} from "./knowledge-share";

const NOW = new Date("2026-07-31T12:00:00.000Z");
const SHARE_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function repository(
  overrides: Partial<KnowledgeShareRepository> = {},
): KnowledgeShareRepository {
  return {
    insertPending: vi.fn().mockResolvedValue(undefined),
    markActive: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(undefined),
    findPublicActive: vi.fn().mockResolvedValue(null),
    listActive: vi.fn().mockResolvedValue([]),
    revoke: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("knowledge share lifecycle", () => {
  it("returns one 32-byte base64url token and stores only its SHA-256 hash", async () => {
    const repo = repository();
    const putSnapshot = vi.fn().mockResolvedValue(undefined);
    const tokenBytes = Buffer.alloc(32, 7);
    const expectedToken = tokenBytes.toString("base64url");
    const expectedHash = createHash("sha256")
      .update(expectedToken)
      .digest("hex");

    const result = await createKnowledgeShare(
      {
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        actorName: "Owner",
        title: "Weekly review",
        contentMd: "# Review",
        sourceDocumentId: "doc-1",
        requestKey: "request-1",
        expiresInDays: 7,
      },
      {
        repository: repo,
        putSnapshot,
        deleteSnapshot: vi.fn(),
        onCompensationFailure: vi.fn(),
        now: () => NOW,
        randomTokenBytes: () => tokenBytes,
        newShareId: () => SHARE_ID,
      },
    );

    expect(result).toEqual({
      id: SHARE_ID,
      token: expectedToken,
      expiresAt: "2026-08-07T12:00:00.000Z",
    });
    expect(repo.insertPending).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SHARE_ID,
        organizationId: ORG_ID,
        tokenHash: expectedHash,
        cosKey: `knowledge-base-share/${SHARE_ID}.json`,
        expiresAt: "2026-08-07T12:00:00.000Z",
      }),
    );
    const persisted = JSON.stringify(
      vi.mocked(repo.insertPending).mock.calls,
    );
    const snapshot = JSON.stringify(putSnapshot.mock.calls);
    expect(persisted).not.toContain(expectedToken);
    expect(snapshot).not.toContain(expectedToken);
    expect(snapshot).not.toContain(expectedHash);
    expect(putSnapshot).toHaveBeenCalledWith(
      `knowledge-base-share/${SHARE_ID}.json`,
      { contentMd: "# Review" },
    );
    expect(repo.markActive).toHaveBeenCalledWith({
      id: SHARE_ID,
      organizationId: ORG_ID,
    });
  });

  it("defaults to seven days and permits only 1, 7, or 30 days", async () => {
    const repo = repository();
    const deps = {
      repository: repo,
      putSnapshot: vi.fn().mockResolvedValue(undefined),
      deleteSnapshot: vi.fn(),
      onCompensationFailure: vi.fn(),
      now: () => NOW,
      randomTokenBytes: () => Buffer.alloc(32, 1),
      newShareId: () => SHARE_ID,
    };

    await createKnowledgeShare(
      {
        organizationId: ORG_ID,
        actorUserId: USER_ID,
        title: "Review",
        contentMd: "content",
        sourceDocumentId: "doc-1",
        requestKey: "request-default",
      },
      deps,
    );
    expect(repo.insertPending).toHaveBeenLastCalledWith(
      expect.objectContaining({ expiresAt: "2026-08-07T12:00:00.000Z" }),
    );

    for (const expiresInDays of [0, 2, 31] as const) {
      await expect(
        createKnowledgeShare(
          {
            organizationId: ORG_ID,
            actorUserId: USER_ID,
            title: "Review",
            contentMd: "content",
            sourceDocumentId: "doc-1",
            requestKey: `request-${expiresInDays}`,
            expiresInDays,
          },
          deps,
        ),
      ).rejects.toBeInstanceOf(InvalidKnowledgeShareInputError);
    }
  });

  it("marks metadata failed and cleans the shareId key when upload fails", async () => {
    const repo = repository();
    const deleteSnapshot = vi.fn().mockResolvedValue(undefined);

    await expect(
      createKnowledgeShare(
        {
          organizationId: ORG_ID,
          actorUserId: USER_ID,
          title: "Review",
          contentMd: "content",
          sourceDocumentId: "doc-1",
          requestKey: "request-upload-fail",
        },
        {
          repository: repo,
          putSnapshot: vi.fn().mockRejectedValue(new Error("COS secret")),
          deleteSnapshot,
          onCompensationFailure: vi.fn(),
          now: () => NOW,
          randomTokenBytes: () => Buffer.alloc(32, 2),
          newShareId: () => SHARE_ID,
        },
      ),
    ).rejects.toThrow("Knowledge share creation failed");

    expect(repo.markFailed).toHaveBeenCalledWith({
      id: SHARE_ID,
      organizationId: ORG_ID,
    });
    expect(deleteSnapshot).toHaveBeenCalledWith(
      `knowledge-base-share/${SHARE_ID}.json`,
    );
    expect(repo.markActive).not.toHaveBeenCalled();
  });

  it("makes an ambiguously committed activation inaccessible and cleans COS", async () => {
    const repo = repository({
      markActive: vi.fn().mockRejectedValue(new Error("response lost")),
    });
    const deleteSnapshot = vi.fn().mockResolvedValue(undefined);

    await expect(
      createKnowledgeShare(
        {
          organizationId: ORG_ID,
          actorUserId: USER_ID,
          title: "Review",
          contentMd: "content",
          sourceDocumentId: "doc-1",
          requestKey: "request-activation-ambiguous",
        },
        {
          repository: repo,
          putSnapshot: vi.fn().mockResolvedValue(undefined),
          deleteSnapshot,
          onCompensationFailure: vi.fn(),
          now: () => NOW,
          randomTokenBytes: () => Buffer.alloc(32, 3),
          newShareId: () => SHARE_ID,
        },
      ),
    ).rejects.toThrow("Knowledge share creation failed");

    expect(repo.markFailed).toHaveBeenCalledWith({
      id: SHARE_ID,
      organizationId: ORG_ID,
    });
    expect(deleteSnapshot).toHaveBeenCalledWith(
      `knowledge-base-share/${SHARE_ID}.json`,
    );
  });

  it("reports both metadata and COS compensation failures without sensitive data", async () => {
    const repo = repository({
      markFailed: vi.fn().mockRejectedValue(new Error("database secret")),
    });
    const onCompensationFailure = vi.fn();
    const tokenBytes = Buffer.alloc(32, 4);

    await expect(
      createKnowledgeShare(
        {
          organizationId: ORG_ID,
          actorUserId: USER_ID,
          title: "Review",
          contentMd: "highly-sensitive-content",
          sourceDocumentId: "doc-1",
          requestKey: "request-compensation-fail",
        },
        {
          repository: repo,
          putSnapshot: vi.fn().mockRejectedValue(new Error("upload secret")),
          deleteSnapshot: vi.fn().mockRejectedValue(new Error("COS secret")),
          now: () => NOW,
          randomTokenBytes: () => tokenBytes,
          newShareId: () => SHARE_ID,
          onCompensationFailure,
        } as Parameters<typeof createKnowledgeShare>[1],
      ),
    ).rejects.toBeInstanceOf(KnowledgeShareCreationError);

    expect(onCompensationFailure).toHaveBeenCalledWith({
      shareId: SHARE_ID,
      failedStages: ["mark_failed", "delete_snapshot"],
    });
    const observed = JSON.stringify(onCompensationFailure.mock.calls);
    expect(observed).not.toContain(tokenBytes.toString("base64url"));
    expect(observed).not.toContain("highly-sensitive-content");
    expect(observed).not.toContain("secret");
  });

  it("keeps the sanitized creation failure when the compensation observer fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      createKnowledgeShare(
        {
          organizationId: ORG_ID,
          actorUserId: USER_ID,
          title: "Review",
          contentMd: "private-content",
          requestKey: "request-observer-fail",
        },
        {
          repository: repository({
            markFailed: vi.fn().mockRejectedValue(new Error("database secret")),
          }),
          putSnapshot: vi.fn().mockRejectedValue(new Error("upload secret")),
          deleteSnapshot: vi.fn().mockRejectedValue(new Error("COS secret")),
          now: () => NOW,
          randomTokenBytes: () => Buffer.alloc(32, 5),
          newShareId: () => SHARE_ID,
          onCompensationFailure: vi
            .fn()
            .mockRejectedValue(new Error("observer secret")),
        },
      ),
    ).rejects.toBeInstanceOf(KnowledgeShareCreationError);

    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain(SHARE_ID);
    expect(logged).toContain("mark_failed");
    expect(logged).toContain("delete_snapshot");
    expect(logged).not.toContain("private-content");
    expect(logged).not.toContain("secret");
    consoleError.mockRestore();
  });

  it("resolves duplicate retries by the exact organization actor and request key", async () => {
    const uniqueError = { code: "23505", message: "duplicate key" };
    const lookup = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    lookup.select.mockReturnValue(lookup);
    lookup.eq.mockReturnValue(lookup);
    lookup.maybeSingle.mockResolvedValue({
      data: {
        id: SHARE_ID,
        status: "active",
        revoked_at: null,
        expires_at: "2999-01-01T00:00:00.000Z",
      },
      error: null,
    });
    const client = {
      from: vi
        .fn()
        .mockReturnValueOnce({
          insert: vi.fn().mockResolvedValue({ error: uniqueError }),
        })
        .mockReturnValueOnce(lookup),
    };
    const repo = createKnowledgeShareRepository(client as never);

    await expect(
      repo.insertPending(pendingShareInput()),
    ).rejects.toMatchObject({
      name: "DuplicateKnowledgeShareRequestError",
      existingShareId: SHARE_ID,
      shareStatus: "active",
    });
    expect(lookup.eq).toHaveBeenNthCalledWith(1, "organization_id", ORG_ID);
    expect(lookup.eq).toHaveBeenNthCalledWith(2, "created_by", USER_ID);
    expect(lookup.eq).toHaveBeenNthCalledWith(
      3,
      "request_key",
      "request-duplicate",
    );
  });

  it.each([
    ["active", { status: "active", revoked_at: null, expires_at: "2999-01-01T00:00:00.000Z" }],
    ["pending", { status: "pending", revoked_at: null, expires_at: "2999-01-01T00:00:00.000Z" }],
    ["failed", { status: "failed", revoked_at: null, expires_at: "2999-01-01T00:00:00.000Z" }],
    ["revoked", { status: "active", revoked_at: "2026-07-31T12:00:00.000Z", expires_at: "2000-01-01T00:00:00.000Z" }],
    ["expired", { status: "active", revoked_at: null, expires_at: "2000-01-01T00:00:00.000Z" }],
  ] as const)(
    "classifies duplicate request metadata as %s using safe fields only",
    async (shareStatus, metadata) => {
      const uniqueError = { code: "23505", message: "duplicate key" };
      const lookup = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(),
      };
      lookup.select.mockReturnValue(lookup);
      lookup.eq.mockReturnValue(lookup);
      lookup.maybeSingle.mockResolvedValue({
        data: { id: SHARE_ID, ...metadata },
        error: null,
      });
      const client = {
        from: vi
          .fn()
          .mockReturnValueOnce({
            insert: vi.fn().mockResolvedValue({ error: uniqueError }),
          })
          .mockReturnValueOnce(lookup),
      };
      const repo = createKnowledgeShareRepository(client as never);

      await expect(repo.insertPending(pendingShareInput())).rejects.toMatchObject({
        name: "DuplicateKnowledgeShareRequestError",
        existingShareId: SHARE_ID,
        shareStatus,
      });
      expect(lookup.select).toHaveBeenCalledWith(
        "id, status, revoked_at, expires_at",
      );
    },
  );

  it("does not classify an unrelated unique violation as an idempotent retry", async () => {
    const uniqueError = { code: "23505", message: "token hash collision" };
    const lookup = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    lookup.select.mockReturnValue(lookup);
    lookup.eq.mockReturnValue(lookup);
    lookup.maybeSingle.mockResolvedValue({ data: null, error: null });
    const client = {
      from: vi
        .fn()
        .mockReturnValueOnce({
          insert: vi.fn().mockResolvedValue({ error: uniqueError }),
        })
        .mockReturnValueOnce(lookup),
    };
    const repo = createKnowledgeShareRepository(client as never);

    await expect(repo.insertPending(pendingShareInput())).rejects.toBe(
      uniqueError,
    );
    await expect(
      Promise.reject(uniqueError),
    ).rejects.not.toBeInstanceOf(DuplicateKnowledgeShareRequestError);
  });

  it("marks pending or ambiguously active metadata failed during compensation", async () => {
    const builder = {
      update: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
    };
    builder.update.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.in.mockResolvedValue({ error: null });
    const client = { from: vi.fn(() => builder) };
    const repo = createKnowledgeShareRepository(client as never);

    await repo.markFailed({ id: SHARE_ID, organizationId: ORG_ID });

    expect(builder.in).toHaveBeenCalledWith("status", ["pending", "active"]);
  });

  it("hashes a valid public token and only follows repository-approved COS keys", async () => {
    const token = Buffer.alloc(32, 9).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const repo = repository({
      findPublicActive: vi.fn().mockResolvedValue({
        title: "Review",
        cosKey: `knowledge-base-share/${SHARE_ID}.json`,
        createdByName: "Owner",
        createdAt: NOW.toISOString(),
        expiresAt: "2026-08-07T12:00:00.000Z",
      }),
    });
    const getSnapshot = vi.fn().mockResolvedValue({
      title: "Tampered snapshot title",
      contentMd: "# Read only",
      sharedBy: "Tampered snapshot actor",
      createdAt: "1999-01-01T00:00:00.000Z",
    });

    const result = await getPublicKnowledgeShare(token, {
      repository: repo,
      getSnapshot,
      now: () => NOW,
    });

    expect(repo.findPublicActive).toHaveBeenCalledWith({
      tokenHash,
      now: NOW.toISOString(),
    });
    expect(getSnapshot).toHaveBeenCalledWith(
      `knowledge-base-share/${SHARE_ID}.json`,
    );
    expect(result).toMatchObject({
      title: "Review",
      contentMd: "# Read only",
      sharedBy: "Owner",
      createdAt: NOW.toISOString(),
    });
  });

  it("rejects malformed public tokens before any database or COS access", async () => {
    const repo = repository();
    const getSnapshot = vi.fn();

    await expect(
      getPublicKnowledgeShare("not-a-real-token", {
        repository: repo,
        getSnapshot,
        now: () => NOW,
      }),
    ).resolves.toBeNull();
    expect(repo.findPublicActive).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("revokes in the database before best-effort COS cleanup and stays revoked on cleanup failure", async () => {
    const order: string[] = [];
    const repo = repository({
      revoke: vi.fn(async () => {
        order.push("db");
        return {
          id: SHARE_ID,
          cosKey: `knowledge-base-share/${SHARE_ID}.json`,
          newlyRevoked: true,
        };
      }),
    });
    const onCleanupFailure = vi.fn();

    const result = await revokeKnowledgeShare(
      {
        id: SHARE_ID,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      },
      {
        repository: repo,
        deleteSnapshot: vi.fn(async () => {
          order.push("cos");
          throw new Error("secret bucket path");
        }),
        now: () => NOW,
        onCleanupFailure,
      },
    );

    expect(order).toEqual(["db", "cos"]);
    expect(result).toEqual({
      id: SHARE_ID,
      cleanupPending: true,
      newlyRevoked: true,
    });
    expect(onCleanupFailure).toHaveBeenCalledWith({ shareId: SHARE_ID });
    expect(JSON.stringify(onCleanupFailure.mock.calls)).not.toContain("secret");
  });

  it("authorizes only operational knowledge-share managers", () => {
    expect(canManageKnowledgeShares("owner")).toBe(true);
    expect(canManageKnowledgeShares("ops_manager")).toBe(true);
    expect(canManageKnowledgeShares("operator_business")).toBe(true);
    expect(canManageKnowledgeShares("finance")).toBe(false);
    expect(canManageKnowledgeShares("streamer")).toBe(false);
  });
});

function pendingShareInput() {
  return {
    id: SHARE_ID,
    organizationId: ORG_ID,
    tokenHash: "a".repeat(64),
    title: "Review",
    sourceDocumentId: "doc-1",
    cosKey: `knowledge-base-share/${SHARE_ID}.json`,
    requestKey: "request-duplicate",
    createdBy: USER_ID,
    createdByName: "Owner",
    expiresAt: "2026-08-07T12:00:00.000Z",
  };
}
