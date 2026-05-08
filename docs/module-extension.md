# Module Extension

业务模块统一放在 `apps/web/src/modules/{module}`，模块内部按职责拆分为
`routes/service/repository/jobs/policies`。模块只暴露自己的入口和契约，跨模块协作通过公共
`packages/*`、事件或 worker job 完成，避免直接读取其他模块的私有实现。

## Directory Contract

```txt
apps/web/src/modules/{module}/
  routes/       HTTP route handlers、server actions、webhook entrypoints
  service/      用例编排、事务边界、权限校验后的业务流程
  repository/   数据访问、查询封装、持久化映射
  jobs/         BullMQ job payload 构造、enqueue helper、job name 常量
  policies/     RBAC、租户隔离、发布/同步/生成策略
```

`routes` 是外部入口，只做请求解析、认证上下文提取和调用 `service`。`service` 是模块主干，
负责组织 repository、policy、job enqueue 和第三方客户端。`repository` 不包含业务判断，只提供
清晰的数据读写方法。`jobs` 不直接执行任务，只定义 payload 和入队函数，实际执行放在
`apps/worker/src/processors/*`。`policies` 收拢可复用判断，例如能否发布、能否同步某店铺、质量门槛是否通过。

## Worker Jobs

worker 侧当前提供两个队列：

- `shopify-sync`：`product.sync`、`collection.sync`
- `blog-generation`：`blog.generate`、`article.publish`

模块需要后台执行时，在自己的 `jobs` 目录创建轻量 enqueue helper，并复用
`@shopify-ai-blog/worker` 暴露的 job name 和 payload 类型。入队数据必须包含 `organizationId` 和
`storeId`，可选带上 `correlationId` 方便审计日志串联。处理器内部再调用对应模块 service，保持
“模块定义任务、worker 执行任务”的边界。

## Adding A Module

1. 新建 `apps/web/src/modules/{module}`，按目录契约补齐最小文件。
2. 将共享类型、schema、状态枚举放到 `packages/shared`；只被单模块使用的类型留在模块内。
3. 在 `policies` 中定义权限和租户隔离判断，`routes` 和 `service` 都调用同一套 policy。
4. 需要异步任务时，先在模块 `jobs` 定义 payload 与 enqueue helper，再在 worker 新增 processor 分支。
5. 对外只导出模块入口，不导出 repository 私有查询，避免其他模块绕过 service 和 policy。

## Naming

模块名使用短横线目录名，例如 `blog`, `seo-audit`, `product-optimizer`。job name 使用
`domain.action`，例如 `article.publish`。repository 方法使用业务语义命名，例如
`findCampaignById`、`saveGeneratedArticle`，不要泄漏底层表结构到 routes。
