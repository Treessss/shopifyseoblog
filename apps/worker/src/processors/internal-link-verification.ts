import type { ContentSourceContext, InternalLinkCandidate } from "@shopify-ai-blog/content-engine";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface InternalLinkVerificationOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

const DEFAULT_LINK_TIMEOUT_MS = 4500;
const CONFIRMED_BLOCKED_STATUSES = new Set([401, 403]);
const MISSING_STATUSES = new Set([404, 410, 451]);

export async function verifyInternalLinkCandidates(
  links: InternalLinkCandidate[],
  options: InternalLinkVerificationOptions = {}
): Promise<InternalLinkCandidate[]> {
  if (links.length === 0) return [];

  const fetchImpl = options.fetch ?? getGlobalFetch();
  const timeoutMs = options.timeoutMs ?? DEFAULT_LINK_TIMEOUT_MS;
  const checks = new Map<string, Promise<boolean>>();

  const verified = await Promise.all(
    links.map(async (link) => {
      if (!isHttpUrl(link.url)) return null;
      const key = normalizeInternalLinkUrl(link.url);
      const check = checks.get(key) ?? verifyPublicUrl(link.url, fetchImpl, timeoutMs);
      checks.set(key, check);
      return (await check) ? link : null;
    })
  );

  return verified.filter((link): link is InternalLinkCandidate => Boolean(link));
}

export function sanitizeArticleInternalLinks(
  bodyHtml: string,
  context: Pick<ContentSourceContext, "storefrontHost" | "internalLinks">
): string {
  const allowedUrls = new Map<string, string>();
  const internalHosts = new Set<string>();

  if (context.storefrontHost) {
    const host = normalizeHost(context.storefrontHost);
    if (host) internalHosts.add(host);
  }

  for (const link of context.internalLinks ?? []) {
    const key = normalizeInternalLinkUrl(link.url);
    if (!key) continue;
    allowedUrls.set(key, link.url);
    const host = hostFromUrl(link.url);
    if (host) internalHosts.add(host);
  }

  if (allowedUrls.size === 0 && internalHosts.size === 0) return bodyHtml;

  return bodyHtml.replace(
    /<a\b([^>]*)\shref=(["'])([^"']+)\2([^>]*)>([\s\S]*?)<\/a>/gi,
    (match, before: string, _quote: string, href: string, after: string, innerHtml: string) => {
      if (!isHttpUrl(href)) return match;

      const key = normalizeInternalLinkUrl(href);
      const host = hostFromUrl(href);
      const isInternal = allowedUrls.has(key) || Boolean(host && internalHosts.has(host));
      if (!isInternal) return match;

      const canonicalHref = allowedUrls.get(key);
      if (canonicalHref) {
        return `<a${before} href="${escapeHtmlAttribute(canonicalHref)}"${after}>${innerHtml}</a>`;
      }

      return innerHtml;
    }
  );
}

export function normalizeInternalLinkUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/g, "")}`;
  } catch {
    return value.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/g, "");
  }
}

async function verifyPublicUrl(url: string, fetchImpl: FetchLike, timeoutMs: number): Promise<boolean> {
  const head = await fetchWithTimeout(fetchImpl, url, "HEAD", timeoutMs);
  if (head && isConfirmedStatus(head.status)) return true;
  if (head && MISSING_STATUSES.has(head.status)) return false;

  const get = await fetchWithTimeout(fetchImpl, url, "GET", timeoutMs);
  return Boolean(get && isConfirmedStatus(get.status));
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  method: "GET" | "HEAD",
  timeoutMs: number
): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 Shopify-AI-Blog-Link-Validator"
      }
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isConfirmedStatus(status: number): boolean {
  return (status >= 200 && status < 400) || CONFIRMED_BLOCKED_STATUSES.has(status);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hostFromUrl(value: string): string | undefined {
  try {
    return normalizeHost(new URL(value).hostname);
  } catch {
    return undefined;
  }
}

function normalizeHost(value: string): string | undefined {
  const host = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  return host || undefined;
}

function getGlobalFetch(): FetchLike {
  if (typeof fetch !== "function") {
    throw new Error("No fetch implementation is available for internal link verification.");
  }
  return fetch.bind(globalThis) as FetchLike;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
