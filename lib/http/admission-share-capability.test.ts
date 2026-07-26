import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  signAdmissionShareCapability,
  verifyAdmissionShareCapability,
} from "./admission-share-capability";

const verifier = {
  boardId: "share-1",
  tokenHash: "a".repeat(64),
  accessCodeHash: "b".repeat(64),
};
const capabilitySecret = "s".repeat(64);

describe("admission share access capability", () => {
  it("signs a capability bound to the board, token hash, verifier, and one-hour expiry", () => {
    const capability = signAdmissionShareCapability({
      ...verifier,
      boardExpiresAt: "2026-06-07T03:00:00.000Z",
      now: "2026-06-07T01:00:00.000Z",
      secret: capabilitySecret,
    });

    expect(capability.expiresAt).toBe("2026-06-07T02:00:00.000Z");
    expect(
      verifyAdmissionShareCapability({
        ...verifier,
        capability: capability.value,
        now: "2026-06-07T01:30:00.000Z",
        secret: capabilitySecret,
      }),
    ).toBe(true);
    expect(capability.value).not.toContain("2468");
  });

  it("caps capability expiry at the board expiry", () => {
    const capability = signAdmissionShareCapability({
      ...verifier,
      boardExpiresAt: "2026-06-07T01:20:00.000Z",
      now: "2026-06-07T01:00:00.000Z",
      secret: capabilitySecret,
    });

    expect(capability.expiresAt).toBe("2026-06-07T01:20:00.000Z");
  });

  it("rejects expiry or binding/signature changes", () => {
    const capability = signAdmissionShareCapability({
      ...verifier,
      boardExpiresAt: "2026-06-07T03:00:00.000Z",
      now: "2026-06-07T01:00:00.000Z",
      secret: capabilitySecret,
    }).value;

    expect(
      verifyAdmissionShareCapability({
        ...verifier,
        capability,
        now: "2026-06-07T02:00:00.001Z",
        secret: capabilitySecret,
      }),
    ).toBe(false);
    expect(
      verifyAdmissionShareCapability({
        ...verifier,
        boardId: "share-2",
        capability,
        now: "2026-06-07T01:30:00.000Z",
        secret: capabilitySecret,
      }),
    ).toBe(false);
    expect(
      verifyAdmissionShareCapability({
        ...verifier,
        accessCodeHash: "c".repeat(64),
        capability,
        now: "2026-06-07T01:30:00.000Z",
        secret: capabilitySecret,
      }),
    ).toBe(false);
  });

  it("does not expose a legacy verifier or its digest in the capability payload", () => {
    const legacyAccessCodeHash = createHash("sha256")
      .update("2468")
      .digest("hex");
    const capability = signAdmissionShareCapability({
      ...verifier,
      accessCodeHash: legacyAccessCodeHash,
      boardExpiresAt: "2026-06-07T03:00:00.000Z",
      now: "2026-06-07T01:00:00.000Z",
      secret: capabilitySecret,
    }).value;
    const [encodedPayload] = capability.split(".");
    const decodedPayload = Buffer.from(encodedPayload!, "base64url").toString(
      "utf8",
    );

    expect(JSON.parse(decodedPayload)).toEqual({
      version: 1,
      boardId: verifier.boardId,
      tokenHash: verifier.tokenHash,
      expiresAt: Date.parse("2026-06-07T02:00:00.000Z"),
    });
    expect(decodedPayload).not.toContain(legacyAccessCodeHash);
    expect(decodedPayload).not.toContain(
      createHash("sha256").update(legacyAccessCodeHash).digest("hex"),
    );
  });

  it("fails closed when the independent server secret is missing", () => {
    expect(() =>
      signAdmissionShareCapability({
        ...verifier,
        boardExpiresAt: "2026-06-07T03:00:00.000Z",
        now: "2026-06-07T01:00:00.000Z",
        secret: "",
      }),
    ).toThrow("Admission share capability secret is not configured");

    expect(
      verifyAdmissionShareCapability({
        ...verifier,
        capability: "payload.signature",
        now: "2026-06-07T01:30:00.000Z",
        secret: "",
      }),
    ).toBe(false);
  });
});
