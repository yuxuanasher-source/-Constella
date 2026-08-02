import {
  getPublicAdmissionShareBrandLogoPath,
  PublicAdmissionShareError,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { createSignedDownloadUrl } from "@/features/storage/private-upload";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { readAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";
import { normalizeAbsoluteHttpUrl } from "@/lib/http/safe-public-url";

import { publicAdmissionShareErrorResponse } from "../../public-route-utils";

const BRAND_LOGO_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const BRAND_LOGO_FETCH_TIMEOUT_MS = 5_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      throw new PublicAdmissionShareError(
        "SHARE_SERVICE_UNAVAILABLE",
        "Public share service is unavailable",
        503,
      );
    }

    const repo = new SupabaseAdmissionShareBoardRepository(supabase);
    const accessStore = new SupabaseAdmissionShareAccessStore(supabase);
    const storagePath = await getPublicAdmissionShareBrandLogoPath({
      repo,
      accessStore,
      token,
      sessionToken:
        readAdmissionShareAccessSession(request, token) ?? undefined,
    });
    if (!storagePath) {
      throw brandLogoUnavailable();
    }

    if (new URL(request.url).searchParams.get("asset") !== "1") {
      return new Response(null, {
        status: 302,
        headers: {
          "Cache-Control": "private, no-store",
          Location: `/api/public/admission-share/${encodeURIComponent(token)}/brand-logo?asset=1`,
        },
      });
    }

    let upstream: Response;
    let lifecycle: BrandLogoFetchLifecycle | null = null;
    try {
      const signed = await createSignedDownloadUrl({
        client: supabase,
        bucket: getPrivateStorageBucket(),
        path: storagePath,
        expiresInSeconds: 3600,
      });
      const signedUrl = normalizeAbsoluteHttpUrl(signed.signedUrl);
      if (!signedUrl) {
        throw brandLogoUnavailable();
      }
      lifecycle = createBrandLogoFetchLifecycle();
      try {
        upstream = await fetch(signedUrl, {
          cache: "no-store",
          redirect: "error",
          signal: lifecycle.signal,
        });
      } catch (error) {
        lifecycle.finish();
        throw error;
      }
    } catch {
      throw brandLogoUnavailable();
    }

    const contentType = normalizeBrandLogoContentType(
      upstream.headers.get("content-type"),
    );
    if (!upstream.ok || !upstream.body || !contentType) {
      lifecycle?.finish();
      await cancelUpstreamBody(upstream);
      throw brandLogoUnavailable();
    }
    const responseBody = controlledBrandLogoBody(upstream.body, lifecycle);
    return new Response(responseBody, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = publicAdmissionShareErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

type BrandLogoFetchLifecycle = {
  signal: AbortSignal;
  attachTimeoutHandler(handler: (reason: DOMException) => void): void;
  finish(): boolean;
};

function createBrandLogoFetchLifecycle(): BrandLogoFetchLifecycle {
  const abortController = new AbortController();
  const timeoutReason = new DOMException(
    "Brand logo upstream timed out",
    "TimeoutError",
  );
  let finished = false;
  let timeoutHandler: ((reason: DOMException) => void) | null = null;
  const timeout = setTimeout(() => {
    if (finished) {
      return;
    }
    abortController.abort(timeoutReason);
    timeoutHandler?.(timeoutReason);
  }, BRAND_LOGO_FETCH_TIMEOUT_MS);

  return {
    signal: abortController.signal,
    attachTimeoutHandler(handler) {
      if (finished) {
        return;
      }
      timeoutHandler = handler;
      if (abortController.signal.aborted) {
        handler(timeoutReason);
      }
    },
    finish() {
      if (finished) {
        return false;
      }
      finished = true;
      timeoutHandler = null;
      clearTimeout(timeout);
      return true;
    },
  };
}

function controlledBrandLogoBody(
  upstreamBody: ReadableStream<Uint8Array>,
  lifecycle: BrandLogoFetchLifecycle,
) {
  const reader = upstreamBody.getReader();
  let terminated = false;
  let readerReleased = false;
  let cancelPromise: Promise<void> | null = null;

  const releaseReader = () => {
    if (readerReleased) {
      return;
    }
    try {
      reader.releaseLock();
      readerReleased = true;
    } catch {
      // A pending read will release the lock when it settles.
    }
  };
  const cancelReader = (reason: unknown) => {
    cancelPromise ??= reader
      .cancel(reason)
      .catch(() => undefined)
      .finally(releaseReader);
    return cancelPromise;
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      lifecycle.attachTimeoutHandler((reason) => {
        if (terminated) {
          return;
        }
        terminated = true;
        lifecycle.finish();
        try {
          controller.error(reason);
        } catch {
          // The downstream may already have cancelled the stream.
        }
        void cancelReader(reason);
      });
    },
    async pull(controller) {
      if (terminated) {
        releaseReader();
        return;
      }
      try {
        const result = await reader.read();
        if (terminated) {
          releaseReader();
          return;
        }
        if (result.done) {
          terminated = true;
          lifecycle.finish();
          releaseReader();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        if (terminated) {
          releaseReader();
          return;
        }
        terminated = true;
        lifecycle.finish();
        try {
          controller.error(error);
        } finally {
          await cancelReader(error);
        }
      }
    },
    async cancel(reason) {
      if (!terminated) {
        terminated = true;
        lifecycle.finish();
      }
      await cancelReader(reason);
    },
  });
}

async function cancelUpstreamBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Reject the upstream safely even if its body cannot be cancelled.
  }
}

function normalizeBrandLogoContentType(value: string | null) {
  const contentType = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return BRAND_LOGO_CONTENT_TYPES.has(contentType) ? contentType : null;
}

function brandLogoUnavailable() {
  return new PublicAdmissionShareError(
    "RECORDING_SOURCE_UNAVAILABLE",
    "Brand logo source is unavailable",
    404,
  );
}
