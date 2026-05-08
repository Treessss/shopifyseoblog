export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const DEFAULT_SHOPIFY_API_VERSION = "2026-04";

export interface ShopifyGraphQLClientConfig {
  shop?: string;
  shopDomain?: string;
  accessToken: string;
  apiVersion?: string;
  endpoint?: string;
  headers?: Record<string, string>;
  fetch?: FetchLike;
}

export interface ShopifyGraphQLResult<TData> {
  data: TData;
  extensions?: unknown;
}

export interface ShopifyGraphQLRequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class ShopifyError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
    readonly status?: number
  ) {
    super(message);
    this.name = "ShopifyError";
  }
}

export class ShopifyGraphQLError extends ShopifyError {
  constructor(message: string, readonly errors: unknown, status?: number) {
    super(message, errors, status);
    this.name = "ShopifyGraphQLError";
  }
}

export class ShopifyGraphQLClient {
  readonly shopDomain: string;
  readonly apiVersion: string;
  readonly endpoint: string;

  private readonly accessToken: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: FetchLike;

  constructor(config: ShopifyGraphQLClientConfig) {
    const shop = config.shopDomain ?? config.shop;
    if (!shop && !config.endpoint) {
      throw new ShopifyError("Shopify shopDomain or endpoint is required.");
    }

    this.shopDomain = shop ? normalizeShopDomain(shop) : "";
    this.apiVersion = config.apiVersion ?? DEFAULT_SHOPIFY_API_VERSION;
    this.endpoint = config.endpoint ?? `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
    this.accessToken = config.accessToken;
    this.headers = config.headers ?? {};
    this.fetchImpl = config.fetch ?? getGlobalFetch();

    if (!this.accessToken) {
      throw new ShopifyError("Shopify accessToken is required.");
    }
  }

  async rawRequest<TData, TVariables extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    variables?: TVariables,
    options?: ShopifyGraphQLRequestOptions
  ): Promise<ShopifyGraphQLResult<TData>> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": this.accessToken,
        ...this.headers,
        ...options?.headers
      },
      body: JSON.stringify(removeUndefined({ query, variables })),
      signal: options?.signal
    });

    const payload = await readJson(response);
    if (!response.ok) {
      throw new ShopifyError(`Shopify GraphQL request failed with HTTP ${response.status}.`, payload, response.status);
    }

    if (isRecord(payload) && payload.errors) {
      throw new ShopifyGraphQLError("Shopify GraphQL returned errors.", payload.errors, response.status);
    }

    if (!isRecord(payload) || !("data" in payload)) {
      throw new ShopifyError("Shopify GraphQL response did not include data.", payload, response.status);
    }

    return {
      data: payload.data as TData,
      extensions: payload.extensions
    };
  }

  async request<TData, TVariables extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    variables?: TVariables,
    options?: ShopifyGraphQLRequestOptions
  ): Promise<TData> {
    const result = await this.rawRequest<TData, TVariables>(query, variables, options);
    return result.data;
  }
}

export function createShopifyGraphQLClient(config: ShopifyGraphQLClientConfig): ShopifyGraphQLClient {
  return new ShopifyGraphQLClient(config);
}

export function normalizeShopDomain(shop: string): string {
  let normalized = shop.trim().toLowerCase();
  if (normalized.includes("://")) {
    normalized = new URL(normalized).hostname;
  }

  normalized = normalized.replace(/\/.*$/, "");
  if (/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    normalized = `${normalized}.myshopify.com`;
  }

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
    throw new ShopifyError("Shopify shop must be a myshopify.com domain.");
  }

  return normalized;
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

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function getGlobalFetch(): FetchLike {
  if (typeof fetch !== "function") {
    throw new ShopifyError("No fetch implementation is available.");
  }
  return fetch.bind(globalThis) as FetchLike;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
