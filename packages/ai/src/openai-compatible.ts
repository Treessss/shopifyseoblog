export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface OpenAICompatibleClientConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  defaultHeaders?: Record<string, string>;
  fetch?: FetchLike;
  organization?: string;
  project?: string;
  timeoutMs?: number;
}

export interface GenerateTextOptions {
  prompt?: string;
  system?: string;
  messages?: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  responseFormat?: { type: "text" | "json_object" } | Record<string, unknown>;
  stop?: string | string[];
  stream?: boolean;
  signal?: AbortSignal;
  extraBody?: Record<string, unknown>;
}

export interface AIUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface GenerateTextResult {
  id?: string;
  model?: string;
  content: string;
  finishReason?: string;
  usage?: AIUsage;
  raw: unknown;
}

export interface GenerateImageOptions {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  n?: number;
  responseFormat?: "url" | "b64_json";
  referenceImageUrls?: string[];
  extraBody?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface GenerateImageResult {
  url?: string;
  b64Json?: string;
  revisedPrompt?: string;
  model?: string;
  raw: unknown;
}

export class AIClientError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
    readonly status?: number
  ) {
    super(message);
    this.name = "AIClientError";
  }
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TRANSIENT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 450;

export class OpenAICompatibleClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;

  private readonly defaultHeaders: Record<string, string>;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs?: number;

  constructor(config: OpenAICompatibleClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    this.apiKey = config.apiKey ?? readEnv("OPENAI_API_KEY") ?? "";
    this.model = config.model ?? readEnv("OPENAI_MODEL") ?? "";
    this.defaultHeaders = {
      ...config.defaultHeaders
    };

    if (config.organization) {
      this.defaultHeaders["OpenAI-Organization"] = config.organization;
    }

    if (config.project) {
      this.defaultHeaders["OpenAI-Project"] = config.project;
    }

    this.fetchImpl = config.fetch ?? getGlobalFetch();
    this.timeoutMs = config.timeoutMs;
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const model = options.model ?? this.model;
    if (!model) {
      throw new AIClientError("OpenAI-compatible model is required.");
    }

    if (!this.apiKey) {
      throw new AIClientError("OpenAI-compatible apiKey is required.");
    }

    const messages = buildMessages(options);
    const body = removeUndefined({
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: options.topP,
      response_format: options.responseFormat,
      stop: options.stop,
      stream: options.stream === true,
      ...options.extraBody
    });

    if (options.stream === true) {
      return this.postStreamingChatCompletion("chat/completions", body, options.signal, "OpenAI-compatible request");
    }

    const payload = await this.postJson("chat/completions", body, options.signal, "OpenAI-compatible request");

    return parseChatCompletion(payload);
  }

  async generateJson<T>(options: GenerateTextOptions): Promise<T> {
    const result = await this.generateText({
      ...options,
      responseFormat: options.responseFormat ?? { type: "json_object" }
    });

    try {
      return JSON.parse(stripJsonFence(result.content)) as T;
    } catch (error) {
      throw new AIClientError("OpenAI-compatible response was not valid JSON.", { error, content: result.content });
    }
  }

  async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    const model = options.model ?? this.model;
    if (!model) {
      throw new AIClientError("OpenAI-compatible image model is required.");
    }

    if (!this.apiKey) {
      throw new AIClientError("OpenAI-compatible apiKey is required.");
    }

    const body = removeUndefined({
      model,
      prompt: options.prompt,
      size: options.size,
      quality: options.quality,
      n: options.n ?? 1,
      response_format: options.responseFormat,
      reference_image_urls: options.referenceImageUrls?.length ? options.referenceImageUrls : undefined,
      ...options.extraBody
    });

    const payload = await this.postJson("images/generations", body, options.signal, "OpenAI-compatible image request");

    return parseImageGeneration(payload, model);
  }

  private async postJson(
    path: string,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
    errorLabel: string
  ): Promise<unknown> {
    const bodyJson = JSON.stringify(body);
    const controller = createAbortController(signal, this.timeoutMs);
    const operationSignal = controller?.signal ?? signal;

    try {
      for (let attempt = 0; attempt <= DEFAULT_TRANSIENT_RETRIES; attempt += 1) {
        throwIfAborted(operationSignal);

        try {
          const response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
              ...this.defaultHeaders
            },
            body: bodyJson,
            signal: operationSignal
          });

          const payload = await readJson(response);
          if (!response.ok) {
            throw new AIClientError(`${errorLabel} failed with HTTP ${response.status}.`, payload, response.status);
          }

          return payload;
        } catch (error) {
          if (operationSignal?.aborted && controller?.timedOut()) {
            throw new AIClientError(`${errorLabel} timed out after ${controller.timeoutMs}ms.`, {
              code: "AI_REQUEST_TIMEOUT",
              timeoutMs: controller.timeoutMs
            }, 408);
          }

          if (operationSignal?.aborted || attempt >= DEFAULT_TRANSIENT_RETRIES || !isRetryableAiError(error)) {
            throw error;
          }

          await sleep(retryDelay(attempt), operationSignal);
        }
      }
    } finally {
      controller?.clear();
    }

    throw new AIClientError(`${errorLabel} failed.`);
  }

  private async postStreamingChatCompletion(
    path: string,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
    errorLabel: string
  ): Promise<GenerateTextResult> {
    const bodyJson = JSON.stringify(body);
    const controller = createAbortController(signal, this.timeoutMs);
    const operationSignal = controller?.signal ?? signal;

    try {
      for (let attempt = 0; attempt <= DEFAULT_TRANSIENT_RETRIES; attempt += 1) {
        throwIfAborted(operationSignal);

        try {
          const response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
              ...this.defaultHeaders
            },
            body: bodyJson,
            signal: operationSignal
          });

          if (!response.ok) {
            const payload = await readJson(response);
            throw new AIClientError(`${errorLabel} failed with HTTP ${response.status}.`, payload, response.status);
          }

          if (!response.body) {
            throw new AIClientError(`${errorLabel} streaming response did not include a body.`, undefined, response.status);
          }

          return await readChatCompletionStream(response.body, {
            signal: operationSignal,
            resetTimeout: () => controller?.resetTimeout(),
            errorLabel
          });
        } catch (error) {
          if (operationSignal?.aborted && controller?.timedOut()) {
            throw new AIClientError(`${errorLabel} timed out after ${controller.timeoutMs}ms.`, {
              code: "AI_REQUEST_TIMEOUT",
              timeoutMs: controller.timeoutMs,
              stream: true
            }, 408);
          }

          if (operationSignal?.aborted || attempt >= DEFAULT_TRANSIENT_RETRIES || !isRetryableAiError(error)) {
            throw error;
          }

          await sleep(retryDelay(attempt), operationSignal);
        }
      }
    } finally {
      controller?.clear();
    }

    throw new AIClientError(`${errorLabel} failed.`);
  }
}

