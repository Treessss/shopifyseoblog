import { describe, expect, it } from "vitest";
import {
  normalizeInternalLinkUrl,
  sanitizeArticleInternalLinks,
  verifyInternalLinkCandidates
} from "../apps/worker/src/processors/internal-link-verification";

describe("internal link verification", () => {
  it("keeps only storefront links that can be confirmed", async () => {
    const fetchMock = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/missing")) return new Response(null, { status: 404 });
      return new Response(null, { status: 200 });
    };

    const links = await verifyInternalLinkCandidates(
      [
        {
          title: "Live product",
          url: "https://example.com/products/live",
          type: "product"
        },
        {
          title: "Missing article",
          url: "https://example.com/blogs/news/missing",
          type: "article"
        }
      ],
      { fetch: fetchMock }
    );

    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe("https://example.com/products/live");
  });

  it("unwraps invented internal links and preserves verified ones", () => {
    const html = [
      '<p>Read the <a href="https://example.com/products/live?utm=ai">verified page</a>.</p>',
      '<p>Skip the <a href="https://example.com/blogs/news/fake">fake article</a>.</p>',
      '<p>Keep <a href="https://support.apple.com/en-us/108044" rel="nofollow noopener noreferrer">Apple support</a>.</p>'
    ].join("");

    const cleaned = sanitizeArticleInternalLinks(html, {
      storefrontHost: "example.com",
      internalLinks: [
        {
          title: "Live product",
          url: "https://example.com/products/live",
          type: "product"
        }
      ]
    });

    expect(cleaned).toContain('<a href="https://example.com/products/live">verified page</a>');
    expect(cleaned).toContain("Skip the fake article.");
    expect(cleaned).not.toContain("https://example.com/blogs/news/fake");
    expect(cleaned).toContain("https://support.apple.com/en-us/108044");
  });

  it("normalizes query strings, fragments, trailing slashes, and host casing", () => {
    expect(normalizeInternalLinkUrl("https://Example.com/products/live/?utm=ai#top")).toBe("example.com/products/live");
  });
});
