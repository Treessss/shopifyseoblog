import { getArticles, queueArticlePublish } from "../service/admin-service";
import { getAdminRequestContext, handleAdminRoute } from "./http";
import { parseQueueArticlePublishRequest } from "./validators";

export function getArticlesRoute(request: Request) {
  return handleAdminRoute(() => getArticles(getAdminRequestContext(request)));
}

export function queueArticlePublishRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseQueueArticlePublishRequest(request);
    return queueArticlePublish(getAdminRequestContext(request), body);
  });
}
