import { encryptSecret, prisma, Prisma } from "@shopify-ai-blog/db";
import type { ShopifyBlog, ShopifyBlogArticle, ShopifyCollection, ShopifyProduct, ShopifyShopInfo } from "@shopify-ai-blog/shopify";
import type {
  AdminRequestContextInput,
  AuditLogCreateInput,
  CreateCampaignInput,
  DeleteStoreInput,
  PublishLogCreateInput,
  QueueArticlePublishInput,
  QueueArticleRepairInput,
  QueueStoreSyncInput,
  QueueSearchConsoleSyncInput,
  QueueSearchConsoleArticleSyncInput,
  UpsertAiProviderInput,
  UpsertBrandVoiceInput,
  UpsertLanguageInput,
  UpsertStoreCredentialsInput
} from "../contracts";

export type AdminDbClient = typeof prisma | any;

interface ShopifyStoreSyncPersistenceInput {
  storeId: string;
  shop: ShopifyShopInfo;
  products?: ShopifyProduct[];
  productsCapped: boolean;
  collections?: ShopifyCollection[];
  collectionsCapped: boolean;
  blogs: ShopifyBlog[];
  blogArticles: ShopifyBlogArticle[];
  blogArticlesCapped: boolean;
  fullSync: boolean;
  limit?: number;
  syncedAt: Date;
}

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

export function findStoreByDomain(shopDomain: string, db: AdminDbClient = prisma) {
  return db.shopifyStore.findUnique({
    where: { myshopifyDomain: shopDomain }
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

export function findSearchConsoleProperties(organizationId: string, take = 50) {
  return prisma.searchConsoleProperty.findMany({
    where: { organizationId },
    orderBy: [{ updatedAt: "desc" }],
    take,
    include: {
      store: {
        select: {
          id: true,
          name: true,
          myshopifyDomain: true
        }
      },
      snapshots: {
        select: {
          id: true
        }
      },
      queryRows: {
        select: {
          id: true
        }
      }
    }
  });
}

export function findSearchConsoleSnapshots(organizationId: string, take = 50) {
  return prisma.articleSeoPerformanceSnapshot.findMany({
    where: { organizationId },
    orderBy: [{ syncedAt: "desc" }],
    take,
    include: {
      store: {
        select: {
          id: true,
          name: true
        }
      },
      article: {
        select: {
          id: true,
          title: true
        }
      },
      property: {
        select: {
          id: true,
          siteUrl: true
        }
      }
    }
  });
}

export function findPerformanceReviewSnapshots(organizationId: string, take = 200) {
  return prisma.articleSeoPerformanceSnapshot.findMany({
    where: { organizationId },
    orderBy: [{ syncedAt: "desc" }],
    take,
    include: {
      store: {
        select: {
          id: true,
          name: true
        }
      },
      article: {
        select: {
          id: true,
          title: true,
          status: true,
          seoScore: true,
          canonicalUrl: true,
          primaryKeyword: true,
          updatedAt: true
        }
      },
      property: {
        select: {
          id: true,
          siteUrl: true
        }
      }
    }
  });
}

export function findPerformanceReviewQueryRows(organizationId: string, take = 400) {
  return prisma.articleSeoQueryPerformance.findMany({
    where: { organizationId },
    orderBy: [{ syncedAt: "desc" }],
    take,
    include: {
      store: {
        select: {
          id: true,
          name: true
        }
      },
      article: {
        select: {
          id: true,
          title: true,
          status: true,
          seoScore: true,
          canonicalUrl: true,
          primaryKeyword: true,
          updatedAt: true
        }
      },
      property: {
        select: {
          id: true,
          siteUrl: true
        }
      },
      snapshot: {
        select: {
          id: true,
          performanceScore: true,
          syncedAt: true
        }
      }
    }
  });
}

export function findPriorityDashboardArticles(organizationId: string, take = 100) {
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
          title: true,
          brandVoice: {
            select: {
              id: true,
              audience: true,
              tone: true,
              bannedWords: true,
              examples: true
            }
          }
        }
      },
      seoTopicRuns: {
        orderBy: { createdAt: "desc" },
        take: 2,
        include: {
          steps: {
            orderBy: { sequence: "asc" },
            take: 20
          },
          reflectionTasks: {
            orderBy: { createdAt: "asc" },
            take: 20
          },
          evidenceItems: {
            orderBy: { createdAt: "asc" },
            take: 20
          }
        }
      },
      seoPerformanceSnapshots: {
        orderBy: { syncedAt: "desc" },
        take: 3,
        include: {
          property: {
            select: {
              id: true,
              siteUrl: true
            }
          }
        }
      }
    }
  });
}

export function findPriorityDashboardTopicRuns(organizationId: string, take = 50) {
  return prisma.seoTopicRun.findMany({
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
          title: true,
          brandVoice: {
            select: {
              id: true,
              audience: true,
              tone: true,
              bannedWords: true,
              examples: true
            }
          }
        }
      },
      article: {
        select: {
          id: true,
          title: true,
          status: true,
          seoScore: true,
          canonicalUrl: true,
          primaryKeyword: true
        }
      },
      candidates: {
        orderBy: { score: "desc" },
        take: 20
      },
      selectedCandidate: true,
      steps: {
        orderBy: { sequence: "asc" },
        take: 30
      },
      reflectionTasks: {
        orderBy: { createdAt: "asc" },
        take: 30
      },
      evidenceItems: {
        orderBy: { createdAt: "asc" },
        take: 20
      }
    }
  });
}

