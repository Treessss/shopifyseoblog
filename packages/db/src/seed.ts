import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "./encryption";

const prisma = new PrismaClient();

const DEFAULT_LOCALES = [
  { locale: "zh-CN", label: "简体中文", isDefault: true },
  { locale: "en-US", label: "English", isDefault: false }
] as const;

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: "demo" },
    update: {
      name: "Demo Organization",
      status: "active",
      locale: "zh-CN",
      timezone: "Asia/Shanghai"
    },
    create: {
      name: "Demo Organization",
      slug: "demo",
      status: "active",
      locale: "zh-CN",
      timezone: "Asia/Shanghai"
    }
  });

  const user = await prisma.user.upsert({
    where: { email: process.env.DEMO_USER_EMAIL ?? "demo@example.com" },
    update: {
      name: "Demo Admin"
    },
    create: {
      email: process.env.DEMO_USER_EMAIL ?? "demo@example.com",
      name: "Demo Admin"
    }
  });

  await prisma.membership.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id
      }
    },
    update: {
      role: "owner",
      status: "active",
      acceptedAt: new Date()
    },
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: "owner",
      status: "active",
      acceptedAt: new Date()
    }
  });

  const shopDomain = process.env.DEMO_SHOP_DOMAIN ?? "demo.myshopify.com";
  const store = await prisma.shopifyStore.upsert({
    where: { myshopifyDomain: shopDomain },
    update: {
      name: "Demo Store",
      status: "active",
      primaryLocale: "zh-CN",
      apiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-04",
      adminAccessTokenEncrypted: encryptOptional(process.env.DEMO_SHOPIFY_ACCESS_TOKEN),
      webhookSecretEncrypted: encryptOptional(process.env.DEMO_SHOPIFY_WEBHOOK_SECRET)
    },
    create: {
      organizationId: organization.id,
      name: "Demo Store",
      myshopifyDomain: shopDomain,
      status: "active",
      primaryLocale: "zh-CN",
      apiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-04",
      installedAt: new Date(),
      adminAccessTokenEncrypted: encryptOptional(process.env.DEMO_SHOPIFY_ACCESS_TOKEN),
      webhookSecretEncrypted: encryptOptional(process.env.DEMO_SHOPIFY_WEBHOOK_SECRET),
      scopes: (process.env.SHOPIFY_SCOPES ?? "read_products,read_content,write_content")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean)
    }
  });

  await prisma.shopifyStore.update({
    where: { id: store.id },
    data: {
      lastSyncedAt: new Date(),
      metadata: {
        seed: true,
        source: "db:seed"
      }
    }
  });

  for (const locale of DEFAULT_LOCALES) {
    await prisma.localeConfig.upsert({
      where: {
        storeId_locale: {
          storeId: store.id,
          locale: locale.locale
        }
      },
      update: {
        label: locale.label,
        isDefault: locale.isDefault,
        isEnabled: true
      },
      create: {
        organizationId: organization.id,
        storeId: store.id,
        locale: locale.locale,
        label: locale.label,
        isDefault: locale.isDefault,
        isEnabled: true
      }
    });
  }

  await prisma.aiProviderConfig.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: "default-openai-compatible"
      }
    },
    update: {
      name: "Default OpenAI-compatible Provider",
      provider: "compatible",
      baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
      apiKeyEncrypted: encryptOptional(process.env.AI_API_KEY),
      textModel: process.env.AI_TEXT_MODEL ?? "gpt-4.1",
      imageModel: process.env.AI_IMAGE_MODEL ?? "gpt-image-1",
      temperature: 0.8,
      enabled: true,
      isDefault: true
    },
    create: {
      organizationId: organization.id,
      slug: "default-openai-compatible",
      name: "Default OpenAI-compatible Provider",
      provider: "compatible",
      baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
      apiKeyEncrypted: encryptOptional(process.env.AI_API_KEY),
      textModel: process.env.AI_TEXT_MODEL ?? "gpt-4.1",
      imageModel: process.env.AI_IMAGE_MODEL ?? "gpt-image-1",
      temperature: 0.8,
      enabled: true,
      isDefault: true
    }
  });

  await prisma.brandVoice.upsert({
    where: {
      organizationId_storeId_locale_name: {
        organizationId: organization.id,
        storeId: store.id,
        locale: "zh-CN",
        name: "Demo Brand Voice"
      }
    },
    update: {
      audience: "Shopify store shoppers",
      tone: "清晰、可信、带有轻度顾问感",
      isDefault: true
    },
    create: {
      organizationId: organization.id,
      storeId: store.id,
      locale: "zh-CN",
      name: "Demo Brand Voice",
      audience: "Shopify store shoppers",
      tone: "清晰、可信、带有轻度顾问感",
      examples: ["用具体场景解释产品价值，避免空泛营销词。"],
      isDefault: true
    }
  });

  const campaign = await upsertDemoCampaign({
    organizationId: organization.id,
    storeId: store.id,
    brandVoiceName: "Demo Brand Voice"
  });

  await seedSnapshots({
    organizationId: organization.id,
    storeId: store.id
  });

  await seedArticles({
    organizationId: organization.id,
    storeId: store.id,
    campaignId: campaign.id
  });

  await seedPublishLogs({
    organizationId: organization.id,
    storeId: store.id,
    campaignId: campaign.id
  });

  const seedLog = await prisma.auditLog.findFirst({
    where: {
      organizationId: organization.id,
      action: "create",
      entityType: "seed",
      entityId: organization.id
    }
  });

  if (!seedLog) {
    await prisma.auditLog.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        storeId: store.id,
        action: "create",
        entityType: "seed",
        entityId: organization.id,
        metadata: {
          locales: DEFAULT_LOCALES.map((locale) => locale.locale)
        }
      }
    });
  }

  console.log(`Seeded demo organization ${organization.slug} with store ${store.myshopifyDomain}.`);
}

