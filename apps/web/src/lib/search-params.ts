export type SearchParamRecord = Record<string, string | string[] | undefined> | undefined;

export function readSearchParam(params: SearchParamRecord, key: string) {
  const value = params?.[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export function readFormNotice(params: SearchParamRecord) {
  const error = readSearchParam(params, "error");
  if (error) {
    const code = readSearchParam(params, "code");
    return {
      tone: "danger" as const,
      title: "操作未完成",
      message: code ? `${error}（${code}）` : error
    };
  }

  const saved = readSearchParam(params, "saved");
  if (saved) {
    return {
      tone: "good" as const,
      title: "已提交",
      message: "操作已交给管理端处理，当前视图会读取最新状态。"
    };
  }

  const oauth = readSearchParam(params, "oauth");
  if (oauth) {
    return {
      tone: "good" as const,
      title: "Shopify 授权已校验",
      message: "OAuth 回调已通过校验，后续接入 token 持久化后会自动刷新店铺授权状态。"
    };
  }

  return null;
}
