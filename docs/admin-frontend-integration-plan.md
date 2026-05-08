# 管理端企业级前后端打通实施计划

## 目标

管理端采用 shadcn/admin 风格的开源后台模板思路进行企业级实现，保持当前 Next.js App Router、Prisma、Shopify、AI provider、BullMQ worker 的 monorepo 架构。前端页面不再使用 mock 数据，全部通过管理端 API 获取真实数据库和任务状态，并能触发同步、生成、发布等核心业务动作。

## 设计基线

- UI 风格：数据密集型 SaaS 后台，参考 shadcn/admin 与 Shadboard 类开源模板，不整仓替换。
- 交互重点：KPI 汇总、筛选、状态 badge、数据表、空状态、加载态、错误态、表单提交反馈。
- 视觉约束：浅色工作台、紧凑表格、8px 圆角、Lucide 图标、清晰 focus ring、移动端无横向溢出。
- 技术边界：前端页面只消费 typed admin API，不直接访问 mock 常量；服务端 API 通过 service/repository/policy 分层访问 Prisma。

## 后端接口与业务打通

- 新增 `apps/web/src/modules/admin`，按 `repository / service / policies / types` 拆分管理端业务。
- 新增 `/api/admin/*` Route Handlers：
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
- 所有响应统一为 `{ ok: true, data }` 或 `{ ok: false, error }`。
- 管理端读模型来自 Prisma：
  - 店铺：`ShopifyStore`、`ProductSnapshot`、`CollectionSnapshot`
  - 内容任务：`BlogCampaign`
  - 文章：`BlogArticle`、`ArticleTranslation`
  - 运行状态：`PublishJob`、`PublishLog`、`AuditLog`
  - 配置：`AiProviderConfig`、`LocaleConfig`、`BrandVoice`
- 写操作必须做 Zod 校验、组织隔离、审计日志，并避免向客户端回显真实密钥。

## 前端模块

- 改造现有管理页：Dashboard、Stores、AI Settings、Languages、Campaigns、Articles、Brand Voice、Logs。
- 删除页面对 `apps/web/src/lib/admin-data.ts` 的依赖，统一调用 `apps/web/src/lib/admin-api.ts`。
- 抽象通用后台组件：KPI 卡片、数据表状态、筛选栏、空状态、错误提示、表单字段、危险/成功/警告状态。
- 关键页面能力：
  - Dashboard：真实统计、最近任务、异常日志、待处理文章。
  - Stores：真实店铺列表、商品数、文章数、同步状态、一键同步。
  - AI Settings：读取/保存默认 provider，测试连接，密钥脱敏。
  - Languages：语言启用、默认语言、Shopify blog handle 配置。
  - Campaigns：创建任务，绑定店铺、来源、语言、关键词、发布策略。
  - Articles：查看 SEO 分、质量状态、发布状态，并触发发布。
  - Brand Voice：按语言/店铺维护语气、禁用词、示例。
  - Logs：查看发布、同步、生成和审计日志。

## Worker 与自动优化

- Shopify 同步任务真实读取 Shopify GraphQL Admin API，写入商品/集合快照。
- 内容生成任务创建或更新文章记录，调用 content engine 和 AI provider，写入质量分、SEO 字段、失败原因。
- 发布任务读取文章内容并通过 Shopify Article API 发布，回写 `publishedAt`、`shopifyArticleId`、`PublishLog`。
- 自动优化规则：
  - SEO 分低于阈值时标记 `quality_failed`，写入质量报告。
  - 授权缺失或 Shopify 调用失败时保留失败原因和可重试 job。
  - 任务进度由文章总数、已生成数、已发布数计算，不用前端硬编码。

## Git 保存策略

- 计划文档、后端 API、前端 UI、worker 业务流分别提交。
- 每个模块提交前执行最小必要审查：`git diff --check`、相关 typecheck/test。
- 主线程在子代理完成后复核改动范围、集成冲突和业务闭环，再提交对应模块。

## 验收标准

- 仓库内不存在管理页继续 import `@/lib/admin-data` 的情况。
- `npm run typecheck` 通过。
- `npm run test` 通过，或明确记录与环境相关的失败原因。
- 管理端页面在有 seed 数据时展示真实数据库数据，在空数据库时展示可理解的空状态。
- 同步、生成、发布等按钮能够创建真实 job 或业务记录，而不是返回 mock contract。
