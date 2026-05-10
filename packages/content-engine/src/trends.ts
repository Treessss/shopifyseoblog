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
  const sources = config.sources?.length ? config.sources : ["google_news", "google_trends"];
  const query = buildTrendQuery(input.topic, input.context, config.query);
  const collected: TrendSignal[] = [];

  for (const source of sources) {
    try {
      const url = source === "google_trends" ? googleTrendsRssUrl(config.geo) : googleNewsRssUrl(query, input.locale, config.geo);
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
          "user-agent": "shopify-ai-blog-trend-scout/0.1"
        }
      });
      if (!response.ok) continue;
      const xml = await response.text();
      collected.push(...parseRssItems(xml, source));
    } catch {
      continue;
    }
  }

  return rankTrendSignals(collected, query, input.context)
    .filter((signal) => withinLookback(signal.publishedAt, config.lookbackDays ?? 7))
    .slice(0, maxItems);
}

function buildTrendQuery(topic: string, context: ContentSourceContext | undefined, configured?: string) {
  return [
    configured,
    topic,
    context?.product?.productType,
    context?.product?.title,
    context?.collection?.title,
    context?.seedKeywords?.slice(0, 3).join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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

function parseRssItems(xml: string, source: string): TrendSignal[] {
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
      source: SOURCE_LABELS[source] ?? source
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
  const terms = tokenSet([query, context?.product?.title, context?.product?.productType, context?.collection?.title].filter(Boolean).join(" "));
  const unique = new Map<string, TrendSignal>();

  for (const signal of signals) {
    const key = signal.url || signal.title.toLowerCase();
    if (unique.has(key)) continue;
    const signalTerms = tokenSet(`${signal.title} ${signal.summary ?? ""}`);
    const overlap = Array.from(terms).filter((term) => signalTerms.has(term)).length;
    unique.set(key, {
      ...signal,
      relevanceScore: overlap
    });
  }

  return Array.from(unique.values()).sort((left, right) => (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0));
}

function tokenSet(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  );
}

function withinLookback(value: string | undefined, lookbackDays: number) {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  const oldest = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return date.getTime() >= oldest;
}
