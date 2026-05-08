import { getBrandVoice, saveBrandVoice } from "../service/admin-service";
import { getAdminRequestContext, handleAdminRoute } from "./http";
import { parseUpsertBrandVoiceRequest } from "./validators";

export function getBrandVoiceRoute(request: Request) {
  return handleAdminRoute(() => getBrandVoice(getAdminRequestContext(request)));
}

export function saveBrandVoiceRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseUpsertBrandVoiceRequest(request);
    return saveBrandVoice(getAdminRequestContext(request), body);
  }, request);
}