export function findPriorityDashboardMemories(organizationId: string, take = 100) {
  return prisma.agentMemory.findMany({
    where: { organizationId },
    orderBy: [{ updatedAt: "desc" }],
    take,
    include: {
      article: {
        select: {
          id: true,
          title: true,
          status: true,
          seoScore: true,
          canonicalUrl: true
        }
      },
      campaign: {
        select: {
          id: true,
          title: true,
          brandVoice: {
            select: {
              id: true,
              audience: true,
              tone: true,
              bannedWords: true,
              examples: true
            }
          }
        }
      },
      store: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });
}

export function findPriorityDashboardReflectionTasks(organizationId: string, take = 100) {
  return prisma.agentReflectionTask.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }],
    take,
    include: {
      article: {
        select: {
          id: true,
          title: true,
          status: true,
          seoScore: true,
          canonicalUrl: true
        }
      },
      campaign: {
        select: {
          id: true,
          title: true,
          brandVoice: {
            select: {
              id: true,
              audience: true,
              tone: true,
              bannedWords: true,
              examples: true
            }
          }
        }
      },
      store: {
        select: {
          id: true,
          name: true
        }
      },
      topicRun: {
        select: {
          id: true,
          runId: true,
          status: true,
          selectedTopic: true,
          agentVersion: true
        }
      }
    }
  });
}

export function findPriorityDashboardSteps(organizationId: string, take = 100) {
  return prisma.agentStep.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }],
    take,
    include: {
      article: {
        select: {
          id: true,
          title: true,
          status: true,
          seoScore: true,
          canonicalUrl: true
        }
      },
      campaign: {
        select: {
          id: true,
          title: true,
          brandVoice: {
            select: {
              id: true,
              audience: true,
              tone: true,
              bannedWords: true,
              examples: true
            }
          }
        }
      },
      store: {
        select: {
          id: true,
          name: true
        }
      },
      topicRun: {
        select: {
          id: true,
          runId: true,
          status: true,
          selectedTopic: true,
          agentVersion: true
        }
      }
    }
  });
}

export function findSearchConsolePropertyById(organizationId: string, propertyId: string, db: AdminDbClient = prisma) {
  return db.searchConsoleProperty.findFirst({
    where: { id: propertyId, organizationId },
    include: {
      store: {
        select: {
          id: true,
          name: true
        }
      },
      snapshots: {
        select: {
          id: true
        }
      },
      queryRows: {
        select: {
          id: true
        }
      }
    }
  });
}

export function findActiveSearchConsoleProperty(organizationId: string, storeId: string, db: AdminDbClient = prisma) {
  return db.searchConsoleProperty.findFirst({
    where: { organizationId, storeId, status: "active" },
    include: {
      store: {
        select: {
          id: true,
          name: true
        }
      },
      snapshots: {
        select: {
          id: true
        }
      },
      queryRows: {
        select: {
          id: true
        }
      }
    },
    orderBy: { updatedAt: "desc" }
  });
}

export async function upsertSearchConsoleProperty(
  organizationId: string,
  input: {
    id?: string;
    storeId: string;
    siteUrl: string;
    status: "active" | "needs_auth" | "disconnected" | "archived";
    permissionLevel?: string;
    scopes: string[];
    googleClientId?: string;
    googleClientSecret?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: string;
  },
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    const data = {
      organizationId,
      storeId: input.storeId,
      siteUrl: input.siteUrl,
      status: input.status,
      permissionLevel: input.permissionLevel,
      scopes: input.scopes,
      googleClientId: input.googleClientId,
      googleClientSecretEncrypted: input.googleClientSecret ? encryptSecret(input.googleClientSecret) : undefined,
      accessTokenEncrypted: input.accessToken ? encryptSecret(input.accessToken) : undefined,
      refreshTokenEncrypted: input.refreshToken ? encryptSecret(input.refreshToken) : undefined,
      tokenExpiresAt: input.tokenExpiresAt ? new Date(input.tokenExpiresAt) : undefined,
      lastSyncError: null
    };

    const property = input.id
      ? await tx.searchConsoleProperty.update({
          where: { id: input.id },
          data
        })
      : await tx.searchConsoleProperty.upsert({
          where: {
            storeId_siteUrl: {
              storeId: input.storeId,
              siteUrl: input.siteUrl
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
        action: "update",
        entityType: "search_console_property",
        entityId: property.id,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: compactJsonObject({
          siteUrl: input.siteUrl,
          status: input.status,
          scopes: input.scopes
        })
      }
    });

    return property;
  });
}

export async function createSearchConsoleSyncJob(
  organizationId: string,
  input: QueueSearchConsoleSyncInput & { propertyId: string },
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    const property = await findSearchConsolePropertyById(organizationId, input.propertyId, tx);
    if (!property) return null;

    const runAt = new Date();
    const job = await tx.publishJob.create({
      data: {
        organizationId,
        storeId: input.storeId,
        type: "sync_search_console",
        status: "queued",
        runAt,
        payload: compactJsonObject({
          organizationId,
          storeId: input.storeId,
          propertyId: property.id,
          startDate: input.startDate,
          endDate: input.endDate,
          days: input.days,
          dataState: input.dataState ?? "final",
          rowLimit: input.rowLimit,
          queue: "seo-performance",
          jobName: "gsc.store.sync"
        })
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        storeId: input.storeId,
        userId: requestContext.requestedByUserId,
        action: "sync",
        entityType: "search_console_property",
        entityId: property.id,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: compactJsonObject({
          propertyId: property.id,
          siteUrl: property.siteUrl,
          startDate: input.startDate,
          endDate: input.endDate,
          days: input.days,
          dataState: input.dataState,
          rowLimit: input.rowLimit,
          jobId: job.id
        })
      }
    });

    return job;
  });
}

