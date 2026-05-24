import type { ContentSourceContext, EntityInsight } from "./types";

export interface EntityCandidate {
  name: string;
  type: EntityInsight["type"];
  source: "known_ip" | "catalog_hint";
  confidence: number;
  evidence: string[];
  queries: string[];
}

export interface DiscoverEntityInsightsInput {
  topic?: string;
  locale?: string;
  context?: ContentSourceContext;
  fetch?: typeof fetch;
}

const KNOWN_ENTITY_PATTERNS: Array<{
  name: string;
  aliases: string[];
  type: EntityInsight["type"];
}> = [
  { name: "Curious George", aliases: ["curious george"], type: "ip_character" },
  { name: "Hello Kitty", aliases: ["hello kitty"], type: "ip_character" },
  { name: "Kuromi", aliases: ["kuromi"], type: "ip_character" },
  { name: "Cinnamoroll", aliases: ["cinnamoroll"], type: "ip_character" },
  { name: "My Melody", aliases: ["my melody"], type: "ip_character" },
  { name: "Miffy", aliases: ["miffy"], type: "ip_character" },
  { name: "Snoopy", aliases: ["snoopy", "peanuts"], type: "ip_character" },
  { name: "Stitch", aliases: ["stitch", "lilo stitch", "lilo & stitch"], type: "ip_character" },
  { name: "Mickey Mouse", aliases: ["mickey mouse", "mickey"], type: "ip_character" },
  { name: "Winnie-the-Pooh", aliases: ["winnie the pooh", "pooh bear"], type: "ip_character" },
  { name: "Pokemon", aliases: ["pokemon", "pokémon", "pikachu"], type: "pop_culture" },
  { name: "SpongeBob SquarePants", aliases: ["spongebob", "spongebob squarepants"], type: "ip_character" },
  { name: "Street Fighter", aliases: ["street fighter"], type: "pop_culture" },
  { name: "Super Mario", aliases: ["super mario", "mario"], type: "pop_culture" },
  { name: "Spider-Man", aliases: ["spider-man", "spiderman"], type: "ip_character" },
  { name: "Batman", aliases: ["batman"], type: "ip_character" },
  { name: "Barbie", aliases: ["barbie"], type: "pop_culture" }
];

const ENTITY_MARKERS = [
  "anime",
  "cartoon",
  "character",
  "comic",
  "manga",
  "movie",
  "film",
  "game",
  "kawaii",
  "mascot",
  "sanrio",
  "disney",
  "marvel",
  "dc comics",
  "pixar",
  "联名",
  "卡通",
  "动漫",
  "动画",
  "角色",
  "人物",
  "电影",
  "游戏",
  "漫画"
];

const CATALOG_ENTITY_STOP_WORDS = new Set([
  "apple",
  "iphone",
  "samsung",
  "galaxy",
  "pixel",
  "magsafe",
  "phone",
  "case",
  "cover",
  "clear",
  "silicone",
  "tpu",
  "shockproof",
  "caseease",
  "google",
  "amazon",
  "shopify",
  "pro",
  "max",
  "air"
]);

export async function discoverEntityInsights(input: DiscoverEntityInsightsInput): Promise<EntityInsight[]> {
  const candidates = detectEntityCandidates(input.context, input.topic);
  if (candidates.length === 0) return [];

  const fetchImpl = input.fetch ?? fetch;
  const insights: EntityInsight[] = [];

  for (const candidate of candidates.slice(0, 4)) {
    const fetched = candidate.source === "known_ip" ? await fetchEntitySummary(candidate, input.locale, fetchImpl) : undefined;
    if (fetched) {
      insights.push(fetched);
      continue;
    }
    insights.push({
      name: candidate.name,
      type: candidate.type,
      source: "Shopify catalog hint",
      confidence: Math.min(candidate.confidence, 72),
      summary:
        "Catalog text suggests this may reference a character, IP, or pop-culture theme. Treat it as a style cue until an external source or product data confirms details.",
      query: candidate.queries[0],
      evidence: candidate.evidence,
      verified: false
    });
  }

  return dedupeEntityInsights(insights).slice(0, 4);
}

export function detectEntityCandidates(context: ContentSourceContext | undefined, topic?: string): EntityCandidate[] {
  const textParts = catalogTextParts(context, topic);
  const text = textParts.join(" ");
  const normalized = normalizeEntityText(text);
  const candidates: EntityCandidate[] = [];

  for (const entry of KNOWN_ENTITY_PATTERNS) {
    if (!entry.aliases.some((alias) => normalized.includes(normalizeEntityText(alias)))) continue;
    candidates.push({
      name: entry.name,
      type: entry.type,
      source: "known_ip",
      confidence: 92,
      evidence: textParts.filter((part) => normalizeEntityText(part).includes(normalizeEntityText(entry.aliases[0] ?? entry.name))).slice(0, 3),
      queries: entityQueries(entry.name, context)
    });
  }

  if (hasEntityMarker(normalized)) {
    for (const name of extractTitleCaseEntityNames(text)) {
      if (candidates.some((candidate) => sameEntity(candidate.name, name))) continue;
      candidates.push({
        name,
        type: markerEntityType(normalized),
        source: "catalog_hint",
        confidence: 68,
        evidence: textParts.filter((part) => part.includes(name)).slice(0, 3),
        queries: entityQueries(name, context)
      });
    }
  }

  return candidates
    .filter((candidate) => candidate.name.length >= 3)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 6);
}

