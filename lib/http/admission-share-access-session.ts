import type { NextResponse } from "next/server";

import { hashShareSecret } from "@/features/applications/admission-share-board";

const COOKIE_PREFIX = "admission_share_access_";

export function admissionShareAccessCookieName(token: string) {
  return `${COOKIE_PREFIX}${hashShareSecret(token).slice(0, 20)}`;
}

export function readAdmissionShareAccessSession(
  request: Request,
  token: string,
) {
  const cookieName = admissionShareAccessCookieName(token);
  const requestWithCookies = request as Request & {
    cookies?: { get(name: string): { value: string } | undefined };
  };
  const nextCookie = requestWithCookies.cookies?.get(cookieName)?.value;
  if (nextCookie) {
    return nextCookie;
  }

  const rawCookie = request.headers.get("cookie");
  if (!rawCookie) {
    return null;
  }
  for (const cookie of rawCookie.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator === -1 || cookie.slice(0, separator).trim() !== cookieName) {
      continue;
    }
    return cookie.slice(separator + 1).trim() || null;
  }
  return null;
}

export function setAdmissionShareAccessSession(
  response: NextResponse,
  input: {
    token: string;
    sessionToken: string;
    expiresAt: string;
    now?: string;
    secure?: boolean;
  },
) {
  const expires = new Date(input.expiresAt);
  if (Number.isNaN(expires.getTime())) {
    throw new Error("Admission share access session expiry is invalid");
  }

  response.cookies.set(
    admissionShareAccessCookieName(input.token),
    input.sessionToken,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: input.secure ?? process.env.NODE_ENV === "production",
      path: `/api/public/admission-share/${encodeURIComponent(input.token)}`,
      expires,
    },
  );
}
