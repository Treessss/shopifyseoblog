import { encryptSecret, maybeDecryptSecret, prisma } from "@shopify-ai-blog/db";
import { exchangeShopifyClientCredentials } from "@shopify-ai-blog/shopify";
import { domainError, getErrorMessage, isWorkerDomainError } from "./shared";

const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;

export interface StoreAccessTokenRecord {
  id: string;
  myshopifyDomain: string;
  adminAccessTokenEncrypted: string | null;
  adminAccessTokenExpiresAt: Date | null;
  shopifyClientId: string | null;
  shopifyClientSecretEncrypted: string | null;
  scopes: string[];
}

export async function resolveFreshStoreAccessToken(
  store: StoreAccessTokenRecord,
  action: "sync" | "publish"
): Promise<string> {
  let accessToken: string | null | undefined;
  try {
    accessToken = maybeDecryptSecret(store.adminAccessTokenEncrypted);
  } catch (error) {
    throw domainError(
      "SHOPIFY_TOKEN_DECRYPT_FAILED",
      `Could not decrypt the Shopify Admin API token for ${store.myshopifyDomain}: ${getErrorMessage(error)}`,
      { retryable: false }
    );
  }

  const hasClientCredentials = Boolean(store.shopifyClientId && store.shopifyClientSecretEncrypted);
  if (accessToken && (!hasClientCredentials || !shouldRefreshToken(store.adminAccessTokenExpiresAt))) {
    return accessToken;
  }

  if (!hasClientCredentials) {
    if (accessToken) return accessToken;
    throw domainError(
      "SHOPIFY_TOKEN_MISSING",
      `Store ${store.myshopifyDomain} does not have an Admin API access token. Reconnect Shopify before ${action}.`,
      { retryable: false }
    );
  }

  let clientSecret: string | null | undefined;
  try {
    clientSecret = maybeDecryptSecret(store.shopifyClientSecretEncrypted);
  } catch (error) {
    throw domainError(
      "SHOPIFY_CLIENT_SECRET_DECRYPT_FAILED",
      `Could not decrypt the Shopify client secret for ${store.myshopifyDomain}: ${getErrorMessage(error)}`,
      { retryable: false }
    );
  }

  if (!store.shopifyClientId || !clientSecret) {
    if (accessToken) return accessToken;
    throw domainError(
      "SHOPIFY_CLIENT_CREDENTIALS_MISSING",
      `Store ${store.myshopifyDomain} does not have Shopify client credentials. Reconnect Shopify before ${action}.`,
      { retryable: false }
    );
  }

  try {
    const refreshedToken = await exchangeShopifyClientCredentials({
      shop: store.myshopifyDomain,
      clientId: store.shopifyClientId,
      clientSecret
    });

    if (!refreshedToken.access_token) {
      throw domainError(
        "SHOPIFY_ACCESS_TOKEN_MISSING",
        `Shopify did not return an Admin API access token for ${store.myshopifyDomain}.`,
        { retryable: true }
      );
    }

    await prisma.shopifyStore.update({
      where: { id: store.id },
      data: {
        adminAccessTokenEncrypted: encryptSecret(refreshedToken.access_token),
        adminAccessTokenExpiresAt: tokenExpiryDate(refreshedToken.expires_in) ?? null,
        scopes: parseShopifyScopeList(refreshedToken.scope, store.scopes)
      }
    });

    return refreshedToken.access_token;
  } catch (error) {
    if (isWorkerDomainError(error)) throw error;
    throw domainError(
      "SHOPIFY_CLIENT_CREDENTIALS_REFRESH_FAILED",
      `Could not refresh the Shopify Admin API token for ${store.myshopifyDomain}: ${getErrorMessage(error)}`,
      { retryable: true }
    );
  }
}

function shouldRefreshToken(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - Date.now() <= TOKEN_REFRESH_WINDOW_MS;
}

function parseShopifyScopeList(scope: string | undefined, fallback: string[]): string[] {
  if (!scope) return fallback;
  const scopes = scope
    .split(/\s*,\s*|\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return scopes.length > 0 ? scopes : fallback;
}

function tokenExpiryDate(expiresInSeconds: number | undefined): Date | undefined {
  if (!Number.isFinite(expiresInSeconds) || !expiresInSeconds) return undefined;
  return new Date(Date.now() + expiresInSeconds * 1000);
}
