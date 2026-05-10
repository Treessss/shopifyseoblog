import { maybeDecryptSecret } from "@shopify-ai-blog/db";
import {
  createShopifyGraphQLClient,
  exchangeShopifyClientCredentials,
  listBlogs,
  listCollections,
  listProducts,
  type ShopifyBlog,
  type ShopifyCollection,
  type ShopifyConnection,
  type ShopifyGraphQLClient,
  type ShopifyProduct
} from "@shopify-ai-blog/shopify";
import type { AdminRequestContextInput, QueueStoreSyncInput } from "../contracts";
import { AdminApiError } from "../policies/errors";
import * as repository from "../repository/admin-repository";

type StoreForSync = NonNullable<Awaited<ReturnType<typeof repository.findStoreById>>>;

interface ShopConnectionInfo {
  id: string;
  name: string;
  myshopifyDomain: string;
  email?: string | null;
  currencyCode?: string | null;
}

interface ShopConnectionResponse {
  shop: ShopConnectionInfo;
}

const SHOP_CONNECTION_QUERY = /* GraphQL */ `
  query ShopifyConnectionCheck {
    shop {
      id
      name
      myshopifyDomain
      email
      currencyCode
    }
  }
`;

export async function syncShopifyStoreResources(
  organizationId: string,
  store: StoreForSync,
  input: QueueStoreSyncInput,
  requestContext: AdminRequestContextInput
) {
  const client = await createStoreClient(organizationId, store);
  const shop = await verifyShopifyConnection(client, store);
  const maxItems = resolveMaxSyncItems(input.limit, input.fullSync);
  const syncedAt = new Date();

  const [productsResult, collectionsResult, blogsResult] = await Promise.all([
    input.products ? listAllProducts(client, maxItems, input.fullSync) : Promise.resolve(undefined),
    input.collections ? listAllCollections(client, maxItems, input.fullSync) : Promise.resolve(undefined),
    listBlogs(client, { first: 50 })
  ]);

  return repository.persistShopifyStoreSync(organizationId, {
    storeId: store.id,
    shop,
    products: productsResult?.connection.nodes,
    productsCapped: productsResult?.capped ?? false,
    collections: collectionsResult?.connection.nodes,
    collectionsCapped: collectionsResult?.capped ?? false,
    blogs: blogsResult.nodes,
    fullSync: input.fullSync,
    limit: input.limit,
    syncedAt
  }, requestContext);
}

async function createStoreClient(organizationId: string, store: StoreForSync): Promise<ShopifyGraphQLClient> {
  const accessToken = await resolveFreshStoreAccessToken(organizationId, store);

  return createShopifyGraphQLClient({
    shopDomain: store.myshopifyDomain,
    accessToken,
    apiVersion: store.apiVersion
  });
}

