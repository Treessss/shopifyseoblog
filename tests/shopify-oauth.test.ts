import { describe, expect, it, vi } from "vitest";
import { exchangeShopifyClientCredentials, ShopifyError } from "../packages/shopify/src";

describe("shopify oauth", () => {
  it("exchanges client credentials using Shopify form encoding", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
      expect(init?.body).toBe("grant_type=client_credentials&client_id=client_123&client_secret=secret_456");

      return new Response(
        JSON.stringify({
          access_token: "shpat_demo",
          scope: "read_products,write_content",
          expires_in: 86399
        }),
        { status: 200 }
      );
    });

    const token = await exchangeShopifyClientCredentials({
      shop: "demo.myshopify.com",
      clientId: "client_123",
      clientSecret: "secret_456",
      fetch: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledWith("https://demo.myshopify.com/admin/oauth/access_token", expect.any(Object));
    expect(token.access_token).toBe("shpat_demo");
    expect(token.expires_in).toBe(86399);
  });

  it("maps failed client credentials exchange to a ShopifyError", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }));

    await expect(
      exchangeShopifyClientCredentials({
        shop: "demo",
        clientId: "bad",
        clientSecret: "bad",
        fetch: fetchMock
      })
    ).rejects.toBeInstanceOf(ShopifyError);
  });
});