function catalogTextParts(context: ContentSourceContext | undefined, topic?: string): string[] {
  return [
    topic,
    context?.topic,
    context?.product?.title,
    context?.product?.seoTitle,
    context?.product?.seoDescription,
    context?.product?.productType,
    context?.product?.vendor,
    context?.product?.tags?.join(" "),
    context?.product?.facts?.join(" "),
    context?.collection?.title,
    context?.collection?.description,
    context?.seedKeywords?.join(" ")
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => stripTags(value).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function hasEntityMarker(text: string): boolean {
  return ENTITY_MARKERS.some((marker) => text.includes(normalizeEntityText(marker)));
}

function markerEntityType(text: string): EntityInsight["type"] {
  if (/movie|film|game|电影|游戏/.test(text)) return "pop_culture";
  return "ip_character";
}

function extractTitleCaseEntityNames(text: string): string[] {
  const matches = text.match(/\b[A-Z][A-Za-z0-9'&.-]*(?:\s+[A-Z][A-Za-z0-9'&.-]*){0,3}\b/g) ?? [];
  return uniqueStrings(
    matches
      .map((match) =>
        match
          .replace(/\b(?:Phone|Case|Cover|For|With|Design|Pattern|Cute|Shockproof|Protection|Guard|Compatible|Series|Pro|Max)\b/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter((match) => {
        const tokens = normalizeEntityText(match).split(/\s+/).filter(Boolean);
        if (tokens.length === 0 || tokens.length > 4) return false;
        if (tokens.every((token) => CATALOG_ENTITY_STOP_WORDS.has(token))) return false;
        if (tokens.some((token) => /^\d+$/.test(token))) return false;
        return true;
      })
  );
}

async function fetchEntitySummary(
  candidate: EntityCandidate,
  locale: string | undefined,
  fetchImpl: typeof fetch
): Promise<EntityInsight | undefined> {
  const languages = wikiLanguages(locale);
  for (const language of languages) {
    try {
      const response = await fetchImpl(wikipediaSummaryUrl(candidate.name, language), {
        headers: {
          accept: "application/json",
          "user-agent": "shopify-ai-blog-entity-scout/0.1"
        }
      });
      if (!response.ok) continue;
      const data = (await response.json()) as Record<string, unknown>;
      const type = typeof data.type === "string" ? data.type : "";
      if (type === "disambiguation") continue;
      const title = stringValue(data.title) ?? candidate.name;
      const extract = stringValue(data.extract);
      const pageUrl = pageUrlFromSummary(data);
      if (!extract || !pageUrl) continue;
      if (!entitySummaryLooksRelevant(candidate, title, extract)) continue;
      return {
        name: title,
        type: candidate.type,
        source: `Wikipedia (${language})`,
        url: pageUrl,
        summary: compactSummary(extract),
        query: candidate.queries[0],
        confidence: clampScore(candidate.confidence + 4),
        evidence: candidate.evidence,
        verified: true
      };
    } catch {
      continue;
    }
  }
  return undefined;
}

function wikipediaSummaryUrl(name: string, language: string): string {
  return `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/\s+/g, "_"))}`;
}

function wikiLanguages(locale?: string): string[] {
  if (locale?.startsWith("zh")) return ["zh", "en"];
  if (locale?.startsWith("ja")) return ["ja", "en"];
  return ["en"];
}

function pageUrlFromSummary(data: Record<string, unknown>): string | undefined {
  const urls = isRecord(data.content_urls) ? data.content_urls : undefined;
  const desktop = urls && isRecord(urls.desktop) ? urls.desktop : undefined;
  return stringValue(desktop?.page);
}

function entitySummaryLooksRelevant(candidate: EntityCandidate, title: string, extract: string): boolean {
  const candidateTokens = tokenSet(candidate.name);
  const titleTokens = tokenSet(title);
  const extractTokens = tokenSet(extract);
  const titleOverlap = Array.from(candidateTokens).filter((token) => titleTokens.has(token)).length;
  const extractOverlap = Array.from(candidateTokens).filter((token) => extractTokens.has(token)).length;
  return titleOverlap > 0 || extractOverlap >= Math.min(2, candidateTokens.size);
}

function entityQueries(name: string, context: ContentSourceContext | undefined): string[] {
  const productType = context?.product?.productType ?? context?.collection?.title ?? "phone case";
  return uniqueStrings([
    `${name} character background`,
    `${name} ${productType}`,
    `${name} gift ideas`,
    `${name} trend`,
    `${name} cartoon`
  ]);
}

function dedupeEntityInsights(items: EntityInsight[]): EntityInsight[] {
  const seen = new Set<string>();
  const output: EntityInsight[] = [];
  for (const item of items) {
    const key = normalizeEntityText(item.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function normalizeEntityText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameEntity(left: string, right: string): boolean {
  return normalizeEntityText(left) === normalizeEntityText(right);
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeEntityText(value)
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !CATALOG_ENTITY_STOP_WORDS.has(token))
  );
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function compactSummary(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 360 ? `${clean.slice(0, 357).trim()}...` : clean;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalizeEntityText(normalized);
    if (!normalized || !key || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
