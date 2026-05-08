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
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

或使用 Docker：

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
