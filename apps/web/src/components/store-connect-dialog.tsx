"use client";

import { Globe2, Newspaper, ShieldCheck, Store, X } from "lucide-react";
import { useId, useState } from "react";

export function StoreConnectDialog() {
  const [open, setOpen] = useState(false);
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
                <p id={descriptionId}>输入店铺基础信息后进入 Shopify OAuth 授权，授权成功后会回到店铺管理页。</p>
              </div>
              <button className="icon-button" type="button" aria-label="关闭新增店铺弹窗" onClick={() => setOpen(false)}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <form action="/api/shopify/oauth/start" method="get" className="modal__body">
              <label className="field">
                <span>Shopify 店铺域名</span>
                <input
                  name="shop"
                  type="text"
                  placeholder="your-store.myshopify.com"
                  autoComplete="off"
                  required
                />
                <small>只填写 myshopify.com 域名，系统会用 OAuth 获取授权。</small>
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

              <div className="modal__note">
                <span>
                  <ShieldCheck size={17} aria-hidden="true" />
                  OAuth 授权
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

              <div className="modal__footer">
                <button className="button" type="button" onClick={() => setOpen(false)}>
                  取消
                </button>
                <button className="button button--primary" type="submit">
                  <ShieldCheck size={16} aria-hidden="true" />
                  开始授权
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
