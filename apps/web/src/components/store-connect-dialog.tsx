"use client";

import { Globe2, KeyRound, Newspaper, ShieldCheck, Store, X } from "lucide-react";
import { useId, useState } from "react";

type ConnectMode = "oauth" | "manual";

export function StoreConnectDialog() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ConnectMode>("manual");
  const titleId = useId();
  const descriptionId = useId();

  return (
    <>
      <button className="button button--primary" type="button" onClick={() => setOpen(true)}>
        <Store size={16} aria-hidden="true" />
        新增店铺
      </button>

      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal__header">
              <div>
                <p className="eyebrow">New Store</p>
                <h2 id={titleId}>新增 Shopify 店铺</h2>
                <p id={descriptionId}>选择 OAuth 授权或手动 Token 接入，保存后可用于商品同步和 Blog 发布。</p>
              </div>
              <button className="icon-button" type="button" aria-label="关闭新增店铺弹窗" onClick={() => setOpen(false)}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="modal__body">
              <div className="segmented-control" aria-label="店铺接入方式">
                <button
                  type="button"
                  aria-pressed={mode === "manual"}
                  className={mode === "manual" ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
                  onClick={() => setMode("manual")}
                >
                  <KeyRound size={16} aria-hidden="true" />
                  手动 Token
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "oauth"}
                  className={mode === "oauth" ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
                  onClick={() => setMode("oauth")}
                >
                  <ShieldCheck size={16} aria-hidden="true" />
                  OAuth 授权
                </button>
              </div>

              {mode === "manual" ? <ManualTokenForm onCancel={() => setOpen(false)} /> : <OAuthForm onCancel={() => setOpen(false)} />}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function ManualTokenForm(props: { onCancel: () => void }) {
  return (
    <form action="/api/admin/stores" method="post" className="modal__form">
      <label className="field">
        <span>Shopify 店铺域名</span>
        <input name="shopDomain" type="text" placeholder="your-store.myshopify.com" autoComplete="off" required />
        <small>必须是 myshopify.com 域名。</small>
      </label>

      <div className="modal__grid">
        <label className="field">
          <span>店铺显示名称</span>
          <input name="name" type="text" placeholder="品牌店铺名称" autoComplete="organization" />
        </label>
        <label className="field">
          <span>Admin API Version</span>
          <input name="apiVersion" type="text" defaultValue="2026-04" placeholder="2026-04" required />
        </label>
      </div>

      <label className="field">
        <span>Admin API Access Token</span>
        <input name="adminAccessToken" type="password" placeholder="shpat_..." autoComplete="new-password" required />
        <small>用于 GraphQL Admin API，同步商品、集合并发布文章；保存时会加密。</small>
      </label>

      <div className="modal__grid">
        <label className="field">
          <span>默认内容语言</span>
          <select name="primaryLocale" defaultValue="zh-CN">
            <option value="zh-CN">简体中文 zh-CN</option>
            <option value="en-US">English en-US</option>
            <option value="ja-JP">日本語 ja-JP</option>
            <option value="de-DE">Deutsch de-DE</option>
            <option value="fr-FR">Français fr-FR</option>
            <option value="es-ES">Español es-ES</option>
          </select>
        </label>
        <label className="field">
          <span>默认 Blog Handle</span>
          <input name="shopifyBlogHandle" type="text" placeholder="news" defaultValue="news" />
        </label>
      </div>

      <label className="field">
        <span>Scopes</span>
        <input name="scopes" type="text" defaultValue="read_products,read_content,write_content" />
        <small>至少需要 read_products、read_content、write_content。</small>
      </label>

      <div className="modal__grid">
        <label className="field">
          <span>App API Key（可选）</span>
          <input name="shopifyApiKey" type="text" placeholder="用于记录 Custom App 标识" autoComplete="off" />
        </label>
        <label className="field">
          <span>Webhook Secret（可选）</span>
          <input name="webhookSecret" type="password" placeholder="用于后续 webhook 校验" autoComplete="new-password" />
        </label>
      </div>

      <ConnectionBadges active="manual" />

      <div className="modal__footer">
        <button className="button" type="button" onClick={props.onCancel}>
          取消
        </button>
        <button className="button button--primary" type="submit">
          <KeyRound size={16} aria-hidden="true" />
          保存并连接
        </button>
      </div>
    </form>
  );
}

function OAuthForm(props: { onCancel: () => void }) {
  return (
    <form action="/api/shopify/oauth/start" method="get" className="modal__form">
      <label className="field">
        <span>Shopify 店铺域名</span>
        <input name="shop" type="text" placeholder="your-store.myshopify.com" autoComplete="off" required />
        <small>OAuth 模式使用系统环境变量里的 SHOPIFY_API_KEY 和 SHOPIFY_API_SECRET。</small>
      </label>

      <div className="modal__grid">
        <label className="field">
          <span>默认内容语言</span>
          <select name="locale" defaultValue="zh-CN">
            <option value="zh-CN">简体中文 zh-CN</option>
            <option value="en-US">English en-US</option>
            <option value="ja-JP">日本語 ja-JP</option>
            <option value="de-DE">Deutsch de-DE</option>
          </select>
        </label>
        <label className="field">
          <span>默认 Blog Handle</span>
          <input name="blogHandle" type="text" placeholder="news" defaultValue="news" />
        </label>
      </div>

      <ConnectionBadges active="oauth" />

      <div className="modal__footer">
        <button className="button" type="button" onClick={props.onCancel}>
          取消
        </button>
        <button className="button button--primary" type="submit">
          <ShieldCheck size={16} aria-hidden="true" />
          开始授权
        </button>
      </div>
    </form>
  );
}

function ConnectionBadges(props: { active: ConnectMode }) {
  return (
    <div className="modal__note">
      <span>
        {props.active === "manual" ? <KeyRound size={17} aria-hidden="true" /> : <ShieldCheck size={17} aria-hidden="true" />}
        {props.active === "manual" ? "Token 加密保存" : "OAuth 授权"}
      </span>
      <span>
        <Globe2 size={17} aria-hidden="true" />
        多语言预设
      </span>
      <span>
        <Newspaper size={17} aria-hidden="true" />
        Blog 发布预留
      </span>
    </div>
  );
}
