# Shopify SEO Blog Agent Platform

面向 Shopify 店铺的 AI SEO 博客生产与增长复盘系统。当前版本已经支持多店铺管理、产品/集合数据同步、AI 文章生成、质量门禁、Shopify 发布、Google Search Console 发布后复盘，以及正在迁移中的 Python AI Agent 编排后端。

这个项目的目标不是简单生成一篇文章，而是把 SEO 内容流程 agent 化：研究选题 -> 生成 brief -> 写作 -> 人类化和质量门禁 -> 发布 -> Search Console 复盘 -> 持续修复和刷新。

## 当前架构

```text
apps/
  web/       Next.js 管理后台、服务端 API routes、配置页、文章审核与发布 UI
  worker/    BullMQ 后台任务：商品同步、文章生成、发布、Search Console 同步
backend/
  python-agent-service/
            FastAPI agent 编排服务，承接工作流规划、质量门禁、SEO readiness 和后续 Python 后端迁移
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

当前生产链路仍由 Next.js API route + BullMQ worker 执行，Python 后端负责 agent center、workflow plan、quality gate、repair plan、SEO board 等迁移中的编排能力。后续目标是把生成和发布编排逐步移到 Python 后端。

## 需要的软件

- Node.js `>=20.18`
- npm `>=10`
- Python `>=3.11`
- Docker Desktop，可选但推荐，用来启动 Postgres、Redis、MinIO
- Git

如果不用 Docker，也可以复用本机已有的 Postgres 和 Redis。默认数据库连接是：

```bash
postgresql://shopify_blog:shopify_blog@localhost:5432/shopify_blog?schema=public
```

默认 Redis 是：

```bash
redis://localhost:6381
```

## 快速启动

安装依赖：

```bash
npm install
```

启动完整本地开发环境：

```bash
npm run start:local
```

这个脚本会自动完成：

1. 如果没有 `.env.local`，从 `.env.example` 创建一份。
2. 启动 Docker 里的 Postgres、Redis、MinIO。
3. 运行 Prisma generate 和 db push。
4. 启动 Next.js web 和 BullMQ worker。

常用参数：

```bash
npm run start:local -- --port 3001        # 修改前端端口
npm run start:local -- --redis-port 6382  # 修改本项目 Redis 端口
npm run start:local -- --no-infra         # 不启动 Docker，复用已有数据库和 Redis
npm run start:local -- --seed             # 同步数据库后执行 seed
npm run start:local -- --web-only         # 只启动前端
npm run start:local -- --worker-only      # 只启动 worker
```

访问：

- Web: `http://localhost:3000`
- Dashboard: `http://localhost:3000/dashboard`
- Agent Center: `http://localhost:3000/agents`

## Python Agent 后端

Python 服务需要单独启动：

```bash
cd backend/python-agent-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

然后在根目录 `.env.local` 里打开：

```bash
PYTHON_AGENT_SERVICE_ENABLED=true
PYTHON_AGENT_SERVICE_URL=http://127.0.0.1:8010
```

健康检查：

```bash
curl http://127.0.0.1:8010/api/v1/health
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

## 环境变量

根目录复制 `.env.example`：

```bash
cp .env.example .env.local
```

生成本地密钥：

```bash
openssl rand -base64 32
```

至少需要关注这些变量：

```bash
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://shopify_blog:shopify_blog@localhost:5432/shopify_blog?schema=public
REDIS_URL=redis://localhost:6381
BULLMQ_PREFIX=shopify-ai-blog-local

AUTH_SECRET=replace-with-at-least-32-characters
ENCRYPTION_KEY=replace-with-32-byte-base64-key

AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=
AI_TEXT_MODEL=gpt-4.1
AI_IMAGE_MODEL=gpt-image-1

SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_SCOPES=read_products,read_content,write_content
SHOPIFY_API_VERSION=2026-04

GSC_SITE_URL=https://your-real-domain.com/
GSC_CLIENT_ID=
GSC_CLIENT_SECRET=
GSC_REFRESH_TOKEN=

PYTHON_AGENT_SERVICE_ENABLED=true
PYTHON_AGENT_SERVICE_URL=http://127.0.0.1:8010
```

不要提交 `.env.local`、OAuth JSON、API key、refresh token、Shopify token 或任何真实密钥。

## AI 配置

进入 `http://localhost:3000/ai-settings` 配置默认 AI provider，或通过环境变量配置：

- `AI_BASE_URL`: OpenAI-compatible API base URL，例如 `https://api.openai.com/v1`
- `AI_API_KEY`: 模型供应商 API key
- `AI_TEXT_MODEL`: 文本生成模型
- `AI_IMAGE_MODEL`: 图片模型
- `AI_TEXT_TIMEOUT_MS`: 长文生成超时时间，默认建议 `300000`
- `AI_IMAGE_TIMEOUT_MS`: 图片生成超时时间，默认建议 `240000`

如果只想先跑通系统页面，可以暂时不填 AI key；但真实文章生成需要有效的文本模型配置。

## Shopify 配置

系统支持两类 Shopify 凭据：

1. 全局 OAuth app 凭据：写到 `.env.local` 的 `SHOPIFY_API_KEY` 和 `SHOPIFY_API_SECRET`。
2. 店铺级 Admin API token / Client Credentials：在 `/stores` 页面新增或更新店铺时保存。

获取方式：

1. 打开 Shopify Partner Dashboard 或店铺后台的 app 设置。
2. 创建或选择一个 custom app / public app。
3. 开启 Admin API 权限，至少需要：
   - `read_products`
   - `read_content`
   - `write_content`
4. 复制 Admin API access token，或复制 client ID / client secret 用于 OAuth / token exchange。
5. 在 `/stores` 页面连接店铺。

