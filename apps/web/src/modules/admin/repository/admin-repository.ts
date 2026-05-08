import { encryptSecret, prisma } from "@shopify-ai-blog/db";
import type {
  AdminRequestContextInput,
  AuditLogCreateInput,
  CreateCampaignInput,
  PublishLogCreateInput,
  QueueArticlePublishInput,
  QueueStoreSyncInput,
  UpsertAiProviderInput,
  UpsertBrandVoiceInput,
  UpsertLanguageInput
} from "../contracts";

export type AdminDbClient = typeof prisma | any;

export async function findOrganizationForAdmin(preferredSlug?: string) {
  const slug = preferredSlug?.trim();

  if (slug) {
    const organization = await prisma.organization.findFirst({
      where: { slug, status: "active" }
    });
    if (organization) return organization;
  }

  const demoOrganization = await prisma.organization.findFirst({
    where: { slug: "demo", status: "active" }
  });
  if (demoOrganization) return demoOrganization;

  return prisma.organization.findFirst({
    where: { status: "active" },
    orderBy: { createdAt: "asc" }
  });
}

export function findStores(organizationId: string, take = 50) {
  return prisma.shopifyStore.findMany({
    where: { organizationId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take,
    include: {
      _count: {
        select: {
          productSnapshots: true,
          collectionSnapshots: true,
          articles: true,
          campaigns: true
        }
      }
    }
  });
}

export function findStoreById(organizationId: string, storeId: string, db: AdminDbClient = prisma) {
  return db.shopifyStore.findFirst({
    where: { id: storeId, organizationId }
  });
}

export function findLocaleConfigs(organizationId: string) {
  return prisma.localeConfig.findMany({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { locale: "asc" }],
    include: {
      store: {
        select: {
          id: true,
          name: true,
          primaryLocale: true
        }
      }
    }
  });
}

export function findAiProviderConfigs(organizationId: string) {
  return prisma.aiProviderConfig.findMany({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { enabled: "desc" }, { updatedAt: "desc" }],
    include: {
      store: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });
}

export function findBrandVoices(organizationId: string) {
  return prisma.brandVoice.findMany({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { locale: "asc" }, { updatedAt: "desc" }],
    include: {
      store: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });
}

export function findBrandVoiceById(organizationId: string, brandVoiceId: string, db: AdminDbClient = prisma) {
  return db.brandVoice.findFirst({
    where: { id: brandVoiceId, organizationId }
  });
}

export function findCampaigns(organizationId: string, take = 50) {
  return prisma.blogCampaign.findMany({
    where: { organizationId },
    orderBy: [{ updatedAt: "desc" }],
    take,
    include: {
      store: {
        select: {
          id: true,
          name: true
        }
      },
      articles: {
        select: {
          id: true,
          status: true
        }
      }
    }
  });
}

