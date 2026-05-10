import { AdminApiError } from "./errors";

const SYNCABLE_STORE_STATUSES = new Set(["active", "installing", "disconnected"]);

interface TenantResource {
  organizationId: string;
}

interface StoreResource extends TenantResource {
  id: string;
  status: string;
  adminAccessTokenEncrypted?: string | null;
  shopifyClientId?: string | null;
  shopifyClientSecretEncrypted?: string | null;
}

interface ArticleResource extends TenantResource {
  id: string;
  status: string;
  qualityPassed: boolean;
  publishPolicy: string;
  title: string | null;
  bodyHtml: string | null;
}

interface BrandVoiceResource extends TenantResource {
  id: string;
  storeId: string | null;
}

export function assertTenantResource(
  resource: { organizationId: string } | null | undefined,
  organizationId: string,
  entityName: string
) {
  if (!resource || resource.organizationId !== organizationId) {
    throw new AdminApiError(404, `${entityName.toUpperCase()}_NOT_FOUND`, `${entityName} was not found.`);
  }
}

export function assertStoreSyncAllowed(store: StoreResource, organizationId: string) {
  assertTenantResource(store, organizationId, "store");

  if (!SYNCABLE_STORE_STATUSES.has(store.status)) {
    throw new AdminApiError(409, "STORE_SYNC_NOT_ALLOWED", "Store must be active, installing, or reconnectable before sync can be queued.", {
      storeId: store.id,
      status: store.status
    });
  }

  if (store.status === "disconnected" && !hasReconnectCredentials(store)) {
    throw new AdminApiError(409, "STORE_SYNC_CREDENTIALS_REQUIRED", "Store credentials must be saved before reconnecting Shopify.", {
      storeId: store.id,
      status: store.status
    });
  }
}

function hasReconnectCredentials(store: StoreResource): boolean {
  return Boolean(store.adminAccessTokenEncrypted || (store.shopifyClientId && store.shopifyClientSecretEncrypted));
}

export function assertArticlePublishAllowed(article: ArticleResource, organizationId: string) {
  assertTenantResource(article, organizationId, "article");

  if (article.status === "published" || article.status === "publishing") {
    throw new AdminApiError(409, "ARTICLE_ALREADY_IN_PUBLISH_FLOW", "Article is already published or publishing.", {
      articleId: article.id,
      status: article.status
    });
  }

  if (article.status !== "ready_to_publish") {
    throw new AdminApiError(409, "ARTICLE_NOT_READY", "Article must be ready_to_publish before publishing can be queued.", {
      articleId: article.id,
      status: article.status
    });
  }

  if (article.publishPolicy !== "direct" && !article.qualityPassed) {
    throw new AdminApiError(409, "ARTICLE_QUALITY_GATE_FAILED", "Article has not passed the quality gate.", {
      articleId: article.id,
      publishPolicy: article.publishPolicy
    });
  }

  if (!article.title || !article.bodyHtml) {
    throw new AdminApiError(409, "ARTICLE_CONTENT_INCOMPLETE", "Article needs a title and body before publishing.", {
      articleId: article.id
    });
  }
}

export function assertBrandVoiceAllowed(brandVoice: BrandVoiceResource | null, organizationId: string, storeId: string) {
  if (!brandVoice) return;
  assertTenantResource(brandVoice, organizationId, "brandVoice");

  if (brandVoice.storeId && brandVoice.storeId !== storeId) {
    throw new AdminApiError(409, "BRAND_VOICE_STORE_MISMATCH", "Brand voice belongs to a different store.", {
      brandVoiceId: brandVoice.id,
      storeId
    });
  }
}
