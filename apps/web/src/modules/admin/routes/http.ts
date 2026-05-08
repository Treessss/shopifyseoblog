import { fail, ok } from "@/lib/api";
import { isAdminApiError } from "../policies/errors";
import type { AdminRequestContextInput } from "../contracts";

export function getAdminRequestContext(request: Request): AdminRequestContextInput {
  const url = new URL(request.url);

  return {
    organizationSlug:
      getFirstValue(url, "organizationSlug") ??
      getFirstValue(url, "org") ??
      headerValue(request, "x-organization-slug") ??
      undefined,
    requestedByUserId: headerValue(request, "x-user-id") ?? undefined,
    ipAddress: clientIp(request) ?? undefined,
    userAgent: headerValue(request, "user-agent") ?? undefined
  };
}

export async function handleAdminRoute<T>(action: () => Promise<T>) {
  try {
    return ok(await action());
  } catch (error) {
    if (isAdminApiError(error)) {
      return fail(error.status, {
        code: error.code,
        message: error.message,
        details: error.details
      });
    }

    console.error("[admin-api]", error);
    return fail(500, {
      code: "ADMIN_INTERNAL_ERROR",
      message: "Admin API request failed."
    });
  }
}

function getFirstValue(url: URL, key: string) {
  const value = url.searchParams.get(key);
  return value && value.trim().length > 0 ? value.trim() : null;
}

function headerValue(request: Request, name: string) {
  const value = request.headers.get(name);
  return value && value.trim().length > 0 ? value.trim() : null;
}

function clientIp(request: Request) {
  const forwardedFor = headerValue(request, "x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || null;
  return headerValue(request, "x-real-ip");
}