export async function createSearchConsoleArticleSyncJob(
  organizationId: string,
  input: QueueSearchConsoleArticleSyncInput & { storeId: string; articleId: string; propertyId: string },
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    const article = await findArticleById(organizationId, input.articleId, tx);
    const property = await findSearchConsolePropertyById(organizationId, input.propertyId, tx);
    if (!article || !property) return null;

    const runAt = new Date();
    const job = await tx.publishJob.create({
      data: {
        organizationId,
        storeId: input.storeId,
        articleId: article.id,
        type: "sync_search_console",
        status: "queued",
        runAt,
        payload: compactJsonObject({
          organizationId,
          storeId: input.storeId,
          articleId: article.id,
          propertyId: property.id,
          startDate: input.startDate,
          endDate: input.endDate,
          days: input.days,
          dataState: input.dataState ?? "final",
          rowLimit: input.rowLimit,
          queue: "seo-performance",
          jobName: "gsc.article.sync"
        })
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        storeId: input.storeId,
        userId: requestContext.requestedByUserId,
        action: "sync",
        entityType: "blog_article",
        entityId: article.id,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: compactJsonObject({
          articleId: article.id,
          propertyId: property.id,
          siteUrl: property.siteUrl,
          startDate: input.startDate,
          endDate: input.endDate,
          days: input.days,
          dataState: input.dataState,
          rowLimit: input.rowLimit,
          jobId: job.id
        })
      }
    });

    return job;
  });
}

export async function markSearchConsoleJobEnqueued(jobId: string, externalJobId: string) {
  return prisma.publishJob.update({
    where: { id: jobId },
    data: {
      externalJobId,
      status: "queued",
      errorMessage: null
    }
  });
}

