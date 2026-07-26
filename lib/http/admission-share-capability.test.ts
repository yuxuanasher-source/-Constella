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

describe("admission share access capability", () => {
  it("signs a capability bound to the board, token hash, verifier, and one-hour expiry", () => {
    const capability = signAdmissionShareCapability({
      ...verifier,
      boardExpiresAt: "2026-06-07T03:00:00.000Z",
      now: "2026-06-07T01:00:00.000Z",
    });

    expect(capability.expiresAt).toBe("2026-06-07T02:00:00.000Z");
    expect(
      verifyAdmissionShareCapability({
        ...verifier,
        capability: capability.value,
        now: "2026-06-07T01:30:00.000Z",
      }),
    ).toBe(true);
    expect(capability.value).not.toContain("2468");
  });

  it("caps capability expiry at the board expiry", () => {
    const capability = signAdmissionShareCapability({
      ...verifier,
      boardExpiresAt: "2026-06-07T01:20:00.000Z",
      now: "2026-06-07T01:00:00.000Z",
    });

    expect(capability.expiresAt).toBe("2026-06-07T01:20:00.000Z");
  });

  it("rejects expiry or binding/signature changes", () => {
    const capability = signAdmissionShareCapability({
      ...verifier,
      boardExpiresAt: "2026-06-07T03:00:00.000Z",
      now: "2026-06-07T01:00:00.000Z",
    }).value;

    expect(
      verifyAdmissionShareCapability({
        ...verifier,
        capability,
        now: "2026-06-07T02:00:00.001Z",
      }),
    ).toBe(false);
    expect(
      verifyAdmissionShareCapability({
        ...verifier,
        boardId: "share-2",
        capability,
        now: "2026-06-07T01:30:00.000Z",
      }),
    ).toBe(false);
    expect(
      verifyAdmissionShareCapability({
        ...verifier,
        accessCodeHash: "c".repeat(64),
        capability,
        now: "2026-06-07T01:30:00.000Z",
      }),
    ).toBe(false);
  });
});
