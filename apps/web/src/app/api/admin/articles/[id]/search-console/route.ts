import { AdminApiError } from "@/modules/admin/policies/errors";
import { getAdminRequestContext, handleAdminRoute } from "@/modules/admin/routes/http";
import { parseQueueSearchConsoleArticleSyncRequest } from "@/modules/admin/routes/validators";
import { queueSearchConsoleArticleSync } from "@/modules/admin/service/admin-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleAdminRoute(async () => {
    const params = await context.params;
    if (!params.id) {
      throw new AdminApiError(400, "ARTICLE_ID_REQUIRED", "article id is required.");
    }

    const body = await parseQueueSearchConsoleArticleSyncRequest(request, params.id);
    return queueSearchConsoleArticleSync(getAdminRequestContext(request), {
      ...body,
      articleId: params.id
    });
  }, request);
}
