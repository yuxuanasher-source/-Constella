import type { NextRequest, NextResponse } from "next/server";

import { hashShareSecret } from "@/features/applications/admission-share-board";

const COOKIE_PREFIX = "admission_share_access_";

export function admissionShareAccessCookieName(token: string) {
  return `${COOKIE_PREFIX}${hashShareSecret(token).slice(0, 20)}`;
}

export function readAdmissionShareAccessSession(
  request: NextRequest,
  token: string,
) {
  return (
    request.cookies.get(admissionShareAccessCookieName(token))?.value ?? null
  );
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
