import { createCampaign, getCampaigns } from "../service/admin-service";
import { getAdminRequestContext, handleAdminRoute } from "./http";
import { parseCreateCampaignRequest } from "./validators";

export function getCampaignsRoute(request: Request) {
  return handleAdminRoute(() => getCampaigns(getAdminRequestContext(request)));
}

export function createCampaignRoute(request: Request) {
  return handleAdminRoute(async () => {
    const body = await parseCreateCampaignRequest(request);
    return createCampaign(getAdminRequestContext(request), body);
  }, request);
}
