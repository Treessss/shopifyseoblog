import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeShopDomain, ShopifyError, type FetchLike } from "./client";

export const SHOPIFY_BLOG_CONTENT_SCOPES = ["read_products", "read_content", "write_content"] as const;

export interface ShopifyOAuthUrlOptions {
  shop: string;
  apiKey: string;
  scopes?: readonly string[] | string;
  redirectUri: string;
  state: string;
  grantOptions?: readonly string[];
}

export interface ShopifyOAuthExchangeOptions {
  shop: string;
  apiKey: string;
  apiSecret: string;
  code: string;
  fetch?: FetchLike;
}

export interface ShopifyClientCredentialsExchangeOptions {
  shop: string;
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
}

export interface ShopifyOAuthTokenResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
  associated_user_scope?: string;
  associated_user?: unknown;
}

export type ShopifyHmacInput =
  | URL
  | URLSearchParams
  | string
  | Record<string, string | string[] | number | boolean | null | undefined>;

export function buildShopifyOAuthUrl(options: ShopifyOAuthUrlOptions): string {
  const shopDomain = normalizeShopDomain(options.shop);
  const scopes = typeof options.scopes === "string" ? options.scopes : (options.scopes ?? SHOPIFY_BLOG_CONTENT_SCOPES).join(",");
  const params = new URLSearchParams({
    client_id: options.apiKey,
    scope: scopes,
    redirect_uri: options.redirectUri,
    state: options.state
  });

  for (const grantOption of options.grantOptions ?? []) {
    params.append("grant_options[]", grantOption);
  }

  return `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
}

export async function exchangeShopifyOAuthCode(options: ShopifyOAuthExchangeOptions): Promise<ShopifyOAuthTokenResponse> {
  const shopDomain = normalizeShopDomain(options.shop);
  const fetchImpl = options.fetch ?? getGlobalFetch();
  const response = await fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      client_id: options.apiKey,
      client_secret: options.apiSecret,
      code: options.code
    })
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw new ShopifyError(`Shopify OAuth exchange failed with HTTP ${response.status}.`, payload, response.status);
  }

  return payload as ShopifyOAuthTokenResponse;
}

export async function exchangeShopifyClientCredentials(
  options: ShopifyClientCredentialsExchangeOptions
): Promise<ShopifyOAuthTokenResponse> {
  const shopDomain = normalizeShopDomain(options.shop);
  const fetchImpl = options.fetch ?? getGlobalFetch();
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: options.clientId,
    client_secret: options.clientSecret
  });

  const response = await fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: body.toString()
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw new ShopifyError(`Shopify client credentials exchange failed with HTTP ${response.status}.`, payload, response.status);
  }

  return payload as ShopifyOAuthTokenResponse;
}

export function calculateShopifyHmac(input: ShopifyHmacInput, apiSecret: string): string {
  return createHmac("sha256", apiSecret).update(buildShopifyHmacMessage(input)).digest("hex");
}

export function verifyShopifyOAuthHmac(input: ShopifyHmacInput, apiSecret: string, expectedHmac?: string): boolean {
  const providedHmac = expectedHmac ?? getProvidedHmac(input);
  if (!providedHmac) return false;

  const calculated = calculateShopifyHmac(input, apiSecret);
  const providedBuffer = Buffer.from(providedHmac, "utf8");
  const calculatedBuffer = Buffer.from(calculated, "utf8");
  if (providedBuffer.length !== calculatedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, calculatedBuffer);
}

export function buildShopifyHmacMessage(input: ShopifyHmacInput): string {
  const params = toSearchParams(input);
  const entries = Array.from(params.entries())
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyCompare = leftKey.localeCompare(rightKey);
      return keyCompare === 0 ? leftValue.localeCompare(rightValue) : keyCompare;
    });

  return entries.map(([key, value]) => `${key}=${value}`).join("&");
}

function getProvidedHmac(input: ShopifyHmacInput): string | undefined {
  return toSearchParams(input).get("hmac") ?? undefined;
}

function toSearchParams(input: ShopifyHmacInput): URLSearchParams {
  if (input instanceof URL) return input.searchParams;
  if (input instanceof URLSearchParams) return input;
  if (typeof input === "string") {
    return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.append(key, String(value));
    }
  }
  return params;
}

function getGlobalFetch(): FetchLike {
  if (typeof fetch !== "function") {
    throw new ShopifyError("No fetch implementation is available.");
  }
  return fetch.bind(globalThis) as FetchLike;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}
