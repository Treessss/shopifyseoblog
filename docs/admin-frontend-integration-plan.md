# Admin Frontend Integration Plan

## Summary

管理端基线采用 `shadcn/admin` 风格：密集、清晰、面向运营的 SaaS 后台，不做营销型页面。实现方式不整仓替换模板，而是在现有 Next.js App Router、Prisma、Shopify、AI、worker 架构上吸收开源 shadcn 系后台模板的布局、数据表、表单、状态反馈和响应式模式。

核心目标：

- 移除 `apps/web/src/lib/admin-data.ts` 静态 mock 数据依赖。
- 前端页面统一消费 `/api/admin/*` 管理 API。
- 管理 API 通过 Prisma 读取和写入真实业务数据。
- 店铺同步、文章生成、文章发布等长任务进入 worker，并把状态、日志、失败原因回写数据库。
- 默认 UI 为简体中文，保留英文和多语言业务扩展能力。

## Open Source UI Base

- 模板方向：shadcn/admin 风格的开源后台模板。
- 设计原则：数据密集、扫描友好、低装饰、高对比、明确状态、表格优先。
- 技术策略：继续使用现有本地 CSS token 和轻量组件，逐步对齐 shadcn/ui primitives；不引入 Ant Design Pro 或 Refine，避免技术体系和包体积突变。
- 关键 UI 组件：侧边栏、顶部搜索、KPI 卡片、数据表、筛选条、表单、badge、进度条、空状态、错误态、加载态。

## Backend Interfaces

新增管理端 API，统一返回：

```json
{ "ok": true, "data": {} }
```

或：

```json
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "中文错误说明" } }
```

最小接口集：

- `GET /api/admin/dashboard`
- `GET /api/admin/stores`
- `POST /api/admin/stores/sync`
- `GET /api/admin/ai-settings`
- `POST /api/admin/ai-settings`
- `GET /api/admin/languages`
- `POST /api/admin/languages`
- `GET /api/admin/brand-voice`
- `POST /api/admin/brand-voice`
- `GET /api/admin/campaigns`
- `POST /api/admin/campaigns`
- `GET /api/admin/articles`
- `POST /api/admin/articles/:id/publish`
- `GET /api/admin/logs`

接口必须做到：

- 从 demo organization 或第一个 active organization 解析租户上下文，所有查询显式带 `organizationId`。
- 所有写操作使用 Zod 或等价 schema 校验。
- API Key 和 Shopify token 不回显明文，只返回 `configured`、`redacted` 或状态字段。
- 任务类写操作创建 `PublishJob` 或队列任务，并写入 `PublishLog` / `AuditLog`。

## Data Flow

店铺管理：

- `ShopifyStore` 为主表。
- 商品数量来自 `ProductSnapshot`。
- 文章数量来自 `BlogArticle`。
- 同步按钮创建 `sync_product` 和 `sync_collection` 任务，worker 拉取 Shopify GraphQL Admin API 后 upsert 快照。

内容任务：

- `BlogCampaign` 存储任务设置、来源、关键词和发布策略。
- 创建任务后可生成初始 `BlogArticle` 或入队 `blog.generate`。
- 任务进度由关联文章状态统计得出，不再使用固定百分比。

文章管理：

- `BlogArticle` 存储标题、正文、SEO、质量状态和 Shopify 发布结果。
- 发布动作创建 `PublishJob` 并入队 `article.publish`。
- worker 成功后更新 `publishedAt`、`shopifyArticleId`、`canonicalUrl`；失败时写入 `failureReason`。

AI 设置：

- `AiProviderConfig` 存储 OpenAI-compatible provider。
- `apiKeyEncrypted` 只在服务端保存，前端显示脱敏状态。
- 测试连接先验证配置完整性；具备 key 时再做真实 provider 探测。

日志：

- 运行日志优先来自 `PublishLog`。
- 审计日志来自 `AuditLog`，用于操作追踪。
- 管理端展示需要支持级别、模块、时间、状态和实体关联。

## Implementation Steps

1. 新增 `apps/web/src/modules/admin`，按 `repository / service / policies` 组织管理端数据访问、DTO 映射和租户上下文。
2. 新增 `/api/admin/*` route handlers，所有页面数据和操作都走 API。
3. 改造现有管理页面，移除 mock import，使用真实 API 数据渲染，并补齐空状态、错误态、响应式表格和安全动作反馈。
4. 强化 worker processor，把 Shopify 同步、文章生成、文章发布从占位实现改为真实 DB 状态流。
5. 更新 seed，使本地 demo 数据足够支撑管理端非空状态，但 seed 数据只作为开发数据，不作为页面 mock。
6. 跑 `npm run typecheck`、`npm run test`，必要时补充 repository/service 单元测试。
7. 每个模块完成后按范围提交 git commit，保持可回滚。

## Acceptance Criteria

- 管理端页面不再引用 `apps/web/src/lib/admin-data.ts`。
- 无数据库数据时页面显示空状态，不崩溃。
- seed 后 dashboard、店铺、任务、文章、设置、日志页面均展示真实数据库数据。
- 创建任务、同步店铺、发布文章能产生数据库任务和可见日志。
- worker 处理成功或失败都会回写业务状态和失败原因。
- AI 和 Shopify 密钥不会出现在前端响应或页面 HTML。
- 移动端 375px、平板 768px、桌面 1440px 下无横向页面溢出；表格只在内部容器横向滚动。
- TypeScript typecheck 和现有测试通过。

## Assumptions

- 当前阶段仍使用 demo organization 机制，认证层后续可替换为 BoxyHQ/SSO。
- 前后端分离边界先落在 Next API routes；未来拆独立 API 服务时复用 service/repository。
- 开源模板只作为 UI/UX 和组件模式来源，不整仓覆盖现有代码。
- Redis 或 Shopify 凭证缺失时，API 和 worker 必须返回明确失败原因，不用假成功模拟。
