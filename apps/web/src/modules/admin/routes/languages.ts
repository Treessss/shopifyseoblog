import { getLanguages, saveLanguage } from "../service/admin-service";
import { getAdminRequestContext, handleAdminRoute } from "./http";
import { parseUpsertLanguageRequest } from "./validators";

export function getLanguagesRoute(request: Request) {
  return handleAdminRoute(() => getLanguages(getAdminRequestContext(request)));
}

export function saveLanguageRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseUpsertLanguageRequest(request);
    return saveLanguage(getAdminRequestContext(request), body);
  });
}
