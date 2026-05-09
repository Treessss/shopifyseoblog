import { FileText, Languages, ListFilter, PackageCheck, RefreshCw, Search, Store as StoreIcon } from "lucide-react";
import { StoreConnectDialog } from "@/components/store-connect-dialog";
import { Badge, ErrorState, FormNotice, PageHeader, Panel, StatusPill, TableEmpty } from "@/components/ui";
import { getStoresView } from "@/lib/admin-client";
import { readFormNotice, readSearchParam } from "@/lib/search-params";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function StoresPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = readSearchParam(params, "q").trim().toLowerCase();
  const status = readSearchParam(params, "status");
  const { data: stores, error } = await getStoresView();
  const notice = readFormNotice(params);
  const filteredStores = stores.filter((store) => {
    const matchesQuery =
      !query || `${store.name} ${store.domain} ${store.locale}`.toLowerCase().includes(query);
    const matchesStatus = !status || store.status === status;
    return matchesQuery && matchesStatus;
  });

  return (
    <>
      <PageHeader
        eyebrow="Stores"
        title="店铺管理"
        description="管理 Shopify 多店铺授权、商品同步、默认语言和内容覆盖度。"
        action={
          <div className="toolbar">
            <a className="button" href="/stores">
              <RefreshCw size={16} aria-hidden="true" />
              刷新列表
            </a>
            <StoreConnectDialog />
          </div>
        }
      />

      <div className="stack">
        <ErrorState error={error} title="店铺数据读取失败" />
        {notice ? <FormNotice {...notice} /> : null}

        <div className="insight-strip">
          <StatusPill
            label="已连接"
            value={stores.filter((store) => store.statusTone === "good").length}
            tone={stores.some((store) => store.statusTone === "danger") ? "warn" : "good"}
            icon={<StoreIcon size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="商品快照"
            value={stores.reduce((sum, store) => sum + store.products, 0).toLocaleString("zh-CN")}
            tone="neutral"
            icon={<PackageCheck size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="内容覆盖"
            value={stores.reduce((sum, store) => sum + store.articles, 0).toLocaleString("zh-CN")}
            tone="neutral"
            icon={<FileText size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="默认语言"
            value={new Set(stores.map((store) => store.locale)).size || "zh-CN"}
            tone="neutral"
            icon={<Languages size={18} aria-hidden="true" />}
          />
        </div>

        <Panel title="店铺列表" description="查看授权状态、Scope 覆盖、商品同步和内容覆盖情况。">
          <form className="filter-bar" action="/stores">
            <label className="filter-field">
              <Search size={15} aria-hidden="true" />
              <input name="q" defaultValue={readSearchParam(params, "q")} placeholder="搜索店铺或域名" />
            </label>
            <label className="filter-select">
              <span>状态</span>
              <select name="status" defaultValue={status}>
                <option value="">全部</option>
                {[...new Set(stores.map((store) => store.status))].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <button className="button" type="submit">
              <ListFilter size={16} aria-hidden="true" />
              筛选
            </button>
            <span className="filter-bar__summary">当前 {filteredStores.length} 家店铺</span>
          </form>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>店铺</th>
                  <th>默认语言</th>
                  <th>商品数</th>
                  <th>文章数</th>
                  <th>状态</th>
                  <th>最后同步</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredStores.length === 0 ? (
                  <TableEmpty
                    colSpan={7}
                    title={stores.length === 0 ? "暂无店铺数据" : "没有匹配的店铺"}
                    description={
                      stores.length === 0
                        ? "通过 Shopify OAuth 连接店铺后会展示同步状态和内容覆盖。"
                        : "调整搜索关键词或状态筛选条件。"
                    }
                  />
                ) : (
                  filteredStores.map((store) => (
                    <tr key={store.id}>
                      <td>
                        <strong>{store.name}</strong>
                        <div className="muted code">{store.domain}</div>
                      </td>
                      <td className="code">{store.locale}</td>
                      <td>{store.products.toLocaleString("zh-CN")}</td>
                      <td>{store.articles.toLocaleString("zh-CN")}</td>
                      <td>
                        <Badge tone={store.statusTone}>{store.status}</Badge>
                      </td>
                      <td>{store.lastSync}</td>
                      <td>
                        <form action="/api/admin/stores/sync" method="post">
                          <input type="hidden" name="storeId" value={store.id} />
                          <button className="button button--ghost" type="submit">
                            <RefreshCw size={15} aria-hidden="true" />
                            同步
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
