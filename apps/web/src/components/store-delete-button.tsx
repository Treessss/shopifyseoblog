"use client";

import { Trash2 } from "lucide-react";

export function StoreDeleteButton(props: { storeId: string; storeName: string; domain: string }) {
  function confirmDelete() {
    return window.confirm(
      `确定删除「${props.storeName}」吗？\n\n这会删除本系统内的授权、同步快照、内容任务和文章记录，但不会删除 Shopify 后台店铺或已发布内容。`
    );
  }

  return (
    <form
      action="/api/admin/stores/delete"
      method="post"
      onSubmit={(event) => {
        if (!confirmDelete()) event.preventDefault();
      }}
    >
      <input type="hidden" name="storeId" value={props.storeId} />
      <input type="hidden" name="confirmDomain" value={props.domain} />
      <button className="button button--small button--danger" type="submit" aria-label={`删除店铺 ${props.storeName}`} title="删除店铺">
        <Trash2 size={14} aria-hidden="true" />
        删除
      </button>
    </form>
  );
}