function encryptOptional(value: string | undefined): string | null {
  if (!value) return null;
  return encryptSecret(value);
}

async function upsertDemoCampaign(input: {
  organizationId: string;
  storeId: string;
  brandVoiceName: string;
}) {
  const brandVoice = await prisma.brandVoice.findFirst({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      name: input.brandVoiceName
    }
  });

  const existing = await prisma.blogCampaign.findFirst({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      title: "春夏新品关键词集群"
    }
  });

  const data = {
    organizationId: input.organizationId,
    storeId: input.storeId,
    brandVoiceId: brandVoice?.id,
    locale: "zh-CN",
    title: "春夏新品关键词集群",
    sourceType: "collection" as const,
    sourceId: "gid://shopify/Collection/demo-summer-essentials",
    topic: "小户型可持续收纳家具",
    status: "active" as const,
    publishPolicy: "auto_when_qualified" as const,
    targetWordCount: 1400,
    primaryKeyword: "小户型收纳家具",
    keywords: ["可持续家具", "客厅收纳", "小户型搭配"],
    startedAt: new Date(),
    metadata: {
      seed: true,
      priority: "demo"
    }
  };

  if (existing) {
    return prisma.blogCampaign.update({
      where: { id: existing.id },
      data
    });
  }

  return prisma.blogCampaign.create({ data });
}

async function seedSnapshots(input: { organizationId: string; storeId: string }) {
  await prisma.productSnapshot.upsert({
    where: {
      storeId_shopifyProductId: {
        storeId: input.storeId,
        shopifyProductId: "gid://shopify/Product/demo-stackable-shelf"
      }
    },
    update: {
      title: "模块化叠放收纳架",
      productType: "Storage",
      vendor: "Demo Store",
      tags: ["storage", "living-room", "sustainable"],
      syncedAt: new Date()
    },
    create: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      shopifyProductId: "gid://shopify/Product/demo-stackable-shelf",
      handle: "modular-stackable-shelf",
      title: "模块化叠放收纳架",
      descriptionHtml: "<p>适合小户型客厅和玄关的模块化收纳家具。</p>",
      productType: "Storage",
      vendor: "Demo Store",
      status: "ACTIVE",
      tags: ["storage", "living-room", "sustainable"],
      imageUrls: ["https://cdn.shopify.com/s/files/1/0000/0001/products/demo-stackable-shelf.jpg"],
      seoTitle: "小户型模块化收纳架",
      seoDescription: "了解如何用模块化叠放收纳架提升小户型空间利用率。",
      raw: {
        seed: true
      }
    }
  });

  await prisma.collectionSnapshot.upsert({
    where: {
      storeId_shopifyCollectionId: {
        storeId: input.storeId,
        shopifyCollectionId: "gid://shopify/Collection/demo-summer-essentials"
      }
    },
    update: {
      title: "春夏小户型收纳精选",
      syncedAt: new Date()
    },
    create: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      shopifyCollectionId: "gid://shopify/Collection/demo-summer-essentials",
      handle: "summer-small-space-storage",
      title: "春夏小户型收纳精选",
      descriptionHtml: "<p>面向城市家庭的小户型收纳与轻量家具精选。</p>",
      imageUrl: "https://cdn.shopify.com/s/files/1/0000/0001/collections/demo-storage.jpg",
      collectionType: "smart",
      seoTitle: "小户型收纳精选",
      seoDescription: "适合春夏换季的小户型收纳灵感和商品组合。",
      raw: {
        seed: true
      }
    }
  });
}

