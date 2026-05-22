import { describe, expect, it } from "vitest";
import { AIClientError, createOpenAICompatibleClient, type FetchLike } from "../packages/ai/src";

describe("OpenAI-compatible client", () => {
  it("can stream chat completion chunks and assemble the final text", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            [
              'data: {"id":"chatcmpl_stream","model":"stream-model","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
              "",
              'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}',
              "",
              'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
              "",
              "data: [DONE]",
              "",
              ""
            ].join("\n")
          )
        );
        controller.close();
      }
    });
    const fetchMock: FetchLike = async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" }
      });
    };

    const client = createOpenAICompatibleClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "stream-model",
      fetch: fetchMock
    });

    const result = await client.generateText({
      prompt: "Say hello.",
      stream: true
    });

    expect(requestBody?.stream).toBe(true);
    expect(result).toMatchObject({
      id: "chatcmpl_stream",
      model: "stream-model",
      content: "Hello world",
      finishReason: "stop",
      usage: {
        promptTokens: 3,
        completionTokens: 2,
        totalTokens: 5
      }
    });
  });

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
