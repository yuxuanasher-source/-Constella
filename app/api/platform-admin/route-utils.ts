import { z } from "zod";

import type { ReportingPeriod } from "@/features/platform-admin/platform-admin-contracts";

const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidUtcDateKey);

const periodSchema = z
  .object({
    start: dateKey.optional(),
    end: dateKey.optional(),
  })
  .superRefine((value, context) => {
    if ((value.start && !value.end) || (!value.start && value.end)) {
      context.addIssue({
        code: "custom",
        message: "start and end must be provided together",
      });
    }
    if (value.start && value.end && value.start > value.end) {
      context.addIssue({
        code: "custom",
        message: "start must not be after end",
      });
    }
  });

export const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const optionalText = z.string().trim().min(1).max(120).optional();

export function parsePeriod(searchParams: URLSearchParams): ReportingPeriod {
  const parsed = periodSchema.parse({
    start: optionalParam(searchParams, "start"),
    end: optionalParam(searchParams, "end"),
  });
  if (parsed.start && parsed.end) {
    return { start: parsed.start, end: parsed.end };
  }
  return currentNaturalMonth();
}

export function optionalParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  return value === null || value.trim() === "" ? undefined : value;
}

export function contextFailureResponse(status: 401 | 403 | 503) {
  const errors = {
    401: {
      code: "UNAUTHENTICATED",
      message: "Platform administrator authentication required.",
    },
    403: {
      code: "FORBIDDEN",
      message: "Platform administrator access required.",
    },
    503: {
      code: "SERVICE_UNAVAILABLE",
      message: "Platform administration service is unavailable.",
    },
  } as const;
  return Response.json({ error: errors[status] }, { status });
}

export function invalidQueryResponse() {
  return Response.json(
    {
      error: {
        code: "INVALID_QUERY",
        message: "The request query is invalid.",
      },
    },
    { status: 400 },
  );
}

export function unexpectedReadErrorResponse() {
  return Response.json(
    {
      error: {
        code: "READ_FAILED",
        message: "Unable to load platform administration data.",
      },
    },
    { status: 500 },
  );
}

function currentNaturalMonth(now = new Date()): ReportingPeriod {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function isValidUtcDateKey(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