发布文章前，店铺必须能通过 Shopify GraphQL Admin API 访问，并且有内容写入权限。

## Google Search Console 配置

Search Console 用于发布后的真实 SEO 表现复盘，包括 query、impressions、clicks、CTR、average position。它不应该阻塞文章生成；没有 Search Console 也可以继续生成和审核文章。

重要边界：

- Google API key 只能识别 Cloud project，不能读取你的私有 Search Console performance data。
- 读取 Search Console 搜索表现必须使用 OAuth 2.0。
- 站点 URL 应该填真实发布域名，例如 `https://www.example.com/`，不要填临时的 `myshopify.com` 域名，除非那个就是你实际给 Google 收录的域名。

推荐流程：

1. 在 Google Search Console 添加并验证你的真实发布域名。
2. 在 Google Cloud Console 开启 Google Search Console API。
3. 按 Google quickstart 创建 OAuth client，下载 OAuth client JSON。
4. 使用 quickstart 或 OAuth 流程授权当前 Google 账号，拿到 token JSON，其中需要 refresh token。
5. 打开 `/search-console`。
6. 选择店铺，填写 Site URL。
7. 粘贴 OAuth client JSON 和 token JSON，保存。

常用 scope：

```text
https://www.googleapis.com/auth/webmasters.readonly
```

或需要写权限时：

```text
https://www.googleapis.com/auth/webmasters
```

配置完成后可以在 `/search-console` 手动同步，也可以由 worker 执行 `gsc.store.sync` 和 `gsc.article.sync` 队列任务。

## 推荐使用流程

当不知道从哪里开始时，先打开：

```text
/agents
```

页面会给出当前唯一主动作。完整流程是：

1. `/stores`: 连接 Shopify 店铺，同步产品和集合。
2. `/ai-settings`: 配置 AI provider 并测试。
3. `/brand-voice`: 配置品牌语气和写作边界。
4. `/languages`: 配置语言、fallback 和 Shopify blog handle。
5. `/content-rules`: 查看 publish-ready、index-ready、rank-ready 的判断规则。
6. `/research`: 查看选题、关键词、趋势、Search Console 和竞品信号。
7. `/campaigns`: 创建文章生成任务。
8. `/articles`: 查看生成结果、质量 gate、修复建议和发布状态。
9. `/search-console`: 绑定 Search Console 并同步真实搜索表现。
10. `/performance-review`: 根据真实表现找刷新、扩写、标题/meta 和内链机会。

## 文章质量与 SEO 边界

系统把三个概念分开：

- Publish-ready: 草稿通过质量门禁、humanizer、SEO score、内链、外部引用、标题摘要和内容深度检查。
- Index-ready: 文章已发布，有 canonical URL，并能进入抓取和 Search Console 同步。
- Rank-ready: 已有 Search Console 真实曝光、点击、CTR、平均排名和 query gap 证据，可以进入下一轮排名优化。

因此，系统不会承诺“生成即收录”或“生成即排名提升”。高质量文章可以提高 SEO 工作的基础质量，但 Google 收录和排名提升必须依赖上线后的真实表现数据继续优化。

## Worker 队列

worker 监听的主要任务：

- `product.sync`: 同步 Shopify 商品
- `collection.sync`: 同步 Shopify 集合
- `blog.generate`: 生成文章
- `article.publish`: 发布文章到 Shopify
- `gsc.store.sync`: 同步店铺 Search Console 表现
- `gsc.article.sync`: 同步单篇文章 Search Console 表现

默认使用 `BULLMQ_PREFIX=shopify-ai-blog-local`，避免和其他项目共用 Redis 队列。

## 常用开发命令

```bash
npm run lint
npm run typecheck
npm test
npm run build

npm run db:generate
npm run db:push
npm run db:seed
```

Python 后端：

```bash
cd backend/python-agent-service
source .venv/bin/activate
pytest
ruff check .
```

## 本地后台运行示例

如果希望服务在后台继续运行，可以使用 `screen`：

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

## 常见问题

### 文章生成卡住

先检查：

1. worker 是否在运行。
2. `REDIS_URL` 和 `BULLMQ_PREFIX` 是否一致。
3. `/logs` 是否有生成任务错误。
4. `.run/logs/worker.log` 或 `screen-app.log` 是否有 AI provider timeout、token、Shopify 权限或质量 gate 错误。
5. AI provider 是否配置了有效 `AI_API_KEY` 和模型。

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

并确认根目录 `.env.local`：

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

## 部署说明

当前仓库优先支持自托管和本地开发：

- Postgres 保存店铺、文章、任务和同步结果。
- Redis + BullMQ 执行后台任务。
- MinIO / S3 保存生成图片。
- Next.js 提供管理后台和 API routes。
- Python FastAPI 服务逐步接管 agent orchestration。

生产部署时请确保：

1. `.env.local` 中的本地地址替换为生产服务地址。
2. 数据库、Redis、对象存储使用持久化服务。
3. `AUTH_SECRET`、`ENCRYPTION_KEY`、Shopify token、AI key、OAuth token 使用安全 secret 管理。
4. worker 至少运行一个常驻实例。
5. Search Console OAuth refresh token 不写入前端，也不提交到 Git。

## 参考设计来源

- `TheCraigHewitt/seomachine`: research -> write -> rewrite -> optimize -> performance-review 的 SEO 流程纪律。
- `ericosiu/ai-marketing-skills`: content ops、seo ops、humanizer、expert panel、质量评分和持续优化思路。
- Shopify GraphQL Admin API: 商品、集合、博客发布和内容同步。
- Google Search Console API: 发布后查询、点击、曝光、CTR 和平均排名复盘。
