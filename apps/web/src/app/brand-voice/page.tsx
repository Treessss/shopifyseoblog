import { Save } from "lucide-react";
import { PageHeader, Panel, TextAreaField } from "@/components/ui";
import { brandVoiceProfiles } from "@/lib/admin-data";

export default function BrandVoicePage() {
  return (
    <>
      <PageHeader
        eyebrow="Brand Voice"
        title="品牌语气"
        description="按语言维护受众、语调、禁用词和示例，供内容生成与质量检查复用。"
        action={
          <button className="button button--primary">
            <Save size={16} aria-hidden="true" />
            保存
          </button>
        }
      />

      <div className="grid grid--two">
        {brandVoiceProfiles.map((profile) => (
          <Panel
            key={profile.locale}
            title={`${profile.locale} 品牌语气`}
            description={`${profile.audience} · ${profile.tone}`}
          >
            <div className="form-grid">
              <div className="span-2">
                <TextAreaField label="禁用词" value={profile.bannedWords.join("\n")} hint="每行一个词或短语。" />
              </div>
              <div className="span-2">
                <TextAreaField label="示例规则" value={profile.examples.join("\n")} hint="用于提示词 few-shot 示例。" />
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
