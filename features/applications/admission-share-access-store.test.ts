import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { hashShareSecret } from "./admission-share-board";

const storePath = join(
  process.cwd(),
  "features/applications/admission-share-access-store.ts",
);
const storeImportPath = "./admission-share-access-store";

describe("SupabaseAdmissionShareAccessStore", () => {
  it("provides the access store module", () => {
    expect(existsSync(storePath)).toBe(true);
  });

  it.skipIf(!existsSync(storePath))(
    "maps the atomic access-attempt result",
    async () => {
      const { SupabaseAdmissionShareAccessStore } = await import(
        /* @vite-ignore */ storeImportPath
      );
      const rpc = vi.fn().mockResolvedValue({
        data: [{ allowed: false, retry_after_seconds: 321 }],
        error: null,
      });
      const store = new SupabaseAdmissionShareAccessStore({ rpc } as never);

      await expect(
        store.consumeAttempt({
          shareBoardId: "share-1",
          clientFingerprint: "fingerprint",
          succeeded: false,
          now: "2026-07-29T10:00:00.000Z",
        }),
      ).resolves.toEqual({
        allowed: false,
        retryAfterSeconds: 321,
      });
      expect(rpc).toHaveBeenCalledWith(
        "consume_admission_share_access_attempt",
        {
          p_share_board_id: "share-1",
          p_client_fingerprint: "fingerprint",
          p_succeeded: false,
          p_now: "2026-07-29T10:00:00.000Z",
        },
      );
    },
  );

  it.skipIf(!existsSync(storePath))(
    "persists only the opaque session token hash",
    async () => {
      const { SupabaseAdmissionShareAccessStore } = await import(
        /* @vite-ignore */ storeImportPath
      );
      const insert = vi.fn().mockResolvedValue({ error: null });
      const from = vi.fn().mockReturnValue({ insert });
      const store = new SupabaseAdmissionShareAccessStore({ from } as never);

      await store.createSession({
        shareBoardId: "share-1",
        sessionToken: "opaque-session-token",
        expiresAt: "2026-08-05T10:00:00.000Z",
      });

      expect(from).toHaveBeenCalledWith(
        "project_recording_share_access_sessions",
      );
      expect(insert).toHaveBeenCalledWith({
        share_board_id: "share-1",
        session_token_hash: hashShareSecret("opaque-session-token"),
        expires_at: "2026-08-05T10:00:00.000Z",
      });
      expect(JSON.stringify(insert.mock.calls)).not.toContain(
        "opaque-session-token",
      );
    },
  );

  it.skipIf(!existsSync(storePath))(
    "looks up an unexpired session by its token hash",
    async () => {
      const { SupabaseAdmissionShareAccessStore } = await import(
        /* @vite-ignore */ storeImportPath
      );
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        gt: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: "session-1" },
          error: null,
        }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      chain.gt.mockReturnValue(chain);
      const from = vi.fn().mockReturnValue(chain);
      const store = new SupabaseAdmissionShareAccessStore({ from } as never);

      await expect(
        store.hasValidSession({
          shareBoardId: "share-1",
          sessionToken: "opaque-session-token",
          now: "2026-07-29T10:00:00.000Z",
        }),
      ).resolves.toBe(true);

      expect(chain.eq).toHaveBeenCalledWith("share_board_id", "share-1");
      expect(chain.eq).toHaveBeenCalledWith(
        "session_token_hash",
        hashShareSecret("opaque-session-token"),
      );
      expect(chain.gt).toHaveBeenCalledWith(
        "expires_at",
        "2026-07-29T10:00:00.000Z",
      );
    },
  );
});
