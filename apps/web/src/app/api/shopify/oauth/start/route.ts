import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { fail, getAppUrl, getEnv } from "@/lib/api";
import { buildShopifyOAuthUrl, parseShopDomain } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const parsedShop = parseShopDomain(request.nextUrl.searchParams.get("shop"));
  if (!parsedShop.success) {
    return fail(400, {
      code: "SHOP_DOMAIN_INVALID",
      message: "shop 参数必须是合法的 myshopify.com 域名。"
    });
  }

  const apiKey = getEnv("SHOPIFY_API_KEY");
  if (!apiKey) {
    return fail(500, {
      code: "SHOPIFY_API_KEY_MISSING",
      message: "缺少 SHOPIFY_API_KEY，无法开始 OAuth。"
    });
  }

  const state = randomUUID();
  const scopes = getEnv("SHOPIFY_SCOPES") ?? "read_products,read_content,write_content";
  const appUrl = getAppUrl(request.url);
  const redirectUrl = buildShopifyOAuthUrl({
    shop: parsedShop.data,
    apiKey,
    scopes,
    appUrl,
    state
  });

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/"
  });
  return response;
}
