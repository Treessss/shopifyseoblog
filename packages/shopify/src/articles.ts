import { isRecord, ShopifyError, type ShopifyGraphQLClient } from "./client";

export interface ShopifyArticleAuthorInput {
  name: string;
}

export interface ShopifyArticleImageInput {
  url?: string;
  altText?: string;
}

export interface ShopifyArticleWriteInput {
  blogId?: string;
  title?: string;
  author?: ShopifyArticleAuthorInput | string;
  handle?: string;
  body?: string;
  bodyHtml?: string;
  summary?: string;
  seoTitle?: string;
  seoDescription?: string;
  isPublished?: boolean;
  publishDate?: string;
  tags?: string[];
  image?: ShopifyArticleImageInput;
  metafields?: Array<Record<string, unknown>>;
  templateSuffix?: string;
}

export interface ShopifyArticleCreateInput extends ShopifyArticleWriteInput {
  blogId: string;
  title: string;
}

export interface ShopifyArticleUpdateInput extends ShopifyArticleWriteInput {
  id: string;
  redirectNewHandle?: boolean;
}

export interface ShopifyArticle {
  id: string;
  title: string;
  handle: string;
  body?: string;
  summary?: string;
  tags: string[];
  isPublished?: boolean;
  publishedAt?: string | null;
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

export interface ShopifyMutationUserError {
  code?: string;
  field?: string[];
  message: string;
}

export class ShopifyUserError extends ShopifyError {
  constructor(
    readonly mutation: string,
    readonly userErrors: ShopifyMutationUserError[]
  ) {
    super(`${mutation} returned user errors: ${userErrors.map((error) => error.message).join("; ")}`, userErrors);
    this.name = "ShopifyUserError";
  }
}

const ARTICLE_FIELDS = /* GraphQL */ `
  id
  title
  handle
  body
  summary
  tags
  isPublished
  publishedAt
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
`;

const ARTICLE_CREATE_MUTATION = /* GraphQL */ `
  mutation ShopifyArticleCreate($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article {
        ${ARTICLE_FIELDS}
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

const ARTICLE_UPDATE_MUTATION = /* GraphQL */ `
  mutation ShopifyArticleUpdate($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article {
        ${ARTICLE_FIELDS}
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

export async function articleCreate(client: ShopifyGraphQLClient, input: ShopifyArticleCreateInput): Promise<ShopifyArticle> {
  const data = await client.request<{ articleCreate: ShopifyArticlePayload }>(ARTICLE_CREATE_MUTATION, {
    article: normalizeArticleInput(input, "create")
  });

  return unwrapArticlePayload("articleCreate", data.articleCreate);
}

export async function createArticle(client: ShopifyGraphQLClient, input: ShopifyArticleCreateInput): Promise<ShopifyArticle> {
  return articleCreate(client, input);
}

export async function articleUpdate(
  client: ShopifyGraphQLClient,
  idOrInput: string | ShopifyArticleUpdateInput,
  input?: ShopifyArticleWriteInput
): Promise<ShopifyArticle> {
  const id = typeof idOrInput === "string" ? idOrInput : idOrInput.id;
  const articleInput = typeof idOrInput === "string" ? input : idOrInput;
  if (!articleInput) {
    throw new ShopifyError("articleUpdate requires article input.");
  }

  const data = await client.request<{ articleUpdate: ShopifyArticlePayload }>(ARTICLE_UPDATE_MUTATION, {
    id,
    article: normalizeArticleInput(articleInput, "update")
  });

  return unwrapArticlePayload("articleUpdate", data.articleUpdate);
}

export async function updateArticle(
  client: ShopifyGraphQLClient,
  idOrInput: string | ShopifyArticleUpdateInput,
  input?: ShopifyArticleWriteInput
): Promise<ShopifyArticle> {
  return articleUpdate(client, idOrInput, input);
}

function normalizeArticleInput(input: ShopifyArticleWriteInput, mode: "create" | "update"): Record<string, unknown> {
  if (mode === "create" && !input.title) {
    throw new ShopifyError("articleCreate requires title.");
  }

  const author = typeof input.author === "string" ? { name: input.author } : input.author;
  const publishDate = input.isPublished === true ? undefined : input.publishDate;
  const redirectNewHandle = mode === "update" && "redirectNewHandle" in input ? input.redirectNewHandle : undefined;
  return removeUndefined({
    blogId: input.blogId,
    title: input.title,
    author: author ?? { name: "Shopify AI Blog" },
    handle: input.handle,
    body: input.body ?? input.bodyHtml,
    summary: input.summary,
    isPublished: input.isPublished,
    publishDate,
    redirectNewHandle,
    tags: input.tags,
    image: input.image,
    metafields: articleSeoMetafields(input.metafields, input.seoTitle, input.seoDescription),
    templateSuffix: input.templateSuffix
  });
}

function articleSeoMetafields(
  metafields: Array<Record<string, unknown>> | undefined,
  seoTitle: string | null | undefined,
  seoDescription: string | null | undefined
): Array<Record<string, unknown>> | undefined {
  const base = metafields ?? [];
  const additions = [
    seoTitle
      ? {
          namespace: "global",
          key: "title_tag",
          type: "single_line_text_field",
          value: seoTitle
        }
      : undefined,
    seoDescription
      ? {
          namespace: "global",
          key: "description_tag",
          type: "single_line_text_field",
          value: seoDescription
        }
      : undefined
  ].filter(Boolean) as Array<Record<string, unknown>>;

  const merged = new Map<string, Record<string, unknown>>();
  for (const metafield of [...base, ...additions]) {
    const namespace = typeof metafield.namespace === "string" ? metafield.namespace : "global";
    const key = typeof metafield.key === "string" ? metafield.key : JSON.stringify(metafield);
    merged.set(`${namespace}:${key}`, metafield);
  }
  return merged.size > 0 ? Array.from(merged.values()) : undefined;
}

interface ShopifyArticlePayload {
  article?: ShopifyArticle | null;
  userErrors?: ShopifyMutationUserError[];
}

function unwrapArticlePayload(mutation: string, payload: ShopifyArticlePayload): ShopifyArticle {
  const userErrors = payload.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new ShopifyUserError(mutation, userErrors);
  }

  if (!payload.article || !isRecord(payload.article)) {
    throw new ShopifyError(`${mutation} did not return an article.`, payload);
  }

  return payload.article;
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
