import type { ShopifyGraphQLClient } from "./client";

export interface ShopifyPageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string | null;
  endCursor?: string | null;
}

export interface ShopifyConnection<TNode> {
  nodes: TNode[];
  edges: Array<{
    cursor: string;
    node: TNode;
  }>;
  pageInfo: ShopifyPageInfo;
}

export interface ShopifyListOptions {
  first?: number;
  after?: string;
  query?: string;
  reverse?: boolean;
  sortKey?: string;
}

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  description?: string;
  descriptionHtml?: string;
  productType?: string;
  vendor?: string;
  tags: string[];
  updatedAt?: string;
  featuredImage?: {
    url?: string;
    altText?: string;
  } | null;
  images?: {
    nodes?: Array<{
      url?: string;
      altText?: string;
    }>;
  } | null;
  seo?: {
    title?: string;
    description?: string;
  };
}

export interface ShopifyCollection {
  id: string;
  title: string;
  handle: string;
  descriptionHtml?: string;
  updatedAt?: string;
  sortOrder?: string;
  templateSuffix?: string | null;
  image?: {
    url?: string;
    altText?: string;
  } | null;
}

export interface ShopifyBlog {
  id: string;
  title: string;
  handle: string;
  updatedAt?: string;
  createdAt?: string;
  commentPolicy?: string;
  templateSuffix?: string | null;
  tags?: string[];
  feed?: {
    path?: string;
    location?: string;
  } | null;
}

export interface ShopifyBlogArticle {
  id: string;
  title: string;
  handle: string;
  body?: string;
  summary?: string;
  tags: string[];
  isPublished?: boolean;
  publishedAt?: string | null;
  updatedAt?: string;
  author?: {
    name?: string;
  };
  blog?: {
    id: string;
    title?: string;
    handle?: string;
  };
  image?: {
    altText?: string;
    originalSrc?: string;
  } | null;
}

const PAGE_INFO_FIELDS = /* GraphQL */ `
  pageInfo {
    hasNextPage
    hasPreviousPage
    startCursor
    endCursor
  }
`;

const PRODUCTS_QUERY = /* GraphQL */ `
  query ShopifyProducts($first: Int!, $after: String, $query: String, $reverse: Boolean, $sortKey: ProductSortKeys) {
    products(first: $first, after: $after, query: $query, reverse: $reverse, sortKey: $sortKey) {
      edges {
        cursor
        node {
          id
          title
          handle
          description
          descriptionHtml
          productType
          vendor
          tags
          updatedAt
          featuredImage {
            url
            altText
          }
          images(first: 6) {
            nodes {
              url
              altText
            }
          }
          seo {
            title
            description
          }
        }
      }
      ${PAGE_INFO_FIELDS}
    }
  }
`;

const COLLECTIONS_QUERY = /* GraphQL */ `
  query ShopifyCollections($first: Int!, $after: String, $query: String, $reverse: Boolean, $sortKey: CollectionSortKeys) {
    collections(first: $first, after: $after, query: $query, reverse: $reverse, sortKey: $sortKey) {
      edges {
        cursor
        node {
          id
          title
          handle
          updatedAt
          descriptionHtml
          sortOrder
          templateSuffix
          image {
            url
            altText
          }
        }
      }
      ${PAGE_INFO_FIELDS}
    }
  }
`;

const BLOGS_QUERY = /* GraphQL */ `
  query ShopifyBlogs($first: Int!, $after: String, $query: String, $reverse: Boolean, $sortKey: BlogSortKeys) {
    blogs(first: $first, after: $after, query: $query, reverse: $reverse, sortKey: $sortKey) {
      edges {
        cursor
        node {
          id
          handle
          title
          updatedAt
          commentPolicy
          feed {
            path
            location
          }
          createdAt
          templateSuffix
          tags
        }
      }
      ${PAGE_INFO_FIELDS}
    }
  }
`;

const BLOG_ARTICLES_QUERY = /* GraphQL */ `
  query ShopifyBlogArticles($blogId: ID!, $first: Int!, $after: String) {
    blog(id: $blogId) {
      articles(first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            title
            handle
            body
            summary
            tags
            isPublished
            publishedAt
            updatedAt
            author {
              name
            }
            blog {
              id
              title
              handle
            }
            image {
              altText
              originalSrc
            }
          }
        }
        ${PAGE_INFO_FIELDS}
      }
    }
  }
`;

export async function listProducts(
  client: ShopifyGraphQLClient,
  options: ShopifyListOptions = {}
): Promise<ShopifyConnection<ShopifyProduct>> {
  const data = await client.request<{ products: ShopifyConnectionPayload<ShopifyProduct> }>(PRODUCTS_QUERY, buildListVariables(options));
  return normalizeConnection(data.products);
}

export async function listCollections(
  client: ShopifyGraphQLClient,
  options: ShopifyListOptions = {}
): Promise<ShopifyConnection<ShopifyCollection>> {
  const data = await client.request<{ collections: ShopifyConnectionPayload<ShopifyCollection> }>(
    COLLECTIONS_QUERY,
    buildListVariables(options)
  );
  return normalizeConnection(data.collections);
}

export async function listBlogs(client: ShopifyGraphQLClient, options: ShopifyListOptions = {}): Promise<ShopifyConnection<ShopifyBlog>> {
  const data = await client.request<{ blogs: ShopifyConnectionPayload<ShopifyBlog> }>(BLOGS_QUERY, buildListVariables(options));
  return normalizeConnection(data.blogs);
}

export async function listBlogArticles(
  client: ShopifyGraphQLClient,
  blogId: string,
  options: Omit<ShopifyListOptions, "query" | "reverse" | "sortKey"> = {}
): Promise<ShopifyConnection<ShopifyBlogArticle>> {
  const data = await client.request<{ blog?: { articles?: ShopifyConnectionPayload<ShopifyBlogArticle> } | null }>(
    BLOG_ARTICLES_QUERY,
    {
      blogId,
      first: options.first ?? 50,
      after: options.after
    }
  );

  return normalizeConnection(data.blog?.articles ?? { edges: [], pageInfo: undefined });
}

export const products = listProducts;
export const collections = listCollections;
export const blogs = listBlogs;
export const blogArticles = listBlogArticles;

interface ShopifyConnectionPayload<TNode> {
  edges?: Array<{
    cursor: string;
    node: TNode;
  }>;
  nodes?: TNode[];
  pageInfo?: ShopifyPageInfo;
}

function buildListVariables(options: ShopifyListOptions): Record<string, unknown> {
  return removeUndefined({
    first: options.first ?? 50,
    after: options.after,
    query: options.query,
    reverse: options.reverse,
    sortKey: options.sortKey
  });
}

function normalizeConnection<TNode>(payload: ShopifyConnectionPayload<TNode>): ShopifyConnection<TNode> {
  const edges =
    payload.edges ??
    (payload.nodes ?? []).map((node, index) => ({
      cursor: String(index),
      node
    }));

  return {
    edges,
    nodes: edges.map((edge) => edge.node),
    pageInfo: payload.pageInfo ?? {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: edges[0]?.cursor,
      endCursor: edges.at(-1)?.cursor
    }
  };
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
