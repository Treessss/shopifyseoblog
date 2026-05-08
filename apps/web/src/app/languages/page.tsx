import { Languages as LanguagesIcon, Save } from "lucide-react";
import { Badge, ErrorState, Field, PageHeader, Panel, SelectField, TableEmpty } from "@/components/ui";
import { getLanguagesView, getStoresView } from "@/lib/admin-client";

export default async function LanguagesPage() {
  const [languageResult, storeResult] = await Promise.all([getLanguagesView(), getStoresView()]);
  const languages = languageResult.data;
  const stores = storeResult.data;

  return (
    <>
      <PageHeader
        eyebrow="Languages"
        title="语言设置"
        description="简体中文为默认 UI 与内容语言，英文文案和内容生成能力已预留。"
        action={
          <a className="button button--primary" href="#new-language">
            <LanguagesIcon size={16} aria-hidden="true" />
            添加语言
          </a>
        }
      />

      <div className="stack">
        <ErrorState error={languageResult.error} title="语言矩阵读取失败" />
        <ErrorState error={storeResult.error} title="店铺选项读取失败" />

        <Panel title="语言矩阵" description="每个语言可独立设置 fallback、品牌语气、Blog handle 与质量门槛。">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>语言</th>
                  <th>Locale</th>
                  <th>店铺</th>
                  <th>Fallback</th>
                  <th>Blog Handle</th>
                  <th>用途</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {languages.length === 0 ? (
                  <TableEmpty colSpan={7} title="暂无语言配置" description="管理端返回语言矩阵后会显示启用状态、fallback 和 Shopify Blog handle。" />
                ) : (
                  languages.map((language) => (
                    <tr key={language.id}>
                      <td>
                        <strong>{language.label}</strong>
                        {language.isDefault ? <div className="muted">默认语言</div> : null}
                      </td>
                      <td className="code">{language.locale}</td>
                      <td>{language.storeName}</td>
                      <td className="code">{language.fallback}</td>
                      <td className="code">{language.blogHandle}</td>
                      <td>{language.role}</td>
                      <td>
                        <Badge tone={language.enabled ? "good" : "neutral"}>
                          {language.enabled ? "已启用" : "预留"}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="新增或更新语言" description="提交后由管理端 API 保存店铺语言、fallback 和 Shopify Blog handle。">
          <form id="new-language" action="/api/admin/languages" method="post" className="form-grid">
            <SelectField
              label="店铺"
              name="storeId"
              value={stores[0]?.id}
              disabled={stores.length === 0}
              options={
                stores.length > 0
                  ? stores.map((store) => ({ label: `${store.name} · ${store.domain}`, value: store.id }))
                  : [{ label: "请先连接店铺", value: "" }]
              }
            />
            <Field label="Locale" name="locale" placeholder="zh-CN" required />
            <Field label="显示名称" name="label" placeholder="简体中文" required />
            <Field label="Fallback Locale" name="fallback" placeholder="zh-CN" />
            <Field label="Shopify Blog Handle" name="shopifyBlogHandle" placeholder="news" />
            <SelectField
              label="启用状态"
              name="enabled"
              value="true"
              options={[
                { label: "启用", value: "true" },
                { label: "预留", value: "false" }
              ]}
            />
            <SelectField
              label="默认语言"
              name="isDefault"
              value="false"
              options={[
                { label: "普通语言", value: "false" },
                { label: "设为默认", value: "true" }
              ]}
            />
            <div className="span-2 form-actions">
              <button className="button button--primary" type="submit" disabled={stores.length === 0}>
                <Save size={16} aria-hidden="true" />
                保存语言
              </button>
              <span className="muted">保存接口：POST /api/admin/languages</span>
            </div>
          </form>
        </Panel>
      </div>
    </>
  );
}