export function findArticles(organizationId: string, take = 50) {
  return prisma.blogArticle.findMany({
    where: { organizationId },
    orderBy: [{ updatedAt: "desc" }],
    take,
    include: {
      store: {
        select: {
          id: true,
          name: true
        }
      },
      campaign: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });
}

export function findPriorityArticles(organizationId: string, take = 8) {
  return prisma.blogArticle.findMany({
    where: {
      organizationId,
      status: {
        in: ["quality_failed", "ready_to_publish", "failed"]
      }
    },
    orderBy: [{ updatedAt: "desc" }],
    take,
    include: {
      store: {
        select: {
          id: true,
          name: true
        }
      },
      campaign: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });
}

export function findArticleById(organizationId: string, articleId: string, db: AdminDbClient = prisma) {
  return db.blogArticle.findFirst({
    where: { id: articleId, organizationId }
  });
}

export async function getDashboardStats(organizationId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);

  const [
    connectedStores,
    newStoresThisWeek,
    generatedThisMonth,
    qualityPassedThisMonth,
    pendingManualReview,
    failedArticles,
    failedJobs,
    pendingSeo
  ] = await Promise.all([
    prisma.shopifyStore.count({ where: { organizationId, status: "active" } }),
    prisma.shopifyStore.count({
      where: {
        organizationId,
        createdAt: { gte: weekStart }
      }
    }),
    prisma.blogArticle.count({
      where: {
        organizationId,
        createdAt: { gte: monthStart }
      }
    }),
    prisma.blogArticle.count({
      where: {
        organizationId,
        createdAt: { gte: monthStart },
        qualityPassed: true
      }
    }),
    prisma.blogArticle.count({
      where: {
        organizationId,
        publishPolicy: "manual_review",
        status: {
          in: ["quality_failed", "ready_to_publish"]
        }
      }
    }),
    prisma.blogArticle.count({
      where: {
        organizationId,
        status: "failed"
      }
    }),
    prisma.publishJob.count({
      where: {
        organizationId,
        status: "failed"
      }
    }),
    prisma.blogArticle.aggregate({
      where: {
        organizationId,
        publishPolicy: "manual_review",
        status: {
          in: ["quality_failed", "ready_to_publish"]
        },
        seoScore: {
          not: null
        }
      },
      _avg: {
        seoScore: true
      }
    })
  ]);

  return {
    connectedStores,
    newStoresThisWeek,
    generatedThisMonth,
    qualityPassedThisMonth,
    pendingManualReview,
    failedArticles,
    failedJobs,
    averagePendingSeoScore: pendingSeo._avg.seoScore
  };
}

export async function findRecentLogs(organizationId: string, take = 50) {
  const [publishLogs, auditLogs] = await Promise.all([
    prisma.publishLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        job: {
          select: {
            status: true,
            type: true
          }
        }
      }
    }),
    prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take
    })
  ]);

  return { publishLogs, auditLogs };
}

export async function createStoreSyncJobs(
  organizationId: string,
  input: QueueStoreSyncInput,
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    const now = new Date();
    const requestedTypes = [
      input.products ? "sync_product" : null,
      input.collections ? "sync_collection" : null
    ].filter((type): type is "sync_product" | "sync_collection" => type !== null);

    const jobs = await Promise.all(
      requestedTypes.map((type) =>
        tx.publishJob.create({
          data: {
            organizationId,
            storeId: input.storeId,
            type,
            status: "queued",
            runAt: now,
            payload: compactJsonObject({
              organizationId,
              storeId: input.storeId,
              queue: "shopify-sync",
              jobName: type === "sync_product" ? "product.sync" : "collection.sync",
              fullSync: input.fullSync,
              limit: input.limit,
              requestedAt: now.toISOString()
            })
          }
        })
      )
    );

    await tx.auditLog.create({
      data: {
        organizationId,
        storeId: input.storeId,
        userId: requestContext.requestedByUserId,
        action: "sync",
        entityType: "shopify_store",
        entityId: input.storeId,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: compactJsonObject({
          fullSync: input.fullSync,
          products: input.products,
          collections: input.collections,
          jobIds: jobs.map((job) => job.id)
        })
      }
    });

    return jobs;
  });
}

export async function createCampaignWithOptionalJob(
  organizationId: string,
  input: CreateCampaignInput,
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    const campaign = await tx.blogCampaign.create({
      data: {
        organizationId,
        storeId: input.storeId,
        brandVoiceId: input.brandVoiceId,
        locale: input.locale,
        title: input.title,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        topic: input.topic,
        status: input.queueGeneration ? "active" : "draft",
        publishPolicy: input.publishPolicy,
        targetWordCount: input.targetWordCount,
        primaryKeyword: input.primaryKeyword,
        keywords: input.keywords,
        scheduleAt: input.scheduleAt ? new Date(input.scheduleAt) : null
      },
      include: {
        store: {
          select: {
            id: true,
            name: true
          }
        },
        articles: {
          select: {
            id: true,
            status: true
          }
        }
      }
    });

    const job = input.queueGeneration
      ? await tx.publishJob.create({
          data: {
            organizationId,
            storeId: input.storeId,
            type: "generate_article",
            status: "queued",
            runAt: input.scheduleAt ? new Date(input.scheduleAt) : new Date(),
            payload: compactJsonObject({
              organizationId,
              storeId: input.storeId,
              campaignId: campaign.id,
              locale: input.locale,
              sourceType: input.sourceType,
              sourceId: input.sourceId,
              topic: input.topic,
              publishPolicy: input.publishPolicy,
              targetWordCount: input.targetWordCount,
              primaryKeyword: input.primaryKeyword,
              keywords: input.keywords,
              queue: "blog-generation",
              jobName: "blog.generate"
            })
          }
        })
      : null;

    if (job) {
      await tx.publishLog.create({
        data: {
          organizationId,
          storeId: input.storeId,
          jobId: job.id,
          event: "queued",
          level: "info",
          message: `Queued generation for campaign ${campaign.title}.`,
          payload: compactJsonObject({
            campaignId: campaign.id,
            jobType: job.type
          })
        }
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId,
        storeId: input.storeId,
        userId: requestContext.requestedByUserId,
        action: "create",
        entityType: "blog_campaign",
        entityId: campaign.id,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: compactJsonObject({
          queueGeneration: input.queueGeneration,
          jobId: job?.id,
          sourceType: input.sourceType
        })
      }
    });

    return { campaign, job };
  });
}