export function createOpenAICompatibleClient(config: OpenAICompatibleClientConfig): OpenAICompatibleClient {
  return new OpenAICompatibleClient(config);
}

function buildMessages(options: GenerateTextOptions): ChatMessage[] {
  if (options.messages?.length) {
    return options.messages;
  }

  if (!options.prompt) {
    throw new AIClientError("Either messages or prompt is required.");
  }

  const messages: ChatMessage[] = [];
  if (options.system) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push({ role: "user", content: options.prompt });
  return messages;
}

function parseChatCompletion(payload: unknown): GenerateTextResult {
  if (!isRecord(payload)) {
    throw new AIClientError("OpenAI-compatible response was not an object.", payload);
  }

  const error = payload.error;
  if (error) {
    const message = isRecord(error) && typeof error.message === "string" ? error.message : "OpenAI-compatible response returned an error.";
    throw new AIClientError(message, payload);
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) {
    throw new AIClientError("OpenAI-compatible response did not include choices.", payload);
  }

  const message = isRecord(firstChoice.message) ? firstChoice.message : undefined;
  const content = typeof message?.content === "string" ? message.content : "";
  const usage = isRecord(payload.usage)
    ? {
        promptTokens: asNumber(payload.usage.prompt_tokens),
        completionTokens: asNumber(payload.usage.completion_tokens),
        totalTokens: asNumber(payload.usage.total_tokens)
      }
    : undefined;

  return {
    id: typeof payload.id === "string" ? payload.id : undefined,
    model: typeof payload.model === "string" ? payload.model : undefined,
    content,
    finishReason: typeof firstChoice.finish_reason === "string" ? firstChoice.finish_reason : undefined,
    usage,
    raw: payload
  };
}

