import {
  getSearchConsole,
  queueSearchConsoleArticleSync,
  queueSearchConsoleSync,
  saveSearchConsoleProperty
} from "../service/admin-service";
import { getAdminRequestContext, handleAdminRoute } from "./http";
import {
  parseQueueSearchConsoleArticleSyncRequest,
  parseQueueSearchConsoleSyncRequest,
  parseSaveSearchConsolePropertyRequest
} from "./validators";

export function getSearchConsoleRoute(request: Request) {
  return handleAdminRoute(() => getSearchConsole(getAdminRequestContext(request)));
}

export function saveSearchConsolePropertyRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseSaveSearchConsolePropertyRequest(request);
    return saveSearchConsoleProperty(getAdminRequestContext(request), body);
  }, request);
}

export function queueSearchConsoleSyncRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseQueueSearchConsoleSyncRequest(request);
    return queueSearchConsoleSync(getAdminRequestContext(request), body);
  }, request);
}

export function queueSearchConsoleArticleSyncRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseQueueSearchConsoleArticleSyncRequest(request);
    return queueSearchConsoleArticleSync(getAdminRequestContext(request), body);
  }, request);
}
