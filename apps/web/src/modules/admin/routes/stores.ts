import { getStores, queueStoreSync } from "../service/admin-service";
import { getAdminRequestContext, handleAdminRoute } from "./http";
import { parseQueueStoreSyncRequest } from "./validators";

export function getStoresRoute(request: Request) {
  return handleAdminRoute(() => getStores(getAdminRequestContext(request)));
}

export function queueStoreSyncRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseQueueStoreSyncRequest(request);
    return queueStoreSync(getAdminRequestContext(request), body);
  }, request);
}
