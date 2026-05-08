import { fail, getEnv, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AiTestBody {
  baseUrl?: string;
  apiKey?: string;
  textModel?: string;
  dryRun?: boolean;
}

export async function GET() {
  return ok({
    endpoint: "/api/ai/test",
    method: "POST",
    required: ["baseUrl or AI_BASE_URL", "apiKey or AI_API_KEY", "textModel or AI_TEXT_MODEL"],
    dryRunDefault: true
  });
}

export async function POST(request: Request) {
  const body = (await readJson<AiTestBody>(request)) ?? {};
  const baseUrl = body.baseUrl ?? getEnv("AI_BASE_URL");
  const apiKey = body.apiKey ?? getEnv("AI_API_KEY");
  const textModel = body.textModel ?? getEnv("AI_TEXT_MODEL") ?? "gpt-4.1";
  const dryRun = body.dryRun ?? true;

  if (!baseUrl || !apiKey) {
    return fail(400, {
      code: "AI_CONFIG_INCOMPLETE",
      message: "缺少 AI Base URL 或 API Key。"
    });
  }

  try {
    new URL(baseUrl);
  } catch {
    return fail(400, {
      code: "AI_BASE_URL_INVALID",
      message: "AI Base URL 必须是合法 URL。"
    });
  }

  return ok({
    provider: "openai-compatible",
    baseUrl,
    textModel,
    dryRun,
    message: dryRun ? "配置格式有效；真实模型探测将在 AI provider 接入后启用。" : "连接测试请求已接收。"
  });
}
