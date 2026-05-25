import { ExternalLink, KeyRound, RefreshCw, Search, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import {
  Badge,
  EmptyState,
  ErrorState,
  Field,
  FormNotice,
  PageHeader,
  Panel,
  SelectField,
  TextAreaField,
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
  const defaultStore = data.stores[0];
  const defaultSiteUrl = defaultStore?.defaultSiteUrl ?? "https://your-store.example.com/";

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
            value={data.properties.filter((item) => item.status === "active" && item.hasRefreshToken).length}
            tone={data.properties.some((item) => item.hasRefreshToken) ? "good" : "warn"}
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

        <Panel
          title="这些值从哪里拿"
          description="Google Cloud 现在的 OAuth 客户端入口在 Google Auth platform 里的 Clients 页面。"
        >
          <div className="list">
            <div className="list-item">
              <div>
                <strong>你现在的 API key</strong>
                <small className="muted">
                  API key 不能读取 Search Console 的搜索表现、query、点击和排名数据。这里必须使用 OAuth 2.0
                  client ID、client secret，并拿到 refresh token；否则只能保存站点，不能同步真实表现。
                </small>
              </div>
              <Badge tone="warn">还缺 OAuth</Badge>
            </div>
            <div className="list-item">
              <div>
                <strong>Search Console property</strong>
                <small className="muted">
                  在 Search Console 里选中你的 property，复制 API 里用的 <code>siteUrl</code>。
                  你的 Shopify URL-prefix 可以先填 <code>{defaultSiteUrl}</code>；Domain property 形如{" "}
                  <code>sc-domain:example.com</code>。
                </small>
              </div>
              <a
                className="button button--ghost button--small"
                href="https://support.google.com/webmasters/answer/34592?hl=en"
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={14} aria-hidden="true" />
                官方说明
              </a>
            </div>
            <div className="list-item">
              <div>
                <strong>Google OAuth JSON</strong>
                <small className="muted">
                  按 Google quickstart 下载的 OAuth client JSON 和 token JSON 直接粘贴到表单里。
                  不需要手抄 client id 和 secret；系统会从 JSON 里拆出凭据。
                </small>
              </div>
              <a
                className="button button--ghost button--small"
                href="https://developers.google.com/workspace/guides/create-credentials"
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={14} aria-hidden="true" />
                官方步骤
              </a>
            </div>
            <div className="list-item">
              <div>
                <strong>Search Console API scope</strong>
                <small className="muted">
                  这个 API 只能走 OAuth 2.0，常用 scope 是{" "}
                  <code>https://www.googleapis.com/auth/webmasters.readonly</code> 或{" "}
                  <code>https://www.googleapis.com/auth/webmasters</code>。
                </small>
              </div>
              <a
                className="button button--ghost button--small"
                href="https://developers.google.com/webmaster-tools/v1/how-tos/authorizing"
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={14} aria-hidden="true" />
                授权文档
              </a>
            </div>
          </div>
        </Panel>

        <Panel title="Search Console 站点" description="查看站点授权、scope 和最近同步状态。">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>站点</th>
                  <th>店铺</th>
                  <th>状态</th>
                  <th>OAuth</th>
                  <th>快照</th>
                  <th>查询行</th>
                  <th>最后同步</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.properties.length === 0 ? (
                  <TableEmpty
                    colSpan={8}
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
                      <td>
                        <strong>{property.store}</strong>
                        <div className="muted code">{property.publishedSiteUrl}</div>
                      </td>
                      <td>
                        <Badge tone={property.statusTone}>{property.status}</Badge>
                        {property.lastSyncError ? <div className="muted">{property.lastSyncError}</div> : null}
                      </td>
                      <td>
                        <Badge tone={property.hasOAuthClient && property.hasClientSecret && property.hasRefreshToken ? "good" : "warn"}>
                          {property.hasRefreshToken ? "可刷新 token" : property.hasOAuthClient && property.hasClientSecret ? "缺 refresh token" : "缺 OAuth"}
                        </Badge>
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
              <SelectField
                label="店铺"
                name="storeId"
                value={defaultStore?.id}
                required
                options={
                  data.stores.length > 0
                    ? data.stores.map((store) => ({
                        label: `${store.name} · ${store.domain}`,
                        value: store.id
                      }))
                    : [{ label: "先连接 Shopify 店铺", value: "" }]
                }
                hint="系统会把这个 Search Console property 绑定到选中的 Shopify 店铺。"
              />
              <Field
                label="Site URL"
                name="siteUrl"
                value={defaultSiteUrl}
                required
                placeholder="https://example.com/"
                hint="请填真实发布域名，不要用 myshopify.com。URL-prefix property 用完整网址，Domain property 用 sc-domain:example.com。"
              />
              <SelectField
                label="状态"
                name="status"
                value="needs_auth"
                options={[
                  { label: "needs_auth", value: "needs_auth" },
                  { label: "active", value: "active" },
                  { label: "disconnected", value: "disconnected" },
                  { label: "archived", value: "archived" }
                ]}
              />
              <Field label="权限级别" name="permissionLevel" value="siteOwner" placeholder="siteOwner / fullUser" />
              <Field
                label="scopes"
                name="scopes"
                value="https://www.googleapis.com/auth/webmasters.readonly"
                placeholder="https://www.googleapis.com/auth/webmasters.readonly"
              />
              <TextAreaField
                label="OAuth client JSON"
                name="googleCredentialsJson"
                rows={8}
                placeholder={`{ "installed": { "client_id": "...", "client_secret": "..." } }`}
                hint="粘贴 Google 下载的 OAuth client JSON。系统会自动读取 client_id 和 client_secret。"
              />
              <TextAreaField
                label="Token JSON"
                name="googleTokenJson"
                rows={8}
                placeholder={`{ "access_token": "...", "refresh_token": "...", "expiry": "2026-05-23T00:00:00.000Z" }`}
                hint="粘贴 quickstart 生成的 token.json。里面的 refresh token 才能让后台自动刷新。"
              />
              <Field label="OAuth client ID" name="googleClientId" placeholder="可选：从 JSON 拆出后也可手工覆盖" />
              <Field label="OAuth client secret" name="googleClientSecret" placeholder="可选：从 JSON 拆出后也可手工覆盖" />
              <Field label="Access token" name="accessToken" placeholder="可选：直接填 access token" />
              <Field label="Refresh token" name="refreshToken" placeholder="可选：OAuth refresh token" />
              <Field label="Token expires at" name="tokenExpiresAt" placeholder="2026-05-23T00:00:00.000Z" />
              <div className="span-2 form-actions">
                <button className="button button--primary" type="submit">
                  <KeyRound size={16} aria-hidden="true" />
                  保存站点
                </button>
                <span className="muted">只保存 API key 不会让同步成功；同步需要 OAuth JSON 或 refresh token。</span>
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
