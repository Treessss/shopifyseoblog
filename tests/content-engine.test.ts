import { describe, expect, it } from "vitest";
import {
  createContentPipelineRegistry,
  defaultSeoScorer,
  defaultQualityGate,
  estimateWordCount,
  generateArticle,
  runContentPipeline,
  type NormalizedContentPipelineInput
} from "../packages/content-engine/src";
import { blogCampaignInputSchema } from "../packages/shared/src";

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

  it("keeps generation config and uses trends, internal links, and product images as evidence", async () => {
    const parsed = blogCampaignInputSchema.parse({
      organizationId: "org_1",
      storeId: "store_1",
      locale: "en-US",
      sourceType: "product",
      topic: "Clear iPhone cases",
      publishPolicy: "manual_review",
      targetWordCount: 900,
      primaryKeyword: "clear phone case",
      generationConfig: {
        hotNews: { enabled: true, query: "phone case trends", maxItems: 3 },
        internalLinks: { enabled: true, maxLinks: 2 },
        imageGeneration: { enabled: true, promptStyle: "Apple-like clean editorial product photography" },
        productImageReference: { enabled: true, imageUrls: ["https://cdn.example.com/case.png"] },
        qualityGate: { enabled: true, minSeoScore: 70, minEditorialScore: 60 }
      }
    });

    const result = await runContentPipeline(parsed, {
      product: {
        id: "gid://shopify/Product/1",
        title: "Clear MagSafe iPhone Case",
        handle: "clear-magsafe-case",
        productType: "Phone Case",
        vendor: "Caseease",
        tags: ["clear", "magsafe"],
        imageUrls: ["https://cdn.example.com/product.png"]
      },
      trendSignals: [
        {
          title: "Slim phone accessories rise with new iPhone launch",
          source: "Google News",
          url: "https://news.example.com/phone-accessories"
        }
      ],
      internalLinks: [
        {
          title: "MagSafe Case Collection",
          url: "https://example.myshopify.com/collections/magsafe",
          type: "collection"
        }
      ],
      imageReferences: [{ url: "https://cdn.example.com/product.png", source: "product", title: "Clear case" }],
      generationConfig: parsed.generationConfig
    });

    expect(result.artifacts.keywords.evidence).toContain("trend: Slim phone accessories rise with new iPhone launch");
    expect(result.article.bodyHtml).toContain("https://example.myshopify.com/collections/magsafe");
    expect(result.article.imagePrompt).toContain("Reference product image URLs");
    expect(result.article.imagePrompt).toContain("Apple-like clean editorial product photography");
  });

  it("flags repetitive template-like writing as an editorial quality risk", async () => {
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "manual_topic",
      topic: "Phone Case Guide",
      publishPolicy: "manual_review",
      targetWordCount: 800,
      generationConfig: {
        qualityGate: {
          enabled: true,
          minSeoScore: 0,
          minEditorialScore: 90,
          rejectTemplatePatterns: true
        }
      }
    };
    const article = {
      title: "Phone Case Guide",
      handle: "phone-case-guide",
      summary: "A guide to choosing a phone case for daily use.",
      bodyHtml:
        "<p>In today's fast-paced world, phone cases matter. In today's fast-paced world, shoppers need protection. In today's fast-paced world, style matters.</p>",
      tags: [],
      imageAlt: "Phone case"
    };
    const seo = await defaultSeoScorer.score(
      article,
      {
        locale: "en-US",
        primaryKeyword: "phone case",
        secondaryKeywords: [],
        longTailKeywords: [],
        searchIntent: "commercial",
        audienceNeed: "Choose a case"
      },
      input
    );
    const quality = await defaultQualityGate.evaluate(article, seo, input, {
      generationConfig: input.generationConfig
    });

    expect(quality.passed).toBe(false);
    expect(quality.editorial?.signals.join(" ")).toContain("template");
  });
});
