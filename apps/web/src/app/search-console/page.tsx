import { RefreshCw, Search, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import Link from "next/link";
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
import { getSearchConsoleView } from "@/lib/admin-client";
import { readFormNotice, type SearchParamRecord } from "@/lib/search-params";

type PageProps = {
  searchParams?: Promise<SearchParamRecord>;
};

export default async function SearchConsolePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { data, error } = await getSearchConsoleView();
  const notice = readFormNotice(params);

  return (
    <>
      <PageHeader
        eyebrow="Search Console"
        title="搜索表现管理"
        description="管理 Google Search Console 站点绑定、授权状态和文章自然搜索表现同步。"
        action={
          <div className="toolbar">
            <a className="button" href="/search-console">
              <RefreshCw size={16} aria-hidden="true" />
              刷新列表
            </a>
            <a className="button button--primary" href="#new-search-console">
              <Search size={16} aria-hidden="true" />
              新增站点
            </a>
          </div>
        }
      />

      <div className="stack">
        <ErrorState error={error} title="Search Console 数据读取失败" />
        {notice ? <FormNotice {...notice} /> : null}

        <div className="insight-strip">
          <StatusPill
            label="站点配置"
            value={data.properties.length}
            tone={data.properties.length > 0 ? "good" : "warn"}
            icon={<ShieldCheck size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="已授权"
            value={data.properties.filter((item) => item.status === "active").length}
            tone="good"
            icon={<ShieldCheck size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="需授权"
            value={data.properties.filter((item) => item.status === "needs_auth").length}
            tone="warn"
            icon={<ShieldQuestion size={18} aria-hidden="true" />}
          />
          <StatusPill
            label="异常同步"
            value={data.properties.filter((item) => item.status === "disconnected").length}
            tone="danger"
            icon={<ShieldAlert size={18} aria-hidden="true" />}
          />
        </div>

        <Panel title="Search Console 站点" description="查看站点授权、scope 和最近同步状态。">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>站点</th>
                  <th>店铺</th>
                  <th>状态</th>
                  <th>快照</th>
                  <th>查询行</th>
                  <th>最后同步</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.properties.length === 0 ? (
                  <TableEmpty
                    colSpan={7}
                    title="暂无 Search Console 站点"
                    description="添加站点后会显示授权状态、同步快照和查询表现。"
                  />
                ) : (
                  data.properties.map((property) => (
                    <tr key={property.id}>
                      <td>
                        <strong>{property.siteUrl}</strong>
                        <div className="muted code">{property.permissionLevel ?? "未声明权限"}</div>
                      </td>
                      <td>{property.store}</td>
                      <td>
                        <Badge tone={property.statusTone}>{property.status}</Badge>
                      </td>
                      <td>{property.snapshotCount}</td>
                      <td>{property.queryRowCount}</td>
                      <td>{property.lastSyncedAt ?? "未同步"}</td>
                      <td>
                        <form action="/api/admin/search-console/sync" method="post">
                          <input type="hidden" name="storeId" value={property.storeId} />
                          <input type="hidden" name="propertyId" value={property.id} />
                          <button className="button button--ghost button--small" type="submit">
                            <RefreshCw size={14} aria-hidden="true" />
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

        <div className="grid grid--two">
          <Panel title="新增 / 更新站点" description="录入 Search Console 站点与 OAuth 凭证。">
            <form id="new-search-console" action="/api/admin/search-console" method="post" className="form-grid">
              <Field label="店铺 ID" name="storeId" required placeholder="store_cuid" />
              <Field label="Site URL" name="siteUrl" required placeholder="https://example.com/" />
              <SelectField
                label="状态"
                name="status"
                value="active"
                options={[
                  { label: "active", value: "active" },
                  { label: "needs_auth", value: "needs_auth" },
                  { label: "disconnected", value: "disconnected" },
                  { label: "archived", value: "archived" }
                ]}
              />
              <Field label="权限级别" name="permissionLevel" placeholder="siteOwner / fullUser" />
              <Field label="scopes" name="scopes" placeholder="https://www.googleapis.com/auth/webmasters.readonly" />
              <Field label="clientId" name="googleClientId" placeholder="OAuth client id" />
              <Field label="clientSecret" name="googleClientSecret" placeholder="OAuth client secret" />
              <Field label="accessToken" name="accessToken" placeholder="可直接填 access token" />
              <Field label="refreshToken" name="refreshToken" placeholder="OAuth refresh token" />
              <Field label="tokenExpiresAt" name="tokenExpiresAt" placeholder="2026-05-23T00:00:00.000Z" />
              <div className="span-2 form-actions">
                <button className="button button--primary" type="submit">
                  <Search size={16} aria-hidden="true" />
                  保存站点
                </button>
                <span className="muted">保存接口：POST /api/admin/search-console</span>
              </div>
            </form>
          </Panel>

          <Panel title="最近快照" description="展示最近同步到的文章自然搜索表现。">
            <div className="list">
              {data.snapshots.length === 0 ? (
                <EmptyState
                  title="暂无快照"
                  description="点击同步后，最近的文章自然搜索表现会在这里显示。"
                />
              ) : (
                data.snapshots.slice(0, 6).map((snapshot) => (
                  <div className="list-item" key={snapshot.id}>
                    <div>
                      <strong>{snapshot.article}</strong>
                      <small className="muted">
                        {snapshot.store} · {snapshot.startDate} ~ {snapshot.endDate}
                      </small>
                    </div>
                    <Badge tone={snapshot.performanceScore !== null && snapshot.performanceScore >= 70 ? "good" : "warn"}>
                      {snapshot.performanceScore ?? "暂无"} 分
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