export async function markSearchConsoleJobQueueFailed(jobId: string, errorMessage: string) {
  return prisma.publishJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      lockedAt: null,
      errorMessage
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
      },
      seoPerformanceSnapshots: {
        orderBy: { syncedAt: "desc" },
        take: 1,
        select: {
          syncedAt: true,
          clicks: true,
          impressions: true,
          ctr: true,
          position: true,
          performanceScore: true
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
      },
      seoPerformanceSnapshots: {
        orderBy: { syncedAt: "desc" },
        take: 1,
        select: {
          syncedAt: true,
          clicks: true,
          impressions: true,
          ctr: true,
          position: true,
          performanceScore: true
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

export function findArticleForReview(organizationId: string, articleId: string) {
  return prisma.blogArticle.findFirst({
    where: { id: articleId, organizationId },
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
          title: true,
          brandVoice: {
            select: {
              id: true,
              audience: true,
              tone: true,
              bannedWords: true,
              examples: true
            }
          }
        }
      },
      assets: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          type: true,
          status: true,
          publicUrl: true,
          sourceUrl: true,
          altText: true,
          prompt: true,
          createdAt: true
        }
      },
      publishLogs: {
        orderBy: { createdAt: "desc" },
        take: 12,
        include: {
          job: {
            select: {
              type: true,
              status: true
            }
          }
        }
      },
      publishJobs: {
        where: {
          type: "generate_article"
        },
        orderBy: { createdAt: "desc" },
        take: 5
      },
      seoPerformanceSnapshots: {
        orderBy: { syncedAt: "desc" },
        take: 1,
        select: {
          syncedAt: true,
          clicks: true,
          impressions: true,
          ctr: true,
          position: true,
          performanceScore: true
        }
      },
      seoTopicRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          steps: {
            orderBy: { sequence: "asc" },
            take: 80
          },
          toolCalls: {
            orderBy: { createdAt: "asc" },
            take: 40
          },
          reflectionTasks: {
            orderBy: { createdAt: "asc" },
            take: 20
          },
          evidenceItems: {
            orderBy: { createdAt: "asc" },
            take: 40
          }
        }
      }
    }
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
    queuedJobs,
    runningJobs,
    retryingJobs,
    pendingJobs,
    latestFailedJob,
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
    prisma.publishJob.count({
      where: {
        organizationId,
        status: "queued"
      }
    }),
    prisma.publishJob.count({
      where: {
        organizationId,
        status: "running"
      }
    }),
    prisma.publishJob.count({
      where: {
        organizationId,
        status: "retrying"
      }
    }),
    prisma.publishJob.count({
      where: {
        organizationId,
        status: {
          in: ["queued", "running", "retrying"]
        }
      }
    }),
    prisma.publishJob.findFirst({
      where: {
        organizationId,
        status: "failed"
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        type: true,
        errorMessage: true,
        updatedAt: true
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
    queuedJobs,
    runningJobs,
    retryingJobs,
    pendingJobs,
    latestFailedJob,
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

export async function persistShopifyStoreSync(
  organizationId: string,
  input: ShopifyStoreSyncPersistenceInput,
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(
    async (tx: AdminDbClient) => {
      const store = await tx.shopifyStore.findFirst({
        where: { id: input.storeId, organizationId },
        include: {
          localeConfigs: true
        }
      });

      if (!store) {
        throw new Error(`Store ${input.storeId} was not found.`);
      }

      const storeForArticles = {
        ...store,
        metadata: {
          ...(isRecord(store.metadata) ? store.metadata : {}),
          ...shopDomainMetadata(input.shop)
        }
      };

      for (const product of input.products ?? []) {
        await upsertProductSnapshot(tx, organizationId, input.storeId, product, input.syncedAt);
      }

      for (const collection of input.collections ?? []) {
        await upsertCollectionSnapshot(tx, organizationId, input.storeId, collection, input.syncedAt);
      }

      for (const article of input.blogArticles) {
        await upsertShopifyBlogArticle(tx, organizationId, storeForArticles, article, input.blogs, input.syncedAt);
      }

      let blogMappingsUpdated = 0;
      for (const localeConfig of store.localeConfigs) {
        if (!localeConfig.shopifyBlogHandle) continue;
        const matchedBlog = input.blogs.find((blog) => blog.handle === localeConfig.shopifyBlogHandle);
        if (!matchedBlog) continue;

        await tx.localeConfig.update({
          where: { id: localeConfig.id },
          data: {
            shopifyBlogId: matchedBlog.id,
            shopifyBlogHandle: matchedBlog.handle
          }
        });
        blogMappingsUpdated += 1;
      }

      await tx.shopifyStore.update({
        where: { id: input.storeId },
        data: {
          name: input.shop.name || store.name,
          shopifyShopGid: input.shop.id,
          shopOwnerEmail: input.shop.email ?? store.shopOwnerEmail,
          currencyCode: input.shop.currencyCode ?? store.currencyCode,
          status: "active",
          disconnectedAt: null,
          lastSyncedAt: input.syncedAt,
          metadata: toPrismaJson({
            ...(isRecord(store.metadata) ? store.metadata : {}),
            ...shopDomainMetadata(input.shop),
            lastConnectionVerifiedAt: input.syncedAt.toISOString(),
            lastSync: {
              products: input.products?.length ?? 0,
              collections: input.collections?.length ?? 0,
              blogs: input.blogs.length,
              blogArticles: input.blogArticles.length,
              productsCapped: input.productsCapped,
              collectionsCapped: input.collectionsCapped,
              blogArticlesCapped: input.blogArticlesCapped,
              fullSync: input.fullSync,
              limit: input.limit
            }
          })
        }
      });

      await tx.publishLog.create({
        data: {
          organizationId,
          storeId: input.storeId,
          event: "succeeded",
          level: "info",
          message: "Shopify store resources synced.",
          payload: toPrismaJson({
            shopId: input.shop.id,
            products: input.products?.length ?? 0,
            collections: input.collections?.length ?? 0,
            blogs: input.blogs.length,
            blogArticles: input.blogArticles.length,
            blogMappingsUpdated,
            productsCapped: input.productsCapped,
            collectionsCapped: input.collectionsCapped,
            blogArticlesCapped: input.blogArticlesCapped
          })
        }
      });

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
          metadata: toPrismaJson({
            mode: "immediate_shopify_graphql",
            shopId: input.shop.id,
            products: input.products?.length ?? 0,
            collections: input.collections?.length ?? 0,
            blogs: input.blogs.length,
            blogArticles: input.blogArticles.length,
            blogMappingsUpdated
          })
        }
      });

      const refreshedStore = await tx.shopifyStore.findFirstOrThrow({
        where: { id: input.storeId, organizationId },
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

      return {
        store: refreshedStore,
        productsSynced: input.products?.length ?? 0,
        collectionsSynced: input.collections?.length ?? 0,
        blogsSynced: input.blogs.length,
        blogArticlesSynced: input.blogArticles.length,
        blogMappingsUpdated,
        productsCapped: input.productsCapped,
        collectionsCapped: input.collectionsCapped,
        blogArticlesCapped: input.blogArticlesCapped
      };
    },
    { maxWait: 10000, timeout: 120000 }
  );
}

export async function recordStoreSyncFailure(
  organizationId: string,
  storeId: string,
  error: unknown,
  requestContext: AdminRequestContextInput
) {
  const now = new Date();
  const failure = errorPayload(error);

  return prisma.$transaction(async (tx: AdminDbClient) => {
    const store = await tx.shopifyStore.findFirst({
      where: { id: storeId, organizationId }
    });

    if (!store) return null;

    await tx.shopifyStore.update({
      where: { id: store.id },
      data: {
        status: "disconnected",
        disconnectedAt: now,
        metadata: toPrismaJson({
          ...(isRecord(store.metadata) ? store.metadata : {}),
          lastConnectionFailedAt: now.toISOString(),
          lastConnectionError: failure
        })
      }
    });

    await tx.publishLog.create({
      data: {
        organizationId,
        storeId,
        event: "failed",
        level: "error",
        message: "Shopify store sync failed.",
        payload: toPrismaJson(failure)
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        storeId,
        userId: requestContext.requestedByUserId,
        action: "sync",
        entityType: "shopify_store",
        entityId: storeId,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: toPrismaJson({
          event: "failed",
          error: failure
        })
      }
    });

    return store;
  });
}

export async function upsertStoreCredentials(
  organizationId: string,
  input: UpsertStoreCredentialsInput,
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    const now = new Date();
    const existing = await findStoreByDomain(input.shopDomain, tx);
    const storeName = input.name ?? input.shopDomain.replace(".myshopify.com", "");
    const adminAccessToken = input.adminAccessToken;
    if (!adminAccessToken) {
      throw new Error("Resolved Shopify Admin API access token is required before saving store credentials.");
    }
    const scopes = input.scopes.length > 0 ? input.scopes : ["read_products", "read_content", "write_content"];
    const adminAccessTokenExpiresAt = input.adminAccessTokenExpiresAt ? new Date(input.adminAccessTokenExpiresAt) : null;
    const shopifyClientId = input.connectionMode === "client_credentials" ? input.shopifyClientId : input.shopifyApiKey;
    const shopifyClientSecretEncrypted =
      input.connectionMode === "client_credentials" && input.shopifyClientSecret
        ? encryptSecret(input.shopifyClientSecret)
        : null;
    const webhookSecret = input.webhookSecret ?? (input.connectionMode === "client_credentials" ? input.shopifyClientSecret : undefined);
    const metadata = compactJsonObject({
      ...(existing && isRecord(existing.metadata) ? existing.metadata : {}),
      connectionMode: input.connectionMode,
      shopifyApiKey: shopifyClientId,
      defaultBlogHandle: input.shopifyBlogHandle,
      adminAccessTokenExpiresAt: adminAccessTokenExpiresAt?.toISOString(),
      credentialsUpdatedAt: now.toISOString()
    });

    const store = existing
      ? await tx.shopifyStore.update({
          where: { id: existing.id },
          data: {
            name: storeName,
            adminAccessTokenEncrypted: encryptSecret(adminAccessToken),
            adminAccessTokenExpiresAt,
            shopifyClientId,
            shopifyClientSecretEncrypted,
            webhookSecretEncrypted: webhookSecret ? encryptSecret(webhookSecret) : existing.webhookSecretEncrypted,
            scopes,
            apiVersion: input.apiVersion,
            status: "active",
            primaryLocale: input.primaryLocale,
            installedAt: existing.installedAt ?? now,
            disconnectedAt: null,
            metadata
          }
        })
      : await tx.shopifyStore.create({
          data: {
            organizationId,
            name: storeName,
            myshopifyDomain: input.shopDomain,
            adminAccessTokenEncrypted: encryptSecret(adminAccessToken),
            adminAccessTokenExpiresAt,
            shopifyClientId,
            shopifyClientSecretEncrypted,
            webhookSecretEncrypted: webhookSecret ? encryptSecret(webhookSecret) : null,
            scopes,
            apiVersion: input.apiVersion,
            status: "active",
            primaryLocale: input.primaryLocale,
            installedAt: now,
            metadata
          }
        });

    await tx.localeConfig.upsert({
      where: {
        storeId_locale: {
          storeId: store.id,
          locale: input.primaryLocale
        }
      },
      update: {
        label: localeLabel(input.primaryLocale),
        isDefault: true,
        isEnabled: true,
        shopifyBlogHandle: input.shopifyBlogHandle
      },
      create: {
        organizationId,
        storeId: store.id,
        locale: input.primaryLocale,
        label: localeLabel(input.primaryLocale),
        isDefault: true,
        isEnabled: true,
        shopifyBlogHandle: input.shopifyBlogHandle
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        storeId: store.id,
        userId: requestContext.requestedByUserId,
        action: existing ? "update" : "create",
        entityType: "shopify_store",
        entityId: store.id,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: compactJsonObject({
          connectionMode: input.connectionMode,
          shopDomain: input.shopDomain,
          apiVersion: input.apiVersion,
          scopes,
          tokenExpiresAt: adminAccessTokenExpiresAt?.toISOString(),
          tokenUpdated: true,
          clientCredentialsStored: Boolean(shopifyClientSecretEncrypted),
          webhookSecretUpdated: Boolean(webhookSecret)
        })
      }
    });

    return store;
  });
}

