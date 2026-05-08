import { RefreshCw, Store as StoreIcon } from "lucide-react";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { stores } from "@/lib/admin-data";

export default function StoresPage() {
  return (
    <>
      <PageHeader
        eyebrow="Stores"
        title="店铺管理"
        description="管理 Shopify 多店铺授权、商品同步、默认语言和内容覆盖度。"
        action={
          <div className="toolbar">
            <button className="button">
              <RefreshCw size={16} aria-hidden="true" />
              同步商品
            </button>
            <button className="button button--primary">
              <StoreIcon size={16} aria-hidden="true" />
              连接店铺
            </button>
          </div>
        }
      />

      <Panel title="店铺列表" description="查看授权状态、Scope 覆盖、商品同步和内容覆盖情况。">
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
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr key={store.domain}>
                  <td>
                    <strong>{store.name}</strong>
                    <div className="muted code">{store.domain}</div>
                  </td>
                  <td>{store.locale}</td>
                  <td>{store.products.toLocaleString("zh-CN")}</td>
                  <td>{store.articles}</td>
                  <td>
                    <Badge tone={store.status === "已连接" ? "good" : store.status === "同步中" ? "warn" : "danger"}>
                      {store.status}
                    </Badge>
                  </td>
                  <td>{store.lastSync}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
