import { AIClientError, createOpenAICompatibleClient } from "@shopify-ai-blog/ai";
import { EncryptedSecretError, EncryptionKeyError, maybeDecryptSecret, prisma } from "@shopify-ai-blog/db";
import { NextResponse } from "next/server";
import { fail, getEnv, ok } from "@/lib/api";
import { findOrganizationForAdmin } from "@/modules/admin/repository/admin-repository";
import { getAdminRequestContext } from "@/modules/admin/routes/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AiTestBody {
  providerId?: string;
  baseUrl?: string;
  apiKey?: string;
  textModel?: string;
  dryRun?: boolean | string;
}

export async function GET() {
  return ok({
    endpoint: "/api/ai/test",
    method: "POST",
    required: [
      "providerId or saved default provider",
      "baseUrl or AI_BASE_URL",
      "apiKey or AI_API_KEY",
      "textModel or AI_TEXT_MODEL"
    ],
    dryRunDefault: false
  });
}

export async function POST(request: Request) {
  const body = await readRequestObject<AiTestBody>(request);

  try {
    const context = getAdminRequestContext(request);
    const organization = await findOrganizationForAdmin(context.organizationSlug);
    if (!organization) {
      return respondFailure(request, 404, "ORGANIZATION_NOT_FOUND", "没有找到可用组织，无法读取 AI 配置。");
    }

    const provider = await resolveProvider(organization.id, optionalString(body.providerId));
    const baseUrl = optionalString(body.baseUrl) ?? provider?.baseUrl ?? getEnv("AI_BASE_URL");
    const apiKey =
      optionalString(body.apiKey) ??
      maybeDecryptSecret(provider?.apiKeyEncrypted) ??
      getEnv("AI_API_KEY");
    const textModel = optionalString(body.textModel) ?? provider?.textModel ?? getEnv("AI_TEXT_MODEL") ?? "gpt-4.1";
    const dryRun = booleanValue(body.dryRun, false);

    if (!provider && !body.baseUrl && !body.apiKey) {
      return respondFailure(request, 400, "AI_PROVIDER_NOT_FOUND", "没有找到已保存的 AI Provider，请先保存 AI 配置。");
    }

    if (provider && !provider.enabled) {
      return respondFailure(request, 409, "AI_PROVIDER_DISABLED", "当前 AI Provider 已停用，请启用后再测试。");
    }

    if (!baseUrl || !apiKey) {
      return respondFailure(request, 400, "AI_CONFIG_INCOMPLETE", "缺少 AI Base URL 或 API Key。");
    }

    try {
      new URL(baseUrl);
    } catch {
      return respondFailure(request, 400, "AI_BASE_URL_INVALID", "AI Base URL 必须是合法 URL。");
    }

    const result = dryRun ? null : await testOpenAICompatibleProvider({ baseUrl, apiKey, textModel });
    const data = {
      providerId: provider?.id ?? null,
      provider: provider?.provider ?? "openai-compatible",
      baseUrl,
      textModel,
      dryRun,
      model: result?.model ?? textModel,
      latencyMs: result?.latencyMs ?? null,
      message: dryRun ? "AI 配置格式校验通过。" : "AI 接口测试成功，模型已返回响应。"
    };

    return respondSuccess(request, data);
  } catch (error) {
    if (error instanceof AIClientError) {
      return respondFailure(
        request,
        error.status ?? 502,
        "AI_CONNECTION_FAILED",
        error.message || "AI 接口连接失败。",
        error.details
      );
    }

    if (error instanceof EncryptedSecretError || error instanceof EncryptionKeyError) {
      return respondFailure(request, 409, "AI_KEY_DECRYPT_FAILED", "AI API Key 解密失败，请重新保存密钥。");
    }

    console.error("[ai-test]", error);
    return respondFailure(request, 500, "AI_TEST_INTERNAL_ERROR", "AI 接口测试失败，请检查服务端日志。");
  }
}

async function resolveProvider(organizationId: string, providerId?: string) {
  if (providerId) {
    return prisma.aiProviderConfig.findFirst({
      where: {
        id: providerId,
        organizationId
      }
    });
  }

  const defaultProvider = await prisma.aiProviderConfig.findFirst({
    where: {
      organizationId,
      enabled: true,
      isDefault: true
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  if (defaultProvider) return defaultProvider;

  return prisma.aiProviderConfig.findFirst({
    where: {
      organizationId,
      enabled: true
    },
    orderBy: [
      { isDefault: "desc" },
      { updatedAt: "desc" }
    ]
  });
}

async function testOpenAICompatibleProvider(input: { baseUrl: string; apiKey: string; textModel: string }) {
  const startedAt = Date.now();
  const client = createOpenAICompatibleClient({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.textModel,
    timeoutMs: 15000
  });
  const result = await client.generateText({
    messages: [
      {
        role: "system",
        content: "You are a connection health check. Reply with OK only."
      },
      {
        role: "user",
        content: "OK"
      }
    ],
    temperature: 0,
    maxTokens: 8
  });

  return {
    model: result.model,
    latencyMs: Date.now() - startedAt
  };
}

async function readRequestObject<T extends object>(request: Request): Promise<Partial<T>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const raw = await request.text();
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw) as Partial<T>;
    } catch {
      return {};
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const output: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") output[key] = value;
    }
    return output as Partial<T>;
  }

  return {};
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanValue(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

function respondSuccess(request: Request, data: Record<string, unknown>) {
  if (shouldRedirectForm(request)) {
    return NextResponse.redirect(
      redirectUrl(request, {
        tested: "1",
        message: String(data.message)
      }),
      { status: 303 }
    );
  }

  return ok(data);
}

function respondFailure(request: Request, status: number, code: string, message: string, details?: unknown) {
  if (shouldRedirectForm(request)) {
    return NextResponse.redirect(
      redirectUrl(request, {
        error: message,
        code
      }),
      { status: 303 }
    );
  }

  return fail(status, { code, message, details });
}

function shouldRedirectForm(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const accept = request.headers.get("accept") ?? "";
  return (
    (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) &&
    !accept.includes("application/json")
  );
}

function redirectUrl(request: Request, params: Record<string, string>) {
  const requestUrl = new URL(request.url);
  const referer = request.headers.get("referer");
  const fallback = new URL("/ai-settings", requestUrl.origin);

  try {
    const target = referer ? new URL(referer) : fallback;
    const safeTarget = target.origin === requestUrl.origin ? target : fallback;
    safeTarget.searchParams.delete("saved");
    safeTarget.searchParams.delete("tested");
    safeTarget.searchParams.delete("message");
    safeTarget.searchParams.delete("error");
    safeTarget.searchParams.delete("code");

    for (const [key, value] of Object.entries(params)) {
      safeTarget.searchParams.set(key, value);
    }

    return safeTarget;
  } catch {
    return fallback;
  }
}
