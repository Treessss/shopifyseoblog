import { describe, expect, it } from "vitest";
import {
  createContentPipelineRegistry,
  defaultSeoScorer,
  defaultQualityGate,
  estimateWordCount,
  discoverTrendSignals,
  generateArticle,
  runContentPipeline,
  selectTopicCandidate,
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

  it("credits title keyword coverage when product keywords are naturally reordered", async () => {
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "product",
      topic: "Floral phone case",
      publishPolicy: "manual_review",
      targetWordCount: 800
    };

    const seo = await defaultSeoScorer.score(
      {
        title: "Pink and Green Floral iPhone Case: Finish and MagSafe Options",
        handle: "pink-green-floral-iphone-case",
        summary: "Compare the Floral Pattern Phone Case with Pink and Green Design before buying.",
        bodyHtml:
          "<section><h2>Floral Pattern Phone Case with Pink and Green Design</h2><p>Floral Pattern Phone Case with Pink and Green Design details for shoppers.</p></section>",
        tags: []
      },
      {
        locale: "en-US",
        primaryKeyword: "Floral Pattern Phone Case with Pink and Green Design",
        secondaryKeywords: [],
        longTailKeywords: [],
        searchIntent: "commercial",
        audienceNeed: "Choose a floral case"
      },
      input
    );

    expect(seo.checks.find((check) => check.id === "title-primary")?.passed).toBe(true);
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
        topicDiscovery: { enabled: true, maxCandidates: 3, preferTrendSignals: true },
        hotNews: { enabled: true, query: "phone case trends", maxItems: 3 },
        internalLinks: { enabled: true, maxLinks: 2 },
        imageGeneration: {
          enabled: true,
          promptStyle: "Apple-like clean editorial product photography",
          scenePrompt: "morning desk setup with two clear cases",
          fusionMode: "multi_product_fusion",
          referenceImageLimit: 6
        },
        productImageReference: { enabled: true, imageUrls: ["https://cdn.example.com/case.png"], maxImages: 6, maxImagesPerProduct: 2 },
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
          url: "https://news.example.com/phone-accessories",
          traffic: "20K+",
          relevanceScore: 4
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

    expect(result.artifacts.keywords.evidence?.join(" ")).toContain("Slim phone accessories rise with new iPhone launch");
    expect(result.artifacts.keywords.evidenceItems?.some((item) => item.type === "trend" && item.url?.includes("news.example.com"))).toBe(true);
    expect(result.artifacts.keywordEvidence?.some((item) => item.metric?.includes("traffic 20K+"))).toBe(true);
    expect(result.article.bodyHtml).toContain("https://example.myshopify.com/collections/magsafe");
    expect(result.article.imagePrompt).toContain("Reference product image URLs");
    expect(result.article.imagePrompt).toContain("Multi-image fusion");
    expect(result.article.imagePrompt).toContain("morning desk setup");
    expect(result.article.imagePrompt).toContain("Apple-like clean editorial product photography");
  });

  it("expands Google trend discovery into multiple product-aware query seeds", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = (async (url: URL | RequestInfo) => {
      const requestUrl = new URL(String(url));
      requestedUrls.push(requestUrl.toString());
      const query = requestUrl.searchParams.get("q") ?? "phone case trend";
      const xml = `<rss><channel><item><title>${query} trend report</title><link>https://news.example.com/${requestedUrls.length}</link><description>${query} for phone case shoppers</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
      return new Response(xml, { status: 200 });
    }) as typeof fetch;

    const signals = await discoverTrendSignals({
      topic: "Phone Case Style",
      locale: "en-US",
      fetch: fetchMock,
      generationConfig: {
        hotNews: {
          enabled: true,
          sources: ["google_news"],
          maxItems: 4,
          lookbackDays: 30,
          query: "phone case trends"
        }
      },
      context: {
        product: {
          id: "gid://shopify/Product/5",
          title: "Clear MagSafe iPhone Case",
          productType: "Phone Case",
          vendor: "Caseease",
          tags: ["clear", "magsafe", "desk"],
          imageUrls: []
        },
        seedKeywords: ["clear phone case"]
      }
    });

    const queries = requestedUrls.map((url) => new URL(url).searchParams.get("q") ?? "");
    expect(requestedUrls.length).toBeGreaterThan(3);
    expect(requestedUrls.length).toBeLessThanOrEqual(5);
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries.some((query) => query.includes("desk setup"))).toBe(true);
    expect(queries.some((query) => query.includes("gift ideas"))).toBe(true);
    expect(signals.every((signal) => signal.query)).toBe(true);
    expect(signals[0]?.relevanceScore).toBeGreaterThan(0);
  });

  it("keeps the Google News fallback query when trend discovery has no topic seed", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = (async (url: URL | RequestInfo) => {
      const requestUrl = new URL(String(url));
      requestedUrls.push(requestUrl.toString());
      return new Response(
        `<rss><channel><item><title>ecommerce shopping trends</title><link>https://news.example.com/fallback</link><description>ecommerce shopping trends</description></item></channel></rss>`,
        { status: 200 }
      );
    }) as typeof fetch;

    await discoverTrendSignals({
      topic: "",
      locale: "en-US",
      fetch: fetchMock,
      generationConfig: {
        hotNews: {
          enabled: true,
          sources: ["google_news"],
          maxItems: 1
        }
      }
    });

    expect(requestedUrls).toHaveLength(1);
    expect(new URL(requestedUrls[0]!).searchParams.get("q")).toBe("ecommerce shopping trends");
  });

  it("does not fall back to generic guide title formulas for different product contexts", async () => {
    const first = await runContentPipeline(
      {
        locale: "en-US",
        sourceType: "product",
        topic: "Phone Case Style",
        publishPolicy: "manual_review",
        targetWordCount: 900,
        primaryKeyword: "phone case"
      },
      {
        product: {
          id: "gid://shopify/Product/1",
          title: "Clear MagSafe Case",
          productType: "Phone Case",
          vendor: "Caseease",
          tags: ["clear"],
          imageUrls: []
        }
      }
    );
    const second = await runContentPipeline(
      {
        locale: "en-US",
        sourceType: "product",
        topic: "Phone Case Style",
        publishPolicy: "manual_review",
        targetWordCount: 900,
        primaryKeyword: "phone case"
      },
      {
        product: {
          id: "gid://shopify/Product/2",
          title: "Shockproof Silicone Case",
          productType: "Phone Case",
          vendor: "Caseease",
          tags: ["shockproof"],
          imageUrls: []
        }
      }
    );

    expect(first.article.title).not.toMatch(/Guide: Choosing, Using, and Optimizing|How to Choose, Use, and Style|phone case Guide/i);
    expect(second.article.title).not.toMatch(/Guide: Choosing, Using, and Optimizing|How to Choose, Use, and Style|phone case Guide/i);
    expect(first.article.title).not.toBe(second.article.title);
  });

  it("selects a trend-backed topic candidate when automatic topic discovery is enabled", () => {
    const input: NormalizedContentPipelineInput = {
      locale: "zh-CN",
      sourceType: "product",
      topic: "Shopify blog topic",
      publishPolicy: "manual_review",
      targetWordCount: 1200,
      primaryKeyword: "透明手机壳",
      generationConfig: {
        topicDiscovery: {
          enabled: true,
          maxCandidates: 3,
          preferTrendSignals: true,
          minEvidenceScore: 30
        }
      }
    };
    const selection = selectTopicCandidate(input, {
      product: {
        id: "gid://shopify/Product/1",
        title: "透明 MagSafe 手机壳",
        productType: "手机壳",
        vendor: "Caseease",
        tags: ["透明", "magsafe"],
        imageUrls: ["https://cdn.example.com/product-1.png", "https://cdn.example.com/product-2.png"]
      },
      trendSignals: [
        {
          title: "手机配件轻薄化趋势升温",
          source: "Google Trends",
          url: "https://trends.example.com/phone-case",
          traffic: "50K+",
          relevanceScore: 5
        }
      ],
      generationConfig: input.generationConfig
    });

    expect(selection.selected.agent?.role).toBe("seo_topic_agent");
    expect(selection.selected.agent?.trendConcept).toContain("手机配件轻薄化趋势升温");
    expect(new Set(selection.candidates.map((candidate) => candidate.agent?.angleKey)).size).toBeGreaterThan(1);
    expect(selection.selected.score).toBeGreaterThanOrEqual(80);
    expect(selection.selected.evidence.some((item) => item.type === "trend" && item.metric?.includes("traffic 50K+"))).toBe(true);
  });

  it("uses the SEO Topic Agent selected topic as the generated article title", async () => {
    const selected = {
      topic: "clear phone case for desk setups: Fit and Buying Checks",
      primaryKeyword: "clear phone case",
      score: 91,
      reasons: ["SEO Topic Agent: shopper scenario fit"],
      evidence: [],
      agent: {
        role: "seo_topic_agent" as const,
        angleKey: "scenario_fit",
        funnelStage: "MOFU" as const,
        searchIntent: "commercial" as const,
        trendConcept: "desk setup accessories",
        impact: 88,
        confidence: 86,
        noveltyScore: 92
      }
    };
    const result = await runContentPipeline(
      {
        locale: "en-US",
        sourceType: "product",
        topic: selected.topic,
        publishPolicy: "manual_review",
        targetWordCount: 900,
        primaryKeyword: selected.primaryKeyword
      },
      {
        product: {
          id: "gid://shopify/Product/4",
          title: "Clear MagSafe iPhone Case",
          productType: "Phone Case",
          vendor: "Caseease",
          tags: ["clear", "magsafe", "desk"],
          imageUrls: []
        },
        topicSelection: {
          selected,
          candidates: [selected]
        }
      }
    );

    expect(result.article.title).toBe(selected.topic);
    expect(result.artifacts.draft.title).toBe(selected.topic);
  });

  it("filters unrelated zero-relevance trends from keyword evidence and topic selection", async () => {
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "product",
      topic: "Shopify blog topic",
      publishPolicy: "manual_review",
      targetWordCount: 1200,
      primaryKeyword: "cat phone case",
      generationConfig: {
        topicDiscovery: {
          enabled: true,
          maxCandidates: 3,
          preferTrendSignals: true
        }
      }
    };
    const context = {
      product: {
        id: "gid://shopify/Product/3",
        title: "Fluffy White Cat Phone Case",
        productType: "Phone Case",
        vendor: "Caseease",
        tags: ["cat", "pink"],
        imageUrls: ["https://cdn.example.com/cat-case.png"]
      },
      trendSignals: [
        {
          title: "csk vs srh match score",
          source: "Google Trends",
          traffic: "500K+",
          relevanceScore: 0
        }
      ],
      generationConfig: input.generationConfig
    };

    const result = await runContentPipeline(input, context);
    const selection = selectTopicCandidate(input, context);
    const evidenceText = result.artifacts.keywords.evidence?.join(" ") ?? "";

    expect(evidenceText).not.toContain("csk vs srh");
    expect(selection.selected.topic).not.toContain("csk vs srh");
    expect(result.article.secondaryKeywords.join(" ")).not.toContain("csk");
  });

  it("skips blank catalog fields when selecting automatic topics", () => {
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "product",
      publishPolicy: "manual_review",
      targetWordCount: 1200,
      generationConfig: {
        topicDiscovery: {
          enabled: true,
          maxCandidates: 3,
          preferTrendSignals: true
        }
      }
    };
    const selection = selectTopicCandidate(input, {
      product: {
        id: "gid://shopify/Product/2",
        title: "Cross and Heart iPhone Phone Case",
        productType: "",
        vendor: "Caseease",
        tags: ["iphone", "heart"],
        imageUrls: []
      },
      generationConfig: input.generationConfig
    });

    expect(selection.selected.primaryKeyword).toBe("cross heart iPhone case");
    expect(selection.selected.topic).toContain("cross heart iPhone case");
    expect(selection.selected.topic).not.toContain("How to choose :");
  });

  it("avoids recently used topics when automatic discovery repeats the same product", () => {
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "product",
      topic: "Shopify blog topic",
      publishPolicy: "manual_review",
      targetWordCount: 1200,
      generationConfig: {
        topicDiscovery: {
          enabled: true,
          maxCandidates: 4,
          preferTrendSignals: true
        }
      }
    };
    const repeatedTopic = "How to choose cross heart iPhone case: use cases, materials, and pairing ideas";
    const selection = selectTopicCandidate(input, {
      product: {
        id: "gid://shopify/Product/2",
        title: "Cross and Heart iPhone Phone Case",
        productType: "",
        vendor: "Caseease",
        tags: ["iphone", "heart"],
        imageUrls: []
      },
      recentTopics: [
        { topic: repeatedTopic },
        { title: "cross heart iPhone case: Fit, Style, and Everyday Use" }
      ],
      generationConfig: input.generationConfig
    });

    expect(selection.selected.topic).not.toBe(repeatedTopic);
    expect(selection.candidates.every((candidate) => candidate.topic !== repeatedTopic)).toBe(true);
    expect(selection.selected.reasons.join(" ")).toMatch(/fresh|non-repeating|scenario/i);
  });

  it("falls back to a fresh scenario when all evergreen angles were already used", () => {
    const keyword = "cross heart iPhone case";
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "product",
      topic: "Shopify blog topic",
      publishPolicy: "manual_review",
      targetWordCount: 1200,
      generationConfig: {
        topicDiscovery: {
          enabled: true,
          maxCandidates: 4
        }
      }
    };
    const usedTopics = [
      `How to choose ${keyword}: use cases, materials, and pairing ideas`,
      `${keyword}: who this product is really for`,
      `${keyword} styling ideas for commuting, gifting, and everyday outfits`,
      `${keyword} vs. other similar options: protection, feel, and design differences`,
      `${keyword} pre-purchase checklist: compatibility, care, and daily use`,
      `similar options buying mistakes: when ${keyword} may not be the best fit`,
      `${keyword} gift ideas: matching style, protection, and personality`,
      `this product detail review: what shoppers should notice before buying`
    ];
    const selection = selectTopicCandidate(input, {
      product: {
        id: "gid://shopify/Product/2",
        title: keyword,
        productType: "",
        vendor: "Caseease",
        tags: ["iphone", "heart"],
        imageUrls: []
      },
      recentTopics: usedTopics.map((topic) => ({ topic })),
      generationConfig: input.generationConfig
    });

    expect(usedTopics).not.toContain(selection.selected.topic);
    expect(selection.selected.topic).toContain("for daily commutes");
    expect(selection.selected.reasons).toContain("fallback fresh scenario angle");
  });

  it("still avoids repeats when evergreen topics and fallback scenarios are exhausted", () => {
    const keyword = "cross heart iPhone case";
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "product",
      topic: `${keyword} fresh angle: similar options use-case breakdown`,
      publishPolicy: "manual_review",
      targetWordCount: 1200,
      generationConfig: {
        topicDiscovery: {
          enabled: true,
          maxCandidates: 4
        }
      }
    };
    const evergreenTopics = [
      `How to choose ${keyword}: use cases, materials, and pairing ideas`,
      `${keyword}: who this product is really for`,
      `${keyword} styling ideas for commuting, gifting, and everyday outfits`,
      `${keyword} vs. other similar options: protection, feel, and design differences`,
      `${keyword} pre-purchase checklist: compatibility, care, and daily use`,
      `similar options buying mistakes: when ${keyword} may not be the best fit`,
      `${keyword} gift ideas: matching style, protection, and personality`,
      `this product detail review: what shoppers should notice before buying`
    ];
    const scenarioTopics = [
      `${keyword} for daily commutes: similar options details, tradeoffs, and styling checks`,
      `${keyword} for gift shoppers: similar options details, tradeoffs, and styling checks`,
      `${keyword} for travel days: similar options details, tradeoffs, and styling checks`,
      `${keyword} for student routines: similar options details, tradeoffs, and styling checks`,
      `${keyword} for desk setups: similar options details, tradeoffs, and styling checks`,
      `${keyword} for weekend plans: similar options details, tradeoffs, and styling checks`,
      `${keyword} for minimalist outfits: similar options details, tradeoffs, and styling checks`,
      `${keyword} for streetwear looks: similar options details, tradeoffs, and styling checks`
    ];
    const usedTopics = [...evergreenTopics, ...scenarioTopics, input.topic!];
    const selection = selectTopicCandidate(input, {
      product: {
        id: "gid://shopify/Product/2",
        title: keyword,
        productType: "",
        vendor: "Caseease",
        tags: ["iphone", "heart"],
        imageUrls: []
      },
      recentTopics: usedTopics.map((topic) => ({ topic })),
      generationConfig: input.generationConfig
    });

    expect(usedTopics).not.toContain(selection.selected.topic);
    expect(selection.selected.topic).toContain("fresh angle");
  });

  it("deduplicates candidates by topic even when agent metadata differs", () => {
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "product",
      topic: "Shopify blog topic",
      publishPolicy: "manual_review",
      targetWordCount: 1200,
      generationConfig: {
        topicDiscovery: {
          enabled: true,
          maxCandidates: 5,
          preferTrendSignals: true
        }
      }
    };
    const selection = selectTopicCandidate(input, {
      product: {
        id: "gid://shopify/Product/6",
        title: "Clear MagSafe iPhone Case",
        productType: "Phone Case",
        vendor: "Caseease",
        tags: ["clear", "magsafe"],
        imageUrls: []
      },
      trendSignals: [
        {
          title: "desk setup accessories trend",
          source: "Google News",
          relevanceScore: 4
        },
        {
          title: "desk setup accessories trend",
          source: "Google Trends",
          relevanceScore: 5,
          traffic: "20K+"
        }
      ],
      generationConfig: input.generationConfig
    });

    const topics = selection.candidates.map((candidate) => candidate.topic.toLowerCase());
    expect(new Set(topics).size).toBe(topics.length);
  });

  it("derives a search-friendly primary keyword from long catalog product names", async () => {
    const result = await runContentPipeline(
      {
        locale: "en-US",
        sourceType: "product",
        publishPolicy: "manual_review",
        targetWordCount: 900
      },
      {
        product: {
          id: "gid://shopify/Product/9",
          title: "Floral Pattern Phone Case with Pink and Green Design",
          productType: "",
          vendor: "Caseease",
          tags: ["floral", "pink", "green"],
          imageUrls: [],
          seoDescription: "Discover our Floral Pattern Phone Case featuring a lovely pink and green design."
        }
      }
    );

    expect(result.artifacts.keywords.primaryKeyword).toBe("pink and green floral phone case");
    expect(result.article.primaryKeyword).toBe("pink and green floral phone case");
  });

  it("keeps explicit campaign seed keywords ahead of catalog-derived keywords", async () => {
    const result = await runContentPipeline(
      {
        locale: "en-US",
        sourceType: "product",
        publishPolicy: "manual_review",
        targetWordCount: 900,
        keywords: ["magsafe floral case"]
      },
      {
        product: {
          id: "gid://shopify/Product/11",
          title: "Floral Pattern Phone Case with Pink and Green Design",
          productType: "",
          vendor: "Caseease",
          tags: ["floral", "pink", "green"],
          imageUrls: [],
          seoDescription: "Discover our Floral Pattern Phone Case featuring a lovely pink and green design."
        },
        seedKeywords: ["magsafe floral case"]
      }
    );

    expect(result.artifacts.keywords.primaryKeyword).toBe("magsafe floral case");
  });

  it("does not use product listing RSS items as trend-backed topic evidence", () => {
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "product",
      topic: "Shopify blog topic",
      publishPolicy: "manual_review",
      targetWordCount: 1200,
      generationConfig: {
        topicDiscovery: {
          enabled: true,
          maxCandidates: 3,
          preferTrendSignals: true
        }
      }
    };
    const selection = selectTopicCandidate(input, {
      product: {
        id: "gid://shopify/Product/10",
        title: "Floral Pattern Phone Case with Pink and Green Design",
        productType: "",
        vendor: "Caseease",
        tags: ["floral", "pink", "green"],
        imageUrls: []
      },
      trendSignals: [
        {
          title: "OOK Cute Floral Case For Google Pixel 9a | Pink Sunset Design, Shockproof TPU/PC Protection, Raised Camera Guard - example.com",
          source: "Google News",
          url: "https://news.example.com/rss/product-listing",
          relevanceScore: 5
        }
      ],
      generationConfig: input.generationConfig
    });

    expect(selection.selected.topic).not.toContain("OOK Cute Floral Case");
    expect(selection.selected.reasons.join(" ")).toContain("evergreen");
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

  it("uses evergreen catalog evidence when required trend evidence is unavailable", async () => {
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "product",
      topic: "Matte phone case buying checks",
      publishPolicy: "manual_review",
      targetWordCount: 800,
      generationConfig: {
        qualityGate: {
          enabled: true,
          minSeoScore: 0,
          minEditorialScore: 0,
          requireTrendEvidence: true
        }
      }
    };
    const body = Array.from({ length: 140 }, (_, index) => `useful shopper detail ${index}`).join(" ");
    const article = {
      title: "Matte Phone Case Buying Checks",
      handle: "matte-phone-case-buying-checks",
      summary: "Matte phone case buying checks for shoppers.",
      bodyHtml: `<section><h2>Matte phone case checks</h2><p>${body}</p></section>`,
      tags: [],
      imageAlt: "Matte phone case"
    };
    const seo = await defaultSeoScorer.score(
      article,
      {
        locale: "en-US",
        primaryKeyword: "matte phone case",
        secondaryKeywords: [],
        longTailKeywords: [],
        searchIntent: "commercial",
        audienceNeed: "Choose a matte phone case"
      },
      input
    );
    const quality = await defaultQualityGate.evaluate(article, seo, input, {
      product: {
        id: "gid://shopify/Product/1",
        title: "Matte Phone Case",
        productType: "Phone Case",
        vendor: "Caseease",
        tags: ["matte", "iphone"],
        imageUrls: []
      },
      generationConfig: input.generationConfig
    });

    expect(quality.passed).toBe(true);
    expect(quality.reasons.join(" ")).not.toContain("Trend evidence was required");
    expect(quality.warnings.join(" ")).toContain("evergreen product/category evidence");
  });

  it("still fails required trend evidence when no trend or evergreen evidence exists", async () => {
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "manual_topic",
      topic: "Unknown topic",
      publishPolicy: "manual_review",
      targetWordCount: 800,
      generationConfig: {
        qualityGate: {
          enabled: true,
          minSeoScore: 0,
          minEditorialScore: 0,
          requireTrendEvidence: true
        }
      }
    };
    const body = Array.from({ length: 140 }, (_, index) => `specific editorial detail ${index}`).join(" ");
    const article = {
      title: "Unknown Topic Checks",
      handle: "unknown-topic-checks",
      summary: "A neutral article summary.",
      bodyHtml: `<section><h2>Checks</h2><p>${body}</p></section>`,
      tags: [],
      imageAlt: "Neutral article image"
    };
    const seo = await defaultSeoScorer.score(
      article,
      {
        locale: "en-US",
        primaryKeyword: "unknown topic",
        secondaryKeywords: [],
        longTailKeywords: [],
        searchIntent: "informational",
        audienceNeed: "Understand the topic"
      },
      input
    );
    const quality = await defaultQualityGate.evaluate(article, seo, input, {
      generationConfig: input.generationConfig
    });

    expect(quality.passed).toBe(false);
    expect(quality.reasons.join(" ")).toContain("Trend evidence was required");
  });

  it("does not treat seed keywords or internal links as evergreen catalog evidence", async () => {
    const input: NormalizedContentPipelineInput = {
      locale: "en-US",
      sourceType: "manual_topic",
      topic: "Seed-only topic",
      publishPolicy: "manual_review",
      targetWordCount: 800,
      generationConfig: {
        qualityGate: {
          enabled: true,
          minSeoScore: 0,
          minEditorialScore: 0,
          requireTrendEvidence: true
        }
      }
    };
    const body = Array.from({ length: 140 }, (_, index) => `specific editorial detail ${index}`).join(" ");
    const article = {
      title: "Seed-only Topic Checks",
      handle: "seed-only-topic-checks",
      summary: "A seed keyword article summary.",
      bodyHtml: `<section><h2>Checks</h2><p>${body}</p></section>`,
      tags: [],
      imageAlt: "Seed keyword article image"
    };
    const seo = await defaultSeoScorer.score(
      article,
      {
        locale: "en-US",
        primaryKeyword: "seed-only topic",
        secondaryKeywords: [],
        longTailKeywords: [],
        searchIntent: "informational",
        audienceNeed: "Understand the topic"
      },
      input
    );
    const quality = await defaultQualityGate.evaluate(article, seo, input, {
      seedKeywords: ["seed-only topic"],
      keywordEvidence: [
        {
          type: "internal_link",
          source: "shopify",
          label: "Internal link",
          value: "Related article",
          confidence: 70
        }
      ],
      generationConfig: input.generationConfig
    });

    expect(quality.passed).toBe(false);
    expect(quality.reasons.join(" ")).toContain("Trend evidence was required");
    expect(quality.warnings.join(" ")).not.toContain("evergreen product/category evidence");
  });
});
