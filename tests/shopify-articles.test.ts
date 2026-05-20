import { describe, expect, it } from "vitest";
import { articleCreate, articleUpdate, type ShopifyGraphQLClient } from "../packages/shopify/src";

describe("Shopify article GraphQL wrappers", () => {
  it("does not send publishDate for immediate publish creates", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> | undefined }> = [];
    const client = fakeArticleClient(calls, "articleCreate");

    await articleCreate(client, {
      blogId: "gid://shopify/Blog/1",
      title: "Immediate Article",
      bodyHtml: "<p>Ready</p>",
      isPublished: true,
      publishDate: "2099-01-01T00:00:00.000Z"
    });

    const article = calls[0]?.variables?.article as Record<string, unknown>;
    expect(article.isPublished).toBe(true);
    expect(article.publishDate).toBeUndefined();
    expect(article.blogId).toBe("gid://shopify/Blog/1");
  });

  it("uses the current articleUpdate shape and moves redirectNewHandle into input", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> | undefined }> = [];
    const client = fakeArticleClient(calls, "articleUpdate");

    await articleUpdate(client, {
      id: "gid://shopify/Article/1",
      blogId: "gid://shopify/Blog/2",
      title: "Updated Article",
      bodyHtml: "<p>Updated</p>",
      isPublished: true,
      redirectNewHandle: true
    });

    const call = calls[0];
    const article = call?.variables?.article as Record<string, unknown>;
    expect(call?.query).not.toContain("redirectNewHandle: $redirectNewHandle");
    expect(call?.variables).not.toHaveProperty("redirectNewHandle");
    expect(article.redirectNewHandle).toBe(true);
    expect(article.blogId).toBe("gid://shopify/Blog/2");
  });
});

function fakeArticleClient(
  calls: Array<{ query: string; variables: Record<string, unknown> | undefined }>,
  mutation: "articleCreate" | "articleUpdate"
): ShopifyGraphQLClient {
  return {
    request: async (query: string, variables?: Record<string, unknown>) => {
      calls.push({ query, variables });
      return {
        [mutation]: {
          article: {
            id: "gid://shopify/Article/1",
            title: "Article",
            handle: "article",
            tags: [],
            isPublished: true,
            publishedAt: "2026-05-21T00:00:00.000Z"
          },
          userErrors: []
        }
      };
    }
  } as unknown as ShopifyGraphQLClient;
}
