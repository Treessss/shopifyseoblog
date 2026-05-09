import { deleteStore, getStores, queueStoreSync, saveStoreCredentials } from "../service/admin-service";
import { getAdminRequestContext, handleAdminRoute } from "./http";
import { parseDeleteStoreRequest, parseQueueStoreSyncRequest, parseUpsertStoreCredentialsRequest } from "./validators";

export function getStoresRoute(request: Request) {
  return handleAdminRoute(() => getStores(getAdminRequestContext(request)));
}

export function saveStoreCredentialsRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseUpsertStoreCredentialsRequest(request);
    return saveStoreCredentials(getAdminRequestContext(request), body);
  }, request);
}

export function deleteStoreRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseDeleteStoreRequest(request);
    return deleteStore(getAdminRequestContext(request), body);
  }, request);
}

export function queueStoreSyncRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseQueueStoreSyncRequest(request);
    return queueStoreSync(getAdminRequestContext(request), body);
  }, request);
}
