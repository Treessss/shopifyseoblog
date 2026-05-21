import { describe, expect, it } from "vitest";
import { AIClientError, createOpenAICompatibleClient, type FetchLike } from "../packages/ai/src";

describe("OpenAI-compatible client", () => {
  it("returns a clear timeout error when the configured request timeout aborts fetch", async () => {
    const fetchMock: FetchLike = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("This operation was aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true }
        );
      });

    const client = createOpenAICompatibleClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "slow-model",
      timeoutMs: 5,
      fetch: fetchMock
    });

    await expect(
      client.generateText({
        prompt: "Write a long article."
      })
    ).rejects.toMatchObject({
      name: "AIClientError",
      message: "OpenAI-compatible request timed out after 5ms.",
      status: 408,
      details: {
        code: "AI_REQUEST_TIMEOUT",
        timeoutMs: 5
      }
    } satisfies Partial<AIClientError>);
  });
});
