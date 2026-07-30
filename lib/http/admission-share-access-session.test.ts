import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import {
  admissionShareAccessCookieName,
  readAdmissionShareAccessSession,
  setAdmissionShareAccessSession,
} from "./admission-share-access-session";

describe("admission share access session cookie", () => {
  it("stores an opaque token in a token-scoped HttpOnly cookie", () => {
    const response = NextResponse.json({ authenticated: true });

    setAdmissionShareAccessSession(response, {
      token: "plain-token",
      sessionToken: "opaque-session-token",
      expiresAt: "2026-08-05T10:00:00.000Z",
      now: "2026-07-29T10:00:00.000Z",
      secure: true,
    });

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("opaque-session-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/api/public/admission-share/plain-token");
    expect(cookie).not.toContain("246810");
  });

  it("reads only the cookie scoped to the current share token", () => {
    const cookieName = admissionShareAccessCookieName("plain-token");
    const request = new NextRequest("https://example.com/api", {
      headers: { cookie: `${cookieName}=opaque-session-token` },
    });

    expect(readAdmissionShareAccessSession(request, "plain-token")).toBe(
      "opaque-session-token",
    );
    expect(readAdmissionShareAccessSession(request, "other-token")).toBeNull();
  });
});
