import { blogCampaignInputSchema } from "@shopify-ai-blog/shared";
import { prisma } from "@shopify-ai-blog/db";
import { fail, ok, readJson } from "@/lib/api";

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
  const store = await prisma.shopifyStore.findFirst({
    where: {
      id: input.storeId,
      organizationId: input.organizationId
    }
  });

  if (!store) {
    return fail(404, {
      code: "STORE_NOT_FOUND",
      message: "未找到当前组织下的 Shopify 店铺。"
    });
  }

  const topic = input.topic ?? input.primaryKeyword ?? "Shopify 多语言内容增长";
  const campaign = await prisma.blogCampaign.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      locale: input.locale,
      title: topic,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      topic,
      status: "active",
      publishPolicy: input.publishPolicy,
      targetWordCount: input.targetWordCount,
      primaryKeyword: input.primaryKeyword,
      keywords: input.primaryKeyword ? [input.primaryKeyword] : [],
      metadata: {
        generationConfig: input.generationConfig
      }
    }
  });

  const job = await prisma.publishJob.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      type: "generate_article",
      status: "queued",
      payload: {
        ...input,
        campaignId: campaign.id,
        generationConfig: input.generationConfig,
        queue: "blog-generation",
        jobName: "blog.generate"
      }
    }
  });

  await prisma.publishLog.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      jobId: job.id,
      event: "queued",
      level: "info",
      message: `Queued blog generation for ${topic}.`,
      payload: {
        campaignId: campaign.id,
        jobType: job.type
      }
    }
  });

  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      action: "generate",
      entityType: "blog_campaign",
      entityId: campaign.id,
      metadata: {
        jobId: job.id,
        sourceType: input.sourceType,
        locale: input.locale
      }
    }
  });

  return ok({
    mode: "database-queued",
    job: {
      id: job.id,
      status: job.status,
      type: job.type,
      runAt: job.runAt.toISOString()
    },
    campaign: {
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      storeId: campaign.storeId,
      locale: campaign.locale
    },
    input
  });
}
