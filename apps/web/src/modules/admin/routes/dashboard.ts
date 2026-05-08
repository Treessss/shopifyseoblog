import { getDashboard } from "../service/admin-service";
import { getAdminRequestContext, handleAdminRoute } from "./http";

export function getDashboardRoute(request: Request) {
  return handleAdminRoute(() => getDashboard(getAdminRequestContext(request)));
}