export async function updateStoreAccessTokenFromClientCredentials(
  organizationId: string,
  storeId: string,
  input: {
    accessToken: string;
    scopes: string[];
    expiresAt?: Date;
    refreshedAt: Date;
  }
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    const store = await tx.shopifyStore.findFirst({
      where: { id: storeId, organizationId }
    });

    if (!store) return null;

    return tx.shopifyStore.update({
      where: { id: store.id },
      data: {
        adminAccessTokenEncrypted: encryptSecret(input.accessToken),
        adminAccessTokenExpiresAt: input.expiresAt ?? null,
        scopes: input.scopes.length > 0 ? input.scopes : store.scopes,
        metadata: toPrismaJson({
          ...(isRecord(store.metadata) ? store.metadata : {}),
          connectionMode: "client_credentials",
          adminAccessTokenExpiresAt: input.expiresAt?.toISOString(),
          lastTokenRefreshAt: input.refreshedAt.toISOString()
        })
      }
    });
  });
}

export async function deleteStore(
  organizationId: string,
  input: DeleteStoreInput,
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    const store = await tx.shopifyStore.findFirst({
      where: { id: input.storeId, organizationId },
      include: {
        _count: {
          select: {
            localeConfigs: true,
            aiProviderConfigs: true,
            brandVoices: true,
            campaigns: true,
            articles: true,
            articleTranslations: true,
            generatedAssets: true,
            publishJobs: true,
            publishLogs: true,
            auditLogs: true,
            productSnapshots: true,
            collectionSnapshots: true
          }
        }
      }
    });

    if (!store) return null;

    await tx.auditLog.create({
      data: {
        organizationId,
        storeId: store.id,
        userId: requestContext.requestedByUserId,
        action: "delete",
        entityType: "shopify_store",
        entityId: store.id,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: compactJsonObject({
          deletedStoreId: store.id,
          name: store.name,
          domain: store.myshopifyDomain,
          apiVersion: store.apiVersion,
          primaryLocale: store.primaryLocale,
          status: store.status,
          removedCounts: store._count
        })
      }
    });

    await tx.shopifyStore.delete({
      where: { id: store.id }
    });

    return store;
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
        metadata: compactJsonObject({
          generationConfig: input.generationConfig
        }),
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
              generationConfig: input.generationConfig,
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
          sourceType: input.sourceType,
          generationConfig: input.generationConfig
        })
      }
    });

    return { campaign, job };
  });
}

