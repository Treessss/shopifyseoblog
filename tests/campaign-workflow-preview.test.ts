import { describe, expect, it } from "vitest";
import {
  buildCampaignStartSteps,
  buildCampaignWorkflowPlanFallback,
  buildCampaignWorkflowRequest
} from "../apps/web/src/lib/agent-center/campaign-workflow-preview";

describe("campaign workflow preview", () => {
  it("builds a preview request from campaign form context", () => {
    const request = buildCampaignWorkflowRequest({
      organizationId: "org_1",
      storeId: "store_1",
      locale: "zh-CN",
      topic: "phone case buying guide",
      primaryKeyword: "phone case",
      sourceId: "collection_1",
      availableInternalLinks: 4,
      availableExternalReferences: 2,
      recentTopicCount: 3,
      searchConsoleConnected: true
    });

    expect(request.organization_id).toBe("org_1");
    expect(request.source_type).toBe("manual_topic");
    expect(request.available_internal_links).toBe(4);
    expect(request.search_console_connected).toBe(true);
  });

  it("falls back to a readable workflow plan when Python is unavailable", () => {
    const plan = buildCampaignWorkflowPlanFallback(
      buildCampaignWorkflowRequest({
        organizationId: "org_1",
        storeId: "store_1",
        locale: "zh-CN",
        topic: "phone case buying guide",
        primaryKeyword: "phone case",
        availableInternalLinks: 0,
        availableExternalReferences: 0,
        recentTopicCount: 0,
        searchConsoleConnected: false
      })
    );

    const steps = buildCampaignStartSteps(plan);

    expect(plan.blockers).toContain("internal_links");
    expect(plan.next_step).toContain("Shopify");
    expect(steps[0]?.title).toContain("Research");
    expect(steps[0]?.detail).toContain("Researcher");
  });
});
