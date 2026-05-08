import { blogCampaignInputSchema } from "@shopify-ai-blog/shared";
import { fail, ok, publicId, readJson, toHandle } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) {
    return fail(400, {
      code: "INVALID_JSON",
      message: "请求体必须是 JSON。"
    });
  }

  const parsed = blogCampaignInputSchema.safeParse(body);
  if (!parsed.success) {
    return fail(422, {
      code: "CAMPAIGN_INPUT_INVALID",
      message: "内容任务参数不完整或格式错误。",
      details: parsed.error.flatten()
    });
  }

  const input = parsed.data;
  const topic = input.topic ?? input.primaryKeyword ?? "Shopify 多语言内容增长";
  const title = `${topic}：从商品卖点到可发布博客的实战指南`;
  const primaryKeyword = input.primaryKeyword ?? topic;

  return ok({
    mode: "mock-contract",
    job: {
      id: publicId("gen"),
      status: "queued",
      nextStep: "worker 接入后执行生成、质检、配图与发布。"
    },
    article: {
      title,
      handle: toHandle(title),
      summary: `围绕「${primaryKeyword}」生成的文章草稿摘要，覆盖搜索意图、商品场景和 Shopify 发布结构。`,
      bodyHtml:
        `<article><h2>${topic}</h2><p>这是一篇由 API route 生成的契约草稿，用于验证前端、任务输入和 worker 对接。` +
        `正式接入内容引擎后，这里会返回带有标题层级、内部链接建议、SEO 描述、图片提示词和多语言质量门槛的完整 HTML。</p>` +
        `<p>当前请求来自店铺 ${input.storeId}，语言为 ${input.locale}，发布策略为 ${input.publishPolicy}。</p></article>`,
      primaryKeyword,
      secondaryKeywords: [input.sourceType, input.locale, "Shopify Blog"],
      tags: ["ai-generated", input.locale, input.sourceType],
      locale: input.locale,
      seoScore: 82,
      qualityPassed: true
    },
    input
  });
}
