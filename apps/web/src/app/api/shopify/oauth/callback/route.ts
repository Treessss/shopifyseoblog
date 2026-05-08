import type { NextRequest } from "next/server";
import { fail, getEnv, ok } from "@/lib/api";
import { parseShopDomain, verifyShopifyOAuthHmac } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsedShop = parseShopDomain(params.get("shop"));
  if (!parsedShop.success) {
    return fail(400, {
      code: "SHOP_DOMAIN_INVALID",
      message: "shop 参数必须是合法的 myshopify.com 域名。"
    });
  }

  const code = params.get("code");
  if (!code) {
    return fail(400, {
      code: "SHOPIFY_CODE_MISSING",
      message: "Shopify OAuth callback 缺少 code。"
    });
  }

  const expectedState = request.cookies.get("shopify_oauth_state")?.value;
  const state = params.get("state");
  if (!expectedState || state !== expectedState) {
    return fail(401, {
      code: "SHOPIFY_STATE_MISMATCH",
      message: "OAuth state 校验失败。"
    });
  }

  const secret = getEnv("SHOPIFY_API_SECRET");
  if (!secret) {
    return fail(500, {
      code: "SHOPIFY_API_SECRET_MISSING",
      message: "缺少 SHOPIFY_API_SECRET，无法校验 OAuth HMAC。"
    });
  }

  if (!verifyShopifyOAuthHmac(params, secret)) {
    return fail(401, {
      code: "SHOPIFY_HMAC_INVALID",
      message: "Shopify OAuth HMAC 校验失败。"
    });
  }

  const response = ok({
    shop: parsedShop.data,
    codeReceived: true,
    hmacVerified: true,
    nextStep: "用 code 交换 access token，并保存店铺授权记录。"
  });

  response.cookies.delete("shopify_oauth_state");
  return response;
}
