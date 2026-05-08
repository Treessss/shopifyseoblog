import { createHmac, timingSafeEqual } from "node:crypto";
import { shopDomainSchema } from "@shopify-ai-blog/shared";

export function parseShopDomain(input: string | null) {
  return shopDomainSchema.safeParse(input ?? "");
}

export function buildShopifyOAuthUrl(options: {
  shop: string;
  apiKey: string;
  scopes: string;
  appUrl: string;
  state: string;
}) {
  const redirectUri = new URL("/api/shopify/oauth/callback", options.appUrl);
  const url = new URL(`https://${options.shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", options.apiKey);
  url.searchParams.set("scope", options.scopes);
  url.searchParams.set("redirect_uri", redirectUri.toString());
  url.searchParams.set("state", options.state);
  return url;
}

export function verifyShopifyOAuthHmac(searchParams: URLSearchParams, secret: string) {
  const provided = searchParams.get("hmac");
  if (!provided) return false;

  const message = [...searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const digest = createHmac("sha256", secret).update(message).digest("hex");
  return safeCompare(digest, provided);
}

export function verifyShopifyWebhookHmac(rawBody: string, hmacHeader: string | null, secret: string) {
  if (!hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return safeCompare(digest, hmacHeader);
}

function safeCompare(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
