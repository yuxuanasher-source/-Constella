import { NextResponse } from "next/server";

import { statusForServiceError } from "@/lib/http/route-error-status";

/**
 * Error carrying an explicit HTTP status code, thrown from route helpers and
 * service code and mapped to a response by {@link jsonError}. Shared by every
 * feature so the status semantics stay identical across routes.
 */
export class RouteError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function requiredString(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = optionalString(body, key);
  if (!value) {
    throw new RouteError(`${key} is required`, 400);
  }

  return value;
}

export function optionalNumber(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function requiredNumber(
  body: Record<string, unknown>,
  key: string,
): number {
  const value = optionalNumber(body, key);
  if (value === undefined) {
    throw new RouteError(`${key} is required`, 400);
  }

  return value;
}

export function optionalBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}

export function requiredQueryParam(url: string, key: string): string {
  const value = new URL(url).searchParams.get(key)?.trim();
  if (!value) {
    throw new RouteError(`${key} is required`, 400);
  }

  return value;
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof RouteError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
    );
  }

  if (error instanceof Error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusForServiceError(error) },
    );
  }

  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}
