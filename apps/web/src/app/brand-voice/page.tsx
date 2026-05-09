import { Ban, FileText, Globe2, MessageSquareText, Save } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  Field,
  FormNotice,
  PageHeader,
  Panel,
  SelectField,
  StatusPill,
  TextAreaField
} from "@/components/ui";
import { getBrandVoiceView, getLanguagesView, getStoresView } from "@/lib/admin-client";
import { readFormNotice, type SearchParamRecord } from "@/lib/search-params";

type PageProps = {
  searchParams?: Promise<SearchParamRecord>;
};

export default async function BrandVoicePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [brandVoiceResult, storeResult, languageResult] = await Promise.all([
    getBrandVoiceView(),
    getStoresView(),
    getLanguagesView()
  ]);
  const profiles = brandVoiceResult.data;
  const stores = storeResult.data;
  const languages = languageResult.data.filter((language) => language.enabled);
  const notice = readFormNotice(params);

  return (
    <>
      <PageHeader
        eyebrow="Brand Voice"
        title="品牌语气"
        description="按语言维护受众、语调、禁用词和示例，供内容生成与质量检查复用。"
        action={
          <a className="button button--primary" href="#new-brand-voice">
            <MessageSquareText size={16} aria-hidden="true" />
            新增语气
          </a>
        }
      />

      <div className="stack">
        <ErrorState error={brandVoiceResult.error} title="品牌语气读取失败" />
        <ErrorState error={storeResult.error} title="店铺选项读取失败" />
        <ErrorState error={languageResult.error} title="语言选项读取失败" />
        {notice ? <FormNotice {...notice} /> : null}

        <div className="insight-strip">
          <StatusPill
            label="语气档案"
            value={profiles.length}
            tone={profiles.length > 0 ? "good" : "warn"}
            icon={<MessageSquareText size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="语言覆盖"
            value={new Set(profiles.map((profile) => profile.locale)).size || "zh-CN"}
            tone="neutral"
            icon={<Globe2 size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="禁用词"
            value={profiles.reduce((sum, profile) => sum + profile.bannedWords.length, 0)}
            tone="warn"
            icon={<Ban size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="示例规则"
            value={profiles.reduce((sum, profile) => sum + profile.examples.length, 0)}
            tone="neutral"
            icon={<FileText size={18} aria-hidden="true" />}
          />
        </div>

        {profiles.length === 0 ? (
          <Panel>
            <EmptyState
              title="暂无品牌语气"
              description="管理端返回 Brand Voice 后会按店铺与语言展示受众、语调、禁用词和示例。"
            />
          </Panel>
        ) : (
          <div className="grid grid--two">
            {profiles.map((profile) => (
              <Panel
                key={profile.id}
                title={`${profile.name} · ${profile.locale}`}
                description={`${profile.storeName} · ${profile.audience} · ${profile.tone}`}
              >
                <form action="/api/admin/brand-voice" method="post" className="form-grid">
                  <input type="hidden" name="id" value={profile.id} />
                  <input type="hidden" name="storeId" value={profile.storeId} />
                  <input type="hidden" name="isDefault" value={String(profile.isDefault)} />
                  <Field label="名称" name="name" value={profile.name} required />
                  <Field label="Locale" name="locale" value={profile.locale} required />
                  <div className="span-2">
                    <TextAreaField label="受众" name="audience" value={profile.audience} rows={3} />
                  </div>
                  <div className="span-2">
                    <TextAreaField label="语调" name="tone" value={profile.tone} rows={3} />
                  </div>
                  <div className="span-2">
                    <TextAreaField label="禁用词" name="bannedWords" value={profile.bannedWords} hint="每行一个词或短语。" />
                  </div>
                  <div className="span-2">
                    <TextAreaField label="示例规则" name="examples" value={profile.examples} hint="用于提示词 few-shot 示例。" />
                  </div>
                  <div className="span-2 form-actions">
                    <button className="button button--primary" type="submit">
                      <Save size={16} aria-hidden="true" />
                      保存
                    </button>
                  </div>
                </form>
              </Panel>
            ))}
          </div>
        )}

        <Panel title="新增品牌语气" description="提交后由管理端 API 创建或更新指定店铺与语言下的品牌语气。">
          <form id="new-brand-voice" action="/api/admin/brand-voice" method="post" className="form-grid">
            <Field label="名称" name="name" placeholder="默认品牌语气" required />
            <SelectField
              label="店铺"
              name="storeId"
              value={stores[0]?.id ?? ""}
              options={[
                { label: "全局", value: "" },
                ...stores.map((store) => ({ label: `${store.name} · ${store.domain}`, value: store.id }))
              ]}
            />
            <SelectField
              label="语言"
              name="locale"
              value={languages[0]?.locale ?? "zh-CN"}
              options={
                languages.length > 0
                  ? languages.map((language) => ({ label: `${language.label} · ${language.locale}`, value: language.locale }))
                  : [{ label: "zh-CN", value: "zh-CN" }]
              }
            />
            <SelectField
              label="默认语气"
              name="isDefault"
              value="false"
              options={[
                { label: "普通语气", value: "false" },
                { label: "设为默认", value: "true" }
              ]}
            />
            <div className="span-2">
              <TextAreaField label="目标受众" name="audience" placeholder="25-40 岁城市家庭用户" rows={3} />
            </div>
            <div className="span-2">
              <TextAreaField label="语调" name="tone" placeholder="专业、克制、有生活感" rows={3} />
            </div>
            <div className="span-2">
              <TextAreaField label="禁用词" name="bannedWords" placeholder={"最顶级\n永久有效\n零风险"} />
            </div>
            <div className="span-2">
              <TextAreaField label="示例规则" name="examples" placeholder={"用具体场景解释产品价值\n避免夸张承诺"} />
            </div>
            <div className="span-2 form-actions">
              <button className="button button--primary" type="submit">
                <Save size={16} aria-hidden="true" />
                创建语气
              </button>
              <span className="muted">保存接口：POST /api/admin/brand-voice</span>
            </div>
          </form>
        </Panel>
      </div>
    </>
  );
}
