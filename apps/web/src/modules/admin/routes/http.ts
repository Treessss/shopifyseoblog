import { NextResponse } from "next/server";
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

export async function handleAdminRoute<T>(action: () => Promise<T>, request?: Request) {
  try {
    const data = await action();
    if (request && shouldRedirectForm(request)) {
      return NextResponse.redirect(formRedirectUrl(request, { saved: "1" }), { status: 303 });
    }

    return ok(data);
  } catch (error) {
    if (isAdminApiError(error)) {
      if (request && shouldRedirectForm(request)) {
        return NextResponse.redirect(
          formRedirectUrl(request, {
            error: error.message,
            code: error.code
          }),
          { status: 303 }
        );
      }

      return fail(error.status, {
        code: error.code,
        message: error.message,
        details: error.details
      });
    }

    console.error("[admin-api]", error);
    if (request && shouldRedirectForm(request)) {
      return NextResponse.redirect(
        formRedirectUrl(request, {
          error: "Admin API request failed.",
          code: "ADMIN_INTERNAL_ERROR"
        }),
        { status: 303 }
      );
    }

    return fail(500, {
      code: "ADMIN_INTERNAL_ERROR",
      message: "Admin API request failed."
    });
  }
}

function shouldRedirectForm(request: Request | undefined) {
  if (!request || request.method.toUpperCase() === "GET") return false;
  const contentType = request.headers.get("content-type") ?? "";
  const accept = request.headers.get("accept") ?? "";
  const isForm =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");

  return isForm && !accept.includes("application/json");
}

function formRedirectUrl(request: Request, params: Record<string, string>) {
  const requestUrl = new URL(request.url);
  const referer = request.headers.get("referer");
  if (!referer) return withRedirectParams(new URL("/dashboard", requestUrl.origin), params);

  try {
    const redirectUrl = new URL(referer);
    if (redirectUrl.origin === requestUrl.origin) return withRedirectParams(redirectUrl, params);
  } catch {
    return withRedirectParams(new URL("/dashboard", requestUrl.origin), params);
  }

  return withRedirectParams(new URL("/dashboard", requestUrl.origin), params);
}

function withRedirectParams(url: URL, params: Record<string, string>) {
  url.searchParams.delete("saved");
  url.searchParams.delete("error");
  url.searchParams.delete("code");

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url;
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
