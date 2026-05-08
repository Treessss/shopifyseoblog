import { getAiSettings, saveAiSettings } from "../service/admin-service";
import { getAdminRequestContext, handleAdminRoute } from "./http";
import { parseUpsertAiProviderRequest } from "./validators";

export function getAiSettingsRoute(request: Request) {
  return handleAdminRoute(() => getAiSettings(getAdminRequestContext(request)));
}

export function saveAiSettingsRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseUpsertAiProviderRequest(request);
    return saveAiSettings(getAdminRequestContext(request), body);
  }, request);
}
