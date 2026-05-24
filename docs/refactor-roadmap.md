# Python Agent Refactor Roadmap

## Goal

Turn the current Shopify AI blog system into an enterprise-grade, frontend-backend separated AI agent platform.

## Reference Patterns

- SEO workflow discipline from `seomachine`
- Content quality gates, expert panels, and iterative scoring from `ai-marketing-skills`
- Multi-store Shopify data remains the source of truth

## Target Architecture

### Frontend

- Next.js becomes a UI shell only
- Displays dashboard, agent topology, queue health, article quality, and SEO readiness
- Talks to Python backend via HTTP

### Backend

- Python API service owns orchestration, scoring, and content generation
- Structured into domain modules:
  - `api`
  - `agents`
  - `content`
  - `seo`
  - `shopify`
  - `quality`
  - `integrations`
  - `storage`

### Shared System Goals

- Enterprise directory structure
- Strong typing / schemas between services
- Multi-agent collaboration
- Human-like SEO article quality
- Measurable quality gates before publish

## Content Quality Gate

An article is not publish-ready unless it satisfies:

- Search intent match
- Clear primary keyword placement
- Internal link plan
- External reference support
- Strong heading structure
- Human-like voice pass
- SEO quality score threshold

## First Migration Steps

1. Add Python backend scaffold - done in `backend/python-agent-service`
2. Add shared agent/content contracts - started with Agent Center and quality-gate schemas
3. Route frontend to backend read APIs
4. Add multi-agent dashboard visualization - started with `/agents`
5. Move article generation orchestration out of TypeScript

## Current Operator Flow

Use `/agents` as the first screen when unsure what to do next.

1. Agent Center decides the next action.
2. Campaigns shows live generation stage and next step.
3. Articles shows whether a draft is publish-ready.
4. AI Repair rewrites an existing article with quality report, search score, evidence, links, citations, and memory rules.
5. Search Console and Performance Review validate real Google exposure, rankings, CTR, and refresh opportunities.

## SEO Readiness Rule

The system should not claim an article can rank just because it was generated.

- Publish-ready means quality gate and SEO score have cleared the threshold.
- Index-ready means the article is published and has a canonical URL.
- Ranking improvement requires post-publish Search Console evidence and ongoing repair/refresh loops.

## Python Service Bootstrap

The Python service now contains:

- `GET /api/v1/health`
- `GET /api/v1/agents`
- `POST /api/v1/content/workflow-plan`
- `POST /api/v1/content/quality-gate`
- `GET /api/v1/seo/board`

The workflow plan already models:

- research and evidence collection
- keyword and search-intent strategy
- human-like draft creation
- 90+ expert-panel review gate from `ai-marketing-skills`
- publish guard with SEO threshold
- post-publish Search Console growth loop

Next migration step: wire the Python service to the existing Postgres data models and BullMQ-compatible job lifecycle before moving the article-generation worker out of TypeScript.

## Enterprise Backend Progress

Current branch: `codex/python-agent-enterprise`

The Python service now has a clearer enterprise layering:

- `app/api/v1`: versioned HTTP routes
- `app/domain`: business rules for agents, content workflows, quality gates, and SEO strategy
- `app/schemas`: Pydantic request and response contracts
- `app/services`: thin compatibility layer for API handlers
- `app/integrations`: Shopify, Search Console, queue, and storage adapter boundaries

The SEO domain now models:

- page 2 quick-win signals
- competitor gap signals
- performance matrix rows
- content priority recommendations
- a unified SEO strategy board for the Agent Center

Reference patterns pulled into the design:

- `ai-marketing-skills/content-ops`: humanizer rules, content quality rubric, expert-panel thresholding
- `ai-marketing-skills/seo-ops`: quick-win, GSC, trend, competitor gap scoring
- `seomachine`: research -> write -> rewrite -> optimize -> performance-review workflow discipline

Latest verification:

- Python backend: `. .venv/bin/activate && pytest` passed
- Monorepo typecheck: `npm run typecheck` passed
- Monorepo tests: `npm test` passed
