import { getArticle, getArticles, queueArticlePublish, queueArticleRepair } from "../service/admin-service";
import { getAdminRequestContext, handleAdminRoute } from "./http";
import { parseQueueArticlePublishRequest, parseQueueArticleRepairRequest } from "./validators";

export function getArticlesRoute(request: Request) {
  return handleAdminRoute(() => getArticles(getAdminRequestContext(request)));
}

export function getArticleRoute(request: Request, articleId: string) {
  return handleAdminRoute(() => getArticle(getAdminRequestContext(request), articleId));
}

export function queueArticlePublishRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseQueueArticlePublishRequest(request);
    return queueArticlePublish(getAdminRequestContext(request), body);
  }, request);
}

export function queueArticleRepairRoute(request: Request, articleId?: string) {
  return handleAdminRoute(async () => {
    const body = await parseQueueArticleRepairRequest(request, articleId);
    return queueArticleRepair(getAdminRequestContext(request), body);
  }, request);
}
