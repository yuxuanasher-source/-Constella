import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  InvalidKnowledgeShareInputError,
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
        return { id: SHARE_ID, cosKey: `knowledge-base-share/${SHARE_ID}.json` };
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
    expect(result).toEqual({ id: SHARE_ID, cleanupPending: true });
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
