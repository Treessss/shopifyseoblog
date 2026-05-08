import { getLogs } from "../service/admin-service";
import { getAdminRequestContext, handleAdminRoute } from "./http";

export function getLogsRoute(request: Request) {
  return handleAdminRoute(() => getLogs(getAdminRequestContext(request)));
}
