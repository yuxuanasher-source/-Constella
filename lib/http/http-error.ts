import { ValidationError } from "./parse-json-body";
import { statusForServiceError } from "./route-error-status";

export type HttpError = {
  status: number;
  message: string;
};

const controlledClientErrorPatterns = [/^Invalid upload /];

export function toHttpError(error: unknown): HttpError {
  if (error instanceof ValidationError) {
    return { status: 400, message: error.message };
  }

  if (isRouteError(error)) {
    return { status: error.statusCode, message: error.message };
  }

  if (error instanceof Error) {
    const status = statusForServiceError(error);
    if (status === 403 || isControlledClientError(error)) {
      return { status, message: error.message };
    }

    console.error("[http] Unexpected route error", error);
    return { status: 500, message: "Unexpected error" };
  }

  console.error("[http] Unexpected non-error route failure", error);
  return { status: 500, message: "Unexpected error" };
}

function isRouteError(error: unknown): error is {
  message: string;
  statusCode: number;
} {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { message?: unknown; statusCode?: unknown };
  return (
    typeof candidate.message === "string" &&
    Number.isInteger(candidate.statusCode) &&
    (candidate.statusCode as number) >= 400 &&
    (candidate.statusCode as number) <= 599
  );
}

function isControlledClientError(error: Error): boolean {
  return controlledClientErrorPatterns.some((pattern) =>
    pattern.test(error.message),
  );
}
