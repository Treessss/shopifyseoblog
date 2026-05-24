import { describe, expect, it } from "vitest";
import { articleCreate, articleUpdate, ShopifyUserError, uploadImageFile, type ShopifyGraphQLClient } from "../packages/shopify/src";

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

  it("exposes articleUpdate user errors so the worker can recover missing remote articles", async () => {
    const client = {
      request: async () => ({
        articleUpdate: {
          article: null,
          userErrors: [{ message: "Article does not exist" }]
        }
      })
    } as unknown as ShopifyGraphQLClient;

    await expect(
      articleUpdate(client, {
        id: "gid://shopify/Article/404",
        blogId: "gid://shopify/Blog/2",
        title: "Recovered Article",
        bodyHtml: "<p>Recovered</p>",
        isPublished: true
      })
    ).rejects.toMatchObject({
      mutation: "articleUpdate",
      userErrors: [{ message: "Article does not exist" }]
    } satisfies Partial<ShopifyUserError>);
  });

  it("maps SEO metadata, brand author, and cover image into Shopify article input", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> | undefined }> = [];
    const client = fakeArticleClient(calls, "articleCreate");

    await articleCreate(client, {
      blogId: "gid://shopify/Blog/1",
      title: "Streetwear Phone Case Picks",
      bodyHtml: "<p>Ready</p>",
      summary: "Buyer-facing meta description.",
      seoTitle: "Streetwear Phone Case Picks",
      seoDescription: "Buyer-facing meta description.",
      author: "Caseease",
      image: {
        url: "https://cdn.shopify.com/s/files/1/blog-cover.jpg",
        altText: "Caseease streetwear phone case"
      },
      isPublished: true
    });

    const article = calls[0]?.variables?.article as Record<string, unknown>;
    expect(article.author).toEqual({ name: "Caseease" });
    expect(article.image).toEqual({
      url: "https://cdn.shopify.com/s/files/1/blog-cover.jpg",
      altText: "Caseease streetwear phone case"
    });
    expect(article.summary).toBe("Buyer-facing meta description.");
    expect(article.metafields).toContainEqual({
      namespace: "global",
      key: "description_tag",
      type: "single_line_text_field",
      value: "Buyer-facing meta description."
    });
  });

  it("uploads remote images through Shopify Files and returns the hosted URL", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> | undefined }> = [];
    const client = {
      request: async (query: string, variables?: Record<string, unknown>) => {
        calls.push({ query, variables });
        return {
          fileCreate: {
            files: [
              {
                id: "gid://shopify/MediaImage/1",
                fileStatus: "READY",
                image: {
                  url: "https://cdn.shopify.com/s/files/1/blog-image.jpg",
                  altText: "Blog image",
                  width: 1600,
                  height: 900
                }
              }
            ],
            userErrors: []
          }
        };
      }
    } as unknown as ShopifyGraphQLClient;

    const uploaded = await uploadImageFile(client, {
      originalSource: "https://images.example.com/provider-image.jpg",
      alt: "Blog image"
    });

    const files = calls[0]?.variables?.files as Array<Record<string, unknown>>;
    expect(files[0]).toMatchObject({
      originalSource: "https://images.example.com/provider-image.jpg",
      contentType: "IMAGE",
      alt: "Blog image"
    });
    expect(uploaded.url).toBe("https://cdn.shopify.com/s/files/1/blog-image.jpg");
  });

  it("polls Shopify Files until an uploaded image becomes ready", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> | undefined }> = [];
    const client = {
      request: async (query: string, variables?: Record<string, unknown>) => {
        calls.push({ query, variables });
        if (query.includes("fileCreate")) {
          return {
            fileCreate: {
              files: [
                {
                  id: "gid://shopify/MediaImage/2",
                  fileStatus: "UPLOADED",
                  image: null
                }
              ],
              userErrors: []
            }
          };
        }

        return {
          nodes: [
            {
              id: "gid://shopify/MediaImage/2",
              fileStatus: "UPLOADED",
              image: null,
              preview: {
                image: {
                  url: "https://cdn.shopify.com/s/files/1/ready-image.jpg",
                  altText: "Ready image",
                  width: 1200,
                  height: 800
                }
              }
            }
          ]
        };
      }
    } as unknown as ShopifyGraphQLClient;

    const uploaded = await uploadImageFile(
      client,
      {
        originalSource: "https://images.example.com/slow-image.jpg",
        alt: "Ready image"
      },
      { pollDelayMs: 0 }
    );

    expect(calls).toHaveLength(2);
    expect(uploaded.url).toBe("https://cdn.shopify.com/s/files/1/ready-image.jpg");
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
