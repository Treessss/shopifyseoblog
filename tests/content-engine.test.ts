import { describe, expect, it } from "vitest";
import {
  createContentPipelineRegistry,
  defaultSeoScorer,
  estimateWordCount,
  generateArticle,
  type NormalizedContentPipelineInput
} from "../packages/content-engine/src";

describe("content engine", () => {
  it("defaults generated articles to zh-CN", async () => {
    const article = await generateArticle(
      {
        topic: "夏季亚麻衬衫",
        targetWordCount: 800
      },
      {
        seedKeywords: ["亚麻衬衫"]
      }
    );

    expect(article.locale).toBe("zh-CN");
    expect(article.primaryKeyword).toBe("亚麻衬衫");
    expect(article.title).toContain("亚麻衬衫");
    expect(article.bodyHtml).toContain("<section>");
    expect(article.seoScore).toBeGreaterThanOrEqual(72);
    expect(article.qualityPassed).toBe(true);
  });

  it("allows registry overrides for pipeline steps", async () => {
    const registry = createContentPipelineRegistry().registerKeywordPlanner("custom", {
      plan() {
        return {
          locale: "en-US",
          primaryKeyword: "trail running shoes",
          secondaryKeywords: ["trail shoe guide", "running gear"],
          longTailKeywords: ["how to choose trail running shoes"],
          searchIntent: "commercial",
          audienceNeed: "Compare trail shoes before buying"
        };
      }
    });

    const result = await registry.run(
      {
        locale: "en-US",
        topic: "Trail Running Shoes",
        targetWordCount: 900
      },
      {},
      {
        keywordPlanner: "custom"
      }
    );

    expect(result.article.primaryKeyword).toBe("trail running shoes");
    expect(result.artifacts.prompts.system).toContain("English");
    expect(result.artifacts.keywords.longTailKeywords).toContain("how to choose trail running shoes");
  });

  it("scores missing keyword coverage below a qualified article", async () => {
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "manual_topic",
      topic: "Reusable Bottles",
      publishPolicy: "manual_review",
      targetWordCount: 800
    };

    const weak = await defaultSeoScorer.score(
      {
        title: "A generic update",
        handle: "generic-update",
        summary: "Short neutral copy without the target phrase.",
        bodyHtml: "<p>Plain content without structured headings.</p>",
        tags: []
      },
      {
        locale: "en-US",
        primaryKeyword: "reusable water bottle",
        secondaryKeywords: ["water bottle guide"],
        longTailKeywords: [],
        searchIntent: "commercial",
        audienceNeed: "Choose a bottle"
      },
      input
    );

    expect(weak.score).toBeLessThan(50);
    expect(weak.recommendations).toContain("Primary keyword in title");
    expect(estimateWordCount("one two three", "en-US")).toBe(3);
  });
});
