import Link from "next/link";
import { Bot, FlaskConical, Image, KeyRound, Save, ShieldCheck } from "lucide-react";
import {
  Badge,
  EmptyState,
  ErrorState,
  Field,
  FormNotice,
  PageHeader,
  Panel,
  SelectField,
  StatusPill,
  TableEmpty
} from "@/components/ui";
import { getAiSettingsView } from "@/lib/admin-client";
import { readFormNotice, type SearchParamRecord } from "@/lib/search-params";

type PageProps = {
  searchParams?: Promise<SearchParamRecord>;
};

export default async function AiSettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { data: providers, error } = await getAiSettingsView();
  const defaultProvider = providers.find((provider) => provider.isDefault) ?? providers[0];
  const notice = readFormNotice(params);

  return (
    <>
      <PageHeader
        eyebrow="AI Settings"
        title="AI 设置"
        description="配置 OpenAI-compatible Provider。店铺级配置可覆盖全局默认值，密钥只提交到服务端。"
        action={
          <Link href="/api/ai/test" className="button">
            <FlaskConical size={16} aria-hidden="true" />
            接口说明
          </Link>
        }
      />

      <div className="stack">
        <ErrorState error={error} title="AI 配置读取失败" />
        {notice ? <FormNotice {...notice} /> : null}

        <div className="insight-strip">
          <StatusPill
            label="可用 Provider"
            value={providers.filter((provider) => provider.enabled).length}
            tone={providers.some((provider) => provider.enabled) ? "good" : "warn"}
            icon={<Bot size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="默认模型"
            value={defaultProvider?.textModel || "待配置"}
            tone={defaultProvider?.textModel ? "good" : "warn"}
            icon={<ShieldCheck size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="图像模型"
            value={defaultProvider?.imageModel || "待配置"}
            tone={defaultProvider?.imageModel ? "good" : "warn"}
            icon={<Image size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="密钥状态"
            value={defaultProvider?.hasApiKey ? "已加密" : "未设置"}
            tone={defaultProvider?.hasApiKey ? "good" : "danger"}
            icon={<KeyRound size={18} aria-hidden="true" />}
          />
        </div>

        <Panel title="默认 Provider" description="用于生成、改写、配图和质量评分的默认模型配置。">
          {defaultProvider ? (
            <form action="/api/admin/ai-settings" method="post" className="form-grid">
              <input type="hidden" name="id" value={defaultProvider.id} />
              <Field label="名称" name="name" value={defaultProvider.name} required />
              <SelectField
                label="Provider"
                name="provider"
                value={defaultProvider.provider}
                options={[
                  { label: "OpenAI", value: "openai" },
                  { label: "OpenAI-compatible", value: "compatible" },
                  { label: "Custom", value: "custom" }
                ]}
              />
              <Field label="Base URL" name="baseUrl" value={defaultProvider.baseUrl} placeholder="https://api.openai.com/v1" required />
              <Field label="文本模型" name="textModel" value={defaultProvider.textModel} placeholder="gpt-4.1" required />
              <Field label="图像模型" name="imageModel" value={defaultProvider.imageModel} placeholder="gpt-image-1" />
              <Field
                label="Temperature"
                name="temperature"
                value={defaultProvider.temperature}
                type="number"
                min={0}
                max={2}
                step={0.1}
              />
              <SelectField
                label="启用状态"
                name="enabled"
                value={String(defaultProvider.enabled)}
                options={[
                  { label: "启用", value: "true" },
                  { label: "停用", value: "false" }
                ]}
              />
              <SelectField
                label="默认配置"
                name="isDefault"
                value={String(defaultProvider.isDefault)}
                options={[
                  { label: "设为默认", value: "true" },
                  { label: "普通配置", value: "false" }
                ]}
              />
              <div className="span-2">
                <Field
                  label="API Key"
                  name="apiKey"
                  type="password"
                  placeholder={defaultProvider.apiKeyMasked}
                  autoComplete="new-password"
                  hint="留空表示不更新密钥；服务端不应向客户端回显真实密钥。"
                />
              </div>
              <div className="span-2 form-actions">
                <button className="button button--primary" type="submit">
                  <Save size={16} aria-hidden="true" />
                  保存配置
                </button>
                <span className="muted">保存接口：POST /api/admin/ai-settings</span>
              </div>
            </form>
          ) : (
            <EmptyState
              title="暂无 AI Provider"
              description="管理端接口未返回配置。填写默认 Provider 后即可让生成、质检和配图流程读取真实配置。"
              action={
                <form action="/api/admin/ai-settings" method="post" className="inline-form">
                  <input name="name" placeholder="默认 Provider" required />
                  <input name="baseUrl" placeholder="https://api.openai.com/v1" required />
                  <input type="hidden" name="provider" value="compatible" />
                  <input type="hidden" name="textModel" value="gpt-4.1" />
                  <input type="hidden" name="temperature" value="0.8" />
                  <input type="hidden" name="enabled" value="true" />
                  <input type="hidden" name="isDefault" value="true" />
                  <button className="button button--primary" type="submit">
                    <Save size={16} aria-hidden="true" />
                    创建
                  </button>
                </form>
              }
            />
          )}
        </Panel>

        <Panel title="Provider 列表" description="查看全局与店铺级模型配置，密钥字段只展示脱敏状态。">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>范围</th>
                  <th>Provider</th>
                  <th>文本模型</th>
                  <th>图像模型</th>
                  <th>状态</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {providers.length === 0 ? (
                  <TableEmpty colSpan={7} title="暂无 Provider 记录" description="创建配置后会在这里显示模型、范围和启用状态。" />
                ) : (
                  providers.map((provider) => (
                    <tr key={provider.id}>
                      <td>
                        <strong>{provider.name}</strong>
                        <div className="muted">{provider.apiKeyMasked || "未设置密钥"}</div>
                      </td>
                      <td>{provider.storeName || "全局"}</td>
                      <td>{provider.provider}</td>
                      <td className="code">{provider.textModel || "-"}</td>
                      <td className="code">{provider.imageModel || "-"}</td>
                      <td>
                        <Badge tone={provider.enabled ? "good" : "neutral"}>
                          {provider.enabled ? "已启用" : "已停用"}
                        </Badge>
                      </td>
                      <td>{provider.updatedAt || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid grid--three">
          {[
            ["生成策略", "文章生成默认进入质量门槛，达标后按店铺发布策略执行。"],
            ["安全边界", "OAuth、Webhook 与 AI 调用均走服务端 API route，避免密钥暴露。"],
            ["多语言预留", "语言矩阵会影响模型提示词、品牌语气和内容质量门槛。"]
          ].map(([title, text]) => (
            <Panel compact key={title}>
              <div className="list-item">
                <Bot size={18} aria-hidden="true" />
                <div>
                  <strong>{title}</strong>
                  <small className="muted">{text}</small>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      </div>
    </>
  );
}
