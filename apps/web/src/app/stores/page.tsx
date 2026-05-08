import { RefreshCw, Search, Store as StoreIcon } from "lucide-react";
import { Badge, ErrorState, PageHeader, Panel, TableEmpty } from "@/components/ui";
import { getStoresView } from "@/lib/admin-client";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function param(params: Record<string, string | string[] | undefined> | undefined, key: string) {
  const value = params?.[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function StoresPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = param(params, "q").trim().toLowerCase();
  const status = param(params, "status");
  const { data: stores, error } = await getStoresView();
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
            <form action="/api/shopify/oauth/start" method="get" className="inline-form">
              <label className="sr-only" htmlFor="shop-domain">
                Shopify 店铺域名
              </label>
              <input id="shop-domain" name="shop" placeholder="your-store.myshopify.com" required />
              <button className="button button--primary" type="submit">
                <StoreIcon size={16} aria-hidden="true" />
                连接店铺
              </button>
            </form>
          </div>
        }
      />

      <div className="stack">
        <ErrorState error={error} title="店铺数据读取失败" />

        <Panel title="店铺列表" description="查看授权状态、Scope 覆盖、商品同步和内容覆盖情况。">
          <form className="filter-bar" action="/stores">
            <label className="filter-field">
              <Search size={15} aria-hidden="true" />
              <input name="q" defaultValue={param(params, "q")} placeholder="搜索店铺或域名" />
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
