import { getAdminRequestContext, handleAdminRoute } from "./http";
import { getResearch } from "../service/admin-service";
import type { AdminResearchMode } from "../contracts";

const MODES: AdminResearchMode[] = [
  "overview",
  "quick_wins",
  "competitor_gaps",
  "topic_clusters",
  "trends",
  "performance_matrix"
];

export function getResearchRoute(request: Request) {
  return handleAdminRoute(() => getResearch(getAdminRequestContext(request), parseResearchMode(request)));
}

function parseResearchMode(request: Request): AdminResearchMode {
  const value = new URL(request.url).searchParams.get("mode") ?? "overview";
  return MODES.includes(value as AdminResearchMode) ? (value as AdminResearchMode) : "overview";
}
