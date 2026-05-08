import { type NextRequest } from "next/server";
import { fail, getEnv, ok } from "@/lib/api";
import { parseShopDomain, verifyShopifyWebhookHmac } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = getEnv("SHOPIFY_API_SECRET");
  if (!secret) {
    return fail(500, {
      code: "SHOPIFY_API_SECRET_MISSING",
      message: "缺少 SHOPIFY_API_SECRET，无法校验 webhook。"
    });
  }

  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhookHmac(rawBody, hmac, secret)) {
    return fail(401, {
      code: "SHOPIFY_WEBHOOK_HMAC_INVALID",
      message: "Shopify webhook HMAC 校验失败。"
    });
  }

  const parsedShop = parseShopDomain(request.headers.get("x-shopify-shop-domain"));
  if (!parsedShop.success) {
    return fail(400, {
      code: "SHOP_DOMAIN_INVALID",
      message: "x-shopify-shop-domain 必须是合法的 myshopify.com 域名。"
    });
  }

  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = rawBody;
  }

  return ok({
    accepted: true,
    shop: parsedShop.data,
    topic: request.headers.get("x-shopify-topic"),
    webhookId: request.headers.get("x-shopify-webhook-id"),
    receivedAt: new Date().toISOString(),
    payloadPreview: typeof payload === "object" && payload !== null ? Object.keys(payload).slice(0, 10) : "raw"
  });
}
