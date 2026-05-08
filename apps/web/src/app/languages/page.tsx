import { Languages as LanguagesIcon } from "lucide-react";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { languages } from "@/lib/admin-data";

export default function LanguagesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Languages"
        title="语言设置"
        description="简体中文为默认 UI 与内容语言，英文文案和内容生成能力已预留。"
        action={
          <button className="button button--primary">
            <LanguagesIcon size={16} aria-hidden="true" />
            添加语言
          </button>
        }
      />

      <Panel title="语言矩阵" description="每个语言可独立设置 fallback、品牌语气与质量门槛。">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>语言</th>
                <th>Locale</th>
                <th>Fallback</th>
                <th>用途</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {languages.map((language) => (
                <tr key={language.locale}>
                  <td>
                    <strong>{language.label}</strong>
                  </td>
                  <td className="code">{language.locale}</td>
                  <td className="code">{language.fallback}</td>
                  <td>{language.role}</td>
                  <td>
                    <Badge tone={language.enabled ? "good" : "neutral"}>{language.enabled ? "已启用" : "预留"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