async function resolveFreshStoreAccessToken(organizationId: string, store: StoreForSync): Promise<string> {
  let accessToken: string | null | undefined;

  try {
    accessToken = maybeDecryptSecret(store.adminAccessTokenEncrypted);
  } catch (error) {
    throw new AdminApiError(409, "SHOPIFY_TOKEN_DECRYPT_FAILED", "Could not decrypt the Shopify Admin API token.", {
      storeId: store.id,
      domain: store.myshopifyDomain
    });
  }

  const hasClientCredentials = Boolean(store.shopifyClientId && store.shopifyClientSecretEncrypted);
  const forceRefresh = store.status === "disconnected";
  if (accessToken && (!hasClientCredentials || (!forceRefresh && !shouldRefreshToken(store.adminAccessTokenExpiresAt)))) {
    return accessToken;
  }

  if (!hasClientCredentials) {
    if (accessToken) return accessToken;
    throw new AdminApiError(409, "SHOPIFY_TOKEN_MISSING", "Store does not have an Admin API access token.", {
      storeId: store.id,
      domain: store.myshopifyDomain
    });
  }

  let clientSecret: string | null | undefined;
  try {
    clientSecret = maybeDecryptSecret(store.shopifyClientSecretEncrypted);
  } catch (error) {
    throw new AdminApiError(409, "SHOPIFY_CLIENT_SECRET_DECRYPT_FAILED", "Could not decrypt the Shopify client secret.", {
      storeId: store.id,
      domain: store.myshopifyDomain
    });
  }

  if (!store.shopifyClientId || !clientSecret) {
    if (accessToken) return accessToken;
    throw new AdminApiError(409, "SHOPIFY_CLIENT_CREDENTIALS_MISSING", "Store does not have Shopify client credentials.", {
      storeId: store.id,
      domain: store.myshopifyDomain
    });
  }

  try {
    const refreshedToken = await exchangeShopifyClientCredentials({
      shop: store.myshopifyDomain,
      clientId: store.shopifyClientId,
      clientSecret
    });

    if (!refreshedToken.access_token) {
      throw new AdminApiError(502, "SHOPIFY_ACCESS_TOKEN_MISSING", "Shopify did not return an Admin API access token.", {
        storeId: store.id,
        domain: store.myshopifyDomain
      });
    }

    await repository.updateStoreAccessTokenFromClientCredentials(organizationId, store.id, {
      accessToken: refreshedToken.access_token,
      scopes: parseShopifyScopeList(refreshedToken.scope),
      expiresAt: tokenExpiryDate(refreshedToken.expires_in),
      refreshedAt: new Date()
    });

    return refreshedToken.access_token;
  } catch (error) {
    if (error instanceof AdminApiError) throw error;
    throw new AdminApiError(502, "SHOPIFY_CLIENT_CREDENTIALS_REFRESH_FAILED", "Could not refresh the Shopify Admin API token.", {
      storeId: store.id,
      domain: store.myshopifyDomain,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function shouldRefreshToken(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - Date.now() <= 5 * 60 * 1000;
}

function parseShopifyScopeList(scope: string | undefined): string[] {
  if (!scope) return [];
  return scope
    .split(/\s*,\s*|\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function tokenExpiryDate(expiresInSeconds: number | undefined): Date | undefined {
  if (!Number.isFinite(expiresInSeconds) || !expiresInSeconds) return undefined;
  return new Date(Date.now() + expiresInSeconds * 1000);
}

async function verifyShopifyConnection(client: ShopifyGraphQLClient, store: StoreForSync) {
  try {
    const data = await client.request<ShopConnectionResponse>(SHOP_CONNECTION_QUERY);
    if (!data.shop?.id) {
      throw new AdminApiError(502, "SHOPIFY_CONNECTION_INVALID", "Shopify did not return shop identity.", {
        storeId: store.id,
        domain: store.myshopifyDomain
      });
    }
    return data.shop;
  } catch (error) {
    if (error instanceof AdminApiError) throw error;
    throw new AdminApiError(502, "SHOPIFY_CONNECTION_FAILED", "Unable to verify this store with Shopify Admin API.", {
      storeId: store.id,
      domain: store.myshopifyDomain,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

async function listAllProducts(client: ShopifyGraphQLClient, maxItems: number, fullSync: boolean) {
  return listAllPages(maxItems, fullSync, (first, after) => listProducts(client, { first, after }));
}

async function listAllCollections(client: ShopifyGraphQLClient, maxItems: number, fullSync: boolean) {
  return listAllPages(maxItems, fullSync, (first, after) => listCollections(client, { first, after }));
}

async function listAllPages<TNode>(
  maxItems: number,
  fullSync: boolean,
  listPage: (first: number, after: string | undefined) => Promise<ShopifyConnection<TNode>>
) {
  const nodes: TNode[] = [];
  const edges: ShopifyConnection<TNode>["edges"] = [];
  let after: string | undefined;
  let hasNextPage = false;

  do {
    const remaining = maxItems - nodes.length;
    if (remaining <= 0) break;

    const connection = await listPage(Math.min(250, remaining), after);
    nodes.push(...connection.nodes);
    edges.push(...connection.edges);
    hasNextPage = Boolean(connection.pageInfo.hasNextPage);
    after = connection.pageInfo.endCursor ?? undefined;
  } while (fullSync && hasNextPage && nodes.length < maxItems);

  return {
    connection: {
      nodes,
      edges,
      pageInfo: {
        hasNextPage,
        hasPreviousPage: false,
        endCursor: after
      }
    },
    capped: hasNextPage && nodes.length >= maxItems
  };
}

function resolveMaxSyncItems(requestedLimit: number | undefined, fullSync: boolean) {
  if (requestedLimit !== undefined) return clampInteger(requestedLimit, 50, 1, 2500);
  return fullSync ? clampInteger(Number(process.env.SHOPIFY_SYNC_MAX_ITEMS), 1000, 1, 2500) : 50;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
