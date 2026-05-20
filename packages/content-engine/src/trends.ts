import type { GenerationConfig } from "@shopify-ai-blog/shared";
import type { ContentSourceContext, TrendSignal } from "./types";

export interface DiscoverTrendSignalsInput {
  topic: string;
  locale?: string;
  generationConfig?: GenerationConfig;
  context?: ContentSourceContext;
  fetch?: typeof fetch;
}

const SOURCE_LABELS: Record<string, string> = {
  google_news: "Google News",
  google_trends: "Google Trends"
};

export async function discoverTrendSignals(input: DiscoverTrendSignalsInput): Promise<TrendSignal[]> {
  const config = input.generationConfig?.hotNews;
  if (!config?.enabled) return [];

  const fetchImpl = input.fetch ?? fetch;
  const maxItems = config.maxItems ?? 5;
  if (maxItems <= 0) return [];
  const sources = config.sources?.length ? config.sources : ["google_news", "google_trends"];
  const queryLimit = Math.min(5, Math.max(2, maxItems + 1));
  const queries = buildTrendQueries(input.topic, input.context, config.query).slice(0, queryLimit);
  const collected: TrendSignal[] = [];

  for (const source of sources) {
    const urls =
      source === "google_trends"
        ? [{ url: googleTrendsRssUrl(config.geo), query: "regional trending searches", trendType: "regional_trending" as const }]
        : queries.map((query) => ({ url: googleNewsRssUrl(query, input.locale, config.geo), query, trendType: "news" as const }));

    for (const item of urls) {
      try {
        const response = await fetchImpl(item.url, {
          headers: {
            accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
            "user-agent": "shopify-ai-blog-trend-scout/0.1"
          }
        });
        if (!response.ok) continue;
        const xml = await response.text();
        collected.push(...parseRssItems(xml, source, item.query, item.trendType));
      } catch {
        continue;
      }
    }
  }

  return rankTrendSignals(collected, queries.join(" "), input.context)
    .filter((signal) => withinLookback(signal.publishedAt, config.lookbackDays ?? 7))
    .filter((signal) => passesRelevanceGate(signal, input.context))
    .slice(0, maxItems);
}

function buildTrendQueries(topic: string, context: ContentSourceContext | undefined, configured?: string) {
  const base = [
    configured,
    topic,
    context?.seedKeywords?.[0],
    context?.product?.productType,
    context?.product?.title,
    context?.collection?.title,
    context?.seedKeywords?.slice(1, 3).join(" ")
  ];
  const primary = normalizeQuery(base.filter(Boolean).join(" "));
  const anchor = normalizeQuery(
    [
      configured,
      context?.seedKeywords?.[0],
      context?.product?.productType,
      context?.collection?.title,
      topic
    ]
      .filter(Boolean)
      .join(" ")
  );
  const product = normalizeQuery([context?.product?.title, context?.product?.productType].filter(Boolean).join(" "));
  const category = normalizeQuery([context?.product?.productType, context?.collection?.title, context?.seedKeywords?.[0]].filter(Boolean).join(" "));
  const modifierBase = category || anchor || normalizeQuery(topic);
  const scenarios = topicQueryModifiers(topic, context);

  const queries = uniqueQueries([
    primary,
    anchor,
    product,
    category,
    ...(modifierBase ? scenarios.map((modifier) => normalizeQuery([modifierBase, modifier].filter(Boolean).join(" "))) : []),
    configured,
    topic
  ]).filter(Boolean);

  return queries.length ? queries : ["ecommerce shopping trends"];
}

function googleNewsRssUrl(query: string, locale?: string, geo = "US") {
  const language = locale?.startsWith("zh") ? "zh-CN" : locale?.startsWith("ja") ? "ja" : "en-US";
  const country = geo.toUpperCase();
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query || "ecommerce shopping trends");
  url.searchParams.set("hl", language);
  url.searchParams.set("gl", country);
  url.searchParams.set("ceid", `${country}:${language.split("-")[0]}`);
  return url;
}

function googleTrendsRssUrl(geo = "US") {
  const url = new URL("https://trends.google.com/trending/rss");
  url.searchParams.set("geo", geo.toUpperCase());
  return url;
}

function parseRssItems(xml: string, source: string, query?: string, trendType?: TrendSignal["trendType"]): TrendSignal[] {
  return xml
    .split(/<item\b/i)
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.search(/<\/item>/i)))
    .map((chunk) => ({
      title: readXmlTag(chunk, "title"),
      url: readXmlTag(chunk, "link"),
      summary: stripTags(readXmlTag(chunk, "description")),
      publishedAt: readXmlTag(chunk, "pubDate"),
      traffic: readXmlTag(chunk, "ht:approx_traffic") || readXmlTag(chunk, "approx_traffic"),
      imageUrl: readXmlTag(chunk, "ht:picture") || readXmlAttribute(chunk, "media:content", "url"),
      source: SOURCE_LABELS[source] ?? source,
      query,
      trendType
    }))
    .filter((item) => item.title);
}

