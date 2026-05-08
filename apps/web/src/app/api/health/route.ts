import { DEFAULT_LOCALE } from "@shopify-ai-blog/shared";
import { ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok({
    service: "shopify-ai-blog-web",
    status: "ok",
    timestamp: new Date().toISOString(),
    locale: process.env.DEFAULT_LOCALE ?? DEFAULT_LOCALE,
    checks: {
      aiConfigured: Boolean(process.env.AI_API_KEY),
      shopifyConfigured: Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET),
      appUrlConfigured: Boolean(process.env.APP_URL)
    }
  });
}
