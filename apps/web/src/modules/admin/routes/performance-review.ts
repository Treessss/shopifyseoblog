import { getAdminRequestContext, handleAdminRoute } from "./http";
import { getPerformanceReview } from "../service/admin-service";

export function getPerformanceReviewRoute(request: Request) {
  return handleAdminRoute(() => getPerformanceReview(getAdminRequestContext(request)));
}