async function readChatCompletionStream(
  body: ReadableStream<Uint8Array>,
  options: {
    signal?: AbortSignal;
    resetTimeout: () => void;
    errorLabel: string;
  }
): Promise<GenerateTextResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const rawChunks: unknown[] = [];
  let buffer = "";
  let content = "";
  let id: string | undefined;
  let model: string | undefined;
  let finishReason: string | undefined;
  let usage: AIUsage | undefined;

  try {
    while (true) {
      throwIfAborted(options.signal);
      const { value, done } = await reader.read();
      if (done) break;
      options.resetTimeout();
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        const data = eventData(event);
        if (!data) continue;
        if (data === "[DONE]") {
          return {
            id,
            model,
            content,
            finishReason,
            usage,
            raw: { stream: true, chunks: rawChunks }
          };
        }

        const chunk = parseStreamChunk(data, options.errorLabel);
        rawChunks.push(chunk);
        if (!isRecord(chunk)) continue;
        id = typeof chunk.id === "string" ? chunk.id : id;
        model = typeof chunk.model === "string" ? chunk.model : model;
        usage = parseUsage(chunk.usage) ?? usage;

        const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
        for (const choice of choices) {
          if (!isRecord(choice)) continue;
          finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : finishReason;
          const delta = isRecord(choice.delta) ? choice.delta : undefined;
          const message = isRecord(choice.message) ? choice.message : undefined;
          const deltaContent = typeof delta?.content === "string" ? delta.content : "";
          const messageContent = typeof message?.content === "string" ? message.content : "";
          content += deltaContent || messageContent;
        }
      }
    }

    const tail = decoder.decode();
    if (tail) buffer += tail;
    const data = eventData(buffer);
    if (data && data !== "[DONE]") {
      const chunk = parseStreamChunk(data, options.errorLabel);
      rawChunks.push(chunk);
      if (isRecord(chunk)) {
        id = typeof chunk.id === "string" ? chunk.id : id;
        model = typeof chunk.model === "string" ? chunk.model : model;
        usage = parseUsage(chunk.usage) ?? usage;
      }
    }

    return {
      id,
      model,
      content,
      finishReason,
      usage,
      raw: { stream: true, chunks: rawChunks }
    };
  } finally {
    reader.releaseLock();
  }
}

function eventData(event: string): string {
  return event
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("data:"))
    .map((line) => line.replace(/^data:\s?/, ""))
    .join("\n")
    .trim();
}

function parseStreamChunk(data: string, errorLabel: string): unknown {
  try {
    const payload = JSON.parse(data) as unknown;
    if (isRecord(payload) && payload.error) {
      const message = isRecord(payload.error) && typeof payload.error.message === "string" ? payload.error.message : `${errorLabel} streaming response returned an error.`;
      throw new AIClientError(message, payload);
    }
    return payload;
  } catch (error) {
    if (error instanceof AIClientError) throw error;
    throw new AIClientError(`${errorLabel} streaming response was not valid JSON.`, { error, data });
  }
}

function parseImageGeneration(payload: unknown, model: string): GenerateImageResult {
  if (!isRecord(payload)) {
    throw new AIClientError("OpenAI-compatible image response was not an object.", payload);
  }

  const error = payload.error;
  if (error) {
    const message = isRecord(error) && typeof error.message === "string" ? error.message : "OpenAI-compatible image response returned an error.";
    throw new AIClientError(message, payload);
  }

  const data = Array.isArray(payload.data) ? payload.data : [];
  const first = data.find(isRecord);
  if (!first) {
    throw new AIClientError("OpenAI-compatible image response did not include data.", payload);
  }

  return {
    url: typeof first.url === "string" ? first.url : undefined,
    b64Json: typeof first.b64_json === "string" ? first.b64_json : undefined,
    revisedPrompt: typeof first.revised_prompt === "string" ? first.revised_prompt : undefined,
    model: typeof payload.model === "string" ? payload.model : model,
    raw: payload
  };
}

type TimedAbortController = AbortController & {
  clear: () => void;
  resetTimeout: () => void;
  timedOut: () => boolean;
  timeoutMs?: number;
};

function createAbortController(parentSignal?: AbortSignal, timeoutMs?: number): TimedAbortController | undefined {
  if (!timeoutMs && !parentSignal) return undefined;

  const controller = new AbortController() as TimedAbortController;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  controller.timeoutMs = timeoutMs;
  const scheduleTimeout = () => {
    if (timeout) clearTimeout(timeout);
    timeout = timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
      : undefined;
  };
  scheduleTimeout();
  const abort = () => controller.abort();
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener("abort", abort, { once: true });
  }
  controller.clear = () => {
    if (timeout) clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abort);
  };
  controller.resetTimeout = () => {
    timedOut = false;
    scheduleTimeout();
  };
  controller.timedOut = () => timedOut;
  return controller;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function getGlobalFetch(): FetchLike {
  if (typeof fetch !== "function") {
    throw new AIClientError("No fetch implementation is available.");
  }
  return fetch.bind(globalThis) as FetchLike;
}

function readEnv(key: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl}/${path.replace(/^\/+/, "")}`;
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function parseUsage(value: unknown): AIUsage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    promptTokens: asNumber(value.prompt_tokens),
    completionTokens: asNumber(value.completion_tokens),
    totalTokens: asNumber(value.total_tokens)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRetryableAiError(error: unknown): boolean {
  if (error instanceof AIClientError) {
    return error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || (error.status ?? 0) >= 500;
  }

  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  if (/fetch failed|network|socket|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_SOCKET/i.test(error.message)) return true;

  const cause = (error as Error & { cause?: unknown }).cause;
  if (isRecord(cause)) {
    const code = typeof cause.code === "string" ? cause.code : "";
    return ["UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED"].includes(code);
  }

  return false;
}

function retryDelay(attempt: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** attempt;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