function readXmlTag(chunk: string, tag: string) {
  const escaped = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const match = chunk.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return decodeXml(match?.[1]?.trim() ?? "");
}

function readXmlAttribute(chunk: string, tag: string, attribute: string) {
  const escapedTag = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const escapedAttribute = attribute.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const match = chunk.match(new RegExp(`<${escapedTag}[^>]*\\s${escapedAttribute}=["']([^"']+)["'][^>]*>`, "i"));
  return decodeXml(match?.[1]?.trim() ?? "");
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripTags(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function rankTrendSignals(signals: TrendSignal[], query: string, context?: ContentSourceContext) {
  const terms = tokenSet(
    [
      query,
      context?.product?.title,
      context?.product?.productType,
      context?.product?.tags?.join(" "),
      context?.collection?.title,
      context?.seedKeywords?.join(" ")
    ]
      .filter(Boolean)
      .join(" ")
  );
  const unique = new Map<string, TrendSignal>();

  for (const signal of signals) {
    const key = signal.url || signal.title.toLowerCase();
    if (unique.has(key)) continue;
    const signalTerms = tokenSet(`${signal.title} ${signal.summary ?? ""}`);
    const queryTerms = tokenSet(signal.query ?? "");
    const overlap = Array.from(terms).filter((term) => signalTerms.has(term)).length;
    const queryOverlap = Array.from(queryTerms).filter((term) => signalTerms.has(term)).length;
    unique.set(key, {
      ...signal,
      relevanceScore: overlap + Math.min(3, queryOverlap)
    });
  }

  return Array.from(unique.values()).sort((left, right) => (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0));
}

function normalizeQuery(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function uniqueQueries(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  const tokenHistory: string[][] = [];
  for (const value of values) {
    const normalized = normalizeQuery(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    const tokens = Array.from(tokenSet(normalized));
    if (tokens.length > 0 && tokenHistory.some((existing) => queryOverlap(tokens, existing) >= 0.86)) continue;
    seen.add(key);
    tokenHistory.push(tokens);
    output.push(normalized);
  }
  return output;
}

function queryOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const hits = left.filter((token) => rightSet.has(token)).length;
  return hits / Math.min(left.length, right.length);
}

function topicQueryModifiers(topic: string, context?: ContentSourceContext): string[] {
  const text = [
    topic,
    context?.product?.title,
    context?.product?.productType,
    context?.product?.tags?.join(" "),
    context?.collection?.title
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const phoneCase = /\b(?:phone|iphone|pixel|samsung)\b.*\bcase\b|\bcase\b.*\b(?:phone|iphone|pixel|samsung)\b/.test(text);
  if (phoneCase) {
    return ["style trend", "gift ideas", "desk setup", "streetwear", "magsafe", "protective accessories"];
  }
  return ["trend", "shopping intent", "buying guide", "gift ideas", "style ideas"];
}

function tokenSet(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !trendStopWords.has(token))
  );
}

function passesRelevanceGate(signal: TrendSignal, context?: ContentSourceContext): boolean {
  if (looksLikeProductListingSignal(signal.title, signal.summary)) return false;
  const hasCatalogAnchor = Boolean(context?.product || context?.collection || context?.seedKeywords?.length);
  if (!hasCatalogAnchor) return true;
  return (signal.relevanceScore ?? 0) > 0;
}

function looksLikeProductListingSignal(title: string, summary?: string): boolean {
  const text = `${title} ${summary ?? ""}`.toLowerCase();
  const productSpecHits = [
    "shockproof",
    "bumper",
    "protector",
    "wireless charging",
    "raised camera",
    "adhesive",
    "compatible",
    "tpu",
    "pc protection"
  ].filter((term) => text.includes(term)).length;
  const commercePattern = /\b(?:case|cover|popsocket|popgrip)\s+(?:for|with)\b/.test(text) || /\bfor\s+(?:iphone|google pixel|samsung)\b/.test(text);
  return commercePattern && productSpecHits >= 2;
}

const trendStopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "shop",
  "guide",
  "tips",
  "trend",
  "trends",
  "blog",
  "topic",
  "best",
  "new",
  "how",
  "choose",
  "use",
  "using"
]);

function withinLookback(value: string | undefined, lookbackDays: number) {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  const oldest = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return date.getTime() >= oldest;
}