export async function createArticlePublishJob(
  organizationId: string,
  input: QueueArticlePublishInput,
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    const article = await findArticleById(organizationId, input.articleId, tx);
    if (!article) return null;

    const runAt = input.publishAt ? new Date(input.publishAt) : new Date();
    const job = await tx.publishJob.create({
      data: {
        organizationId,
        storeId: article.storeId,
        articleId: article.id,
        type: "publish_article",
        status: "queued",
        runAt,
        payload: compactJsonObject({
          organizationId,
          storeId: article.storeId,
          articleId: article.id,
          locale: article.locale,
          publishPolicy: article.publishPolicy,
          shopifyBlogId: input.shopifyBlogId ?? article.shopifyBlogId,
          publishAt: runAt.toISOString(),
          queue: "blog-generation",
          jobName: "article.publish"
        })
      }
    });

    const updatedArticle = await tx.blogArticle.update({
      where: { id: article.id },
      data: {
        status: "publishing",
        scheduledAt: input.publishAt ? runAt : article.scheduledAt,
        shopifyBlogId: input.shopifyBlogId ?? article.shopifyBlogId
      },
      include: {
        store: {
          select: {
            id: true,
            name: true
          }
        },
        campaign: {
          select: {
            id: true,
            title: true
          }
        }
      }
    });

    await tx.publishLog.create({
      data: {
        organizationId,
        storeId: article.storeId,
        articleId: article.id,
        jobId: job.id,
        event: "queued",
        level: "info",
        message: `Queued publish for article ${article.title ?? article.id}.`,
        payload: compactJsonObject({
          articleId: article.id,
          jobType: job.type,
          publishAt: runAt.toISOString()
        })
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        storeId: article.storeId,
        userId: requestContext.requestedByUserId,
        action: "publish",
        entityType: "blog_article",
        entityId: article.id,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: compactJsonObject({
          jobId: job.id,
          publishAt: runAt.toISOString()
        })
      }
    });

    return { article, updatedArticle, job };
  });
}

export async function upsertAiProviderConfig(
  organizationId: string,
  input: UpsertAiProviderInput,
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    if (input.isDefault) {
      await tx.aiProviderConfig.updateMany({
        where: {
          organizationId,
          storeId: input.storeId ?? null,
          id: input.id ? { not: input.id } : undefined
        },
        data: { isDefault: false }
      });
    }

    const slug = input.slug ?? slugify(input.name);
    const data = {
      organizationId,
      storeId: input.storeId ?? null,
      slug,
      name: input.name,
      provider: input.provider,
      baseUrl: input.baseUrl,
      apiKeyEncrypted: input.apiKey ? encryptSecret(input.apiKey) : undefined,
      textModel: input.textModel,
      imageModel: input.imageModel,
      temperature: input.temperature,
      enabled: input.enabled,
      isDefault: input.isDefault
    };

    const provider = input.id
      ? await tx.aiProviderConfig.update({
          where: { id: input.id },
          data
        })
      : await tx.aiProviderConfig.upsert({
          where: {
            organizationId_slug: {
              organizationId,
              slug
            }
          },
          update: data,
          create: data
        });

    await tx.auditLog.create({
      data: {
        organizationId,
        storeId: input.storeId,
        userId: requestContext.requestedByUserId,
        action: input.id ? "update" : "create",
        entityType: "ai_provider_config",
        entityId: provider.id,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: compactJsonObject({
          provider: input.provider,
          enabled: input.enabled,
          isDefault: input.isDefault,
          apiKeyUpdated: Boolean(input.apiKey)
        })
      }
    });

    return provider;
  });
}

