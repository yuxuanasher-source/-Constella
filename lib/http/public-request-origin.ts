export function getPublicRequestOrigin(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): string {
  const forwardedHost = firstForwardedValue(
    request.headers.get("x-forwarded-host"),
  );
  const forwardedProto = firstForwardedValue(
    request.headers.get("x-forwarded-proto"),
  );

  if (
    forwardedHost &&
    !/[\s/\\@?#]/u.test(forwardedHost) &&
    (forwardedProto === "http" || forwardedProto === "https")
  ) {
    const forwardedOrigin = httpOrigin(
      `${forwardedProto}://${forwardedHost}`,
    );
    if (forwardedOrigin) {
      return forwardedOrigin;
    }
  }

  const configuredOrigin = httpOrigin(env.NEXT_PUBLIC_APP_URL);
  return configuredOrigin ?? new URL(request.url).origin;
}

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim().toLowerCase() || null;
}

function httpOrigin(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
