import { AdminApiError } from "@/modules/admin/policies/errors";
import { getAdminRequestContext, handleAdminRoute } from "@/modules/admin/routes/http";
import { getArticle } from "@/modules/admin/service/admin-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleAdminRoute(async () => {
    const params = await context.params;
    if (!params.id) {
      throw new AdminApiError(400, "ARTICLE_ID_REQUIRED", "article id is required.");
    }

    return getArticle(getAdminRequestContext(request), params.id);
  }, request);
}
