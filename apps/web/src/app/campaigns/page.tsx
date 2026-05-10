import { Clock3, Languages, ListFilter, Megaphone, Plus, Search, ShieldCheck } from "lucide-react";
import {
  Badge,
  ErrorState,
  Field,
  FormNotice,
  PageHeader,
  Panel,
  ProgressBar,
  SelectField,
  StatusPill,
  TableEmpty
} from "@/components/ui";
import {
  formatCampaignStatus,
  getCampaignsView,
  getLanguagesView,
  getStoresView
} from "@/lib/admin-client";
import { readFormNotice, readSearchParam } from "@/lib/search-params";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CampaignsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = readSearchParam(params, "q").trim().toLowerCase();
  const status = readSearchParam(params, "status");
  const [campaignResult, storeResult, languageResult] = await Promise.all([
    getCampaignsView(),
    getStoresView(),
    getLanguagesView()
  ]);
  const campaigns = campaignResult.data;
  const stores = storeResult.data;
  const languages = languageResult.data.filter((language) => language.enabled);
  const notice = readFormNotice(params);
  const filteredCampaigns = campaigns.filter((campaign) => {
    const matchesQuery =
      !query || `${campaign.name} ${campaign.store} ${campaign.source} ${campaign.primaryKeyword ?? ""}`.toLowerCase().includes(query);
    const matchesStatus = !status || campaign.status === status;
    return matchesQuery && matchesStatus;
  });

  return (
    <>
      <PageHeader
        eyebrow="Campaigns"
        title="内容任务"
        description="把商品、集合或手动主题组织为多语言 Blog 生产任务，并绑定发布策略。"
        action={
          <a className="button button--primary" href="#new-campaign">
            <Plus size={16} aria-hidden="true" />
            新建任务
          </a>
        }
      />

      <div className="stack">
        <ErrorState error={campaignResult.error} title="任务数据读取失败" />
        <ErrorState error={storeResult.error} title="店铺选项读取失败" />
        <ErrorState error={languageResult.error} title="语言选项读取失败" />
        {notice ? <FormNotice {...notice} /> : null}

        <div className="insight-strip">
          <StatusPill
            label="运行中"
            value={campaigns.filter((campaign) => campaign.status === "active").length}
            tone="warn"
            icon={<Megaphone size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="自动发布策略"
            value={campaigns.filter((campaign) => campaign.publishPolicy === "达标自动发布").length}
            tone="good"
            icon={<ShieldCheck size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="平均进度"
            value={`${campaigns.length ? Math.round(campaigns.reduce((sum, campaign) => sum + campaign.progress, 0) / campaigns.length) : 0}%`}
            tone="neutral"
            icon={<Clock3 size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="语言队列"
            value={languages.length || "zh-CN"}
            tone={languages.length > 0 ? "good" : "warn"}
            icon={<Languages size={18} aria-hidden="true" />}
          />
        </div>

        <Panel title="任务队列" description="任务状态将驱动 worker 生成、质检、配图和发布。">
          <form className="filter-bar" action="/campaigns">
            <label className="filter-field">
              <Search size={15} aria-hidden="true" />
              <input name="q" defaultValue={readSearchParam(params, "q")} placeholder="搜索任务、店铺、关键词" />
            </label>
            <label className="filter-select">
              <span>状态</span>
              <select name="status" defaultValue={status}>
                <option value="">全部</option>
                {[...new Set(campaigns.map((campaign) => campaign.status))].map((item) => (
                  <option key={item} value={item}>
                    {formatCampaignStatus(item)}
                  </option>
                ))}
              </select>
            </label>
            <button className="button" type="submit">
              <ListFilter size={16} aria-hidden="true" />
              筛选
            </button>
            <span className="filter-bar__summary">当前 {filteredCampaigns.length} 个任务</span>
          </form>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>店铺</th>
                  <th>来源</th>
                  <th>语言</th>
                  <th>进度</th>
                  <th>发布策略</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {filteredCampaigns.length === 0 ? (
                  <TableEmpty
                    colSpan={7}
                    title={campaigns.length === 0 ? "暂无内容任务" : "没有匹配的任务"}
                    description={
                      campaigns.length === 0
                        ? "新建任务后，worker 生成进度和发布策略会显示在这里。"
                        : "调整搜索关键词或状态筛选条件。"
                    }
                  />
                ) : (
                  filteredCampaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td>
                        <strong>{campaign.name}</strong>
                        {campaign.primaryKeyword ? <div className="muted">关键词：{campaign.primaryKeyword}</div> : null}
                      </td>
                      <td>{campaign.store}</td>
                      <td>{campaign.source}</td>
                      <td className="code">{campaign.locale}</td>
                      <td>
                        <div className="progress-cell">
                          <ProgressBar value={campaign.progress} />
                          <span>{campaign.progress}%</span>
                        </div>
                      </td>
                      <td>{campaign.publishPolicy}</td>
                      <td>
                        <Badge tone={campaign.statusTone}>{formatCampaignStatus(campaign.status)}</Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="新建内容任务"
          description="提交后由管理端 API 创建任务记录，后续交给 worker 执行生成、质检与发布。"
          compact
        >
          <form id="new-campaign" action="/api/admin/campaigns" method="post" className="form-grid">
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
            <Field label="任务标题" name="title" placeholder="春夏新品关键词集群" required />
            <Field label="主关键词" name="primaryKeyword" placeholder="可持续收纳家具" />
            <SelectField
              label="来源类型"
              name="sourceType"
              value="manual_topic"
              options={[
                { label: "手动主题", value: "manual_topic" },
                { label: "商品", value: "product" },
                { label: "集合", value: "collection" }
              ]}
            />
            <SelectField
              label="发布策略"
              name="publishPolicy"
              value="manual_review"
              options={[
                { label: "人工复核", value: "manual_review" },
                { label: "达标自动发布", value: "auto_when_qualified" },
                { label: "直接发布", value: "direct" }
              ]}
            />
            <Field label="目标字数" name="targetWordCount" type="number" value={1400} min={600} max={3500} step={100} />
            <Field label="来源 ID 或 Handle" name="sourceId" placeholder="product-handle / collection-handle" />
            <SelectField
              label="热点新闻"
              name="hotNewsEnabled"
              value="true"
              options={[
                { label: "自动搜索相关热点", value: "true" },
                { label: "不使用热点", value: "false" }
              ]}
            />
            <Field label="热点查询词" name="hotNewsQuery" placeholder="留空时自动使用品类、商品和主关键词" />
            <Field label="热点地区" name="hotNewsGeo" value="US" placeholder="US / CN / JP" />
            <Field label="热点数量" name="hotNewsMaxItems" type="number" value={5} min={1} max={12} step={1} />
            <SelectField
              label="内链策略"
              name="internalLinksStrategy"
              value="auto"
              options={[
                { label: "自动选择商品/系列/文章", value: "auto" },
                { label: "优先商品", value: "product" },
                { label: "优先系列", value: "collection" },
                { label: "优先文章", value: "article" }
              ]}
            />
            <Field label="内链数量" name="internalLinksMaxLinks" type="number" value={4} min={1} max={8} step={1} />
            <SelectField
              label="自动配图"
              name="imageGenerationEnabled"
              value="true"
              options={[
                { label: "生成图片并插入文章", value: "true" },
                { label: "只生成文字", value: "false" }
              ]}
            />
            <SelectField
              label="图片位置"
              name="imagePlacement"
              value="inline"
              options={[
                { label: "正文插图", value: "inline" },
                { label: "首图", value: "featured" },
                { label: "首图 + 正文", value: "both" }
              ]}
            />
            <SelectField
              label="产品图参考"
              name="productImageReferenceEnabled"
              value="true"
              options={[
                { label: "自动读取来源商品图", value: "true" },
                { label: "不使用产品图参考", value: "false" }
              ]}
            />
            <Field label="额外参考图 URL" name="referenceImageUrls" placeholder="多个 URL 用逗号分隔" />
            <Field label="图片风格补充" name="imagePromptStyle" placeholder="Apple 风格、真实生活方式场景、浅色背景" />
            <Field label="最低 SEO 分" name="minSeoScore" type="number" value={78} min={0} max={100} step={1} />
            <Field label="最低编辑质量分" name="minEditorialScore" type="number" value={72} min={0} max={100} step={1} />
            <SelectField
              label="模板化检测"
              name="rejectTemplatePatterns"
              value="true"
              options={[
                { label: "启用：拦截模板化表达", value: "true" },
                { label: "关闭", value: "false" }
              ]}
            />
            <SelectField
              label="热点依据要求"
              name="requireTrendEvidence"
              value="false"
              options={[
                { label: "不强制", value: "false" },
                { label: "必须找到热点依据", value: "true" }
              ]}
            />
            <div className="span-2 form-actions">
              <button className="button button--primary" type="submit" disabled={stores.length === 0}>
                <Megaphone size={16} aria-hidden="true" />
                创建任务
              </button>
              <span className="muted">无可用店铺时会禁用创建，避免提交无法归属的数据。</span>
            </div>
          </form>
        </Panel>
      </div>
    </>
  );
}
