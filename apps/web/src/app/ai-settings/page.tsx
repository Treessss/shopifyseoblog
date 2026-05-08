import { Bot, FlaskConical } from "lucide-react";
import { Field, PageHeader, Panel } from "@/components/ui";

export default function AiSettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="AI Settings"
        title="AI 设置"
        description="配置 OpenAI-compatible Provider。店铺级配置可覆盖全局默认值。"
        action={
          <button className="button button--primary">
            <FlaskConical size={16} aria-hidden="true" />
            测试连接
          </button>
        }
      />

      <Panel title="默认 Provider" description="用于生成、改写、配图和质量评分的默认模型配置。">
        <div className="form-grid">
          <Field label="Base URL" value="https://api.openai.com/v1" hint="支持 OpenAI-compatible API。" />
          <Field label="文本模型" value="gpt-4.1" />
          <Field label="图像模型" value="gpt-image-1" />
          <Field label="Temperature" value="0.8" type="number" />
          <div className="span-2">
            <Field label="API Key" value="sk-••••••••••••••••" hint="不会在客户端回显真实密钥。" />
          </div>
        </div>
      </Panel>

      <div className="grid grid--three" style={{ marginTop: 16 }}>
        {[
          ["生成策略", "文章生成默认进入质量门槛，达标后按店铺发布策略执行。"],
          ["安全边界", "Webhook、OAuth 与 AI 调用均走服务端 API route，避免密钥暴露。"],
          ["英文预留", "英文 UI 字典已预留，可通过 locale 切换接入。"]
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
    </>
  );
}
