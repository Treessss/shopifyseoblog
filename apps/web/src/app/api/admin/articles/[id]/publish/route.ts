import { readJson } from "@/lib/api";
import { AdminApiError } from "@/modules/admin/policies/errors";
import { queueArticlePublish } from "@/modules/admin/service/admin-service";
import { getAdminRequestContext, handleAdminRoute } from "@/modules/admin/routes/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PublishRequestBody {
  publishAt?: string;
  shopifyBlogId?: string;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleAdminRoute(async () => {
    const params = await context.params;
    if (!params.id) {
      throw new AdminApiError(400, "ARTICLE_ID_REQUIRED", "article id is required.");
    }

    const body = ((await readJson<PublishRequestBody>(request)) ?? {}) as PublishRequestBody;

    return queueArticlePublish(getAdminRequestContext(request), {
      articleId: params.id,
      publishAt: optionalDateString(body.publishAt, "publishAt"),
      shopifyBlogId: optionalString(body.shopifyBlogId)
    });
  }, request);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalDateString(value: unknown, key: string) {
  const raw = optionalString(value);
  if (!raw) return undefined;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new AdminApiError(400, `${key.toUpperCase()}_INVALID`, `${key} must be a valid date string.`);
  }

  return date.toISOString();
}
