import { getAdminRequestContext, handleAdminRoute } from "./http";
import { getPriorities } from "../service/admin-service";

export function getPrioritiesRoute(request: Request) {
  return handleAdminRoute(() => getPriorities(getAdminRequestContext(request)));
}