export async function markPublishJobEnqueued(jobId: string, externalJobId: string) {
  return prisma.publishJob.update({
    where: { id: jobId },
    data: {
      externalJobId,
      status: "queued",
      errorMessage: null
    }
  });
}

export async function markPublishJobQueueFailed(jobId: string, errorMessage: string) {
  return prisma.publishJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      lockedAt: null,
      errorMessage
    }
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
        },
        seoPerformanceSnapshots: {
          orderBy: { syncedAt: "desc" },
          take: 1,
          select: {
            syncedAt: true,
            clicks: true,
            impressions: true,
            ctr: true,
            position: true,
            performanceScore: true
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

export async function createArticleRepairJob(
  organizationId: string,
  input: QueueArticleRepairInput,
  requestContext: AdminRequestContextInput
) {
  return prisma.$transaction(async (tx: AdminDbClient) => {
    const article = await findArticleById(organizationId, input.articleId, tx);
    if (!article) return null;

    const runAt = new Date();
    const generationConfig = mergeRepairGenerationConfig(article.generationMetadata);
    const job = await tx.publishJob.create({
      data: {
        organizationId,
        storeId: article.storeId,
        articleId: article.id,
        type: "generate_article",
        status: "queued",
        runAt,
        payload: compactJsonObject({
          organizationId,
          storeId: article.storeId,
          articleId: article.id,
          campaignId: article.campaignId,
          locale: article.locale,
          sourceType: article.sourceType,
          sourceId: article.sourceId,
          topic: article.title ?? article.primaryKeyword,
          publishPolicy: article.publishPolicy,
          targetWordCount: estimateRepairTargetWordCount(article.bodyHtml),
          primaryKeyword: article.primaryKeyword,
          keywords: [article.primaryKeyword, ...article.secondaryKeywords].filter(Boolean),
          generationConfig,
          generationMode: "article_repair",
          repairReason: input.repairReason,
          publishAfterRepair: article.status === "published" || Boolean(input.publishAt),
          publishAt: input.publishAt,
          queue: "blog-generation",
          jobName: "blog.generate"
        })
      }
    });

    const updatedArticle = await tx.blogArticle.update({
      where: { id: article.id },
      data: {
        status: article.status === "published" ? article.status : "draft",
        failureReason: null
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
        },
        seoPerformanceSnapshots: {
          orderBy: { syncedAt: "desc" },
          take: 1,
          select: {
            syncedAt: true,
            clicks: true,
            impressions: true,
            ctr: true,
            position: true,
            performanceScore: true
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
        message: `Queued AI repair for article ${article.title ?? article.id}.`,
        payload: compactJsonObject({
          articleId: article.id,
          jobType: job.type,
          generationMode: "article_repair",
          repairReason: input.repairReason,
          publishAfterRepair: article.status === "published" || Boolean(input.publishAt),
          publishAt: input.publishAt
        })
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        storeId: article.storeId,
        userId: requestContext.requestedByUserId,
        action: "generate",
        entityType: "blog_article",
        entityId: article.id,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        metadata: compactJsonObject({
          jobId: job.id,
          generationMode: "article_repair",
          repairReason: input.repairReason,
          publishAfterRepair: article.status === "published" || Boolean(input.publishAt),
          publishAt: input.publishAt
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

function mergeRepairGenerationConfig(generationMetadata: unknown): Record<string, unknown> {
  const metadata = isRecord(generationMetadata) ? generationMetadata : {};
  const contentEngine = isRecord(metadata.contentEngine) ? metadata.contentEngine : {};
  const artifacts = isRecord(contentEngine.artifacts) ? contentEngine.artifacts : {};
  const contextConfig = isRecord(metadata.generationConfig)
    ? metadata.generationConfig
    : isRecord(contentEngine.generationConfig)
      ? contentEngine.generationConfig
      : isRecord(artifacts.generationConfig)
        ? artifacts.generationConfig
        : {};

  return compactJsonObject({
    ...contextConfig,
    topicDiscovery: {
      ...(isRecord(contextConfig.topicDiscovery) ? contextConfig.topicDiscovery : {}),
      enabled: false
    },
    hotNews: {
      ...(isRecord(contextConfig.hotNews) ? contextConfig.hotNews : {}),
      enabled: true,
      lookbackDays: numberFromConfig(contextConfig.hotNews, "lookbackDays") ?? 14,
      maxItems: numberFromConfig(contextConfig.hotNews, "maxItems") ?? 5,
      sources: ["google_news", "google_trends"]
    },
    internalLinks: {
      ...(isRecord(contextConfig.internalLinks) ? contextConfig.internalLinks : {}),
      enabled: true,
      maxLinks: numberFromConfig(contextConfig.internalLinks, "maxLinks") ?? 4
    },
    externalReferences: {
      ...(isRecord(contextConfig.externalReferences) ? contextConfig.externalReferences : {}),
      enabled: true,
      minLinks: numberFromConfig(contextConfig.externalReferences, "minLinks") ?? 1,
      maxLinks: numberFromConfig(contextConfig.externalReferences, "maxLinks") ?? 3,
      requireEveryArticle: true
    },
    imageGeneration: {
      ...(isRecord(contextConfig.imageGeneration) ? contextConfig.imageGeneration : {}),
      enabled: false
    },
    qualityGate: {
      ...(isRecord(contextConfig.qualityGate) ? contextConfig.qualityGate : {}),
      enabled: true,
      minSeoScore: numberFromConfig(contextConfig.qualityGate, "minSeoScore") ?? 78,
      minEditorialScore: numberFromConfig(contextConfig.qualityGate, "minEditorialScore") ?? 72,
      rejectTemplatePatterns: true
    },
    aiSearchReview: {
      ...(isRecord(contextConfig.aiSearchReview) ? contextConfig.aiSearchReview : {}),
      enabled: true,
      minTrafficScore: numberFromConfig(contextConfig.aiSearchReview, "minTrafficScore") ?? 84,
      maxRevisionPasses: numberFromConfig(contextConfig.aiSearchReview, "maxRevisionPasses") ?? 3
    }
  });
}

function numberFromConfig(value: unknown, key: string): number | undefined {
  const record = isRecord(value) ? value : {};
  const item = record[key];
  return typeof item === "number" && Number.isFinite(item) ? item : undefined;
}

function estimateRepairTargetWordCount(bodyHtml: string | null): number {
  const text = (bodyHtml ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const latinWords = text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const estimated = latinWords + Math.ceil(cjkChars / 2);
  return Math.max(900, Math.min(3500, Math.round((estimated || 1400) * 1.12)));
}

function shopDomainMetadata(shop: ShopifyShopInfo): Record<string, unknown> {
  const primaryDomainHost = normalizeStorefrontHost(shop.primaryDomain?.host);
  const storefrontUrl = primaryDomainHost ? `https://${primaryDomainHost}` : normalizeStorefrontUrl(shop.url);
  return compactJsonObject({
    primaryDomainHost,
    primaryDomainUrl: storefrontUrl,
    shopUrl: normalizeStorefrontUrl(shop.url)
  });
}

function storefrontHostFromStore(store: { myshopifyDomain: string; metadata?: unknown }): string {
  const metadata = isRecord(store.metadata) ? store.metadata : {};
  return (
    normalizeStorefrontHost(metadata.primaryDomainHost) ??
    hostFromUrl(typeof metadata.primaryDomainUrl === "string" ? metadata.primaryDomainUrl : undefined) ??
    hostFromUrl(typeof metadata.shopUrl === "string" ? metadata.shopUrl : undefined) ??
    store.myshopifyDomain
  );
}

function normalizeStorefrontUrl(value: string | null | undefined): string | undefined {
  const host = hostFromUrl(value) ?? normalizeStorefrontHost(value);
  return host ? `https://${host}` : undefined;
}

function hostFromUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return normalizeStorefrontHost(new URL(value).hostname);
  } catch {
    return undefined;
  }
}

function normalizeStorefrontHost(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const host = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(host)) return undefined;
  return host;
}

async function upsertProductSnapshot(
  tx: AdminDbClient,
  organizationId: string,
  storeId: string,
  product: ShopifyProduct,
  syncedAt: Date
) {
  const snapshotData = {
    shopifyProductId: product.id,
    handle: product.handle || fallbackHandle("product", product.id),
    title: product.title || product.id,
    descriptionHtml: product.descriptionHtml ?? product.description ?? null,
    productType: product.productType ?? null,
    vendor: product.vendor ?? null,
    status: product.status ?? null,
    tags: product.tags ?? [],
    imageUrls: uniqueStrings([
      product.featuredImage?.url,
      ...(product.images?.nodes?.map((image) => image.url) ?? [])
    ]),
    seoTitle: product.seo?.title ?? null,
    seoDescription: product.seo?.description ?? null,
    options: toPrismaJson(product.options ?? []),
    variants: toPrismaJson(product.variants?.nodes ?? []),
    raw: toPrismaJson(product),
    syncedAt
  };

  try {
    await tx.productSnapshot.upsert({
      where: {
        storeId_shopifyProductId: {
          storeId,
          shopifyProductId: product.id
        }
      },
      update: snapshotData,
      create: {
        organizationId,
        storeId,
        ...snapshotData
      }
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    await tx.productSnapshot.update({
      where: {
        storeId_handle: {
          storeId,
          handle: snapshotData.handle
        }
      },
      data: snapshotData
    });
  }
}

async function upsertCollectionSnapshot(
  tx: AdminDbClient,
  organizationId: string,
  storeId: string,
  collection: ShopifyCollection,
  syncedAt: Date
) {
  const snapshotData = {
    shopifyCollectionId: collection.id,
    handle: collection.handle || fallbackHandle("collection", collection.id),
    title: collection.title || collection.id,
    descriptionHtml: collection.descriptionHtml ?? null,
    imageUrl: collection.image?.url ?? null,
    collectionType: null,
    ruleSet: undefined,
    seoTitle: null,
    seoDescription: null,
    raw: toPrismaJson(collection),
    syncedAt
  };

  try {
    await tx.collectionSnapshot.upsert({
      where: {
        storeId_shopifyCollectionId: {
          storeId,
          shopifyCollectionId: collection.id
        }
      },
      update: snapshotData,
      create: {
        organizationId,
        storeId,
        ...snapshotData
      }
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    await tx.collectionSnapshot.update({
      where: {
        storeId_handle: {
          storeId,
          handle: snapshotData.handle
        }
      },
      data: snapshotData
    });
  }
}

async function upsertShopifyBlogArticle(
  tx: AdminDbClient,
  organizationId: string,
  store: {
    id: string;
    myshopifyDomain: string;
    metadata?: unknown;
    primaryLocale: string;
    localeConfigs: Array<{
      locale: string;
      shopifyBlogId: string | null;
      shopifyBlogHandle: string | null;
    }>;
  },
  article: ShopifyBlogArticle,
  blogs: ShopifyBlog[],
  syncedAt: Date
) {
  const blog = resolveArticleBlog(article, blogs);
  const handle = article.handle || fallbackHandle("article", article.id);
  const locale = resolveArticleLocale(store, blog);
  const status = article.isPublished === false ? "draft" : "published";
  const publishedAt = parseOptionalDate(article.publishedAt);
  const storefrontHost = storefrontHostFromStore(store);
  const snapshotData = {
    locale,
    sourceType: "manual_topic" as const,
    sourceId: article.id,
    status,
    publishPolicy: "direct" as const,
    title: article.title || handle,
    handle,
    summary: article.summary ?? null,
    bodyHtml: article.body ?? null,
    tags: article.tags ?? [],
    qualityPassed: true,
    shopifyBlogId: blog?.id ?? article.blog?.id ?? null,
    shopifyArticleId: article.id,
    canonicalUrl: blog?.handle ? `https://${storefrontHost}/blogs/${blog.handle}/${handle}` : null,
    publishedAt: publishedAt ?? (status === "published" ? syncedAt : null),
    lastGeneratedAt: null,
    failureReason: null,
    generationMetadata: toPrismaJson({
      importedFromShopify: true,
      source: "shopify_sync",
      shopifyBlogHandle: blog?.handle ?? article.blog?.handle,
      shopifyBlogTitle: blog?.title ?? article.blog?.title,
      shopifyUpdatedAt: article.updatedAt,
      syncedAt: syncedAt.toISOString()
    })
  };

  const existing = await tx.blogArticle.findFirst({
    where: {
      storeId: store.id,
      OR: [
        { shopifyArticleId: article.id },
        {
          locale,
          handle
        }
      ]
    }
  });

  if (existing) {
    await tx.blogArticle.update({
      where: { id: existing.id },
      data: snapshotData
    });
    return;
  }

  await tx.blogArticle.create({
    data: {
      organizationId,
      storeId: store.id,
      ...snapshotData
    }
  });
}

function resolveArticleBlog(article: ShopifyBlogArticle, blogs: ShopifyBlog[]) {
  return blogs.find((blog) => blog.id === article.blog?.id) ?? blogs.find((blog) => blog.handle === article.blog?.handle);
}

function resolveArticleLocale(
  store: {
    primaryLocale: string;
    localeConfigs: Array<{
      locale: string;
      shopifyBlogId: string | null;
      shopifyBlogHandle: string | null;
    }>;
  },
  blog: ShopifyBlog | undefined
) {
  const matchedLocale = store.localeConfigs.find(
    (config) => (blog?.id && config.shopifyBlogId === blog.id) || (blog?.handle && config.shopifyBlogHandle === blog.handle)
  );
  return matchedLocale?.locale ?? store.primaryLocale;
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | undefined {
  const sanitized = sanitizeJson(value, new WeakSet());
  return sanitized === undefined ? undefined : (sanitized as Prisma.InputJsonValue);
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: "code" in error ? (error as { code?: unknown }).code : undefined,
      status: "status" in error ? (error as { status?: unknown }).status : undefined,
      details: "details" in error ? (error as { details?: unknown }).details : undefined
    };
  }

  return {
    message: String(error)
  };
}

function sanitizeJson(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;

  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return value;
  if (type === "bigint") return value.toString();
  if (type === "symbol" || type === "function") return undefined;
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item, seen) ?? null);
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const sanitized = sanitizeJson(item, seen);
      if (sanitized !== undefined) output[key] = sanitized;
    }

    seen.delete(value);
    return output;
  }

  return String(value);
}

function fallbackHandle(prefix: string, shopifyId: string): string {
  const id = extractShopifySearchId(shopifyId) || String(hashString(shopifyId));
  return `${prefix}-${id}`.toLowerCase();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function extractShopifySearchId(value: string): string {
  const trimmed = value.trim();
  const numericGid = trimmed.match(/\/(\d+)$/);
  if (numericGid?.[1]) return numericGid[1];
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "");
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localeLabel(locale: string) {
  const labels: Record<string, string> = {
    "zh-CN": "简体中文",
    "en-US": "English",
    "ja-JP": "日本語",
    "de-DE": "Deutsch",
    "fr-FR": "Français",
    "es-ES": "Español"
  };

  return labels[locale] ?? locale;
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
