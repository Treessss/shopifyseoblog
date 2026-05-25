# Shopify SEO Blog Agent Platform

面向 Shopify 店铺的 AI SEO 博客生产、发布和增长复盘系统。它把“写一篇博客”拆成一条可观察、可修复、可复盘的 agent 工作流：选题研究、证据收集、文章生成、质量门禁、Shopify 发布、Google Search Console 复盘和持续刷新。

当前系统已经具备多店铺管理、产品/集合同步、AI 文章生成、质量评分、humanizer 检查、Shopify 发布、Search Console 绑定、性能复盘和 Python Agent 编排后端。它不是承诺“一键生成就排名”，而是把 SEO 内容生产变成一套有证据、有门槛、有后续优化循环的运营系统。

![Dashboard](docs/assets/readme/dashboard.jpg)

## 目录

- [系统截图](#系统截图)
- [核心能力](#核心能力)
- [架构](#架构)
- [SEO 工作流](#seo-工作流)
- [快速启动](#快速启动)
- [环境变量](#环境变量)
- [AI 配置](#ai-配置)
- [Shopify 配置](#shopify-配置)
- [Google Search Console 配置](#google-search-console-配置)
- [推荐操作流程](#推荐操作流程)
- [页面说明](#页面说明)
- [Worker 队列](#worker-队列)
- [Python Agent 后端](#python-agent-后端)
- [开发命令](#开发命令)
- [部署说明](#部署说明)
- [常见问题](#常见问题)
- [参考设计来源](#参考设计来源)

## 系统截图

Agent Center 是操作员的第一入口。系统会根据店铺、队列、文章、质量门禁和复盘信号给出当前应该做的下一步。

![Agent Center](docs/assets/readme/agent-center.jpg)

文章列表用于查看生成结果、质量状态、发布状态和需要修复的内容。

![Articles](docs/assets/readme/articles.jpg)

Search Console 页面用于绑定真实发布域名、保存 OAuth 凭据、同步 query、click、impression、CTR 和 average position。

![Search Console](docs/assets/readme/search-console.jpg)

## 核心能力

- 多 Shopify 店铺管理，支持店铺级语言、品牌语气、产品和集合同步。
- AI 文章生成，使用 OpenAI-compatible provider，可配置文本模型和图片模型。
- Agent 化内容流程，覆盖 Research Agent、Writer Agent、SEO Gate Agent、Publisher Agent 和 Growth Agent。
- 质量门禁，检查 SEO score、标题意图、摘要、H2 结构、内容深度、内链、外部引用、FAQ、图片 alt、humanizer 和 helpful-content 信号。
- Shopify 发布，合格文章可以通过 Admin API 发布到 Shopify blog。
- Search Console 发布后复盘，使用真实 query、曝光、点击、CTR、平均排名来决定刷新、扩写和标题/meta 优化。
- Python FastAPI 后端迁移，承接 workflow plan、quality gate、repair plan、readiness doctrine 和 SEO board。
- BullMQ worker 后台任务，生成、发布、同步和复盘都可以进入队列执行。
- 本地一键启动脚本，自动处理依赖、数据库同步、前端和 worker。

## 架构

![Architecture](docs/assets/readme/architecture.svg)

```text
apps/
  web/       Next.js 管理后台、API routes、配置页、文章审核与发布 UI
  worker/    BullMQ 后台任务：商品同步、文章生成、发布、Search Console 同步
backend/
  python-agent-service/
            FastAPI agent 编排服务，承接 workflow、quality gate、repair plan 和 SEO board
packages/
  ai/              OpenAI-compatible provider 封装
  content-engine/  文章生成、SEO 评分、humanizer、质量 gate、agent doctrine
  db/              Prisma schema、数据库客户端、seed
  i18n/            locale 与界面文案
  shared/          共享类型、状态机、策略常量
  shopify/         Shopify GraphQL Admin API、OAuth、发布封装
infra/docker/      本地 Postgres、Redis、MinIO
docs/              架构、重构路线和模块扩展说明
```

当前生产链路仍由 Next.js API route 和 BullMQ worker 执行。Python 后端已经接入 Agent Center 和内容质量相关规划接口，后续目标是逐步把生成、修复、发布和复盘编排移动到 Python 服务。

### 数据流

1. 操作员在 Next.js 管理后台创建店铺、配置 AI、发起 campaign。
2. Web API route 写入 Postgres，并把生成/发布/同步任务送入 Redis BullMQ。
3. Worker 消费任务，调用 content engine、AI provider、Shopify Admin API 和 Search Console API。
4. 文章、质量报告、发布日志、Search Console 行数据写回 Postgres。
5. Python Agent Service 读取上下文并给出 workflow plan、quality gate、repair plan 和下一步建议。

## SEO 工作流

![Workflow](docs/assets/readme/workflow.svg)

系统明确区分三个阶段：

- Publish-ready: 草稿通过质量门禁、humanizer、SEO score、内链、外部引用、标题摘要和内容深度检查。
- Index-ready: 文章已发布，有 canonical URL，并且可以进入抓取与 Search Console 同步。
- Rank-ready: 已有 Search Console 真实曝光、点击、CTR、平均排名和 query gap 证据，可以进入下一轮排名优化。

这意味着：没有 Search Console 也可以正常生成和审核文章；Search Console 只影响发布后的真实表现复盘。系统不会把“生成完成”误判成“Google 一定收录”或“SEO 一定提升”。

## 快速启动

### 1. 安装依赖

```bash
npm install
```

### 2. 准备环境变量

```bash
cp .env.example .env.local
```

生成本地 secret：

```bash
openssl rand -base64 32
```

把生成值填到：

```bash
AUTH_SECRET=
ENCRYPTION_KEY=
```

### 3. 启动本地环境

```bash
npm run start:local
```

这个脚本会自动：

1. 如果没有 `.env.local`，从 `.env.example` 创建。
2. 启动 Docker 里的 Postgres、Redis、MinIO。
3. 运行 Prisma generate 和 db push。
4. 启动 Next.js web 和 BullMQ worker。

访问：

- Web: `http://localhost:3000`
- Dashboard: `http://localhost:3000/dashboard`
- Agent Center: `http://localhost:3000/agents`

常用参数：

```bash
npm run start:local -- --port 3001        # 修改前端端口
npm run start:local -- --redis-port 6382  # 修改本项目 Redis 端口
npm run start:local -- --no-infra         # 不启动 Docker，复用已有数据库和 Redis
npm run start:local -- --seed             # 同步数据库后执行 seed
npm run start:local -- --web-only         # 只启动前端
npm run start:local -- --worker-only      # 只启动 worker
```

### 4. 启动 Python Agent 后端

```bash
cd backend/python-agent-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

根目录 `.env.local` 里开启：

```bash
PYTHON_AGENT_SERVICE_ENABLED=true
PYTHON_AGENT_SERVICE_URL=http://127.0.0.1:8010
```

健康检查：

```bash
curl http://127.0.0.1:8010/api/v1/health
```

## 环境变量

`.env.example` 已经列出可用变量。常用配置如下：

```bash
# App
APP_URL=http://localhost:3000
NODE_ENV=development
DEFAULT_LOCALE=zh-CN

# Database
DATABASE_URL=postgresql://shopify_blog:shopify_blog@localhost:5432/shopify_blog?schema=public

# Redis / queues
REDIS_URL=redis://localhost:6381
BULLMQ_PREFIX=shopify-ai-blog-local

# Secrets
AUTH_SECRET=replace-with-at-least-32-characters
ENCRYPTION_KEY=replace-with-32-byte-base64-key

# AI
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=
AI_TEXT_MODEL=gpt-4.1
AI_IMAGE_MODEL=gpt-image-1
AI_TEXT_STREAMING=true
AI_TEXT_TIMEOUT_MS=300000
AI_IMAGE_TIMEOUT_MS=240000

# Shopify
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_SCOPES=read_products,read_content,write_content
SHOPIFY_API_VERSION=2026-04

# Google Search Console
GSC_SITE_URL=https://your-real-domain.com/
GSC_CLIENT_ID=
GSC_CLIENT_SECRET=
GSC_REFRESH_TOKEN=

# Object storage
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=shopify-blog-assets
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_PUBLIC_BASE_URL=http://localhost:9000/shopify-blog-assets

# Python agent service
PYTHON_AGENT_SERVICE_ENABLED=true
PYTHON_AGENT_SERVICE_URL=http://127.0.0.1:8010
```

安全规则：

- 不要提交 `.env.local`、`.env`、OAuth JSON、API key、refresh token、Shopify token 或任何真实密钥。
- `ENCRYPTION_KEY` 用于加密店铺 token 和 provider key，生产环境必须稳定保存，不能每次部署更换。
- `BULLMQ_PREFIX` 建议每个项目独立，避免多个项目共用 Redis 时串队列。

## AI 配置

可以通过环境变量配置默认 provider，也可以进入 `/ai-settings` 在界面里保存店铺级 provider。

需要填写：

- `AI_BASE_URL`: OpenAI-compatible API 地址，例如 `https://api.openai.com/v1`
- `AI_API_KEY`: 模型供应商 API key
- `AI_TEXT_MODEL`: 用于文章和修复的文本模型
- `AI_IMAGE_MODEL`: 用于生成图片的模型
- `AI_TEXT_TIMEOUT_MS`: 长文生成建议 `300000`
- `AI_IMAGE_TIMEOUT_MS`: 图片生成建议 `240000`

真实文章生成必须有有效文本模型。只浏览后台、配置店铺、查看页面时可以暂时不填 AI key。

## Shopify 配置

系统支持两类 Shopify 连接方式：

1. 全局 OAuth app 凭据：写到 `.env.local` 的 `SHOPIFY_API_KEY` 和 `SHOPIFY_API_SECRET`。
2. 店铺级 Admin API token 或 Client Credentials：在 `/stores` 页面新增或更新店铺时保存。

### 获取 Shopify Admin API token

1. 打开 Shopify 店铺后台。
2. 进入 Apps and sales channels。
3. 创建或打开 Custom app。
4. 配置 Admin API scopes。
5. 至少开启：
   - `read_products`
   - `read_content`
   - `write_content`
6. 安装 app，复制 Admin API access token。
7. 回到系统 `/stores` 页面，新增或更新店铺。

### 店铺域名应该填什么

- Shopify Admin 连接可以使用 `your-store.myshopify.com`。
- Search Console 和 SEO canonical 应该使用真实发布域名，例如 `https://www.example.com/`。
- 如果你的真实收录域名不是 `myshopify.com`，不要把 Search Console property 填成 `myshopify.com`。

## Google Search Console 配置

Search Console 用于发布后的真实 SEO 表现复盘，包括：

- query
- impressions
- clicks
- CTR
- average position

重要边界：

- Google API key 不能读取私有 Search Console performance data。
- Search Console API 读取搜索表现必须使用 OAuth 2.0。
- 没有 Search Console 也应该能正常生成文章。
- Search Console 只影响发布后的表现同步和增长复盘。

### 获取 Search Console 凭据

1. 在 Google Search Console 添加并验证真实发布域名。
2. 在 Google Cloud Console 开启 Google Search Console API。
3. 创建 OAuth Client。
4. 按 Google quickstart 下载 OAuth client JSON。
5. 运行授权流程，拿到 token JSON，其中需要 refresh token。
6. 打开系统 `/search-console`。
7. 选择店铺，填写 Site URL。
8. 粘贴 OAuth client JSON 和 token JSON，保存。

常用 scope：

```text
https://www.googleapis.com/auth/webmasters.readonly
```

需要写权限时：

```text
https://www.googleapis.com/auth/webmasters
```

### Site URL 示例

URL-prefix property：

```text
https://www.example.com/
```

Domain property：

```text
sc-domain:example.com
```

## 推荐操作流程

当不知道从哪里开始时，先打开：

```text
/agents
```

完整流程：

1. `/stores`: 连接 Shopify 店铺，同步产品和集合。
2. `/ai-settings`: 配置 AI provider 并测试。
3. `/brand-voice`: 配置品牌语气和写作边界。
4. `/languages`: 配置语言、fallback 和 Shopify blog handle。
5. `/content-rules`: 查看 publish-ready、index-ready、rank-ready 规则。
6. `/research`: 查看选题、关键词、趋势、Search Console 和竞品信号。
7. `/campaigns`: 创建文章生成任务。
8. `/articles`: 查看生成结果、质量 gate、修复建议和发布状态。
9. `/search-console`: 绑定 Search Console 并同步真实搜索表现。
10. `/performance-review`: 根据真实表现找刷新、扩写、标题/meta 和内链机会。

第一轮最小可用路径：

```text
AI 配置 -> 店铺连接 -> 品牌语气 -> 创建 campaign -> 审核文章 -> 发布
```

有 Search Console 后的增长路径：

```text
发布文章 -> 同步 Search Console -> Performance Review -> 修复/扩写/改标题 -> 再同步
```

## 页面说明

| 页面 | 用途 |
| --- | --- |
| `/dashboard` | 总览店铺、任务、文章和队列健康状态 |
| `/agents` | 当前最应该做什么，查看 Python Agent Snapshot 和各 agent 状态 |
| `/stores` | 连接 Shopify 店铺，保存 Admin API/OAuth 配置 |
| `/ai-settings` | 配置 AI provider、模型和 API key |
| `/brand-voice` | 管理品牌语气、写作风格和禁用表达 |
| `/languages` | 管理语言、fallback 和 Shopify blog handle |
| `/content-rules` | 查看发布、收录和排名 readiness 规则 |
| `/research` | 查看选题机会、关键词和证据 |
| `/priorities` | 查看内容优先级和增长任务 |
| `/campaigns` | 创建和跟踪文章生成任务 |
| `/articles` | 审核文章、质量报告、修复计划和发布操作 |
| `/search-console` | 管理 Search Console property、OAuth 和同步 |
| `/performance-review` | 用真实搜索表现决定下一轮优化 |
| `/logs` | 查看发布、同步、队列和审计日志 |

## Worker 队列

worker 监听的主要任务：

- `product.sync`: 同步 Shopify 商品
- `collection.sync`: 同步 Shopify 集合
- `blog.generate`: 生成文章
- `article.publish`: 发布文章到 Shopify
- `gsc.store.sync`: 同步店铺 Search Console 表现
- `gsc.article.sync`: 同步单篇文章 Search Console 表现

默认 Redis 使用：

```bash
REDIS_URL=redis://localhost:6381
BULLMQ_PREFIX=shopify-ai-blog-local
```

这样可以避免和其他项目共用 `6379` 或混用 BullMQ 队列。

## Python Agent 后端

Python 服务目录：

```text
backend/python-agent-service
```

主要结构：

```text
app/
  api/v1/        FastAPI routes
  core/          settings
  domain/        agents, content, quality, seo 领域逻辑
  integrations/  Shopify, Search Console, queue, storage 边界
  schemas/       Pydantic contracts
  services/      route 调用的应用服务
```

主要接口：

- `GET /api/v1/health`
- `GET /api/v1/agents`
- `GET /api/v1/health/integrations`
- `GET /api/v1/content/readiness-doctrine`
- `POST /api/v1/content/workflow-plan`
- `POST /api/v1/content/workflow-execution-plan`
- `POST /api/v1/content/quality-gate`
- `POST /api/v1/content/repair-plan`
- `GET /api/v1/seo/board`

Python 环境变量使用 `AGENT_` 前缀，例如：

```bash
AGENT_DATABASE_URL=postgresql://shopify_blog:shopify_blog@localhost:5432/shopify_blog?schema=public
AGENT_REDIS_URL=redis://localhost:6381
AGENT_GOOGLE_SEARCH_CONSOLE_PROPERTY_URL=https://www.example.com/
AGENT_GOOGLE_CLIENT_ID=
AGENT_GOOGLE_CLIENT_SECRET=
```

## 开发命令

根目录：

```bash
npm run lint
npm run typecheck
npm test
npm run build

npm run db:generate
npm run db:push
npm run db:seed
```

Web：

```bash
npm --workspace @shopify-ai-blog/web run dev
npm --workspace @shopify-ai-blog/web run typecheck
```

Worker：

```bash
npm --workspace @shopify-ai-blog/worker run dev
npm --workspace @shopify-ai-blog/worker run typecheck
```

Python：

```bash
cd backend/python-agent-service
source .venv/bin/activate
pytest
ruff check .
```

## 本地后台运行

如果希望服务在后台继续运行，可以用 `screen`：

```bash
screen -dmS shopifyseoblog-app zsh -lc 'cd /path/to/shopifyseoblog && bash scripts/run-dev.sh --no-infra 2>&1 | tee .run/logs/screen-app.log'
screen -dmS shopifyseoblog-python zsh -lc 'cd /path/to/shopifyseoblog/backend/python-agent-service && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload 2>&1 | tee ../../.run/logs/screen-python.log'
```

查看：

```bash
screen -ls
tail -f .run/logs/screen-app.log
tail -f .run/logs/screen-python.log
```

停止：

```bash
screen -S shopifyseoblog-app -X quit
screen -S shopifyseoblog-python -X quit
```

## 部署说明

当前仓库优先支持自托管和本地开发：

- Postgres 保存店铺、文章、任务、质量报告和同步结果。
- Redis + BullMQ 执行后台任务。
- MinIO / S3 保存生成图片。
- Next.js 提供管理后台和 API routes。
- Python FastAPI 服务逐步接管 agent orchestration。

生产部署需要：

1. 把 `.env.local` 中的本地地址替换为生产服务地址。
2. 使用持久化 Postgres、Redis 和对象存储。
3. 使用 secret manager 保存 `AUTH_SECRET`、`ENCRYPTION_KEY`、Shopify token、AI key 和 OAuth token。
4. 至少运行一个常驻 worker 实例。
5. Search Console OAuth refresh token 只保存在服务端，不能暴露给前端。
6. `APP_URL` 使用真实 HTTPS 域名。
7. Shopify app callback、webhook 和 OAuth 地址与生产域名一致。

## 常见问题

### 文章生成卡住

先检查：

1. worker 是否在运行。
2. `REDIS_URL` 和 `BULLMQ_PREFIX` 是否一致。
3. `/logs` 是否有生成任务错误。
4. `.run/logs/worker.log` 或 `screen-app.log` 是否有 AI provider timeout、token、Shopify 权限或质量 gate 错误。
5. AI provider 是否配置了有效 `AI_API_KEY` 和模型。
6. 当前 campaign 是否已经生成了失败的 publish job。

Search Console 未配置不应该阻塞文章生成；它只影响发布后的表现同步和复盘。

### 前端打不开

检查端口：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

如果端口被占用：

```bash
npm run start:local -- --port 3001
```

### Python 后端连不上

检查：

```bash
curl http://127.0.0.1:8010/api/v1/health
```

确认根目录 `.env.local`：

```bash
PYTHON_AGENT_SERVICE_ENABLED=true
PYTHON_AGENT_SERVICE_URL=http://127.0.0.1:8010
```

### Search Console 已经有 API key，为什么不能同步

因为 Search Console performance data 是私有用户数据，需要 OAuth 2.0 授权。API key 不能读取 query、clicks、CTR、average position，也不能替代 refresh token。

### 应该填 myshopify.com 还是真实域名

填 Google 实际收录和 Search Console 验证的域名。通常应该是你的真实发布域名，例如：

```text
https://www.example.com/
```

不要填 `https://xxxxx.myshopify.com/`，除非你真的让 Google 收录这个域名。

### 生成的文章是否一定能被 Google 收录并提升排名

不能保证。系统能做的是提高文章的发布质量、结构、证据、内链和复盘效率。Google 是否收录、排名是否提升，需要上线后的 Search Console 数据继续验证和优化。

### 为什么 Redis 用 6381

为了避免和其他项目默认 Redis `6379` 混用。脚本会把本项目默认 Redis 设置成 `redis://localhost:6381`，并使用 `BULLMQ_PREFIX=shopify-ai-blog-local` 隔离队列。

## 参考设计来源

- `TheCraigHewitt/seomachine`: research -> write -> rewrite -> optimize -> performance-review 的 SEO 流程纪律。
- `ericosiu/ai-marketing-skills`: content ops、seo ops、humanizer、expert panel、质量评分和持续优化思路。
- Shopify GraphQL Admin API: 商品、集合、博客发布和内容同步。
- Google Search Console API: 发布后查询、点击、曝光、CTR 和平均排名复盘。