async function seedArticles(input: { organizationId: string; storeId: string; campaignId: string }) {
  await prisma.blogArticle.upsert({
    where: {
      storeId_locale_handle: {
        storeId: input.storeId,
        locale: "zh-CN",
        handle: "sustainable-storage-furniture-small-apartment"
      }
    },
    update: {
      title: "如何为小户型选择可持续收纳家具",
      status: "ready_to_publish",
      seoScore: 88,
      qualityPassed: true,
      updatedAt: new Date()
    },
    create: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      campaignId: input.campaignId,
      locale: "zh-CN",
      sourceType: "collection",
      sourceId: "gid://shopify/Collection/demo-summer-essentials",
      status: "ready_to_publish",
      publishPolicy: "auto_when_qualified",
      title: "如何为小户型选择可持续收纳家具",
      handle: "sustainable-storage-furniture-small-apartment",
      summary: "围绕小户型收纳场景，解释如何选择兼顾材质、尺寸和长期维护成本的可持续家具。",
      bodyHtml:
        "<article><h2>先从真实使用场景开始</h2><p>小户型收纳家具需要同时解决尺寸、动线和耐用性问题。</p><h2>材质和维护决定长期价值</h2><p>选择可持续材质时，应关注承重、表面处理和日常清洁方式。</p></article>",
      primaryKeyword: "小户型收纳家具",
      secondaryKeywords: ["可持续家具", "客厅收纳", "模块化家具"],
      tags: ["ai-generated", "zh-CN", "storage"],
      seoTitle: "如何为小户型选择可持续收纳家具",
      seoDescription: "从尺寸、材质、维护和使用场景判断适合小户型的可持续收纳家具。",
      seoScore: 88,
      qualityPassed: true,
      qualityReport: {
        readability: "good",
        keywordCoverage: "good"
      },
      lastGeneratedAt: new Date()
    }
  });

  await prisma.blogArticle.upsert({
    where: {
      storeId_locale_handle: {
        storeId: input.storeId,
        locale: "en-US",
        handle: "field-tested-guide-waterproof-backpacks"
      }
    },
    update: {
      title: "The Field-Tested Guide to Waterproof Backpacks",
      status: "draft",
      seoScore: 74,
      updatedAt: new Date()
    },
    create: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      campaignId: input.campaignId,
      locale: "en-US",
      sourceType: "manual_topic",
      sourceId: "manual-waterproof-backpacks",
      status: "draft",
      publishPolicy: "manual_review",
      title: "The Field-Tested Guide to Waterproof Backpacks",
      handle: "field-tested-guide-waterproof-backpacks",
      summary: "A practical draft for shoppers comparing waterproof backpack materials, closures, and capacity.",
      bodyHtml:
        "<article><h2>Start with your trip profile</h2><p>Water resistance needs depend on weather, duration, and how the pack is carried.</p></article>",
      primaryKeyword: "waterproof backpacks",
      secondaryKeywords: ["outdoor gear", "dry bag", "commuter backpack"],
      tags: ["ai-generated", "en-US", "draft"],
      seoTitle: "The Field-Tested Guide to Waterproof Backpacks",
      seoDescription: "Compare waterproof backpack materials, closures, capacity, and field-use tradeoffs.",
      seoScore: 74,
      qualityPassed: false,
      lastGeneratedAt: new Date()
    }
  });
}

async function seedPublishLogs(input: { organizationId: string; storeId: string; campaignId: string }) {
  const existing = await prisma.publishLog.findFirst({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      message: "Seed 数据已创建，可用于管理端真实数据联调。"
    }
  });

  if (existing) return;

  await prisma.publishLog.createMany({
    data: [
      {
        organizationId: input.organizationId,
        storeId: input.storeId,
        event: "succeeded",
        level: "info",
        message: "Seed 数据已创建，可用于管理端真实数据联调。",
        payload: {
          campaignId: input.campaignId
        }
      },
      {
        organizationId: input.organizationId,
        storeId: input.storeId,
        event: "queued",
        level: "info",
        message: "文章生成任务进入队列，等待 worker 处理。",
        payload: {
          campaignId: input.campaignId
        }
      }
    ]
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