export async function upsertLanguageConfig(
  organizationId: string,
  input: UpsertLanguageInput,
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    if (input.isDefault) {
      await tx.localeConfig.updateMany({
        where: {
          organizationId,
          storeId: input.storeId,
          locale: { not: input.locale }
        },
        data: { isDefault: false }
      });
    }

    const language = await tx.localeConfig.upsert({
      where: {
        storeId_locale: {
          storeId: input.storeId,
          locale: input.locale
        }
      },
      update: {
        label: input.label,
        isDefault: input.isDefault,
        isEnabled: input.enabled,
        shopifyMarketHandle: input.shopifyMarketHandle,
        shopifyBlogId: input.shopifyBlogId,
        shopifyBlogHandle: input.shopifyBlogHandle,
        seoDefaults: input.fallback ? { fallback: input.fallback } : undefined
      },
      create: {
        organizationId,
        storeId: input.storeId,
        locale: input.locale,
        label: input.label,
        isDefault: input.isDefault,
        isEnabled: input.enabled,
        shopifyMarketHandle: input.shopifyMarketHandle,
        shopifyBlogId: input.shopifyBlogId,
        shopifyBlogHandle: input.shopifyBlogHandle,
        seoDefaults: input.fallback ? { fallback: input.fallback } : undefined
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        storeId: input.storeId,
        userId: requestContext.requestedByUserId,
        action: "update",
        entityType: "locale_config",
        entityId: language.id,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: compactJsonObject({
          locale: input.locale,
          enabled: input.enabled,
          isDefault: input.isDefault,
          shopifyBlogHandle: input.shopifyBlogHandle
        })
      }
    });

    return language;
  });
}

export async function upsertBrandVoiceProfile(
  organizationId: string,
  input: UpsertBrandVoiceInput,
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    if (input.isDefault) {
      await tx.brandVoice.updateMany({
        where: {
          organizationId,
          storeId: input.storeId ?? null,
          locale: input.locale,
          id: input.id ? { not: input.id } : undefined
        },
        data: { isDefault: false }
      });
    }

    const data = {
      organizationId,
      storeId: input.storeId ?? null,
      locale: input.locale,
      name: input.name,
      audience: input.audience,
      tone: input.tone,
      bannedWords: input.bannedWords,
      examples: input.examples,
      isDefault: input.isDefault
    };
    const profile = input.id
      ? await tx.brandVoice.update({
          where: { id: input.id },
          data
        })
      : await tx.brandVoice.upsert({
          where: {
            organizationId_storeId_locale_name: {
              organizationId,
              storeId: input.storeId ?? null,
              locale: input.locale,
              name: input.name
            }
          },
          update: data,
          create: data
        });

    await tx.auditLog.create({
      data: {
        organizationId,
        storeId: input.storeId,
        userId: requestContext.requestedByUserId,
        action: input.id ? "update" : "create",
        entityType: "brand_voice",
        entityId: profile.id,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: compactJsonObject({
          locale: input.locale,
          isDefault: input.isDefault
        })
      }
    });

    return profile;
  });
}

export async function createAuditLog(
  organizationId: string,
  input: AuditLogCreateInput,
  requestContext: AdminRequestContextInput,
  db: AdminDbClient = prisma
) {
  return db.auditLog.create({
    data: {
      organizationId,
      storeId: input.storeId,
      userId: requestContext.requestedByUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
      metadata: input.metadata ? compactJsonObject(input.metadata) : undefined
    }
  });
}

export async function createPublishLog(
  organizationId: string,
  input: PublishLogCreateInput,
  db: AdminDbClient = prisma
) {
  return db.publishLog.create({
    data: {
      organizationId,
      storeId: input.storeId,
      jobId: input.jobId,
      articleId: input.articleId,
      event: "queued",
      level: input.level ?? "info",
      message: input.message,
      payload: input.payload ? compactJsonObject(input.payload) : undefined
    }
  });
}

function compactJsonObject(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    output[key] = value;
  }

  return output;
}

function slugify(value: string) {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 64) || `provider-${Date.now().toString(36)}`
  );
}
