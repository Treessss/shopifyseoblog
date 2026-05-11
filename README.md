# Shopify AI Blog SaaS

一个面向 Shopify 多店铺的 AI Blog 管理系统。首版聚焦：多语言内容生成、关键词布局、自动生图、质量门槛检查、GraphQL Admin API 发布、多店铺管理，以及后续模块扩展能力。

## 技术方向

- Monorepo：`apps/web`、`apps/worker`、`packages/*`
- Web：Next.js App Router，默认简体中文
- Worker：BullMQ + Redis
- Database：Postgres + Prisma
- Shopify：GraphQL Admin API，默认版本 `2026-04`
- AI：OpenAI-compatible API，支持自定义 `baseUrl`
- 自部署：Docker Compose

## 快速开始

```bash
npm install
npm run start:local
```

统一运行脚本会自动创建 `.env.local`（如果不存在）、启动 Docker 里的 Postgres/Redis/MinIO、同步 Prisma schema，并在同一个终端里启动 Web 与 Worker。

常用参数：

```bash
npm run start:local -- --port 3001      # 改 Web 端口
npm run start:local -- --no-infra       # 不启动 Docker 基础设施
npm run start:local -- --seed           # 同步数据库后执行 seed
npm run start:local -- --worker-only    # 只启动 worker
```

或使用完整 Docker：

```bash
npm run docker:up
```

## 目录结构

```text
apps/
  web/       管理后台、API route、Shopify OAuth、webhook
  worker/    后台任务：同步、生成、质检、发布
packages/
  ai/              OpenAI-compatible provider
  content-engine/  多语言关键词、正文、SEO、HTML
  db/              Prisma schema 与数据库入口
  i18n/            UI 文案、locale fallback、语言规则
  shared/          类型、schema、状态机、RBAC
  shopify/         GraphQL client、OAuth、发布封装
infra/docker/      自部署配置
```

## 扩展原则

新业务模块统一进入 `apps/web/src/modules/{moduleName}`，并按 `routes/service/repository/jobs/policies` 拆分。公共能力沉到 `packages/*`，避免后续 SEO、商品优化、邮件营销等模块和 Blog 模块耦合。
